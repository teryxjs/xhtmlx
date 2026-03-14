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

describe("Custom DOM events", () => {
  test("xh:beforeRequest fires before fetch with correct detail", async () => {
    mockFetchJSON({ data: "test" });

    document.body.innerHTML = `
      <div id="source" xh-get="/api/data" xh-trigger="load"
           xh-headers='{"X-Custom": "value"}'>
        <template><span xh-text="data"></span></template>
      </div>
    `;

    const handler = jest.fn();
    document.body.addEventListener("xh:beforeRequest", handler);

    xhtmlx.process(document.body);
    // The event fires synchronously before fetch, so we can check immediately
    expect(handler).toHaveBeenCalledTimes(1);

    const detail = handler.mock.calls[0][0].detail;
    expect(detail.url).toBe("/api/data");
    expect(detail.method).toBe("GET");
    expect(detail.headers).toBeDefined();
    expect(detail.headers["X-Custom"]).toBe("value");

    await flushPromises();

    document.body.removeEventListener("xh:beforeRequest", handler);
  });

  test("xh:beforeRequest can be cancelled with preventDefault", async () => {
    mockFetchJSON({ data: "test" });

    document.body.innerHTML = `
      <div id="source" xh-get="/api/data" xh-trigger="load">
        <template><span xh-text="data"></span></template>
      </div>
    `;

    const handler = jest.fn((e) => {
      e.preventDefault();
    });
    document.body.addEventListener("xh:beforeRequest", handler);

    xhtmlx.process(document.body);
    await flushPromises();

    // Handler was called
    expect(handler).toHaveBeenCalledTimes(1);
    // But fetch should NOT have been called because we cancelled
    expect(global.fetch).not.toHaveBeenCalled();

    document.body.removeEventListener("xh:beforeRequest", handler);
  });

  test("xh:afterRequest fires after fetch completes", async () => {
    mockFetchJSON({ data: "test" });

    document.body.innerHTML = `
      <div id="source" xh-get="/api/data" xh-trigger="load">
        <template><span xh-text="data"></span></template>
      </div>
    `;

    const handler = jest.fn();
    document.body.addEventListener("xh:afterRequest", handler);

    xhtmlx.process(document.body);

    // Not fired yet synchronously
    expect(handler).not.toHaveBeenCalled();

    await flushPromises();

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = handler.mock.calls[0][0].detail;
    expect(detail.url).toBe("/api/data");
    expect(detail.status).toBe(200);

    document.body.removeEventListener("xh:afterRequest", handler);
  });

  test("xh:beforeSwap fires before DOM insertion with correct detail", async () => {
    mockFetchJSON({ msg: "hello" });

    document.body.innerHTML = `
      <div id="source" xh-get="/api/data" xh-trigger="load" xh-target="#output">
        <template><span class="result" xh-text="msg"></span></template>
      </div>
      <div id="output"></div>
    `;

    const handler = jest.fn();
    document.body.addEventListener("xh:beforeSwap", handler);

    xhtmlx.process(document.body);
    await flushPromises();

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = handler.mock.calls[0][0].detail;
    expect(detail.target).toBe(document.getElementById("output"));
    expect(detail.swapMode).toBe("innerHTML");
    expect(detail.fragment).toBeDefined();

    document.body.removeEventListener("xh:beforeSwap", handler);
  });

  test("xh:beforeSwap can be cancelled to prevent DOM swap", async () => {
    mockFetchJSON({ msg: "hello" });

    document.body.innerHTML = `
      <div id="source" xh-get="/api/data" xh-trigger="load" xh-target="#output">
        <template><span class="result" xh-text="msg"></span></template>
      </div>
      <div id="output"><p class="original">Original</p></div>
    `;

    const handler = jest.fn((e) => {
      e.preventDefault();
    });
    document.body.addEventListener("xh:beforeSwap", handler);

    xhtmlx.process(document.body);
    await flushPromises();

    // Handler was called
    expect(handler).toHaveBeenCalledTimes(1);

    // But the DOM should NOT have been modified
    const output = document.getElementById("output");
    expect(output.querySelector(".original")).not.toBeNull();
    expect(output.querySelector(".result")).toBeNull();

    document.body.removeEventListener("xh:beforeSwap", handler);
  });

  test("xh:afterSwap fires after DOM insertion", async () => {
    mockFetchJSON({ msg: "hello" });

    document.body.innerHTML = `
      <div id="source" xh-get="/api/data" xh-trigger="load" xh-target="#output">
        <template><span class="result" xh-text="msg"></span></template>
      </div>
      <div id="output"></div>
    `;

    const handler = jest.fn();
    document.body.addEventListener("xh:afterSwap", handler);

    xhtmlx.process(document.body);
    await flushPromises();

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = handler.mock.calls[0][0].detail;
    expect(detail.target).toBe(document.getElementById("output"));

    // DOM should be updated by the time afterSwap fires
    expect(document.querySelector(".result")).not.toBeNull();
    expect(document.querySelector(".result").textContent).toBe("hello");

    document.body.removeEventListener("xh:afterSwap", handler);
  });

  test("xh:responseError fires on error responses with correct detail", async () => {
    const errorBody = { error: "forbidden", message: "Access denied" };
    global.fetch.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      json: () => Promise.resolve(errorBody),
      text: () => Promise.resolve(JSON.stringify(errorBody))
    });

    document.body.innerHTML = `
      <div id="source" xh-get="/api/secret" xh-trigger="load">
        <template><span xh-text="data"></span></template>
      </div>
    `;

    const handler = jest.fn();
    document.body.addEventListener("xh:responseError", handler);

    xhtmlx.process(document.body);
    await flushPromises();

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = handler.mock.calls[0][0].detail;
    expect(detail.status).toBe(403);
    expect(detail.statusText).toBe("Forbidden");
    expect(detail.body).toEqual(errorBody);

    document.body.removeEventListener("xh:responseError", handler);
  });

  test("event order: beforeRequest -> afterRequest -> beforeSwap -> afterSwap", async () => {
    mockFetchJSON({ data: "test" });

    document.body.innerHTML = `
      <div id="source" xh-get="/api/data" xh-trigger="load">
        <template><span xh-text="data"></span></template>
      </div>
    `;

    const eventOrder = [];

    const handlers = {
      "xh:beforeRequest": jest.fn(() => eventOrder.push("beforeRequest")),
      "xh:afterRequest": jest.fn(() => eventOrder.push("afterRequest")),
      "xh:beforeSwap": jest.fn(() => eventOrder.push("beforeSwap")),
      "xh:afterSwap": jest.fn(() => eventOrder.push("afterSwap"))
    };

    for (const [event, handler] of Object.entries(handlers)) {
      document.body.addEventListener(event, handler);
    }

    xhtmlx.process(document.body);
    await flushPromises();

    expect(eventOrder).toEqual([
      "beforeRequest",
      "afterRequest",
      "beforeSwap",
      "afterSwap"
    ]);

    for (const [event, handler] of Object.entries(handlers)) {
      document.body.removeEventListener(event, handler);
    }
  });

  test("events bubble up from the source element", async () => {
    mockFetchJSON({ data: "test" });

    document.body.innerHTML = `
      <div id="parent">
        <div id="source" xh-get="/api/data" xh-trigger="load">
          <template><span xh-text="data"></span></template>
        </div>
      </div>
    `;

    const parentHandler = jest.fn();
    document.getElementById("parent").addEventListener("xh:beforeRequest", parentHandler);

    xhtmlx.process(document.body);
    await flushPromises();

    expect(parentHandler).toHaveBeenCalledTimes(1);
    // The event target should be the source element
    expect(parentHandler.mock.calls[0][0].target).toBe(document.getElementById("source"));

    document.getElementById("parent").removeEventListener("xh:beforeRequest", parentHandler);
  });

  test("xh:afterRequest fires even on error responses", async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.resolve(JSON.stringify({ error: "fail" }))
    });

    document.body.innerHTML = `
      <div id="source" xh-get="/api/broken" xh-trigger="load">
        <template><span xh-text="data"></span></template>
      </div>
    `;

    const afterHandler = jest.fn();
    const errorHandler = jest.fn();
    document.body.addEventListener("xh:afterRequest", afterHandler);
    document.body.addEventListener("xh:responseError", errorHandler);

    xhtmlx.process(document.body);
    await flushPromises();

    expect(afterHandler).toHaveBeenCalledTimes(1);
    expect(afterHandler.mock.calls[0][0].detail.status).toBe(500);
    expect(errorHandler).toHaveBeenCalledTimes(1);

    document.body.removeEventListener("xh:afterRequest", afterHandler);
    document.body.removeEventListener("xh:responseError", errorHandler);
  });

  test("xh:beforeRequest detail includes method for POST request", async () => {
    mockFetchJSON({ success: true });

    document.body.innerHTML = `
      <button id="btn" xh-post="/api/action" xh-trigger="load" xh-vals='{"key":"val"}'>
        <template><span xh-text="success"></span></template>
      </button>
    `;

    const handler = jest.fn();
    document.body.addEventListener("xh:beforeRequest", handler);

    xhtmlx.process(document.body);
    await flushPromises();

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = handler.mock.calls[0][0].detail;
    expect(detail.method).toBe("POST");
    expect(detail.url).toBe("/api/action");

    document.body.removeEventListener("xh:beforeRequest", handler);
  });
});
