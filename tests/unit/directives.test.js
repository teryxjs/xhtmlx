/**
 * @jest-environment jsdom
 */

const xhtmlx = require('../../xhtmlx.js');
const { DataContext, applyBindings } = xhtmlx._internals;

describe('applyBindings', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('xh-text sets textContent', () => {
    it('sets text content from a simple field', () => {
      const el = document.createElement('span');
      el.setAttribute('xh-text', 'name');
      container.appendChild(el);

      const ctx = new DataContext({ name: 'Alice' });
      const result = applyBindings(el, ctx);

      expect(result).toBe(true);
      expect(el.textContent).toBe('Alice');
    });

    it('sets text content from a nested field', () => {
      const el = document.createElement('span');
      el.setAttribute('xh-text', 'user.name');
      container.appendChild(el);

      const ctx = new DataContext({ user: { name: 'Bob' } });
      applyBindings(el, ctx);

      expect(el.textContent).toBe('Bob');
    });

    it('sets empty string when field is missing', () => {
      const el = document.createElement('span');
      el.setAttribute('xh-text', 'missing');
      el.textContent = 'original';
      container.appendChild(el);

      const ctx = new DataContext({});
      applyBindings(el, ctx);

      expect(el.textContent).toBe('');
    });

    it('converts numeric values to string', () => {
      const el = document.createElement('span');
      el.setAttribute('xh-text', 'count');
      container.appendChild(el);

      const ctx = new DataContext({ count: 42 });
      applyBindings(el, ctx);

      expect(el.textContent).toBe('42');
    });

    it('converts boolean values to string', () => {
      const el = document.createElement('span');
      el.setAttribute('xh-text', 'active');
      container.appendChild(el);

      const ctx = new DataContext({ active: true });
      applyBindings(el, ctx);

      expect(el.textContent).toBe('true');
    });

    it('sets empty string when value is null', () => {
      const el = document.createElement('span');
      el.setAttribute('xh-text', 'value');
      container.appendChild(el);

      const ctx = new DataContext({ value: null });
      applyBindings(el, ctx);

      expect(el.textContent).toBe('');
    });

    it('escapes HTML in text content', () => {
      const el = document.createElement('span');
      el.setAttribute('xh-text', 'html');
      container.appendChild(el);

      const ctx = new DataContext({ html: '<script>alert(1)</script>' });
      applyBindings(el, ctx);

      // textContent should be the raw string, not rendered HTML
      expect(el.textContent).toBe('<script>alert(1)</script>');
      expect(el.children.length).toBe(0);
    });
  });

  describe('xh-html sets innerHTML', () => {
    it('sets inner HTML from a field', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-html', 'content');
      container.appendChild(el);

      const ctx = new DataContext({ content: '<strong>Bold</strong>' });
      applyBindings(el, ctx);

      expect(el.innerHTML).toBe('<strong>Bold</strong>');
    });

    it('sets empty string when field is missing', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-html', 'missing');
      el.innerHTML = '<p>original</p>';
      container.appendChild(el);

      const ctx = new DataContext({});
      applyBindings(el, ctx);

      expect(el.innerHTML).toBe('');
    });

    it('sets empty string when value is null', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-html', 'value');
      container.appendChild(el);

      const ctx = new DataContext({ value: null });
      applyBindings(el, ctx);

      expect(el.innerHTML).toBe('');
    });

    it('renders actual HTML elements', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-html', 'markup');
      container.appendChild(el);

      const ctx = new DataContext({ markup: '<em>emphasized</em>' });
      applyBindings(el, ctx);

      expect(el.querySelector('em')).not.toBeNull();
      expect(el.querySelector('em').textContent).toBe('emphasized');
    });
  });

  describe('xh-attr-* sets attributes', () => {
    it('sets src attribute', () => {
      const el = document.createElement('img');
      el.setAttribute('xh-attr-src', 'imageUrl');
      container.appendChild(el);

      const ctx = new DataContext({ imageUrl: 'https://example.com/img.png' });
      applyBindings(el, ctx);

      expect(el.getAttribute('src')).toBe('https://example.com/img.png');
    });

    it('sets href attribute', () => {
      const el = document.createElement('a');
      el.setAttribute('xh-attr-href', 'link');
      container.appendChild(el);

      const ctx = new DataContext({ link: 'https://example.com' });
      applyBindings(el, ctx);

      expect(el.getAttribute('href')).toBe('https://example.com');
    });

    it('sets class attribute', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-attr-class', 'className');
      container.appendChild(el);

      const ctx = new DataContext({ className: 'active highlighted' });
      applyBindings(el, ctx);

      expect(el.getAttribute('class')).toBe('active highlighted');
    });

    it('sets data-* attribute', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-attr-data-id', 'itemId');
      container.appendChild(el);

      const ctx = new DataContext({ itemId: '123' });
      applyBindings(el, ctx);

      expect(el.getAttribute('data-id')).toBe('123');
    });

    it('sets multiple attributes', () => {
      const el = document.createElement('a');
      el.setAttribute('xh-attr-href', 'url');
      el.setAttribute('xh-attr-title', 'label');
      container.appendChild(el);

      const ctx = new DataContext({ url: '/page', label: 'Go' });
      applyBindings(el, ctx);

      expect(el.getAttribute('href')).toBe('/page');
      expect(el.getAttribute('title')).toBe('Go');
    });

    it('does not set attribute when value is null/undefined', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-attr-title', 'missing');
      container.appendChild(el);

      const ctx = new DataContext({});
      applyBindings(el, ctx);

      // The attribute should not be set since value is undefined
      expect(el.hasAttribute('title')).toBe(false);
    });

    it('converts numeric value to string', () => {
      const el = document.createElement('input');
      el.setAttribute('xh-attr-max', 'maxVal');
      container.appendChild(el);

      const ctx = new DataContext({ maxVal: 100 });
      applyBindings(el, ctx);

      expect(el.getAttribute('max')).toBe('100');
    });
  });

  describe('xh-if removes element when falsy, keeps when truthy', () => {
    it('keeps element when condition is truthy', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-if', 'show');
      container.appendChild(el);

      const ctx = new DataContext({ show: true });
      const result = applyBindings(el, ctx);

      expect(result).toBe(true);
      expect(container.contains(el)).toBe(true);
    });

    it('removes element when condition is false', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-if', 'show');
      container.appendChild(el);

      const ctx = new DataContext({ show: false });
      const result = applyBindings(el, ctx);

      expect(result).toBe(false);
      expect(container.contains(el)).toBe(false);
    });

    it('removes element when condition is null', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-if', 'show');
      container.appendChild(el);

      const ctx = new DataContext({ show: null });
      const result = applyBindings(el, ctx);

      expect(result).toBe(false);
      expect(container.contains(el)).toBe(false);
    });

    it('removes element when condition is undefined', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-if', 'missing');
      container.appendChild(el);

      const ctx = new DataContext({});
      const result = applyBindings(el, ctx);

      expect(result).toBe(false);
      expect(container.contains(el)).toBe(false);
    });

    it('removes element when condition is 0', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-if', 'count');
      container.appendChild(el);

      const ctx = new DataContext({ count: 0 });
      const result = applyBindings(el, ctx);

      expect(result).toBe(false);
      expect(container.contains(el)).toBe(false);
    });

    it('removes element when condition is empty string', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-if', 'text');
      container.appendChild(el);

      const ctx = new DataContext({ text: '' });
      const result = applyBindings(el, ctx);

      expect(result).toBe(false);
      expect(container.contains(el)).toBe(false);
    });

    it('keeps element when condition is a non-empty string', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-if', 'text');
      container.appendChild(el);

      const ctx = new DataContext({ text: 'hello' });
      const result = applyBindings(el, ctx);

      expect(result).toBe(true);
      expect(container.contains(el)).toBe(true);
    });

    it('keeps element when condition is a positive number', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-if', 'count');
      container.appendChild(el);

      const ctx = new DataContext({ count: 5 });
      const result = applyBindings(el, ctx);

      expect(result).toBe(true);
      expect(container.contains(el)).toBe(true);
    });
  });

  describe('xh-unless removes element when truthy, keeps when falsy', () => {
    it('keeps element when condition is falsy', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-unless', 'hidden');
      container.appendChild(el);

      const ctx = new DataContext({ hidden: false });
      const result = applyBindings(el, ctx);

      expect(result).toBe(true);
      expect(container.contains(el)).toBe(true);
    });

    it('removes element when condition is truthy', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-unless', 'hidden');
      container.appendChild(el);

      const ctx = new DataContext({ hidden: true });
      const result = applyBindings(el, ctx);

      expect(result).toBe(false);
      expect(container.contains(el)).toBe(false);
    });

    it('keeps element when condition is undefined', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-unless', 'missing');
      container.appendChild(el);

      const ctx = new DataContext({});
      const result = applyBindings(el, ctx);

      expect(result).toBe(true);
      expect(container.contains(el)).toBe(true);
    });

    it('keeps element when condition is null', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-unless', 'val');
      container.appendChild(el);

      const ctx = new DataContext({ val: null });
      const result = applyBindings(el, ctx);

      expect(result).toBe(true);
      expect(container.contains(el)).toBe(true);
    });

    it('removes element when condition is non-empty string', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-unless', 'text');
      container.appendChild(el);

      const ctx = new DataContext({ text: 'something' });
      const result = applyBindings(el, ctx);

      expect(result).toBe(false);
      expect(container.contains(el)).toBe(false);
    });
  });

  describe('multiple bindings on same element', () => {
    it('applies xh-text and xh-attr-* together', () => {
      const el = document.createElement('span');
      el.setAttribute('xh-text', 'label');
      el.setAttribute('xh-attr-class', 'cls');
      container.appendChild(el);

      const ctx = new DataContext({ label: 'Hello', cls: 'highlight' });
      applyBindings(el, ctx);

      expect(el.textContent).toBe('Hello');
      expect(el.getAttribute('class')).toBe('highlight');
    });

    it('applies xh-if first, skips others if removed', () => {
      const el = document.createElement('span');
      el.setAttribute('xh-if', 'show');
      el.setAttribute('xh-text', 'label');
      container.appendChild(el);

      const ctx = new DataContext({ show: false, label: 'Hello' });
      const result = applyBindings(el, ctx);

      expect(result).toBe(false);
      expect(container.contains(el)).toBe(false);
    });

    it('applies xh-if then xh-text when visible', () => {
      const el = document.createElement('span');
      el.setAttribute('xh-if', 'show');
      el.setAttribute('xh-text', 'label');
      container.appendChild(el);

      const ctx = new DataContext({ show: true, label: 'Hello' });
      const result = applyBindings(el, ctx);

      expect(result).toBe(true);
      expect(el.textContent).toBe('Hello');
    });

    it('applies xh-unless first, skips others if removed', () => {
      const el = document.createElement('span');
      el.setAttribute('xh-unless', 'hidden');
      el.setAttribute('xh-text', 'label');
      container.appendChild(el);

      const ctx = new DataContext({ hidden: true, label: 'Hello' });
      const result = applyBindings(el, ctx);

      expect(result).toBe(false);
    });
  });

  describe('applyBindings returns false when element removed', () => {
    it('returns false when xh-if removes element', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-if', 'visible');
      container.appendChild(el);

      const ctx = new DataContext({ visible: false });
      expect(applyBindings(el, ctx)).toBe(false);
    });

    it('returns false when xh-unless removes element', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-unless', 'active');
      container.appendChild(el);

      const ctx = new DataContext({ active: true });
      expect(applyBindings(el, ctx)).toBe(false);
    });

    it('returns true when element is kept', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-text', 'name');
      container.appendChild(el);

      const ctx = new DataContext({ name: 'Alice' });
      expect(applyBindings(el, ctx)).toBe(true);
    });

    it('returns true when no conditional directives present', () => {
      const el = document.createElement('div');
      container.appendChild(el);

      const ctx = new DataContext({});
      expect(applyBindings(el, ctx)).toBe(true);
    });
  });
});
