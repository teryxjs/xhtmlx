/**
 * @jest-environment jsdom
 */

const { bench, benchAsync } = require('./bench-helper');
const xhtmlx = require('../../xhtmlx.js');
const { DataContext, renderTemplate, performSwap, templateCache } = xhtmlx._internals;

describe('Benchmark: End-to-end scenarios', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    xhtmlx.clearTemplateCache();
    xhtmlx.clearResponseCache();
  });

  test('full render cycle: renderTemplate → performSwap (innerHTML)', () => {
    const ctx = new DataContext({
      id: 1, name: 'Alice', email: 'a@b.com', role: 'admin'
    });
    const html = `
      <div class="user-card" data-id="{{id}}">
        <h3 xh-text="name"></h3>
        <p xh-text="email"></p>
        <span xh-text="role"></span>
      </div>
    `;
    const container = document.createElement('div');
    document.body.appendChild(container);

    bench('render + swap cycle (4 bindings)', 10000, () => {
      const frag = renderTemplate(html, ctx);
      performSwap(container, frag, 'innerHTML');
    });
    container.remove();
  });

  test('full render cycle with list (50 items)', () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      id: i, name: `User ${i}`, email: `u${i}@x.com`
    }));
    const ctx = new DataContext({ users: items });
    const html = `
      <table>
        <tr xh-each="users">
          <td xh-text="name"></td>
          <td xh-text="email"></td>
        </tr>
      </table>
    `;
    const container = document.createElement('div');
    document.body.appendChild(container);

    bench('render + swap list (50 rows)', 200, () => {
      const frag = renderTemplate(html, ctx);
      performSwap(container, frag, 'innerHTML');
    });
    container.remove();
  });

  test('repeated re-render (simulating polling update)', () => {
    const html = '<div><span xh-text="count"></span> — <span xh-text="status"></span></div>';
    const container = document.createElement('div');
    document.body.appendChild(container);

    bench('re-render poll update', 20000, () => {
      const ctx = new DataContext({ count: Math.random(), status: 'ok' });
      const frag = renderTemplate(html, ctx);
      performSwap(container, frag, 'innerHTML');
    });
    container.remove();
  });

  test('template cache hit (pre-cached template)', () => {
    // Pre-cache a template
    const html = '<div xh-text="name"></div>';
    templateCache.set('/cached/template', Promise.resolve(html));

    bench('templateCache.get (cache hit)', 500000, () => {
      templateCache.get('/cached/template');
    });
  });

  test('response cache operations', () => {
    bench('responseCache set + get cycle', 200000, () => {
      xhtmlx._internals.responseCache.set('GET:/api/data', {
        data: { name: 'Alice' }, timestamp: Date.now()
      });
      xhtmlx._internals.responseCache.get('GET:/api/data');
    });
  });

  test('full widget: process with xh-each + bindings', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      id: i, name: `Item ${i}`, done: i % 2 === 0
    }));
    const ctx = new DataContext({ items });

    bench('process widget (20 items, each + bindings)', 500, () => {
      document.body.innerHTML = `
        <div id="app">
          <div xh-each="items">
            <span xh-text="name"></span>
            <span xh-attr-data-id="id"></span>
            <span xh-class-done="done"></span>
          </div>
        </div>
      `;
      xhtmlx.process(document.getElementById('app'), ctx);
    });
  });

  test('interpolate + render for dashboard card', () => {
    const ctx = new DataContext({
      title: 'Revenue', value: '$12,345', change: '+5.2%',
      positive: true, icon: 'chart-up', link: '/reports/revenue'
    });
    const html = `
      <div class="card">
        <a xh-attr-href="link">
          <i xh-attr-class="icon"></i>
          <h4 xh-text="title"></h4>
          <div class="value" xh-text="value"></div>
          <span xh-class-positive="positive" xh-text="change"></span>
        </a>
      </div>
    `;
    bench('dashboard card render', 10000, () => {
      renderTemplate(html, ctx);
    });
  });
});
