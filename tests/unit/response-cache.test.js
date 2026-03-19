/**
 * @jest-environment jsdom
 */

const xhtmlx = require('../../xhtmlx.js');
const { executeRequest, DataContext, elementStates, responseCache } = xhtmlx._internals;

function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('Response caching with TTL', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    global.fetch = jest.fn();
    xhtmlx.clearTemplateCache();
    xhtmlx.clearResponseCache();
  });

  afterEach(() => {
    document.body.removeChild(container);
    delete global.fetch;
  });

  function mockFetchJSON(data, status) {
    status = status || 200;
    global.fetch.mockResolvedValue({
      ok: status >= 200 && status < 300,
      status: status,
      statusText: status === 200 ? 'OK' : 'Error',
      text: function () { return Promise.resolve(JSON.stringify(data)); }
    });
  }

  function makeElement(verb, url, cache) {
    var el = document.createElement('div');
    el.setAttribute('xh-' + verb.toLowerCase(), url);
    if (cache !== undefined) {
      el.setAttribute('xh-cache', String(cache));
    }
    container.appendChild(el);

    var state = { requestInFlight: false, intervalIds: [], observers: [] };
    elementStates.set(el, state);
    return el;
  }

  it('first GET request is fetched and cached', async () => {
    mockFetchJSON({ name: 'Alice' });

    var el = makeElement('get', '/api/user', '60');
    var ctx = new DataContext({});
    executeRequest(el, ctx, []);

    await flushPromises();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(responseCache.has('GET:/api/user')).toBe(true);
    expect(responseCache.get('GET:/api/user').data).toEqual({ name: 'Alice' });
  });

  it('second GET request with same URL returns cached data', async () => {
    mockFetchJSON({ name: 'Alice' });

    var el = makeElement('get', '/api/user', '60');
    var ctx = new DataContext({});

    // First request
    executeRequest(el, ctx, []);
    await flushPromises();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Reset request in-flight flag
    var state = elementStates.get(el);
    state.requestInFlight = false;

    // Second request - should use cache
    executeRequest(el, ctx, []);
    await flushPromises();
    await flushPromises();

    // fetch should NOT have been called again
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('cache expires after TTL', async () => {
    mockFetchJSON({ name: 'Alice' });

    var el = makeElement('get', '/api/user', '1');
    var ctx = new DataContext({});

    // First request
    executeRequest(el, ctx, []);
    await flushPromises();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Manually age the cache entry
    var cached = responseCache.get('GET:/api/user');
    cached.timestamp = Date.now() - 2000; // 2 seconds ago, TTL is 1 second

    // Reset in-flight
    var state = elementStates.get(el);
    state.requestInFlight = false;

    // Second request - cache should be expired
    mockFetchJSON({ name: 'Bob' });
    executeRequest(el, ctx, []);
    await flushPromises();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('xh-cache="forever" never expires', async () => {
    mockFetchJSON({ name: 'Alice' });

    var el = makeElement('get', '/api/user', 'forever');
    var ctx = new DataContext({});

    // First request
    executeRequest(el, ctx, []);
    await flushPromises();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Manually age the cache entry to a very old time
    var cached = responseCache.get('GET:/api/user');
    cached.timestamp = 1; // Epoch + 1ms (very old)

    // Reset in-flight
    var state = elementStates.get(el);
    state.requestInFlight = false;

    // Second request - should still use cache because TTL is forever
    executeRequest(el, ctx, []);
    await flushPromises();
    await flushPromises();

    // fetch should NOT have been called again
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('POST requests are not cached', async () => {
    mockFetchJSON({ result: 'ok' });

    var el = makeElement('post', '/api/submit', '60');
    var ctx = new DataContext({});

    // First request
    executeRequest(el, ctx, []);
    await flushPromises();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(responseCache.has('POST:/api/submit')).toBe(false);

    // Reset in-flight
    var state = elementStates.get(el);
    state.requestInFlight = false;

    // Second request - should make a new fetch
    mockFetchJSON({ result: 'ok2' });
    executeRequest(el, ctx, []);
    await flushPromises();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('clearResponseCache() empties the cache', async () => {
    mockFetchJSON({ name: 'Alice' });

    var el = makeElement('get', '/api/user', '60');
    var ctx = new DataContext({});

    // First request
    executeRequest(el, ctx, []);
    await flushPromises();
    await flushPromises();

    expect(responseCache.size).toBe(1);

    // Clear cache
    xhtmlx.clearResponseCache();

    expect(responseCache.size).toBe(0);
  });

  it('different URLs get different cache entries', async () => {
    mockFetchJSON({ name: 'Alice' });

    var el1 = makeElement('get', '/api/user/1', '60');
    var ctx = new DataContext({});

    executeRequest(el1, ctx, []);
    await flushPromises();
    await flushPromises();

    mockFetchJSON({ name: 'Bob' });

    var el2 = makeElement('get', '/api/user/2', '60');
    executeRequest(el2, ctx, []);
    await flushPromises();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(responseCache.has('GET:/api/user/1')).toBe(true);
    expect(responseCache.has('GET:/api/user/2')).toBe(true);
  });

  it('requests without xh-cache attribute are not cached', async () => {
    mockFetchJSON({ name: 'Alice' });

    var el = makeElement('get', '/api/user');
    var ctx = new DataContext({});

    executeRequest(el, ctx, []);
    await flushPromises();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(responseCache.size).toBe(0);
  });
});
