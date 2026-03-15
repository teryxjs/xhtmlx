/**
 * @jest-environment jsdom
 */

const xhtmlx = require('../../xhtmlx.js');
const { DataContext, applyBindings, processEach } = xhtmlx._internals;

describe('xh-model pre-fill (Option C)', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('text input', () => {
    it('sets value on text input', () => {
      const el = document.createElement('input');
      el.setAttribute('type', 'text');
      el.setAttribute('xh-model', 'username');
      container.appendChild(el);

      const ctx = new DataContext({ username: 'Alice' });
      applyBindings(el, ctx);

      expect(el.value).toBe('Alice');
    });

    it('sets value on email input', () => {
      const el = document.createElement('input');
      el.setAttribute('type', 'email');
      el.setAttribute('xh-model', 'email');
      container.appendChild(el);

      const ctx = new DataContext({ email: 'alice@example.com' });
      applyBindings(el, ctx);

      expect(el.value).toBe('alice@example.com');
    });

    it('sets value on number input', () => {
      const el = document.createElement('input');
      el.setAttribute('type', 'number');
      el.setAttribute('xh-model', 'age');
      container.appendChild(el);

      const ctx = new DataContext({ age: 30 });
      applyBindings(el, ctx);

      expect(el.value).toBe('30');
    });

    it('sets value on hidden input', () => {
      const el = document.createElement('input');
      el.setAttribute('type', 'hidden');
      el.setAttribute('xh-model', 'token');
      container.appendChild(el);

      const ctx = new DataContext({ token: 'abc123' });
      applyBindings(el, ctx);

      expect(el.value).toBe('abc123');
    });

    it('sets value on input with no type (defaults to text)', () => {
      const el = document.createElement('input');
      el.setAttribute('xh-model', 'name');
      container.appendChild(el);

      const ctx = new DataContext({ name: 'Bob' });
      applyBindings(el, ctx);

      expect(el.value).toBe('Bob');
    });
  });

  describe('checkbox', () => {
    it('sets checked to true when value is true', () => {
      const el = document.createElement('input');
      el.setAttribute('type', 'checkbox');
      el.setAttribute('xh-model', 'active');
      container.appendChild(el);

      const ctx = new DataContext({ active: true });
      applyBindings(el, ctx);

      expect(el.checked).toBe(true);
    });

    it('sets checked to false when value is false', () => {
      const el = document.createElement('input');
      el.setAttribute('type', 'checkbox');
      el.setAttribute('xh-model', 'active');
      el.checked = true;
      container.appendChild(el);

      const ctx = new DataContext({ active: false });
      applyBindings(el, ctx);

      expect(el.checked).toBe(false);
    });

    it('sets checked to true for truthy value (1)', () => {
      const el = document.createElement('input');
      el.setAttribute('type', 'checkbox');
      el.setAttribute('xh-model', 'flag');
      container.appendChild(el);

      const ctx = new DataContext({ flag: 1 });
      applyBindings(el, ctx);

      expect(el.checked).toBe(true);
    });

    it('sets checked to false for falsy value (0)', () => {
      const el = document.createElement('input');
      el.setAttribute('type', 'checkbox');
      el.setAttribute('xh-model', 'flag');
      container.appendChild(el);

      const ctx = new DataContext({ flag: 0 });
      applyBindings(el, ctx);

      expect(el.checked).toBe(false);
    });

    it('sets checked to false for null', () => {
      const el = document.createElement('input');
      el.setAttribute('type', 'checkbox');
      el.setAttribute('xh-model', 'flag');
      container.appendChild(el);

      const ctx = new DataContext({ flag: null });
      applyBindings(el, ctx);

      expect(el.checked).toBe(false);
    });

    it('sets checked to false for undefined', () => {
      const el = document.createElement('input');
      el.setAttribute('type', 'checkbox');
      el.setAttribute('xh-model', 'missing');
      container.appendChild(el);

      const ctx = new DataContext({});
      applyBindings(el, ctx);

      expect(el.checked).toBe(false);
    });
  });

  describe('radio button', () => {
    it('sets checked when radio value matches data value', () => {
      const el = document.createElement('input');
      el.setAttribute('type', 'radio');
      el.setAttribute('xh-model', 'color');
      el.value = 'blue';
      container.appendChild(el);

      const ctx = new DataContext({ color: 'blue' });
      applyBindings(el, ctx);

      expect(el.checked).toBe(true);
    });

    it('does not check when radio value does not match data value', () => {
      const el = document.createElement('input');
      el.setAttribute('type', 'radio');
      el.setAttribute('xh-model', 'color');
      el.value = 'red';
      container.appendChild(el);

      const ctx = new DataContext({ color: 'blue' });
      applyBindings(el, ctx);

      expect(el.checked).toBe(false);
    });

    it('uses strict equality — number does not match string value', () => {
      const el = document.createElement('input');
      el.setAttribute('type', 'radio');
      el.setAttribute('xh-model', 'choice');
      el.value = '1';
      container.appendChild(el);

      const ctx = new DataContext({ choice: 1 }); // number 1 !== string "1"
      applyBindings(el, ctx);

      expect(el.checked).toBe(false);
    });

    it('matches when types are the same', () => {
      const el = document.createElement('input');
      el.setAttribute('type', 'radio');
      el.setAttribute('xh-model', 'choice');
      el.value = '1';
      container.appendChild(el);

      const ctx = new DataContext({ choice: '1' }); // string === string
      applyBindings(el, ctx);

      expect(el.checked).toBe(true);
    });
  });

  describe('select', () => {
    it('sets the matching option as selected', () => {
      const el = document.createElement('select');
      el.setAttribute('xh-model', 'country');
      el.innerHTML = '<option value="us">US</option><option value="uk">UK</option><option value="ca">CA</option>';
      container.appendChild(el);

      const ctx = new DataContext({ country: 'uk' });
      applyBindings(el, ctx);

      expect(el.value).toBe('uk');
      expect(el.options[1].selected).toBe(true);
    });

    it('deselects previously selected option', () => {
      const el = document.createElement('select');
      el.setAttribute('xh-model', 'country');
      el.innerHTML = '<option value="us" selected>US</option><option value="uk">UK</option>';
      container.appendChild(el);

      const ctx = new DataContext({ country: 'uk' });
      applyBindings(el, ctx);

      expect(el.options[0].selected).toBe(false);
      expect(el.options[1].selected).toBe(true);
    });

    it('uses strict equality — number does not match string option value', () => {
      const el = document.createElement('select');
      el.setAttribute('xh-model', 'level');
      el.innerHTML = '<option value="1">One</option><option value="2">Two</option>';
      container.appendChild(el);

      const ctx = new DataContext({ level: 2 }); // number 2 !== string "2"
      applyBindings(el, ctx);

      expect(el.options[1].selected).toBe(false);
    });

    it('matches when data type matches option value type', () => {
      const el = document.createElement('select');
      el.setAttribute('xh-model', 'level');
      el.innerHTML = '<option value="1">One</option><option value="2">Two</option>';
      container.appendChild(el);

      const ctx = new DataContext({ level: '2' }); // string === string
      applyBindings(el, ctx);

      expect(el.options[1].selected).toBe(true);
    });
  });

  describe('textarea', () => {
    it('sets value on textarea', () => {
      const el = document.createElement('textarea');
      el.setAttribute('xh-model', 'bio');
      container.appendChild(el);

      const ctx = new DataContext({ bio: 'Hello world' });
      applyBindings(el, ctx);

      expect(el.value).toBe('Hello world');
    });

    it('sets empty string for null value', () => {
      const el = document.createElement('textarea');
      el.setAttribute('xh-model', 'bio');
      container.appendChild(el);

      const ctx = new DataContext({ bio: null });
      applyBindings(el, ctx);

      expect(el.value).toBe('');
    });
  });

  describe('null and undefined values', () => {
    it('sets empty string on text input for null', () => {
      const el = document.createElement('input');
      el.setAttribute('type', 'text');
      el.setAttribute('xh-model', 'name');
      el.value = 'existing';
      container.appendChild(el);

      const ctx = new DataContext({ name: null });
      applyBindings(el, ctx);

      expect(el.value).toBe('');
    });

    it('sets empty string on text input for undefined (missing field)', () => {
      const el = document.createElement('input');
      el.setAttribute('type', 'text');
      el.setAttribute('xh-model', 'missing');
      el.value = 'existing';
      container.appendChild(el);

      const ctx = new DataContext({});
      applyBindings(el, ctx);

      expect(el.value).toBe('');
    });

    it('sets empty string on textarea for undefined', () => {
      const el = document.createElement('textarea');
      el.setAttribute('xh-model', 'missing');
      el.value = 'existing';
      container.appendChild(el);

      const ctx = new DataContext({});
      applyBindings(el, ctx);

      expect(el.value).toBe('');
    });
  });

  describe('dot notation', () => {
    it('resolves nested field via dot notation (xh-model="user.name")', () => {
      const el = document.createElement('input');
      el.setAttribute('type', 'text');
      el.setAttribute('xh-model', 'user.name');
      container.appendChild(el);

      const ctx = new DataContext({ user: { name: 'Alice' } });
      applyBindings(el, ctx);

      expect(el.value).toBe('Alice');
    });

    it('resolves deeply nested field', () => {
      const el = document.createElement('input');
      el.setAttribute('type', 'text');
      el.setAttribute('xh-model', 'a.b.c');
      container.appendChild(el);

      const ctx = new DataContext({ a: { b: { c: 'deep' } } });
      applyBindings(el, ctx);

      expect(el.value).toBe('deep');
    });
  });

  describe('works inside xh-each', () => {
    it('pre-fills inputs inside iterated items', () => {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('xh-each', 'users');
      wrapper.innerHTML = '<input type="text" xh-model="name" />';
      container.appendChild(wrapper);

      const ctx = new DataContext({
        users: [
          { name: 'Alice' },
          { name: 'Bob' },
          { name: 'Charlie' }
        ]
      });

      processEach(wrapper, ctx);

      const inputs = container.querySelectorAll('input');
      expect(inputs.length).toBe(3);
      expect(inputs[0].value).toBe('Alice');
      expect(inputs[1].value).toBe('Bob');
      expect(inputs[2].value).toBe('Charlie');
    });
  });

  describe('combined with other directives', () => {
    it('xh-model works alongside xh-attr-*', () => {
      const el = document.createElement('input');
      el.setAttribute('type', 'text');
      el.setAttribute('xh-model', 'value');
      el.setAttribute('xh-attr-placeholder', 'hint');
      container.appendChild(el);

      const ctx = new DataContext({ value: 'Hello', hint: 'Enter text' });
      applyBindings(el, ctx);

      expect(el.value).toBe('Hello');
      expect(el.getAttribute('placeholder')).toBe('Enter text');
    });

    it('xh-if removes element before xh-model runs', () => {
      const el = document.createElement('input');
      el.setAttribute('type', 'text');
      el.setAttribute('xh-if', 'show');
      el.setAttribute('xh-model', 'value');
      container.appendChild(el);

      const ctx = new DataContext({ show: false, value: 'Hello' });
      const result = applyBindings(el, ctx);

      expect(result).toBe(false);
      expect(container.contains(el)).toBe(false);
    });
  });
});
