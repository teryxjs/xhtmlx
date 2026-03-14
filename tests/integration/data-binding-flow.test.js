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

describe("Data binding end-to-end", () => {
  test("xh-text renders text content from JSON field", async () => {
    mockFetchJSON({ title: "Hello World", count: 42 });

    document.body.innerHTML = `
      <div xh-get="/api/data" xh-trigger="load">
        <template>
          <h1 class="title" xh-text="title"></h1>
          <span class="count" xh-text="count"></span>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(document.querySelector(".title").textContent).toBe("Hello World");
    expect(document.querySelector(".count").textContent).toBe("42");
  });

  test("xh-html renders HTML content from JSON field", async () => {
    mockFetchJSON({ content: "<strong>Bold</strong> text" });

    document.body.innerHTML = `
      <div xh-get="/api/data" xh-trigger="load">
        <template>
          <div class="content" xh-html="content"></div>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const el = document.querySelector(".content");
    expect(el.innerHTML).toBe("<strong>Bold</strong> text");
    expect(el.querySelector("strong")).not.toBeNull();
    expect(el.querySelector("strong").textContent).toBe("Bold");
  });

  test("xh-attr-* sets arbitrary attributes from JSON fields", async () => {
    mockFetchJSON({
      imageUrl: "https://example.com/photo.jpg",
      altText: "A photo",
      profileLink: "/users/alice"
    });

    document.body.innerHTML = `
      <div xh-get="/api/data" xh-trigger="load">
        <template>
          <img class="avatar" xh-attr-src="imageUrl" xh-attr-alt="altText" />
          <a class="link" xh-attr-href="profileLink">Profile</a>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const img = document.querySelector(".avatar");
    expect(img.getAttribute("src")).toBe("https://example.com/photo.jpg");
    expect(img.getAttribute("alt")).toBe("A photo");

    const link = document.querySelector(".link");
    expect(link.getAttribute("href")).toBe("/users/alice");
  });

  test("nested data access with dot notation works", async () => {
    mockFetchJSON({
      user: {
        name: "Alice",
        address: {
          city: "Wonderland",
          zip: "12345"
        }
      }
    });

    document.body.innerHTML = `
      <div xh-get="/api/data" xh-trigger="load">
        <template>
          <span class="name" xh-text="user.name"></span>
          <span class="city" xh-text="user.address.city"></span>
          <span class="zip" xh-text="user.address.zip"></span>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(document.querySelector(".name").textContent).toBe("Alice");
    expect(document.querySelector(".city").textContent).toBe("Wonderland");
    expect(document.querySelector(".zip").textContent).toBe("12345");
  });

  test("xh-each renders correct number of items", async () => {
    mockFetchJSON({
      items: [
        { name: "Apple", price: 1.5 },
        { name: "Banana", price: 0.75 },
        { name: "Cherry", price: 2.0 }
      ]
    });

    document.body.innerHTML = `
      <div xh-get="/api/data" xh-trigger="load">
        <template>
          <ul id="list">
            <li class="item" xh-each="items">
              <span class="item-name" xh-text="name"></span>
              <span class="item-price" xh-text="price"></span>
            </li>
          </ul>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const items = document.querySelectorAll(".item");
    expect(items.length).toBe(3);

    expect(items[0].querySelector(".item-name").textContent).toBe("Apple");
    expect(items[0].querySelector(".item-price").textContent).toBe("1.5");

    expect(items[1].querySelector(".item-name").textContent).toBe("Banana");
    expect(items[1].querySelector(".item-price").textContent).toBe("0.75");

    expect(items[2].querySelector(".item-name").textContent).toBe("Cherry");
    expect(items[2].querySelector(".item-price").textContent).toBe("2");
  });

  test("xh-each exposes $index for iteration index", async () => {
    mockFetchJSON({
      items: [{ name: "A" }, { name: "B" }, { name: "C" }]
    });

    document.body.innerHTML = `
      <div xh-get="/api/data" xh-trigger="load">
        <template>
          <div class="row" xh-each="items">
            <span class="idx" xh-text="$index"></span>
            <span class="val" xh-text="name"></span>
          </div>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const rows = document.querySelectorAll(".row");
    expect(rows.length).toBe(3);

    expect(rows[0].querySelector(".idx").textContent).toBe("0");
    expect(rows[1].querySelector(".idx").textContent).toBe("1");
    expect(rows[2].querySelector(".idx").textContent).toBe("2");

    expect(rows[0].querySelector(".val").textContent).toBe("A");
    expect(rows[1].querySelector(".val").textContent).toBe("B");
    expect(rows[2].querySelector(".val").textContent).toBe("C");
  });

  test("xh-if conditionally renders elements (truthy)", async () => {
    mockFetchJSON({ is_admin: true, is_guest: false, name: "Alice" });

    document.body.innerHTML = `
      <div xh-get="/api/data" xh-trigger="load">
        <template>
          <span class="admin-badge" xh-if="is_admin">Admin</span>
          <span class="guest-badge" xh-if="is_guest">Guest</span>
          <span class="name" xh-text="name"></span>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(document.querySelector(".admin-badge")).not.toBeNull();
    expect(document.querySelector(".admin-badge").textContent).toBe("Admin");
    expect(document.querySelector(".guest-badge")).toBeNull();
    expect(document.querySelector(".name").textContent).toBe("Alice");
  });

  test("xh-unless conditionally renders elements (falsy)", async () => {
    mockFetchJSON({ verified: false, banned: true });

    document.body.innerHTML = `
      <div xh-get="/api/data" xh-trigger="load">
        <template>
          <span class="unverified" xh-unless="verified">Not verified</span>
          <span class="not-banned" xh-unless="banned">Not banned</span>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(document.querySelector(".unverified")).not.toBeNull();
    expect(document.querySelector(".unverified").textContent).toBe("Not verified");
    expect(document.querySelector(".not-banned")).toBeNull();
  });

  test("xh-if with nested data path works", async () => {
    mockFetchJSON({
      user: { permissions: { canEdit: true, canDelete: false } }
    });

    document.body.innerHTML = `
      <div xh-get="/api/data" xh-trigger="load">
        <template>
          <button class="edit" xh-if="user.permissions.canEdit">Edit</button>
          <button class="delete" xh-if="user.permissions.canDelete">Delete</button>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(document.querySelector(".edit")).not.toBeNull();
    expect(document.querySelector(".delete")).toBeNull();
  });

  test("xh-each with nested objects renders correctly", async () => {
    mockFetchJSON({
      users: [
        { name: "Alice", address: { city: "NYC" } },
        { name: "Bob", address: { city: "LA" } }
      ]
    });

    document.body.innerHTML = `
      <div xh-get="/api/data" xh-trigger="load">
        <template>
          <div class="user-card" xh-each="users">
            <span class="user-name" xh-text="name"></span>
            <span class="user-city" xh-text="address.city"></span>
          </div>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const cards = document.querySelectorAll(".user-card");
    expect(cards.length).toBe(2);

    expect(cards[0].querySelector(".user-name").textContent).toBe("Alice");
    expect(cards[0].querySelector(".user-city").textContent).toBe("NYC");

    expect(cards[1].querySelector(".user-name").textContent).toBe("Bob");
    expect(cards[1].querySelector(".user-city").textContent).toBe("LA");
  });

  test("empty array in xh-each renders no items", async () => {
    mockFetchJSON({ items: [] });

    document.body.innerHTML = `
      <div xh-get="/api/data" xh-trigger="load">
        <template>
          <div id="wrapper">
            <div class="item" xh-each="items">
              <span xh-text="name"></span>
            </div>
          </div>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const items = document.querySelectorAll(".item");
    expect(items.length).toBe(0);
  });

  test("null and undefined values render as empty string in xh-text", async () => {
    mockFetchJSON({ present: "value", absent: null });

    document.body.innerHTML = `
      <div xh-get="/api/data" xh-trigger="load">
        <template>
          <span class="present" xh-text="present"></span>
          <span class="absent" xh-text="absent"></span>
          <span class="missing" xh-text="nonexistent"></span>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(document.querySelector(".present").textContent).toBe("value");
    expect(document.querySelector(".absent").textContent).toBe("");
    expect(document.querySelector(".missing").textContent).toBe("");
  });

  test("boolean and numeric values are rendered as strings in xh-text", async () => {
    mockFetchJSON({ flag: true, count: 0, negative: -5 });

    document.body.innerHTML = `
      <div xh-get="/api/data" xh-trigger="load">
        <template>
          <span class="flag" xh-text="flag"></span>
          <span class="count" xh-text="count"></span>
          <span class="negative" xh-text="negative"></span>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(document.querySelector(".flag").textContent).toBe("true");
    expect(document.querySelector(".count").textContent).toBe("0");
    expect(document.querySelector(".negative").textContent).toBe("-5");
  });
});
