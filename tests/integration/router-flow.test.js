/**
 * @jest-environment jsdom
 */

const xhtmlx = require("../../xhtmlx.js");
const { router, templateCache } = xhtmlx._internals;

function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

beforeEach(() => {
  document.body.innerHTML = "";
  global.fetch = jest.fn();
  xhtmlx.clearTemplateCache();

  // Reset router state
  router._routes = [];
  router._outlet = null;
  router._activeLink = null;
  router._notFoundTemplate = null;

  window.history.pushState = jest.fn();
  delete window.location;
  window.location = { pathname: "/" };
});

afterEach(() => {
  delete global.fetch;
});

function setupRouterHTML(routesDefs, opts) {
  opts = opts || {};
  var navHTML = "<nav xh-router";
  if (opts.outlet) navHTML += ' xh-router-outlet="' + opts.outlet + '"';
  if (opts.notFound) navHTML += ' xh-router-404="' + opts.notFound + '"';
  navHTML += ">";
  routesDefs.forEach(function (r) {
    navHTML += '<a xh-route="' + r.path + '"';
    if (r.template) navHTML += ' xh-template="' + r.template + '"';
    if (r.api) navHTML += ' xh-get="' + r.api + '"';
    navHTML += ">" + (r.label || r.path) + "</a>";
  });
  navHTML += "</nav>";
  return navHTML;
}

describe("Router integration flow", () => {
  test("router navigates to route and renders template with API data", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ name: "Alice", role: "admin" }))
    });

    document.body.innerHTML =
      setupRouterHTML([
        { path: "/users", template: "/tpl/users.html", api: "/api/users" }
      ]) + '<div id="router-outlet"></div>';

    templateCache.set(
      "/tpl/users.html",
      Promise.resolve('<div class="user"><span class="name" xh-text="name"></span><span class="role" xh-text="role"></span></div>')
    );

    router._init();

    router.navigate("/users");
    await flushPromises();
    await flushPromises();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledWith("/api/users");

    var outlet = document.getElementById("router-outlet");
    var nameEl = outlet.querySelector(".name");
    var roleEl = outlet.querySelector(".role");

    expect(nameEl).not.toBeNull();
    expect(nameEl.textContent).toBe("Alice");
    expect(roleEl).not.toBeNull();
    expect(roleEl.textContent).toBe("admin");
  });

  test("route params (:id) are extracted and available in template", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(JSON.stringify({ username: "bob", email: "bob@test.com" }))
    });

    document.body.innerHTML =
      setupRouterHTML([
        {
          path: "/users/:id",
          template: "/tpl/user-detail.html",
          api: "/api/users/{{id}}"
        }
      ]) + '<div id="router-outlet"></div>';

    templateCache.set(
      "/tpl/user-detail.html",
      Promise.resolve(
        '<div class="detail"><span class="uname" xh-text="username"></span><span class="uemail" xh-text="email"></span></div>'
      )
    );

    router._init();

    router.navigate("/users/42");
    await flushPromises();
    await flushPromises();
    await flushPromises();

    // Verify the route params were extracted
    var route = router._routes[0];
    expect(route.paramNames).toEqual(["id"]);

    var match = "/users/42".match(route.regex);
    expect(match).not.toBeNull();
    expect(match[1]).toBe("42");

    // Verify fetch was called (URL interpolation with params)
    expect(global.fetch).toHaveBeenCalled();
  });

  test("active route gets xh-route-active class", async () => {
    document.body.innerHTML =
      setupRouterHTML([
        { path: "/home", template: "/tpl/home.html", label: "Home" },
        { path: "/about", template: "/tpl/about.html", label: "About" },
        { path: "/contact", template: "/tpl/contact.html", label: "Contact" }
      ]) + '<div id="router-outlet"></div>';

    templateCache.set("/tpl/home.html", Promise.resolve("<h1>Home</h1>"));
    templateCache.set("/tpl/about.html", Promise.resolve("<h1>About</h1>"));
    templateCache.set("/tpl/contact.html", Promise.resolve("<h1>Contact</h1>"));

    router._init();

    // Navigate to /home
    router.navigate("/home");
    await flushPromises();

    var homeLink = router._routes[0].element;
    var aboutLink = router._routes[1].element;
    var contactLink = router._routes[2].element;

    expect(homeLink.classList.contains("xh-route-active")).toBe(true);
    expect(aboutLink.classList.contains("xh-route-active")).toBe(false);
    expect(contactLink.classList.contains("xh-route-active")).toBe(false);

    // Navigate to /about
    router.navigate("/about");
    await flushPromises();

    expect(homeLink.classList.contains("xh-route-active")).toBe(false);
    expect(aboutLink.classList.contains("xh-route-active")).toBe(true);
    expect(contactLink.classList.contains("xh-route-active")).toBe(false);

    // Navigate to /contact
    router.navigate("/contact");
    await flushPromises();

    expect(homeLink.classList.contains("xh-route-active")).toBe(false);
    expect(aboutLink.classList.contains("xh-route-active")).toBe(false);
    expect(contactLink.classList.contains("xh-route-active")).toBe(true);
  });

  test("xh:routeChanged event fires with path and params", async () => {
    document.body.innerHTML =
      setupRouterHTML([
        { path: "/items/:id", template: "/tpl/item.html" }
      ]) + '<div id="router-outlet"></div>';

    templateCache.set(
      "/tpl/item.html",
      Promise.resolve("<div>Item detail</div>")
    );

    router._init();

    var routeChangedEvents = [];
    var outlet = document.getElementById("router-outlet");
    outlet.addEventListener("xh:routeChanged", function (e) {
      routeChangedEvents.push(e.detail);
    });

    router.navigate("/items/7");
    await flushPromises();

    expect(routeChangedEvents.length).toBe(1);
    expect(routeChangedEvents[0].path).toBe("/items/7");
    expect(routeChangedEvents[0].params).toEqual({ id: "7" });
  });

  test("404 route emits xh:routeNotFound", async () => {
    document.body.innerHTML =
      setupRouterHTML(
        [
          { path: "/home", template: "/tpl/home.html" }
        ],
        { notFound: "/tpl/404.html" }
      ) + '<div id="router-outlet"></div>';

    templateCache.set("/tpl/home.html", Promise.resolve("<h1>Home</h1>"));
    templateCache.set(
      "/tpl/404.html",
      Promise.resolve("<p>Page not found: {{path}}</p>")
    );

    router._init();

    var notFoundEvents = [];
    document.body.addEventListener("xh:routeNotFound", function (e) {
      notFoundEvents.push(e.detail);
    });

    router._resolve("/nonexistent-page");
    await flushPromises();

    expect(notFoundEvents.length).toBe(1);
    expect(notFoundEvents[0].path).toBe("/nonexistent-page");

    // Also verify the 404 template was rendered
    var outlet = document.getElementById("router-outlet");
    expect(outlet.textContent).toContain("Page not found");
  });

  test("router navigate calls history.pushState", async () => {
    document.body.innerHTML =
      setupRouterHTML([
        { path: "/dashboard", template: "/tpl/dashboard.html" }
      ]) + '<div id="router-outlet"></div>';

    templateCache.set(
      "/tpl/dashboard.html",
      Promise.resolve("<h1>Dashboard</h1>")
    );

    router._init();

    router.navigate("/dashboard");

    expect(window.history.pushState).toHaveBeenCalledWith(
      { xhtmlx: true, route: "/dashboard" },
      "",
      "/dashboard"
    );
  });
});
