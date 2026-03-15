/**
 * @jest-environment jsdom
 */

const xhtmlx = require('../../xhtmlx.js');
const { router, DataContext, templateCache } = xhtmlx._internals;

function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('SPA Router', () => {
  let container;
  let outlet;
  let pushStateSpy;
  let originalPathname;

  beforeEach(() => {
    // Reset router state
    router._routes = [];
    router._outlet = null;
    router._activeLink = null;
    router._notFoundTemplate = null;

    container = document.createElement('div');
    document.body.appendChild(container);

    outlet = document.createElement('div');
    outlet.id = 'router-outlet';
    document.body.appendChild(outlet);

    global.fetch = jest.fn();
    xhtmlx.clearTemplateCache();

    pushStateSpy = jest.spyOn(window.history, 'pushState').mockImplementation(() => {});

    originalPathname = window.location.pathname;
  });

  afterEach(() => {
    if (container.parentNode) document.body.removeChild(container);
    if (outlet.parentNode) document.body.removeChild(outlet);
    delete global.fetch;
    pushStateSpy.mockRestore();
  });

  function setupRouterDOM(routes, opts) {
    opts = opts || {};
    var nav = document.createElement('nav');
    nav.setAttribute('xh-router', '');
    if (opts.outletSelector) {
      nav.setAttribute('xh-router-outlet', opts.outletSelector);
    }
    if (opts.notFound) {
      nav.setAttribute('xh-router-404', opts.notFound);
    }
    routes.forEach(function(r) {
      var a = document.createElement('a');
      a.setAttribute('xh-route', r.path);
      if (r.template) a.setAttribute('xh-template', r.template);
      if (r.api) a.setAttribute('xh-get', r.api);
      a.textContent = r.label || r.path;
      nav.appendChild(a);
    });
    container.appendChild(nav);
    return nav;
  }

  describe('Route parsing', () => {
    it('parses static xh-route paths', () => {
      setupRouterDOM([
        { path: '/', template: '/tpl/home.html' },
        { path: '/about', template: '/tpl/about.html' }
      ]);

      // Pre-cache templates so _init's resolve doesn't hit real fetch
      templateCache.set('/tpl/home.html', Promise.resolve('<h1>Home</h1>'));
      templateCache.set('/tpl/about.html', Promise.resolve('<h1>About</h1>'));
      router._init();

      expect(router._routes.length).toBe(2);
      expect(router._routes[0].path).toBe('/');
      expect(router._routes[1].path).toBe('/about');
    });

    it('parses xh-route paths with parameters', () => {
      setupRouterDOM([
        { path: '/users/:id', template: '/tpl/user.html' }
      ]);

      router._init();

      expect(router._routes[0].paramNames).toEqual(['id']);
      expect(router._routes[0].regex.test('/users/42')).toBe(true);
      expect(router._routes[0].regex.test('/users/')).toBe(false);
    });

    it('parses multiple route params', () => {
      setupRouterDOM([
        { path: '/orgs/:orgId/users/:userId', template: '/tpl/user.html' }
      ]);

      router._init();

      expect(router._routes[0].paramNames).toEqual(['orgId', 'userId']);
      var match = '/orgs/acme/users/99'.match(router._routes[0].regex);
      expect(match[1]).toBe('acme');
      expect(match[2]).toBe('99');
    });
  });

  describe('Route param extraction', () => {
    it('extracts param values from matching URL', () => {
      setupRouterDOM([
        { path: '/users/:id', template: '/tpl/user.html' }
      ]);

      templateCache.set('/tpl/user.html', Promise.resolve('<div>User</div>'));
      router._init();

      // Verify route can match and extract params
      var route = router._routes[0];
      var match = '/users/55'.match(route.regex);
      expect(match).not.toBeNull();

      var params = {};
      for (var p = 0; p < route.paramNames.length; p++) {
        params[route.paramNames[p]] = match[p + 1];
      }
      expect(params).toEqual({ id: '55' });
    });
  });

  describe('navigate()', () => {
    it('calls history.pushState', () => {
      setupRouterDOM([
        { path: '/home', template: '/tpl/home.html' }
      ]);

      templateCache.set('/tpl/home.html', Promise.resolve('<h1>Home</h1>'));
      router._init();

      router.navigate('/home');

      expect(pushStateSpy).toHaveBeenCalledWith(
        { xhtmlx: true, route: '/home' },
        '',
        '/home'
      );
    });

    it('calls _resolve with the given path', () => {
      setupRouterDOM([
        { path: '/test', template: '/tpl/test.html' }
      ]);

      templateCache.set('/tpl/test.html', Promise.resolve('<p>Test</p>'));
      router._init();

      var resolveSpy = jest.spyOn(router, '_resolve');
      router.navigate('/test');

      // Called once by navigate, plus once by _init for the current URL
      expect(resolveSpy.mock.calls[resolveSpy.mock.calls.length - 1][0]).toBe('/test');
      resolveSpy.mockRestore();
    });
  });

  describe('Active class management', () => {
    it('adds xh-route-active class to matching route link', async () => {
      setupRouterDOM([
        { path: '/page-a', template: '/tpl/a.html' },
        { path: '/page-b', template: '/tpl/b.html' }
      ]);

      templateCache.set('/tpl/a.html', Promise.resolve('<p>A</p>'));
      templateCache.set('/tpl/b.html', Promise.resolve('<p>B</p>'));
      router._init();

      router.navigate('/page-a');
      await flushPromises();

      var linkA = router._routes[0].element;
      expect(linkA.classList.contains('xh-route-active')).toBe(true);
    });

    it('removes xh-route-active from previous active link', async () => {
      setupRouterDOM([
        { path: '/page-a', template: '/tpl/a.html' },
        { path: '/page-b', template: '/tpl/b.html' }
      ]);

      templateCache.set('/tpl/a.html', Promise.resolve('<p>A</p>'));
      templateCache.set('/tpl/b.html', Promise.resolve('<p>B</p>'));
      router._init();

      router.navigate('/page-a');
      await flushPromises();

      var linkA = router._routes[0].element;
      expect(linkA.classList.contains('xh-route-active')).toBe(true);

      router.navigate('/page-b');
      await flushPromises();

      var linkB = router._routes[1].element;
      expect(linkA.classList.contains('xh-route-active')).toBe(false);
      expect(linkB.classList.contains('xh-route-active')).toBe(true);
    });
  });

  describe('Route events', () => {
    it('fires xh:routeChanged event with path and params', async () => {
      setupRouterDOM([
        { path: '/items/:id', template: '/tpl/item.html' }
      ]);

      templateCache.set('/tpl/item.html', Promise.resolve('<div>Item</div>'));
      router._init();

      var eventDetail = null;
      outlet.addEventListener('xh:routeChanged', function(e) {
        eventDetail = e.detail;
      });

      router.navigate('/items/7');
      await flushPromises();

      expect(eventDetail).not.toBeNull();
      expect(eventDetail.path).toBe('/items/7');
      expect(eventDetail.params).toEqual({ id: '7' });
    });

    it('fires xh:routeNotFound for unmatched path', () => {
      setupRouterDOM([
        { path: '/home', template: '/tpl/home.html' }
      ]);

      templateCache.set('/tpl/home.html', Promise.resolve('<h1>Home</h1>'));
      router._init();

      var notFoundDetail = null;
      document.body.addEventListener('xh:routeNotFound', function(e) {
        notFoundDetail = e.detail;
      });

      router._resolve('/nonexistent');

      expect(notFoundDetail).not.toBeNull();
      expect(notFoundDetail.path).toBe('/nonexistent');
    });
  });

  describe('404 handling', () => {
    it('renders 404 template for unmatched routes', async () => {
      setupRouterDOM(
        [{ path: '/home', template: '/tpl/home.html' }],
        { notFound: '/tpl/404.html' }
      );

      templateCache.set('/tpl/home.html', Promise.resolve('<h1>Home</h1>'));
      templateCache.set('/tpl/404.html', Promise.resolve('<p>Not Found: {{path}}</p>'));
      router._init();

      router._resolve('/missing');
      await flushPromises();

      expect(outlet.textContent).toContain('Not Found');
    });
  });

  describe('Template rendering', () => {
    it('renders template into outlet on route match', async () => {
      setupRouterDOM([
        { path: '/hello', template: '/tpl/hello.html' }
      ]);

      templateCache.set('/tpl/hello.html', Promise.resolve('<p>Hello World</p>'));
      router._init();

      router.navigate('/hello');
      await flushPromises();

      expect(outlet.innerHTML).toContain('Hello World');
    });

    it('renders template with API data', async () => {
      setupRouterDOM([
        { path: '/user', template: '/tpl/user.html', api: '/api/user' }
      ]);

      templateCache.set('/tpl/user.html', Promise.resolve('<span xh-text="name"></span>'));
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: function() { return Promise.resolve(JSON.stringify({ name: 'Alice' })); }
      });

      router._init();
      router.navigate('/user');
      await flushPromises();
      await flushPromises();
      await flushPromises();

      // The template should have been rendered
      expect(outlet.querySelector('span')).not.toBeNull();
    });
  });

  describe('Router initialization', () => {
    it('resolves current URL on init when routes exist', async () => {
      // We can't change window.location.pathname in jsdom easily,
      // but we can verify _resolve is called
      setupRouterDOM([
        { path: '/', template: '/tpl/home.html' }
      ]);

      templateCache.set('/tpl/home.html', Promise.resolve('<h1>Home</h1>'));

      var resolveSpy = jest.spyOn(router, '_resolve');
      router._init();

      expect(resolveSpy).toHaveBeenCalled();
      resolveSpy.mockRestore();
    });

    it('click handler on route link calls navigate', async () => {
      setupRouterDOM([
        { path: '/clicked', template: '/tpl/clicked.html' }
      ]);

      templateCache.set('/tpl/clicked.html', Promise.resolve('<p>Clicked</p>'));
      router._init();

      var navigateSpy = jest.spyOn(router, 'navigate');
      var link = router._routes[0].element;
      link.click();

      expect(navigateSpy).toHaveBeenCalledWith('/clicked');
      navigateSpy.mockRestore();
    });
  });

  describe('Router public API', () => {
    it('router is exposed on xhtmlx public API', () => {
      expect(xhtmlx.router).toBeDefined();
      expect(xhtmlx.router.navigate).toBeInstanceOf(Function);
      expect(xhtmlx.router._init).toBeInstanceOf(Function);
      expect(xhtmlx.router._resolve).toBeInstanceOf(Function);
    });

    it('router is exposed on _internals', () => {
      expect(xhtmlx._internals.router).toBeDefined();
    });
  });
});
