/**
 * @jest-environment jsdom
 */

const { bench } = require('./bench-helper');
const xhtmlx = require('../../xhtmlx.js');
const { DataContext, interpolate } = xhtmlx._internals;

describe('Benchmark: Interpolation', () => {
  test('no tokens — passthrough', () => {
    const ctx = new DataContext({ name: 'Alice' });
    bench('interpolate (no tokens)', 500000, () => {
      interpolate('Hello world, no tokens here', ctx, false);
    });
  });

  test('single token', () => {
    const ctx = new DataContext({ name: 'Alice' });
    bench('interpolate (single token)', 200000, () => {
      interpolate('Hello {{name}}!', ctx, false);
    });
  });

  test('multiple tokens (3)', () => {
    const ctx = new DataContext({ first: 'John', last: 'Doe', age: 30 });
    bench('interpolate (3 tokens)', 200000, () => {
      interpolate('{{first}} {{last}}, age {{age}}', ctx, false);
    });
  });

  test('many tokens (6)', () => {
    const ctx = new DataContext({
      a: '1', b: '2', c: '3', d: '4', e: '5', f: '6'
    });
    bench('interpolate (6 tokens)', 100000, () => {
      interpolate('{{a}}-{{b}}-{{c}}-{{d}}-{{e}}-{{f}}', ctx, false);
    });
  });

  test('nested dot path token', () => {
    const ctx = new DataContext({ user: { name: 'Alice', profile: { bio: 'hi' } } });
    bench('interpolate (nested path)', 200000, () => {
      interpolate('Name: {{user.name}}, Bio: {{user.profile.bio}}', ctx, false);
    });
  });

  test('with URI encoding', () => {
    const ctx = new DataContext({ q: 'hello world & more' });
    bench('interpolate (URI encode)', 200000, () => {
      interpolate('/search?q={{q}}', ctx, true);
    });
  });

  test('token-only string (entire string is one token)', () => {
    const ctx = new DataContext({ value: 'result' });
    bench('interpolate (token-only)', 200000, () => {
      interpolate('{{value}}', ctx, false);
    });
  });

  test('realistic template string (HTML-like)', () => {
    const ctx = new DataContext({
      id: 123, title: 'My Post', author: 'Alice', date: '2024-01-15'
    });
    const template = '<div class="post" data-id="{{id}}"><h2>{{title}}</h2><span>by {{author}} on {{date}}</span></div>';
    bench('interpolate (HTML template)', 100000, () => {
      interpolate(template, ctx, false);
    });
  });

  test('long string with few tokens', () => {
    const ctx = new DataContext({ name: 'Alice' });
    const padding = 'x'.repeat(500);
    const str = padding + '{{name}}' + padding;
    bench('interpolate (long string, 1 token)', 100000, () => {
      interpolate(str, ctx, false);
    });
  });
});
