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

describe("xh-class-*, xh-show, xh-hide full flow after API response", () => {
  test("xh-class-active adds class when API returns truthy isActive", async () => {
    mockFetchJSON({ isActive: true });

    document.body.innerHTML = `
      <div xh-get="/api/status" xh-trigger="load">
        <template>
          <span class="badge" xh-class-active="isActive">Status</span>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const badge = document.querySelector(".badge");
    expect(badge).not.toBeNull();
    expect(badge.classList.contains("active")).toBe(true);
  });

  test("xh-class-active does NOT add class when API returns falsy isActive", async () => {
    mockFetchJSON({ isActive: false });

    document.body.innerHTML = `
      <div xh-get="/api/status" xh-trigger="load">
        <template>
          <span class="badge" xh-class-active="isActive">Status</span>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const badge = document.querySelector(".badge");
    expect(badge).not.toBeNull();
    expect(badge.classList.contains("active")).toBe(false);
  });

  test("multiple xh-class-* on same element in rendered template", async () => {
    mockFetchJSON({ isActive: true, isPrimary: false, isVisible: true });

    document.body.innerHTML = `
      <div xh-get="/api/status" xh-trigger="load">
        <template>
          <div class="widget" xh-class-active="isActive" xh-class-primary="isPrimary" xh-class-visible="isVisible">
            Content
          </div>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const widget = document.querySelector(".widget");
    expect(widget).not.toBeNull();
    expect(widget.classList.contains("active")).toBe(true);
    expect(widget.classList.contains("primary")).toBe(false);
    expect(widget.classList.contains("visible")).toBe(true);
  });

  test("xh-show hides element when API returns falsy value", async () => {
    mockFetchJSON({ showBanner: false });

    document.body.innerHTML = `
      <div xh-get="/api/config" xh-trigger="load">
        <template>
          <div class="banner" xh-show="showBanner">Banner Content</div>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const banner = document.querySelector(".banner");
    expect(banner).not.toBeNull();
    expect(banner.style.display).toBe("none");
  });

  test("xh-show shows element when API returns truthy value", async () => {
    mockFetchJSON({ showBanner: true });

    document.body.innerHTML = `
      <div xh-get="/api/config" xh-trigger="load">
        <template>
          <div class="banner" xh-show="showBanner">Banner Content</div>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const banner = document.querySelector(".banner");
    expect(banner).not.toBeNull();
    expect(banner.style.display).toBe("");
  });

  test("xh-hide shows element when API returns falsy value", async () => {
    mockFetchJSON({ isHidden: false });

    document.body.innerHTML = `
      <div xh-get="/api/config" xh-trigger="load">
        <template>
          <div class="section" xh-hide="isHidden">Visible Section</div>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const section = document.querySelector(".section");
    expect(section).not.toBeNull();
    expect(section.style.display).toBe("");
  });

  test("xh-hide hides element when API returns truthy value", async () => {
    mockFetchJSON({ isHidden: true });

    document.body.innerHTML = `
      <div xh-get="/api/config" xh-trigger="load">
        <template>
          <div class="section" xh-hide="isHidden">Hidden Section</div>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const section = document.querySelector(".section");
    expect(section).not.toBeNull();
    expect(section.style.display).toBe("none");
  });

  test("xh-show and xh-class-* combined on same element", async () => {
    mockFetchJSON({ isVisible: true, isHighlighted: true });

    document.body.innerHTML = `
      <div xh-get="/api/status" xh-trigger="load">
        <template>
          <div class="item" xh-show="isVisible" xh-class-highlighted="isHighlighted">
            Combined
          </div>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const item = document.querySelector(".item");
    expect(item).not.toBeNull();
    expect(item.style.display).toBe("");
    expect(item.classList.contains("highlighted")).toBe(true);
  });

  test("xh-show and xh-class-* combined: hidden with class", async () => {
    mockFetchJSON({ isVisible: false, isHighlighted: true });

    document.body.innerHTML = `
      <div xh-get="/api/status" xh-trigger="load">
        <template>
          <div class="item" xh-show="isVisible" xh-class-highlighted="isHighlighted">
            Combined
          </div>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const item = document.querySelector(".item");
    expect(item).not.toBeNull();
    expect(item.style.display).toBe("none");
    expect(item.classList.contains("highlighted")).toBe(true);
  });
});
