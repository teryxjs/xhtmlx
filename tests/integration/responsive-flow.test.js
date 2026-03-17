/**
 * @jest-environment jsdom
 */

const xhtmlx = require('../../xhtmlx.js');
const { config, templateCache } = xhtmlx._internals;


beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1200 });
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 800 });
  config.breakpoints = { mobile: 768, tablet: 1024 };
  document.body.innerHTML = '';
  global.fetch = jest.fn();
  xhtmlx.clearTemplateCache();
  xhtmlx.clearResponseCache();
  jest.useFakeTimers({ doNotFake: ['nextTick'] });
});

afterEach(() => {
  jest.useRealTimers();
  delete global.fetch;
});

function mockFetchJSON(data, status = 200) {
  global.fetch.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status: status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data))
  });
}

describe('Responsive flow', () => {
  test('GET with xh-template-mobile uses mobile template when viewport is narrow', async () => {
    window.innerWidth = 400;
    mockFetchJSON({ title: 'Hello' });

    templateCache.set('/mobile.html', Promise.resolve('<p class="result" xh-text="title"></p>'));
    templateCache.set('/default.html', Promise.resolve('<h1 class="result" xh-text="title"></h1>'));

    document.body.innerHTML = `
      <div id="widget"
           xh-get="/api/data"
           xh-trigger="load"
           xh-template="/default.html"
           xh-template-mobile="/mobile.html">
      </div>
    `;

    xhtmlx.process(document.body);
    await jest.runAllTimersAsync();

    var result = document.querySelector('.result');
    expect(result).not.toBeNull();
    expect(result.tagName).toBe('P');
    expect(result.textContent).toBe('Hello');
  });

  test('GET with xh-template falls back to default when no breakpoint template exists', async () => {
    window.innerWidth = 1200;
    mockFetchJSON({ title: 'Hello' });

    templateCache.set('/mobile.html', Promise.resolve('<p class="result" xh-text="title"></p>'));
    templateCache.set('/default.html', Promise.resolve('<h1 class="result" xh-text="title"></h1>'));

    document.body.innerHTML = `
      <div id="widget"
           xh-get="/api/data"
           xh-trigger="load"
           xh-template="/default.html"
           xh-template-mobile="/mobile.html">
      </div>
    `;

    xhtmlx.process(document.body);
    await jest.runAllTimersAsync();

    var result = document.querySelector('.result');
    expect(result).not.toBeNull();
    expect(result.tagName).toBe('H1');
    expect(result.textContent).toBe('Hello');
  });

  test('xh-if="$viewport.mobile" shows element when viewport is narrow', async () => {
    window.innerWidth = 400;
    mockFetchJSON({ msg: 'hi' });

    document.body.innerHTML = `
      <div id="widget" xh-get="/api/data" xh-trigger="load">
        <template>
          <span class="mobile-only" xh-if="$viewport.mobile" xh-text="msg"></span>
          <span class="desktop-only" xh-if="$viewport.desktop" xh-text="msg"></span>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await jest.runAllTimersAsync();

    var mobileEl = document.querySelector('.mobile-only');
    var desktopEl = document.querySelector('.desktop-only');
    expect(mobileEl).not.toBeNull();
    expect(mobileEl.textContent).toBe('hi');
    expect(desktopEl).toBeNull();
  });

  test('xh-if="$viewport.desktop" hides element when viewport is narrow', async () => {
    window.innerWidth = 400;
    mockFetchJSON({ msg: 'hi' });

    document.body.innerHTML = `
      <div id="widget" xh-get="/api/data" xh-trigger="load">
        <template>
          <span class="desktop-only" xh-if="$viewport.desktop" xh-text="msg"></span>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await jest.runAllTimersAsync();

    var desktopEl = document.querySelector('.desktop-only');
    expect(desktopEl).toBeNull();
  });

  test('$viewport.breakpoint is accessible in xh-text', async () => {
    window.innerWidth = 900;
    mockFetchJSON({});

    document.body.innerHTML = `
      <div id="widget" xh-get="/api/data" xh-trigger="load">
        <template>
          <span class="bp" xh-text="$viewport.breakpoint"></span>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await jest.runAllTimersAsync();

    var bpEl = document.querySelector('.bp');
    expect(bpEl).not.toBeNull();
    expect(bpEl.textContent).toBe('tablet');
  });

  test('$viewport.width is accessible via interpolation', async () => {
    window.innerWidth = 1200;
    mockFetchJSON({});

    document.body.innerHTML = `
      <div id="widget" xh-get="/api/data" xh-trigger="load">
        <template>
          <span class="width" xh-text="$viewport.width"></span>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await jest.runAllTimersAsync();

    var widthEl = document.querySelector('.width');
    expect(widthEl).not.toBeNull();
    expect(widthEl.textContent).toBe('1200');
  });

  test('xh-template-tablet is used for tablet viewport', async () => {
    window.innerWidth = 900;
    mockFetchJSON({ title: 'Hello' });

    templateCache.set('/tablet.html', Promise.resolve('<div class="result">tablet: <span xh-text="title"></span></div>'));
    templateCache.set('/default.html', Promise.resolve('<div class="result">default: <span xh-text="title"></span></div>'));

    document.body.innerHTML = `
      <div id="widget"
           xh-get="/api/data"
           xh-trigger="load"
           xh-template="/default.html"
           xh-template-tablet="/tablet.html">
      </div>
    `;

    xhtmlx.process(document.body);
    await jest.runAllTimersAsync();

    var result = document.querySelector('.result');
    expect(result).not.toBeNull();
    expect(result.textContent).toContain('tablet:');
  });
});
