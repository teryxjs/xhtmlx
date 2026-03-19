# Performance TODO

Benchmark comparison (ops/s) — areas where xhtmlx is significantly slower than React.
Last updated: 2026-03-19, branch `perf/render-pipeline-round5`

## Current Benchmark Results

### Where xhtmlx loses (full render+swap pipeline)

| Scenario | xhtmlx | React | React faster |
|---|---|---|---|
| 10 text binds render+swap | 7.4K | 140.9K | **19x** |
| 5 text binds render+swap | 9.6K | 144.1K | **15x** |
| 5 data-attrs | 13.5K | 93.0K | **6.9x** |
| table 20x4 | 526 | 2.9K | **5.5x** |
| user profile card | 3.7K | 20.1K | **5.4x** |
| table 100x4 | 110 | 594 | **5.4x** |
| 4 class toggles | 21.9K | 105.4K | **4.8x** |
| xh-if true | 10.3K | 48.8K | **4.7x** |
| img card (attrs+class) | 7.5K | 32.6K | **4.3x** |
| xh-if false | 21.7K | 89.6K | **4.1x** |
| todo list 30 | 844 | 3.4K | **4x** |
| 5-field update | 8.9K | 33.6K | **3.8x** |
| list 100 | 392 | 1.3K | **3.3x** |
| dashboard card update | 10.3K | 32.7K | **3.2x** |
| 1 text bind render+swap | 28.8K | 91.9K | **3.2x** |
| list 10 | 2.9K | 9.0K | **3.1x** |
| nav menu 8 | 6.5K | 17.2K | **2.6x** |
| list 50 | 855 | 2.0K | **2.3x** |
| list 50 update | 746 | 1.6K | **2.1x** |
| counter update | 16.4K | 25.5K | 1.6x |
| xh-if toggle | 24.8K | 25.1K | ~1x |

### Where xhtmlx wins

| Scenario | xhtmlx | React | xhtmlx faster |
|---|---|---|---|
| render() 1 text same | 17.63M | 53.5K | **330x** |
| render() card same | 36.98M | 42.6K | **868x** |
| render() profile same | 12.88M | 32.6K | **395x** |
| render() cond same | 24.01M | 69.4K | **346x** |
| render() card changing | 6.67M | 22.3K | **299x** |
| render() 10 text changing | 1.64M | 12.2K | **134x** |
| list 500 items | 459 | 230 | **2x** |
| list 1000 items | 430 | 113 | **3.8x** |

---

## Remaining bottleneck

The gap is primarily architectural: React builds virtual trees (cheap JS objects)
and diffs/patches existing DOM, while xhtmlx rebuilds real DOM from scratch on
every `renderTemplate` call. The `render()` patched path (xhtmlx's reconciler)
is 100-800x faster than React, confirming the architecture is sound.

---

## Actionable optimizations (simple changes only)

### 1. Pre-compute binding type codes in render plan
**Where:** `_compilePlanChildren` (line ~1835), `_applyPlanBindings` (line ~1875)
**Impact:** High — eliminates string comparison per binding per render.

Currently the plan stores raw `xh` arrays like `['xh-text', 'name', 'xh-attr-src', 'url']`
and `_applyPlanBindings` does `switch(name)` + `name.indexOf("xh-attr-")` on every
render. Store numeric type codes and pre-sliced target names during compilation:

```js
// Plan compilation stores:
xh: [1 /* TEXT */, 'name', 5 /* ATTR */, 'src', 'url', 6 /* CLASS */, 'active', 'isActive']
// Render-time: switch on number, no string matching or slicing
```

### 2. Skip child creation when xh-text is present in plan
**Where:** `_execPlanNode` (line ~2003)
**Impact:** Medium — currently creates children, then xh-text overwrites them via
`el.textContent = val` (which destroys those children). For `<span xh-text="name">placeholder</span>`,
the plan creates a "placeholder" text node then immediately discards it.

```js
// Before: always create children, then apply bindings (which may overwrite)
// After: if xh contains xh-text or xh-html, skip child creation
```

### 3. Use `textContent = ''` instead of `innerHTML = ""` in performSwap
**Where:** `performSwap` (line ~1670)
**Impact:** Medium — `textContent = ''` avoids invoking the HTML parser when
clearing the container.

### 4. Batch classList.add in `_applyPlanBindings`
**Where:** `_applyPlanBindings` (line ~1907)
**Impact:** Medium — currently adds classes one-by-one with `el.classList.add(name.slice(9))`.
The regular `applyBindings` already batches them. Do the same in the plan path.

### 5. Avoid `instanceof MutableDataContext` per element in plan execution
**Where:** `_execPlanNode` (line ~1981), `execElementPlan` (line ~2048)
**Impact:** Low-Medium — checked per element. Check once in `executePlan` and
pass a boolean down.

### 6. Shared constant for `{ processed: true }` in elementStates
**Where:** lines ~946, 968, 1217, 2036, 1952
**Impact:** Low-Medium — currently allocates a new `{ processed: true }` object
per xh-each item. Use a shared frozen constant.

```js
var PROCESSED_STATE = Object.freeze({ processed: true });
elementStates.set(built, PROCESSED_STATE);
```

### 7. Replace `data-xh-each-item` setAttribute with WeakSet
**Where:** `processEach` (line ~944), `renderTemplate` (line ~2226)
**Impact:** Low-Medium — saves one `setAttribute` DOM call per xh-each item.
The attribute is only used for `closest("[data-xh-each-item]")` checks in the
general rendering path. A WeakSet lookup is cheaper.

### 8. Avoid re-creating `renderItem` closure in processEach
**Where:** `processEach` (line ~937)
**Impact:** Low — the function literal is allocated on every `processEach` call.
Restructure to avoid closure in the hot loop.

---

## Not worth doing (would over-complicate)

- Full reconciler/diffing in renderTemplate — that's what `render()` already does
- DOM node pooling/recycling — complex lifecycle management
- Web Worker offloading — template rendering needs DOM APIs
- Virtual DOM layer — contradicts xhtmlx's server-response philosophy
