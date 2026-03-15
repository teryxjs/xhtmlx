/**
 * @jest-environment jsdom
 */

const xhtmlx = require('../../xhtmlx.js');
const { attachOnHandler, processElement } = xhtmlx._internals;

describe('xh-on-* directive', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('toggleClass action', () => {
    it('xh-on-click="toggleClass:active" toggles class', () => {
      const el = document.createElement('button');
      container.appendChild(el);
      attachOnHandler(el, 'click', 'toggleClass:active');

      expect(el.classList.contains('active')).toBe(false);

      el.click();
      expect(el.classList.contains('active')).toBe(true);

      el.click();
      expect(el.classList.contains('active')).toBe(false);
    });

    it('toggleClass preserves existing classes', () => {
      const el = document.createElement('button');
      el.classList.add('btn');
      container.appendChild(el);
      attachOnHandler(el, 'click', 'toggleClass:active');

      el.click();
      expect(el.classList.contains('btn')).toBe(true);
      expect(el.classList.contains('active')).toBe(true);
    });
  });

  describe('addClass action', () => {
    it('xh-on-click="addClass:foo" adds class', () => {
      const el = document.createElement('button');
      container.appendChild(el);
      attachOnHandler(el, 'click', 'addClass:foo');

      expect(el.classList.contains('foo')).toBe(false);

      el.click();
      expect(el.classList.contains('foo')).toBe(true);

      // Clicking again should not throw or cause issues
      el.click();
      expect(el.classList.contains('foo')).toBe(true);
    });
  });

  describe('removeClass action', () => {
    it('xh-on-click="removeClass:foo" removes class', () => {
      const el = document.createElement('button');
      el.classList.add('foo');
      container.appendChild(el);
      attachOnHandler(el, 'click', 'removeClass:foo');

      expect(el.classList.contains('foo')).toBe(true);

      el.click();
      expect(el.classList.contains('foo')).toBe(false);
    });

    it('removing non-existent class does not throw', () => {
      const el = document.createElement('button');
      container.appendChild(el);
      attachOnHandler(el, 'click', 'removeClass:nonexistent');

      expect(() => el.click()).not.toThrow();
    });
  });

  describe('remove action', () => {
    it('xh-on-click="remove" removes element from DOM', () => {
      const el = document.createElement('button');
      container.appendChild(el);
      attachOnHandler(el, 'click', 'remove');

      expect(container.contains(el)).toBe(true);

      el.click();
      expect(container.contains(el)).toBe(false);
    });
  });

  describe('toggle action', () => {
    it('xh-on-click="toggle:#target" toggles display of another element', () => {
      const el = document.createElement('button');
      container.appendChild(el);

      const target = document.createElement('div');
      target.id = 'target';
      container.appendChild(target);

      attachOnHandler(el, 'click', 'toggle:#target');

      // Initially visible (display is "")
      expect(target.style.display).toBe('');

      el.click();
      expect(target.style.display).toBe('none');

      el.click();
      expect(target.style.display).toBe('');
    });

    it('toggle with non-existent selector does not throw', () => {
      const el = document.createElement('button');
      container.appendChild(el);
      attachOnHandler(el, 'click', 'toggle:#nonexistent');

      expect(() => el.click()).not.toThrow();
    });
  });

  describe('dispatch action', () => {
    it('xh-on-click="dispatch:my-event" dispatches custom event', () => {
      const el = document.createElement('button');
      container.appendChild(el);
      attachOnHandler(el, 'click', 'dispatch:my-event');

      const handler = jest.fn();
      el.addEventListener('my-event', handler);

      el.click();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toBeInstanceOf(CustomEvent);
      expect(handler.mock.calls[0][0].bubbles).toBe(true);
    });

    it('dispatch event bubbles up to parent', () => {
      const el = document.createElement('button');
      container.appendChild(el);
      attachOnHandler(el, 'click', 'dispatch:item-selected');

      const handler = jest.fn();
      container.addEventListener('item-selected', handler);

      el.click();
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('non-click events', () => {
    it('xh-on-dblclick works with dblclick event', () => {
      const el = document.createElement('div');
      container.appendChild(el);
      attachOnHandler(el, 'dblclick', 'toggleClass:selected');

      expect(el.classList.contains('selected')).toBe(false);

      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      expect(el.classList.contains('selected')).toBe(true);
    });

    it('xh-on-mouseenter works', () => {
      const el = document.createElement('div');
      container.appendChild(el);
      attachOnHandler(el, 'mouseenter', 'addClass:hovered');

      el.dispatchEvent(new MouseEvent('mouseenter'));
      expect(el.classList.contains('hovered')).toBe(true);
    });
  });

  describe('processElement integration', () => {
    it('processElement attaches xh-on-click handler', () => {
      const el = document.createElement('button');
      el.setAttribute('xh-on-click', 'toggleClass:active');
      container.appendChild(el);

      const { DataContext } = xhtmlx._internals;
      const ctx = new DataContext({});
      processElement(el, ctx, []);

      el.click();
      expect(el.classList.contains('active')).toBe(true);
    });

    it('processElement attaches multiple xh-on-* handlers', () => {
      const el = document.createElement('button');
      el.setAttribute('xh-on-click', 'addClass:clicked');
      el.setAttribute('xh-on-dblclick', 'addClass:double-clicked');
      container.appendChild(el);

      const { DataContext } = xhtmlx._internals;
      const ctx = new DataContext({});
      processElement(el, ctx, []);

      el.click();
      expect(el.classList.contains('clicked')).toBe(true);
      expect(el.classList.contains('double-clicked')).toBe(false);

      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      expect(el.classList.contains('double-clicked')).toBe(true);
    });
  });

  describe('action with colons in argument', () => {
    it('handles arguments with colons correctly', () => {
      const el = document.createElement('button');
      container.appendChild(el);

      const target = document.createElement('div');
      target.id = 'my:target';
      // Use a class-based selector since ID with colon is tricky
      // Test with dispatch action that has colons
      attachOnHandler(el, 'click', 'dispatch:ns:event-name');

      const handler = jest.fn();
      el.addEventListener('ns:event-name', handler);

      el.click();
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
