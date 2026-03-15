/**
 * @jest-environment jsdom
 */

const xhtmlx = require('../../xhtmlx.js');
const { executeRequest, DataContext, elementStates, applySettleClasses } = xhtmlx._internals;

function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('CSS transitions on swap (settle classes)', () => {
  let container;
  let rafCallbacks;
  let originalRaf;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    global.fetch = jest.fn();
    xhtmlx.clearTemplateCache();

    // Mock requestAnimationFrame to control settle class timing
    rafCallbacks = [];
    originalRaf = global.requestAnimationFrame;
    global.requestAnimationFrame = function (cb) {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    };
  });

  afterEach(() => {
    document.body.removeChild(container);
    delete global.fetch;
    global.requestAnimationFrame = originalRaf;
  });

  function flushRaf() {
    var cbs = rafCallbacks.slice();
    rafCallbacks = [];
    for (var i = 0; i < cbs.length; i++) {
      cbs[i]();
    }
  }

  function mockFetchJSON(data, status) {
    status = status || 200;
    global.fetch.mockResolvedValue({
      ok: status >= 200 && status < 300,
      status: status,
      statusText: status === 200 ? 'OK' : 'Error',
      text: function () { return Promise.resolve(JSON.stringify(data)); }
    });
  }

  it('new elements get xh-added class after swap', async () => {
    mockFetchJSON({ title: 'Test' });

    var el = document.createElement('div');
    el.setAttribute('xh-get', '/api/data');
    el.setAttribute('xh-target', '#output');
    container.appendChild(el);

    var output = document.createElement('div');
    output.id = 'output';
    container.appendChild(output);

    // Add an inline template
    var tpl = document.createElement('template');
    tpl.innerHTML = '<p class="item">Hello</p>';
    el.appendChild(tpl);

    var state = { requestInFlight: false, intervalIds: [], observers: [] };
    elementStates.set(el, state);

    var ctx = new DataContext({});
    executeRequest(el, ctx, []);

    await flushPromises();
    await flushPromises();

    // After swap, elements should have xh-added class
    var item = output.querySelector('.item');
    expect(item).not.toBeNull();
    expect(item.classList.contains('xh-added')).toBe(true);
  });

  it('xh-added is replaced by xh-settled after animation frames', async () => {
    mockFetchJSON({ title: 'Test' });

    var el = document.createElement('div');
    el.setAttribute('xh-get', '/api/data');
    el.setAttribute('xh-target', '#output');
    container.appendChild(el);

    var output = document.createElement('div');
    output.id = 'output';
    container.appendChild(output);

    var tpl = document.createElement('template');
    tpl.innerHTML = '<p class="item">Hello</p>';
    el.appendChild(tpl);

    var state = { requestInFlight: false, intervalIds: [], observers: [] };
    elementStates.set(el, state);

    var ctx = new DataContext({});
    executeRequest(el, ctx, []);

    await flushPromises();
    await flushPromises();

    // Before rAF: should have xh-added
    var item = output.querySelector('.item');
    expect(item.classList.contains('xh-added')).toBe(true);
    expect(item.classList.contains('xh-settled')).toBe(false);

    // Flush first rAF
    flushRaf();

    // After first rAF: still no change (nested rAF)
    // The inner rAF hasn't fired yet
    expect(item.classList.contains('xh-added')).toBe(true);

    // Flush second rAF
    flushRaf();

    // After second rAF: xh-added should be removed, xh-settled should be added
    expect(item.classList.contains('xh-added')).toBe(false);
    expect(item.classList.contains('xh-settled')).toBe(true);
  });

  it('settle classes applied to innerHTML swap', async () => {
    mockFetchJSON({ msg: 'updated' });

    var el = document.createElement('div');
    el.setAttribute('xh-get', '/api/data');
    el.setAttribute('xh-target', '#output');
    el.setAttribute('xh-swap', 'innerHTML');
    container.appendChild(el);

    var output = document.createElement('div');
    output.id = 'output';
    output.innerHTML = '<span>old</span>';
    container.appendChild(output);

    var tpl = document.createElement('template');
    tpl.innerHTML = '<span class="new-content">new</span>';
    el.appendChild(tpl);

    var state = { requestInFlight: false, intervalIds: [], observers: [] };
    elementStates.set(el, state);

    var ctx = new DataContext({});
    executeRequest(el, ctx, []);

    await flushPromises();
    await flushPromises();

    var newContent = output.querySelector('.new-content');
    expect(newContent).not.toBeNull();
    expect(newContent.classList.contains('xh-added')).toBe(true);

    // Flush both rAF calls
    flushRaf();
    flushRaf();

    expect(newContent.classList.contains('xh-added')).toBe(false);
    expect(newContent.classList.contains('xh-settled')).toBe(true);
  });

  it('settle classes applied to outerHTML swap', async () => {
    mockFetchJSON({ msg: 'replaced' });

    var el = document.createElement('div');
    el.setAttribute('xh-get', '/api/data');
    el.setAttribute('xh-target', '#output');
    el.setAttribute('xh-swap', 'outerHTML');
    container.appendChild(el);

    var output = document.createElement('div');
    output.id = 'output';
    container.appendChild(output);

    var tpl = document.createElement('template');
    tpl.innerHTML = '<section class="replaced">new section</section>';
    el.appendChild(tpl);

    var state = { requestInFlight: false, intervalIds: [], observers: [] };
    elementStates.set(el, state);

    var ctx = new DataContext({});
    executeRequest(el, ctx, []);

    await flushPromises();
    await flushPromises();

    var replaced = container.querySelector('.replaced');
    expect(replaced).not.toBeNull();
    expect(replaced.classList.contains('xh-added')).toBe(true);

    flushRaf();
    flushRaf();

    expect(replaced.classList.contains('xh-added')).toBe(false);
    expect(replaced.classList.contains('xh-settled')).toBe(true);
  });

  it('applySettleClasses does nothing with null processTarget', () => {
    // Should not throw
    expect(function () {
      applySettleClasses(null);
    }).not.toThrow();
  });

  it('applySettleClasses handles element with no children', () => {
    var el = document.createElement('div');
    container.appendChild(el);

    applySettleClasses(el);

    expect(el.classList.contains('xh-added')).toBe(true);

    flushRaf();
    flushRaf();

    expect(el.classList.contains('xh-added')).toBe(false);
    expect(el.classList.contains('xh-settled')).toBe(true);
  });
});
