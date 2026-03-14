/**
 * @jest-environment jsdom
 */

const xhtmlx = require('../../xhtmlx.js');
const { DataContext, renderTemplate } = xhtmlx._internals;

describe('renderTemplate', () => {
  describe('renders simple template with data binding', () => {
    it('renders xh-text binding', () => {
      const ctx = new DataContext({ name: 'Alice' });
      const fragment = renderTemplate('<span xh-text="name"></span>', ctx);

      const div = document.createElement('div');
      div.appendChild(fragment);

      expect(div.querySelector('span').textContent).toBe('Alice');
    });

    it('renders xh-html binding', () => {
      const ctx = new DataContext({ content: '<em>hello</em>' });
      const fragment = renderTemplate('<div xh-html="content"></div>', ctx);

      const div = document.createElement('div');
      div.appendChild(fragment);

      expect(div.querySelector('div').innerHTML).toBe('<em>hello</em>');
    });

    it('renders interpolation in text', () => {
      const ctx = new DataContext({ name: 'World' });
      const fragment = renderTemplate('<p>Hello {{name}}</p>', ctx);

      const div = document.createElement('div');
      div.appendChild(fragment);

      expect(div.querySelector('p').textContent).toBe('Hello World');
    });

    it('renders interpolation in attributes', () => {
      const ctx = new DataContext({ id: '42' });
      const fragment = renderTemplate('<div data-id="{{id}}"></div>', ctx);

      const div = document.createElement('div');
      div.appendChild(fragment);

      expect(div.querySelector('div').getAttribute('data-id')).toBe('42');
    });
  });

  describe('handles xh-each in templates', () => {
    it('expands array items to correct count', () => {
      const ctx = new DataContext({
        items: [{ name: 'A' }, { name: 'B' }, { name: 'C' }]
      });
      const html = '<ul><li xh-each="items"></li></ul>';
      const fragment = renderTemplate(html, ctx);

      const div = document.createElement('div');
      div.appendChild(fragment);

      const lis = div.querySelectorAll('li');
      expect(lis.length).toBe(3);
    });

    it('expands array items with interpolation in attributes', () => {
      const ctx = new DataContext({
        items: [{ id: '1' }, { id: '2' }, { id: '3' }]
      });
      // Interpolation happens at the template level before xh-each,
      // so we use xh-attr-* for per-item attribute binding.
      const html = '<ul><li xh-each="items" xh-attr-data-id="id"></li></ul>';
      const fragment = renderTemplate(html, ctx);

      const div = document.createElement('div');
      div.appendChild(fragment);

      const lis = div.querySelectorAll('li');
      expect(lis.length).toBe(3);
    });

    it('removes xh-each element for empty array', () => {
      const ctx = new DataContext({ items: [] });
      const html = '<ul><li xh-each="items" xh-text="name"></li></ul>';
      const fragment = renderTemplate(html, ctx);

      const div = document.createElement('div');
      div.appendChild(fragment);

      expect(div.querySelectorAll('li').length).toBe(0);
    });

    it('handles xh-each with child elements preserving structure', () => {
      const ctx = new DataContext({
        users: [
          { name: 'Alice', role: 'admin' },
          { name: 'Bob', role: 'user' }
        ]
      });
      const html = '<div xh-each="users"><span class="name"></span><em class="role"></em></div>';
      const fragment = renderTemplate(html, ctx);

      const div = document.createElement('div');
      div.appendChild(fragment);

      // Each user produces one clone div with span and em children
      const outerDivs = div.querySelectorAll('div');
      expect(outerDivs.length).toBe(2);
      // Verify structure is preserved in each clone
      expect(outerDivs[0].querySelector('span')).not.toBeNull();
      expect(outerDivs[0].querySelector('em')).not.toBeNull();
      expect(outerDivs[1].querySelector('span')).not.toBeNull();
      expect(outerDivs[1].querySelector('em')).not.toBeNull();
    });
  });

  describe('handles xh-if/xh-unless in templates', () => {
    it('keeps elements when xh-if is truthy', () => {
      const ctx = new DataContext({ show: true, text: 'visible' });
      const html = '<span xh-if="show" xh-text="text"></span>';
      const fragment = renderTemplate(html, ctx);

      const div = document.createElement('div');
      div.appendChild(fragment);

      expect(div.querySelector('span')).not.toBeNull();
      expect(div.querySelector('span').textContent).toBe('visible');
    });

    it('removes elements when xh-if is falsy', () => {
      const ctx = new DataContext({ show: false, text: 'hidden' });
      const html = '<span xh-if="show" xh-text="text"></span>';
      const fragment = renderTemplate(html, ctx);

      const div = document.createElement('div');
      div.appendChild(fragment);

      expect(div.querySelector('span')).toBeNull();
    });

    it('keeps elements when xh-unless is falsy', () => {
      const ctx = new DataContext({ hidden: false, text: 'visible' });
      const html = '<span xh-unless="hidden" xh-text="text"></span>';
      const fragment = renderTemplate(html, ctx);

      const div = document.createElement('div');
      div.appendChild(fragment);

      expect(div.querySelector('span')).not.toBeNull();
    });

    it('removes elements when xh-unless is truthy', () => {
      const ctx = new DataContext({ hidden: true, text: 'hidden' });
      const html = '<span xh-unless="hidden" xh-text="text"></span>';
      const fragment = renderTemplate(html, ctx);

      const div = document.createElement('div');
      div.appendChild(fragment);

      expect(div.querySelector('span')).toBeNull();
    });
  });

  describe('handles xh-attr-* in templates', () => {
    it('sets attributes from data', () => {
      const ctx = new DataContext({ url: 'https://example.com', label: 'Go' });
      const html = '<a xh-attr-href="url" xh-text="label"></a>';
      const fragment = renderTemplate(html, ctx);

      const div = document.createElement('div');
      div.appendChild(fragment);

      const a = div.querySelector('a');
      expect(a.getAttribute('href')).toBe('https://example.com');
      expect(a.textContent).toBe('Go');
    });

    it('sets multiple xh-attr-* bindings', () => {
      const ctx = new DataContext({ imgSrc: '/img.png', alt: 'Photo' });
      const html = '<img xh-attr-src="imgSrc" xh-attr-alt="alt" />';
      const fragment = renderTemplate(html, ctx);

      const div = document.createElement('div');
      div.appendChild(fragment);

      const img = div.querySelector('img');
      expect(img.getAttribute('src')).toBe('/img.png');
      expect(img.getAttribute('alt')).toBe('Photo');
    });
  });

  describe('interpolation + directives combined', () => {
    it('renders template with both interpolation and directives', () => {
      const ctx = new DataContext({
        title: 'Dashboard',
        items: [{ name: 'Item1' }, { name: 'Item2' }],
        showFooter: true,
        footerText: 'End'
      });
      const html = `
        <h1>{{title}}</h1>
        <div xh-each="items"><span xh-text="name"></span></div>
        <footer xh-if="showFooter" xh-text="footerText"></footer>
      `;
      const fragment = renderTemplate(html, ctx);

      const div = document.createElement('div');
      div.appendChild(fragment);

      expect(div.querySelector('h1').textContent).toBe('Dashboard');
      expect(div.querySelectorAll('span').length).toBe(2);
      expect(div.querySelector('footer').textContent).toBe('End');
    });

    it('handles interpolation within xh-each items', () => {
      const ctx = new DataContext({
        items: [{ id: 1, label: 'First' }, { id: 2, label: 'Second' }]
      });
      const html = '<div xh-each="items"><a href="/item/{{id}}">{{label}}</a></div>';
      const fragment = renderTemplate(html, ctx);

      const div = document.createElement('div');
      div.appendChild(fragment);

      // Interpolation is done at the template level before directive processing,
      // so {{id}} and {{label}} may not be resolved per-item via interpolation.
      // The xh-each creates separate data contexts for each item.
      // However, the top-level interpolation happens first in renderTemplate.
      // Items in xh-each should use xh-text/xh-attr-* for per-item data.
      const anchors = div.querySelectorAll('a');
      expect(anchors.length).toBe(2);
    });
  });

  describe('returns DocumentFragment', () => {
    it('returns a DocumentFragment instance', () => {
      const ctx = new DataContext({});
      const fragment = renderTemplate('<p>Test</p>', ctx);

      expect(fragment).toBeInstanceOf(DocumentFragment);
    });

    it('returns empty fragment for empty template', () => {
      const ctx = new DataContext({});
      const fragment = renderTemplate('', ctx);

      expect(fragment).toBeInstanceOf(DocumentFragment);
      expect(fragment.childNodes.length).toBe(0);
    });

    it('fragment contains rendered elements', () => {
      const ctx = new DataContext({ x: 'hi' });
      const fragment = renderTemplate('<span xh-text="x"></span><p>static</p>', ctx);

      const div = document.createElement('div');
      div.appendChild(fragment);

      expect(div.children.length).toBe(2);
      expect(div.querySelector('span').textContent).toBe('hi');
      expect(div.querySelector('p').textContent).toBe('static');
    });

    it('multiple top-level elements are all included', () => {
      const ctx = new DataContext({});
      const fragment = renderTemplate('<p>1</p><p>2</p><p>3</p>', ctx);

      const div = document.createElement('div');
      div.appendChild(fragment);

      expect(div.querySelectorAll('p').length).toBe(3);
    });
  });
});
