/**
 * @jest-environment jsdom
 */

const xhtmlx = require("../../xhtmlx.js");
const {
  analyticsHandlers,
  sendAnalytics,
  setupTrack,
  setupTrackView,
  registerAnalytics,
  DataContext,
  config,
} = xhtmlx._internals;

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function mockFetchJSON(data) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

beforeEach(() => {
  analyticsHandlers.length = 0;
  document.body.innerHTML = "";
  config.trackRequests = false;
  config.debug = false;
  jest.restoreAllMocks();
});

describe("analytics adapter", () => {
  test("registerAnalytics adds a handler", () => {
    var handler = jest.fn();
    registerAnalytics(handler);
    expect(analyticsHandlers.length).toBe(1);
  });

  test("xhtmlx.analytics registers a handler", () => {
    var handler = jest.fn();
    xhtmlx.analytics(handler);
    expect(analyticsHandlers.length).toBe(1);
  });

  test("sendAnalytics calls all registered handlers", () => {
    var h1 = jest.fn();
    var h2 = jest.fn();
    registerAnalytics(h1);
    registerAnalytics(h2);

    sendAnalytics("test_event", { foo: "bar" });

    expect(h1).toHaveBeenCalledWith("test_event", { foo: "bar" });
    expect(h2).toHaveBeenCalledWith("test_event", { foo: "bar" });
  });

  test("sendAnalytics emits xh:track CustomEvent on element", () => {
    var handler = jest.fn();
    registerAnalytics(handler);

    var el = document.createElement("div");
    var eventData = null;
    el.addEventListener("xh:track", function (e) {
      eventData = e.detail;
    });

    sendAnalytics("click_cta", { section: "hero" }, el);

    expect(eventData).toEqual({
      event: "click_cta",
      data: { section: "hero" },
    });
  });

  test("handler errors are caught and do not break other handlers", () => {
    config.debug = true;
    var spy = jest.spyOn(console, "error").mockImplementation();
    var h1 = jest.fn().mockImplementation(() => {
      throw new Error("boom");
    });
    var h2 = jest.fn();
    registerAnalytics(h1);
    registerAnalytics(h2);

    sendAnalytics("evt", {});

    expect(h1).toHaveBeenCalled();
    expect(h2).toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
  });

  test("ignores non-function arguments", () => {
    registerAnalytics("not a function");
    registerAnalytics(null);
    registerAnalytics(42);
    expect(analyticsHandlers.length).toBe(0);
  });
});

describe("xh-track attribute", () => {
  test("fires analytics event on click for button", () => {
    var handler = jest.fn();
    registerAnalytics(handler);

    var el = document.createElement("button");
    el.setAttribute("xh-track", "signup_clicked");
    document.body.appendChild(el);

    var ctx = new DataContext({});
    setupTrack(el, ctx);
    el.click();

    expect(handler).toHaveBeenCalledWith("signup_clicked", {
      element: "button",
    });
  });

  test("fires analytics event on change for input", () => {
    var handler = jest.fn();
    registerAnalytics(handler);

    var el = document.createElement("input");
    el.setAttribute("xh-track", "filter_changed");
    document.body.appendChild(el);

    var ctx = new DataContext({});
    setupTrack(el, ctx);
    el.dispatchEvent(new Event("change"));

    expect(handler).toHaveBeenCalledWith("filter_changed", {
      element: "input",
    });
  });

  test("fires analytics event on submit for form", () => {
    var handler = jest.fn();
    registerAnalytics(handler);

    var el = document.createElement("form");
    el.setAttribute("xh-track", "form_submitted");
    document.body.appendChild(el);

    var ctx = new DataContext({});
    setupTrack(el, ctx);
    el.dispatchEvent(new Event("submit"));

    expect(handler).toHaveBeenCalledWith("form_submitted", {
      element: "form",
    });
  });

  test("includes xh-track-vals metadata", () => {
    var handler = jest.fn();
    registerAnalytics(handler);

    var el = document.createElement("button");
    el.setAttribute("xh-track", "add_to_cart");
    el.setAttribute("xh-track-vals", '{"sku":"ABC123","price":"9.99"}');
    document.body.appendChild(el);

    var ctx = new DataContext({});
    setupTrack(el, ctx);
    el.click();

    expect(handler).toHaveBeenCalledWith("add_to_cart", {
      element: "button",
      sku: "ABC123",
      price: "9.99",
    });
  });

  test("interpolates {{field}} in xh-track-vals", () => {
    var handler = jest.fn();
    registerAnalytics(handler);

    var el = document.createElement("button");
    el.setAttribute("xh-track", "view_product");
    el.setAttribute("xh-track-vals", '{"id":"{{productId}}"}');
    document.body.appendChild(el);

    var ctx = new DataContext({ productId: "P-42" });
    setupTrack(el, ctx);
    el.click();

    expect(handler).toHaveBeenCalledWith("view_product", {
      element: "button",
      id: "P-42",
    });
  });

  test("does nothing without xh-track attribute", () => {
    var handler = jest.fn();
    registerAnalytics(handler);

    var el = document.createElement("button");
    document.body.appendChild(el);

    var ctx = new DataContext({});
    setupTrack(el, ctx);
    el.click();

    expect(handler).not.toHaveBeenCalled();
  });

  test("handles invalid JSON in xh-track-vals gracefully", () => {
    config.debug = true;
    var spy = jest.spyOn(console, "error").mockImplementation();
    var handler = jest.fn();
    registerAnalytics(handler);

    var el = document.createElement("button");
    el.setAttribute("xh-track", "click");
    el.setAttribute("xh-track-vals", "not json");
    document.body.appendChild(el);

    var ctx = new DataContext({});
    setupTrack(el, ctx);
    el.click();

    expect(handler).toHaveBeenCalledWith("click", { element: "button" });
    expect(spy).toHaveBeenCalled();
  });
});

