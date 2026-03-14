/**
 * @jest-environment jsdom
 */

const xhtmlx = require("../../xhtmlx.js");

// Flush multiple rounds of microtasks (fetch has a multi-hop .then chain)
async function flushPromises() {
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => process.nextTick(resolve));
  }
}

beforeEach(() => {
  document.body.innerHTML = "";
  global.fetch = jest.fn();
  xhtmlx.clearTemplateCache();
  // Clear processed state so elements aren't skipped
  jest.useFakeTimers({ doNotFake: ['nextTick'] });
});

afterEach(() => {
  jest.useRealTimers();
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

describe("Trigger system", () => {
  test("'load' trigger fires automatically on processNode", async () => {
    mockFetchJSON({ msg: "loaded" });

    document.body.innerHTML = `
      <div id="auto" xh-get="/api/data" xh-trigger="load">
        <template><span class="result" xh-text="msg"></span></template>
      </div>
    `;

    xhtmlx.process(document.body);

    // Flush microtasks and timers
    await jest.runAllTimersAsync();

    expect(global.fetch).toHaveBeenCalledWith("/api/data", expect.anything());

    const result = document.querySelector(".result");
    expect(result).not.toBeNull();
    expect(result.textContent).toBe("loaded");
  });

  test("'click' trigger fires on click event", async () => {
    mockFetchJSON({ msg: "clicked" });

    document.body.innerHTML = `
      <button id="btn" xh-get="/api/action" xh-trigger="click">
        <template><span class="result" xh-text="msg"></span></template>
      </button>
    `;

    xhtmlx.process(document.body);

    // fetch should NOT have been called yet (no load trigger)
    expect(global.fetch).not.toHaveBeenCalled();

    // Simulate click
    document.getElementById("btn").click();

    await jest.runAllTimersAsync();

    expect(global.fetch).toHaveBeenCalledWith("/api/action", expect.anything());
  });

  test("default trigger for button is 'click'", async () => {
    mockFetchJSON({ msg: "clicked" });

    document.body.innerHTML = `
      <button id="btn" xh-get="/api/action">
        <template><span class="result" xh-text="msg"></span></template>
      </button>
    `;

    xhtmlx.process(document.body);

    // Without clicking, nothing should happen
    expect(global.fetch).not.toHaveBeenCalled();

    document.getElementById("btn").click();
    await jest.runAllTimersAsync();

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("'submit' trigger fires on form submit and prevents default", async () => {
    mockFetchJSON({ success: true });

    document.body.innerHTML = `
      <form id="myform" xh-post="/api/submit" xh-trigger="submit">
        <input name="username" value="alice" />
        <template><span class="result">OK</span></template>
      </form>
    `;

    xhtmlx.process(document.body);

    // Dispatch a submit event
    const submitEvent = new Event("submit", { bubbles: true, cancelable: true });
    const preventDefaultSpy = jest.spyOn(submitEvent, "preventDefault");

    document.getElementById("myform").dispatchEvent(submitEvent);

    await jest.runAllTimersAsync();

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith("/api/submit", expect.objectContaining({
      method: "POST"
    }));
  });

  test("default trigger for form is 'submit'", async () => {
    mockFetchJSON({ success: true });

    document.body.innerHTML = `
      <form id="myform" xh-post="/api/submit">
        <input name="username" value="alice" />
        <template><span class="result">OK</span></template>
      </form>
    `;

    xhtmlx.process(document.body);

    expect(global.fetch).not.toHaveBeenCalled();

    const submitEvent = new Event("submit", { bubbles: true, cancelable: true });
    document.getElementById("myform").dispatchEvent(submitEvent);

    await jest.runAllTimersAsync();

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("'every Ns' trigger fires repeatedly", async () => {
    mockFetchJSON({ count: 1 });

    document.body.innerHTML = `
      <div id="poller" xh-get="/api/poll" xh-trigger="every 2s">
        <template><span class="result" xh-text="count"></span></template>
      </div>
    `;

    xhtmlx.process(document.body);

    // Initially no fetch (every does not fire immediately)
    expect(global.fetch).not.toHaveBeenCalled();

    // Advance 2 seconds
    jest.advanceTimersByTime(2000);
    await flushPromises();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Advance another 2 seconds
    jest.advanceTimersByTime(2000);
    await flushPromises();
    expect(global.fetch).toHaveBeenCalledTimes(2);

    // Advance another 2 seconds
    jest.advanceTimersByTime(2000);
    await flushPromises();
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test("'once' modifier ensures trigger fires only once", async () => {
    mockFetchJSON({ msg: "once" });

    document.body.innerHTML = `
      <button id="btn" xh-get="/api/action" xh-trigger="click once">
        <template><span class="result" xh-text="msg"></span></template>
      </button>
    `;

    xhtmlx.process(document.body);

    const btn = document.getElementById("btn");
    btn.click();
    await jest.runAllTimersAsync();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Click again
    btn.click();
    await jest.runAllTimersAsync();
    // Should still be 1 because of the once modifier
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("'delay' modifier debounces the trigger", async () => {
    mockFetchJSON({ msg: "delayed" });

    document.body.innerHTML = `
      <input id="search" xh-get="/api/search" xh-trigger="keyup delay:300ms">
    `;

    xhtmlx.process(document.body);

    const input = document.getElementById("search");

    // Fire keyup multiple times rapidly
    input.dispatchEvent(new Event("keyup"));
    jest.advanceTimersByTime(100);
    input.dispatchEvent(new Event("keyup"));
    jest.advanceTimersByTime(100);
    input.dispatchEvent(new Event("keyup"));

    // Not enough time has passed yet
    expect(global.fetch).not.toHaveBeenCalled();

    // Advance past the delay
    jest.advanceTimersByTime(300);
    await flushPromises();

    // Only one request should have been made (debounced)
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("'changed' modifier only fires if value changed", async () => {
    mockFetchJSON({ results: [] });

    document.body.innerHTML = `
      <input id="search" type="text" value="initial" xh-get="/api/search" xh-trigger="keyup changed">
    `;

    xhtmlx.process(document.body);

    const input = document.getElementById("search");

    // Fire keyup without changing value
    input.dispatchEvent(new Event("keyup"));
    await jest.runAllTimersAsync();
    // First keyup should fire because there's no previous value
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Fire keyup again without changing value
    input.dispatchEvent(new Event("keyup"));
    await jest.runAllTimersAsync();
    // Should not fire again because value hasn't changed
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Change value and fire keyup
    input.value = "new value";
    input.dispatchEvent(new Event("keyup"));
    await jest.runAllTimersAsync();
    // Should fire because value changed
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("'every' with milliseconds works", async () => {
    mockFetchJSON({ tick: true });

    document.body.innerHTML = `
      <div id="ticker" xh-get="/api/tick" xh-trigger="every 500ms">
        <template><span></span></template>
      </div>
    `;

    xhtmlx.process(document.body);

    expect(global.fetch).not.toHaveBeenCalled();

    jest.advanceTimersByTime(500);
    await flushPromises();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(500);
    await flushPromises();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("'throttle' modifier limits firing rate", async () => {
    mockFetchJSON({ data: true });

    document.body.innerHTML = `
      <button id="btn" xh-get="/api/action" xh-trigger="click throttle:1000ms">
        <template><span></span></template>
      </button>
    `;

    xhtmlx.process(document.body);

    const btn = document.getElementById("btn");

    // First click fires immediately
    btn.click();
    await flushPromises();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Clicks during throttle window are queued (only last one)
    btn.click();
    btn.click();
    await flushPromises();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // After throttle window, the pending click fires
    jest.advanceTimersByTime(1000);
    await flushPromises();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("'from:selector' listens on a different element", async () => {
    mockFetchJSON({ msg: "triggered" });

    document.body.innerHTML = `
      <button id="external-btn">Click me</button>
      <div id="target" xh-get="/api/data" xh-trigger="click from:#external-btn">
        <template><span class="result" xh-text="msg"></span></template>
      </div>
    `;

    xhtmlx.process(document.body);

    // Clicking the div itself should NOT trigger
    document.getElementById("target").click();
    await jest.runAllTimersAsync();
    expect(global.fetch).not.toHaveBeenCalled();

    // Clicking the external button should trigger
    document.getElementById("external-btn").click();
    await jest.runAllTimersAsync();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
