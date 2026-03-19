/**
 * @jest-environment jsdom
 */

const xhtmlx = require("../../xhtmlx.js");

function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

let rafCallbacks;

beforeEach(() => {
  document.body.innerHTML = "";
  global.fetch = jest.fn();
  xhtmlx.clearTemplateCache();

  rafCallbacks = [];
  global.requestAnimationFrame = fn => {
    rafCallbacks.push(fn);
    return rafCallbacks.length;
  };
  global._flushRAF = () => {
    var cbs = rafCallbacks.slice();
    rafCallbacks = [];
    cbs.forEach(fn => fn());
  };
});

afterEach(() => {
  delete global.fetch;
});

function mockFetchJSON(data, status) {
  status = status || 200;
  global.fetch.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status: status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data))
  });
}

describe("Settle classes integration flow", () => {
  test("after swap, new elements get xh-added class", async () => {
    mockFetchJSON({ title: "Test Title" });

    document.body.innerHTML = `
      <div id="trigger" xh-get="/api/data" xh-trigger="load" xh-target="#output">
        <template>
          <div class="card">
            <h2 class="title" xh-text="title"></h2>
          </div>
        </template>
      </div>
      <div id="output"></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    await flushPromises();

    var output = document.getElementById("output");
    var card = output.querySelector(".card");
    var title = output.querySelector(".title");

    expect(card).not.toBeNull();
    expect(title).not.toBeNull();
    expect(title.textContent).toBe("Test Title");

    // The output container and direct children should have xh-added
    // (nested descendants like title are excluded for performance)
    expect(output.classList.contains("xh-added")).toBe(true);
    expect(card.classList.contains("xh-added")).toBe(true);
    expect(title.classList.contains("xh-added")).toBe(false);
  });

  test("after two RAF cycles, xh-added replaced by xh-settled", async () => {
    mockFetchJSON({ message: "Hello" });

    document.body.innerHTML = `
      <div id="trigger" xh-get="/api/msg" xh-trigger="load" xh-target="#output">
        <template>
          <p class="msg" xh-text="message"></p>
        </template>
      </div>
      <div id="output"></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    await flushPromises();

    var output = document.getElementById("output");
    var msg = output.querySelector(".msg");

    // Initially has xh-added, not xh-settled
    expect(msg.classList.contains("xh-added")).toBe(true);
    expect(msg.classList.contains("xh-settled")).toBe(false);

    // Flush first RAF
    global._flushRAF();

    // After first rAF: still xh-added (the inner rAF was just queued)
    expect(msg.classList.contains("xh-added")).toBe(true);
    expect(msg.classList.contains("xh-settled")).toBe(false);

    // Flush second RAF
    global._flushRAF();

    // After second rAF: xh-added removed, xh-settled added
    expect(msg.classList.contains("xh-added")).toBe(false);
    expect(msg.classList.contains("xh-settled")).toBe(true);
  });

  test("settle classes applied to error template swaps", async () => {
    // First mock: the API call returns an error
    global.fetch.mockImplementation((url) => {
      if (url === "/api/failing") {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: () => Promise.resolve(JSON.stringify({ error: "Server down" }))
        });
      }
      // Error template fetch
      if (url === "/tpl/error.html") {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve('<div class="error-msg" xh-text="body.error"></div>')
        });
      }
      return Promise.reject(new Error("unexpected url: " + url));
    });

    document.body.innerHTML = `
      <div id="trigger" xh-get="/api/failing" xh-trigger="load"
           xh-target="#output" xh-error-template="/tpl/error.html">
        <template><p>success</p></template>
      </div>
      <div id="output"></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    await flushPromises();
    await flushPromises();

    var output = document.getElementById("output");
    var errorMsg = output.querySelector(".error-msg");

    // Error template should have been rendered with settle classes
    expect(errorMsg).not.toBeNull();
    expect(errorMsg.classList.contains("xh-added")).toBe(true);

    // Flush both RAF cycles
    global._flushRAF();
    global._flushRAF();

    expect(errorMsg.classList.contains("xh-added")).toBe(false);
    expect(errorMsg.classList.contains("xh-settled")).toBe(true);
  });

  test("settle classes applied with beforeend swap mode", async () => {
    mockFetchJSON({ item: "First" });

    document.body.innerHTML = `
      <div id="trigger" xh-get="/api/items" xh-trigger="load"
           xh-target="#list" xh-swap="beforeend">
        <template>
          <li class="list-item" xh-text="item"></li>
        </template>
      </div>
      <ul id="list">
        <li class="existing">Existing item</li>
      </ul>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    await flushPromises();

    var list = document.getElementById("list");
    var items = list.querySelectorAll("li");

    // Existing item should remain
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("Existing item");
    expect(items[1].textContent).toBe("First");

    // The target (list) gets xh-added since it is the processTarget for beforeend
    expect(list.classList.contains("xh-added")).toBe(true);

    // The new item should also have xh-added
    expect(items[1].classList.contains("xh-added")).toBe(true);

    // Flush both rAF cycles
    global._flushRAF();
    global._flushRAF();

    expect(list.classList.contains("xh-added")).toBe(false);
    expect(list.classList.contains("xh-settled")).toBe(true);
    expect(items[1].classList.contains("xh-added")).toBe(false);
    expect(items[1].classList.contains("xh-settled")).toBe(true);
  });

  test("applySettleClasses handles null processTarget gracefully", () => {
    var applySettleClasses = xhtmlx._internals.applySettleClasses;
    expect(() => applySettleClasses(null)).not.toThrow();
    expect(() => applySettleClasses(undefined)).not.toThrow();
  });
});
