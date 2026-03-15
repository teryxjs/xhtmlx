/**
 * @jest-environment jsdom
 */

const xhtmlx = require("../../xhtmlx.js");

function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

beforeEach(() => {
  document.body.innerHTML = "";
  global.fetch = jest.fn();
  xhtmlx.clearTemplateCache();
  window.history.pushState = jest.fn();
});

afterEach(() => {
  delete global.fetch;
});

function mockFetchJSON(data) {
  global.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(JSON.stringify(data))
  });
}

function mockFetchHTML(html) {
  global.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(html)
  });
}

describe("Boost integration flow", () => {
  test("xh-boost enhances child links, clicking fetches URL and renders into target", async () => {
    mockFetchHTML("<p>Loaded page content</p>");

    document.body.innerHTML = `
      <div xh-boost xh-boost-target="#content">
        <a href="/page1">Page 1</a>
        <a href="/page2">Page 2</a>
      </div>
      <div id="content"></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    // Links should be boosted
    var links = document.querySelectorAll("a");
    expect(links[0].hasAttribute("data-xh-boosted")).toBe(true);
    expect(links[1].hasAttribute("data-xh-boosted")).toBe(true);

    // Click the first link
    links[0].dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledWith("/page1");

    var content = document.getElementById("content");
    expect(content.innerHTML).toBe("<p>Loaded page content</p>");
  });

  test("boosted form submit sends POST with form data", async () => {
    mockFetchJSON({ result: "success" });

    document.body.innerHTML = `
      <div xh-boost xh-boost-target="#result" xh-boost-template="/tpl/result.html">
        <form action="/api/submit" method="POST">
          <input name="username" value="testuser" />
          <button type="submit">Submit</button>
        </form>
      </div>
      <div id="result"></div>
    `;

    xhtmlx._internals.templateCache.set(
      "/tpl/result.html",
      Promise.resolve("<span class='res' xh-text='result'></span>")
    );

    xhtmlx.process(document.body);
    await flushPromises();

    var form = document.querySelector("form");
    expect(form.hasAttribute("data-xh-boosted")).toBe(true);

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushPromises();
    await flushPromises();
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/submit",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json"
        })
      })
    );

    // Check the body was sent with form data
    var callArgs = global.fetch.mock.calls[0];
    var body = JSON.parse(callArgs[1].body);
    expect(body.username).toBe("testuser");
  });

  test("already-xh-get links are not boosted", async () => {
    document.body.innerHTML = `
      <div xh-boost xh-boost-target="#content">
        <a href="/page1" xh-get="/api/page1">API Link</a>
        <a href="/page2">Regular Link</a>
      </div>
      <div id="content"></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    var links = document.querySelectorAll("a");
    // First link has xh-get, should NOT be boosted
    expect(links[0].hasAttribute("data-xh-boosted")).toBe(false);
    // Second link should be boosted
    expect(links[1].hasAttribute("data-xh-boosted")).toBe(true);
  });

  test("xh-boost-target directs content to specific element", async () => {
    mockFetchHTML("<div class='loaded'>Page loaded</div>");

    document.body.innerHTML = `
      <div xh-boost xh-boost-target="#my-target">
        <a href="/specific-page">Go</a>
      </div>
      <div id="my-target"></div>
      <div id="other-target"></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    var link = document.querySelector("a");
    link.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();
    await flushPromises();

    var myTarget = document.getElementById("my-target");
    var otherTarget = document.getElementById("other-target");

    expect(myTarget.querySelector(".loaded")).not.toBeNull();
    expect(myTarget.textContent).toContain("Page loaded");
    expect(otherTarget.innerHTML).toBe("");
  });

  test("boosted link calls history.pushState", async () => {
    mockFetchHTML("<p>New page</p>");

    document.body.innerHTML = `
      <div xh-boost xh-boost-target="#content">
        <a href="/new-page">Navigate</a>
      </div>
      <div id="content"></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    var link = document.querySelector("a");
    link.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));

    expect(window.history.pushState).toHaveBeenCalledWith(
      expect.objectContaining({ xhtmlx: true, url: "/new-page" }),
      "",
      "/new-page"
    );
  });

  test("boosted link with JSON response renders via xh-boost-template", async () => {
    mockFetchJSON({ title: "API Page", body: "Some content" });

    document.body.innerHTML = `
      <div xh-boost xh-boost-target="#content" xh-boost-template="/tpl/page.html">
        <a href="/api/page-data">Load Page</a>
      </div>
      <div id="content"></div>
    `;

    xhtmlx._internals.templateCache.set(
      "/tpl/page.html",
      Promise.resolve("<h2 xh-text='title'></h2><p xh-text='body'></p>")
    );

    xhtmlx.process(document.body);
    await flushPromises();

    var link = document.querySelector("a");
    link.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    await flushPromises();
    await flushPromises();
    await flushPromises();

    var content = document.getElementById("content");
    var h2 = content.querySelector("h2");
    var p = content.querySelector("p");

    expect(h2).not.toBeNull();
    expect(h2.textContent).toBe("API Page");
    expect(p).not.toBeNull();
    expect(p.textContent).toBe("Some content");
  });
});
