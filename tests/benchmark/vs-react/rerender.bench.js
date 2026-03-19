/**
 * @jest-environment jsdom
 */

/**
 * Comparison: Re-rendering with updated data (simulating state changes)
 *
 * xhtmlx: renderTemplate + performSwap (full re-render)
 * React:  syncRender with new data (virtual DOM diff + patch)
 */

const { bench } = require('../bench-helper');
const xhtmlx = require('../../../xhtmlx.js');
const { DataContext, renderTemplate, performSwap } = xhtmlx._internals;
const { h, syncRender, syncUnmount } = require('./react-helper');

describe('vs React: Re-rendering (data updates)', () => {
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

  test('[xhtmlx] counter update (single field change)', () => {
    const html = '<div><span xh-text="count"></span></div>';
    let i = 0;
    bench('xhtmlx: counter update', 10000, () => {
      const ctx = new DataContext({ count: i++ });
      const frag = renderTemplate(html, ctx);
      performSwap(xhContainer, frag, 'innerHTML');
    });
  });

  test('[React]  counter update (single field change)', () => {
    let i = 0;
    bench('React:  counter update', 10000, () => {
      syncRender(h('div', null, h('span', null, i++)), reactContainer);
    });
  });

  test('[xhtmlx] multi-field update (5 fields change)', () => {
    const html = `
      <div>
        <span xh-text="a"></span>
        <span xh-text="b"></span>
        <span xh-text="c"></span>
        <span xh-text="d"></span>
        <span xh-text="e"></span>
      </div>`;
    let i = 0;
    bench('xhtmlx: 5-field update', 5000, () => {
      const ctx = new DataContext({ a: i, b: i+1, c: i+2, d: i+3, e: i+4 });
      const frag = renderTemplate(html, ctx);
      performSwap(xhContainer, frag, 'innerHTML');
      i++;
    });
  });

  test('[React]  multi-field update (5 fields change)', () => {
    let i = 0;
    bench('React:  5-field update', 5000, () => {
      syncRender(
        h('div', null,
          h('span', null, i),
          h('span', null, i+1),
          h('span', null, i+2),
          h('span', null, i+3),
          h('span', null, i+4)
        ),
        reactContainer
      );
      i++;
    });
  });

  test('[xhtmlx] list update (swap 50-item list with new data)', () => {
    const html = '<ul><li xh-each="items"><span xh-text="name"></span></li></ul>';
    let i = 0;
    bench('xhtmlx: list 50 update', 100, () => {
      const items = Array.from({ length: 50 }, (_, j) => ({ id: j, name: `Item ${i}-${j}` }));
      const ctx = new DataContext({ items });
      const frag = renderTemplate(html, ctx);
      performSwap(xhContainer, frag, 'innerHTML');
      i++;
    });
  });

  test('[React]  list update (render 50-item list with new data)', () => {
    let i = 0;
    bench('React:  list 50 update', 100, () => {
      const items = Array.from({ length: 50 }, (_, j) => ({ id: j, name: `Item ${i}-${j}` }));
      syncRender(
        h('ul', null,
          items.map(item => h('li', { key: item.id }, h('span', null, item.name)))
        ),
        reactContainer
      );
      i++;
    });
  });

  test('[xhtmlx] dashboard card — mixed bindings re-render', () => {
    const html = `
      <div class="card">
        <h3 xh-text="title"></h3>
        <div xh-text="value"></div>
        <span xh-class-up="positive" xh-text="change"></span>
        <a xh-attr-href="link">Details</a>
      </div>`;
    let i = 0;
    bench('xhtmlx: dashboard card update', 5000, () => {
      const ctx = new DataContext({
        title: 'Revenue', value: `$${10000 + i}`,
        change: `+${(i % 10)}%`, positive: i % 2 === 0,
        link: `/reports/${i}`
      });
      const frag = renderTemplate(html, ctx);
      performSwap(xhContainer, frag, 'innerHTML');
      i++;
    });
  });

  test('[React]  dashboard card — mixed props re-render', () => {
    let i = 0;
    bench('React:  dashboard card update', 5000, () => {
      const data = {
        title: 'Revenue', value: `$${10000 + i}`,
        change: `+${(i % 10)}%`, positive: i % 2 === 0,
        link: `/reports/${i}`
      };
      syncRender(
        h('div', { className: 'card' },
          h('h3', null, data.title),
          h('div', null, data.value),
          h('span', { className: data.positive ? 'up' : '' }, data.change),
          h('a', { href: data.link }, 'Details')
        ),
        reactContainer
      );
      i++;
    });
  });
});
