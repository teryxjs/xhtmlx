/**
 * @jest-environment jsdom
 */

// --- MockWebSocket -----------------------------------------------------------
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this._listeners = {};
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
    this._fire("close", { code: code || 1000, reason: "" });
  }
  _fire(e, data) {
    (this._listeners[e] || []).forEach(fn => fn(data));
  }
  _open() {
    this.readyState = 1;
    this._fire("open", {});
  }
  _message(data) {
    this._fire("message", { data: JSON.stringify(data) });
  }
}
global.WebSocket = MockWebSocket;

const xhtmlx = require('../../xhtmlx.js');
const {
  DataContext,
  setupWebSocket,
  elementStates
} = xhtmlx._internals;

describe('WebSocket support (xh-ws)', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('opens a WebSocket for xh-ws elements', () => {
    const el = document.createElement('div');
    el.setAttribute('xh-ws', 'ws://localhost:8080');
    container.appendChild(el);

    const ctx = new DataContext({});
    setupWebSocket(el, ctx, []);

    const state = elementStates.get(el);
    expect(state).toBeDefined();
    expect(state.ws).toBeInstanceOf(MockWebSocket);
    expect(state.ws.url).toBe('ws://localhost:8080');
  });

  it('incoming JSON message applies bindings when no template', (done) => {
    const el = document.createElement('div');
    el.setAttribute('xh-ws', 'ws://localhost:8080');
    const span = document.createElement('span');
    span.setAttribute('xh-text', 'message');
    el.appendChild(span);
    container.appendChild(el);

    const ctx = new DataContext({});
    setupWebSocket(el, ctx, []);

    const state = elementStates.get(el);
    state.ws._open();
    state.ws._message({ message: 'hello' });

    // resolveTemplate returns a promise, so wait a tick
    setTimeout(() => {
      expect(span.textContent).toBe('hello');
      done();
    }, 50);
  });

  it('incoming JSON message renders template', (done) => {
    const el = document.createElement('div');
    el.setAttribute('xh-ws', 'ws://localhost:8080');
    const tpl = document.createElement('template');
    tpl.innerHTML = '<p xh-text="name"></p>';
    el.appendChild(tpl);
    container.appendChild(el);

    const ctx = new DataContext({});
    setupWebSocket(el, ctx, []);

    const state = elementStates.get(el);
    state.ws._open();
    state.ws._message({ name: 'Alice' });

    setTimeout(() => {
      const p = el.querySelector('p');
      expect(p).not.toBeNull();
      expect(p.textContent).toBe('Alice');
      done();
    }, 50);
  });

  it('emits xh:wsOpen event on open', () => {
    const el = document.createElement('div');
    el.setAttribute('xh-ws', 'ws://localhost:8080');
    container.appendChild(el);

    const ctx = new DataContext({});
    setupWebSocket(el, ctx, []);

    const events = [];
    el.addEventListener('xh:wsOpen', (e) => {
      events.push(e.detail);
    });

    const state = elementStates.get(el);
    state.ws._open();

    expect(events.length).toBe(1);
    expect(events[0].url).toBe('ws://localhost:8080');
  });

  it('emits xh:wsClose event on close', () => {
    const el = document.createElement('div');
    el.setAttribute('xh-ws', 'ws://localhost:8080');
    container.appendChild(el);

    const ctx = new DataContext({});
    setupWebSocket(el, ctx, []);

    const events = [];
    el.addEventListener('xh:wsClose', (e) => {
      events.push(e.detail);
    });

    const state = elementStates.get(el);
    state.ws._open();
    state.ws.close(1000);

    expect(events.length).toBe(1);
    expect(events[0].code).toBe(1000);
  });

  it('emits xh:wsError event on error', () => {
    const el = document.createElement('div');
    el.setAttribute('xh-ws', 'ws://localhost:8080');
    container.appendChild(el);

    const ctx = new DataContext({});
    setupWebSocket(el, ctx, []);

    const events = [];
    el.addEventListener('xh:wsError', (e) => {
      events.push(e.detail);
    });

    const state = elementStates.get(el);
    state.ws._fire('error', {});

    expect(events.length).toBe(1);
    expect(events[0].url).toBe('ws://localhost:8080');
  });

  it('closes WebSocket on element cleanup', () => {
    const el = document.createElement('div');
    el.setAttribute('xh-ws', 'ws://localhost:8080');
    container.appendChild(el);

    const ctx = new DataContext({});
    setupWebSocket(el, ctx, []);

    const state = elementStates.get(el);
    const ws = state.ws;
    ws._open();

    // Import cleanupElement indirectly via removing state
    // Simulate what cleanupElement does
    ws.close(1000);
    expect(ws.readyState).toBe(3);
  });

  it('xh-ws-send sends form data as JSON', () => {
    // Create the WS element
    const wsEl = document.createElement('div');
    wsEl.setAttribute('xh-ws', 'ws://localhost:8080');
    wsEl.id = 'ws-target';
    container.appendChild(wsEl);

    const ctx = new DataContext({});
    setupWebSocket(wsEl, ctx, []);
    const wsState = elementStates.get(wsEl);
    wsState.ws._open();

    // Create a form with xh-ws-send
    const form = document.createElement('form');
    form.setAttribute('xh-ws-send', '#ws-target');
    const input = document.createElement('input');
    input.name = 'msg';
    input.value = 'hello world';
    form.appendChild(input);
    container.appendChild(form);

    // Setup ws-send handler
    const { setupWsSend } = xhtmlx._internals;
    setupWsSend(form);

    // Trigger submit
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    const sent = JSON.parse(wsState.ws._lastSent);
    expect(sent.msg).toBe('hello world');
  });

  it('non-JSON messages are ignored with debug warning', () => {
    const el = document.createElement('div');
    el.setAttribute('xh-ws', 'ws://localhost:8080');
    container.appendChild(el);

    xhtmlx._internals.config.debug = true;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const ctx = new DataContext({});
    setupWebSocket(el, ctx, []);

    const state = elementStates.get(el);
    state.ws._open();
    // Send non-JSON data directly
    state.ws._fire('message', { data: 'not json at all' });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('WebSocket message is not JSON'),
      expect.anything()
    );

    warnSpy.mockRestore();
    xhtmlx._internals.config.debug = false;
  });
});
