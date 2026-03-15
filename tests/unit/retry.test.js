/**
 * @jest-environment jsdom
 */

const xhtmlx = require('../../xhtmlx.js');
const { executeRequest, DataContext, elementStates } = xhtmlx._internals;

describe('Retry with backoff on failure', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    global.fetch = jest.fn();
    xhtmlx.clearTemplateCache();
    jest.useFakeTimers();
  });

  afterEach(() => {
    document.body.removeChild(container);
    delete global.fetch;
    jest.useRealTimers();
  });

  function makeElement(url, retryCount, retryDelay) {
    var el = document.createElement('div');
    el.setAttribute('xh-get', url);
    if (retryCount !== undefined) {
      el.setAttribute('xh-retry', String(retryCount));
    }
    if (retryDelay !== undefined) {
      el.setAttribute('xh-retry-delay', String(retryDelay));
    }
    container.appendChild(el);

    var state = { requestInFlight: false, intervalIds: [], observers: [] };
    elementStates.set(el, state);
    return el;
  }

  function mockFetchResponses(responses) {
    var callIndex = 0;
    global.fetch.mockImplementation(function () {
      var response = responses[callIndex] || responses[responses.length - 1];
      callIndex++;
      if (response.error) {
        return Promise.reject(new Error(response.error));
      }
      return Promise.resolve({
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        statusText: response.statusText || (response.status === 200 ? 'OK' : 'Error'),
        text: function () { return Promise.resolve(JSON.stringify(response.data || {})); }
      });
    });
  }

  it('5xx response triggers retry', async () => {
    mockFetchResponses([
      { status: 500, statusText: 'Internal Server Error' },
      { status: 200, data: { name: 'Alice' } }
    ]);

    var el = makeElement('/api/data', 2, 100);
    var ctx = new DataContext({});

    executeRequest(el, ctx, []);

    // First fetch fires immediately
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Advance timer past retry delay (100 * 2^0 = 100ms)
    jest.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('4xx response does NOT trigger retry', async () => {
    // Suppress console.error from handleError
    var origError = console.error;
    console.error = jest.fn();

    mockFetchResponses([
      { status: 404, statusText: 'Not Found', data: { error: 'not found' } }
    ]);

    var el = makeElement('/api/data', 2, 100);
    var ctx = new DataContext({});

    executeRequest(el, ctx, []);

    await Promise.resolve();
    await Promise.resolve();

    // Advance timers to make sure no retry happens
    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    await Promise.resolve();

    // Should only have been called once - no retry for 4xx
    expect(global.fetch).toHaveBeenCalledTimes(1);

    console.error = origError;
  });

  it('retries use exponential backoff', async () => {
    mockFetchResponses([
      { status: 500, statusText: 'Error' },
      { status: 500, statusText: 'Error' },
      { status: 200, data: { name: 'Alice' } }
    ]);

    var el = makeElement('/api/data', 3, 100);
    var ctx = new DataContext({});

    executeRequest(el, ctx, []);

    // First fetch fires immediately
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // First retry after 100ms (100 * 2^0)
    jest.advanceTimersByTime(99);
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(2);

    // Second retry after 200ms (100 * 2^1)
    jest.advanceTimersByTime(199);
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('xh:retry event is emitted on each retry', async () => {
    mockFetchResponses([
      { status: 500, statusText: 'Error' },
      { status: 200, data: { name: 'Alice' } }
    ]);

    var el = makeElement('/api/data', 2, 100);
    var ctx = new DataContext({});

    var retryEvents = [];
    el.addEventListener('xh:retry', function (e) {
      retryEvents.push(e.detail);
    });

    executeRequest(el, ctx, []);

    await Promise.resolve();
    expect(retryEvents.length).toBe(1);
    expect(retryEvents[0].attempt).toBe(1);
    expect(retryEvents[0].maxRetries).toBe(2);
    expect(retryEvents[0].status).toBe(500);
  });

  it('after max retries, error handling fires', async () => {
    // Suppress console.error
    var origError = console.error;
    console.error = jest.fn();

    mockFetchResponses([
      { status: 500, statusText: 'Error' },
      { status: 500, statusText: 'Error' },
      { status: 500, statusText: 'Error' }
    ]);

    var el = makeElement('/api/data', 2, 100);
    var ctx = new DataContext({});

    var errorEvents = [];
    el.addEventListener('xh:responseError', function (e) {
      errorEvents.push(e.detail);
    });

    executeRequest(el, ctx, []);

    // First attempt
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // First retry
    jest.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(2);

    // Second retry
    jest.advanceTimersByTime(200);
    await Promise.resolve();
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(3);

    // No more retries, error handling should have fired
    // Flush all pending promises - the response goes through multiple
    // promise chains: fetchWithRetry -> processFetchResponse -> response.text() -> handleError
    for (var i = 0; i < 10; i++) {
      await Promise.resolve();
    }

    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].status).toBe(500);

    console.error = origError;
  });

  it('network error triggers retry', async () => {
    // Suppress console.error
    var origError = console.error;
    console.error = jest.fn();

    mockFetchResponses([
      { error: 'Network failure' },
      { status: 200, data: { name: 'Alice' } }
    ]);

    var el = makeElement('/api/data', 2, 100);
    var ctx = new DataContext({});

    var retryEvents = [];
    el.addEventListener('xh:retry', function (e) {
      retryEvents.push(e.detail);
    });

    executeRequest(el, ctx, []);

    await Promise.resolve();
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(retryEvents.length).toBe(1);
    expect(retryEvents[0].error).toBe('Network failure');

    // Advance timer for retry
    jest.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();

    expect(global.fetch).toHaveBeenCalledTimes(2);

    console.error = origError;
  });
});
