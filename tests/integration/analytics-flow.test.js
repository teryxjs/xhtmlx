/**
 * @jest-environment jsdom
 */

const xhtmlx = require("../../xhtmlx.js");
const {
  analyticsHandlers,
  DataContext,
  config,
  elementStates,
} = xhtmlx._internals;

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function mockFetchJSON(data) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

beforeEach(() => {
  analyticsHandlers.length = 0;
  document.body.innerHTML = "";
  config.trackRequests = false;
  config.debug = false;
  jest.restoreAllMocks();
});

describe("Analytics integration flow", () => {
  test("xh-track on buttons inside xh-each fires per-item events", async () => {
    var handler = jest.fn();
    xhtmlx.analytics(handler);
    mockFetchJSON({
      products: [
        { id: "A", name: "Alpha" },
        { id: "B", name: "Beta" },
      ],
    });

    document.body.innerHTML = `
      <div xh-get="/api/products" xh-trigger="load" xh-target="#list">
        <template>
          <ul id="list">
            <li xh-each="products">
              <span xh-text="name"></span>
              <button class="buy-btn" xh-track="buy_clicked"
                      xh-track-vals='{"product_id":"{{id}}"}'>Buy</button>
            </li>
          </ul>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    var buttons = document.querySelectorAll(".buy-btn");
    expect(buttons.length).toBe(2);

    buttons[0].click();
    expect(handler).toHaveBeenCalledWith("buy_clicked", {
      element: "button",
      product_id: "A",
    });

    buttons[1].click();
    expect(handler).toHaveBeenCalledWith("buy_clicked", {
      element: "button",
      product_id: "B",
    });
  });

  test("multiple analytics handlers all receive events", async () => {
    var h1 = jest.fn();
    var h2 = jest.fn();
    xhtmlx.analytics(h1);
    xhtmlx.analytics(h2);

    document.body.innerHTML =
      '<button id="btn" xh-track="multi_test">Go</button>';
    xhtmlx.process(document.body);

    document.getElementById("btn").click();

    expect(h1).toHaveBeenCalledWith("multi_test", { element: "button" });
    expect(h2).toHaveBeenCalledWith("multi_test", { element: "button" });
  });

  test("xh-track with REST request: both track and request events fire", async () => {
    config.trackRequests = true;
    var handler = jest.fn();
    xhtmlx.analytics(handler);
    mockFetchJSON({ ok: true });

    document.body.innerHTML = `
      <button xh-get="/api/action" xh-trigger="click" xh-track="action_btn">
        <template><span>done</span></template>
      </button>
    `;

    xhtmlx.process(document.body);
    document.querySelector("button").click();
    await flushPromises();

    var eventNames = handler.mock.calls.map((c) => c[0]);
    expect(eventNames).toContain("action_btn");
    expect(eventNames).toContain("xh:request");
  });

  test("xh:track DOM event bubbles up for delegation", async () => {
    var handler = jest.fn();
    xhtmlx.analytics(handler);

    var captured = [];
    document.body.addEventListener("xh:track", function (e) {
      captured.push(e.detail);
    });

    document.body.innerHTML =
      '<div><button id="t" xh-track="bubble_test">X</button></div>';
    xhtmlx.process(document.body);
    document.getElementById("t").click();

    expect(captured.length).toBe(1);
    expect(captured[0].event).toBe("bubble_test");
  });

  test("auto request tracking captures error status", async () => {
    config.trackRequests = true;
    var handler = jest.fn();
    xhtmlx.analytics(handler);

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.resolve('{"error":"fail"}'),
    });

    document.body.innerHTML = `
      <div xh-get="/api/fail" xh-trigger="load">
        <template><span>ok</span></template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    var reqCall = handler.mock.calls.find((c) => c[0] === "xh:request");
    expect(reqCall).toBeTruthy();
    expect(reqCall[1].status).toBe(500);
    expect(reqCall[1].method).toBe("GET");
  });
});
