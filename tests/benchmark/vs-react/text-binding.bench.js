/**
 * @jest-environment jsdom
 */

/**
 * Comparison: Text content binding
 *
 * xhtmlx: <span xh-text="name"></span>
 * React:  React.createElement('span', null, data.name)
 */

const { bench } = require('../bench-helper');
const xhtmlx = require('../../../xhtmlx.js');
const { DataContext, renderTemplate, performSwap, applyBindings } = xhtmlx._internals;
const { h, syncRender, syncUnmount } = require('./react-helper');

describe('vs React: Text content binding', () => {
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

  test('[xhtmlx] single text binding — render + swap', () => {
    const ctx = new DataContext({ name: 'Alice' });
    const html = '<span xh-text="name"></span>';
    bench('xhtmlx: text bind render+swap', 10000, () => {
      const frag = renderTemplate(html, ctx);
      performSwap(xhContainer, frag, 'innerHTML');
    });
  });

  test('[React]  single text binding — createElement + render', () => {
    const data = { name: 'Alice' };
    bench('React:  text bind render', 10000, () => {
      syncRender(h('span', null, data.name), reactContainer);
    });
  });

  test('[xhtmlx] 5 text bindings — render + swap', () => {
    const ctx = new DataContext({
      name: 'Alice', email: 'a@b.com', role: 'admin', city: 'NYC', age: '30'
    });
    const html = `
      <div>
        <span xh-text="name"></span>
        <span xh-text="email"></span>
        <span xh-text="role"></span>
        <span xh-text="city"></span>
        <span xh-text="age"></span>
      </div>`;
    bench('xhtmlx: 5 text binds render+swap', 5000, () => {
      const frag = renderTemplate(html, ctx);
      performSwap(xhContainer, frag, 'innerHTML');
    });
  });

  test('[React]  5 text bindings — createElement + render', () => {
    const data = { name: 'Alice', email: 'a@b.com', role: 'admin', city: 'NYC', age: '30' };
    const tree = h('div', null,
      h('span', null, data.name),
      h('span', null, data.email),
      h('span', null, data.role),
      h('span', null, data.city),
      h('span', null, data.age)
    );
    bench('React:  5 text binds render', 5000, () => {
      syncRender(tree, reactContainer);
    });
  });

  test('[xhtmlx] 10 text bindings — render + swap', () => {
    const fields = {};
    for (let i = 0; i < 10; i++) fields[`f${i}`] = `value${i}`;
    const ctx = new DataContext(fields);
    const html = Array.from({ length: 10 }, (_, i) =>
      `<span xh-text="f${i}"></span>`
    ).join('');
    bench('xhtmlx: 10 text binds render+swap', 2000, () => {
      const frag = renderTemplate(`<div>${html}</div>`, ctx);
      performSwap(xhContainer, frag, 'innerHTML');
    });
  });

  test('[React]  10 text bindings — createElement + render', () => {
    const data = {};
    for (let i = 0; i < 10; i++) data[`f${i}`] = `value${i}`;
    const children = Array.from({ length: 10 }, (_, i) =>
      h('span', { key: i }, data[`f${i}`])
    );
    const tree = h('div', null, ...children);
    bench('React:  10 text binds render', 2000, () => {
      syncRender(tree, reactContainer);
    });
  });
});
