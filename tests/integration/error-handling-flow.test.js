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

function mockFetchError(status, statusText, body) {
  global.fetch.mockResolvedValue({
    ok: false,
    status: status,
    statusText: statusText || "Error",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body))
  });
}

// Mock fetchTemplate for error templates by intercepting fetch calls
function mockFetchWithErrorTemplate(errorStatus, errorBody, templateHtml) {
  global.fetch.mockImplementation((url, _opts) => {
    // If fetching a template file, return the template HTML
    if (url.endsWith(".html")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(templateHtml)
      });
    }
    // Otherwise return the error response
    return Promise.resolve({
      ok: false,
      status: errorStatus,
      statusText: "Error",
      json: () => Promise.resolve(errorBody),
      text: () => Promise.resolve(JSON.stringify(errorBody))
    });
  });
}

describe("Error handling end-to-end", () => {
  test("error response adds xh-error class when no error template is set", async () => {
    mockFetchError(500, "Internal Server Error", { error: "something broke" });

    document.body.innerHTML = `
      <div id="source" xh-get="/api/data" xh-trigger="load">
        <template><span xh-text="name"></span></template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const el = document.getElementById("source");
    expect(el.classList.contains("xh-error")).toBe(true);
  });

  test("xh:responseError event fires with correct detail on error", async () => {
    const errorBody = { error: "not_found", message: "User not found" };
    mockFetchError(404, "Not Found", errorBody);

    document.body.innerHTML = `
      <div id="source" xh-get="/api/users/999" xh-trigger="load">
        <template><span xh-text="name"></span></template>
      </div>
    `;

    const eventHandler = jest.fn();
    document.body.addEventListener("xh:responseError", eventHandler);

    xhtmlx.process(document.body);
    await flushPromises();

    expect(eventHandler).toHaveBeenCalledTimes(1);
    const detail = eventHandler.mock.calls[0][0].detail;
    expect(detail.status).toBe(404);
    expect(detail.body).toEqual(errorBody);

    document.body.removeEventListener("xh:responseError", eventHandler);
  });

  test("error template is rendered with error data context", async () => {
    const errorBody = { error: "validation_failed", message: "Invalid email" };

    mockFetchWithErrorTemplate(422, errorBody,
      '<div class="error-content"><span class="status" xh-text="status"></span><span class="msg" xh-text="body.message"></span></div>'
    );

    document.body.innerHTML = `
      <div id="source" xh-get="/api/data" xh-trigger="load"
           xh-error-template="/templates/error.html">
        <template><span xh-text="name"></span></template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    // Extra flush for template fetch
    await flushPromises();

    const statusEl = document.querySelector(".status");
    expect(statusEl).not.toBeNull();
    expect(statusEl.textContent).toBe("422");

    const msgEl = document.querySelector(".msg");
    expect(msgEl).not.toBeNull();
    expect(msgEl.textContent).toBe("Invalid email");
  });

  test("status-specific error template (exact code) is selected", async () => {
    const errorBody = { message: "Not found" };

    global.fetch.mockImplementation((url) => {
      if (url === "/templates/404.html") {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve('<div class="not-found"><span class="code" xh-text="status"></span></div>')
        });
      }
      if (url === "/templates/error.html") {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve('<div class="generic-error">Generic</div>')
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: () => Promise.resolve(JSON.stringify(errorBody))
      });
    });

    document.body.innerHTML = `
      <div id="source" xh-get="/api/users/999" xh-trigger="load"
           xh-error-template="/templates/error.html"
           xh-error-template-404="/templates/404.html">
        <template><span xh-text="name"></span></template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    await flushPromises();

    // The 404-specific template should be used, not the generic one
    expect(document.querySelector(".not-found")).not.toBeNull();
    expect(document.querySelector(".code").textContent).toBe("404");
    expect(document.querySelector(".generic-error")).toBeNull();
  });

  test("status-class error template (4xx) is selected for 400 status", async () => {
    const errorBody = { message: "Bad request" };

    global.fetch.mockImplementation((url) => {
      if (url === "/templates/4xx.html") {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve('<div class="client-error"><span class="code" xh-text="status"></span></div>')
        });
      }
      if (url === "/templates/error.html") {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve('<div class="generic-error">Generic</div>')
        });
      }
      return Promise.resolve({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: () => Promise.resolve(JSON.stringify(errorBody))
      });
    });

    document.body.innerHTML = `
      <div id="source" xh-get="/api/data" xh-trigger="load"
           xh-error-template="/templates/error.html"
           xh-error-template-4xx="/templates/4xx.html">
        <template><span xh-text="name"></span></template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    await flushPromises();

    expect(document.querySelector(".client-error")).not.toBeNull();
    expect(document.querySelector(".code").textContent).toBe("400");
    expect(document.querySelector(".generic-error")).toBeNull();
  });

  test("error template resolution priority: exact > class > generic", async () => {
    const errorBody = { message: "Server error" };

    global.fetch.mockImplementation((url) => {
      if (url === "/templates/500.html") {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve('<div class="exact-500">500</div>')
        });
      }
      if (url === "/templates/5xx.html") {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve('<div class="class-5xx">5xx</div>')
        });
      }
      if (url === "/templates/error.html") {
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve('<div class="generic">Generic</div>')
        });
      }
      return Promise.resolve({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: () => Promise.resolve(JSON.stringify(errorBody))
      });
    });

    document.body.innerHTML = `
      <div id="source" xh-get="/api/data" xh-trigger="load"
           xh-error-template="/templates/error.html"
           xh-error-template-5xx="/templates/5xx.html"
           xh-error-template-500="/templates/500.html">
        <template><span xh-text="name"></span></template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    await flushPromises();

    // Exact match (500) should win
    expect(document.querySelector(".exact-500")).not.toBeNull();
    expect(document.querySelector(".class-5xx")).toBeNull();
    expect(document.querySelector(".generic")).toBeNull();
  });

  test("xh-error-target directs error content to a different element", async () => {
    const errorBody = { message: "Oops" };

    mockFetchWithErrorTemplate(500, errorBody,
      '<div class="err-msg" xh-text="body.message"></div>'
    );

    document.body.innerHTML = `
      <div id="source" xh-get="/api/data" xh-trigger="load"
           xh-error-template="/templates/error.html"
           xh-error-target="#error-area">
        <template><span xh-text="name"></span></template>
      </div>
      <div id="error-area"></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    await flushPromises();

    const errorArea = document.getElementById("error-area");
    const errMsg = errorArea.querySelector(".err-msg");
    expect(errMsg).not.toBeNull();
    expect(errMsg.textContent).toBe("Oops");
  });

  test("multiple error responses each fire xh:responseError", async () => {
    const eventHandler = jest.fn();
    document.body.addEventListener("xh:responseError", eventHandler);

    // First element gets 404
    global.fetch.mockImplementation((url) => {
      if (url === "/api/a") {
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: "Not Found",
          text: () => Promise.resolve(JSON.stringify({ err: "not found" }))
        });
      }
      if (url === "/api/b") {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: "Server Error",
          text: () => Promise.resolve(JSON.stringify({ err: "server" }))
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve("{}")
      });
    });

    document.body.innerHTML = `
      <div id="a" xh-get="/api/a" xh-trigger="load">
        <template><span></span></template>
      </div>
      <div id="b" xh-get="/api/b" xh-trigger="load">
        <template><span></span></template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    expect(eventHandler).toHaveBeenCalledTimes(2);

    const statuses = eventHandler.mock.calls.map(c => c[0].detail.status);
    expect(statuses).toContain(404);
    expect(statuses).toContain(500);

    document.body.removeEventListener("xh:responseError", eventHandler);
  });

  test("xh-error class is added alongside error template rendering", async () => {
    const errorBody = { error: "fail" };

    mockFetchWithErrorTemplate(422, errorBody,
      '<div class="err">Error</div>'
    );

    document.body.innerHTML = `
      <div id="source" xh-get="/api/data" xh-trigger="load"
           xh-error-template="/templates/error.html">
        <template><span xh-text="name"></span></template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    await flushPromises();

    const el = document.getElementById("source");
    expect(el.classList.contains("xh-error")).toBe(true);
    expect(document.querySelector(".err")).not.toBeNull();
  });
});

