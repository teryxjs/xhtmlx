/**
 * @jest-environment jsdom
 */

/**
 * Comparison: Pure overhead — element/context creation cost
 *
 * Measures the fundamental cost of creating data structures
 * and virtual/real DOM elements in each framework.
 */

const { bench } = require('../bench-helper');
const xhtmlx = require('../../../xhtmlx.js');
const { DataContext } = xhtmlx._internals;
const { h, React } = require('./react-helper');

describe('vs React: Creation overhead', () => {

  test('[xhtmlx] DataContext creation', () => {
    bench('xhtmlx: DataContext create', 200000, () => {
      new DataContext({ name: 'Alice', age: 30, active: true });
    });
  });

  test('[React]  createElement (single)', () => {
    bench('React:  createElement single', 200000, () => {
      h('span', null, 'Alice');
    });
  });

  test('[xhtmlx] DataContext + resolve 3 fields', () => {
    bench('xhtmlx: ctx + resolve×3', 200000, () => {
      const ctx = new DataContext({ name: 'Alice', age: 30, active: true });
      ctx.resolve('name');
      ctx.resolve('age');
      ctx.resolve('active');
    });
  });

  test('[React]  createElement tree (3 children)', () => {
    bench('React:  createElement tree×3', 200000, () => {
      h('div', null,
        h('span', null, 'Alice'),
        h('span', null, 30),
        h('span', null, true)
      );
    });
  });

  test('[xhtmlx] DataContext deep resolve (a.b.c.d)', () => {
    const ctx = new DataContext({ a: { b: { c: { d: 'deep' } } } });
    bench('xhtmlx: deep resolve a.b.c.d', 500000, () => {
      ctx.resolve('a.b.c.d');
    });
  });

  test('[React]  createElement nested (4 levels)', () => {
    bench('React:  createElement nested×4', 500000, () => {
      h('div', null,
        h('div', null,
          h('div', null,
            h('div', null, 'deep')
          )
        )
      );
    });
  });

  test('[xhtmlx] interpolate string (3 tokens)', () => {
    const { interpolate } = xhtmlx._internals;
    const ctx = new DataContext({ a: 'X', b: 'Y', c: 'Z' });
    bench('xhtmlx: interpolate 3 tokens', 200000, () => {
      interpolate('{{a}}-{{b}}-{{c}}', ctx, false);
    });
  });

  test('[React]  template literal (3 vars) + createElement', () => {
    const data = { a: 'X', b: 'Y', c: 'Z' };
    bench('React:  template literal 3 vars', 200000, () => {
      h('span', null, `${data.a}-${data.b}-${data.c}`);
    });
  });
});
