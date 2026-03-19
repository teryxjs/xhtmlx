# Performance TODO — xhtmlx vs React

## Where xhtmlx loses and what to fix

### 1. `DataContext.resolve()` is too slow for simple keys

**Affects:** every benchmark (resolve is called per binding per render)
**Current cost per `resolve("name")` call:**
```
1. pathSplitCache.get("name")        — Map lookup
2. parts[0] === "$index"             — string compare (wasted)
3. parts[0] === "$parent"            — string compare (wasted)
4. parts[0] === "$root"              — string compare (wasted)
5. parts[0] === "$viewport"          — string compare (wasted)
6. resolveDot(data, ["name"], 0)     — function call + type checks + `in` operator
```

**Fix:** Add a fast path at the top of `resolve()` — if path has no `.` and no `$` prefix, do
direct `this.data[path]` property access. Skips cache lookup, 4 special-var checks, and
`resolveDot` function call overhead.

```js
DataContext.prototype.resolve = function (path) {
    if (path == null || path === "") return undefined;
    // Fast path: simple key (no dots, no $ prefix, no pipes) — ~90% of calls
    if (path.charCodeAt(0) !== 36 /* $ */ && path.indexOf(".") === -1 && path.indexOf(" | ") === -1) {
        var v = this.data != null && typeof this.data === "object" ? this.data[path] : undefined;
        if (v !== undefined) return v;
        return this.parent ? this.parent.resolve(path) : undefined;
    }
    // ... existing general path ...
};
```

**Impact:** ~5-6x fewer operations per resolve. Helps ALL benchmarks.
**Difficulty:** Easy

**Current bench results:**
| Benchmark | xhtmlx | React | Gap |
|---|---|---|---|
| render() 10 texts changing | 15.3K | 13.0K | xhtmlx 1.2x (should widen) |
| render() 1 text changing | 117K | 75.3K | xhtmlx 1.6x (should widen) |
| render() card changing | 55.0K | 32.0K | xhtmlx 1.7x (should widen) |

---

### 2. `el.textContent = String(newVal)` — unnecessary String coercion

**Affects:** every xh-text binding (most common binding type)
**Problem:** `String(newVal)` is called even when `newVal` is already a string (the common case
for text data from JSON APIs). `String()` is a function call with type checking.

**Fix:** Use `typeof` guard in `applyBindings` and `patchBindings`:
```js
el.textContent = newVal != null ? (typeof newVal === "string" ? newVal : String(newVal)) : "";
```

**Impact:** Eliminates a function call per text binding per render.
**Difficulty:** Easy

**Current bench results (full rebuild):**
| Benchmark | xhtmlx | React | Gap |
|---|---|---|---|
| 1 text bind render+swap | 16.6K | 88.3K | 5x |
| 5 text binds render+swap | 6.1K | 117K | 19x |
| 10 text binds render+swap | 3.5K | 164K | 47x |

---

### 3. `el.textContent` sets when `firstChild.nodeValue` is faster

**Affects:** xh-text patch path, xh-text in applyBindings
**Problem:** `el.textContent = "x"` must: (1) remove all children, (2) create a Text node,
(3) append it. After the first render, the element already HAS a text node child.
`el.firstChild.nodeValue = "x"` just updates the existing text node — no removal/creation.

**Fix:** In `patchBindings` for text ops:
```js
case 0: // text
    var text = newVal != null ? (typeof newVal === "string" ? newVal : String(newVal)) : "";
    if (el.firstChild && el.firstChild.nodeType === 3) {
        el.firstChild.nodeValue = text;  // fast: update existing text node
    } else {
        el.textContent = text;           // fallback: create text node
    }
    break;
```

**Impact:** Faster DOM writes on re-render (patch path). In jsdom, `nodeValue` avoids
child-list manipulation.
**Difficulty:** Easy

**Current bench results (patched render, changing data):**
| Benchmark | xhtmlx | React | Gap |
|---|---|---|---|
| render() 10 texts changing | 15.3K | 13.0K | React 1.2x (should flip to xhtmlx) |

---

### 4. `new DataContext(data)` allocation in `renderInto()` on every call

**Affects:** `render()` API — every call allocates a new DataContext even when patching
**Problem:** `renderInto` does `ctx = new DataContext(ctx)` for plain objects on EVERY call,
including the fast patch path. This creates a new object + sets properties + sets `_root`.

