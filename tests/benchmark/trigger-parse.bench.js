/**
 * @jest-environment jsdom
 */

const { bench } = require('./bench-helper');
const xhtmlx = require('../../xhtmlx.js');
const { parseTrigger, parseTimeValue, defaultTrigger, getRestVerb } = xhtmlx._internals;

describe('Benchmark: Trigger parsing', () => {
  test('parseTrigger — simple "click"', () => {
    bench('parseTrigger "click"', 200000, () => {
      parseTrigger('click');
    });
  });

  test('parseTrigger — "load"', () => {
    bench('parseTrigger "load"', 200000, () => {
      parseTrigger('load');
    });
  });

  test('parseTrigger — with modifiers "click once"', () => {
    bench('parseTrigger "click once"', 200000, () => {
      parseTrigger('click once');
    });
  });

  test('parseTrigger — with delay "click delay:200ms"', () => {
    bench('parseTrigger "click delay:200ms"', 200000, () => {
      parseTrigger('click delay:200ms');
    });
  });

  test('parseTrigger — complex "click throttle:500ms once"', () => {
    bench('parseTrigger complex', 200000, () => {
      parseTrigger('click throttle:500ms once');
    });
  });

  test('parseTrigger — multiple "click, change"', () => {
    bench('parseTrigger "click, change"', 100000, () => {
      parseTrigger('click, change');
    });
  });

  test('parseTrigger — debounce "input debounce:300ms"', () => {
    bench('parseTrigger debounce', 200000, () => {
      parseTrigger('input debounce:300ms');
    });
  });

  test('parseTimeValue — "200ms"', () => {
    bench('parseTimeValue "200ms"', 500000, () => {
      parseTimeValue('200ms');
    });
  });

  test('parseTimeValue — "1.5s"', () => {
    bench('parseTimeValue "1.5s"', 500000, () => {
      parseTimeValue('1.5s');
    });
  });

  test('defaultTrigger — for different element types', () => {
    const div = document.createElement('div');
    const form = document.createElement('form');
    const input = document.createElement('input');
    const btn = document.createElement('button');
    bench('defaultTrigger (div)', 200000, () => {
      defaultTrigger(div);
    });
    bench('defaultTrigger (form)', 200000, () => {
      defaultTrigger(form);
    });
    bench('defaultTrigger (input)', 200000, () => {
      defaultTrigger(input);
    });
  });

  test('getRestVerb — detect verb from attributes', () => {
    const el = document.createElement('div');
    el.setAttribute('xh-get', '/api/data');
    bench('getRestVerb (xh-get)', 200000, () => {
      getRestVerb(el);
    });
  });
});
