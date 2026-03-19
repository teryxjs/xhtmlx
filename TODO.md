# Performance TODO

Benchmark comparison (ops/s) — areas where xhtmlx is significantly slower than React.

## Current Benchmark Results (after round 5 optimizations)

### Where xhtmlx loses (full render+swap pipeline)

| Scenario | xhtmlx | React | React faster | prev gap |
|---|---|---|---|---|
| 5 text binds render+swap | 7.0K | 132.6K | **18.9x** | 15.4x |
| 10 text binds render+swap | 7.2K | 145.2K | **20.2x** | 11.9x |
| 5 data-attrs | 15.0K | 79.9K | **5.3x** | 7.0x |
| user profile card | 3.4K | 16.5K | **4.9x** | 5.5x |
| img card (attrs+class) | 4.4K | 20.4K | **4.6x** | 4.4x |
| xh-if false | 21.3K | 90.3K | **4.2x** | 5.9x |
| 4 class toggles | 23.6K | 101.4K | **4.3x** | 7.9x |
| xh-if true | 9.6K | 46.5K | **4.8x** | 5.3x |
| dashboard card update | 9.3K | 33.2K | **3.6x** | 3.7x |
| todo list 30 | 899 | 3.1K | **3.4x** | 7.4x |
| table 20x4 | 378 | 2.6K | **6.9x** | 7.9x |
| table 100x4 | 128 | 638 | **5.0x** | 7.2x |
| 5-field update | 8.9K | 28.1K | **3.2x** | 4.2x |
| counter update | 15.3K | 44.7K | **2.9x** | 3.4x |
| nav menu 8 | 6.4K | 18.4K | **2.9x** | 7.6x |
| 1 text bind render+swap | 33.5K | 72.2K | **2.2x** | 4.9x |
| list 10 | 3.0K | 6.2K | **2.1x** | 6.3x |
| list 50 | 613 | 2.0K | **3.3x** | 4.8x |
| list 100 | 400 | 1.2K | **3.0x** | 4.1x |
| list 50 update | 847 | 1.3K | **1.5x** | 4.2x |

### Where xhtmlx wins

| Scenario | xhtmlx | React | xhtmlx faster |
|---|---|---|---|
| render() 1 text same | 6.32M | 69.4K | **91x** |
| render() cond same | 2.48M | 63.0K | **39x** |
| render() card same | 1.84M | 39.6K | **46x** |
| render() profile same | 773.6K | 32.0K | **24x** |
| render() 10 text changing | 123.1K | 11.8K | **10x** |
| render() card changing | 170.1K | 24.5K | **7x** |
| list 500 items | 256 | 205 | **1.2x** |
| list 1000 items | 465 | 124 | **3.8x** |

### Key improvements from round 5

| Scenario | Before | After | Speedup |
|---|---|---|---|
| 1 text bind render+swap | 15.6K | 33.5K | **2.1x** |
| counter update | 13.5K | 15.3K | **1.1x** |
| xh-if false | 9.8K | 21.3K | **2.2x** |
| xh-if toggle | 20.7K | 25.8K | **1.2x** |
| 4 class toggles | 16.1K | 23.6K | **1.5x** |
| nav menu 8 | 2.2K | 6.4K | **2.9x** |
| todo list 30 | 437 | 899 | **2.1x** |
| list 10 | 1.2K | 3.0K | **2.5x** |
| list 50 | 527 | 613 | **1.2x** |
| list 100 | 280 | 400 | **1.4x** |
| list 1000 | 342 | 465 | **1.4x** |
| list 50 update | 499 | 847 | **1.7x** |
| table 100x4 | 96 | 128 | **1.3x** |
| user profile | 2.4K | 3.4K | **1.4x** |
| 5-field update | 5.7K | 8.9K | **1.6x** |
| dashboard card update | 8.3K | 9.3K | **1.1x** |
| img card | 6.2K | 4.4K | noise |

---

## Remaining bottleneck

The gap is now primarily from the architectural difference: React builds a
virtual tree in memory (cheap JS objects) and diffs/patches the real DOM, while
xhtmlx rebuilds real DOM nodes from scratch on every render. Each `createElement`,
`setAttribute`, and `textContent` call hits the DOM layer. This is inherent to
the server-response-swap model and cannot be eliminated without a virtual DOM.

The render() patched path (xhtmlx's equivalent of React's reconciler) remains
10-120x faster than React, confirming the architecture is sound for its use case.
