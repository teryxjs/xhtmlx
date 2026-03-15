/**
 * @jest-environment jsdom
 */

const xhtmlx = require('../../xhtmlx.js');
const { DataContext } = xhtmlx._internals;

describe('DataContext', () => {
  describe('constructor', () => {
    it('stores data, parent, and index', () => {
      const parent = new DataContext({ x: 1 });
      const ctx = new DataContext({ y: 2 }, parent, 3);
      expect(ctx.data).toEqual({ y: 2 });
      expect(ctx.parent).toBe(parent);
      expect(ctx.index).toBe(3);
    });

    it('defaults data to empty object when null', () => {
      const ctx = new DataContext(null);
      expect(ctx.data).toEqual({});
    });

    it('defaults data to empty object when undefined', () => {
      const ctx = new DataContext(undefined);
      expect(ctx.data).toEqual({});
    });

    it('defaults parent to null when not provided', () => {
      const ctx = new DataContext({ a: 1 });
      expect(ctx.parent).toBeNull();
    });

    it('defaults index to null when not provided', () => {
      const ctx = new DataContext({ a: 1 });
      expect(ctx.index).toBeNull();
    });

    it('accepts zero as a valid index', () => {
      const ctx = new DataContext({}, null, 0);
      expect(ctx.index).toBe(0);
    });

    it('stores non-object data (string)', () => {
      const ctx = new DataContext('hello');
      expect(ctx.data).toBe('hello');
    });

    it('stores non-object data (number)', () => {
      const ctx = new DataContext(42);
      expect(ctx.data).toBe(42);
    });

    it('stores array data', () => {
      const arr = [1, 2, 3];
      const ctx = new DataContext(arr);
      expect(ctx.data).toBe(arr);
    });
  });

  describe('resolve() with simple fields', () => {
    it('resolves a top-level field', () => {
      const ctx = new DataContext({ name: 'Alice' });
      expect(ctx.resolve('name')).toBe('Alice');
    });

    it('resolves a numeric value', () => {
      const ctx = new DataContext({ count: 42 });
      expect(ctx.resolve('count')).toBe(42);
    });

    it('resolves a boolean value', () => {
      const ctx = new DataContext({ active: true });
      expect(ctx.resolve('active')).toBe(true);
    });

    it('resolves a falsy boolean value', () => {
      const ctx = new DataContext({ active: false });
      expect(ctx.resolve('active')).toBe(false);
    });

    it('resolves null value', () => {
      const ctx = new DataContext({ value: null });
      expect(ctx.resolve('value')).toBeNull();
    });

    it('resolves zero as a value', () => {
      const ctx = new DataContext({ count: 0 });
      expect(ctx.resolve('count')).toBe(0);
    });

    it('resolves empty string as a value', () => {
      const ctx = new DataContext({ text: '' });
      expect(ctx.resolve('text')).toBe('');
    });
  });

  describe('resolve() with dot notation (nested objects)', () => {
    it('resolves a two-level nested field', () => {
      const ctx = new DataContext({ user: { name: 'Bob' } });
      expect(ctx.resolve('user.name')).toBe('Bob');
    });

    it('resolves a three-level nested field', () => {
      const ctx = new DataContext({ a: { b: { c: 'deep' } } });
      expect(ctx.resolve('a.b.c')).toBe('deep');
    });

    it('resolves an intermediate object', () => {
      const ctx = new DataContext({ user: { name: 'Bob', age: 30 } });
      expect(ctx.resolve('user')).toEqual({ name: 'Bob', age: 30 });
    });

    it('returns undefined for missing nested field', () => {
      const ctx = new DataContext({ user: { name: 'Bob' } });
      expect(ctx.resolve('user.email')).toBeUndefined();
    });

    it('returns undefined when intermediate is not an object', () => {
      const ctx = new DataContext({ user: 'string' });
      expect(ctx.resolve('user.name')).toBeUndefined();
    });
  });

  describe('resolve() with $index', () => {
    it('returns the iteration index', () => {
      const ctx = new DataContext({ item: 'x' }, null, 5);
      expect(ctx.resolve('$index')).toBe(5);
    });

    it('returns 0 as a valid index', () => {
      const ctx = new DataContext({}, null, 0);
      expect(ctx.resolve('$index')).toBe(0);
    });

    it('returns null when no index set', () => {
      const ctx = new DataContext({});
      expect(ctx.resolve('$index')).toBeNull();
    });

    it('returns undefined for $index sub-properties', () => {
      const ctx = new DataContext({}, null, 3);
      expect(ctx.resolve('$index.foo')).toBeUndefined();
    });
  });

  describe('resolve() with $parent', () => {
    it('returns parent data for bare $parent', () => {
      const parent = new DataContext({ title: 'Parent Title' });
      const child = new DataContext({ name: 'Child' }, parent);
      expect(child.resolve('$parent')).toEqual({ title: 'Parent Title' });
    });

    it('resolves a field on parent via $parent.field', () => {
      const parent = new DataContext({ title: 'Parent Title' });
      const child = new DataContext({ name: 'Child' }, parent);
      expect(child.resolve('$parent.title')).toBe('Parent Title');
    });

    it('returns undefined when no parent exists', () => {
      const ctx = new DataContext({ name: 'Root' });
      expect(ctx.resolve('$parent')).toBeUndefined();
    });

    it('returns undefined for $parent.field when no parent exists', () => {
      const ctx = new DataContext({ name: 'Root' });
      expect(ctx.resolve('$parent.name')).toBeUndefined();
    });

    it('chains $parent.$parent for grandparent access', () => {
      const grandparent = new DataContext({ level: 'top' });
      const parent = new DataContext({ level: 'mid' }, grandparent);
      const child = new DataContext({ level: 'bottom' }, parent);
      expect(child.resolve('$parent.$parent.level')).toBe('top');
    });
  });

  describe('resolve() with $root', () => {
    it('returns root data for bare $root', () => {
      const root = new DataContext({ app: 'MyApp' });
      const child = new DataContext({ item: 'x' }, root);
      expect(child.resolve('$root')).toEqual({ app: 'MyApp' });
    });

    it('resolves a field from root via $root.field', () => {
      const root = new DataContext({ app: 'MyApp' });
      const child = new DataContext({ item: 'x' }, root);
      expect(child.resolve('$root.app')).toBe('MyApp');
    });

    it('resolves $root from deeply nested context', () => {
      const root = new DataContext({ app: 'MyApp' });
      const mid = new DataContext({ mid: true }, root);
      const deep = new DataContext({ deep: true }, mid);
      expect(deep.resolve('$root.app')).toBe('MyApp');
    });

    it('$root on a root context returns its own data', () => {
      const root = new DataContext({ app: 'MyApp' });
      expect(root.resolve('$root')).toEqual({ app: 'MyApp' });
    });

    it('$root.field on a root context resolves own field', () => {
      const root = new DataContext({ app: 'MyApp' });
      expect(root.resolve('$root.app')).toBe('MyApp');
    });
  });

  describe('resolve() walking up parent chain', () => {
    it('resolves a field from parent when not in current data', () => {
      const parent = new DataContext({ color: 'blue', name: 'Parent' });
      const child = new DataContext({ name: 'Child' }, parent);
      expect(child.resolve('color')).toBe('blue');
    });

    it('prefers local data over parent data', () => {
      const parent = new DataContext({ name: 'Parent' });
      const child = new DataContext({ name: 'Child' }, parent);
      expect(child.resolve('name')).toBe('Child');
    });

    it('walks multiple parent levels', () => {
      const grandparent = new DataContext({ color: 'red' });
      const parent = new DataContext({ size: 'large' }, grandparent);
      const child = new DataContext({ name: 'Child' }, parent);
      expect(child.resolve('color')).toBe('red');
    });

    it('returns undefined if field not found in any ancestor', () => {
      const parent = new DataContext({ a: 1 });
      const child = new DataContext({ b: 2 }, parent);
      expect(child.resolve('missing')).toBeUndefined();
    });
  });

  describe('resolve() with undefined/missing fields', () => {
    it('returns undefined for missing field on root context', () => {
      const ctx = new DataContext({ name: 'Alice' });
      expect(ctx.resolve('nonexistent')).toBeUndefined();
    });

    it('returns undefined for null path', () => {
      const ctx = new DataContext({ name: 'Alice' });
      expect(ctx.resolve(null)).toBeUndefined();
    });

    it('returns undefined for empty string path', () => {
      const ctx = new DataContext({ name: 'Alice' });
      expect(ctx.resolve('')).toBeUndefined();
    });

    it('returns undefined for deep missing path', () => {
      const ctx = new DataContext({ user: {} });
      expect(ctx.resolve('user.address.city')).toBeUndefined();
    });
  });

  describe('multiple levels of nesting', () => {
    it('handles a complex nested scenario', () => {
      const root = new DataContext({ appName: 'TestApp', users: [{ id: 1 }] });
      const listCtx = new DataContext({ id: 1, name: 'Alice' }, root, 0);
      const detailCtx = new DataContext({ email: 'alice@test.com' }, listCtx, null);

      expect(detailCtx.resolve('email')).toBe('alice@test.com');
      expect(detailCtx.resolve('name')).toBe('Alice');
      expect(detailCtx.resolve('appName')).toBe('TestApp');
      expect(detailCtx.resolve('$parent.name')).toBe('Alice');
      expect(detailCtx.resolve('$parent.$index')).toBe(0);
      expect(detailCtx.resolve('$root.appName')).toBe('TestApp');
    });

    it('handles three levels of iteration context', () => {
      const root = new DataContext({ title: 'Report' });
      const section = new DataContext({ heading: 'Section A' }, root, 0);
      const item = new DataContext({ text: 'Item 1' }, section, 2);

      expect(item.resolve('$index')).toBe(2);
      expect(item.resolve('$parent.$index')).toBe(0);
      expect(item.resolve('text')).toBe('Item 1');
      expect(item.resolve('heading')).toBe('Section A');
      expect(item.resolve('title')).toBe('Report');
    });
  });
});
