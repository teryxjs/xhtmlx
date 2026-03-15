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
  // Mock history.pushState and replaceState
  jest.spyOn(history, "pushState").mockImplementation(() => {});
  jest.spyOn(history, "replaceState").mockImplementation(() => {});
});

afterEach(() => {
  delete global.fetch;
  history.pushState.mockRestore();
  history.replaceState.mockRestore();
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

describe("xh-push-url and xh-replace-url full flow", () => {
  test("xh-push-url='true' calls pushState with request URL after successful swap", async () => {
    mockFetchJSON({ title: "Page Data" });

    document.body.innerHTML = `
      <div xh-get="/api/page" xh-trigger="load" xh-push-url="true">
        <template>
          <h1 xh-text="title"></h1>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(history.pushState).toHaveBeenCalledTimes(1);
    expect(history.pushState).toHaveBeenCalledWith(
      expect.objectContaining({ xhtmlx: true }),
      "",
      "/api/page"
    );
  });

  test("xh-push-url='/custom/path' calls pushState with custom path", async () => {
    mockFetchJSON({ id: 5, name: "Widget" });

    document.body.innerHTML = `
      <div xh-get="/api/widget" xh-trigger="load" xh-push-url="/custom/path">
        <template>
          <span xh-text="name"></span>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(history.pushState).toHaveBeenCalledTimes(1);
    expect(history.pushState).toHaveBeenCalledWith(
      expect.objectContaining({ xhtmlx: true }),
      "",
      "/custom/path"
    );
  });

  test("xh-replace-url calls replaceState instead of pushState", async () => {
    mockFetchJSON({ status: "ok" });

    document.body.innerHTML = `
      <div xh-get="/api/status" xh-trigger="load" xh-replace-url="/current/status">
        <template>
          <span xh-text="status"></span>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(history.replaceState).toHaveBeenCalledTimes(1);
    expect(history.replaceState).toHaveBeenCalledWith(
      expect.objectContaining({ xhtmlx: true }),
      "",
      "/current/status"
    );
    expect(history.pushState).not.toHaveBeenCalled();
  });

  test("no pushState called without xh-push-url attribute", async () => {
    mockFetchJSON({ data: "value" });

    document.body.innerHTML = `
      <div xh-get="/api/data" xh-trigger="load">
        <template>
          <span xh-text="data"></span>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(history.pushState).not.toHaveBeenCalled();
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  test("xh-push-url with {{field}} interpolation uses response data", async () => {
    mockFetchJSON({ id: 42, slug: "my-item" });

    document.body.innerHTML = `
      <div xh-get="/api/item" xh-trigger="load" xh-push-url="/items/{{id}}/{{slug}}">
        <template>
          <span xh-text="slug"></span>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(history.pushState).toHaveBeenCalledTimes(1);
    expect(history.pushState).toHaveBeenCalledWith(
      expect.objectContaining({ xhtmlx: true }),
      "",
      "/items/42/my-item"
    );
  });

  test("xh-replace-url='true' uses request URL", async () => {
    mockFetchJSON({ ok: true });

    document.body.innerHTML = `
      <div xh-get="/api/current" xh-trigger="load" xh-replace-url="true">
        <template>
          <span>done</span>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(history.replaceState).toHaveBeenCalledTimes(1);
    expect(history.replaceState).toHaveBeenCalledWith(
      expect.objectContaining({ xhtmlx: true }),
      "",
      "/api/current"
    );
  });
});
