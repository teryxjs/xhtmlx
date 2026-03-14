/**
 * @jest-environment jsdom
 */

const xhtmlx = require('../../xhtmlx.js');
const { performSwap } = xhtmlx._internals;

describe('performSwap', () => {
  let container;

  function makeFragment(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    return document.importNode(tpl.content, true);
  }

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'container';
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (container.parentNode) {
      document.body.removeChild(container);
    }
  });

  describe('innerHTML mode', () => {
    it('replaces inner content of target', () => {
      const target = document.createElement('div');
      target.innerHTML = '<p>old</p>';
      container.appendChild(target);

      const fragment = makeFragment('<span>new</span>');
      const result = performSwap(target, fragment, 'innerHTML');

      expect(target.innerHTML).toBe('<span>new</span>');
      expect(result).toBe(target);
    });

    it('clears existing content before inserting', () => {
      const target = document.createElement('div');
      target.innerHTML = '<p>one</p><p>two</p>';
      container.appendChild(target);

      const fragment = makeFragment('<span>replaced</span>');
      performSwap(target, fragment, 'innerHTML');

      expect(target.querySelectorAll('p').length).toBe(0);
      expect(target.querySelector('span').textContent).toBe('replaced');
    });

    it('handles empty fragment', () => {
      const target = document.createElement('div');
      target.innerHTML = '<p>old</p>';
      container.appendChild(target);

      const fragment = makeFragment('');
      performSwap(target, fragment, 'innerHTML');

      expect(target.innerHTML).toBe('');
    });

    it('returns the target element', () => {
      const target = document.createElement('div');
      container.appendChild(target);

      const fragment = makeFragment('<p>content</p>');
      const result = performSwap(target, fragment, 'innerHTML');

      expect(result).toBe(target);
    });
  });

  describe('outerHTML mode', () => {
    it('replaces the target element entirely', () => {
      const target = document.createElement('div');
      target.id = 'target';
      target.innerHTML = '<p>old</p>';
      container.appendChild(target);

      const fragment = makeFragment('<section>new</section>');
      performSwap(target, fragment, 'outerHTML');

      expect(container.querySelector('#target')).toBeNull();
      expect(container.querySelector('section')).not.toBeNull();
      expect(container.querySelector('section').textContent).toBe('new');
    });

    it('returns the new element when single element child', () => {
      const target = document.createElement('div');
      container.appendChild(target);

      const fragment = makeFragment('<section>new</section>');
      const result = performSwap(target, fragment, 'outerHTML');

      expect(result.tagName).toBe('SECTION');
    });

    it('returns null when fragment has multiple top-level elements', () => {
      const target = document.createElement('div');
      container.appendChild(target);

      const fragment = makeFragment('<p>a</p><p>b</p>');
      const result = performSwap(target, fragment, 'outerHTML');

      // Multiple children, no single element to return
      expect(result).toBeNull();
    });
  });

  describe('beforeend mode', () => {
    it('appends content to the end of target', () => {
      const target = document.createElement('div');
      target.innerHTML = '<p>existing</p>';
      container.appendChild(target);

      const fragment = makeFragment('<span>appended</span>');
      performSwap(target, fragment, 'beforeend');

      expect(target.children.length).toBe(2);
      expect(target.children[0].textContent).toBe('existing');
      expect(target.children[1].textContent).toBe('appended');
    });

    it('returns the target element', () => {
      const target = document.createElement('div');
      container.appendChild(target);

      const fragment = makeFragment('<p>new</p>');
      const result = performSwap(target, fragment, 'beforeend');

      expect(result).toBe(target);
    });

    it('preserves existing content', () => {
      const target = document.createElement('ul');
      target.innerHTML = '<li>1</li><li>2</li>';
      container.appendChild(target);

      const fragment = makeFragment('<li>3</li>');
      performSwap(target, fragment, 'beforeend');

      expect(target.querySelectorAll('li').length).toBe(3);
      expect(target.children[2].textContent).toBe('3');
    });
  });

  describe('afterbegin mode', () => {
    it('prepends content to the beginning of target', () => {
      const target = document.createElement('div');
      target.innerHTML = '<p>existing</p>';
      container.appendChild(target);

      const fragment = makeFragment('<span>prepended</span>');
      performSwap(target, fragment, 'afterbegin');

      expect(target.children.length).toBe(2);
      expect(target.children[0].textContent).toBe('prepended');
      expect(target.children[1].textContent).toBe('existing');
    });

    it('returns the target element', () => {
      const target = document.createElement('div');
      container.appendChild(target);

      const fragment = makeFragment('<p>new</p>');
      const result = performSwap(target, fragment, 'afterbegin');

      expect(result).toBe(target);
    });

    it('works when target is empty', () => {
      const target = document.createElement('div');
      container.appendChild(target);

      const fragment = makeFragment('<p>only</p>');
      performSwap(target, fragment, 'afterbegin');

      expect(target.children.length).toBe(1);
      expect(target.children[0].textContent).toBe('only');
    });
  });

  describe('beforebegin mode', () => {
    it('inserts content before the target element', () => {
      const target = document.createElement('div');
      target.id = 'target';
      container.appendChild(target);

      const fragment = makeFragment('<span>before</span>');
      performSwap(target, fragment, 'beforebegin');

      const children = Array.from(container.children);
      expect(children.length).toBe(2);
      expect(children[0].textContent).toBe('before');
      expect(children[1].id).toBe('target');
    });

    it('returns the parent of the target', () => {
      const target = document.createElement('div');
      container.appendChild(target);

      const fragment = makeFragment('<p>before</p>');
      const result = performSwap(target, fragment, 'beforebegin');

      expect(result).toBe(container);
    });

    it('target remains in the DOM', () => {
      const target = document.createElement('div');
      target.id = 'target';
      container.appendChild(target);

      const fragment = makeFragment('<p>new</p>');
      performSwap(target, fragment, 'beforebegin');

      expect(container.querySelector('#target')).not.toBeNull();
    });
  });

  describe('afterend mode', () => {
    it('inserts content after the target element', () => {
      const target = document.createElement('div');
      target.id = 'target';
      container.appendChild(target);

      const fragment = makeFragment('<span>after</span>');
      performSwap(target, fragment, 'afterend');

      const children = Array.from(container.children);
      expect(children.length).toBe(2);
      expect(children[0].id).toBe('target');
      expect(children[1].textContent).toBe('after');
    });

    it('returns the parent of the target', () => {
      const target = document.createElement('div');
      container.appendChild(target);

      const fragment = makeFragment('<p>after</p>');
      const result = performSwap(target, fragment, 'afterend');

      expect(result).toBe(container);
    });

    it('inserts between target and next sibling', () => {
      const target = document.createElement('div');
      target.id = 'target';
      const next = document.createElement('div');
      next.id = 'next';
      container.appendChild(target);
      container.appendChild(next);

      const fragment = makeFragment('<span>middle</span>');
      performSwap(target, fragment, 'afterend');

      const children = Array.from(container.children);
      expect(children.length).toBe(3);
      expect(children[0].id).toBe('target');
      expect(children[1].textContent).toBe('middle');
      expect(children[2].id).toBe('next');
    });
  });

  describe('delete mode', () => {
    it('removes the target from the DOM', () => {
      const target = document.createElement('div');
      target.id = 'target';
      container.appendChild(target);

      const fragment = makeFragment('');
      performSwap(target, fragment, 'delete');

      expect(container.querySelector('#target')).toBeNull();
    });

    it('returns null', () => {
      const target = document.createElement('div');
      container.appendChild(target);

      const fragment = makeFragment('');
      const result = performSwap(target, fragment, 'delete');

      expect(result).toBeNull();
    });

    it('container has no children after delete of only child', () => {
      const target = document.createElement('div');
      container.appendChild(target);

      const fragment = makeFragment('');
      performSwap(target, fragment, 'delete');

      expect(container.children.length).toBe(0);
    });
  });

  describe('none mode', () => {
    it('does not modify the DOM', () => {
      const target = document.createElement('div');
      target.innerHTML = '<p>untouched</p>';
      container.appendChild(target);

      const fragment = makeFragment('<span>ignored</span>');
      performSwap(target, fragment, 'none');

      expect(target.innerHTML).toBe('<p>untouched</p>');
    });

    it('returns null', () => {
      const target = document.createElement('div');
      container.appendChild(target);

      const fragment = makeFragment('');
      const result = performSwap(target, fragment, 'none');

      expect(result).toBeNull();
    });

    it('target remains in the DOM', () => {
      const target = document.createElement('div');
      target.id = 'target';
      container.appendChild(target);

      const fragment = makeFragment('<p>new</p>');
      performSwap(target, fragment, 'none');

      expect(container.querySelector('#target')).not.toBeNull();
    });
  });

  describe('unknown mode defaults to innerHTML', () => {
    it('falls back to innerHTML behavior for unknown mode', () => {
      const target = document.createElement('div');
      target.innerHTML = '<p>old</p>';
      container.appendChild(target);

      const fragment = makeFragment('<span>new</span>');
      const result = performSwap(target, fragment, 'unknownMode');

      expect(target.innerHTML).toBe('<span>new</span>');
      expect(result).toBe(target);
    });

    it('clears old content with unknown mode', () => {
      const target = document.createElement('div');
      target.innerHTML = '<p>one</p><p>two</p>';
      container.appendChild(target);

      const fragment = makeFragment('<span>replaced</span>');
      performSwap(target, fragment, 'somethingInvalid');

      expect(target.querySelectorAll('p').length).toBe(0);
    });
  });
});
