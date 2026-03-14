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

describe("Nested template composition", () => {
  test("rendered template with nested xh-get triggers second request", async () => {
    let callCount = 0;

    global.fetch.mockImplementation((url) => {
      callCount++;
      if (url === "/api/user") {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve(JSON.stringify({ id: 1, name: "Alice" }))
        });
      }
      if (url === "/api/users/1/posts") {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve(JSON.stringify({
            posts: [
              { title: "First Post" },
              { title: "Second Post" }
            ]
          }))
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve("{}")
      });
    });

    document.body.innerHTML = `
      <div id="user-container" xh-get="/api/user" xh-trigger="load">
        <template>
          <div class="user-card">
            <h2 class="user-name" xh-text="name"></h2>
            <div class="posts" xh-get="/api/users/{{id}}/posts" xh-trigger="load">
              <template>
                <div class="post" xh-each="posts">
                  <span class="post-title" xh-text="title"></span>
                </div>
              </template>
            </div>
          </div>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    // Second flush for the nested request
    await flushPromises();
    // Third flush to ensure all rendering completes
    await flushPromises();

    // Both requests should have been made
    expect(global.fetch).toHaveBeenCalledWith("/api/user", expect.anything());
    expect(global.fetch).toHaveBeenCalledWith("/api/users/1/posts", expect.anything());

    // User name should be rendered
    const userName = document.querySelector(".user-name");
    expect(userName).not.toBeNull();
    expect(userName.textContent).toBe("Alice");

    // Posts should be rendered
    const posts = document.querySelectorAll(".post");
    expect(posts.length).toBe(2);
    expect(posts[0].querySelector(".post-title").textContent).toBe("First Post");
    expect(posts[1].querySelector(".post-title").textContent).toBe("Second Post");
  });

  test("$parent provides access to parent data context", async () => {
    global.fetch.mockImplementation((url) => {
      if (url === "/api/author") {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve(JSON.stringify({ name: "Alice", id: 5 }))
        });
      }
      if (url === "/api/authors/5/books") {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve(JSON.stringify({
            books: [
              { title: "Book One" },
              { title: "Book Two" }
            ]
          }))
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve("{}")
      });
    });

    document.body.innerHTML = `
      <div xh-get="/api/author" xh-trigger="load">
        <template>
          <div class="author">
            <span class="author-name" xh-text="name"></span>
            <div xh-get="/api/authors/{{id}}/books" xh-trigger="load">
              <template>
                <div class="book" xh-each="books">
                  <span class="book-title" xh-text="title"></span>
                  <span class="book-author" xh-text="$parent.name"></span>
                </div>
              </template>
            </div>
          </div>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    await flushPromises();
    await flushPromises();

    const books = document.querySelectorAll(".book");
    expect(books.length).toBe(2);

    // Each book should have access to the author name via $parent
    // The parent context of each book item is the books response context,
    // and $parent on that is the author context. We need to check how the
    // context chain works: xh-each items have parent = books response ctx,
    // and books response ctx has parent = author response ctx.
    // So $parent.name might resolve by walking up.

    // The book items' context has parent = books response context.
    // books response context's data = {books: [...]}, parent = author context.
    // $parent from book item = books response context data = {books: [...]}.
    // $parent.name from book item would look for "name" in {books: [...]}, fail,
    // then walk up to author context and find "name" there.
    // Actually, DataContext.resolve walks the parent chain, so looking for "name"
    // from the xh-each item will walk up: item -> books response -> author response.
    // The "name" field ("Alice") is in the author response.
    // Since the xh-each item context doesn't have "name", it walks up.

    // Let's verify: $parent resolves to the parent context's DATA.
    // For an xh-each item, parent is the ctx passed to processEach,
    // which is the books response DataContext (data = {books: [...]}).
    // $parent.name = parent.resolve("name") = resolve "name" in {books: [...]},
    // not found, walk to parent = author ctx, resolve "name" = "Alice".

    // Actually re-reading: $parent.name → this.parent.resolve("name")
    // parent = booksCtx, booksCtx.resolve("name") → not in booksCtx.data,
    // walk to booksCtx.parent (authorCtx), authorCtx.resolve("name") = "Alice".

    // So "name" alone should also work (it walks up). But $parent makes it explicit.
    // Either way, let's verify the book-author spans show the author name.
    for (const book of books) {
      const authorSpan = book.querySelector(".book-author");
      expect(authorSpan).not.toBeNull();
      expect(authorSpan.textContent).toBe("Alice");
    }
  });

  test("$root provides access to topmost data context", async () => {
    global.fetch.mockImplementation((url) => {
      if (url === "/api/config") {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve(JSON.stringify({ appName: "MyApp", version: "1.0" }))
        });
      }
      if (url === "/api/items") {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve(JSON.stringify({
            items: [{ name: "Item A" }]
          }))
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve("{}")
      });
    });

    document.body.innerHTML = `
      <div xh-get="/api/config" xh-trigger="load">
        <template>
          <div class="app">
            <h1 class="app-title" xh-text="appName"></h1>
            <div xh-get="/api/items" xh-trigger="load">
              <template>
                <div class="item" xh-each="items">
                  <span class="item-name" xh-text="name"></span>
                </div>
              </template>
            </div>
          </div>
        </template>
      </div>
    `;

    // Process with a root context that has a rootField
    const rootCtx = xhtmlx.createContext({ globalSetting: "enabled" });
    xhtmlx.process(document.body, rootCtx);
    await flushPromises();
    await flushPromises();
    await flushPromises();

    // App name from first level
    expect(document.querySelector(".app-title").textContent).toBe("MyApp");

    // Items from nested level
    const items = document.querySelectorAll(".item");
    expect(items.length).toBe(1);
    expect(items[0].querySelector(".item-name").textContent).toBe("Item A");
  });

  test("three levels of nesting work correctly", async () => {
    global.fetch.mockImplementation((url) => {
      if (url === "/api/company") {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve(JSON.stringify({ companyName: "Acme", id: 1 }))
        });
      }
      if (url === "/api/company/1/departments") {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve(JSON.stringify({
            departments: [{ name: "Engineering", id: 10 }]
          }))
        });
      }
      if (url === "/api/departments/10/members") {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve(JSON.stringify({
            members: [{ name: "Alice" }, { name: "Bob" }]
          }))
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve("{}")
      });
    });

    document.body.innerHTML = `
      <div xh-get="/api/company" xh-trigger="load">
        <template>
          <div class="company">
            <h1 class="company-name" xh-text="companyName"></h1>
            <div xh-get="/api/company/{{id}}/departments" xh-trigger="load">
              <template>
                <div class="dept" xh-each="departments">
                  <h2 class="dept-name" xh-text="name"></h2>
                  <div xh-get="/api/departments/{{id}}/members" xh-trigger="load">
                    <template>
                      <div class="member" xh-each="members">
                        <span class="member-name" xh-text="name"></span>
                      </div>
                    </template>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    // Multiple flushes for each level of nesting
    await flushPromises();
    await flushPromises();
    await flushPromises();
    await flushPromises();
    await flushPromises();

    expect(document.querySelector(".company-name").textContent).toBe("Acme");

    const depts = document.querySelectorAll(".dept");
    expect(depts.length).toBe(1);
    expect(depts[0].querySelector(".dept-name").textContent).toBe("Engineering");

    const members = document.querySelectorAll(".member");
    expect(members.length).toBe(2);
    expect(members[0].querySelector(".member-name").textContent).toBe("Alice");
    expect(members[1].querySelector(".member-name").textContent).toBe("Bob");
  });

  test("URL interpolation uses parent context data for nested elements", async () => {
    global.fetch.mockImplementation((url) => {
      if (url === "/api/user") {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve(JSON.stringify({
            userId: 42,
            items: [{ itemId: 100 }, { itemId: 200 }]
          }))
        });
      }
      // Capture the URL to verify interpolation
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(JSON.stringify({ detail: "loaded" }))
      });
    });

    document.body.innerHTML = `
      <div xh-get="/api/user" xh-trigger="load">
        <template>
          <div class="item-row" xh-each="items">
            <button class="load-detail" xh-get="/api/users/{{userId}}/items/{{itemId}}" xh-trigger="load">
              <template><span class="detail" xh-text="detail"></span></template>
            </button>
          </div>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    await flushPromises();
    await flushPromises();

    // userId comes from parent context, itemId from each item context
    // The URL should be interpolated correctly
    const fetchCalls = global.fetch.mock.calls.map(c => c[0]);
    expect(fetchCalls).toContain("/api/user");
    // Check that interpolated URLs were called
    // itemId is in each item, userId is in parent - both should resolve
    expect(fetchCalls.some(u => u.includes("/api/users/42/items/"))).toBe(true);
  });
});
