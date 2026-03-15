/**
 * @jest-environment jsdom
 */

const xhtmlx = require('../../xhtmlx.js');
const {
  DataContext,
  applyBindings,
  customDirectives,
  globalHooks,
  transforms,
  runHooks,
  registerDirective,
  registerHook,
  registerTransform,
} = xhtmlx._internals;

describe('Plugin / Extension API', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    // Clear plugin state between tests
    customDirectives.length = 0;
    for (var key in globalHooks) {
      delete globalHooks[key];
    }
    for (var tkey in transforms) {
      delete transforms[tkey];
    }
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('registerDirective', () => {
    it('adds a custom directive processed in applyBindings', () => {
      const handler = jest.fn();
      registerDirective('x-custom', handler);

      const el = document.createElement('div');
      el.setAttribute('x-custom', 'hello');
      container.appendChild(el);

      const ctx = new DataContext({ msg: 'world' });
      applyBindings(el, ctx);

      expect(handler).toHaveBeenCalledWith(el, 'hello', ctx);
    });

    it('custom directive receives element, value, and context', () => {
      let receivedEl, receivedVal, receivedCtx;
      registerDirective('x-fancy', function(el, val, ctx) {
        receivedEl = el;
        receivedVal = val;
        receivedCtx = ctx;
      });

      const el = document.createElement('span');
      el.setAttribute('x-fancy', 'testvalue');
      container.appendChild(el);

      const ctx = new DataContext({ foo: 'bar' });
      applyBindings(el, ctx);

      expect(receivedEl).toBe(el);
      expect(receivedVal).toBe('testvalue');
      expect(receivedCtx).toBe(ctx);
    });

    it('multiple custom directives are all processed', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      registerDirective('x-one', handler1);
      registerDirective('x-two', handler2);

      const el = document.createElement('div');
      el.setAttribute('x-one', 'a');
      el.setAttribute('x-two', 'b');
      container.appendChild(el);

      const ctx = new DataContext({});
      applyBindings(el, ctx);

      expect(handler1).toHaveBeenCalledWith(el, 'a', ctx);
      expect(handler2).toHaveBeenCalledWith(el, 'b', ctx);
    });

    it('directive handler is not called when attribute is absent', () => {
      const handler = jest.fn();
      registerDirective('x-missing', handler);

      const el = document.createElement('div');
      container.appendChild(el);

      const ctx = new DataContext({});
      applyBindings(el, ctx);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('registerHook', () => {
    it('registerHook("beforeRequest") can cancel requests', () => {
      registerHook('beforeRequest', function(_detail) {
        return false; // cancel
      });

      const result = runHooks('beforeRequest', {
        url: '/api/test', method: 'GET', headers: {}
      });

      expect(result).toBe(false);
    });

    it('registerHook("beforeRequest") can modify headers', () => {
      registerHook('beforeRequest', function(detail) {
        detail.headers['X-Custom'] = 'value123';
      });

      const headers = {};
      runHooks('beforeRequest', {
        url: '/api/test', method: 'GET', headers: headers
      });

      expect(headers['X-Custom']).toBe('value123');
    });

    it('multiple hooks run in order', () => {
      const order = [];
      registerHook('beforeRequest', function() { order.push(1); });
      registerHook('beforeRequest', function() { order.push(2); });
      registerHook('beforeRequest', function() { order.push(3); });

      runHooks('beforeRequest', {});

      expect(order).toEqual([1, 2, 3]);
    });

    it('hooks return true when no hooks are registered', () => {
      const result = runHooks('nonexistent', {});
      expect(result).toBe(true);
    });

    it('hooks stop on first false return', () => {
      const order = [];
      registerHook('beforeRequest', function() { order.push(1); });
      registerHook('beforeRequest', function() { order.push(2); return false; });
      registerHook('beforeRequest', function() { order.push(3); });

      const result = runHooks('beforeRequest', {});
      expect(result).toBe(false);
      expect(order).toEqual([1, 2]);
    });
  });

  describe('registerTransform', () => {
    it('adds a pipe transform to DataContext.resolve', () => {
      registerTransform('uppercase', function(val) {
        return typeof val === 'string' ? val.toUpperCase() : val;
      });

      const ctx = new DataContext({ name: 'alice' });
      const result = ctx.resolve('name | uppercase');

      expect(result).toBe('ALICE');
    });

    it('xh-text with transform pipe: "price | currency"', () => {
      registerTransform('currency', function(val) {
        return '$' + Number(val).toFixed(2);
      });

      const el = document.createElement('span');
      el.setAttribute('xh-text', 'price | currency');
      container.appendChild(el);

      const ctx = new DataContext({ price: 19.99 });
      applyBindings(el, ctx);

      expect(el.textContent).toBe('$19.99');
    });

    it('multiple transforms chained: "name | uppercase | trim"', () => {
      registerTransform('uppercase', function(val) {
        return typeof val === 'string' ? val.toUpperCase() : val;
      });
      registerTransform('trim', function(val) {
        return typeof val === 'string' ? val.trim() : val;
      });

      const ctx = new DataContext({ name: '  alice  ' });
      const result = ctx.resolve('name | uppercase | trim');

      expect(result).toBe('ALICE');
    });

    it('unknown transform is skipped (value passes through)', () => {
      const ctx = new DataContext({ name: 'alice' });
      const result = ctx.resolve('name | nonexistent');

      expect(result).toBe('alice');
    });

    it('transform works with numeric values', () => {
      registerTransform('double', function(val) {
        return val * 2;
      });

      const ctx = new DataContext({ count: 5 });
      const result = ctx.resolve('count | double');

      expect(result).toBe(10);
    });
  });

  describe('public API surface', () => {
    it('xhtmlx.directive is a function', () => {
      expect(typeof xhtmlx.directive).toBe('function');
    });

    it('xhtmlx.hook is a function', () => {
      expect(typeof xhtmlx.hook).toBe('function');
    });

    it('xhtmlx.transform is a function', () => {
      expect(typeof xhtmlx.transform).toBe('function');
    });
  });
});
