/**
 * @jest-environment jsdom
 */

const xhtmlx = require('../../xhtmlx.js');
const { parseTrigger, parseTimeValue, defaultTrigger } = xhtmlx._internals;

describe('parseTrigger', () => {
  describe('simple event names', () => {
    it('parses "click"', () => {
      const specs = parseTrigger('click');
      expect(specs).toHaveLength(1);
      expect(specs[0].event).toBe('click');
      expect(specs[0].delay).toBe(0);
      expect(specs[0].throttle).toBe(0);
      expect(specs[0].once).toBe(false);
      expect(specs[0].changed).toBe(false);
      expect(specs[0].from).toBeNull();
      expect(specs[0].interval).toBe(0);
    });

    it('parses "submit"', () => {
      const specs = parseTrigger('submit');
      expect(specs).toHaveLength(1);
      expect(specs[0].event).toBe('submit');
    });

    it('parses "change"', () => {
      const specs = parseTrigger('change');
      expect(specs).toHaveLength(1);
      expect(specs[0].event).toBe('change');
    });

    it('parses "keyup"', () => {
      const specs = parseTrigger('keyup');
      expect(specs).toHaveLength(1);
      expect(specs[0].event).toBe('keyup');
    });

    it('parses "mouseenter"', () => {
      const specs = parseTrigger('mouseenter');
      expect(specs).toHaveLength(1);
      expect(specs[0].event).toBe('mouseenter');
    });
  });

  describe('"load" trigger', () => {
    it('parses "load"', () => {
      const specs = parseTrigger('load');
      expect(specs).toHaveLength(1);
      expect(specs[0].event).toBe('load');
    });
  });

  describe('"every Ns" trigger', () => {
    it('parses "every 5s"', () => {
      const specs = parseTrigger('every 5s');
      expect(specs).toHaveLength(1);
      expect(specs[0].event).toBe('every');
      expect(specs[0].interval).toBe(5000);
    });

    it('parses "every 300ms"', () => {
      const specs = parseTrigger('every 300ms');
      expect(specs).toHaveLength(1);
      expect(specs[0].event).toBe('every');
      expect(specs[0].interval).toBe(300);
    });

    it('parses "every 1s"', () => {
      const specs = parseTrigger('every 1s');
      expect(specs).toHaveLength(1);
      expect(specs[0].event).toBe('every');
      expect(specs[0].interval).toBe(1000);
    });

    it('parses "every 100ms"', () => {
      const specs = parseTrigger('every 100ms');
      expect(specs).toHaveLength(1);
      expect(specs[0].event).toBe('every');
      expect(specs[0].interval).toBe(100);
    });
  });

  describe('modifiers', () => {
    it('parses "click once"', () => {
      const specs = parseTrigger('click once');
      expect(specs).toHaveLength(1);
      expect(specs[0].event).toBe('click');
      expect(specs[0].once).toBe(true);
    });

    it('parses "keyup changed delay:300ms"', () => {
      const specs = parseTrigger('keyup changed delay:300ms');
      expect(specs).toHaveLength(1);
      expect(specs[0].event).toBe('keyup');
      expect(specs[0].changed).toBe(true);
      expect(specs[0].delay).toBe(300);
    });

    it('parses "click throttle:500ms"', () => {
      const specs = parseTrigger('click throttle:500ms');
      expect(specs).toHaveLength(1);
      expect(specs[0].event).toBe('click');
      expect(specs[0].throttle).toBe(500);
    });

    it('parses "keyup delay:2s"', () => {
      const specs = parseTrigger('keyup delay:2s');
      expect(specs).toHaveLength(1);
      expect(specs[0].event).toBe('keyup');
      expect(specs[0].delay).toBe(2000);
    });

    it('parses multiple modifiers together', () => {
      const specs = parseTrigger('keyup once changed delay:100ms');
      expect(specs).toHaveLength(1);
      expect(specs[0].event).toBe('keyup');
      expect(specs[0].once).toBe(true);
      expect(specs[0].changed).toBe(true);
      expect(specs[0].delay).toBe(100);
    });
  });

  describe('"from:selector" modifier', () => {
    it('parses "click from:#other-button"', () => {
      const specs = parseTrigger('click from:#other-button');
      expect(specs).toHaveLength(1);
      expect(specs[0].event).toBe('click');
      expect(specs[0].from).toBe('#other-button');
    });

    it('parses "click from:.some-class"', () => {
      const specs = parseTrigger('click from:.some-class');
      expect(specs).toHaveLength(1);
      expect(specs[0].from).toBe('.some-class');
    });

    it('combines from with other modifiers', () => {
      const specs = parseTrigger('click once from:#btn');
      expect(specs).toHaveLength(1);
      expect(specs[0].once).toBe(true);
      expect(specs[0].from).toBe('#btn');
    });
  });

  describe('multiple triggers (comma-separated)', () => {
    it('parses "click, mouseenter"', () => {
      const specs = parseTrigger('click, mouseenter');
      expect(specs).toHaveLength(2);
      expect(specs[0].event).toBe('click');
      expect(specs[1].event).toBe('mouseenter');
    });

    it('parses "click once, keyup changed delay:200ms"', () => {
      const specs = parseTrigger('click once, keyup changed delay:200ms');
      expect(specs).toHaveLength(2);
      expect(specs[0].event).toBe('click');
      expect(specs[0].once).toBe(true);
      expect(specs[1].event).toBe('keyup');
      expect(specs[1].changed).toBe(true);
      expect(specs[1].delay).toBe(200);
    });

    it('parses three triggers', () => {
      const specs = parseTrigger('click, mouseenter, mouseleave');
      expect(specs).toHaveLength(3);
      expect(specs[0].event).toBe('click');
      expect(specs[1].event).toBe('mouseenter');
      expect(specs[2].event).toBe('mouseleave');
    });
  });

  describe('empty/null input', () => {
    it('returns empty array for null', () => {
      expect(parseTrigger(null)).toEqual([]);
    });

    it('returns empty array for undefined', () => {
      expect(parseTrigger(undefined)).toEqual([]);
    });

    it('returns empty array for empty string', () => {
      expect(parseTrigger('')).toEqual([]);
    });

    it('returns empty array for whitespace-only string', () => {
      expect(parseTrigger('   ')).toEqual([]);
    });
  });
});

