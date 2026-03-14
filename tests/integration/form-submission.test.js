/**
 * @jest-environment jsdom
 */

const xhtmlx = require("../../xhtmlx.js");

function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

beforeEach(() => {
  document.body.innerHTML = "";
  global.fetch = jest.fn();
  xhtmlx.clearTemplateCache();
});

afterEach(() => {
  delete global.fetch;
});

function mockFetchJSON(data, status = 200) {
  global.fetch.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status: status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data))
  });
}

describe("Form submission handling", () => {
  test("form with xh-post serializes input fields into request body", async () => {
    mockFetchJSON({ success: true });

    document.body.innerHTML = `
      <form id="myform" xh-post="/api/users" xh-trigger="submit">
        <input name="username" type="text" value="alice" />
        <input name="email" type="email" value="alice@example.com" />
        <template><span class="result">Created</span></template>
      </form>
    `;

    xhtmlx.process(document.body);

    // Trigger form submit
    const submitEvent = new Event("submit", { bubbles: true, cancelable: true });
    document.getElementById("myform").dispatchEvent(submitEvent);

    await flushPromises();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/users");
    expect(opts.method).toBe("POST");

    const body = JSON.parse(opts.body);
    expect(body.username).toBe("alice");
    expect(body.email).toBe("alice@example.com");
  });

  test("xh-vals are merged into request body", async () => {
    mockFetchJSON({ success: true });

    document.body.innerHTML = `
      <button id="btn" xh-post="/api/action" xh-trigger="load"
              xh-vals='{"role": "admin", "active": true}'>
        <template><span>OK</span></template>
      </button>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, opts] = global.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.role).toBe("admin");
    expect(body.active).toBe(true);
  });

  test("form fields and xh-vals are merged (xh-vals override form fields)", async () => {
    mockFetchJSON({ success: true });

    document.body.innerHTML = `
      <form id="myform" xh-post="/api/users" xh-trigger="submit"
            xh-vals='{"role": "admin", "username": "override"}'>
        <input name="username" type="text" value="alice" />
        <input name="email" type="email" value="alice@example.com" />
        <template><span class="result">Created</span></template>
      </form>
    `;

    xhtmlx.process(document.body);

    const submitEvent = new Event("submit", { bubbles: true, cancelable: true });
    document.getElementById("myform").dispatchEvent(submitEvent);

    await flushPromises();

    const [, opts] = global.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    // xh-vals should override the form field value
    expect(body.username).toBe("override");
    expect(body.email).toBe("alice@example.com");
    expect(body.role).toBe("admin");
  });

  test("xh-headers are sent as custom headers", async () => {
    mockFetchJSON({ success: true });

    document.body.innerHTML = `
      <button id="btn" xh-post="/api/action" xh-trigger="load"
              xh-headers='{"X-Custom-Token": "abc123", "X-Request-ID": "req-1"}'>
        <template><span>OK</span></template>
      </button>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers["X-Custom-Token"]).toBe("abc123");
    expect(opts.headers["X-Request-ID"]).toBe("req-1");
  });

  test("Content-Type defaults to application/json for POST", async () => {
    mockFetchJSON({ success: true });

    document.body.innerHTML = `
      <button id="btn" xh-post="/api/action" xh-trigger="load">
        <template><span>OK</span></template>
      </button>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers["Content-Type"]).toBe("application/json");
  });

  test("Content-Type defaults to application/json for PUT", async () => {
    mockFetchJSON({ success: true });

    document.body.innerHTML = `
      <button id="btn" xh-put="/api/resource/1" xh-trigger="load">
        <template><span>OK</span></template>
      </button>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.method).toBe("PUT");
    expect(opts.headers["Content-Type"]).toBe("application/json");
  });

  test("Content-Type defaults to application/json for PATCH", async () => {
    mockFetchJSON({ success: true });

    document.body.innerHTML = `
      <button id="btn" xh-patch="/api/resource/1" xh-trigger="load">
        <template><span>OK</span></template>
      </button>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.method).toBe("PATCH");
    expect(opts.headers["Content-Type"]).toBe("application/json");
  });

  test("Custom Content-Type in xh-headers overrides the default", async () => {
    mockFetchJSON({ success: true });

    document.body.innerHTML = `
      <button id="btn" xh-post="/api/action" xh-trigger="load"
              xh-headers='{"Content-Type": "text/plain"}'>
        <template><span>OK</span></template>
      </button>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers["Content-Type"]).toBe("text/plain");
  });

  test("GET request does not include Content-Type or body", async () => {
    mockFetchJSON({ data: "test" });

    document.body.innerHTML = `
      <button id="btn" xh-get="/api/data" xh-trigger="load">
        <template><span xh-text="data"></span></template>
      </button>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.method).toBe("GET");
    expect(opts.body).toBeUndefined();
    expect(opts.headers["Content-Type"]).toBeUndefined();
  });

  test("DELETE request does not include Content-Type or body", async () => {
    mockFetchJSON({});

    document.body.innerHTML = `
      <button id="btn" xh-delete="/api/resource/1" xh-trigger="load">
        <template><span>Deleted</span></template>
      </button>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.method).toBe("DELETE");
    expect(opts.body).toBeUndefined();
  });

  test("xh-vals with interpolation uses data context values", async () => {
    // First fetch returns data with an id
    global.fetch.mockImplementation((url) => {
      if (url === "/api/user") {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve(JSON.stringify({ id: 42, name: "Alice" }))
        });
      }
      // Second fetch is the POST
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(JSON.stringify({ success: true }))
      });
    });

    document.body.innerHTML = `
      <div xh-get="/api/user" xh-trigger="load">
        <template>
          <div class="user">
            <span xh-text="name"></span>
            <button class="action-btn" xh-post="/api/action" xh-trigger="load"
                    xh-vals='{"userId": "{{id}}"}'>
              <template><span class="result">Done</span></template>
            </button>
          </div>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    await flushPromises();

    // Find the POST call
    const postCall = global.fetch.mock.calls.find(([, opts]) => opts.method === "POST");
    expect(postCall).toBeDefined();
    const body = JSON.parse(postCall[1].body);
    expect(body.userId).toBe("42");
  });

  test("button inside form with xh-post serializes form fields", async () => {
    mockFetchJSON({ success: true });

    document.body.innerHTML = `
      <form id="myform">
        <input name="search" type="text" value="hello" />
        <button id="btn" xh-post="/api/search" xh-trigger="click">
          <template><span class="result">OK</span></template>
        </button>
      </form>
    `;

    xhtmlx.process(document.body);

    document.getElementById("btn").click();
    await flushPromises();

    const [, opts] = global.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.search).toBe("hello");
  });

  test("form with multiple field types serializes correctly", async () => {
    mockFetchJSON({ success: true });

    document.body.innerHTML = `
      <form id="myform" xh-post="/api/submit" xh-trigger="submit">
        <input name="text_field" type="text" value="hello" />
        <input name="number_field" type="number" value="42" />
        <input name="hidden_field" type="hidden" value="secret" />
        <select name="select_field">
          <option value="a">A</option>
          <option value="b" selected>B</option>
        </select>
        <textarea name="textarea_field">Some text</textarea>
        <template><span class="result">OK</span></template>
      </form>
    `;

    xhtmlx.process(document.body);

    const submitEvent = new Event("submit", { bubbles: true, cancelable: true });
    document.getElementById("myform").dispatchEvent(submitEvent);

    await flushPromises();

    const [, opts] = global.fetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.text_field).toBe("hello");
    expect(body.number_field).toBe("42");
    expect(body.hidden_field).toBe("secret");
    expect(body.select_field).toBe("b");
    expect(body.textarea_field).toBe("Some text");
  });
});
