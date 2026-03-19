/**
 * @jest-environment jsdom
 */

const { bench } = require('./bench-helper');
const xhtmlx = require('../../xhtmlx.js');
const { DataContext, applyBindings } = xhtmlx._internals;

describe('Benchmark: Bindings (applyBindings)', () => {
  test('xh-text binding', () => {
    const ctx = new DataContext({ name: 'Alice' });
    const el = document.createElement('span');
    el.setAttribute('xh-text', 'name');
    bench('applyBindings xh-text', 100000, () => {
      applyBindings(el, ctx);
    });
  });

  test('xh-html binding', () => {
    const ctx = new DataContext({ content: '<b>bold</b>' });
    const el = document.createElement('div');
    el.setAttribute('xh-html', 'content');
    bench('applyBindings xh-html', 100000, () => {
      applyBindings(el, ctx);
    });
  });

  test('xh-attr-* binding (single)', () => {
    const ctx = new DataContext({ url: '/img/a.png' });
    const el = document.createElement('img');
    el.setAttribute('xh-attr-src', 'url');
    bench('applyBindings xh-attr-src', 100000, () => {
      applyBindings(el, ctx);
    });
  });

  test('xh-attr-* binding (multiple attrs)', () => {
    const ctx = new DataContext({ url: '/img/a.png', alt: 'Avatar', id: '123' });
    const el = document.createElement('img');
    el.setAttribute('xh-attr-src', 'url');
    el.setAttribute('xh-attr-alt', 'alt');
    el.setAttribute('xh-attr-data-id', 'id');
    bench('applyBindings xh-attr (3 attrs)', 50000, () => {
      applyBindings(el, ctx);
    });
  });

  test('xh-class-* binding (single)', () => {
    const ctx = new DataContext({ active: true });
    const el = document.createElement('div');
    el.setAttribute('xh-class-active', 'active');
    bench('applyBindings xh-class (truthy)', 100000, () => {
      applyBindings(el, ctx);
    });
  });

  test('xh-class-* binding (toggle)', () => {
    const ctxTrue = new DataContext({ active: true });
    const ctxFalse = new DataContext({ active: false });
    const el = document.createElement('div');
    el.setAttribute('xh-class-active', 'active');
    let toggle = true;
    bench('applyBindings xh-class (toggle)', 100000, () => {
      applyBindings(el, toggle ? ctxTrue : ctxFalse);
      toggle = !toggle;
    });
  });

  test('xh-if — true (keeps element)', () => {
    const ctx = new DataContext({ show: true });
    // xh-if needs the element in a parent to work with removal
    bench('applyBindings xh-if (true)', 100000, () => {
      const el = document.createElement('div');
      el.setAttribute('xh-if', 'show');
      const parent = document.createElement('div');
      parent.appendChild(el);
      applyBindings(el, ctx);
    });
  });

  test('xh-show binding', () => {
    const ctx = new DataContext({ visible: true });
    const el = document.createElement('div');
    el.setAttribute('xh-show', 'visible');
    bench('applyBindings xh-show', 100000, () => {
      applyBindings(el, ctx);
    });
  });

  test('combined: xh-text + xh-attr + xh-class', () => {
    const ctx = new DataContext({ name: 'Alice', url: '/a.png', active: true });
    const el = document.createElement('div');
    el.setAttribute('xh-text', 'name');
    el.setAttribute('xh-attr-data-url', 'url');
    el.setAttribute('xh-class-active', 'active');
    bench('applyBindings combined (3 types)', 50000, () => {
      applyBindings(el, ctx);
    });
  });

  test('element with no xh-* attributes (noop path)', () => {
    const ctx = new DataContext({ name: 'Alice' });
    const el = document.createElement('div');
    bench('applyBindings (no attrs — noop)', 200000, () => {
      applyBindings(el, ctx);
    });
  });
});
