/**
 * @jest-environment jsdom
 */

const xhtmlx = require('../../xhtmlx.js');
const {
  getCurrentBreakpoint,
  getViewportContext,
  DataContext,
  resolveTemplate,
  templateCache,
  config
} = xhtmlx._internals;

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1200 });
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 800 });
  // Reset breakpoints to defaults
  config.breakpoints = { mobile: 768, tablet: 1024 };
  document.body.innerHTML = '';
  templateCache.clear();
});

describe('getCurrentBreakpoint', () => {
  it('returns "desktop" for width > 1024', () => {
    window.innerWidth = 1200;
    expect(getCurrentBreakpoint()).toBe('desktop');
  });

  it('returns "tablet" for width between 768 and 1024', () => {
    window.innerWidth = 900;
    expect(getCurrentBreakpoint()).toBe('tablet');
  });

  it('returns "tablet" for width exactly 768', () => {
    window.innerWidth = 768;
    expect(getCurrentBreakpoint()).toBe('tablet');
  });

  it('returns "mobile" for width < 768', () => {
    window.innerWidth = 600;
    expect(getCurrentBreakpoint()).toBe('mobile');
  });

  it('returns "desktop" for width exactly 1024', () => {
    window.innerWidth = 1024;
    expect(getCurrentBreakpoint()).toBe('desktop');
  });
});

describe('getViewportContext', () => {
  it('returns correct object for desktop', () => {
    window.innerWidth = 1200;
    window.innerHeight = 800;
    var vp = getViewportContext();
    expect(vp).toEqual({
      width: 1200,
      height: 800,
      breakpoint: 'desktop',
      mobile: false,
      tablet: false,
      desktop: true
    });
  });

  it('returns correct object for mobile', () => {
    window.innerWidth = 400;
    window.innerHeight = 700;
    var vp = getViewportContext();
    expect(vp).toEqual({
      width: 400,
      height: 700,
      breakpoint: 'mobile',
      mobile: true,
      tablet: false,
      desktop: false
    });
  });

  it('returns correct object for tablet', () => {
    window.innerWidth = 900;
    window.innerHeight = 600;
    var vp = getViewportContext();
    expect(vp).toEqual({
      width: 900,
      height: 600,
      breakpoint: 'tablet',
      mobile: false,
      tablet: true,
      desktop: false
    });
  });
});

describe('$viewport in DataContext', () => {
  it('$viewport.mobile is true when width < 768', () => {
    window.innerWidth = 400;
    var ctx = new DataContext({});
    expect(ctx.resolve('$viewport.mobile')).toBe(true);
  });

  it('$viewport.desktop is true when width > 1024', () => {
    window.innerWidth = 1200;
    var ctx = new DataContext({});
    expect(ctx.resolve('$viewport.desktop')).toBe(true);
  });

  it('$viewport.breakpoint returns correct string', () => {
    window.innerWidth = 900;
    var ctx = new DataContext({});
    expect(ctx.resolve('$viewport.breakpoint')).toBe('tablet');
  });

  it('$viewport.width returns window.innerWidth', () => {
    window.innerWidth = 1200;
    var ctx = new DataContext({});
    expect(ctx.resolve('$viewport.width')).toBe(1200);
  });

  it('$viewport returns full object when no sub-path', () => {
    window.innerWidth = 1200;
    window.innerHeight = 800;
    var ctx = new DataContext({});
    var vp = ctx.resolve('$viewport');
    expect(vp.width).toBe(1200);
    expect(vp.height).toBe(800);
    expect(vp.breakpoint).toBe('desktop');
    expect(vp.desktop).toBe(true);
  });

  it('$viewport.height returns window.innerHeight', () => {
    window.innerHeight = 900;
    var ctx = new DataContext({});
    expect(ctx.resolve('$viewport.height')).toBe(900);
  });
});

describe('custom breakpoints config', () => {
  it('changes thresholds when config.breakpoints is modified', () => {
    config.breakpoints = { mobile: 480, tablet: 800 };

    window.innerWidth = 500;
    expect(getCurrentBreakpoint()).toBe('tablet');

    window.innerWidth = 400;
    expect(getCurrentBreakpoint()).toBe('mobile');

    window.innerWidth = 850;
    expect(getCurrentBreakpoint()).toBe('desktop');
  });

  it('$viewport reflects custom breakpoints', () => {
    config.breakpoints = { mobile: 480, tablet: 800 };
    window.innerWidth = 500;
    var ctx = new DataContext({});
    expect(ctx.resolve('$viewport.tablet')).toBe(true);
    expect(ctx.resolve('$viewport.mobile')).toBe(false);
  });
});

describe('resolveTemplate with breakpoint-specific templates', () => {
  it('picks xh-template-mobile when viewport is mobile', async () => {
    window.innerWidth = 400;
    var el = document.createElement('div');
    el.setAttribute('xh-template', '/default.html');
    el.setAttribute('xh-template-mobile', '/mobile.html');

    templateCache.set('/mobile.html', Promise.resolve('<p>mobile</p>'));
    templateCache.set('/default.html', Promise.resolve('<p>default</p>'));

    var result = await resolveTemplate(el, []);
    expect(result.html).toBe('<p>mobile</p>');
    expect(result.isExternal).toBe(true);
  });

  it('picks xh-template-tablet when viewport is tablet', async () => {
    window.innerWidth = 900;
    var el = document.createElement('div');
    el.setAttribute('xh-template', '/default.html');
    el.setAttribute('xh-template-tablet', '/tablet.html');

    templateCache.set('/tablet.html', Promise.resolve('<p>tablet</p>'));
    templateCache.set('/default.html', Promise.resolve('<p>default</p>'));

    var result = await resolveTemplate(el, []);
    expect(result.html).toBe('<p>tablet</p>');
    expect(result.isExternal).toBe(true);
  });

  it('falls back to xh-template on desktop', async () => {
    window.innerWidth = 1200;
    var el = document.createElement('div');
    el.setAttribute('xh-template', '/default.html');
    el.setAttribute('xh-template-mobile', '/mobile.html');
    el.setAttribute('xh-template-tablet', '/tablet.html');

    templateCache.set('/mobile.html', Promise.resolve('<p>mobile</p>'));
    templateCache.set('/tablet.html', Promise.resolve('<p>tablet</p>'));
    templateCache.set('/default.html', Promise.resolve('<p>default</p>'));

    var result = await resolveTemplate(el, []);
    expect(result.html).toBe('<p>default</p>');
    expect(result.isExternal).toBe(true);
  });

  it('falls back to xh-template when no breakpoint template exists for current bp', async () => {
    window.innerWidth = 400;
    var el = document.createElement('div');
    el.setAttribute('xh-template', '/default.html');
    // No xh-template-mobile set

    templateCache.set('/default.html', Promise.resolve('<p>default</p>'));

    var result = await resolveTemplate(el, []);
    expect(result.html).toBe('<p>default</p>');
    expect(result.isExternal).toBe(true);
  });

  it('detects circular breakpoint-specific templates', async () => {
    window.innerWidth = 400;
    var el = document.createElement('div');
    el.setAttribute('xh-template-mobile', '/mobile.html');

    // Mock console.error
    var consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(resolveTemplate(el, ['/mobile.html'])).rejects.toThrow('Circular template: /mobile.html');

    consoleSpy.mockRestore();
  });
});
