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
});

afterEach(() => {
  delete global.fetch;
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

describe("Basic request -> template -> render -> swap flow", () => {
  test("xh-get with inline template renders JSON data into the DOM", async () => {
    mockFetchJSON({ name: "Alice", email: "alice@example.com" });

    document.body.innerHTML = `
      <div id="source" xh-get="/api/user" xh-trigger="load">
        <template>
          <div class="user">
            <span class="name" xh-text="name"></span>
            <span class="email" xh-text="email"></span>
          </div>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledWith("/api/user", expect.objectContaining({
      method: "GET"
    }));

    const nameEl = document.querySelector(".name");
    const emailEl = document.querySelector(".email");

    expect(nameEl).not.toBeNull();
    expect(nameEl.textContent).toBe("Alice");
    expect(emailEl).not.toBeNull();
    expect(emailEl.textContent).toBe("alice@example.com");
  });

  test("xh-target swaps rendered content into a different element", async () => {
    mockFetchJSON({ message: "Hello World" });

    document.body.innerHTML = `
      <button id="btn" xh-get="/api/hello" xh-trigger="load" xh-target="#output">
        <template>
          <p class="msg" xh-text="message"></p>
        </template>
      </button>
      <div id="output"></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const output = document.getElementById("output");
    const msg = output.querySelector(".msg");

    expect(msg).not.toBeNull();
    expect(msg.textContent).toBe("Hello World");

    // The button should still exist
    expect(document.getElementById("btn")).not.toBeNull();
  });

  test("xh-swap innerHTML replaces target children (default)", async () => {
    mockFetchJSON({ text: "New content" });

    document.body.innerHTML = `
      <div id="trigger" xh-get="/api/data" xh-trigger="load" xh-target="#container" xh-swap="innerHTML">
        <template>
          <span class="new" xh-text="text"></span>
        </template>
      </div>
      <div id="container"><p class="old">Old content</p></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const container = document.getElementById("container");
    expect(container.querySelector(".old")).toBeNull();
    expect(container.querySelector(".new")).not.toBeNull();
    expect(container.querySelector(".new").textContent).toBe("New content");
  });

  test("xh-swap beforeend appends to target", async () => {
    mockFetchJSON({ text: "Appended" });

    document.body.innerHTML = `
      <div id="trigger" xh-get="/api/data" xh-trigger="load" xh-target="#container" xh-swap="beforeend">
        <template>
          <span class="appended" xh-text="text"></span>
        </template>
      </div>
      <div id="container"><p class="existing">Existing</p></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const container = document.getElementById("container");
    expect(container.querySelector(".existing")).not.toBeNull();
    expect(container.querySelector(".appended")).not.toBeNull();
    expect(container.querySelector(".appended").textContent).toBe("Appended");
    // Existing should come before appended
    const children = Array.from(container.children);
    const existingIdx = children.indexOf(container.querySelector(".existing"));
    const appendedIdx = children.indexOf(container.querySelector(".appended"));
    expect(existingIdx).toBeLessThan(appendedIdx);
  });

  test("xh-swap afterbegin prepends to target", async () => {
    mockFetchJSON({ text: "Prepended" });

    document.body.innerHTML = `
      <div id="trigger" xh-get="/api/data" xh-trigger="load" xh-target="#container" xh-swap="afterbegin">
        <template>
          <span class="prepended" xh-text="text"></span>
        </template>
      </div>
      <div id="container"><p class="existing">Existing</p></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const container = document.getElementById("container");
    expect(container.querySelector(".existing")).not.toBeNull();
    expect(container.querySelector(".prepended")).not.toBeNull();
    expect(container.querySelector(".prepended").textContent).toBe("Prepended");
    // Prepended should come before existing
    const children = Array.from(container.children);
    const prependedIdx = children.indexOf(container.querySelector(".prepended"));
    const existingIdx = children.indexOf(container.querySelector(".existing"));
    expect(prependedIdx).toBeLessThan(existingIdx);
  });

  test("xh-swap outerHTML replaces target element itself", async () => {
    mockFetchJSON({ text: "Replaced" });

    document.body.innerHTML = `
      <div id="trigger" xh-get="/api/data" xh-trigger="load" xh-target="#container" xh-swap="outerHTML">
        <template>
          <div class="replacement" xh-text="text"></div>
        </template>
      </div>
      <div id="container"><p>Old content</p></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(document.getElementById("container")).toBeNull();
    const replacement = document.querySelector(".replacement");
    expect(replacement).not.toBeNull();
    expect(replacement.textContent).toBe("Replaced");
  });

  test("xh-swap beforebegin inserts before target", async () => {
    mockFetchJSON({ text: "Before" });

    document.body.innerHTML = `
      <div id="trigger" xh-get="/api/data" xh-trigger="load" xh-target="#container" xh-swap="beforebegin">
        <template>
          <span class="before" xh-text="text"></span>
        </template>
      </div>
      <div id="container"><p>Target content</p></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const container = document.getElementById("container");
    expect(container).not.toBeNull();
    const before = document.querySelector(".before");
    expect(before).not.toBeNull();
    expect(before.textContent).toBe("Before");
  });

  test("xh-swap afterend inserts after target", async () => {
    mockFetchJSON({ text: "After" });

    document.body.innerHTML = `
      <div id="trigger" xh-get="/api/data" xh-trigger="load" xh-target="#container" xh-swap="afterend">
        <template>
          <span class="after" xh-text="text"></span>
        </template>
      </div>
      <div id="container"><p>Target content</p></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const container = document.getElementById("container");
    expect(container).not.toBeNull();
    const after = document.querySelector(".after");
    expect(after).not.toBeNull();
    expect(after.textContent).toBe("After");
  });

  test("xh-swap delete removes the target element", async () => {
    mockFetchJSON({});

    document.body.innerHTML = `
      <div id="trigger" xh-get="/api/data" xh-trigger="load" xh-target="#container" xh-swap="delete">
        <template><span></span></template>
      </div>
      <div id="container"><p>To be removed</p></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(document.getElementById("container")).toBeNull();
  });

  test("xh-swap none does not modify the DOM", async () => {
    mockFetchJSON({ data: "value" });

    document.body.innerHTML = `
      <div id="trigger" xh-get="/api/data" xh-trigger="load" xh-target="#container" xh-swap="none">
        <template><span>New</span></template>
      </div>
      <div id="container"><p class="original">Original</p></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const container = document.getElementById("container");
    expect(container.querySelector(".original")).not.toBeNull();
    expect(container.querySelector(".original").textContent).toBe("Original");
  });

  test("URL interpolation with {{field}} works from data context", async () => {
    // First request returns user data
    mockFetchJSON({ id: 42, name: "Alice" });

    document.body.innerHTML = `
      <div id="source" xh-get="/api/user" xh-trigger="load">
        <template>
          <div class="user">
            <span class="name" xh-text="name"></span>
            <button class="detail-btn" xh-get="/api/users/{{id}}/detail" xh-trigger="load">
              <template><span class="detail">loaded</span></template>
            </button>
          </div>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    // Second request should have been called with interpolated URL
    await flushPromises();

    expect(global.fetch).toHaveBeenCalledWith("/api/users/42/detail", expect.anything());
  });

  test("self-binding when no template is provided applies bindings to element itself", async () => {
    mockFetchJSON({ title: "My Title" });

    document.body.innerHTML = `
      <div id="source" xh-get="/api/page" xh-trigger="load">
        <span class="title" xh-text="title"></span>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const title = document.querySelector(".title");
    expect(title).not.toBeNull();
    expect(title.textContent).toBe("My Title");
  });
});