describe('parseTimeValue', () => {
  it('parses "300ms" to 300', () => {
    expect(parseTimeValue('300ms')).toBe(300);
  });

  it('parses "2s" to 2000', () => {
    expect(parseTimeValue('2s')).toBe(2000);
  });

  it('parses "1s" to 1000', () => {
    expect(parseTimeValue('1s')).toBe(1000);
  });

  it('parses "0ms" to 0', () => {
    expect(parseTimeValue('0ms')).toBe(0);
  });

  it('parses "500ms" to 500', () => {
    expect(parseTimeValue('500ms')).toBe(500);
  });

  it('parses "10s" to 10000', () => {
    expect(parseTimeValue('10s')).toBe(10000);
  });

  it('returns 0 for invalid format', () => {
    expect(parseTimeValue('abc')).toBe(0);
  });

  it('returns 0 for missing unit', () => {
    expect(parseTimeValue('300')).toBe(0);
  });

  it('returns 0 for empty string', () => {
    expect(parseTimeValue('')).toBe(0);
  });
});

describe('defaultTrigger', () => {
  it('returns "submit" for form elements', () => {
    const form = document.createElement('form');
    expect(defaultTrigger(form)).toBe('submit');
  });

  it('returns "change" for input elements', () => {
    const input = document.createElement('input');
    expect(defaultTrigger(input)).toBe('change');
  });

  it('returns "change" for select elements', () => {
    const select = document.createElement('select');
    expect(defaultTrigger(select)).toBe('change');
  });

  it('returns "change" for textarea elements', () => {
    const textarea = document.createElement('textarea');
    expect(defaultTrigger(textarea)).toBe('change');
  });

  it('returns "click" for button elements', () => {
    const button = document.createElement('button');
    expect(defaultTrigger(button)).toBe('click');
  });

  it('returns "click" for div elements', () => {
    const div = document.createElement('div');
    expect(defaultTrigger(div)).toBe('click');
  });

  it('returns "click" for anchor elements', () => {
    const a = document.createElement('a');
    expect(defaultTrigger(a)).toBe('click');
  });

  it('returns "click" for span elements', () => {
    const span = document.createElement('span');
    expect(defaultTrigger(span)).toBe('click');
  });
});