**Fix:** Cache the DataContext on the patch state and reuse it, just swapping the `.data`:
```js
function renderInto(html, ctx, target) {
    var state = patchStates.get(target);
    if (state && state.html === html) {
        // Reuse cached DataContext, just update the data
        if (!(ctx instanceof DataContext)) {
            state.ctx.data = ctx;
            ctx = state.ctx;
        }
        if (patchBindings(state, ctx)) return;
    }
    // ... full render ...
}
```

**Impact:** Eliminates object allocation on the hot patch path.
**Difficulty:** Easy

**Current bench results (patched render, same data):**
| Benchmark | xhtmlx | React | Gap |
|---|---|---|---|
| render() 1 text same | 4.28M | 80.9K | xhtmlx 53x (should widen) |
| render() 5 texts same | 2.26M | 153K | xhtmlx 15x (should widen) |
| render() profile same | 909K | 32.6K | xhtmlx 28x (should widen) |

---

### 5. `cloneNode(true)` is expensive — use compiled DOM creation

**Affects:** all `renderTemplate` full-rebuild benchmarks (the biggest remaining gap)
**Problem:** `cloneNode(true)` deep-clones every DOM node in the prototype. In jsdom this is
all JavaScript — each node is a constructor call with property copies. For a template with
10 `<span>` elements, that's 11 element clones + attribute clones + child relationships.

React avoids this entirely: `createElement` produces lightweight JS objects, and the
reconciler creates real DOM nodes only on first mount. On re-render, no DOM creation at all.

**Fix:** Compile template HTML into a factory function that builds DOM directly:
```js
// Instead of: prototype.cloneNode(true) + querySelectorAll + applyBindings
// Generate:
function compiledRender(ctx) {
    var div = document.createElement('div');
    var s0 = document.createElement('span');
    s0.textContent = ctx.resolve('name') || '';
    div.appendChild(s0);
    var s1 = document.createElement('span');
    s1.textContent = ctx.resolve('email') || '';
    div.appendChild(s1);
    return div;
}
```

This eliminates: cloneNode, querySelectorAll/TreeWalker, attribute scanning in applyBindings.

**Impact:** Could close the gap from 5-47x to 2-5x for full-rebuild benchmarks.
**Difficulty:** Medium (need to handle all directive types, xh-if, interpolation)

**Current bench results (full rebuild):**
| Benchmark | xhtmlx | React | Gap |
|---|---|---|---|
| 1 text bind render+swap | 16.6K | 88.3K | 5x |
| 5 text binds render+swap | 6.1K | 117K | 19x |
| 10 text binds render+swap | 3.5K | 164K | 47x |
| user profile card | 2.0K | 10.3K | 5x |
| counter re-render | 9.4K | 53.1K | 6x |
| dashboard card update | 6.3K | 33.9K | 5x |

---

### 6. `performSwap("innerHTML")` always cleans up + clears even on first render

**Affects:** all full-rebuild benchmarks
**Problem:** `performSwap` calls `cleanupBeforeSwap(target)` which runs
`querySelectorAll(CLEANUP_SELECTOR)` on the target. On first render (empty target), this is
pure waste. Also `target.innerHTML = ""` is unnecessary when target is already empty.

**Fix:** Skip cleanup when target has no children:
```js
case "innerHTML":
    if (target.firstChild) {
        cleanupBeforeSwap(target, false);
        if (config.cspSafe) {
            while (target.firstChild) target.removeChild(target.firstChild);
        } else {
            target.innerHTML = "";
        }
    }
    target.appendChild(fragment);
    return target;
```

**Impact:** Saves a querySelectorAll + innerHTML clear on every swap into an empty target.
Moderate improvement for benchmarks that keep swapping into the same container.
**Difficulty:** Easy

**Current bench results:**
| Benchmark | xhtmlx | React | Gap |
|---|---|---|---|
| 1 text render+swap | 16.6K | 88.3K | 5x |
| img card render+swap | 6.2K | 37.5K | 6x |

---

### 7. `xh-each` uses `cloneNode(true)` per item — expensive at scale

**Affects:** all list/table benchmarks (10-1000 items)
**Problem:** For each array item, `processEach` does `el.cloneNode(true)` which deep-clones
the template element. For 50 items × 3 child elements = 150+ node clones.
React creates VDOM objects (plain JS) and only creates real DOM on first mount.

