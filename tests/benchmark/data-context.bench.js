/**
 * @jest-environment jsdom
 */

const { bench } = require('./bench-helper');
const xhtmlx = require('../../xhtmlx.js');
const { DataContext, MutableDataContext, resolveDot } = xhtmlx._internals;

describe('Benchmark: DataContext', () => {
  test('create DataContext (flat object)', () => {
    bench('DataContext create (flat)', 100000, () => {
      new DataContext({ name: 'Alice', age: 30, active: true });
    });
  });

  test('create DataContext with parent chain', () => {
    const parent = new DataContext({ root: true });
    bench('DataContext create (with parent)', 100000, () => {
      new DataContext({ child: true }, parent, 0);
    });
  });

  test('resolve — simple top-level field', () => {
    const ctx = new DataContext({ name: 'Alice', age: 30, email: 'a@b.com' });
    bench('resolve simple field', 200000, () => {
      ctx.resolve('name');
      ctx.resolve('age');
      ctx.resolve('email');
    });
  });

  test('resolve — nested dot path (2 levels)', () => {
    const ctx = new DataContext({ user: { name: 'Alice', profile: { bio: 'hi' } } });
    bench('resolve dot path (2 levels)', 200000, () => {
      ctx.resolve('user.name');
    });
  });

  test('resolve — deep dot path (5 levels)', () => {
    const ctx = new DataContext({
      a: { b: { c: { d: { e: 'deep' } } } }
    });
    bench('resolve dot path (5 levels)', 200000, () => {
      ctx.resolve('a.b.c.d.e');
    });
  });

  test('resolve — $index special variable', () => {
    const parent = new DataContext({ items: [1, 2, 3] });
    const ctx = new DataContext({ val: 'x' }, parent, 7);
    bench('resolve $index', 200000, () => {
      ctx.resolve('$index');
    });
  });

  test('resolve — $parent chain walking', () => {
    const root = new DataContext({ rootVal: 'R' });
    const mid = new DataContext({ midVal: 'M' }, root, 0);
    const leaf = new DataContext({ leafVal: 'L' }, mid, 1);
    bench('resolve $parent.midVal', 200000, () => {
      leaf.resolve('$parent.midVal');
    });
  });

  test('resolve — $root from deep chain', () => {
    const root = new DataContext({ rootVal: 'R' });
    const c1 = new DataContext({}, root, 0);
    const c2 = new DataContext({}, c1, 0);
    const c3 = new DataContext({}, c2, 0);
    bench('resolve $root.rootVal (depth 4)', 200000, () => {
      c3.resolve('$root.rootVal');
    });
  });

  test('resolve — missing field (returns undefined)', () => {
    const ctx = new DataContext({ name: 'Alice' });
    bench('resolve missing field', 200000, () => {
      ctx.resolve('nonexistent');
    });
  });

  test('resolveDot — direct function call', () => {
    const obj = { a: { b: { c: 42 } } };
    const parts = ['a', 'b', 'c'];
    bench('resolveDot direct (3 levels)', 500000, () => {
      resolveDot(obj, parts, 0);
    });
  });

  test('resolveDot — single key (fast path)', () => {
    const obj = { name: 'Alice' };
    const parts = ['name'];
    bench('resolveDot single key (fast path)', 500000, () => {
      resolveDot(obj, parts, 0);
    });
  });

  test('MutableDataContext — create', () => {
    bench('MutableDataContext create', 50000, () => {
      new MutableDataContext({ x: 1, y: 2 });
    });
  });

  test('MutableDataContext — resolve reactive field', () => {
    const ctx = new MutableDataContext({ x: 1, y: 2, z: 3 });
    bench('MutableDataContext resolve', 200000, () => {
      ctx.resolve('x');
      ctx.resolve('y');
    });
  });
});
