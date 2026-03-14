/**
 * @jest-environment jsdom
 */

const xhtmlx = require('../../xhtmlx.js');
const { resolveDot } = xhtmlx._internals;

describe('resolveDot', () => {
  describe('simple property access', () => {
    it('resolves a single-level property', () => {
      expect(resolveDot({ name: 'Alice' }, ['name'])).toBe('Alice');
    });

    it('resolves a numeric property value', () => {
      expect(resolveDot({ count: 42 }, ['count'])).toBe(42);
    });

    it('resolves a boolean property value', () => {
      expect(resolveDot({ active: true }, ['active'])).toBe(true);
    });

    it('resolves a false boolean property value', () => {
      expect(resolveDot({ active: false }, ['active'])).toBe(false);
    });

    it('resolves a null property value', () => {
      expect(resolveDot({ value: null }, ['value'])).toBeNull();
    });

    it('resolves zero value', () => {
      expect(resolveDot({ n: 0 }, ['n'])).toBe(0);
    });

    it('resolves empty string value', () => {
      expect(resolveDot({ text: '' }, ['text'])).toBe('');
    });
  });

  describe('nested property access', () => {
    it('resolves a two-level nested property', () => {
      const obj = { user: { name: 'Bob' } };
      expect(resolveDot(obj, ['user', 'name'])).toBe('Bob');
    });

    it('resolves a three-level nested property', () => {
      const obj = { a: { b: { c: 'deep' } } };
      expect(resolveDot(obj, ['a', 'b', 'c'])).toBe('deep');
    });

    it('resolves an intermediate object', () => {
      const obj = { user: { name: 'Bob', age: 30 } };
      expect(resolveDot(obj, ['user'])).toEqual({ name: 'Bob', age: 30 });
    });

    it('resolves a deeply nested property (4 levels)', () => {
      const obj = { w: { x: { y: { z: 'found' } } } };
      expect(resolveDot(obj, ['w', 'x', 'y', 'z'])).toBe('found');
    });
  });

  describe('missing property returns undefined', () => {
    it('returns undefined for missing top-level property', () => {
      expect(resolveDot({ a: 1 }, ['b'])).toBeUndefined();
    });

    it('returns undefined for missing nested property', () => {
      expect(resolveDot({ user: { name: 'Bob' } }, ['user', 'email'])).toBeUndefined();
    });

    it('returns undefined for missing intermediate property', () => {
      expect(resolveDot({ a: {} }, ['a', 'b', 'c'])).toBeUndefined();
    });

    it('returns undefined for path through non-object', () => {
      expect(resolveDot({ a: 'string' }, ['a', 'b'])).toBeUndefined();
    });

    it('returns undefined for path through number', () => {
      expect(resolveDot({ a: 42 }, ['a', 'b'])).toBeUndefined();
    });

    it('returns undefined for path through boolean', () => {
      expect(resolveDot({ a: true }, ['a', 'b'])).toBeUndefined();
    });
  });

  describe('null/undefined object handling', () => {
    it('returns undefined when object is null', () => {
      expect(resolveDot(null, ['name'])).toBeUndefined();
    });

    it('returns undefined when object is undefined', () => {
      expect(resolveDot(undefined, ['name'])).toBeUndefined();
    });

    it('returns undefined when intermediate is null', () => {
      expect(resolveDot({ a: null }, ['a', 'b'])).toBeUndefined();
    });

    it('returns undefined when intermediate is undefined', () => {
      expect(resolveDot({ a: undefined }, ['a', 'b'])).toBeUndefined();
    });
  });

  describe('array index access', () => {
    it('accesses array element by index', () => {
      const obj = { items: ['a', 'b', 'c'] };
      expect(resolveDot(obj, ['items', '0'])).toBe('a');
    });

    it('accesses second array element', () => {
      const obj = { items: ['a', 'b', 'c'] };
      expect(resolveDot(obj, ['items', '1'])).toBe('b');
    });

    it('accesses nested object inside array', () => {
      const obj = { users: [{ name: 'Alice' }, { name: 'Bob' }] };
      expect(resolveDot(obj, ['users', '0', 'name'])).toBe('Alice');
    });

    it('returns undefined for out-of-bounds array index', () => {
      const obj = { items: ['a'] };
      expect(resolveDot(obj, ['items', '5'])).toBeUndefined();
    });

    it('accesses array length property', () => {
      const obj = { items: [1, 2, 3] };
      expect(resolveDot(obj, ['items', 'length'])).toBe(3);
    });
  });

  describe('edge cases', () => {
    it('handles empty parts array by returning the object itself', () => {
      const obj = { a: 1 };
      expect(resolveDot(obj, [])).toEqual({ a: 1 });
    });

    it('handles empty object', () => {
      expect(resolveDot({}, ['anything'])).toBeUndefined();
    });

    it('handles property with special characters as key', () => {
      const obj = { 'my-key': 'value' };
      expect(resolveDot(obj, ['my-key'])).toBe('value');
    });

    it('handles property with numeric string key', () => {
      const obj = { '0': 'zero', '1': 'one' };
      expect(resolveDot(obj, ['0'])).toBe('zero');
    });
  });
});
