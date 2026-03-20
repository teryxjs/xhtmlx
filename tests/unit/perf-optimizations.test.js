/**
 * @jest-environment jsdom
 */

const xhtmlx = require('../../xhtmlx.js');
const {
  DataContext,
  interpolate,
  renderTemplate,
  applyBindings,
  processEach,
  processElement,
  i18n,
  applyI18n,
} = xhtmlx._internals;

// ---------------------------------------------------------------------------
// Optimization 1: Multi-token interpolation — manual indexOf loop
// (replaces regex+closure; must produce identical output)
// ---------------------------------------------------------------------------

describe('multi-token interpolation (indexOf loop)', () => {
  it('handles two adjacent tokens with no separator', () => {
    const ctx = new DataContext({ a: 'X', b: 'Y' });
    expect(interpolate('{{a}}{{b}}', ctx, false)).toBe('XY');
  });

  it('handles many tokens in a single string', () => {
    const ctx = new DataContext({ a: '1', b: '2', c: '3', d: '4', e: '5' });
    expect(interpolate('{{a}}-{{b}}-{{c}}-{{d}}-{{e}}', ctx, false)).toBe('1-2-3-4-5');
  });

  it('preserves text between tokens', () => {
    const ctx = new DataContext({ x: 'A', y: 'B' });
    expect(interpolate('start-{{x}}-middle-{{y}}-end', ctx, false)).toBe('start-A-middle-B-end');
  });

  it('handles tokens at start, middle, and end', () => {
    const ctx = new DataContext({ a: 'X', b: 'Y', c: 'Z' });
    expect(interpolate('{{a}} mid {{b}} tail {{c}}', ctx, false)).toBe('X mid Y tail Z');
  });

  it('handles missing fields in multi-token string', () => {
    const ctx = new DataContext({ a: 'yes' });
    expect(interpolate('{{a}} {{missing}} {{a}}', ctx, false)).toBe('yes  yes');
  });

  it('handles URI encoding across multiple tokens', () => {
    const ctx = new DataContext({ a: 'hello world', b: 'a&b' });
    expect(interpolate('{{a}}/{{b}}', ctx, true)).toBe('hello%20world/a%26b');
  });

  it('handles tokens with whitespace inside braces', () => {
    const ctx = new DataContext({ x: 'A', y: 'B' });
    expect(interpolate('{{ x }}-{{ y }}', ctx, false)).toBe('A-B');
  });

  it('handles dot-notation in multi-token string', () => {
    const ctx = new DataContext({ user: { first: 'John', last: 'Doe' } });
    expect(interpolate('{{user.first}} {{user.last}}', ctx, false)).toBe('John Doe');
  });

  it('handles $index and $parent in multi-token string', () => {
    const parent = new DataContext({ title: 'List' });
    const child = new DataContext({ name: 'item' }, parent, 2);
    expect(interpolate('#{{$index}}: {{name}} ({{$parent.title}})', child, false))
      .toBe('#2: item (List)');
  });

  it('handles unclosed braces gracefully', () => {
    const ctx = new DataContext({ a: 'X', b: 'Y' });
    // First two tokens resolve, trailing {{ has no closing }}
    expect(interpolate('{{a}}-{{b}}-{{nope', ctx, false)).toBe('X-Y-{{nope');
  });

  it('handles empty tokens in multi-token string', () => {
    const ctx = new DataContext({});
    expect(interpolate('{{}} and {{}}', ctx, false)).toBe(' and ');
  });

  it('handles special characters in values across multiple tokens', () => {
    const ctx = new DataContext({ a: '<b>bold</b>', b: '"quoted"' });
    expect(interpolate('{{a}} {{b}}', ctx, false)).toBe('<b>bold</b> "quoted"');
  });
});

// ---------------------------------------------------------------------------
// Optimization 2: container.contains() replaces ancestor walk in renderTemplate
// (tests that elements inside xh-each are correctly excluded from outer bindings)
// ---------------------------------------------------------------------------

