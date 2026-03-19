/**
 * @jest-environment jsdom
 */

/**
 * Comparison: Conditional rendering
 *
 * xhtmlx: <div xh-if="show"><span xh-text="name"></span></div>
 * React:  show ? createElement('div', null, ...) : null
 */

const { bench } = require('../bench-helper');
const xhtmlx = require('../../../xhtmlx.js');
const { DataContext, renderTemplate, performSwap } = xhtmlx._internals;
const { h, syncRender, syncUnmount } = require('./react-helper');

describe('vs React: Conditional rendering', () => {
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

  test('[xhtmlx] conditional — true (show content)', () => {
    const ctx = new DataContext({ show: true, name: 'Alice', bio: 'Developer' });
    const html = `
      <div>
        <div xh-if="show">
          <span xh-text="name"></span>
          <p xh-text="bio"></p>
        </div>
      </div>`;
    bench('xhtmlx: xh-if true', 5000, () => {
      const frag = renderTemplate(html, ctx);
      performSwap(xhContainer, frag, 'innerHTML');
    });
  });

  test('[React]  conditional — true (show content)', () => {
    const data = { show: true, name: 'Alice', bio: 'Developer' };
    bench('React:  cond true', 5000, () => {
      const tree = h('div', null,
        data.show ? h('div', null,
          h('span', null, data.name),
          h('p', null, data.bio)
        ) : null
      );
      syncRender(tree, reactContainer);
    });
  });

  test('[xhtmlx] conditional — false (hide content)', () => {
    const ctx = new DataContext({ show: false, name: 'Alice', bio: 'Developer' });
    const html = `
      <div>
        <div xh-if="show">
          <span xh-text="name"></span>
          <p xh-text="bio"></p>
        </div>
      </div>`;
    bench('xhtmlx: xh-if false', 5000, () => {
      const frag = renderTemplate(html, ctx);
      performSwap(xhContainer, frag, 'innerHTML');
    });
  });

  test('[React]  conditional — false (hide content)', () => {
    const data = { show: false, name: 'Alice', bio: 'Developer' };
    bench('React:  cond false', 5000, () => {
      const tree = h('div', null,
        data.show ? h('div', null,
          h('span', null, data.name),
          h('p', null, data.bio)
        ) : null
      );
      syncRender(tree, reactContainer);
    });
  });

  test('[xhtmlx] conditional toggle — alternating true/false', () => {
    const ctxTrue = new DataContext({ show: true, name: 'Alice' });
    const ctxFalse = new DataContext({ show: false, name: 'Alice' });
    const html = '<div><div xh-if="show"><span xh-text="name"></span></div></div>';
    let toggle = true;
    bench('xhtmlx: xh-if toggle', 5000, () => {
      const frag = renderTemplate(html, toggle ? ctxTrue : ctxFalse);
      performSwap(xhContainer, frag, 'innerHTML');
      toggle = !toggle;
    });
  });

  test('[React]  conditional toggle — alternating true/false', () => {
    let toggle = true;
    bench('React:  cond toggle', 5000, () => {
      const show = toggle;
      const tree = h('div', null,
        show ? h('div', null, h('span', null, 'Alice')) : null
      );
      syncRender(tree, reactContainer);
      toggle = !toggle;
    });
  });
});
