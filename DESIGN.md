# xhtmlx — Design Document

## Overview

xhtmlx is a lightweight, zero-dependency JavaScript library that brings htmx-style declarative HTML attributes to REST API driven applications. Instead of the server returning HTML fragments (like htmx), the server returns JSON and xhtmlx renders UI client-side using templates.

## Core Concept

```
htmx:    trigger → request → receive HTML    → swap into DOM
xhtmlx:  trigger → request → receive JSON    → render template with data → swap into DOM
```

Users declare behavior entirely in HTML attributes with the `xh-` prefix. No JavaScript required for common patterns.

## Architecture

### IIFE Module

The library is a single `xhtmlx.js` file wrapped in an IIFE. It exposes `window.xhtmlx` for programmatic access and auto-initializes on `DOMContentLoaded`.

```javascript
(function() {
  "use strict";
  // ... library internals ...
  window.xhtmlx = { config, process, ... };
  document.addEventListener("DOMContentLoaded", function() {
    processNode(document.body, new DataContext({}));
  });
})();
```

### Core Processing Loop

```
processNode(element, parentDataContext):
  1. Find all descendants with xh-* attributes
  2. For each element with a REST verb (xh-get, xh-post, etc.):
     a. Parse trigger spec from xh-trigger (or use default)
     b. Attach event handler:
        i.   Show indicator
        ii.  Interpolate URL: resolve {{field}} from current dataContext
        iii. Issue fetch() request
        iv.  On success:
             - Create childContext = new DataContext(jsonData, parentDataContext)
             - Resolve template (external file or inline <template>)
             - Render template with childContext
             - Swap rendered content into target
             - processNode(target, childContext)  ← RECURSIVE
             - Hide indicator
        v.   On error:
             - Resolve error template (status-specific or generic)
             - Create error context with status, statusText, body
             - Render and swap error template
             - Emit xh:responseError event
  3. For elements with only binding attributes (xh-text, etc.):
     apply bindings immediately using parentDataContext
```

### Data Context

Every template rendering happens within a `DataContext` that carries the current data and a reference to its parent context.

```
DataContext {
  data: Object        — The JSON data for this level
  parent: DataContext  — Reference to enclosing context (null at root)
  index: Number|null   — Current iteration index (for xh-each)
}
```

**Resolution rules for `{{field}}`:**
1. Look up `field` in `this.data` (supports dot notation: `user.name`)
2. If not found, walk up `this.parent` chain
3. Special variables: `$index` (iteration index), `$root` (topmost context), `$parent` (explicit parent access)

### Template System

Templates are HTML containing xhtmlx attributes and `{{field}}` interpolation markers.

**Sources (in priority order):**
1. External file: `xh-template="/templates/user-card.html"` — fetched via `fetch()` and cached
2. Inline: `<template>` child element
3. Self: the element itself (for simple xh-text / xh-attr-* bindings)

**Template processing pipeline:**
1. Get template HTML string (from cache, fetch, or inline)
2. Interpolate `{{field}}` expressions against the DataContext
3. Parse into DocumentFragment
4. Process directives: xh-if, xh-unless, xh-each, xh-text, xh-html, xh-attr-*
5. Swap into DOM
6. Recursively call processNode() on new content

**Template caching:**
- External templates are fetched once and cached by URL
- Multiple concurrent requests for the same template share a single in-flight Promise

**Recursive templates:**
Templates can contain xhtmlx attributes, including `xh-get` with `xh-template`, enabling nested API calls and template composition.

### Error Handling

Error responses are treated as data — the same template engine renders error UI.

**Error template resolution order:**
1. `xh-error-template-{exact code}` — e.g. `xh-error-template-404`
2. `xh-error-template-{class}` — e.g. `xh-error-template-4xx` for any 400-499
3. `xh-error-template` — generic fallback
4. No template → add `xh-error` CSS class, emit `xh:responseError` event

**Error data context:**
```json
{
  "status": 422,
  "statusText": "Unprocessable Entity",
  "body": { "error": "validation_failed", "fields": [...] }
}
```

**Error target:**
`xh-error-target` specifies where to swap error content (defaults to `xh-target` or self).

