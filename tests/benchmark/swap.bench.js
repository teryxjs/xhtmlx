/**
 * @jest-environment jsdom
 */

const { bench } = require('./bench-helper');
const xhtmlx = require('../../xhtmlx.js');
const { performSwap } = xhtmlx._internals;

describe('Benchmark: Swap modes', () => {
  function makeFragment(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    return tpl.content.cloneNode(true);
  }

  test('innerHTML swap — small content', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    bench('swap innerHTML (small)', 50000, () => {
      const frag = makeFragment('<span>Hello</span>');
      performSwap(container, frag, 'innerHTML');
    });
    container.remove();
  });

  test('innerHTML swap — medium content (10 children)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const html = Array.from({ length: 10 }, (_, i) =>
      `<div class="item"><span>${i}</span></div>`
    ).join('');
    bench('swap innerHTML (10 children)', 10000, () => {
      const frag = makeFragment(html);
      performSwap(container, frag, 'innerHTML');
    });
    container.remove();
  });

  test('innerHTML swap — large content (100 children)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const html = Array.from({ length: 100 }, (_, i) =>
      `<div class="item"><span>${i}</span></div>`
    ).join('');
    bench('swap innerHTML (100 children)', 1000, () => {
      const frag = makeFragment(html);
      performSwap(container, frag, 'innerHTML');
    });
    container.remove();
  });

  test('outerHTML swap', () => {
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    bench('swap outerHTML', 20000, () => {
      const target = document.createElement('div');
      wrapper.innerHTML = '';
      wrapper.appendChild(target);
      const frag = makeFragment('<span>replaced</span>');
      performSwap(target, frag, 'outerHTML');
    });
    wrapper.remove();
  });

  test('beforeend swap (append)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    bench('swap beforeend', 50000, () => {
      const frag = makeFragment('<span>appended</span>');
      performSwap(container, frag, 'beforeend');
      // Keep container from growing unbounded
      if (container.childNodes.length > 100) {
        container.innerHTML = '';
      }
    });
    container.remove();
  });

  test('afterbegin swap (prepend)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    bench('swap afterbegin', 50000, () => {
      const frag = makeFragment('<span>prepended</span>');
      performSwap(container, frag, 'afterbegin');
      if (container.childNodes.length > 100) {
        container.innerHTML = '';
      }
    });
    container.remove();
  });

  test('none swap (no DOM mutation)', () => {
    const container = document.createElement('div');
    bench('swap none', 200000, () => {
      const frag = makeFragment('<span>ignored</span>');
      performSwap(container, frag, 'none');
    });
  });
});
