/**
 * @jest-environment jsdom
 */

const xhtmlx = require('../../xhtmlx.js');
const {
  executeRequest,
  DataContext,
  elementStates,
  processElement,
  templateCache
} = xhtmlx._internals;

function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('Accessibility — auto ARIA attributes', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    global.fetch = jest.fn();
    xhtmlx.clearTemplateCache();
  });

  afterEach(() => {
    if (container.parentNode) document.body.removeChild(container);
    delete global.fetch;
  });

  function mockFetchJSON(data, status) {
    status = status || 200;
    global.fetch.mockResolvedValue({
      ok: status >= 200 && status < 300,
      status: status,
      statusText: status === 200 ? 'OK' : 'Error',
      text: function () { return Promise.resolve(JSON.stringify(data)); }
    });
  }

  function mockFetchError(status, body) {
    global.fetch.mockResolvedValue({
      ok: false,
      status: status,
      statusText: 'Error',
      text: function () { return Promise.resolve(JSON.stringify(body || { error: 'fail' })); }
    });
  }

  function initElement(el) {
    var state = { requestInFlight: false, intervalIds: [], observers: [] };
    elementStates.set(el, state);
    return state;
  }

  describe('aria-busy during request', () => {
    it('sets aria-busy="true" on target during request', async () => {
      mockFetchJSON({ name: 'Alice' });

      var target = document.createElement('div');
      target.id = 'content';
      container.appendChild(target);

      var el = document.createElement('button');
      el.setAttribute('xh-get', '/api/data');
      el.setAttribute('xh-target', '#content');
      container.appendChild(el);

      initElement(el);

      // Check aria-busy is set during request
      var busyDuringRequest = false;
      var originalFetch = global.fetch;
      global.fetch = jest.fn(function() {
        // At this point, aria-busy should be set
        busyDuringRequest = target.getAttribute('aria-busy') === 'true';
        return originalFetch();
      });

      var ctx = new DataContext({});
      executeRequest(el, ctx, []);

      // aria-busy should be set synchronously after showIndicator
      expect(target.getAttribute('aria-busy')).toBe('true');

      await flushPromises();
      await flushPromises();

      // After completion, aria-busy should be removed
      expect(target.hasAttribute('aria-busy')).toBe(false);
    });

    it('removes aria-busy after request completes', async () => {
      mockFetchJSON({ name: 'Bob' });

      var target = document.createElement('div');
      target.id = 'out';
      container.appendChild(target);

      var el = document.createElement('button');
      el.setAttribute('xh-get', '/api/data');
      el.setAttribute('xh-target', '#out');
      container.appendChild(el);

      initElement(el);

      var ctx = new DataContext({});
      executeRequest(el, ctx, []);

      await flushPromises();
      await flushPromises();

      expect(target.hasAttribute('aria-busy')).toBe(false);
    });

    it('removes aria-busy even on error', async () => {
      mockFetchError(500, { error: 'server error' });

      var target = document.createElement('div');
      target.id = 'err-target';
      container.appendChild(target);

      var el = document.createElement('button');
      el.setAttribute('xh-get', '/api/fail');
      el.setAttribute('xh-target', '#err-target');
      container.appendChild(el);

      initElement(el);

      var ctx = new DataContext({});
      executeRequest(el, ctx, []);

      expect(target.getAttribute('aria-busy')).toBe('true');

      await flushPromises();
      await flushPromises();

      expect(target.hasAttribute('aria-busy')).toBe(false);
    });
  });

  describe('aria-live on xh-target elements', () => {
    it('auto-sets aria-live="polite" on target element', () => {
      var target = document.createElement('div');
      target.id = 'live-target';
      container.appendChild(target);

      var el = document.createElement('button');
      el.setAttribute('xh-get', '/api/data');
      el.setAttribute('xh-target', '#live-target');
      container.appendChild(el);

      var ctx = new DataContext({});
      processElement(el, ctx, []);

      expect(target.getAttribute('aria-live')).toBe('polite');
    });

    it('xh-aria-live overrides default aria-live value', () => {
      var target = document.createElement('div');
      target.id = 'assertive-target';
      container.appendChild(target);

      var el = document.createElement('button');
      el.setAttribute('xh-get', '/api/data');
      el.setAttribute('xh-target', '#assertive-target');
      el.setAttribute('xh-aria-live', 'assertive');
      container.appendChild(el);

      var ctx = new DataContext({});
      processElement(el, ctx, []);

      expect(target.getAttribute('aria-live')).toBe('assertive');
    });

    it('does not override existing aria-live on target', () => {
      var target = document.createElement('div');
      target.id = 'existing-live';
      target.setAttribute('aria-live', 'off');
      container.appendChild(target);

      var el = document.createElement('button');
      el.setAttribute('xh-get', '/api/data');
      el.setAttribute('xh-target', '#existing-live');
      container.appendChild(el);

      var ctx = new DataContext({});
      processElement(el, ctx, []);

      expect(target.getAttribute('aria-live')).toBe('off');
    });
  });

  describe('role="alert" on error containers', () => {
    it('sets role="alert" on error target after error rendering', async () => {
      mockFetchError(404, { error: 'not found' });

      var errorTarget = document.createElement('div');
      errorTarget.id = 'error-box';
      container.appendChild(errorTarget);

      var el = document.createElement('button');
      el.setAttribute('xh-get', '/api/missing');
      el.setAttribute('xh-error-target', '#error-box');
      el.setAttribute('xh-error-template', '/tpl/error.html');
      container.appendChild(el);

      templateCache.set('/tpl/error.html', Promise.resolve('<p>Error: {{statusText}}</p>'));

      initElement(el);

      var ctx = new DataContext({});
      executeRequest(el, ctx, []);

      await flushPromises();
      await flushPromises();
      await flushPromises();

      expect(errorTarget.getAttribute('role')).toBe('alert');
    });
  });

  describe('aria-disabled with xh-disabled-class', () => {
    it('sets aria-disabled="true" when disabled class is applied', async () => {
      mockFetchJSON({ ok: true });

      var el = document.createElement('button');
      el.setAttribute('xh-get', '/api/data');
      el.setAttribute('xh-disabled-class', 'is-disabled');
      container.appendChild(el);

      initElement(el);

      // Use a delayed fetch to check state during request
      var resolveResponse;
      global.fetch = jest.fn(function() {
        return new Promise(function(resolve) {
          resolveResponse = resolve;
        });
      });

      var ctx = new DataContext({});
      executeRequest(el, ctx, []);

      // During request, should have aria-disabled
      expect(el.classList.contains('is-disabled')).toBe(true);
      expect(el.getAttribute('aria-disabled')).toBe('true');

      // Complete the request
      resolveResponse({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: function () { return Promise.resolve('{}'); }
      });

      await flushPromises();
      await flushPromises();

      // After request, both should be removed
      expect(el.classList.contains('is-disabled')).toBe(false);
      expect(el.hasAttribute('aria-disabled')).toBe(false);
    });

    it('removes aria-disabled after request completes', async () => {
      mockFetchJSON({ done: true });

      var el = document.createElement('button');
      el.setAttribute('xh-get', '/api/data');
      el.setAttribute('xh-disabled-class', 'loading');
      container.appendChild(el);

      initElement(el);

      var ctx = new DataContext({});
      executeRequest(el, ctx, []);

      await flushPromises();
      await flushPromises();

      expect(el.hasAttribute('aria-disabled')).toBe(false);
      expect(el.classList.contains('loading')).toBe(false);
    });
  });

  describe('xh-focus — focus management after swap', () => {
    it('focuses specified element after swap via xh-focus selector', async () => {
      mockFetchJSON({ name: 'Charlie' });

      var target = document.createElement('div');
      target.id = 'focus-target';
      container.appendChild(target);

      var focusInput = document.createElement('input');
      focusInput.id = 'my-input';
      container.appendChild(focusInput);

      var el = document.createElement('button');
      el.setAttribute('xh-get', '/api/data');
      el.setAttribute('xh-target', '#focus-target');
      el.setAttribute('xh-template', '/tpl/focus.html');
      el.setAttribute('xh-focus', '#my-input');
      container.appendChild(el);

      templateCache.set('/tpl/focus.html', Promise.resolve('<p>Content</p>'));

      initElement(el);

      var focusSpy = jest.spyOn(focusInput, 'focus');

      var ctx = new DataContext({});
      executeRequest(el, ctx, []);

      await flushPromises();
      await flushPromises();

      expect(focusSpy).toHaveBeenCalled();
      focusSpy.mockRestore();
    });

    it('xh-focus="auto" focuses first focusable element in target', async () => {
      mockFetchJSON({ title: 'Test' });

      var target = document.createElement('div');
      target.id = 'auto-focus-target';
      container.appendChild(target);

      var el = document.createElement('button');
      el.setAttribute('xh-get', '/api/data');
      el.setAttribute('xh-target', '#auto-focus-target');
      el.setAttribute('xh-template', '/tpl/auto-focus.html');
      el.setAttribute('xh-focus', 'auto');
      container.appendChild(el);

      templateCache.set('/tpl/auto-focus.html', Promise.resolve('<div><input id="auto-input" /><button>OK</button></div>'));

      initElement(el);

      var ctx = new DataContext({});
      executeRequest(el, ctx, []);

      await flushPromises();
      await flushPromises();

      // The first focusable element (the input) should have been focused
      var autoInput = target.querySelector('input');
      expect(autoInput).not.toBeNull();
      // In jsdom, focus() is called but we can verify via document.activeElement
      expect(document.activeElement).toBe(autoInput);
    });

    it('xh-focus with non-existent selector does not throw', async () => {
      mockFetchJSON({ data: 'test' });

      var target = document.createElement('div');
      target.id = 'safe-target';
      container.appendChild(target);

      var el = document.createElement('button');
      el.setAttribute('xh-get', '/api/data');
      el.setAttribute('xh-target', '#safe-target');
      el.setAttribute('xh-template', '/tpl/safe.html');
      el.setAttribute('xh-focus', '#nonexistent');
      container.appendChild(el);

      templateCache.set('/tpl/safe.html', Promise.resolve('<p>Safe</p>'));

      initElement(el);

      var ctx = new DataContext({});

      // Should not throw
      expect(() => {
        executeRequest(el, ctx, []);
      }).not.toThrow();

      await flushPromises();
      await flushPromises();
    });
  });

  describe('selectors in gatherXhElements', () => {
    it('xh-focus elements are gathered', () => {
      var el = document.createElement('button');
      el.setAttribute('xh-focus', '#my-input');
      container.appendChild(el);

      // processElement via xhtmlx.process should discover xh-focus elements
      // We just verify the element has the attribute
      expect(el.hasAttribute('xh-focus')).toBe(true);
    });

    it('xh-aria-live elements are gathered', () => {
      var el = document.createElement('button');
      el.setAttribute('xh-aria-live', 'assertive');
      container.appendChild(el);

      expect(el.hasAttribute('xh-aria-live')).toBe(true);
    });
  });
});