describe("xh-track-view attribute", () => {
  test("fires analytics event when element enters viewport", () => {
    // Mock IntersectionObserver
    var observeCallback;
    global.IntersectionObserver = jest.fn(function (cb) {
      observeCallback = cb;
      return {
        observe: jest.fn(),
        disconnect: jest.fn(),
      };
    });

    var handler = jest.fn();
    registerAnalytics(handler);

    var el = document.createElement("div");
    el.setAttribute("xh-track-view", "pricing_seen");
    document.body.appendChild(el);

    var ctx = new DataContext({});
    setupTrackView(el, ctx);

    // Simulate intersection
    observeCallback([{ isIntersecting: true }]);

    expect(handler).toHaveBeenCalledWith("pricing_seen", {
      element: "div",
    });
  });

  test("includes xh-track-vals in view event", () => {
    var observeCallback;
    global.IntersectionObserver = jest.fn(function (cb) {
      observeCallback = cb;
      return {
        observe: jest.fn(),
        disconnect: jest.fn(),
      };
    });

    var handler = jest.fn();
    registerAnalytics(handler);

    var el = document.createElement("section");
    el.setAttribute("xh-track-view", "section_visible");
    el.setAttribute("xh-track-vals", '{"name":"features"}');
    document.body.appendChild(el);

    var ctx = new DataContext({});
    setupTrackView(el, ctx);
    observeCallback([{ isIntersecting: true }]);

    expect(handler).toHaveBeenCalledWith("section_visible", {
      element: "section",
      name: "features",
    });
  });

  test("fires only once (disconnects observer)", () => {
    var disconnectSpy = jest.fn();
    var observeCallback;
    global.IntersectionObserver = jest.fn(function (cb) {
      observeCallback = cb;
      return {
        observe: jest.fn(),
        disconnect: disconnectSpy,
      };
    });

    var handler = jest.fn();
    registerAnalytics(handler);

    var el = document.createElement("div");
    el.setAttribute("xh-track-view", "test_view");
    document.body.appendChild(el);

    var ctx = new DataContext({});
    setupTrackView(el, ctx);

    observeCallback([{ isIntersecting: true }]);
    expect(disconnectSpy).toHaveBeenCalled();
  });

  test("does not fire when not intersecting", () => {
    var observeCallback;
    global.IntersectionObserver = jest.fn(function (cb) {
      observeCallback = cb;
      return {
        observe: jest.fn(),
        disconnect: jest.fn(),
      };
    });

    var handler = jest.fn();
    registerAnalytics(handler);

    var el = document.createElement("div");
    el.setAttribute("xh-track-view", "nope");
    document.body.appendChild(el);

    var ctx = new DataContext({});
    setupTrackView(el, ctx);
    observeCallback([{ isIntersecting: false }]);

    expect(handler).not.toHaveBeenCalled();
  });
});

describe("auto request tracking", () => {
  test("tracks REST requests when config.trackRequests is true", async () => {
    config.trackRequests = true;
    mockFetchJSON({ message: "ok" });
    var handler = jest.fn();
    registerAnalytics(handler);

    document.body.innerHTML = `
      <div xh-get="/api/test" xh-trigger="load">
        <template><span xh-text="message"></span></template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(handler).toHaveBeenCalledWith(
      "xh:request",
      expect.objectContaining({
        method: "GET",
        url: "/api/test",
        status: 200,
      })
    );
    expect(handler.mock.calls[0][1]).toHaveProperty("duration");
    expect(typeof handler.mock.calls[0][1].duration).toBe("number");
  });

  test("does not track when config.trackRequests is false", async () => {
    config.trackRequests = false;
    mockFetchJSON({ message: "ok" });
    var handler = jest.fn();
    registerAnalytics(handler);

    document.body.innerHTML = `
      <div xh-get="/api/test" xh-trigger="load">
        <template><span xh-text="message"></span></template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(handler).not.toHaveBeenCalled();
  });

  test("does not track when no analytics handlers registered", async () => {
    config.trackRequests = true;
    mockFetchJSON({ message: "ok" });

    // No handlers registered
    document.body.innerHTML = `
      <div xh-get="/api/test" xh-trigger="load">
        <template><span xh-text="message"></span></template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    // Should not throw
  });
});

describe("xh-track integration with processElement", () => {
  test("xh-track is processed via xhtmlx.process", () => {
    var handler = jest.fn();
    registerAnalytics(handler);

    document.body.innerHTML =
      '<button id="btn" xh-track="cta_click">Click</button>';

    xhtmlx.process(document.body);

    document.getElementById("btn").click();

    expect(handler).toHaveBeenCalledWith("cta_click", {
      element: "button",
    });
  });

  test("xh-track inside template is processed after render", async () => {
    var handler = jest.fn();
    registerAnalytics(handler);
    mockFetchJSON({ label: "Buy" });

    document.body.innerHTML = `
      <div xh-get="/api/data" xh-trigger="load">
        <template>
          <button id="buy" xh-track="purchase_click" xh-text="label">...</button>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    var btn = document.getElementById("buy");
    expect(btn.textContent).toBe("Buy");
    btn.click();

    expect(handler).toHaveBeenCalledWith("purchase_click", {
      element: "button",
    });
  });
});
