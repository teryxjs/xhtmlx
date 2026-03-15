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
  xhtmlx.clearResponseCache();
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

describe("Caching, retry, and deduplication end-to-end", () => {
  test("xh-cache: second trigger uses cached response (fetch called once)", async () => {
    mockFetchJSON({ name: "Cached User" });

    document.body.innerHTML = `
      <button id="btn" xh-get="/api/user" xh-cache="60" xh-target="#output">
        <template>
          <span class="name" xh-text="name"></span>
        </template>
      </button>
      <div id="output"></div>
    `;

    xhtmlx.process(document.body);

    // First click
    document.getElementById("btn").click();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".name").textContent).toBe("Cached User");

    // Second click - should use cache
    document.getElementById("btn").click();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledTimes(1); // Still only one fetch call
  });

  test("xh-cache with expired TTL re-fetches", async () => {
    mockFetchJSON({ value: "first" });

    document.body.innerHTML = `
      <button id="btn" xh-get="/api/data" xh-cache="1" xh-target="#output">
        <template>
          <span class="val" xh-text="value"></span>
        </template>
      </button>
      <div id="output"></div>
    `;

    xhtmlx.process(document.body);

    // First click
    document.getElementById("btn").click();
    await flushPromises();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Advance time past the 1-second TTL
    const originalDateNow = Date.now;
    Date.now = jest.fn(() => originalDateNow() + 2000);

    mockFetchJSON({ value: "second" });

    // Second click after TTL expired - should re-fetch
    document.getElementById("btn").click();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledTimes(2);

    Date.now = originalDateNow;
  });

  test("xh-cache='forever' never re-fetches", async () => {
    mockFetchJSON({ data: "permanent" });

    document.body.innerHTML = `
      <button id="btn" xh-get="/api/permanent" xh-cache="forever" xh-target="#output">
        <template>
          <span class="data" xh-text="data"></span>
        </template>
      </button>
      <div id="output"></div>
    `;

    xhtmlx.process(document.body);

    // First click
    document.getElementById("btn").click();
    await flushPromises();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Simulate far future
    const originalDateNow = Date.now;
    Date.now = jest.fn(() => originalDateNow() + 999999999);

    // Subsequent clicks should still use cache
    document.getElementById("btn").click();
    await flushPromises();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    document.getElementById("btn").click();
    await flushPromises();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    Date.now = originalDateNow;
  });

  test("POST requests are never cached even with xh-cache attribute", async () => {
    mockFetchJSON({ result: "ok" });

    document.body.innerHTML = `
      <button id="btn" xh-post="/api/submit" xh-cache="60" xh-target="#output">
        <template>
          <span class="result" xh-text="result"></span>
        </template>
      </button>
      <div id="output"></div>
    `;

    xhtmlx.process(document.body);

    // First click
    document.getElementById("btn").click();
    await flushPromises();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Second click - should NOT use cache for POST
    document.getElementById("btn").click();
    await flushPromises();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("xh-retry: 500 response retries the request", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick"] });

    let callCount = 0;
    global.fetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          json: () => Promise.resolve({ error: "server error" }),
          text: () => Promise.resolve(JSON.stringify({ error: "server error" }))
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve({ name: "Success" }),
        text: () => Promise.resolve(JSON.stringify({ name: "Success" }))
      });
    });

    document.body.innerHTML = `
      <div xh-get="/api/flaky" xh-trigger="load" xh-retry="2" xh-retry-delay="100">
        <template>
          <span class="name" xh-text="name"></span>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await new Promise(resolve => process.nextTick(resolve));

    // Advance timer for the retry delay
    jest.advanceTimersByTime(200);
    await new Promise(resolve => process.nextTick(resolve));
    await new Promise(resolve => process.nextTick(resolve));

    expect(callCount).toBe(2);

    jest.useRealTimers();
  });

  test("xh-retry: 404 does NOT retry", async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: () => Promise.resolve({ error: "not found" }),
      text: () => Promise.resolve(JSON.stringify({ error: "not found" }))
    });

    document.body.innerHTML = `
      <div xh-get="/api/missing" xh-trigger="load" xh-retry="3" xh-retry-delay="100">
        <template>
          <span class="data">Data</span>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    // 404 is not a 5xx, so no retries should happen
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("request deduplication: rapid clicks only send one request", async () => {
    // Use a delayed response to keep the request "in-flight"
    let resolveResponse;
    global.fetch.mockReturnValue(new Promise(resolve => {
      resolveResponse = resolve;
    }));

    document.body.innerHTML = `
      <button id="btn" xh-get="/api/data" xh-target="#output">
        <template>
          <span class="result">Done</span>
        </template>
      </button>
      <div id="output"></div>
    `;

    xhtmlx.process(document.body);

    const btn = document.getElementById("btn");

    // Rapid clicks while request is in-flight
    btn.click();
    btn.click();
    btn.click();

    // Resolve the response
    resolveResponse({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve({ done: true }),
      text: () => Promise.resolve(JSON.stringify({ done: true }))
    });

    await flushPromises();

    // Only one fetch call should have been made
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("xh-disabled-class added during request and removed after", async () => {
    let resolveResponse;
    global.fetch.mockReturnValue(new Promise(resolve => {
      resolveResponse = resolve;
    }));

    document.body.innerHTML = `
      <button id="btn" xh-get="/api/data" xh-disabled-class="is-loading" xh-target="#output">
        <template>
          <span>Done</span>
        </template>
      </button>
      <div id="output"></div>
    `;

    xhtmlx.process(document.body);

    const btn = document.getElementById("btn");
    btn.click();

    // During the request, the disabled class should be added
    expect(btn.classList.contains("is-loading")).toBe(true);

    // Resolve the response
    resolveResponse({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(JSON.stringify({}))
    });

    await flushPromises();

    // After response, the disabled class should be removed
    expect(btn.classList.contains("is-loading")).toBe(false);
  });
});