describe("Error boundary end-to-end", () => {
  afterEach(() => {
    xhtmlx.config.defaultErrorTemplate = null;
    xhtmlx.config.defaultErrorTarget = null;
  });

  test("error boundary catches child widget errors", async () => {
    global.fetch.mockImplementation((url) => {
      if (url.endsWith(".html")) {
        return Promise.resolve({
          ok: true, status: 200, statusText: "OK",
          text: () => Promise.resolve('<div class="boundary-err"><span class="err-status" xh-text="status"></span><span class="err-msg" xh-text="body.message"></span></div>')
        });
      }
      return Promise.resolve({
        ok: false, status: 404, statusText: "Not Found",
        text: () => Promise.resolve(JSON.stringify({ message: "Widget not found" }))
      });
    });

    document.body.innerHTML = `
      <div id="boundary" xh-error-boundary xh-error-template="/templates/boundary-error.html">
        <div id="widget" xh-get="/api/widget" xh-trigger="load">
          <template><span xh-text="data"></span></template>
        </div>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    await flushPromises();

    // Error should be rendered inside the boundary element
    const errStatus = document.querySelector(".err-status");
    expect(errStatus).not.toBeNull();
    expect(errStatus.textContent).toBe("404");

    const errMsg = document.querySelector(".err-msg");
    expect(errMsg.textContent).toBe("Widget not found");
  });

  test("error boundary with xh-error-target swaps into specific container", async () => {
    global.fetch.mockImplementation((url) => {
      if (url.endsWith(".html")) {
        return Promise.resolve({
          ok: true, status: 200, statusText: "OK",
          text: () => Promise.resolve('<div class="err-content"><span class="err-code" xh-text="status"></span></div>')
        });
      }
      return Promise.resolve({
        ok: false, status: 500, statusText: "Server Error",
        text: () => Promise.resolve(JSON.stringify({ message: "Crash" }))
      });
    });

    document.body.innerHTML = `
      <div xh-error-boundary xh-error-template="/templates/err.html" xh-error-target="#err-box">
        <div id="err-box"></div>
        <div xh-get="/api/fail" xh-trigger="load">
          <template><span xh-text="data"></span></template>
        </div>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    await flushPromises();

    const errBox = document.getElementById("err-box");
    const errCode = errBox.querySelector(".err-code");
    expect(errCode).not.toBeNull();
    expect(errCode.textContent).toBe("500");
  });

  test("element-level error template overrides boundary", async () => {
    global.fetch.mockImplementation((url) => {
      if (url === "/templates/element-err.html") {
        return Promise.resolve({
          ok: true, status: 200, statusText: "OK",
          text: () => Promise.resolve('<div class="element-error">Element caught it</div>')
        });
      }
      if (url === "/templates/boundary-err.html") {
        return Promise.resolve({
          ok: true, status: 200, statusText: "OK",
          text: () => Promise.resolve('<div class="boundary-error">Boundary caught it</div>')
        });
      }
      return Promise.resolve({
        ok: false, status: 404, statusText: "Not Found",
        text: () => Promise.resolve(JSON.stringify({ message: "nope" }))
      });
    });

    document.body.innerHTML = `
      <div xh-error-boundary xh-error-template="/templates/boundary-err.html">
        <div id="widget" xh-get="/api/fail" xh-trigger="load"
             xh-error-template="/templates/element-err.html">
          <template><span xh-text="data"></span></template>
        </div>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    await flushPromises();

    expect(document.querySelector(".element-error")).not.toBeNull();
    expect(document.querySelector(".boundary-error")).toBeNull();
  });

  test("nested boundaries: inner catches its own errors", async () => {
    global.fetch.mockImplementation((url) => {
      if (url === "/templates/inner.html") {
        return Promise.resolve({
          ok: true, status: 200, statusText: "OK",
          text: () => Promise.resolve('<div class="inner-err">Inner boundary</div>')
        });
      }
      if (url === "/templates/outer.html") {
        return Promise.resolve({
          ok: true, status: 200, statusText: "OK",
          text: () => Promise.resolve('<div class="outer-err">Outer boundary</div>')
        });
      }
      return Promise.resolve({
        ok: false, status: 500, statusText: "Error",
        text: () => Promise.resolve(JSON.stringify({ message: "fail" }))
      });
    });

    document.body.innerHTML = `
      <div xh-error-boundary xh-error-template="/templates/outer.html">
        <div xh-error-boundary xh-error-template="/templates/inner.html">
          <div xh-get="/api/fail" xh-trigger="load">
            <template><span xh-text="data"></span></template>
          </div>
        </div>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    await flushPromises();

    expect(document.querySelector(".inner-err")).not.toBeNull();
    expect(document.querySelector(".outer-err")).toBeNull();
  });
});

