/**
 * @jest-environment jsdom
 */

const xhtmlx = require("../../xhtmlx.js");
const { i18n } = xhtmlx._internals;

function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

beforeEach(() => {
  document.body.innerHTML = "";
  global.fetch = jest.fn();
  xhtmlx.clearTemplateCache();
  xhtmlx.clearResponseCache();
  i18n._locales = {};
  i18n._locale = null;
  i18n._fallback = "en";
});

afterEach(() => {
  delete global.fetch;
  i18n._locales = {};
  i18n._locale = null;
});

function mockFetchJSON(data, status = 200) {
  global.fetch.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status: status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data))
  });
}

function mockFetchSequence(responses) {
  responses.forEach((resp, idx) => {
    global.fetch.mockResolvedValueOnce({
      ok: (resp.status || 200) >= 200 && (resp.status || 200) < 300,
      status: resp.status || 200,
      statusText: "OK",
      json: () => Promise.resolve(resp.data),
      text: () => Promise.resolve(resp.html || JSON.stringify(resp.data))
    });
  });
}

// ---------------------------------------------------------------------------
// Optimization 1: Multi-token interpolation in end-to-end flow
// ---------------------------------------------------------------------------

describe("Multi-token interpolation in full request flow", () => {
  test("template with multiple interpolation tokens renders correctly", async () => {
    mockFetchSequence([
      { data: { name: "Alice", age: 30, city: "NYC" } },
      { html: '<p>{{name}} ({{age}}) from {{city}}</p>' }
    ]);

    document.body.innerHTML = `
      <div xh-get="/api/user" xh-trigger="load" xh-template="/tpl/user.html"></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const p = document.querySelector("p");
    expect(p).not.toBeNull();
    expect(p.textContent).toBe("Alice (30) from NYC");
  });

  test("multi-token interpolation in attributes", async () => {
    mockFetchSequence([
      { data: { base: "/img", file: "photo", ext: "jpg" } },
      { html: '<img src="{{base}}/{{file}}.{{ext}}" alt="{{file}}">' }
    ]);

    document.body.innerHTML = `
      <div xh-get="/api/img" xh-trigger="load" xh-template="/tpl/img.html"></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img.getAttribute("src")).toBe("/img/photo.jpg");
    expect(img.getAttribute("alt")).toBe("photo");
  });

  test("multi-token with URI encoding in URL interpolation", async () => {
    mockFetchJSON({ results: [{ title: "Found" }] });

    document.body.innerHTML = `
      <div xh-get="/search?q={{query}}&page={{page}}" xh-trigger="load" xh-target="#out">
        <template>
          <span xh-each="results" xh-text="title"></span>
        </template>
      </div>
      <div id="out"></div>
    `;

    // Pre-set a data context isn't needed since the URL gets interpolated
    // with the element's own data context (which is empty here)
    xhtmlx.process(document.body);
    await flushPromises();

    // The URL should have been called (with empty interpolations for missing fields)
    expect(global.fetch).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Optimization 2: container.contains() in renderTemplate — xh-each + outer bindings
// ---------------------------------------------------------------------------

describe("xh-each with outer bindings (container.contains optimization)", () => {
  test("outer bindings render alongside xh-each list", async () => {
    mockFetchSequence([
      { data: { title: "Team", members: [{ name: "Alice" }, { name: "Bob" }] } },
      { html: '<div><h2 xh-text="title"></h2><ul><li xh-each="members" xh-text="name"></li></ul></div>' }
    ]);

    document.body.innerHTML = `
      <div xh-get="/api/team" xh-trigger="load" xh-template="/tpl/team.html"></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(document.querySelector("h2").textContent).toBe("Team");
    const lis = document.querySelectorAll("li");
    expect(lis.length).toBe(2);
    expect(lis[0].textContent).toBe("Alice");
    expect(lis[1].textContent).toBe("Bob");
  });

  test("xh-if elements removed by condition inside xh-each template", async () => {
    mockFetchSequence([
      { data: { items: [
        { name: "A", visible: true },
        { name: "B", visible: false },
        { name: "C", visible: true }
      ] } },
      { html: '<div><span xh-each="items"><em xh-if="visible" xh-text="name"></em></span></div>' }
    ]);

    document.body.innerHTML = `
      <div xh-get="/api/items" xh-trigger="load" xh-template="/tpl/items.html"></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const ems = document.querySelectorAll("em");
    expect(ems.length).toBe(2);
    expect(ems[0].textContent).toBe("A");
    expect(ems[1].textContent).toBe("C");
  });

  test("multiple xh-each blocks with outer bindings", async () => {
    mockFetchSequence([
      { data: {
        heading: "Dashboard",
        users: [{ name: "Alice" }, { name: "Bob" }],
        posts: [{ title: "Post1" }, { title: "Post2" }, { title: "Post3" }]
      } },
      { html: `<div>
        <h1 xh-text="heading"></h1>
        <div class="users"><span xh-each="users" xh-text="name"></span></div>
        <div class="posts"><span xh-each="posts" xh-text="title"></span></div>
      </div>` }
    ]);

    document.body.innerHTML = `
      <div xh-get="/api/dashboard" xh-trigger="load" xh-template="/tpl/dash.html"></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(document.querySelector("h1").textContent).toBe("Dashboard");
    expect(document.querySelectorAll(".users span").length).toBe(2);
    expect(document.querySelectorAll(".posts span").length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Optimization 3: Merged xh-on-* + i18n scan — end-to-end
// ---------------------------------------------------------------------------

describe("xh-on-* and i18n processed in single pass (end-to-end)", () => {
  test("xh-on-click works on dynamically rendered content", async () => {
    mockFetchSequence([
      { data: {} },
      { html: '<button xh-on-click="toggleClass:active">Click</button>' }
    ]);

    document.body.innerHTML = `
      <div xh-get="/api/data" xh-trigger="load" xh-template="/tpl/btn.html"></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const btn = document.querySelector("button");
    expect(btn).not.toBeNull();

    btn.click();
    expect(btn.classList.contains("active")).toBe(true);
    btn.click();
    expect(btn.classList.contains("active")).toBe(false);
  });

  test("xh-i18n-placeholder detected in merged scan via container", async () => {
    i18n.load("en", { search_hint: "Type to search..." });
    i18n._locale = "en";

    mockFetchSequence([
      { data: {} },
      // Wrapper div has xh-i18n-title (triggers i18n detection in processElement),
      // and child input has xh-i18n-placeholder (found via applyI18n querySelectorAll)
      { html: '<div xh-i18n-title="search_hint"><input xh-i18n-placeholder="search_hint" type="text"></div>' }
    ]);

    document.body.innerHTML = `
      <div xh-get="/api/form" xh-trigger="load" xh-template="/tpl/form.html"></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const input = document.querySelector("input");
    expect(input).not.toBeNull();
    expect(input.getAttribute("placeholder")).toBe("Type to search...");
  });
});

// ---------------------------------------------------------------------------
// Optimization 4: _classifyAttrs — plan compilation in end-to-end flow
// ---------------------------------------------------------------------------

describe("Plan compilation with _classifyAttrs (end-to-end)", () => {
  test("template with mixed static, interpolated, and xh-* attrs", async () => {
    mockFetchSequence([
      { data: { users: [{ id: 1, name: "Alice", active: true }, { id: 2, name: "Bob", active: false }] } },
      { html: `<ul>
        <li xh-each="users" class="user" data-id="{{id}}" xh-text="name" xh-class-active="active"></li>
      </ul>` }
    ]);

    document.body.innerHTML = `
      <div xh-get="/api/users" xh-trigger="load" xh-template="/tpl/users.html"></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const lis = document.querySelectorAll("li");
    expect(lis.length).toBe(2);

    // Static attr
    expect(lis[0].getAttribute("class")).toContain("user");
    expect(lis[1].getAttribute("class")).toContain("user");

    // Interpolated attr
    expect(lis[0].getAttribute("data-id")).toBe("1");
    expect(lis[1].getAttribute("data-id")).toBe("2");

    // xh-text
    expect(lis[0].textContent).toBe("Alice");
    expect(lis[1].textContent).toBe("Bob");

    // xh-class-*
    expect(lis[0].classList.contains("active")).toBe(true);
    expect(lis[1].classList.contains("active")).toBe(false);
  });

  test("plan handles xh-show and xh-hide", async () => {
    mockFetchSequence([
      { data: { online: true, offline: false } },
      { html: '<div><span xh-show="online">Online</span><span xh-hide="online">Offline</span></div>' }
    ]);

    document.body.innerHTML = `
      <div xh-get="/api/status" xh-trigger="load" xh-template="/tpl/status.html"></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const spans = document.querySelectorAll("span");
    expect(spans[0].style.display).not.toBe("none");
    expect(spans[1].style.display).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// Optimization 5: NodeList iteration (no array conversion) — end-to-end
// ---------------------------------------------------------------------------

describe("NodeList iteration in full flow (no array conversion)", () => {
  test("large template with many xh-* elements renders correctly", async () => {
    const items = [];
    for (let i = 0; i < 30; i++) items.push({ name: "item" + i, idx: i });

    mockFetchSequence([
      { data: { total: 30, items } },
      { html: `<div>
        <p xh-text="total"></p>
        <ul><li xh-each="items"><span xh-text="name"></span> #<em xh-text="idx"></em></li></ul>
      </div>` }
    ]);

    document.body.innerHTML = `
      <div xh-get="/api/items" xh-trigger="load" xh-template="/tpl/items.html"></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(document.querySelector("p").textContent).toBe("30");
    const lis = document.querySelectorAll("li");
    expect(lis.length).toBe(30);
    expect(lis[0].querySelector("span").textContent).toBe("item0");
    expect(lis[29].querySelector("span").textContent).toBe("item29");
  });

  test("xh-if removes elements without breaking iteration", async () => {
    mockFetchSequence([
      { data: { a: true, b: false, c: true, d: false, e: true, va: "A", vc: "C", ve: "E" } },
      { html: `<div>
        <span xh-if="a" xh-text="va"></span>
        <span xh-if="b" xh-text="vb"></span>
        <span xh-if="c" xh-text="vc"></span>
        <span xh-if="d" xh-text="vd"></span>
        <span xh-if="e" xh-text="ve"></span>
      </div>` }
    ]);

    document.body.innerHTML = `
      <div xh-get="/api/flags" xh-trigger="load" xh-template="/tpl/flags.html"></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const spans = document.querySelectorAll("span");
    expect(spans.length).toBe(3);
    expect(spans[0].textContent).toBe("A");
    expect(spans[1].textContent).toBe("C");
    expect(spans[2].textContent).toBe("E");
  });

  test("template rendered multiple times uses cached plan", async () => {
    // First render
    mockFetchSequence([
      { data: { name: "Alice" } },
      { html: '<div><span xh-text="name"></span></div>' }
    ]);

    document.body.innerHTML = `
      <div id="w1" xh-get="/api/user" xh-trigger="load" xh-template="/tpl/name.html"></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(document.querySelector("#w1 span").textContent).toBe("Alice");

    // Second render with same template, different data
    mockFetchSequence([
      { data: { name: "Bob" } },
      { html: '<div><span xh-text="name"></span></div>' }
    ]);

    document.body.innerHTML = `
      <div id="w2" xh-get="/api/user2" xh-trigger="load" xh-template="/tpl/name.html"></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(document.querySelector("#w2 span").textContent).toBe("Bob");
  });
});
