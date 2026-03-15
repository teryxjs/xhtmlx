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

describe("xh-on-* directive full flow after API response", () => {
  test("xh-on-click toggleClass:active toggles class on click", async () => {
    mockFetchJSON({ label: "Toggle Me" });

    document.body.innerHTML = `
      <div xh-get="/api/data" xh-trigger="load">
        <template>
          <button class="toggle-btn" xh-on-click="toggleClass:active" xh-text="label"></button>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const btn = document.querySelector(".toggle-btn");
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe("Toggle Me");
    expect(btn.classList.contains("active")).toBe(false);

    btn.click();
    expect(btn.classList.contains("active")).toBe(true);

    btn.click();
    expect(btn.classList.contains("active")).toBe(false);
  });

  test("xh-on-click remove removes element from DOM", async () => {
    mockFetchJSON({ message: "Dismiss me" });

    document.body.innerHTML = `
      <div xh-get="/api/data" xh-trigger="load" xh-target="#output">
        <template>
          <div class="notification" xh-on-click="remove">
            <span xh-text="message"></span>
          </div>
        </template>
      </div>
      <div id="output"></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const notification = document.querySelector(".notification");
    expect(notification).not.toBeNull();

    notification.click();
    expect(document.querySelector(".notification")).toBeNull();
  });

  test("xh-on-click toggle:#target toggles another element visibility", async () => {
    mockFetchJSON({ btnLabel: "Toggle Panel" });

    document.body.innerHTML = `
      <div xh-get="/api/data" xh-trigger="load" xh-target="#controls">
        <template>
          <button class="toggle-trigger" xh-on-click="toggle:#panel" xh-text="btnLabel"></button>
        </template>
      </div>
      <div id="controls"></div>
      <div id="panel">Panel Content</div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const btn = document.querySelector(".toggle-trigger");
    const panel = document.getElementById("panel");
    expect(btn).not.toBeNull();
    expect(panel.style.display).toBe("");

    btn.click();
    expect(panel.style.display).toBe("none");

    btn.click();
    expect(panel.style.display).toBe("");
  });

  test("xh-on-click dispatch:custom-event fires custom event", async () => {
    mockFetchJSON({ action: "Fire" });

    document.body.innerHTML = `
      <div xh-get="/api/data" xh-trigger="load" xh-target="#output">
        <template>
          <button class="dispatch-btn" xh-on-click="dispatch:my-custom-event" xh-text="action"></button>
        </template>
      </div>
      <div id="output"></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const btn = document.querySelector(".dispatch-btn");
    expect(btn).not.toBeNull();

    const eventPromise = new Promise(resolve => {
      btn.addEventListener("my-custom-event", (e) => {
        resolve(e);
      });
    });

    btn.click();

    const event = await eventPromise;
    expect(event).toBeDefined();
    expect(event.type).toBe("my-custom-event");
    expect(event.bubbles).toBe(true);
  });

  test("xh-on-* works on elements inside xh-each iterations", async () => {
    mockFetchJSON({
      items: [
        { name: "Item A" },
        { name: "Item B" },
        { name: "Item C" }
      ]
    });

    document.body.innerHTML = `
      <div xh-get="/api/data" xh-trigger="load" xh-target="#list-container">
        <template>
          <ul>
            <li class="list-item" xh-each="items" xh-on-click="toggleClass:selected">
              <span class="item-name" xh-text="name"></span>
            </li>
          </ul>
        </template>
      </div>
      <div id="list-container"></div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const items = document.querySelectorAll(".list-item");
    expect(items.length).toBe(3);

    // Click on each item to verify xh-on-click works inside xh-each
    expect(items[0].classList.contains("selected")).toBe(false);
    expect(items[1].classList.contains("selected")).toBe(false);

    items[0].click();
    expect(items[0].classList.contains("selected")).toBe(true);
    expect(items[1].classList.contains("selected")).toBe(false);

    items[1].click();
    expect(items[1].classList.contains("selected")).toBe(true);

    // Toggle off
    items[0].click();
    expect(items[0].classList.contains("selected")).toBe(false);
  });

  test("xh-on-click addClass adds a class to element", async () => {
    mockFetchJSON({ text: "Highlight me" });

    document.body.innerHTML = `
      <div xh-get="/api/data" xh-trigger="load">
        <template>
          <div class="card" xh-on-click="addClass:selected" xh-text="text"></div>
        </template>
      </div>
    `;

    xhtmlx.process(document.body);
    await flushPromises();

    const card = document.querySelector(".card");
    expect(card.classList.contains("selected")).toBe(false);

    card.click();
    expect(card.classList.contains("selected")).toBe(true);

    // Clicking again should not remove it (addClass, not toggle)
    card.click();
    expect(card.classList.contains("selected")).toBe(true);
  });
});