**Fix:** Same as #5 — compile the xh-each template into a factory function that builds
DOM nodes directly via `createElement` + `appendChild`. No cloning needed.

```js
// Instead of per-item: el.cloneNode(true) + applyBindings + processEachCloneChildren
// Generate:
function compiledItem(ctx) {
    var li = document.createElement('li');
    // apply xh-class-done, xh-class-priority from compiled bindings
    var s0 = document.createElement('span');
    s0.textContent = ctx.resolve('text') || '';
    li.appendChild(s0);
    // xh-if="done" for check mark
    if (ctx.resolve('done')) {
        var s1 = document.createElement('span');
        s1.className = 'check';
        s1.textContent = '✓';
        li.appendChild(s1);
    }
    return li;
}
```

**Impact:** Eliminates cloneNode per item. 50-item list goes from 150 clones to 150
createElement calls (much cheaper in jsdom).
**Difficulty:** Medium

**Current bench results:**
| Benchmark | xhtmlx | React | Gap |
|---|---|---|---|
| list 10 items | 1.1K | 6.5K | 6x |
| list 50 items | 442 | 2.4K | 5x |
| list 100 items | 266 | 1.3K | 5x |
| todo list 30 | 421 | 3.5K | 8x |
| nav menu 8 | 2.2K | 18.7K | 9x |
| table 20×4 | 303 | 2.9K | 10x |
| table 100×4 | 88 | 606 | 7x |
| list 50 update | 446 | 2.1K | 5x |

---

### 8. `executeRequest` uses full rebuild — should use `render()` patching

**Affects:** real-world polling/refresh scenarios (not directly in benchmarks but huge for users)
**Problem:** The internal `executeRequest` → `processJsonData` path always does
`renderTemplate` + `performSwap`, rebuilding the entire DOM on every API response.
For polling endpoints that return similar data, this is wasteful.

**Fix:** Use `renderInto` (the patching render) inside `processJsonData` when swap mode is
`innerHTML` and template hasn't changed:
```js
// In processJsonData, instead of:
var fragment = renderTemplate(tmpl.html, childCtx);
performSwap(target, fragment, swapMode);

// Use:
if (swapMode === "innerHTML") {
    renderInto(tmpl.html, childCtx, target);
} else {
    var fragment = renderTemplate(tmpl.html, childCtx);
    performSwap(target, fragment, swapMode);
}
```

**Impact:** Polling/refresh goes from full DOM rebuild to in-place patching.
**Difficulty:** Easy (but needs careful testing with events/settle classes)

---

### 9. `interpolateDOM` walks ALL text nodes even when few have tokens

**Affects:** templates with `{{}}` interpolation (e.g. `data-id="{{id}}"`)
**Problem:** `interpolateDOM` uses TreeWalker to visit EVERY text node, checking each for `{{`.
For a template with 10 elements and 1 text node with `{{`, it visits all 10+ text nodes.

**Fix:** During prototype compilation, record which text node positions have `{{` tokens.
At render time, navigate directly to those nodes instead of walking all.

**Impact:** Reduces interpolation cost from O(all_text_nodes) to O(token_text_nodes).
**Difficulty:** Medium (need position tracking that survives cloneNode)

**Current bench results:**
| Benchmark | xhtmlx | React | Gap |
|---|---|---|---|
| xh-if true (has interp) | 4.5K | 50.3K | 11x |

---

## Priority order

| # | Fix | Difficulty | Impact | Benchmarks helped |
|---|---|---|---|---|
| 1 | Fast-path `resolve()` for simple keys | Easy | High | ALL |
| 2 | `String()` coercion guard | Easy | Low-Med | All text bindings |
| 3 | `firstChild.nodeValue` for text patches | Easy | Medium | render() changing data |
| 4 | Reuse DataContext in `renderInto` | Easy | Medium | render() all |
| 6 | Skip cleanup on empty target | Easy | Low-Med | All full-rebuild |
| 8 | Use `renderInto` in `executeRequest` | Easy | High (UX) | Real-world polling |
| 5 | Compiled DOM creation (renderTemplate) | Medium | Very High | All full-rebuild |
| 7 | Compiled DOM creation (xh-each) | Medium | Very High | All list/table |
| 9 | Pre-indexed interpolation nodes | Medium | Medium | Interpolation templates |
