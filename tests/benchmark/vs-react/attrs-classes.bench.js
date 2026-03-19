/**
 * @jest-environment jsdom
 */

/**
 * Comparison: Attribute and class bindings
 *
 * xhtmlx: xh-attr-src, xh-attr-href, xh-class-active
 * React:  props: { src, href, className }
 */

const { bench } = require('../bench-helper');
const xhtmlx = require('../../../xhtmlx.js');
const { DataContext, renderTemplate, performSwap } = xhtmlx._internals;
const { h, syncRender, syncUnmount } = require('./react-helper');

describe('vs React: Attribute & class bindings', () => {
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

  test('[xhtmlx] image card — src, alt, href attrs + text + class', () => {
    const ctx = new DataContext({
      src: '/img/avatar.png', alt: 'Alice avatar', name: 'Alice',
      href: '/profile/1', active: true
    });
    const html = `
      <div>
        <a xh-attr-href="href">
          <img xh-attr-src="src" xh-attr-alt="alt">
          <span xh-text="name" xh-class-active="active"></span>
        </a>
      </div>`;
    bench('xhtmlx: img card (attrs+class)', 5000, () => {
      const frag = renderTemplate(html, ctx);
      performSwap(xhContainer, frag, 'innerHTML');
    });
  });

  test('[React]  image card — src, alt, href attrs + text + class', () => {
    const data = {
      src: '/img/avatar.png', alt: 'Alice avatar', name: 'Alice',
      href: '/profile/1', active: true
    };
    bench('React:  img card (props+class)', 5000, () => {
      const tree = h('div', null,
        h('a', { href: data.href },
          h('img', { src: data.src, alt: data.alt }),
          h('span', { className: data.active ? 'active' : '' }, data.name)
        )
      );
      syncRender(tree, reactContainer);
    });
  });

  test('[xhtmlx] 5 data attributes', () => {
    const ctx = new DataContext({
      id: '123', type: 'user', role: 'admin', status: 'active', level: '5'
    });
    const html = `
      <div xh-attr-data-id="id" xh-attr-data-type="type"
           xh-attr-data-role="role" xh-attr-data-status="status"
           xh-attr-data-level="level">
      </div>`;
    bench('xhtmlx: 5 data-attrs', 10000, () => {
      const frag = renderTemplate(html, ctx);
      performSwap(xhContainer, frag, 'innerHTML');
    });
  });

  test('[React]  5 data attributes', () => {
    const data = {
      id: '123', type: 'user', role: 'admin', status: 'active', level: '5'
    };
    bench('React:  5 data-attrs', 10000, () => {
      const tree = h('div', {
        'data-id': data.id, 'data-type': data.type,
        'data-role': data.role, 'data-status': data.status,
        'data-level': data.level
      });
      syncRender(tree, reactContainer);
    });
  });

  test('[xhtmlx] multiple class toggles', () => {
    const ctx = new DataContext({ active: true, selected: false, highlighted: true, disabled: false });
    const html = `
      <div xh-class-active="active" xh-class-selected="selected"
           xh-class-highlighted="highlighted" xh-class-disabled="disabled">
      </div>`;
    bench('xhtmlx: 4 class toggles', 10000, () => {
      const frag = renderTemplate(html, ctx);
      performSwap(xhContainer, frag, 'innerHTML');
    });
  });

  test('[React]  multiple class toggles', () => {
    const data = { active: true, selected: false, highlighted: true, disabled: false };
    bench('React:  4 class toggles', 10000, () => {
      const classes = [
        data.active && 'active',
        data.selected && 'selected',
        data.highlighted && 'highlighted',
        data.disabled && 'disabled'
      ].filter(Boolean).join(' ');
      const tree = h('div', { className: classes });
      syncRender(tree, reactContainer);
    });
  });
});
