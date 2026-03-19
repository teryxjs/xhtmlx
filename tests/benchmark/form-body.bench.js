/**
 * @jest-environment jsdom
 */

const { bench } = require('./bench-helper');
const xhtmlx = require('../../xhtmlx.js');
const { DataContext, buildRequestBody } = xhtmlx._internals;

describe('Benchmark: Form & request body building', () => {
  test('buildRequestBody — standalone element (no form)', () => {
    const ctx = new DataContext({ name: 'Alice' });
    const el = document.createElement('button');
    document.body.appendChild(el);
    bench('buildRequestBody (no form)', 100000, () => {
      buildRequestBody(el, ctx);
    });
    el.remove();
  });

  test('buildRequestBody — element with xh-vals', () => {
    const ctx = new DataContext({});
    const el = document.createElement('button');
    el.setAttribute('xh-vals', '{"key": "value", "num": 42}');
    document.body.appendChild(el);
    bench('buildRequestBody (xh-vals)', 50000, () => {
      buildRequestBody(el, ctx);
    });
    el.remove();
  });

  test('buildRequestBody — simple form (3 fields)', () => {
    const ctx = new DataContext({});
    const form = document.createElement('form');
    form.innerHTML = `
      <input name="name" value="Alice">
      <input name="email" value="a@b.com">
      <input name="age" value="30">
    `;
    document.body.appendChild(form);
    bench('buildRequestBody (form 3 fields)', 20000, () => {
      buildRequestBody(form, ctx);
    });
    form.remove();
  });

  test('buildRequestBody — form with xh-model inputs', () => {
    const ctx = new DataContext({ name: 'Alice', email: 'a@b.com' });
    const form = document.createElement('form');
    form.innerHTML = `
      <input xh-model="name" value="Alice">
      <input xh-model="email" value="a@b.com">
    `;
    document.body.appendChild(form);
    bench('buildRequestBody (form xh-model)', 20000, () => {
      buildRequestBody(form, ctx);
    });
    form.remove();
  });

  test('buildRequestBody — large form (20 fields)', () => {
    const ctx = new DataContext({});
    const form = document.createElement('form');
    let inputs = '';
    for (let i = 0; i < 20; i++) {
      inputs += `<input name="field${i}" value="value${i}">`;
    }
    form.innerHTML = inputs;
    document.body.appendChild(form);
    bench('buildRequestBody (form 20 fields)', 5000, () => {
      buildRequestBody(form, ctx);
    });
    form.remove();
  });

  test('buildRequestBody — form + xh-vals + xh-body merge', () => {
    const ctx = new DataContext({});
    const form = document.createElement('form');
    form.innerHTML = `
      <input name="name" value="Alice">
      <button xh-vals='{"extra": "data"}'>Submit</button>
    `;
    document.body.appendChild(form);
    const btn = form.querySelector('button');
    bench('buildRequestBody (form + vals merge)', 20000, () => {
      buildRequestBody(btn, ctx);
    });
    form.remove();
  });
});
