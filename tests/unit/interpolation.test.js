/**
 * @jest-environment jsdom
 */

const xhtmlx = require('../../xhtmlx.js');
const { DataContext, interpolate } = xhtmlx._internals;

describe('interpolate', () => {
  describe('simple {{field}} replacement', () => {
    it('replaces a single field token', () => {
      const ctx = new DataContext({ name: 'Alice' });
      expect(interpolate('Hello {{name}}', ctx, false)).toBe('Hello Alice');
    });

    it('replaces a numeric field', () => {
      const ctx = new DataContext({ count: 42 });
      expect(interpolate('Count: {{count}}', ctx, false)).toBe('Count: 42');
    });

    it('replaces a boolean field', () => {
      const ctx = new DataContext({ active: true });
      expect(interpolate('Active: {{active}}', ctx, false)).toBe('Active: true');
    });

    it('handles field at beginning of string', () => {
      const ctx = new DataContext({ name: 'Alice' });
      expect(interpolate('{{name}} is here', ctx, false)).toBe('Alice is here');
    });

    it('handles field at end of string', () => {
      const ctx = new DataContext({ name: 'Alice' });
      expect(interpolate('Name: {{name}}', ctx, false)).toBe('Name: Alice');
    });

    it('handles field as entire string', () => {
      const ctx = new DataContext({ name: 'Alice' });
      expect(interpolate('{{name}}', ctx, false)).toBe('Alice');
    });

    it('trims whitespace inside braces', () => {
      const ctx = new DataContext({ name: 'Alice' });
      expect(interpolate('{{ name }}', ctx, false)).toBe('Alice');
    });
  });

  describe('multiple interpolations in one string', () => {
    it('replaces two tokens', () => {
      const ctx = new DataContext({ first: 'John', last: 'Doe' });
      expect(interpolate('{{first}} {{last}}', ctx, false)).toBe('John Doe');
    });

    it('replaces three tokens', () => {
      const ctx = new DataContext({ a: '1', b: '2', c: '3' });
      expect(interpolate('{{a}}-{{b}}-{{c}}', ctx, false)).toBe('1-2-3');
    });

    it('handles repeated same token', () => {
      const ctx = new DataContext({ x: 'val' });
      expect(interpolate('{{x}} and {{x}}', ctx, false)).toBe('val and val');
    });
  });

  describe('dot notation {{user.name}}', () => {
    it('resolves nested fields', () => {
      const ctx = new DataContext({ user: { name: 'Bob', age: 25 } });
      expect(interpolate('{{user.name}} is {{user.age}}', ctx, false)).toBe('Bob is 25');
    });

    it('resolves deeply nested fields', () => {
      const ctx = new DataContext({ a: { b: { c: 'deep' } } });
      expect(interpolate('{{a.b.c}}', ctx, false)).toBe('deep');
    });
  });

  describe('URI encoding when uriEnc=true', () => {
    it('encodes spaces', () => {
      const ctx = new DataContext({ q: 'hello world' });
      expect(interpolate('{{q}}', ctx, true)).toBe('hello%20world');
    });

    it('encodes special URL characters', () => {
      const ctx = new DataContext({ q: 'a&b=c' });
      expect(interpolate('{{q}}', ctx, true)).toBe('a%26b%3Dc');
    });

    it('does not encode when uriEnc=false', () => {
      const ctx = new DataContext({ q: 'hello world' });
      expect(interpolate('{{q}}', ctx, false)).toBe('hello world');
    });

    it('encodes each token individually', () => {
      const ctx = new DataContext({ a: 'x y', b: 'p&q' });
      expect(interpolate('{{a}}/{{b}}', ctx, true)).toBe('x%20y/p%26q');
    });
  });

  describe('missing fields yield empty string', () => {
    it('replaces missing field with empty string', () => {
      const ctx = new DataContext({});
      expect(interpolate('Hello {{name}}', ctx, false)).toBe('Hello ');
    });

    it('replaces multiple missing fields with empty strings', () => {
      const ctx = new DataContext({});
      expect(interpolate('{{a}} {{b}}', ctx, false)).toBe(' ');
    });

    it('replaces missing nested field with empty string', () => {
      const ctx = new DataContext({ user: {} });
      expect(interpolate('{{user.email}}', ctx, false)).toBe('');
    });
  });

  describe('no interpolation needed (plain string)', () => {
    it('returns the string unchanged when no tokens', () => {
      const ctx = new DataContext({ name: 'Alice' });
      expect(interpolate('Hello world', ctx, false)).toBe('Hello world');
    });

    it('returns empty string for empty input', () => {
      const ctx = new DataContext({});
      expect(interpolate('', ctx, false)).toBe('');
    });

    it('preserves single braces', () => {
      const ctx = new DataContext({});
      expect(interpolate('{ not a token }', ctx, false)).toBe('{ not a token }');
    });
  });

  describe('special characters in values', () => {
    it('handles HTML characters in values', () => {
      const ctx = new DataContext({ text: '<b>bold</b>' });
      expect(interpolate('{{text}}', ctx, false)).toBe('<b>bold</b>');
    });

    it('handles quotes in values', () => {
      const ctx = new DataContext({ msg: 'He said "hello"' });
      expect(interpolate('{{msg}}', ctx, false)).toBe('He said "hello"');
    });

    it('handles newlines in values', () => {
      const ctx = new DataContext({ text: 'line1\nline2' });
      expect(interpolate('{{text}}', ctx, false)).toBe('line1\nline2');
    });

    it('handles unicode in values', () => {
      const ctx = new DataContext({ emoji: '\u2603' });
      expect(interpolate('{{emoji}}', ctx, false)).toBe('\u2603');
    });

    it('handles curly braces in values (not tokens)', () => {
      const ctx = new DataContext({ code: '{a: 1}' });
      expect(interpolate('{{code}}', ctx, false)).toBe('{a: 1}');
    });
  });

  describe('context features in interpolation', () => {
    it('resolves $index', () => {
      const ctx = new DataContext({ name: 'item' }, null, 3);
      expect(interpolate('Item #{{$index}}: {{name}}', ctx, false)).toBe('Item #3: item');
    });

    it('resolves $parent fields', () => {
      const parent = new DataContext({ title: 'List' });
      const child = new DataContext({ name: 'item' }, parent, 0);
      expect(interpolate('{{$parent.title}}: {{name}}', child, false)).toBe('List: item');
    });

    it('resolves $root fields', () => {
      const root = new DataContext({ app: 'TestApp' });
      const child = new DataContext({ name: 'item' }, root, 0);
      expect(interpolate('{{$root.app}} - {{name}}', child, false)).toBe('TestApp - item');
    });

    it('walks parent chain for missing local fields', () => {
      const parent = new DataContext({ color: 'blue' });
      const child = new DataContext({ name: 'widget' }, parent);
      expect(interpolate('{{name}} is {{color}}', child, false)).toBe('widget is blue');
    });
  });
});
