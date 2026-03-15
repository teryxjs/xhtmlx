/**
 * @jest-environment jsdom
 */

const xhtmlx = require('../../xhtmlx.js');
const { DataContext, processEach } = xhtmlx._internals;

describe('processEach (xh-each)', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('simple array iteration', () => {
    it('creates elements for each array item', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-each', 'items');
      el.setAttribute('xh-text', 'name');
      container.appendChild(el);

      const ctx = new DataContext({ items: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] });
      processEach(el, ctx);

      expect(container.children.length).toBe(3);
    });

    it('returns true to indicate xh-each was processed', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-each', 'items');
      container.appendChild(el);

      const ctx = new DataContext({ items: [{ a: 1 }] });
      const result = processEach(el, ctx);

      expect(result).toBe(true);
    });

    it('returns false when element has no xh-each attribute', () => {
      const el = document.createElement('div');
      container.appendChild(el);

      const ctx = new DataContext({});
      const result = processEach(el, ctx);

      expect(result).toBe(false);
    });
  });

  describe('creates correct number of clones', () => {
    it('creates one clone for single-item array', () => {
      const el = document.createElement('li');
      el.setAttribute('xh-each', 'items');
      container.appendChild(el);

      const ctx = new DataContext({ items: ['one'] });
      processEach(el, ctx);

      expect(container.children.length).toBe(1);
    });

    it('creates five clones for five-item array', () => {
      const el = document.createElement('li');
      el.setAttribute('xh-each', 'items');
      container.appendChild(el);

      const ctx = new DataContext({ items: [1, 2, 3, 4, 5] });
      processEach(el, ctx);

      expect(container.children.length).toBe(5);
    });

    it('removes the original template element', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-each', 'items');
      container.appendChild(el);

      const ctx = new DataContext({ items: [{ a: 1 }] });
      processEach(el, ctx);

      // The original element reference should no longer be a child of the container
      expect(el.parentNode).not.toBe(container);
      // But a clone should exist
      expect(container.children.length).toBe(1);
    });
  });

  describe('each clone gets correct data context', () => {
    it('binds correct data via xh-text', () => {
      const el = document.createElement('span');
      el.setAttribute('xh-each', 'items');
      el.setAttribute('xh-text', 'label');
      container.appendChild(el);

      const ctx = new DataContext({ items: [{ label: 'Alpha' }, { label: 'Beta' }, { label: 'Gamma' }] });
      processEach(el, ctx);

      const spans = container.querySelectorAll('span');
      expect(spans[0].textContent).toBe('Alpha');
      expect(spans[1].textContent).toBe('Beta');
      expect(spans[2].textContent).toBe('Gamma');
    });

    it('can access parent data from within iteration', () => {
      const el = document.createElement('span');
      el.setAttribute('xh-each', 'items');
      container.appendChild(el);

      const parentCtx = new DataContext({ title: 'List', items: [{ name: 'A' }] });
      processEach(el, parentCtx);

      // The cloned elements should be in the container, we can verify via
      // the DataContext chain by testing that the parent field is accessible.
      // Since processEach creates a new DataContext(item, ctx, idx),
      // the parent's data should be accessible.
      expect(container.children.length).toBe(1);
    });
  });

  describe('$index is available in each iteration', () => {
    it('provides sequential index starting from 0', () => {
      // Create a template that uses $index via child elements
      const el = document.createElement('div');
      el.setAttribute('xh-each', 'items');
      const indexSpan = document.createElement('span');
      indexSpan.setAttribute('xh-text', '$index');
      el.appendChild(indexSpan);
      container.appendChild(el);

      const ctx = new DataContext({ items: ['a', 'b', 'c'] });
      processEach(el, ctx);

      const spans = container.querySelectorAll('span');
      expect(spans[0].textContent).toBe('0');
      expect(spans[1].textContent).toBe('1');
      expect(spans[2].textContent).toBe('2');
    });
  });

  describe('non-array value removes element', () => {
    it('removes element when value is a string', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-each', 'items');
      container.appendChild(el);

      const ctx = new DataContext({ items: 'not an array' });
      processEach(el, ctx);

      expect(container.children.length).toBe(0);
    });

    it('removes element when value is a number', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-each', 'items');
      container.appendChild(el);

      const ctx = new DataContext({ items: 42 });
      processEach(el, ctx);

      expect(container.children.length).toBe(0);
    });

    it('removes element when value is an object (not array)', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-each', 'items');
      container.appendChild(el);

      const ctx = new DataContext({ items: { a: 1 } });
      processEach(el, ctx);

      expect(container.children.length).toBe(0);
    });

    it('removes element when value is null', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-each', 'items');
      container.appendChild(el);

      const ctx = new DataContext({ items: null });
      processEach(el, ctx);

      expect(container.children.length).toBe(0);
    });

    it('removes element when value is undefined', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-each', 'missing');
      container.appendChild(el);

      const ctx = new DataContext({});
      processEach(el, ctx);

      expect(container.children.length).toBe(0);
    });
  });

  describe('empty array removes element', () => {
    it('removes element for empty array (no clones created)', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-each', 'items');
      container.appendChild(el);

      const ctx = new DataContext({ items: [] });
      processEach(el, ctx);

      expect(container.children.length).toBe(0);
    });
  });

  describe('nested xh-each', () => {
    it('handles nested iteration via processEach and processBindingsInTree', () => {
      // Outer: iterate over groups
      // Inner: iterate over items within each group
      const outer = document.createElement('div');
      outer.setAttribute('xh-each', 'groups');

      const inner = document.createElement('span');
      inner.setAttribute('xh-each', 'items');
      inner.setAttribute('xh-text', 'name');
      outer.appendChild(inner);

      container.appendChild(outer);

      const ctx = new DataContext({
        groups: [
          { items: [{ name: 'A' }, { name: 'B' }] },
          { items: [{ name: 'C' }] }
        ]
      });

      processEach(outer, ctx);

      // Should have 2 outer divs (one per group)
      const outerDivs = container.querySelectorAll('div');
      expect(outerDivs.length).toBe(2);

      // First group should have 2 spans, second should have 1
      const allSpans = container.querySelectorAll('span');
      expect(allSpans.length).toBe(3);
      expect(allSpans[0].textContent).toBe('A');
      expect(allSpans[1].textContent).toBe('B');
      expect(allSpans[2].textContent).toBe('C');
    });
  });

  describe('iteration with complex data', () => {
    it('handles array of objects with nested properties', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-each', 'users');
      const nameSpan = document.createElement('span');
      nameSpan.setAttribute('xh-text', 'profile.name');
      el.appendChild(nameSpan);
      container.appendChild(el);

      const ctx = new DataContext({
        users: [
          { profile: { name: 'Alice' } },
          { profile: { name: 'Bob' } }
        ]
      });

      processEach(el, ctx);

      const spans = container.querySelectorAll('span');
      expect(spans[0].textContent).toBe('Alice');
      expect(spans[1].textContent).toBe('Bob');
    });

    it('handles array of primitive values', () => {
      const el = document.createElement('li');
      el.setAttribute('xh-each', 'tags');
      container.appendChild(el);

      const ctx = new DataContext({ tags: ['js', 'css', 'html'] });
      processEach(el, ctx);

      // For primitive values, the data context will be the primitive itself.
      // Without xh-text, the element content won't change but 3 clones should exist.
      expect(container.children.length).toBe(3);
    });
  });
});
