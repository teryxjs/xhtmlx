# xhtmlx

A lightweight, zero-dependency JavaScript library for building dynamic UIs with REST APIs using declarative HTML attributes.

Like [htmx](https://htmx.org), but instead of receiving HTML from the server, xhtmlx receives **JSON** and renders UI **client-side** using templates.

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

No build step. No dependencies.

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

### Events

xhtmlx emits custom DOM events for programmatic control:

| Event | When | Cancelable |
|-------|------|------------|
| `xh:beforeRequest` | Before fetch fires | Yes |
| `xh:afterRequest` | After fetch completes | No |
| `xh:beforeSwap` | Before DOM swap | Yes |
| `xh:afterSwap` | After DOM swap | No |
| `xh:responseError` | On HTTP error response | No |

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

## Browser Support

xhtmlx uses `fetch()`, `Promise`, `WeakMap`, and `IntersectionObserver`. Works in all modern browsers (Chrome, Firefox, Safari, Edge). No IE support.

## License

MIT
