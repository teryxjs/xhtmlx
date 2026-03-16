# xhtmlx

A lightweight, zero-dependency JavaScript library for building dynamic UIs with REST APIs using declarative HTML attributes.

Like [htmx](https://htmx.org), but instead of receiving HTML from the server, xhtmlx receives **JSON** and renders UI **client-side** using templates.

**~10KB gzipped** | **780 tests** | **Zero dependencies** | **No build step**

[Documentation & Demos](https://teryxjs.github.io/xhtmlx/) | [GitHub](https://github.com/teryxjs/xhtmlx)

## Quick Start

```html
<script src="xhtmlx.js"></script>

<div xh-get="/api/users" xh-trigger="load" xh-template="/templates/user-list.html">
  <span class="xh-indicator">Loading...</span>
</div>
<div id="results"></div>
```

```html
<!-- /templates/user-list.html -->
<div xh-each="users">
  <div class="user">
    <span xh-text="name"></span>
    <span xh-text="email"></span>
  </div>
</div>
```

Server returns:
```json
{ "users": [{ "name": "Alice", "email": "alice@example.com" }] }
```

xhtmlx fetches the JSON, loads the template, renders it with the data, and swaps it into the DOM. No JavaScript needed.

## Installation

Drop the script into your page:

```html
<script src="xhtmlx.js"></script>
```

No build step. No dependencies. TypeScript definitions are included (`xhtmlx.d.ts`).

## API Reference

### REST Verbs

| Attribute | Description |
|-----------|-------------|
| `xh-get` | Issue a GET request to the URL |
| `xh-post` | Issue a POST request |
| `xh-put` | Issue a PUT request |
| `xh-delete` | Issue a DELETE request |
| `xh-patch` | Issue a PATCH request |

```html
<button xh-get="/api/users">Load Users</button>
<button xh-post="/api/users" xh-vals='{"name": "Bob"}'>Create User</button>
<button xh-delete="/api/users/{{id}}">Delete</button>
```

### Templates

**External template file:**
```html
<div xh-get="/api/users" xh-template="/templates/user-list.html"></div>
```

**Inline template:**
```html
<div xh-get="/api/users">
  <template>
    <span xh-text="name"></span>
  </template>
</div>
```

Templates can contain xhtmlx attributes, enabling nested API calls and template composition:

```html
<!-- /templates/user-card.html -->
<div class="card">
  <h2 xh-text="name"></h2>
  <div xh-get="/api/users/{{id}}/posts"
       xh-trigger="load"
       xh-template="/templates/post-list.html">
  </div>
</div>
```

### Data Binding

| Attribute | Description |
|-----------|-------------|
| `xh-text` | Set element's textContent from data field |
| `xh-html` | Set element's innerHTML from data field (use with caution) |
| `xh-attr-*` | Set any attribute from data field |

```html
<span xh-text="user.name"></span>
<div xh-html="user.bio"></div>
<img xh-attr-src="user.avatar" xh-attr-alt="user.name">
<a xh-attr-href="user.profile_url" xh-text="user.name"></a>
```

### xh-model (Two-Way Binding)

Bind form inputs to data fields. Pre-fills inputs from data, auto-collects values on submit, and provides live reactivity when backed by a `MutableDataContext`.

```html
<div xh-get="/api/user/1" xh-trigger="load">
  <template>
    <input type="text" xh-model="name">
    <input type="email" xh-model="email">
    <select xh-model="role">
      <option value="user">User</option>
      <option value="admin">Admin</option>
    </select>
    <input type="checkbox" xh-model="active">
    <button xh-put="/api/user/1">Save</button>
  </template>
</div>
```

Supported elements: text inputs, textareas, selects, checkboxes, and radio buttons. Values from `xh-model` inputs are automatically included in request bodies alongside form fields and `xh-vals`.

### xh-class-* (Dynamic CSS Classes)

Toggle CSS classes based on data fields:

```html
<div xh-class-active="is_active" xh-class-highlight="is_featured">
  This element gets "active" and "highlight" classes based on data.
</div>
```

When backed by a `MutableDataContext`, class changes are live-reactive.

### xh-show / xh-hide (Visibility Toggle)

Toggle element visibility without removing from the DOM (unlike `xh-if`/`xh-unless` which remove elements):

```html
<div xh-show="has_details">Visible when has_details is truthy</div>
<div xh-hide="is_loading">Hidden when is_loading is truthy</div>
```

Reactivity-aware: when the data context is mutable, visibility updates automatically on data changes.

### Iteration

`xh-each` repeats the element for each item in an array:

```html
<ul>
  <li xh-each="items">
    <span xh-text="name"></span> - <span xh-text="price"></span>
  </li>
</ul>
```

For data `{ "items": [{ "name": "A", "price": 10 }, { "name": "B", "price": 20 }] }`, this renders two `<li>` elements.

Access the iteration index with `$index`:
```html
<li xh-each="items">
  <span xh-text="$index"></span>. <span xh-text="name"></span>
</li>
```

### Conditionals

| Attribute | Description |
|-----------|-------------|
| `xh-if` | Render element only if field is truthy |
| `xh-unless` | Render element only if field is falsy |

```html
<span xh-if="is_admin" class="badge">Admin</span>
<span xh-unless="verified" class="warning">Unverified</span>
```

### Triggers

`xh-trigger` specifies what event fires the request:

```html
<div xh-get="/api/data" xh-trigger="load">Auto-load on page load</div>
<input xh-get="/api/search" xh-trigger="keyup changed delay:300ms">
<div xh-get="/api/feed" xh-trigger="every 5s">Polling</div>
<div xh-get="/api/more" xh-trigger="revealed">Load when scrolled into view</div>
<button xh-get="/api/data" xh-trigger="click once">Load once</button>
```

**Default triggers:**
- `click` — buttons, links, and general elements
- `submit` — forms
- `change` — inputs, selects, textareas

**Modifiers:**
- `once` — fire only once
- `changed` — only fire if value changed
- `delay:Nms` — debounce before firing
- `throttle:Nms` — throttle firing rate
- `from:selector` — listen on a different element

### Targeting

| Attribute | Description |
|-----------|-------------|
| `xh-target` | CSS selector for where to place the rendered result |
| `xh-swap` | How to insert the content |

```html
<button xh-get="/api/users" xh-target="#user-list" xh-swap="innerHTML">
  Load Users
</button>
<div id="user-list"></div>
```

**Swap modes:**

| Mode | Behavior |
|------|----------|
| `innerHTML` | Replace target's children (default) |
| `outerHTML` | Replace target itself |
| `beforeend` | Append inside target |
| `afterbegin` | Prepend inside target |
| `beforebegin` | Insert before target |
| `afterend` | Insert after target |
| `delete` | Remove target |
| `none` | Don't swap (fire-and-forget) |

### URL Interpolation

Use `{{field}}` in URLs to insert values from the current data context:

```html
<div xh-each="users">
  <button xh-get="/api/users/{{id}}/profile"
          xh-template="/templates/profile.html">
    View Profile
  </button>
</div>
```

Supports dot notation: `{{user.address.city}}`

### Indicators

Show a loading element while a request is in-flight:

```html
<button xh-get="/api/data" xh-indicator="#spinner">Load</button>
<span id="spinner" class="xh-indicator">Loading...</span>
```

The library adds the `xh-request` class to the indicator during requests. Default CSS is injected automatically to show/hide `.xh-indicator` elements.

### Request Data

| Attribute | Description |
|-----------|-------------|
| `xh-vals` | JSON string of values to send with the request |
| `xh-headers` | JSON string of custom headers |

```html
<button xh-post="/api/users"
        xh-vals='{"name": "Alice", "role": "admin"}'
        xh-headers='{"X-Custom": "value"}'>
  Create User
</button>
```

For forms, form fields are automatically serialized:

```html
<form xh-post="/api/users" xh-template="/templates/success.html">
  <input name="name" type="text">
  <input name="email" type="email">
  <button type="submit">Create</button>
</form>
```

### xh-on-* (Declarative Event Handlers)

Attach client-side event handlers without writing JavaScript:

```html
<button xh-on-click="toggleClass:active">Toggle Active</button>
<button xh-on-click="addClass:highlight">Add Highlight</button>
<button xh-on-click="removeClass:highlight">Remove Highlight</button>
<button xh-on-click="remove">Remove Me</button>
<button xh-on-click="toggle:#details">Toggle Details</button>
<button xh-on-click="dispatch:myCustomEvent">Fire Event</button>
```

**Available actions:**

| Action | Description |
|--------|-------------|
| `toggleClass:name` | Toggle a CSS class on the element |
| `addClass:name` | Add a CSS class |
| `removeClass:name` | Remove a CSS class |
| `remove` | Remove the element from the DOM |
| `toggle:selector` | Toggle visibility of another element |
| `dispatch:eventName` | Dispatch a custom DOM event |

### xh-push-url / xh-replace-url (Browser History)

Update the browser URL after a successful request:

```html
<!-- Push a new history entry -->
<button xh-get="/api/users/{{id}}"
        xh-push-url="/users/{{id}}"
        xh-target="#content">
  View User
</button>

<!-- Replace the current history entry -->
<button xh-get="/api/search?q=test"
        xh-replace-url="/search?q=test"
        xh-target="#results">
  Search
</button>
```

Set `xh-push-url="true"` to use the request URL as the history URL. Back/forward navigation re-fetches data and re-renders the template.

### WebSocket

Stream real-time data via WebSocket connections:

```html
<!-- Connect to a WebSocket and render each incoming message -->
<div xh-ws="wss://example.com/feed"
     xh-swap="beforeend"
     xh-target="#messages">
  <template>
    <div class="message">
      <strong xh-text="user"></strong>: <span xh-text="text"></span>
    </div>
  </template>
</div>
<div id="messages"></div>

<!-- Send data over an existing WebSocket connection -->
<form xh-ws-send="#chat-ws">
  <input name="text" type="text">
  <button type="submit">Send</button>
</form>
```

WebSocket events: `xh:wsOpen`, `xh:wsClose`, `xh:wsError`. Auto-reconnects on unexpected disconnection after 3 seconds.

### Request Deduplication

Prevent duplicate requests while one is already in-flight. Optionally apply a CSS class to indicate the disabled state:

```html
<button xh-post="/api/submit"
        xh-disabled-class="btn-loading">
  Submit
</button>
```

While a request is in-flight, the `btn-loading` class is added and `aria-disabled="true"` is set. Subsequent triggers are ignored until the request completes.

### CSS Settle Classes

When new content is swapped into the DOM, xhtmlx applies transition classes for CSS animations:

1. `xh-added` is applied immediately after insertion
2. After two animation frames, `xh-added` is removed and `xh-settled` is added

```css
.xh-added { opacity: 0; transform: translateY(-10px); }
.xh-settled { opacity: 1; transform: translateY(0); transition: all 300ms ease; }
```

### xh-boost (Enhanced Links & Forms)

Enhance regular `<a>` links and `<form>` elements to use AJAX instead of full page navigation:

```html
<nav xh-boost xh-boost-target="#main-content" xh-boost-template="/templates/page.html">
  <a href="/about">About</a>
  <a href="/contact">Contact</a>
  <form action="/api/search" method="POST">
    <input name="q" type="text">
  </form>
</nav>
<div id="main-content"></div>
```

Boosted links automatically push browser history. Links with `target="_blank"`, `mailto:`, or hash-only `href` values are not boosted.

### Response Caching

Cache GET responses to avoid redundant network requests:

```html
<!-- Cache for 60 seconds -->
<div xh-get="/api/config" xh-trigger="load" xh-cache="60">
  <template><span xh-text="version"></span></template>
</div>

<!-- Cache forever (until page reload or manual cache clear) -->
<div xh-get="/api/static-data" xh-trigger="load" xh-cache="forever">
  <template><span xh-text="label"></span></template>
</div>
```

Clear programmatically with `xhtmlx.clearResponseCache()`.

### Retry with Backoff

Automatically retry failed requests (5xx and network errors) with exponential backoff:

```html
<div xh-get="/api/flaky-service"
     xh-trigger="load"
     xh-retry="3"
     xh-retry-delay="1000">
  <template><span xh-text="data"></span></template>
</div>
```

`xh-retry="3"` retries up to 3 times. `xh-retry-delay="1000"` sets the base delay to 1000ms (doubled each attempt: 1s, 2s, 4s). Emits `xh:retry` events on each attempt.

### Error Handling

Specify templates for error responses:

```html
<div xh-get="/api/users"
     xh-template="/templates/user-list.html"
     xh-error-template="/templates/error.html"
     xh-error-template-404="/templates/not-found.html"
     xh-error-template-4xx="/templates/client-error.html"
     xh-error-target="#error-area">
</div>
```

**Resolution order:**
1. `xh-error-template-{exact code}` on the element (e.g. `xh-error-template-404`)
2. `xh-error-template-{class}` on the element (e.g. `xh-error-template-4xx`)
3. `xh-error-template` on the element (generic fallback)
4. Nearest ancestor `xh-error-boundary` (see below)
5. `xhtmlx.config.defaultErrorTemplate` (global fallback)
6. No template: adds `xh-error` CSS class and emits `xh:responseError` event

#### Error Boundaries

Wrap a section of your page with `xh-error-boundary` to catch errors from any child widget that doesn't have its own error template:

```html
<div xh-error-boundary
     xh-error-template="/templates/error.html"
     xh-error-target="#section-errors">
  <div id="section-errors"></div>

  <!-- If this fails and has no error template, the boundary catches it -->
  <div xh-get="/api/widget-a" xh-trigger="load">
    <template><span xh-text="data"></span></template>
  </div>

  <!-- This has its own error template, so the boundary is skipped -->
  <div xh-get="/api/widget-b" xh-trigger="load"
       xh-error-template="/templates/widget-error.html">
    <template><span xh-text="data"></span></template>
  </div>
</div>
```

Boundaries support the same status-specific attributes: `xh-error-template-404`, `xh-error-template-4xx`, etc.

Boundaries nest — the nearest ancestor boundary catches the error:

```html
<div xh-error-boundary xh-error-template="/templates/page-error.html">
  <div xh-error-boundary xh-error-template="/templates/section-error.html">
    <!-- Errors here go to section-error, not page-error -->
    <div xh-get="/api/data" xh-trigger="load">...</div>
  </div>
</div>
```

Error containers are automatically marked with `role="alert"` for screen readers.

#### Global Error Config

Set a page-wide default for widgets without any error handling:

```html
<script>
  xhtmlx.config.defaultErrorTemplate = "/templates/error.html";
  xhtmlx.config.defaultErrorTarget = "#global-error";
</script>
<div id="global-error"></div>
```

Any widget that errors without an element-level template or boundary will use this global fallback.

**Error data context:**
```json
{
  "status": 422,
  "statusText": "Unprocessable Entity",
  "body": { "error": "validation_failed", "fields": [...] }
}
```

Use it in templates like any other data:
```html
<!-- /templates/validation-error.html -->
<div class="error">
  <h3>Error <span xh-text="status"></span></h3>
  <ul xh-each="body.fields">
    <li><strong xh-text="name"></strong>: <span xh-text="message"></span></li>
  </ul>
</div>
```

### Form Validation

Validate inputs before sending requests. Validation runs automatically; if it fails, the request is blocked and `xh:validationError` is emitted.

```html
<form xh-post="/api/register">
  <input name="username" xh-validate="required"
         xh-validate-minlength="3"
         xh-validate-maxlength="20"
         xh-validate-message="Username must be 3-20 characters"
         xh-validate-target="#username-error">
  <span id="username-error"></span>

  <input name="email" xh-validate="required"
         xh-validate-pattern="^[^@]+@[^@]+$">

  <input name="age" type="number"
         xh-validate="required"
         xh-validate-min="18"
         xh-validate-max="120">

  <button type="submit">Register</button>
</form>
```

**Validation attributes:**

| Attribute | Description |
|-----------|-------------|
| `xh-validate="required"` | Field must not be empty |
| `xh-validate-pattern` | Regex the value must match |
| `xh-validate-min` / `xh-validate-max` | Numeric range |
| `xh-validate-minlength` / `xh-validate-maxlength` | String length range |
| `xh-validate-message` | Custom error message |
| `xh-validate-class` | CSS class for invalid fields (default: `xh-invalid`) |
| `xh-validate-target` | CSS selector where error message is displayed |

### Plugin API

Extend xhtmlx with custom directives, hooks, and transforms.

**Custom directives:**
```javascript
xhtmlx.directive("xh-tooltip", function(el, value, ctx) {
  el.title = ctx.resolve(value);
});
```
```html
<span xh-tooltip="help_text">Hover me</span>
```

**Global hooks:**
```javascript
xhtmlx.hook("beforeRequest", function(detail) {
  detail.headers["Authorization"] = "Bearer " + getToken();
  // Return false to cancel the request
});
```

**Transforms (pipe syntax):**
```javascript
xhtmlx.transform("currency", function(value) {
  return "$" + Number(value).toFixed(2);
});
xhtmlx.transform("uppercase", function(value) {
  return String(value).toUpperCase();
});
```
```html
<span xh-text="price | currency"></span>
<span xh-text="name | uppercase"></span>
```

Pipes can be chained: `"value | trim | uppercase"`.

### UI Versioning

Hot-swap UI templates and API endpoints without a full page reload:

```javascript
// Switch all templates to load from /ui/v2/...
xhtmlx.switchVersion("v2");

// Custom prefixes
xhtmlx.switchVersion("abc123", {
  templatePrefix: "/static/abc123",
  apiPrefix: "/api/v2"
});

// Reload specific widgets
xhtmlx.reload("/templates/user-list.html");

// Reload all active widgets
xhtmlx.reload();
```

`switchVersion()` clears template and response caches, then re-renders all active widgets. Emits `xh:versionChanged`.

### i18n (Internationalization)

Translate text content and attributes with locale dictionaries:

```javascript
xhtmlx.i18n.load("en", {
  "greeting": "Hello, {name}!",
  "submit": "Submit",
  "search_placeholder": "Search..."
});
xhtmlx.i18n.load("es", {
  "greeting": "Hola, {name}!",
  "submit": "Enviar",
  "search_placeholder": "Buscar..."
});
```

```html
<h1 xh-i18n="greeting" xh-i18n-vars='{"name": "Alice"}'></h1>
<button xh-i18n="submit"></button>
<input xh-i18n-placeholder="search_placeholder">
```

Switch locale at runtime:
```javascript
xhtmlx.i18n.locale = "es"; // Re-renders all xh-i18n elements, emits xh:localeChanged
```

Programmatic translation: `xhtmlx.i18n.t("greeting", { name: "Bob" })`.

### SPA Router

Client-side routing with path parameters:

```html
<nav xh-router xh-router-outlet="#view" xh-router-404="/templates/404.html">
  <a xh-route="/" xh-template="/templates/home.html">Home</a>
  <a xh-route="/users" xh-get="/api/users" xh-template="/templates/users.html">Users</a>
  <a xh-route="/users/:id" xh-get="/api/users/{{id}}" xh-template="/templates/user.html">User</a>
</nav>
<div id="view"></div>
```

The active route link receives the `xh-route-active` CSS class. Path parameters (`:id`) are extracted and available in the data context. Handles browser back/forward via `popstate`. Navigate programmatically with `xhtmlx.router.navigate("/users/42")`. Emits `xh:routeChanged` and `xh:routeNotFound`.

### Accessibility

xhtmlx includes built-in accessibility features:

- **`aria-busy="true"`** is set on swap targets during in-flight requests and removed on completion
- **`aria-live`** is auto-applied to `xh-target` elements (defaults to `"polite"`, override with `xh-aria-live="assertive"`)
- **`role="alert"`** is set on error containers after error template rendering
- **`aria-disabled="true"`** is set during request deduplication (with `xh-disabled-class`)
- **`xh-focus`** manages focus after content swaps:

```html
<!-- Focus a specific element after swap -->
<button xh-get="/api/form" xh-target="#panel" xh-focus="#panel input:first-child">Open Form</button>

<!-- Auto-focus the first focusable element in the swapped content -->
<button xh-get="/api/data" xh-target="#content" xh-focus="auto">Load</button>
```

### Events

xhtmlx emits custom DOM events for programmatic control:

| Event | When | Cancelable |
|-------|------|------------|
| `xh:beforeRequest` | Before fetch fires | Yes |
| `xh:afterRequest` | After fetch completes | No |
| `xh:beforeSwap` | Before DOM swap | Yes |
| `xh:afterSwap` | After DOM swap | No |
| `xh:responseError` | On HTTP error response | No |
| `xh:retry` | Before each retry attempt | No |
| `xh:validationError` | When validation fails | No |
| `xh:wsOpen` | WebSocket connected | No |
| `xh:wsClose` | WebSocket disconnected | No |
| `xh:wsError` | WebSocket error | No |
| `xh:versionChanged` | After `switchVersion()` | No |
| `xh:localeChanged` | After locale switch | No |
| `xh:routeChanged` | After route navigation | No |
| `xh:routeNotFound` | No matching route | No |

```javascript
document.body.addEventListener("xh:responseError", function(e) {
  console.log(e.detail.status);
  console.log(e.detail.body);
});
```

### Data Context

Data flows through nested templates via a context chain. Child templates can access parent data:

```html
<!-- Parent: fetches user -->
<div xh-get="/api/users/1" xh-trigger="load" xh-template="/templates/user.html"></div>

<!-- /templates/user.html: can access user fields, fetches posts -->
<h1 xh-text="name"></h1>
<div xh-get="/api/users/{{id}}/posts" xh-trigger="load">
  <template>
    <!-- Each post can access its own fields AND parent user fields via $parent -->
    <div xh-each="posts">
      <p><span xh-text="title"></span> by <span xh-text="$parent.name"></span></p>
    </div>
  </template>
</div>
```

**Special variables:**
- `$index` — current iteration index (inside `xh-each`)
- `$parent` — parent data context
- `$root` — topmost data context

## Configuration

```javascript
xhtmlx.config.debug = true;                    // Enable debug logging
xhtmlx.config.defaultSwapMode = "innerHTML";   // Default swap mode
xhtmlx.config.batchThreshold = 100;            // xh-each batch threshold
xhtmlx.config.templatePrefix = "";             // Prefix for template URLs
xhtmlx.config.apiPrefix = "";                  // Prefix for API URLs
xhtmlx.config.defaultErrorTemplate = null;     // Global error template
xhtmlx.config.defaultErrorTarget = null;       // Global error target
```

## Browser Support

xhtmlx uses `fetch()`, `Promise`, `WeakMap`, and `IntersectionObserver`. Works in all modern browsers (Chrome, Firefox, Safari, Edge). No IE support.

## License

MIT
