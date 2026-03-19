/**
 * @jest-environment jsdom
 */

const { bench, benchAsync } = require('./bench-helper');
const xhtmlx = require('../../xhtmlx.js');
const {
  DataContext, processElement, processBindingsInTree,
  applyBindings, elementStates
} = xhtmlx._internals;

// Helper to clear processed flags so elements can be re-processed
function clearProcessed(root) {
  const walker = document.createTreeWalker(root, 1);
  let node = walker.currentNode;
  while (node) {
    elementStates.delete(node);
    node = walker.nextNode();
  }
}

describe('Benchmark: DOM processing', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    xhtmlx.clearTemplateCache();
  });

  test('processBindingsInTree — flat tree (10 elements)', () => {
    const ctx = new DataContext({
      a: 'A', b: 'B', c: 'C', d: 'D', e: 'E',
      f: 'F', g: 'G', h: 'H', i: 'I', j: 'J'
    });
    const container = document.createElement('div');
    const fields = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    fields.forEach(f => {
      const el = document.createElement('span');
      el.setAttribute('xh-text', f);
      container.appendChild(el);
    });
    bench('processBindingsInTree (10 spans)', 10000, () => {
      processBindingsInTree(container, ctx);
    });
  });

  test('processBindingsInTree — nested tree (3 levels, ~30 elements)', () => {
    const ctx = new DataContext({ name: 'Alice', id: 1, active: true });
    const container = document.createElement('div');
    for (let i = 0; i < 10; i++) {
      const row = document.createElement('div');
      const nameEl = document.createElement('span');
      nameEl.setAttribute('xh-text', 'name');
      const idEl = document.createElement('span');
      idEl.setAttribute('xh-attr-data-id', 'id');
      const cls = document.createElement('span');
      cls.setAttribute('xh-class-active', 'active');
      row.appendChild(nameEl);
      row.appendChild(idEl);
      row.appendChild(cls);
      container.appendChild(row);
    }
    bench('processBindingsInTree (30 els, 3 types)', 5000, () => {
      processBindingsInTree(container, ctx);
    });
  });

  test('processBindingsInTree — large flat tree (100 elements)', () => {
    const ctx = new DataContext({ val: 'test' });
    const container = document.createElement('div');
    for (let i = 0; i < 100; i++) {
      const el = document.createElement('span');
      el.setAttribute('xh-text', 'val');
      container.appendChild(el);
    }
    bench('processBindingsInTree (100 spans)', 1000, () => {
      processBindingsInTree(container, ctx);
    });
  });

  test('processBindingsInTree — mixed tree (no-op elements + bindings)', () => {
    const ctx = new DataContext({ name: 'Alice' });
    const container = document.createElement('div');
    // Half plain elements, half with bindings
    for (let i = 0; i < 50; i++) {
      const plain = document.createElement('div');
      plain.textContent = 'static';
      container.appendChild(plain);
      const bound = document.createElement('span');
      bound.setAttribute('xh-text', 'name');
      container.appendChild(bound);
    }
    bench('processBindingsInTree (50 bound + 50 plain)', 1000, () => {
      processBindingsInTree(container, ctx);
    });
  });

  test('xhtmlx.process() — small widget (5 bindings)', () => {
    const html = `
      <div id="widget">
        <span xh-text="name"></span>
        <span xh-text="email"></span>
        <span xh-attr-data-id="id"></span>
        <span xh-class-active="active"></span>
        <span xh-show="visible"></span>
      </div>
    `;
    const ctx = new DataContext({
      name: 'Alice', email: 'a@b.com', id: 1, active: true, visible: true
    });
    bench('xhtmlx.process (5 bindings)', 5000, () => {
      document.body.innerHTML = html;
      const widget = document.getElementById('widget');
      xhtmlx.process(widget, ctx);
    });
  });
});
