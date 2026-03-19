/**
 * @jest-environment jsdom
 */

/**
 * Comparison: List rendering
 *
 * xhtmlx: <li xh-each="items"><span xh-text="name"></span></li>
 * React:  items.map(item => createElement('li', null, createElement('span', null, item.name)))
 */

const { bench } = require('../bench-helper');
const xhtmlx = require('../../../xhtmlx.js');
const { DataContext, renderTemplate, performSwap } = xhtmlx._internals;
const { h, syncRender, syncUnmount } = require('./react-helper');

describe('vs React: List rendering', () => {
  let xhContainer, reactContainer;

  beforeEach(() => {
    xhContainer = document.createElement('div');
    reactContainer = document.createElement('div');
    document.body.appendChild(xhContainer);
    document.body.appendChild(reactContainer);
  });

  afterEach(() => {
    syncUnmount(reactContainer);
    xhContainer.remove();
    reactContainer.remove();
  });

  // --- 10 items ---

  test('[xhtmlx] list 10 items', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: i, name: `Item ${i}` }));
    const ctx = new DataContext({ items });
    const html = '<ul><li xh-each="items"><span xh-text="name"></span></li></ul>';
    bench('xhtmlx: list 10 items', 2000, () => {
      const frag = renderTemplate(html, ctx);
      performSwap(xhContainer, frag, 'innerHTML');
    });
  });

  test('[React]  list 10 items', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: i, name: `Item ${i}` }));
    bench('React:  list 10 items', 2000, () => {
      const tree = h('ul', null,
        items.map(item => h('li', { key: item.id }, h('span', null, item.name)))
      );
      syncRender(tree, reactContainer);
    });
  });

  // --- 50 items ---

  test('[xhtmlx] list 50 items', () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: i, name: `Item ${i}` }));
    const ctx = new DataContext({ items });
    const html = '<ul><li xh-each="items"><span xh-text="name"></span></li></ul>';
    bench('xhtmlx: list 50 items', 500, () => {
      const frag = renderTemplate(html, ctx);
      performSwap(xhContainer, frag, 'innerHTML');
    });
  });

  test('[React]  list 50 items', () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: i, name: `Item ${i}` }));
    bench('React:  list 50 items', 500, () => {
      const tree = h('ul', null,
        items.map(item => h('li', { key: item.id }, h('span', null, item.name)))
      );
      syncRender(tree, reactContainer);
    });
  });

  // --- 100 items ---

  test('[xhtmlx] list 100 items', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `Item ${i}` }));
    const ctx = new DataContext({ items });
    const html = '<ul><li xh-each="items"><span xh-text="name"></span></li></ul>';
    bench('xhtmlx: list 100 items', 200, () => {
      const frag = renderTemplate(html, ctx);
      performSwap(xhContainer, frag, 'innerHTML');
    });
  });

  test('[React]  list 100 items', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `Item ${i}` }));
    bench('React:  list 100 items', 200, () => {
      const tree = h('ul', null,
        items.map(item => h('li', { key: item.id }, h('span', null, item.name)))
      );
      syncRender(tree, reactContainer);
    });
  });

  // --- 500 items ---

  test('[xhtmlx] list 500 items', () => {
    const items = Array.from({ length: 500 }, (_, i) => ({ id: i, name: `Item ${i}` }));
    const ctx = new DataContext({ items });
    const html = '<ul><li xh-each="items"><span xh-text="name"></span></li></ul>';
    bench('xhtmlx: list 500 items', 50, () => {
      const frag = renderTemplate(html, ctx);
      performSwap(xhContainer, frag, 'innerHTML');
    });
  });

  test('[React]  list 500 items', () => {
    const items = Array.from({ length: 500 }, (_, i) => ({ id: i, name: `Item ${i}` }));
    bench('React:  list 500 items', 50, () => {
      const tree = h('ul', null,
        items.map(item => h('li', { key: item.id }, h('span', null, item.name)))
      );
      syncRender(tree, reactContainer);
    });
  });

  // --- 1000 items ---

  test('[xhtmlx] list 1000 items', () => {
    const items = Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `Item ${i}` }));
    const ctx = new DataContext({ items });
    const html = '<ul><li xh-each="items"><span xh-text="name"></span></li></ul>';
    bench('xhtmlx: list 1000 items', 20, () => {
      const frag = renderTemplate(html, ctx);
      performSwap(xhContainer, frag, 'innerHTML');
    });
  });

  test('[React]  list 1000 items', () => {
    const items = Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `Item ${i}` }));
    bench('React:  list 1000 items', 20, () => {
      const tree = h('ul', null,
        items.map(item => h('li', { key: item.id }, h('span', null, item.name)))
      );
      syncRender(tree, reactContainer);
    });
  });
});