describe("Global error config end-to-end", () => {
  afterEach(() => {
    xhtmlx.config.defaultErrorTemplate = null;
    xhtmlx.config.defaultErrorTarget = null;
  });

  test("global defaultErrorTemplate catches errors when no element or boundary match", async () => {
    xhtmlx.config.defaultErrorTemplate = "/templates/global-err.html";
    xhtmlx.config.defaultErrorTarget = "#global-error";

    global.fetch.mockImplementation((url) => {
      if (url === "/templates/global-err.html") {
        return Promise.resolve({
          ok: true, status: 200, statusText: "OK",
          text: () => Promise.resolve('<div class="global-err"><span class="g-status" xh-text="status"></span></div>')
        });
      }
      return Promise.resolve({
        ok: false, status: 503, statusText: "Service Unavailable",
        text: () => Promise.resolve(JSON.stringify({ message: "down" }))
      });
    });

    document.body.innerHTML = `
      <div id="global-error"></div>
      <div xh-get="/api/service" xh-trigger="load">
        <template><span xh-text="data"></span></template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    await flushPromises();

    const globalErr = document.getElementById("global-error");
    const gStatus = globalErr.querySelector(".g-status");
    expect(gStatus).not.toBeNull();
    expect(gStatus.textContent).toBe("503");
  });

  test("boundary overrides global config", async () => {
    xhtmlx.config.defaultErrorTemplate = "/templates/global.html";
    xhtmlx.config.defaultErrorTarget = "#global-error";

    global.fetch.mockImplementation((url) => {
      if (url === "/templates/boundary.html") {
        return Promise.resolve({
          ok: true, status: 200, statusText: "OK",
          text: () => Promise.resolve('<div class="boundary-won">Boundary wins</div>')
        });
      }
      if (url === "/templates/global.html") {
        return Promise.resolve({
          ok: true, status: 200, statusText: "OK",
          text: () => Promise.resolve('<div class="global-won">Global wins</div>')
        });
      }
      return Promise.resolve({
        ok: false, status: 500, statusText: "Error",
        text: () => Promise.resolve(JSON.stringify({ message: "fail" }))
      });
    });

    document.body.innerHTML = `
      <div id="global-error"></div>
      <div xh-error-boundary xh-error-template="/templates/boundary.html">
        <div xh-get="/api/fail" xh-trigger="load">
          <template><span xh-text="data"></span></template>
        </div>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    await flushPromises();

    expect(document.querySelector(".boundary-won")).not.toBeNull();
    expect(document.querySelector(".global-won")).toBeNull();
  });

  test("full resolution chain: element > boundary > global", async () => {
    xhtmlx.config.defaultErrorTemplate = "/templates/global.html";

    global.fetch.mockImplementation((url) => {
      if (url === "/templates/element.html") {
        return Promise.resolve({
          ok: true, status: 200, statusText: "OK",
          text: () => Promise.resolve('<div class="element-won">Element wins</div>')
        });
      }
      if (url === "/templates/boundary.html") {
        return Promise.resolve({
          ok: true, status: 200, statusText: "OK",
          text: () => Promise.resolve('<div class="boundary-won">Boundary</div>')
        });
      }
      if (url === "/templates/global.html") {
        return Promise.resolve({
          ok: true, status: 200, statusText: "OK",
          text: () => Promise.resolve('<div class="global-won">Global</div>')
        });
      }
      return Promise.resolve({
        ok: false, status: 500, statusText: "Error",
        text: () => Promise.resolve(JSON.stringify({ message: "fail" }))
      });
    });

    document.body.innerHTML = `
      <div xh-error-boundary xh-error-template="/templates/boundary.html">
        <div xh-get="/api/fail" xh-trigger="load"
             xh-error-template="/templates/element.html">
          <template><span xh-text="data"></span></template>
        </div>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();
    await flushPromises();

    expect(document.querySelector(".element-won")).not.toBeNull();
    expect(document.querySelector(".boundary-won")).toBeNull();
    expect(document.querySelector(".global-won")).toBeNull();
  });
});
