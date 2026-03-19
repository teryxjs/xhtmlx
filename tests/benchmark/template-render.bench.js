/**
 * @jest-environment jsdom
 */

const { bench } = require('./bench-helper');
const xhtmlx = require('../../xhtmlx.js');
const { DataContext, renderTemplate, processBindingsInTree } = xhtmlx._internals;

describe('Benchmark: Template rendering', () => {
  test('renderTemplate — simple (1 binding)', () => {
    const ctx = new DataContext({ name: 'Alice' });
    const html = '<span xh-text="name"></span>';
    bench('renderTemplate (1 binding)', 20000, () => {
      renderTemplate(html, ctx);
    });
  });

  test('renderTemplate — medium (5 bindings)', () => {
    const ctx = new DataContext({
      id: 1, name: 'Alice', email: 'a@b.com', role: 'admin', active: true
    });
    const html = `
      <div>
        <span xh-text="name"></span>
        <span xh-text="email"></span>
        <span xh-text="role"></span>
        <span xh-attr-data-id="id"></span>
        <span xh-class-active="active"></span>
      </div>
    `;
    bench('renderTemplate (5 bindings)', 10000, () => {
      renderTemplate(html, ctx);
    });
  });

  test('renderTemplate — with interpolation tokens', () => {
    const ctx = new DataContext({ name: 'Alice', age: 30 });
    const html = '<div>Name: {{name}}, Age: {{age}}</div>';
    bench('renderTemplate (interpolation)', 20000, () => {
      renderTemplate(html, ctx);
    });
  });

  test('renderTemplate — complex (10 bindings + interpolation)', () => {
    const ctx = new DataContext({
      id: 1, name: 'Alice', email: 'a@b.com', role: 'admin',
      active: true, score: 95, avatar: '/img/a.png',
      bio: 'Developer', created: '2024-01-01', tags: 'js,css'
    });
    const html = `
      <div class="card" data-id="{{id}}">
        <img xh-attr-src="avatar" xh-attr-alt="name">
        <h3 xh-text="name"></h3>
        <p xh-text="bio"></p>
        <span xh-text="email"></span>
        <span xh-text="role"></span>
        <span xh-text="score"></span>
        <span xh-text="created"></span>
        <span xh-class-active="active"></span>
        <span xh-text="tags"></span>
      </div>
    `;
    bench('renderTemplate (10 bindings + interp)', 5000, () => {
      renderTemplate(html, ctx);
    });
  });

  test('renderTemplate — with xh-if conditional', () => {
    const ctx = new DataContext({ show: true, name: 'Alice' });
    const html = '<div xh-if="show"><span xh-text="name"></span></div>';
    bench('renderTemplate (xh-if true)', 20000, () => {
      renderTemplate(html, ctx);
    });
  });

  test('renderTemplate — with xh-if false (element removed)', () => {
    const ctx = new DataContext({ show: false, name: 'Alice' });
    const html = '<div xh-if="show"><span xh-text="name"></span></div><div>fallback</div>';
    bench('renderTemplate (xh-if false)', 20000, () => {
      renderTemplate(html, ctx);
    });
  });

  test('renderTemplate — list with xh-each (10 items)', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ name: `Item ${i}`, id: i }));
    const ctx = new DataContext({ items });
    const html = `
      <ul>
        <li xh-each="items"><span xh-text="name"></span></li>
      </ul>
    `;
    bench('renderTemplate (xh-each 10)', 5000, () => {
      renderTemplate(html, ctx);
    });
  });

  test('renderTemplate — list with xh-each (100 items)', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ name: `Item ${i}`, id: i }));
    const ctx = new DataContext({ items });
    const html = `
      <ul>
        <li xh-each="items"><span xh-text="name"></span></li>
      </ul>
    `;
    bench('renderTemplate (xh-each 100)', 500, () => {
      renderTemplate(html, ctx);
    });
  });

  test('renderTemplate — list with xh-each (1000 items)', () => {
    const items = Array.from({ length: 1000 }, (_, i) => ({ name: `Item ${i}`, id: i }));
    const ctx = new DataContext({ items });
    const html = `
      <ul>
        <li xh-each="items"><span xh-text="name"></span></li>
      </ul>
    `;
    bench('renderTemplate (xh-each 1000)', 50, () => {
      renderTemplate(html, ctx);
    });
  });
});
