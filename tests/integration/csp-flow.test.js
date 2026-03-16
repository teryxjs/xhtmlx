/**
 * @jest-environment jsdom
 */

const xhtmlx = require('../../xhtmlx.js');
const { config } = xhtmlx._internals;

function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function mockFetchJSON(data, status) {
  status = status || 200;
  global.fetch.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status: status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: function() { return Promise.resolve(data); },
    text: function() { return Promise.resolve(JSON.stringify(data)); }
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  global.fetch = jest.fn();
  xhtmlx.clearTemplateCache();
  config.cspSafe = true;
});

afterEach(() => {
  delete global.fetch;
  config.cspSafe = false;
  config.debug = false;
});

describe('CSP-safe mode integration flows', () => {

  // -----------------------------------------------------------------------
  // Full flow: GET -> template -> render -> swap works in CSP mode
  // -----------------------------------------------------------------------

  test('full flow: GET -> template -> render -> swap works in CSP mode', async () => {
    mockFetchJSON({ name: 'Alice', email: 'alice@example.com' });

    document.body.innerHTML =
      '<div id="source" xh-get="/api/user" xh-trigger="load">' +
        '<template>' +
          '<div class="user">' +
            '<span class="name" xh-text="name"></span>' +
            '<span class="email" xh-text="email"></span>' +
          '</div>' +
        '</template>' +
      '</div>';

    xhtmlx.process(document.body);
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledWith('/api/user', expect.objectContaining({
      method: 'GET'
    }));

    const nameEl = document.querySelector('.name');
    const emailEl = document.querySelector('.email');

    expect(nameEl).not.toBeNull();
    expect(nameEl.textContent).toBe('Alice');
    expect(emailEl).not.toBeNull();
    expect(emailEl.textContent).toBe('alice@example.com');
  });

  // -----------------------------------------------------------------------
  // xh-each inside template renders correctly in CSP mode
  // -----------------------------------------------------------------------

  test('xh-each inside template renders correctly in CSP mode', async () => {
    mockFetchJSON({
      title: 'Team',
      members: [
        { name: 'Alice' },
        { name: 'Bob' },
        { name: 'Charlie' }
      ]
    });

    document.body.innerHTML =
      '<div id="source" xh-get="/api/team" xh-trigger="load">' +
        '<template>' +
          '<div class="team">' +
            '<h2 xh-text="title"></h2>' +
            '<ul>' +
              '<li xh-each="members" xh-text="name"></li>' +
            '</ul>' +
          '</div>' +
        '</template>' +
      '</div>';

    xhtmlx.process(document.body);
    await flushPromises();

    const heading = document.querySelector('h2');
    expect(heading).not.toBeNull();
    expect(heading.textContent).toBe('Team');

    const items = document.querySelectorAll('li');
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe('Alice');
    expect(items[1].textContent).toBe('Bob');
    expect(items[2].textContent).toBe('Charlie');
  });

  // -----------------------------------------------------------------------
  // Error template rendering works in CSP mode
  // -----------------------------------------------------------------------

  test('error template rendering works in CSP mode', async () => {
    // First call: the API returns an error
    global.fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: function() { return Promise.resolve({ message: 'Not found' }); },
        text: function() { return Promise.resolve(JSON.stringify({ message: 'Not found' })); }
      })
      // Second call: the error template fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: function() { return Promise.resolve('<div class="error"><p xh-text="body.message"></p></div>'); }
      });

    document.body.innerHTML =
      '<div id="source" xh-get="/api/missing" xh-trigger="load" xh-error-template="/templates/error.html">' +
        '<template><span>Success</span></template>' +
      '</div>';

    xhtmlx.process(document.body);
    await flushPromises();
    await flushPromises();

    const errorEl = document.querySelector('.error');
    expect(errorEl).not.toBeNull();
    expect(errorEl.querySelector('p').textContent).toBe('Not found');
  });

  // -----------------------------------------------------------------------
  // Nested templates work in CSP mode
  // -----------------------------------------------------------------------

  test('nested templates work in CSP mode', async () => {
    // First call: outer API
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: function() { return Promise.resolve({ userId: 1, name: 'Alice' }); },
        text: function() { return Promise.resolve(JSON.stringify({ userId: 1, name: 'Alice' })); }
      })
      // Second call: inner API
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: function() { return Promise.resolve({ detail: 'Engineer' }); },
        text: function() { return Promise.resolve(JSON.stringify({ detail: 'Engineer' })); }
      });

    document.body.innerHTML =
      '<div id="outer" xh-get="/api/user" xh-trigger="load">' +
        '<template>' +
          '<div class="user">' +
            '<span class="name" xh-text="name"></span>' +
            '<div class="inner" xh-get="/api/user/1/detail" xh-trigger="load">' +
              '<template>' +
                '<span class="detail" xh-text="detail"></span>' +
              '</template>' +
            '</div>' +
          '</div>' +
        '</template>' +
      '</div>';

    xhtmlx.process(document.body);
    await flushPromises();
    await flushPromises();

    const nameEl = document.querySelector('.name');
    expect(nameEl).not.toBeNull();
    expect(nameEl.textContent).toBe('Alice');

    const detailEl = document.querySelector('.detail');
    expect(detailEl).not.toBeNull();
    expect(detailEl.textContent).toBe('Engineer');
  });

  // -----------------------------------------------------------------------
  // xh-model pre-fill works in CSP mode
  // -----------------------------------------------------------------------

  test('xh-model pre-fill works in CSP mode', async () => {
    mockFetchJSON({ username: 'alice', email: 'alice@example.com' });

    document.body.innerHTML =
      '<div id="source" xh-get="/api/profile" xh-trigger="load">' +
        '<template>' +
          '<form>' +
            '<input class="username" type="text" xh-model="username" />' +
            '<input class="email" type="email" xh-model="email" />' +
          '</form>' +
        '</template>' +
      '</div>';

    xhtmlx.process(document.body);
    await flushPromises();

    const usernameInput = document.querySelector('.username');
    const emailInput = document.querySelector('.email');

    expect(usernameInput).not.toBeNull();
    expect(usernameInput.value).toBe('alice');
    expect(emailInput).not.toBeNull();
    expect(emailInput.value).toBe('alice@example.com');
  });

  // -----------------------------------------------------------------------
  // xh-target swap with innerHTML works in CSP mode
  // -----------------------------------------------------------------------

  test('xh-target swap with innerHTML works in CSP mode', async () => {
    mockFetchJSON({ message: 'Updated' });

    document.body.innerHTML =
      '<button id="btn" xh-get="/api/update" xh-trigger="load" xh-target="#output">' +
        '<template>' +
          '<p class="msg" xh-text="message"></p>' +
        '</template>' +
      '</button>' +
      '<div id="output"><span class="old">Old</span></div>';

    xhtmlx.process(document.body);
    await flushPromises();

    const output = document.getElementById('output');
    expect(output.querySelector('.old')).toBeNull();
    const msg = output.querySelector('.msg');
    expect(msg).not.toBeNull();
    expect(msg.textContent).toBe('Updated');
  });
});
