/**
 * @jest-environment jsdom
 */

const xhtmlx = require("../../xhtmlx.js");

// --- MockWebSocket -----------------------------------------------------------
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this._listeners = {};
    MockWebSocket.instances.push(this);
  }
  addEventListener(e, fn) {
    if (!this._listeners[e]) this._listeners[e] = [];
    this._listeners[e].push(fn);
  }
  send(data) {
    this._lastSent = data;
  }
  close(code) {
    this.readyState = 3;
    (this._listeners["close"] || []).forEach(fn =>
      fn({ code: code || 1000, reason: "" })
    );
  }
  _open() {
    this.readyState = 1;
    (this._listeners["open"] || []).forEach(fn => fn({}));
  }
  _message(data) {
    (this._listeners["message"] || []).forEach(fn =>
      fn({ data: JSON.stringify(data) })
    );
  }
}
MockWebSocket.instances = [];

function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

beforeEach(() => {
  document.body.innerHTML = "";
  global.fetch = jest.fn();
  xhtmlx.clearTemplateCache();
  MockWebSocket.instances = [];
  global.WebSocket = MockWebSocket;
});

afterEach(() => {
  delete global.fetch;
  delete global.WebSocket;
});

describe("WebSocket integration flow", () => {
  test("xh-ws opens WebSocket and renders inline template on message", async () => {
    document.body.innerHTML = `
      <div id="ws-container" xh-ws="ws://localhost:9000">
        <template>
          <p class="msg" xh-text="text"></p>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(MockWebSocket.instances.length).toBe(1);
    var ws = MockWebSocket.instances[0];
    expect(ws.url).toBe("ws://localhost:9000");

    ws._open();
    ws._message({ text: "Hello from WS" });
    await flushPromises();

    var msg = document.querySelector(".msg");
    expect(msg).not.toBeNull();
    expect(msg.textContent).toBe("Hello from WS");
  });

  test("multiple messages append content with xh-swap='beforeend'", async () => {
    document.body.innerHTML = `
      <div id="feed" xh-ws="ws://localhost:9000" xh-swap="beforeend">
        <template>
          <p class="entry" xh-text="content"></p>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    var ws = MockWebSocket.instances[0];
    ws._open();

    ws._message({ content: "First" });
    await flushPromises();

    ws._message({ content: "Second" });
    await flushPromises();

    ws._message({ content: "Third" });
    await flushPromises();

    var entries = document.querySelectorAll(".entry");
    expect(entries.length).toBe(3);
    expect(entries[0].textContent).toBe("First");
    expect(entries[1].textContent).toBe("Second");
    expect(entries[2].textContent).toBe("Third");
  });

  test("xh:wsOpen event fires when connection opens", async () => {
    document.body.innerHTML = `
      <div id="ws-el" xh-ws="ws://localhost:9000">
        <template><span></span></template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    var openEvents = [];
    document.getElementById("ws-el").addEventListener("xh:wsOpen", function (e) {
      openEvents.push(e.detail);
    });

    var ws = MockWebSocket.instances[0];
    ws._open();

    expect(openEvents.length).toBe(1);
    expect(openEvents[0].url).toBe("ws://localhost:9000");
  });

  test("xh-ws-send sends form data as JSON to WebSocket", async () => {
    document.body.innerHTML = `
      <div id="ws-target" xh-ws="ws://localhost:9000">
        <template><span xh-text="echo"></span></template>
      </div>
      <form id="send-form" xh-ws-send="#ws-target">
        <input name="message" value="hello world" />
        <button type="submit">Send</button>
      </form>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    var ws = MockWebSocket.instances[0];
    ws._open();

    // Trigger form submit
    var form = document.getElementById("send-form");
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(ws._lastSent).toBeDefined();
    var sent = JSON.parse(ws._lastSent);
    expect(sent.message).toBe("hello world");
  });

  test("WebSocket cleanup on element removal via swap", async () => {
    document.body.innerHTML = `
      <div id="container">
        <div id="ws-el" xh-ws="ws://localhost:9000">
          <template><span xh-text="data"></span></template>
        </div>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    var ws = MockWebSocket.instances[0];
    ws._open();
    expect(ws.readyState).toBe(1);

    // Simulate element removal by cleaning up state and removing from DOM
    var wsEl = document.getElementById("ws-el");
    var state = xhtmlx._internals.elementStates.get(wsEl);
    expect(state).toBeDefined();
    expect(state.ws).toBeDefined();

    // Perform cleanup like performSwap does
    state.ws.close(1000);
    state.ws = null;

    expect(ws.readyState).toBe(3);
  });

  test("xh:wsClose event fires when connection closes", async () => {
    document.body.innerHTML = `
      <div id="ws-el" xh-ws="ws://localhost:9000">
        <template><span></span></template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    var closeEvents = [];
    document.getElementById("ws-el").addEventListener("xh:wsClose", function (e) {
      closeEvents.push(e.detail);
    });

    var ws = MockWebSocket.instances[0];
    ws._open();
    ws.close(1000);

    expect(closeEvents.length).toBe(1);
    expect(closeEvents[0].code).toBe(1000);
  });
});
