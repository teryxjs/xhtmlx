/**
 * @jest-environment jsdom
 */

const xhtmlx = require('../../xhtmlx.js');
const {
  DataContext,
  renderTemplate,
  applyBindings,
  performSwap,
  processEach,
  processBindingsInTree,
  config,
  injectDefaultCSS
} = xhtmlx._internals;

describe('CSP-safe mode', () => {
  let container;

  function makeFragment(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    return document.importNode(tpl.content, true);
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (container.parentNode) {
      document.body.removeChild(container);
    }
    config.cspSafe = false;
    config.debug = false;
  });

  // -----------------------------------------------------------------------
  // renderTemplate in CSP mode
  // -----------------------------------------------------------------------

  describe('renderTemplate uses DOMParser in CSP mode', () => {
    it('renders a simple template with text bindings', () => {
      config.cspSafe = true;
      const ctx = new DataContext({ name: 'Alice' });
      const fragment = renderTemplate('<span xh-text="name"></span>', ctx);

      container.appendChild(fragment);
      const span = container.querySelector('span');
      expect(span).not.toBeNull();
      expect(span.textContent).toBe('Alice');
    });

    it('renders a template with interpolation in text nodes', () => {
      config.cspSafe = true;
      const ctx = new DataContext({ greeting: 'Hello' });
      const fragment = renderTemplate('<p>{{greeting}}, World!</p>', ctx);

      container.appendChild(fragment);
      const p = container.querySelector('p');
      expect(p).not.toBeNull();
      expect(p.textContent).toBe('Hello, World!');
    });

    it('renders template with multiple elements correctly', () => {
      config.cspSafe = true;
      const ctx = new DataContext({ a: 'first', b: 'second', c: 'third' });
      const fragment = renderTemplate(
        '<div xh-text="a"></div><span xh-text="b"></span><p xh-text="c"></p>',
        ctx
      );

      container.appendChild(fragment);
      expect(container.querySelector('div').textContent).toBe('first');
      expect(container.querySelector('span').textContent).toBe('second');
      expect(container.querySelector('p').textContent).toBe('third');
    });
  });

  // -----------------------------------------------------------------------
  // xh-html falls back to textContent in CSP mode
  // -----------------------------------------------------------------------

  describe('xh-html falls back to textContent in CSP mode', () => {
    it('sets textContent instead of innerHTML when cspSafe is true', () => {
      config.cspSafe = true;
      const el = document.createElement('div');
      el.setAttribute('xh-html', 'content');
      container.appendChild(el);

      const ctx = new DataContext({ content: '<strong>Bold</strong>' });
      applyBindings(el, ctx);

      // Should be text, not rendered HTML
      expect(el.textContent).toBe('<strong>Bold</strong>');
      expect(el.querySelector('strong')).toBeNull();
    });

    it('sets empty string when value is null in CSP mode', () => {
      config.cspSafe = true;
      const el = document.createElement('div');
      el.setAttribute('xh-html', 'content');
      container.appendChild(el);

      const ctx = new DataContext({ content: null });
      applyBindings(el, ctx);

      expect(el.textContent).toBe('');
    });

    it('sets empty string when value is missing in CSP mode', () => {
      config.cspSafe = true;
      const el = document.createElement('div');
      el.setAttribute('xh-html', 'missing');
      container.appendChild(el);

      const ctx = new DataContext({});
      applyBindings(el, ctx);

      expect(el.textContent).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // xh-html works normally when cspSafe is false
  // -----------------------------------------------------------------------

  describe('xh-html works normally when cspSafe is false', () => {
    it('sets innerHTML when cspSafe is false', () => {
      config.cspSafe = false;
      const el = document.createElement('div');
      el.setAttribute('xh-html', 'content');
      container.appendChild(el);

      const ctx = new DataContext({ content: '<strong>Bold</strong>' });
      applyBindings(el, ctx);

      expect(el.innerHTML).toBe('<strong>Bold</strong>');
      expect(el.querySelector('strong')).not.toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // performSwap innerHTML clears children without innerHTML in CSP mode
  // -----------------------------------------------------------------------

  describe('performSwap innerHTML in CSP mode', () => {
    it('clears children without using innerHTML property', () => {
      config.cspSafe = true;
      const target = document.createElement('div');
      target.appendChild(document.createElement('p'));
      target.appendChild(document.createElement('span'));
      container.appendChild(target);

      const fragment = makeFragment('<em>new</em>');
      const result = performSwap(target, fragment, 'innerHTML');

      expect(result).toBe(target);
      expect(target.querySelector('p')).toBeNull();
      expect(target.querySelector('span')).toBeNull();
      expect(target.querySelector('em')).not.toBeNull();
      expect(target.querySelector('em').textContent).toBe('new');
    });

    it('works with empty target in CSP mode', () => {
      config.cspSafe = true;
      const target = document.createElement('div');
      container.appendChild(target);

      const fragment = makeFragment('<p>content</p>');
      performSwap(target, fragment, 'innerHTML');

      expect(target.querySelector('p').textContent).toBe('content');
    });
  });

  // -----------------------------------------------------------------------
  // xh-text still works in CSP mode
  // -----------------------------------------------------------------------

  describe('xh-text still works in CSP mode', () => {
    it('sets text content from a simple field', () => {
      config.cspSafe = true;
      const el = document.createElement('span');
      el.setAttribute('xh-text', 'name');
      container.appendChild(el);

      const ctx = new DataContext({ name: 'Bob' });
      applyBindings(el, ctx);

      expect(el.textContent).toBe('Bob');
    });
  });

  // -----------------------------------------------------------------------
  // xh-each still works in CSP mode
  // -----------------------------------------------------------------------

  describe('xh-each still works in CSP mode', () => {
    it('renders items from an array', () => {
      config.cspSafe = true;
      const el = document.createElement('li');
      el.setAttribute('xh-each', 'items');
      el.setAttribute('xh-text', 'name');
      container.appendChild(el);

      const ctx = new DataContext({ items: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] });
      processEach(el, ctx);

      const lis = container.querySelectorAll('li');
      expect(lis.length).toBe(3);
      expect(lis[0].textContent).toBe('A');
      expect(lis[1].textContent).toBe('B');
      expect(lis[2].textContent).toBe('C');
    });
  });

  // -----------------------------------------------------------------------
  // xh-if / xh-unless still work in CSP mode
  // -----------------------------------------------------------------------

  describe('xh-if and xh-unless still work in CSP mode', () => {
    it('xh-if keeps element when truthy', () => {
      config.cspSafe = true;
      const el = document.createElement('div');
      el.setAttribute('xh-if', 'show');
      container.appendChild(el);

      const ctx = new DataContext({ show: true });
      const result = applyBindings(el, ctx);

      expect(result).toBe(true);
      expect(container.contains(el)).toBe(true);
    });

    it('xh-if removes element when falsy', () => {
      config.cspSafe = true;
      const el = document.createElement('div');
      el.setAttribute('xh-if', 'show');
      container.appendChild(el);

      const ctx = new DataContext({ show: false });
      const result = applyBindings(el, ctx);

      expect(result).toBe(false);
      expect(container.contains(el)).toBe(false);
    });

    it('xh-unless keeps element when falsy', () => {
      config.cspSafe = true;
      const el = document.createElement('div');
      el.setAttribute('xh-unless', 'hidden');
      container.appendChild(el);

      const ctx = new DataContext({ hidden: false });
      const result = applyBindings(el, ctx);

      expect(result).toBe(true);
      expect(container.contains(el)).toBe(true);
    });

    it('xh-unless removes element when truthy', () => {
      config.cspSafe = true;
      const el = document.createElement('div');
      el.setAttribute('xh-unless', 'hidden');
      container.appendChild(el);

      const ctx = new DataContext({ hidden: true });
      const result = applyBindings(el, ctx);

      expect(result).toBe(false);
      expect(container.contains(el)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // xh-attr-* still works in CSP mode
  // -----------------------------------------------------------------------

  describe('xh-attr-* still works in CSP mode', () => {
    it('sets attribute from data context', () => {
      config.cspSafe = true;
      const el = document.createElement('img');
      el.setAttribute('xh-attr-src', 'imageUrl');
      container.appendChild(el);

      const ctx = new DataContext({ imageUrl: 'https://example.com/img.png' });
      applyBindings(el, ctx);

      expect(el.getAttribute('src')).toBe('https://example.com/img.png');
    });

    it('sets multiple attributes', () => {
      config.cspSafe = true;
      const el = document.createElement('a');
      el.setAttribute('xh-attr-href', 'url');
      el.setAttribute('xh-attr-title', 'label');
      container.appendChild(el);

      const ctx = new DataContext({ url: '/page', label: 'Go' });
      applyBindings(el, ctx);

      expect(el.getAttribute('href')).toBe('/page');
      expect(el.getAttribute('title')).toBe('Go');
    });
  });

  // -----------------------------------------------------------------------
  // Warn logged for xh-html in CSP mode (with debug=true)
  // -----------------------------------------------------------------------

  describe('warning logged for xh-html in CSP mode', () => {
    it('logs a warning when debug is true and cspSafe is true', () => {
      config.cspSafe = true;
      config.debug = true;
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const el = document.createElement('div');
      el.setAttribute('xh-html', 'content');
      container.appendChild(el);

      const ctx = new DataContext({ content: '<b>test</b>' });
      applyBindings(el, ctx);

      expect(warnSpy).toHaveBeenCalledWith(
        '[xhtmlx] xh-html is disabled in CSP-safe mode, falling back to xh-text'
      );

      warnSpy.mockRestore();
    });

    it('does not log a warning when debug is false', () => {
      config.cspSafe = true;
      config.debug = false;
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const el = document.createElement('div');
      el.setAttribute('xh-html', 'content');
      container.appendChild(el);

      const ctx = new DataContext({ content: '<b>test</b>' });
      applyBindings(el, ctx);

      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('xh-html is disabled')
      );

      warnSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------------
  // Template with multiple elements renders correctly in CSP mode
  // -----------------------------------------------------------------------

  describe('template with nested structure renders correctly in CSP mode', () => {
    it('renders nested elements with various bindings', () => {
      config.cspSafe = true;
      const ctx = new DataContext({
        title: 'Users',
        count: 3,
        visible: true
      });

      const fragment = renderTemplate(
        '<div>' +
          '<h1 xh-text="title"></h1>' +
          '<span xh-text="count"></span>' +
          '<p xh-if="visible">Visible content</p>' +
        '</div>',
        ctx
      );

      container.appendChild(fragment);
      expect(container.querySelector('h1').textContent).toBe('Users');
      expect(container.querySelector('span').textContent).toBe('3');
      expect(container.querySelector('p')).not.toBeNull();
      expect(container.querySelector('p').textContent).toBe('Visible content');
    });
  });
});