describe('renderTemplate bindEls skip xh-each subtrees', () => {
  it('does not double-apply bindings to elements inside xh-each', () => {
    const html = `
      <div>
        <h1 xh-text="title"></h1>
        <ul>
          <li xh-each="items" xh-text="name"></li>
        </ul>
      </div>
    `;
    const ctx = new DataContext({
      title: 'Users',
      items: [{ name: 'Alice' }, { name: 'Bob' }]
    });
    const frag = renderTemplate(html, ctx);
    const container = document.createElement('div');
    container.appendChild(frag);

    expect(container.querySelector('h1').textContent).toBe('Users');
    const lis = container.querySelectorAll('li');
    expect(lis.length).toBe(2);
    expect(lis[0].textContent).toBe('Alice');
    expect(lis[1].textContent).toBe('Bob');
  });

  it('handles xh-if inside xh-each correctly after container.contains optimization', () => {
    const html = `
      <div>
        <span xh-each="items">
          <em xh-if="active" xh-text="name"></em>
        </span>
      </div>
    `;
    const ctx = new DataContext({
      items: [
        { name: 'A', active: true },
        { name: 'B', active: false },
        { name: 'C', active: true }
      ]
    });
    const frag = renderTemplate(html, ctx);
    const container = document.createElement('div');
    container.appendChild(frag);

    const ems = container.querySelectorAll('em');
    expect(ems.length).toBe(2);
    expect(ems[0].textContent).toBe('A');
    expect(ems[1].textContent).toBe('C');
  });

  it('outer bindings still work when xh-each is present', () => {
    const html = `
      <div>
        <p xh-text="header"></p>
        <span xh-each="list" xh-text="v"></span>
        <p xh-text="footer"></p>
      </div>
    `;
    const ctx = new DataContext({
      header: 'top',
      footer: 'bottom',
      list: [{ v: 'a' }, { v: 'b' }]
    });
    const frag = renderTemplate(html, ctx);
    const container = document.createElement('div');
    container.appendChild(frag);

    const ps = container.querySelectorAll('p');
    expect(ps[0].textContent).toBe('top');
    expect(ps[1].textContent).toBe('bottom');
    const spans = container.querySelectorAll('span');
    expect(spans.length).toBe(2);
    expect(spans[0].textContent).toBe('a');
    expect(spans[1].textContent).toBe('b');
  });

  it('handles nested xh-each with outer bindings', () => {
    const html = `
      <div>
        <h2 xh-text="title"></h2>
        <div xh-each="groups">
          <span xh-each="items" xh-text="name"></span>
        </div>
      </div>
    `;
    const ctx = new DataContext({
      title: 'Groups',
      groups: [
        { items: [{ name: 'A' }, { name: 'B' }] },
        { items: [{ name: 'C' }] }
      ]
    });
    const frag = renderTemplate(html, ctx);
    const container = document.createElement('div');
    container.appendChild(frag);

    expect(container.querySelector('h2').textContent).toBe('Groups');
    const spans = container.querySelectorAll('span');
    expect(spans.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Optimization 3: Merged xh-on-* and i18n attribute scan in processElement
// (verifies both xh-on-* handlers and i18n-* attrs are detected in one pass)
// ---------------------------------------------------------------------------

describe('processElement merged attribute scan', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    i18n._locales = {};
    i18n._locale = null;
    i18n._fallback = 'en';
  });

  afterEach(() => {
    document.body.removeChild(container);
    i18n._locales = {};
    i18n._locale = null;
  });

  it('attaches xh-on-* handler during single-pass scan', () => {
    const el = document.createElement('button');
    el.setAttribute('xh-on-click', 'toggleClass:active');
    container.appendChild(el);

    processElement(el, new DataContext({}), []);

    el.click();
    expect(el.classList.contains('active')).toBe(true);
    el.click();
    expect(el.classList.contains('active')).toBe(false);
  });

  it('detects xh-i18n-* attributes on container and translates descendants', () => {
    i18n.load('en', { hint: 'Enter name' });
    i18n._locale = 'en';

    // processElement calls applyI18n(el) which scans descendants, so
    // the i18n element must be a descendant of the processed element.
    const wrapper = document.createElement('div');
    wrapper.setAttribute('xh-i18n-title', 'hint');  // triggers hasI18nAttr detection
    const child = document.createElement('input');
    child.setAttribute('xh-i18n-placeholder', 'hint');
    wrapper.appendChild(child);
    container.appendChild(wrapper);

    processElement(wrapper, new DataContext({}), []);

    // applyI18n(wrapper) finds child input via querySelectorAll
    expect(child.getAttribute('placeholder')).toBe('Enter name');
  });

  it('handles both xh-on-* and xh-i18n on the same element via locale setter', () => {
    i18n.load('en', { label: 'Click me' });

    const el = document.createElement('button');
    el.setAttribute('xh-on-click', 'addClass:clicked');
    el.setAttribute('xh-i18n', 'label');
    container.appendChild(el);

    processElement(el, new DataContext({}), []);

    // i18n on the element itself is applied via locale setter (global scan)
    i18n.locale = 'en';

    expect(el.textContent).toBe('Click me');
    el.click();
    expect(el.classList.contains('clicked')).toBe(true);
  });

  it('skips i18n when no locale is loaded', () => {
    const el = document.createElement('span');
    el.setAttribute('xh-i18n-title', 'some.key');
    el.textContent = 'original';
    container.appendChild(el);

    processElement(el, new DataContext({}), []);

    // No locale loaded, so i18n should not be applied
    expect(el.textContent).toBe('original');
  });

  it('ignores xh-i18n-vars in i18n attribute detection', () => {
    // xh-i18n-vars should NOT trigger i18n processing by itself
    const el = document.createElement('span');
    el.setAttribute('xh-i18n-vars', '{"name":"test"}');
    el.textContent = 'original';
    container.appendChild(el);

    processElement(el, new DataContext({}), []);

    expect(el.textContent).toBe('original');
  });
});

// ---------------------------------------------------------------------------
// Optimization 4: _classifyAttrs shared helper
// (verify compiled plans still produce correct output)
// ---------------------------------------------------------------------------

describe('_classifyAttrs shared helper (compile plan correctness)', () => {
  it('renders plan-compiled template with static and interpolated attrs', () => {
    const html = '<a href="/users/{{id}}" class="link" xh-text="name"></a>';
    const ctx = new DataContext({ id: 42, name: 'Alice' });

    const frag = renderTemplate(html, ctx);
    const div = document.createElement('div');
    div.appendChild(frag);

    const a = div.querySelector('a');
    expect(a.getAttribute('href')).toBe('/users/42');
    expect(a.getAttribute('class')).toBe('link');
    expect(a.textContent).toBe('Alice');
  });

  it('renders plan-compiled xh-each with mixed attributes', () => {
    const html = `
      <ul>
        <li xh-each="items" xh-text="label" data-id="{{id}}" class="item"></li>
      </ul>
    `;
    const ctx = new DataContext({
      items: [
        { label: 'A', id: '1' },
        { label: 'B', id: '2' }
      ]
    });

    const frag = renderTemplate(html, ctx);
    const div = document.createElement('div');
    div.appendChild(frag);

    const lis = div.querySelectorAll('li');
    expect(lis.length).toBe(2);
    expect(lis[0].textContent).toBe('A');
    expect(lis[0].getAttribute('data-id')).toBe('1');
    expect(lis[0].getAttribute('class')).toBe('item');
    expect(lis[1].textContent).toBe('B');
    expect(lis[1].getAttribute('data-id')).toBe('2');
  });

  it('handles xh-show and xh-class-* in plan', () => {
    const html = '<div xh-show="visible" xh-class-highlight="active"></div>';
    const ctx = new DataContext({ visible: true, active: true });

    const frag = renderTemplate(html, ctx);
    const div = document.createElement('div');
    div.appendChild(frag);

    const el = div.firstElementChild;
    expect(el.style.display).not.toBe('none');
    expect(el.classList.contains('highlight')).toBe(true);
  });

  it('handles xh-attr-* in plan', () => {
    const html = '<img xh-attr-src="url" xh-attr-alt="desc">';
    const ctx = new DataContext({ url: '/img.png', desc: 'A picture' });

    const frag = renderTemplate(html, ctx);
    const div = document.createElement('div');
    div.appendChild(frag);

    const img = div.querySelector('img');
    expect(img.getAttribute('src')).toBe('/img.png');
    expect(img.getAttribute('alt')).toBe('A picture');
  });
});

// ---------------------------------------------------------------------------
// Optimization 5: Removed Array.prototype.slice.call on static NodeLists
// (verify iteration works correctly with raw NodeLists)
// ---------------------------------------------------------------------------

describe('static NodeList iteration (no array conversion)', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('processEach works with many child bindings (NodeList iteration)', () => {
    const el = document.createElement('div');
    el.setAttribute('xh-each', 'items');
    const child = document.createElement('span');
    child.setAttribute('xh-text', 'name');
    el.appendChild(child);
    container.appendChild(el);

    const items = [];
    for (let i = 0; i < 20; i++) items.push({ name: 'item' + i });
    const ctx = new DataContext({ items });
    processEach(el, ctx);

    const spans = container.querySelectorAll('span');
    expect(spans.length).toBe(20);
    expect(spans[0].textContent).toBe('item0');
    expect(spans[19].textContent).toBe('item19');
  });

  it('renderTemplate applies bindings to multiple elements (NodeList iteration)', () => {
    const html = `
      <div>
        <span xh-text="a"></span>
        <span xh-text="b"></span>
        <span xh-text="c"></span>
        <span xh-text="d"></span>
      </div>
    `;
    const ctx = new DataContext({ a: '1', b: '2', c: '3', d: '4' });
    const frag = renderTemplate(html, ctx);
    const div = document.createElement('div');
    div.appendChild(frag);

    const spans = div.querySelectorAll('span');
    expect(spans[0].textContent).toBe('1');
    expect(spans[1].textContent).toBe('2');
    expect(spans[2].textContent).toBe('3');
    expect(spans[3].textContent).toBe('4');
  });

  it('xh-if removal during iteration does not break subsequent elements', () => {
    const html = `
      <div>
        <p xh-if="show1" xh-text="a"></p>
        <p xh-if="show2" xh-text="b"></p>
        <p xh-if="show3" xh-text="c"></p>
      </div>
    `;
    const ctx = new DataContext({ show1: true, show2: false, show3: true, a: 'A', b: 'B', c: 'C' });
    const frag = renderTemplate(html, ctx);
    const div = document.createElement('div');
    div.appendChild(frag);

    const ps = div.querySelectorAll('p');
    expect(ps.length).toBe(2);
    expect(ps[0].textContent).toBe('A');
    expect(ps[1].textContent).toBe('C');
  });
});