### Event System

The library emits custom DOM events at lifecycle points:
- `xh:beforeRequest` — before fetch, cancelable
- `xh:afterRequest` — after fetch completes (success or error)
- `xh:beforeSwap` — before DOM swap, cancelable
- `xh:afterSwap` — after DOM swap and recursive processing
- `xh:responseError` — on HTTP error responses

### Trigger System

Triggers are parsed from the `xh-trigger` attribute.

**Supported triggers:**
- Standard DOM events: `click`, `submit`, `change`, `keyup`, `mouseenter`, etc.
- `load` — fires immediately when element is processed
- `every Ns` — fires on interval (e.g. `every 5s`)
- `revealed` — fires when element enters viewport (IntersectionObserver)

**Modifiers:**
- `once` — fire only once
- `changed` — only fire if value changed
- `delay:Nms` — debounce
- `throttle:Nms` — throttle
- `from:selector` — listen on a different element

**Defaults:**
- `click` for buttons, links, and general elements
- `submit` for forms
- `change` for inputs, selects, textareas

### Swap Modes

The `xh-swap` attribute controls how rendered content is inserted:

| Mode | Behavior |
|------|----------|
| `innerHTML` | Replace target's children (default) |
| `outerHTML` | Replace target itself |
| `beforeend` | Append inside target |
| `afterbegin` | Prepend inside target |
| `beforebegin` | Insert before target |
| `afterend` | Insert after target |
| `delete` | Remove target |
| `none` | Don't swap (useful for fire-and-forget requests) |

### URL Interpolation

`{{field}}` syntax in URLs is resolved from the current DataContext:
- Regex: `/\{\{([^}]+)\}\}/g`
- Supports dot notation: `{{user.address.city}}`
- Values are URI-encoded in URLs
- Unresolved fields render as empty string (console.warn in debug mode)

### Request Body Handling

For POST/PUT/PATCH:
- Form elements: automatically serialize form fields
- `xh-vals` attribute: JSON string of additional values (e.g. `xh-vals='{"type": "admin"}'`)
- `xh-headers` attribute: JSON string of custom headers
- Content-Type defaults to `application/json`

### Indicators

`xh-indicator` specifies an element to show during requests:
- CSS selector value: `xh-indicator="#spinner"`
- The library adds/removes `xh-request` CSS class on the indicator element
- Default CSS injected by the library:

```css
.xh-indicator { opacity: 0; transition: opacity 200ms ease-in; }
.xh-request .xh-indicator, .xh-request.xh-indicator { opacity: 1; }
```

## Internal Data Structures

**Element state (WeakMap):**
```javascript
{
  dataContext: DataContext,
  triggerSpecs: [],
  intervalIds: [],
  processed: true,
  requestInFlight: false
}
```

**Trigger spec:**
```javascript
{
  event: "click",
  delay: 0,
  throttle: 0,
  once: false,
  changed: false,
  from: null,
  consume: false,
  queue: "last"
}
```

## Safety Considerations

| Concern | Mitigation |
|---------|------------|
| XSS via xh-html | `xh-text` uses textContent (safe). `xh-html` is opt-in and explicitly named to signal raw HTML. |
| Circular template references | Track template resolution stack per chain; error if cycle detected |
| Memory leaks from intervals | Clear intervals before swapping out elements |
| Race conditions | Generation counter per element; discard stale responses |
| Large arrays in xh-each | Batch rendering via requestAnimationFrame for arrays > 100 items |

## File Structure

```
xhtmlx/
  xhtmlx.js                    — The library (single file, ~800-1200 lines)
  DESIGN.md                    — This document
  README.md                    — User-facing documentation
  examples/
    basic-get.html             — Simple GET + data binding
    crud-app.html              — Full CRUD with POST/PUT/DELETE
    nested-templates.html      — Nested API calls, parent data access
    iteration.html             — xh-each with lists
    conditionals.html          — xh-if / xh-unless
    triggers.html              — Various trigger types
    indicators.html            — Loading indicators
    templates/
      user-card.html           — External template
      user-list.html           — Template with xh-each
      error.html               — Generic error template
      validation-error.html    — Field-level error template
```
