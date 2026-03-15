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
  // Clear i18n state
  var i18n = xhtmlx._internals.i18n;
  i18n._locales = {};
  i18n._locale = null;
  i18n._fallback = "en";
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

describe("i18n integration flow", () => {
  test("xh-i18n elements render translated text after locale set", () => {
    xhtmlx.i18n.load("en", {
      "greeting": "Hello",
      "farewell": "Goodbye"
    });

    document.body.innerHTML = `
      <div>
        <span class="greet" xh-i18n="greeting"></span>
        <span class="bye" xh-i18n="farewell"></span>
      </div>
    `;

    // Setting locale triggers applyI18n(document.body)
    xhtmlx.i18n.locale = "en";

    expect(document.querySelector(".greet").textContent).toBe("Hello");
    expect(document.querySelector(".bye").textContent).toBe("Goodbye");
  });

  test("switching locale re-renders all xh-i18n elements on page", () => {
    xhtmlx.i18n.load("en", {
      "title": "Welcome",
      "btn_label": "Submit"
    });
    xhtmlx.i18n.load("es", {
      "title": "Bienvenido",
      "btn_label": "Enviar"
    });

    document.body.innerHTML = `
      <h1 class="title" xh-i18n="title"></h1>
      <button class="btn" xh-i18n="btn_label"></button>
    `;

    xhtmlx.i18n.locale = "en";

    expect(document.querySelector(".title").textContent).toBe("Welcome");
    expect(document.querySelector(".btn").textContent).toBe("Submit");

    // Switch locale to Spanish
    xhtmlx.i18n.locale = "es";

    expect(document.querySelector(".title").textContent).toBe("Bienvenido");
    expect(document.querySelector(".btn").textContent).toBe("Enviar");
  });

  test("xh-i18n-placeholder sets placeholder attribute from translation", () => {
    xhtmlx.i18n.load("en", {
      "search_hint": "Type to search..."
    });

    document.body.innerHTML = `
      <input class="search-input" type="text" xh-i18n-placeholder="search_hint" />
    `;

    xhtmlx.i18n.locale = "en";

    const input = document.querySelector(".search-input");
    expect(input).not.toBeNull();
    expect(input.getAttribute("placeholder")).toBe("Type to search...");
  });

  test("xh-i18n-vars interpolates variables in translations", () => {
    xhtmlx.i18n.load("en", {
      "welcome_user": "Welcome, {name}! You have {count} messages."
    });

    document.body.innerHTML = `
      <p class="welcome" xh-i18n="welcome_user" xh-i18n-vars='{"name":"Alice","count":"5"}'></p>
    `;

    xhtmlx.i18n.locale = "en";

    const welcome = document.querySelector(".welcome");
    expect(welcome).not.toBeNull();
    expect(welcome.textContent).toBe("Welcome, Alice! You have 5 messages.");
  });

  test("xh:localeChanged event fires when locale switches", async () => {
    xhtmlx.i18n.load("en", { "msg": "English" });
    xhtmlx.i18n.load("fr", { "msg": "French" });
    xhtmlx.i18n.locale = "en";

    document.body.innerHTML = `
      <span class="msg" xh-i18n="msg"></span>
    `;

    // Apply initial i18n
    xhtmlx._internals.applyI18n(document.body);

    const eventPromise = new Promise(resolve => {
      document.body.addEventListener("xh:localeChanged", (e) => {
        resolve(e.detail);
      });
    });

    // Switch locale, which should fire the event
    xhtmlx.i18n.locale = "fr";

    const detail = await eventPromise;
    expect(detail.locale).toBe("fr");
    expect(document.querySelector(".msg").textContent).toBe("French");
  });

  test("fallback locale used when key not found in current locale", () => {
    xhtmlx.i18n.load("en", { "fallback_key": "Fallback Text" });
    xhtmlx.i18n.load("fr", { "french_key": "Texte Francais" });

    document.body.innerHTML = `
      <span class="fb" xh-i18n="fallback_key"></span>
    `;

    // Set locale to French but ask for a key only in English fallback
    xhtmlx.i18n.locale = "fr";

    const fb = document.querySelector(".fb");
    expect(fb.textContent).toBe("Fallback Text");
  });
});
