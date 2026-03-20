/**
 * xhtmlx.js — Declarative HTML attributes for REST API driven UIs.
 *
 * Like htmx, but the server returns JSON and xhtmlx renders UI client-side
 * using templates.
 *
 * Zero dependencies. Single file. IIFE pattern.
 *
 * trigger → request → receive JSON → render template with data → swap into DOM
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------
  var config = {
    debug: false,
    defaultSwapMode: "innerHTML",
    indicatorClass: "xh-indicator",
    requestClass: "xh-request",
    errorClass: "xh-error",
    batchThreshold: 100, // xh-each arrays above this size use rAF batching
    defaultErrorTemplate: null, // Global fallback error template URL
    defaultErrorTarget: null,   // Global fallback error target CSS selector
    templatePrefix: "",         // Prefix prepended to all xh-template URLs
    apiPrefix: "",              // Prefix prepended to all REST verb URLs
    uiVersion: null,            // Current UI version identifier (any string)
    cspSafe: false,             // When true, avoid innerHTML for CSP compliance
    breakpoints: { mobile: 768, tablet: 1024 },  // Responsive breakpoint thresholds
    trackRequests: false   // When true, auto-track REST requests via analytics handlers
  };

  // ---------------------------------------------------------------------------
  // Responsive breakpoint helpers
  // ---------------------------------------------------------------------------

  /**
   * Determine the current breakpoint name based on window width and config.
   * @returns {string} "mobile", "tablet", or "desktop"
   */
  function getCurrentBreakpoint() {
    if (typeof window === "undefined") return "desktop";
    var w = window.innerWidth;
    if (w < config.breakpoints.mobile) return "mobile";
    if (w < config.breakpoints.tablet) return "tablet";
    return "desktop";
  }

  /**
   * Build a viewport context object with current breakpoint and dimensions.
   * Cached and invalidated on resize (or when dimensions change) to avoid
   * allocating a new object per $viewport access during a synchronous pass.
   * @returns {Object}
   */
  var _vpCache = null;
  var _vpCacheW = -1;
  var _vpCacheH = -1;
  function getViewportContext() {
    var w = typeof window !== "undefined" ? window.innerWidth : 0;
    var h = typeof window !== "undefined" ? window.innerHeight : 0;
    if (_vpCache && w === _vpCacheW && h === _vpCacheH) return _vpCache;
    var bp = getCurrentBreakpoint();
    _vpCacheW = w;
    _vpCacheH = h;
    _vpCache = {
      width: w,
      height: h,
      breakpoint: bp,
      mobile: bp === "mobile",
      tablet: bp === "tablet",
      desktop: bp === "desktop"
    };
    return _vpCache;
  }

  // ---------------------------------------------------------------------------
  // Internal state
  // ---------------------------------------------------------------------------

  /** WeakMap<Element, ElementState> — per-element bookkeeping */
  var elementStates = new WeakMap();

  /** Map<string, Promise<string>> — external template cache (URL → HTML) */
  var templateCache = new Map();

  /** Set<string> — currently resolving template URLs (circular detection) */
  // (per-chain stacks are passed as arrays instead of a global set)

  /** Generation counter per element for discarding stale responses */
  var generationMap = new WeakMap();

  /** Map<string, {data: *, timestamp: number}> — response cache (verb:url → parsed JSON) */
  var responseCache = new Map();
  var RESPONSE_CACHE_MAX = 200;

  /** Cache for path.split(".") results in DataContext.resolve (bounded) */
  var pathSplitCache = new Map();
  var PATH_SPLIT_CACHE_MAX = 1000;

  /** Cache for parsed template DOM fragments — avoids HTML re-parsing on repeat renders.
   *  Key: HTML string, Value: { prototype: Element, selector: string, hasInterp: boolean,
   *                              hasEach: boolean, hasRest: boolean } */
  var renderFragmentCache = new Map();
  var RENDER_FRAGMENT_CACHE_MAX = 100;

  /** WeakMap<Element, PatchState> — binding state for DOM patching via render() */
  var patchStates = new WeakMap();

  /** Shared frozen state for marking elements as processed (avoids per-element allocation) */
  var PROCESSED_STATE = Object.freeze({ processed: true });

  /** WeakSet tracking xh-each rendered items (replaces data-xh-each-item attribute) */
  var eachItemSet = new WeakSet();

  /** Binding type codes for compiled render plans */
  var XH_IF = 0, XH_UNLESS = 1, XH_TEXT = 2, XH_HTML = 3,
      XH_SHOW = 4, XH_HIDE = 5, XH_ATTR = 6, XH_CLASS = 7,
      XH_ON = 8, XH_TRACK = 9, XH_TRACK_VIEW = 10, XH_UNKNOWN = 11;

  // ---------------------------------------------------------------------------
  // Default CSS injection
  // ---------------------------------------------------------------------------
  function injectDefaultCSS() {
    var id = "xhtmlx-default-css";
    if (document.getElementById(id)) return;

    var cssText =
      ".xh-indicator { opacity: 0; transition: opacity 200ms ease-in; }\n" +
      ".xh-request .xh-indicator, .xh-request.xh-indicator { opacity: 1; }\n" +
      ".xh-added { }\n" +
      ".xh-settled { }\n" +
      ".xh-invalid { border-color: #ef4444; }\n";

    if (config.cspSafe && document.adoptedStyleSheets !== undefined) {
      var sheet = new CSSStyleSheet();
      sheet.replaceSync(cssText);
      document.adoptedStyleSheets = [].concat(
        Array.prototype.slice.call(document.adoptedStyleSheets),
        [sheet]
      );
      return;
    }

    var style = document.createElement("style");
    style.id = id;
    style.textContent = cssText;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // DataContext
  // ---------------------------------------------------------------------------

  /**
   * Holds the JSON data for the current rendering scope and a reference to its
   * parent context so that templates can walk up the chain.
   *
   * @param {*}           data   – The JSON payload for this level.
   * @param {DataContext}  parent – Enclosing context (null at root).
   * @param {number|null}  index  – Current iteration index for xh-each.
   */
  function DataContext(data, parent, index) {
    this.data = data != null ? data : {};
    this.parent = parent || null;
    this.index = index != null ? index : null;
    this._root = parent ? (parent._root || parent) : this;
  }

  /**
   * Resolve a dotted path against this context.
   *
   * Special variables:
   *   $index  – iteration index
   *   $parent – jump to parent context, continue resolving remainder
   *   $root   – jump to root context, continue resolving remainder
   *
   * If the key is not found locally, we walk up the parent chain.
   *
   * @param {string} path – e.g. "user.name", "$parent.title", "$index"
   * @returns {*} resolved value or undefined
   */
  DataContext.prototype.resolve = function (path) {
    if (path == null || path === "") return undefined;

    // Fast path: simple key (no dots, no $ prefix, no pipes) — ~90% of calls
    if (path.charCodeAt(0) !== 36 /* $ */ && path.indexOf(".") === -1 && path.indexOf(" | ") === -1) {
      var v = this.data != null && typeof this.data === "object" ? this.data[path] : undefined;
      if (v !== undefined) return v;
      return this.parent ? this.parent.resolve(path) : undefined;
    }

    var parts = pathSplitCache.get(path);
    if (!parts) {
      // -- transform pipe support: "price | currency" --------------------------
      // Check for pipes only on cache miss (pipe paths won't be dot-split cached)
      if (path.indexOf(" | ") !== -1) {
        var pipeParts = path.split(" | ");
        var rawValue = this.resolve(pipeParts[0].trim());
        for (var p = 1; p < pipeParts.length; p++) {
          var transformName = pipeParts[p].trim();
          if (transforms[transformName]) {
            rawValue = transforms[transformName](rawValue);
          }
        }
        return rawValue;
      }
      if (pathSplitCache.size >= PATH_SPLIT_CACHE_MAX) {
        // Swap to a new Map — O(1) instead of O(n/2) iterator eviction.
        // The old Map is GC'd; the cache rebuilds quickly from hot paths.
        pathSplitCache = new Map();
      }
      parts = path.split(".");
      pathSplitCache.set(path, parts);
    }

    // --- special variables ---------------------------------------------------
    if (parts[0] === "$index") {
      if (parts.length === 1) return this.index;
      // $index doesn't have sub-properties
      return undefined;
    }

    if (parts[0] === "$parent") {
      if (!this.parent) return undefined;
      if (parts.length === 1) return this.parent.data;
      return this.parent._resolveFromParts(parts, 1);
    }

    if (parts[0] === "$root") {
      var root = this._root;
      if (parts.length === 1) return root.data;
      return root._resolveFromParts(parts, 1);
    }

    if (parts[0] === "$viewport") {
      var vp = getViewportContext();
      if (parts.length === 1) return vp;
      return resolveDot(vp, parts, 1);
    }

    // --- local lookup --------------------------------------------------------
    var value = resolveDot(this.data, parts);
    if (value !== undefined) return value;

    // --- walk parent chain ---------------------------------------------------
    if (this.parent) return this.parent.resolve(path);

    return undefined;
  };

  /**
   * Resolve using pre-split parts starting from a given index.
   * Avoids intermediate array/string allocation from slice()+join().
   *
   * @param {string[]} parts    – The full parts array.
   * @param {number}   startIdx – Index to start resolving from.
   * @returns {*}
   */
  DataContext.prototype._resolveFromParts = function (parts, startIdx) {
    if (startIdx < parts.length && parts[startIdx] === "$parent") {
      if (!this.parent) return undefined;
      if (startIdx === parts.length - 1) return this.parent.data;
      return this.parent._resolveFromParts(parts, startIdx + 1);
    }

    if (startIdx < parts.length && parts[startIdx] === "$root") {
      var root = this._root;
      if (startIdx === parts.length - 1) return root.data;
      return root._resolveFromParts(parts, startIdx + 1);
    }

    if (startIdx < parts.length && parts[startIdx] === "$index") {
      return this.index;
    }

    if (startIdx < parts.length && parts[startIdx] === "$viewport") {
      var vp = getViewportContext();
      if (startIdx === parts.length - 1) return vp;
      return resolveDot(vp, parts, startIdx + 1);
    }

    var value = resolveDot(this.data, parts, startIdx);
    if (value !== undefined) return value;

    if (this.parent) return this.parent._resolveFromParts(parts, startIdx);

    return undefined;
  };

  /**
   * Resolve a dotted path against a plain object.
   * @param {Object}   obj
   * @param {string[]} parts
   * @param {number}   [startIdx=0] – Index to start resolving from.
   * @returns {*}
   */
  function resolveDot(obj, parts, startIdx) {
    var start = startIdx || 0;
    // Fast path for single-key lookups (most common case)
    if (parts.length - start === 1) {
      return obj != null && typeof obj === "object" && parts[start] in obj ? obj[parts[start]] : undefined;
    }
    var cur = obj;
    for (var i = start; i < parts.length; i++) {
      if (cur == null || typeof cur !== "object") return undefined;
      if (!(parts[i] in cur)) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  // ---------------------------------------------------------------------------
  // MutableDataContext — reactive wrapper around DataContext
  // ---------------------------------------------------------------------------

  /**
   * A DataContext subclass that supports live reactivity.
   * When a field is changed via set(), all subscribers for that path are notified.
   *
   * @param {*}           data   – The JSON payload for this level.
   * @param {DataContext}  parent – Enclosing context (null at root).
   * @param {number|null}  index  – Current iteration index for xh-each.
   */
  function MutableDataContext(data, parent, index) {
    DataContext.call(this, data, parent, index);
    this._subscribers = {}; // path -> [callback]
  }
  MutableDataContext.prototype = Object.create(DataContext.prototype);
  MutableDataContext.prototype.constructor = MutableDataContext;

  /**
   * Set a value at the given dotted path, creating intermediate objects as needed.
   * Notifies all subscribers for the given path.
   *
   * @param {string} path  – e.g. "user.name"
   * @param {*}      value – The new value.
   */
  MutableDataContext.prototype.set = function(path, value) {
    var parts = pathSplitCache.get(path);
    if (!parts) {
      parts = path.split(".");
      pathSplitCache.set(path, parts);
    }
    var obj = this.data;
    for (var i = 0; i < parts.length - 1; i++) {
      if (obj[parts[i]] == null) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
    this._notify(path);
  };

  /**
   * Subscribe to changes on a given path.
   *
   * @param {string}   path     – The dotted path to watch.
   * @param {Function} callback – Called when the value at path changes.
   */
  MutableDataContext.prototype.subscribe = function(path, callback) {
    if (!this._subscribers[path]) this._subscribers[path] = [];
    this._subscribers[path].push(callback);
    var self = this;
    return function unsubscribe() {
      var subs = self._subscribers[path];
      if (subs) {
        var idx = subs.indexOf(callback);
        if (idx !== -1) subs.splice(idx, 1);
      }
    };
  };

  /**
   * Notify all subscribers for a given path.
   * @param {string} path
   */
  MutableDataContext.prototype._notify = function(path) {
    var subs = this._subscribers[path];
    if (!subs) return;
    // Execute callbacks and prune any that throw (detached element references).
    // In-place compaction avoids allocating a new array on every notification.
    var write = 0;
    for (var i = 0; i < subs.length; i++) {
      try { subs[i](); subs[write++] = subs[i]; }
      catch (e) { /* subscriber references a detached element — drop it */ }
    }
    subs.length = write;
  };

  // ---------------------------------------------------------------------------
  // Interpolation  — {{field}} replacement
  // ---------------------------------------------------------------------------

  var INTERP_RE = /\{\{([^}]+)\}\}/g;

  /**
   * Replace all {{field}} tokens in a string using the given DataContext.
   *
   * @param {string}      str     – Source string.
   * @param {DataContext}  ctx     – Data context for resolution.
   * @param {boolean}      uriEnc – If true, URI-encode each substituted value.
   * @returns {string}
   */
  function interpolate(str, ctx, uriEnc) {
    var start = str.indexOf("{{");
    if (start === -1) return str;

    var end = str.indexOf("}}", start);
    if (end === -1) return str;

    // Single-token fast path — avoids regex engine + callback allocation
    if (str.indexOf("{{", end + 2) === -1) {
      var path = str.substring(start + 2, end).trim();
      var val = ctx.resolve(path);
      var replacement;
      if (val === undefined) {
        if (config.debug) {
          console.warn("[xhtmlx] unresolved interpolation: {{" + path + "}}");
        }
        replacement = "";
      } else {
        replacement = String(val);
        if (uriEnc) replacement = encodeURIComponent(replacement);
      }
      return str.substring(0, start) + replacement + str.substring(end + 2);
    }

    // Multi-token: use regex
    return str.replace(INTERP_RE, function (_match, path) {
      var val = ctx.resolve(path.trim());
      if (val === undefined) {
        if (config.debug) {
          console.warn("[xhtmlx] unresolved interpolation: {{" + path + "}}");
        }
        return "";
      }
      var s = String(val);
      return uriEnc ? encodeURIComponent(s) : s;
    });
  }

  /**
   * Walk a DOM tree and interpolate {{field}} tokens in text nodes and
   * non-xh-* attributes. Leaves xh-* attribute values untouched so they
   * can be processed later with the correct data context (e.g. per-item
   * context inside xh-each).
   *
   * @param {Element}     root
   * @param {DataContext}  ctx
   */
  function interpolateDOM(root, ctx) {
    var walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    while (walker.nextNode()) {
      var node = walker.currentNode;
      var original = node.nodeValue;
      if (original.indexOf("{{") === -1) continue;
      // Store the original template for DOM patching support
      node._xhTpl = original;
      var replaced = interpolate(original, ctx, false);
      if (replaced !== original) node.nodeValue = replaced;
    }

    // Interpolate non-xh-* attributes on elements provided by the caller,
    // or fall back to querySelectorAll("*") when called standalone.
    interpolateDOMAttrs(root, ctx);
  }

  /**
   * Interpolate {{field}} tokens in non-xh-* attributes.
   * Accepts an optional pre-collected element list to avoid redundant DOM scans
   * when the caller already has elements from a targeted query.
   *
   * @param {Element}     root
   * @param {DataContext}  ctx
   * @param {Element[]}   [elements] – Pre-collected elements to process.
   */
  function interpolateDOMAttrs(root, ctx, elements) {
    if (!elements) {
      // Use TreeWalker for element nodes instead of querySelectorAll("*")
      // to avoid creating a snapshot NodeList of every descendant.
      var walker = document.createTreeWalker(root, 1 /* NodeFilter.SHOW_ELEMENT */);
      var collected = [];
      while (walker.nextNode()) collected.push(walker.currentNode);
      elements = collected;
    }
    for (var e = 0; e < elements.length; e++) {
      var attrs = elements[e].attributes;
      var hasInterp = false;
      for (var a = 0; a < attrs.length; a++) {
        if (attrs[a].value.indexOf("{{") !== -1) { hasInterp = true; break; }
      }
      if (!hasInterp) continue;
      for (var a2 = 0; a2 < attrs.length; a2++) {
        var name = attrs[a2].name;
        if (name.indexOf("xh-") === 0) continue;
        var origAttr = attrs[a2].value;
        if (origAttr.indexOf("{{") === -1) continue;
        var replacedAttr = interpolate(origAttr, ctx, false);
        if (replacedAttr !== origAttr) attrs[a2].value = replacedAttr;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Template loading  (external fetch + cache, inline <template>, self)
  // ---------------------------------------------------------------------------

  /**
   * Fetch an external template by URL, with deduplication and caching.
   * @param {string} url
   * @returns {Promise<string>}
   */
  function fetchTemplate(url) {
    // Prepend template prefix (for UI versioning)
    var fetchUrl = config.templatePrefix ? config.templatePrefix + url : url;
    // Cache by prefixed URL so version switches get fresh templates
    if (templateCache.has(fetchUrl)) return templateCache.get(fetchUrl);
    var promise = fetch(fetchUrl).then(function (res) {
      if (!res.ok) throw new Error("Template fetch failed: " + fetchUrl + " (" + res.status + ")");
      return res.text();
    });
    templateCache.set(fetchUrl, promise);
    return promise;
  }

  /**
   * Resolve the template HTML for an element.
   *
   * Priority:
   *   1. xh-template attribute (external URL)
   *   2. Inline <template> child
   *   3. null (self-binding — element itself is the target)
   *
   * @param {Element}  el
   * @param {string[]} templateStack – URLs already being resolved (circular check)
   * @returns {Promise<{html: string|null, isExternal: boolean}>}
   */
  function resolveTemplate(el, templateStack) {
    // -- breakpoint-specific template -----------------------------------------
    var bp = getCurrentBreakpoint();
    if (bp !== "desktop") {
      var bpTemplate = el.getAttribute("xh-template-" + bp);
      if (bpTemplate) {
        if (templateStack.indexOf(bpTemplate) !== -1) {
          console.error("[xhtmlx] circular template reference detected: " + bpTemplate);
          return Promise.reject(new Error("Circular template: " + bpTemplate));
        }
        var newBpStack = templateStack.concat(bpTemplate);
        return fetchTemplate(bpTemplate).then(function(html) {
          return { html: html, isExternal: true, templateStack: newBpStack };
        });
      }
    }

    // -- normal xh-template ---------------------------------------------------
    var url = el.getAttribute("xh-template");

    // -- external template ----------------------------------------------------
    if (url) {
      if (templateStack.indexOf(url) !== -1) {
        console.error("[xhtmlx] circular template reference detected: " + url);
        return Promise.reject(new Error("Circular template: " + url));
      }
      var newStack = templateStack.concat(url);
      return fetchTemplate(url).then(function (html) {
        return { html: html, isExternal: true, templateStack: newStack };
      });
    }

    // -- inline <template> ----------------------------------------------------
    var tpl = el.querySelector(":scope > template");
    if (tpl) {
      return Promise.resolve({
        html: tpl.innerHTML,
        isExternal: false,
        templateStack: templateStack
      });
    }

    // -- self-binding ---------------------------------------------------------
    return Promise.resolve({
      html: null,
      isExternal: false,
      templateStack: templateStack
    });
  }

  // ---------------------------------------------------------------------------
  // Directive processing
  // ---------------------------------------------------------------------------

  var REST_VERBS = ["xh-get", "xh-post", "xh-put", "xh-delete", "xh-patch"];
  var VERB_MAP = {"xh-get":"GET","xh-post":"POST","xh-put":"PUT","xh-delete":"DELETE","xh-patch":"PATCH"};

  /**
   * Returns the REST verb attribute on an element, if any.
   * Caches the result in elementStates to avoid repeated getAttribute calls.
   * @param {Element} el
   * @returns {{verb: string, url: string}|null}
   */
  function getRestVerb(el) {
    var state = elementStates.get(el);
    if (state && state._restInfo !== undefined) return state._restInfo;
    var result = null;
    for (var i = 0; i < REST_VERBS.length; i++) {
      var url = el.getAttribute(REST_VERBS[i]);
      if (url != null) {
        result = { verb: VERB_MAP[REST_VERBS[i]], url: url };
        break;
      }
    }
    if (state) state._restInfo = result;
    return result;
  }

  /**
   * Apply data-binding directives to a single element (xh-text, xh-html,
   * xh-attr-*, xh-if, xh-unless). Does NOT handle xh-each — that is done
   * separately because it clones elements.
   *
   * @param {Element}     el
   * @param {DataContext}  ctx
   * @returns {boolean} false if the element was removed by xh-if/xh-unless
   */
  /**
   * Subscribe to a MutableDataContext field and track the unsubscribe
   * function in elementStates for cleanup when the element is removed.
   */
  function trackSubscription(el, ctx, path, callback) {
    var unsub = ctx.subscribe(path, callback);
    var st = elementStates.get(el);
    if (!st) { st = {}; elementStates.set(el, st); }
    if (!st.unsubscribes) st.unsubscribes = [];
    st.unsubscribes.push(unsub);
  }

  /** Subscribe to attr changes without IIFE closure overhead. */
  function bindAttrSubscription(el, ctx, field, targetAttr) {
    trackSubscription(el, ctx, field, function() {
      var newVal = ctx.resolve(field);
      if (newVal != null) el.setAttribute(targetAttr, String(newVal));
    });
  }

  /** Subscribe to class changes without IIFE closure overhead. */
  function bindClassSubscription(el, ctx, field, className) {
    trackSubscription(el, ctx, field, function() {
      var newVal = ctx.resolve(field);
      if (newVal) el.classList.add(className);
      else el.classList.remove(className);
    });
  }

  function applyBindings(el, ctx) {
    var isMutable = ctx instanceof MutableDataContext;

    // -- Single pass over attributes to collect all xh-* bindings -----------
    // Replaces 7+ individual getAttribute calls with one loop.
    var attrs = el.attributes;
    var showField = null, hideField = null, ifField = null, unlessField = null;
    var textField = null, htmlField = null, modelField = null;
    // Collect xh-attr-*/xh-class-* inline (pairs of target,field)
    var attrPairs = null;  // lazy: [targetAttr, field, targetAttr, field, ...]
    var classPairs = null; // lazy: [className, field, className, field, ...]

    for (var i = attrs.length - 1; i >= 0; i--) {
      var aName = attrs[i].name;
      // Quick bail: skip non-xh attributes (most common case)
      if (aName.charCodeAt(0) !== 120 /* x */ ||
          aName.charCodeAt(1) !== 104 /* h */ ||
          aName.charCodeAt(2) !== 45  /* - */) continue;

      var aValue = attrs[i].value;
      switch (aName) {
        case "xh-show":    showField   = aValue; break;
        case "xh-hide":    hideField   = aValue; break;
        case "xh-if":      ifField     = aValue; break;
        case "xh-unless":  unlessField = aValue; break;
        case "xh-text":    textField   = aValue; break;
        case "xh-html":    htmlField   = aValue; break;
        case "xh-model":   modelField  = aValue; break;
        default:
          if (aName.indexOf("xh-attr-") === 0) {
            if (!attrPairs) attrPairs = [];
            attrPairs.push(aName.slice(8), aValue);
          } else if (aName.indexOf("xh-class-") === 0) {
            if (!classPairs) classPairs = [];
            classPairs.push(aName.slice(9), aValue);
          }
      }
    }

    // -- Apply in correct order -----------------------------------------------

    // xh-show
    if (showField !== null) {
      var sval = ctx.resolve(showField);
      el.style.display = sval ? "" : "none";
      if (isMutable) {
        trackSubscription(el, ctx, showField, function() {
          var newVal = ctx.resolve(showField);
          el.style.display = newVal ? "" : "none";
        });
      }
    }

    // xh-hide
    if (hideField !== null) {
      var hdval = ctx.resolve(hideField);
      el.style.display = hdval ? "none" : "";
      if (isMutable) {
        trackSubscription(el, ctx, hideField, function() {
          var newVal = ctx.resolve(hideField);
          el.style.display = newVal ? "none" : "";
        });
      }
    }

    // xh-if
    if (ifField !== null) {
      if (!ctx.resolve(ifField)) {
        el.remove();
        return false;
      }
    }

    // xh-unless
    if (unlessField !== null) {
      if (ctx.resolve(unlessField)) {
        el.remove();
        return false;
      }
    }

    // xh-text
    if (textField !== null) {
      var tv = ctx.resolve(textField);
      var tvStr = tv != null ? (typeof tv === "string" ? tv : String(tv)) : "";
      if (el.firstChild && el.firstChild.nodeType === 3) {
        el.firstChild.nodeValue = tvStr;
      } else {
        el.textContent = tvStr;
      }
      if (isMutable) {
        trackSubscription(el, ctx, textField, function() {
          var newVal = ctx.resolve(textField);
          var s = newVal != null ? (typeof newVal === "string" ? newVal : String(newVal)) : "";
          if (el.firstChild && el.firstChild.nodeType === 3) {
            el.firstChild.nodeValue = s;
          } else {
            el.textContent = s;
          }
        });
      }
    }

    // xh-html
    if (htmlField !== null) {
      var hv = ctx.resolve(htmlField);
      if (config.cspSafe) {
        if (config.debug) console.warn("[xhtmlx] xh-html is disabled in CSP-safe mode, falling back to xh-text");
        el.textContent = hv != null ? String(hv) : "";
      } else {
        el.innerHTML = hv != null ? String(hv) : "";
        if (isMutable) {
          trackSubscription(el, ctx, htmlField, function() {
            var newVal = ctx.resolve(htmlField);
            el.innerHTML = newVal != null ? String(newVal) : "";
          });
        }
      }
    }

    // xh-attr-*
    if (attrPairs) {
      for (var a = 0; a < attrPairs.length; a += 2) {
        var aval = ctx.resolve(attrPairs[a + 1]);
        if (aval != null) {
          el.setAttribute(attrPairs[a], String(aval));
        }
        if (isMutable) {
          bindAttrSubscription(el, ctx, attrPairs[a + 1], attrPairs[a]);
        }
      }
    }

    // xh-class-*
    if (classPairs) {
      var toAdd = null, toRemove = null;
      for (var c = 0; c < classPairs.length; c += 2) {
        var cval = ctx.resolve(classPairs[c + 1]);
        if (cval) {
          if (!toAdd) toAdd = [];
          toAdd.push(classPairs[c]);
        } else {
          if (!toRemove) toRemove = [];
          toRemove.push(classPairs[c]);
        }
        if (isMutable) {
          bindClassSubscription(el, ctx, classPairs[c + 1], classPairs[c]);
        }
      }
      if (toAdd) el.classList.add.apply(el.classList, toAdd);
      if (toRemove) el.classList.remove.apply(el.classList, toRemove);
    }

    // xh-model
    if (modelField !== null) {
      var mv = ctx.resolve(modelField);
      var tag = el.tagName.toLowerCase();
      var type = (el.getAttribute("type") || "").toLowerCase();

      if (tag === "select") {
        var options = el.options;
        for (var s = 0; s < options.length; s++) {
          options[s].selected = (options[s].value === mv);
        }
      } else if (type === "checkbox") {
        el.checked = !!mv;
      } else if (type === "radio") {
        el.checked = (el.value === mv);
      } else if (tag === "textarea") {
        el.value = mv != null ? String(mv) : "";
      } else {
        el.value = mv != null ? String(mv) : "";
      }

      if (isMutable && !el.hasAttribute("data-xh-model-bound")) {
        _hasStatefulElements = true;
        el.setAttribute("data-xh-model-bound", "");
        (function(field, element, context) {
          var eventName = (type === "checkbox" || type === "radio" || tag === "select") ? "change" : "input";
          element.addEventListener(eventName, function() {
            var newValue;
            if (type === "checkbox") {
              newValue = element.checked;
            } else {
              newValue = element.value;
            }
            context.set(field, newValue);
          });
        })(modelField, el, ctx);
      }
    }

    // custom directives (skip loop setup when none registered)
    if (customDirectives.length > 0) {
      for (var cd = 0; cd < customDirectives.length; cd++) {
        var directive = customDirectives[cd];
        var cdVal = el.getAttribute(directive.name);
        if (cdVal != null) {
          directive.handler(el, cdVal, ctx);
        }
      }
    }

    return true;
  }

  /**
   * Build a targeted CSS selector from a template element by inspecting its
   * descendants once.  This covers all known xh-* attributes (via
   * XH_KNOWN_SELECTOR) and any dynamic attributes (xh-on-*, xh-attr-*,
   * xh-class-*, xh-i18n-*) that actually appear in the template.
   * The result is reused for every clone, avoiding querySelectorAll("*").
   *
   * @param {Element} templateEl
   * @returns {string}
   */
  function buildCloneSelector(templateEl) {
    // Scan descendants using a TreeWalker (visits elements without creating a
    // snapshot NodeList) to discover dynamic attrs like xh-on-*, xh-attr-*,
    // xh-class-*, xh-i18n-*. These can't be part of XH_KNOWN_SELECTOR because
    // their full attribute names are user-defined.
    var localDynamic = {};
    var needRebuild = false;
    var walker = document.createTreeWalker(templateEl, 1 /* SHOW_ELEMENT */);
    while (walker.nextNode()) {
      var attrs = walker.currentNode.attributes;
      for (var a = 0; a < attrs.length; a++) {
        var name = attrs[a].name;
        if (name.indexOf("xh-on-") === 0 || name.indexOf("xh-attr-") === 0 ||
            name.indexOf("xh-class-") === 0 || name.indexOf("xh-i18n-") === 0) {
          var sel = "[" + name + "]";
          localDynamic[sel] = true;
          if (!dynamicAttrSelectors[sel]) {
            dynamicAttrSelectors[sel] = true;
            needRebuild = true;
          }
        }
      }
    }
    if (needRebuild) rebuildDetectSelector();
    var extra = Object.keys(localDynamic);
    return extra.length ? XH_KNOWN_SELECTOR + "," + extra.join(",") : XH_KNOWN_SELECTOR;
  }

  /**
   * Render a single plan-based xh-each item (top-level to avoid closure allocation).
   */
  function _renderPlanEachItem(item, idx, target, EachCtx, ctx, plan) {
    var b = execElementPlan(plan, new EachCtx(item, ctx, idx));
    if (b) {
      eachItemSet.add(b);
      elementStates.set(b, PROCESSED_STATE);
      target.appendChild(b);
    }
  }

  /**
   * Process xh-each on an element. Clones the element for each item in the
   * array, applies bindings, and recursively processes each clone.
   *
   * @param {Element}     el
   * @param {DataContext}  ctx
   */
  function processEach(el, ctx, selectorHint) {
    var eachAttr = el.getAttribute("xh-each");
    if (eachAttr == null) return false;

    var arr = ctx.resolve(eachAttr);
    if (!Array.isArray(arr)) {
      if (config.debug) {
        console.warn("[xhtmlx] xh-each: '" + eachAttr + "' did not resolve to an array");
      }
      el.remove();
      return true;
    }

    var parent = el.parentNode;
    if (!parent) return true;

    // Remove the xh-each attribute from the template element so clones don't
    // re-trigger iteration.
    el.removeAttribute("xh-each");

    // Use pre-built selector from caller if available, otherwise build one
    // from the template once, reused for all cloned items.
    var cloneSelector = selectorHint || buildCloneSelector(el);

    // Try to compile a fast binding plan for simple templates (no REST verbs,
    // no nested xh-each, no xh-on-* handlers). Falls back to null for complex
    // templates that need full processEachCloneChildren processing.
    var eachPlan = compileEachPlan(el);

    // Pre-check: does the template root have xh-on-* handlers?
    var rootHasOn = false;
    for (var roa = 0; roa < el.attributes.length; roa++) {
      if (el.attributes[roa].name.indexOf("xh-on-") === 0) {
        rootHasOn = true;
        break;
      }
    }

    // Compile an element plan for plan-based rendering (eliminates cloneNode)
    var itemPlan = (eachPlan && !rootHasOn) ? compileElementPlan(el) : null;

    var fragment = document.createDocumentFragment();

    var ItemCtxClass = (ctx instanceof MutableDataContext) ? MutableDataContext : DataContext;

    if (itemPlan) {
      // Plan-based fast path: no closure allocation for common (non-batch) case
      if (arr.length > config.batchThreshold && typeof requestAnimationFrame === "function") {
        var batchSize = config.batchThreshold;
        for (var i = 0; i < Math.min(batchSize, arr.length); i++) {
          _renderPlanEachItem(arr[i], i, fragment, ItemCtxClass, ctx, itemPlan);
        }
        parent.insertBefore(fragment, el);
        var offset = batchSize;
        function _planBatch() {
          var bf = document.createDocumentFragment();
          var end = Math.min(offset + batchSize, arr.length);
          for (var b = offset; b < end; b++) {
            _renderPlanEachItem(arr[b], b, bf, ItemCtxClass, ctx, itemPlan);
          }
          parent.appendChild(bf);
          offset = end;
          if (offset < arr.length) requestAnimationFrame(_planBatch);
        }
        if (offset < arr.length) requestAnimationFrame(_planBatch);
        parent.removeChild(el);
        return true;
      }
      for (var j = 0; j < arr.length; j++) {
        _renderPlanEachItem(arr[j], j, fragment, ItemCtxClass, ctx, itemPlan);
      }
    } else {
      // Clone-based fallback path
      var renderItem = function (item, idx, targetFragment) {
        var itemCtx = new ItemCtxClass(item, ctx, idx);
        var clone = el.cloneNode(true);
        eachItemSet.add(clone);
        applyBindings(clone, itemCtx);
        if (rootHasOn) {
          for (var oa = 0; oa < clone.attributes.length; oa++) {
            if (clone.attributes[oa].name.indexOf("xh-on-") === 0) {
              attachOnHandler(clone, clone.attributes[oa].name.slice(6), clone.attributes[oa].value);
            }
          }
        }
        elementStates.set(clone, PROCESSED_STATE);
        if (eachPlan) {
          applyEachPlan(clone, itemCtx, eachPlan);
        } else {
          processEachCloneChildren(clone, itemCtx, cloneSelector);
        }
        targetFragment.appendChild(clone);
      };

      if (arr.length > config.batchThreshold && typeof requestAnimationFrame === "function") {
        var batchSize2 = config.batchThreshold;
        for (var i2 = 0; i2 < Math.min(batchSize2, arr.length); i2++) {
          renderItem(arr[i2], i2, fragment);
        }
        parent.insertBefore(fragment, el);
        var offset2 = batchSize2;
        function renderBatch() {
          var batchFragment = document.createDocumentFragment();
          var end = Math.min(offset2 + batchSize2, arr.length);
          for (var b2 = offset2; b2 < end; b2++) {
            renderItem(arr[b2], b2, batchFragment);
          }
          parent.appendChild(batchFragment);
          offset2 = end;
          if (offset2 < arr.length) requestAnimationFrame(renderBatch);
        }
        if (offset2 < arr.length) requestAnimationFrame(renderBatch);
        parent.removeChild(el);
        return true;
      }
      for (var j2 = 0; j2 < arr.length; j2++) {
        renderItem(arr[j2], j2, fragment);
      }
    }

    parent.insertBefore(fragment, el);
    parent.removeChild(el);
    return true;
  }

  /**
   * Walk a subtree applying bindings (xh-text, xh-html, xh-attr-*, xh-if,
   * xh-unless, xh-each) to every element. This is used after template
   * rendering.
   *
   * @param {Element}     root
   * @param {DataContext}  ctx
   */
  function processBindingsInTree(root, ctx, selectorHint) {
    // Use a targeted selector instead of querySelectorAll("*") so we only
    // visit elements that actually have xh-* attributes.
    var elements = Array.prototype.slice.call(root.querySelectorAll(selectorHint || buildCloneSelector(root)));
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      // Skip if already detached from DOM
      if (!el.parentNode) continue;

      // xh-each must be handled before other bindings on the same element
      if (el.hasAttribute("xh-each")) {
        processEach(el, ctx);
        continue;
      }

      // Apply simple bindings
      applyBindings(el, ctx);
    }
  }

  /**
   * Combined processing pass for xh-each clone children.
   * Merges processBindingsInTree + processNode into a single querySelectorAll
   * to avoid 2+ full DOM scans per cloned item.
   *
   * @param {Element}     root     – The cloned element.
   * @param {DataContext}  ctx      – Per-item data context.
   * @param {string}      selector – Pre-built CSS selector targeting only
   *                                 elements with xh-* attributes.
   */
  function processEachCloneChildren(root, ctx, selector) {
    // Clone children are in a detached fragment — the NodeList is stable,
    // so iterate directly without snapshotting to avoid array allocation.
    var elements = root.querySelectorAll(selector);
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (!el.parentNode) continue;

      // xh-each (nested iterations)
      if (el.hasAttribute("xh-each")) {
        processEach(el, ctx);
        continue;
      }

      // Apply bindings (xh-text, xh-html, xh-attr-*, xh-if, etc.)
      var kept = applyBindings(el, ctx);

      if (kept) {
        // Check for xh-on-* event handlers
        for (var oa = 0; oa < el.attributes.length; oa++) {
          if (el.attributes[oa].name.indexOf("xh-on-") === 0) {
            attachOnHandler(el, el.attributes[oa].name.slice(6), el.attributes[oa].value);
          }
        }

        // Analytics tracking
        if (el.hasAttribute("xh-track")) setupTrack(el, ctx);
        if (el.hasAttribute("xh-track-view")) setupTrackView(el, ctx);

        // Attach REST triggers if element has a REST verb
        if (getRestVerb(el)) {
          var state = elementStates.get(el) || {};
          state.dataContext = ctx;
          state.requestInFlight = false;
          state.intervalIds = state.intervalIds || [];
          state.observers = state.observers || [];
          elementStates.set(el, state);
          attachTriggers(el, ctx, []);
        } else {
          // Mark non-REST elements as processed to prevent re-processing
          // by processNode with the wrong parent context
          var bState = elementStates.get(el) || {};
          bState.processed = true;
          elementStates.set(el, bState);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Pre-compiled binding plan for xh-each (avoids querySelectorAll per clone)
  // ---------------------------------------------------------------------------

  /**
   * Analyze an xh-each template element and build a binding plan.
   * The plan records child element paths and their binding types, so that
   * clones can be processed by direct tree traversal instead of CSS selectors.
   *
   * @param {Element} templateEl – The template element (xh-each already removed).
   * @returns {Object|null} – Plan object, or null if template needs full processing
   *                          (has REST verbs, xh-on-*, analytics, nested xh-each).
   */
  function compileEachPlan(templateEl) {
    var entries = []; // { path: number[], hasRest: boolean, hasOnHandlers: boolean, ... }
    var needsFull = false;

    function walk(node, path) {
      var children = node.children;
      for (var i = 0; i < children.length; i++) {
        var child = children[i];
        var childPath = path.length === 0 ? [i] : path.concat(i);
        var hasXh = false;
        var hasRest = false;
        var hasEach = false;
        var hasOn = false;
        var hasTrack = false;

        var attrs = child.attributes;
        for (var a = 0; a < attrs.length; a++) {
          var name = attrs[a].name;
          if (name.charCodeAt(0) !== 120 || name.charCodeAt(1) !== 104 ||
              name.charCodeAt(2) !== 45) continue;
          hasXh = true;
          if (name === "xh-each") hasEach = true;
          else if (name === "xh-get" || name === "xh-post" || name === "xh-put" ||
                   name === "xh-delete" || name === "xh-patch") hasRest = true;
          else if (name.indexOf("xh-on-") === 0) hasOn = true;
          else if (name === "xh-track" || name === "xh-track-view") hasTrack = true;
        }

        // If template has nested xh-each, REST verbs, or event handlers,
        // fall back to the full processEachCloneChildren path.
        if (hasEach) { needsFull = true; return; }

        if (hasXh) {
          entries.push({
            path: childPath,
            hasRest: hasRest,
            hasOn: hasOn,
            hasTrack: hasTrack
          });
        }

        // If this child has REST verbs, we need the full processing for triggers
        if (hasRest) { needsFull = true; return; }

        walk(child, childPath);
      }
    }

    walk(templateEl, []);
    if (needsFull) return null;
    return entries;
  }

  /**
   * Navigate a DOM tree by child indices path.
   * @param {Element} root
   * @param {number[]} path – Array of child element indices from root.
   * @returns {Element}
   */
  function navigatePath(root, path) {
    var node = root;
    for (var i = 0; i < path.length; i++) {
      node = node.children[path[i]];
    }
    return node;
  }

  /**
   * Apply a pre-compiled binding plan to a cloned xh-each item.
   * Avoids querySelectorAll and redundant feature checks per clone.
   *
   * @param {Element}     clone   – The cloned element.
   * @param {DataContext}  ctx     – Per-item data context.
   * @param {Object[]}    plan    – Pre-compiled binding entries.
   */
  function applyEachPlan(clone, ctx, plan) {
    for (var i = 0; i < plan.length; i++) {
      var entry = plan[i];
      var el = navigatePath(clone, entry.path);
      if (!el) continue;

      var kept = applyBindings(el, ctx);
      if (kept) {
        if (entry.hasOn) {
          var attrs = el.attributes;
          for (var oa = 0; oa < attrs.length; oa++) {
            if (attrs[oa].name.indexOf("xh-on-") === 0) {
              attachOnHandler(el, attrs[oa].name.slice(6), attrs[oa].value);
            }
          }
        }
        if (entry.hasTrack) {
          if (el.hasAttribute("xh-track")) setupTrack(el, ctx);
          if (el.hasAttribute("xh-track-view")) setupTrackView(el, ctx);
        }
        // No REST verbs in compiled plan (falls back to full path if present)
        elementStates.set(el, PROCESSED_STATE);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Trigger parsing
  // ---------------------------------------------------------------------------

  /**
   * Determine the default trigger event for an element.
   * @param {Element} el
   * @returns {string}
   */
  function defaultTrigger(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === "form") return "submit";
    if (tag === "input" || tag === "select" || tag === "textarea") return "change";
    return "click"; // buttons, links, divs, etc.
  }

  /**
   * Parse the xh-trigger attribute into an array of trigger spec objects.
   *
   * Syntax examples:
   *   "click"
   *   "click once"
   *   "keyup changed delay:300ms"
   *   "load"
   *   "every 5s"
   *   "revealed"
   *   "click from:#other-button"
   *
   * @param {string} raw
   * @returns {Object[]}
   */
  var triggerSpecCache = new Map();

  function parseTrigger(raw) {
    if (!raw || !raw.trim()) return [];

    // Cache parsed specs — many elements share identical trigger strings
    var cached = triggerSpecCache.get(raw);
    if (cached) return cached;

    // Multiple triggers can be comma-separated
    var parts = raw.split(",");
    var specs = [];

    for (var p = 0; p < parts.length; p++) {
      var tokens = parts[p].trim().split(/\s+/);
      if (tokens.length === 0 || tokens[0] === "") continue;

      var spec = {
        event: tokens[0],
        delay: 0,
        throttle: 0,
        once: false,
        changed: false,
        from: null,
        interval: 0 // for "every Ns"
      };

      // Handle "every Ns"
      if (spec.event === "every" && tokens.length >= 2) {
        var match = tokens[1].match(/^(\d+)(s|ms)$/);
        if (match) {
          spec.interval = match[2] === "s" ? parseInt(match[1]) * 1000 : parseInt(match[1]);
          spec.event = "every";
          // Continue parsing modifiers after the interval token
          tokens = tokens.slice(2);
        }
      } else {
        tokens = tokens.slice(1);
      }

      // Parse modifiers
      for (var t = 0; t < tokens.length; t++) {
        var tok = tokens[t];
        if (tok === "once") {
          spec.once = true;
        } else if (tok === "changed") {
          spec.changed = true;
        } else if (tok.indexOf("delay:") === 0) {
          spec.delay = parseTimeValue(tok.slice(6));
        } else if (tok.indexOf("throttle:") === 0) {
          spec.throttle = parseTimeValue(tok.slice(9));
        } else if (tok.indexOf("from:") === 0) {
          spec.from = tok.slice(5);
        }
      }

      specs.push(spec);
    }
    triggerSpecCache.set(raw, specs);
    return specs;
  }

  /**
   * Parse a time value like "300ms" or "2s" into milliseconds.
   * @param {string} val
   * @returns {number}
   */
  function parseTimeValue(val) {
    var m = val.match(/^(\d+)(ms|s)$/);
    if (!m) return 0;
    return m[2] === "s" ? parseInt(m[1]) * 1000 : parseInt(m[1]);
  }

  // ---------------------------------------------------------------------------
  // Shared form helpers
  // ---------------------------------------------------------------------------

  /**
   * Convert a form's data to a plain object.
   * @param {HTMLFormElement} form
   * @returns {Object}
   */
  var _hasFromEntries = typeof Object.fromEntries === "function";
  function formDataToObject(form) {
    if (_hasFromEntries) return Object.fromEntries(new FormData(form));
    var obj = {};
    new FormData(form).forEach(function(v, k) { obj[k] = v; });
    return obj;
  }

  // ---------------------------------------------------------------------------
  // Request handling
  // ---------------------------------------------------------------------------

  /**
   * Build the request body for a POST/PUT/PATCH request.
   *
   * @param {Element}     el    – The element that triggered the request.
   * @param {DataContext}  ctx   – Current data context.
   * @returns {string|null}
   */
  function buildRequestBody(el, ctx) {
    var body = {};

    // If the trigger element is (or is inside) a form, serialize the form
    var form = el.tagName.toLowerCase() === "form" ? el : el.closest("form");
    if (form) {
      var formObj = formDataToObject(form);
      for (var fk in formObj) {
        if (formObj.hasOwnProperty(fk)) body[fk] = formObj[fk];
      }
    }

    // Merge xh-vals
    var valsAttr = el.getAttribute("xh-vals");
    if (valsAttr) {
      try {
        var valsInterpolated = interpolate(valsAttr, ctx, false);
        var vals = JSON.parse(valsInterpolated);
        for (var k in vals) {
          if (vals.hasOwnProperty(k)) {
            body[k] = vals[k];
          }
        }
      } catch (e) {
        console.error("[xhtmlx] invalid JSON in xh-vals:", valsAttr, e);
      }
    }

    // Collect xh-model values from the element's scope
    var scope = form || el.closest("[xh-get],[xh-post],[xh-put],[xh-patch],[xh-delete]") || el;
    var modelInputs = scope.querySelectorAll("[xh-model]");
    for (var m = 0; m < modelInputs.length; m++) {
      var mEl = modelInputs[m];
      var field = mEl.getAttribute("xh-model");
      var mTag = mEl.tagName.toLowerCase();
      var mType = (mEl.getAttribute("type") || "").toLowerCase();

      if (mType === "checkbox") {
        body[field] = mEl.checked;
      } else if (mType === "radio") {
        if (mEl.checked) body[field] = mEl.value;
      } else if (mTag === "select") {
        body[field] = mEl.value;
      } else {
        body[field] = mEl.value;
      }
    }

    return JSON.stringify(body);
  }

  /**
   * Parse the xh-headers attribute.
   * @param {Element}     el
   * @param {DataContext}  ctx
   * @returns {Object}
   */
  function parseHeaders(el, ctx) {
    var hdrs = {};
    var raw = el.getAttribute("xh-headers");
    if (raw) {
      try {
        var interpolated = interpolate(raw, ctx, false);
        hdrs = JSON.parse(interpolated);
      } catch (e) {
        console.error("[xhtmlx] invalid JSON in xh-headers:", raw, e);
      }
    }
    return hdrs;
  }

  // ---------------------------------------------------------------------------
  // Indicator helpers
  // ---------------------------------------------------------------------------

  function showIndicator(el) {
    var sel = el.getAttribute("xh-indicator");
    if (!sel) return null;
    var ind = document.querySelector(sel);
    if (ind) ind.classList.add(config.requestClass);
    return ind;
  }

  function hideIndicator(el, cachedInd) {
    if (cachedInd) {
      cachedInd.classList.remove(config.requestClass);
      return;
    }
    var sel = el.getAttribute("xh-indicator");
    if (!sel) return;
    var ind = document.querySelector(sel);
    if (ind) ind.classList.remove(config.requestClass);
  }

  // ---------------------------------------------------------------------------
  // Custom DOM events
  // ---------------------------------------------------------------------------

  /**
   * Dispatch a custom event on an element.
   * @param {Element} el
   * @param {string}  name       – Event name (e.g. "xh:beforeRequest")
   * @param {Object}  detail     – Event detail data
   * @param {boolean} cancelable
   * @returns {boolean} false if event was preventDefault()'d
   */
  function emitEvent(el, name, detail, cancelable) {
    var evt = new CustomEvent(name, {
      bubbles: true,
      cancelable: !!cancelable,
      detail: detail || {}
    });
    return el.dispatchEvent(evt);
  }

  // ---------------------------------------------------------------------------
  // Error template resolution
  // ---------------------------------------------------------------------------

  /**
   * Determine which error template URL to use for a given HTTP status code.
   *
   * Resolution order:
   *   1. xh-error-template-{exact code}    on the element
   *   2. xh-error-template-{class}         on the element (e.g. 4xx)
   *   3. xh-error-template                 on the element (generic)
   *   4. nearest ancestor xh-error-boundary with template/target
   *   5. config.defaultErrorTemplate       global fallback
   *   6. null                              just add CSS class
   *
   * @param {Element} el
   * @param {number}  status
   * @returns {string|null}
   */
  function resolveErrorTemplate(el, status) {
    // 1. exact code on element
    var exact = el.getAttribute("xh-error-template-" + status);
    if (exact) return { template: exact, boundary: null };

    // 2. class (4xx, 5xx) on element
    var cls = Math.floor(status / 100) + "xx";
    var classAttr = el.getAttribute("xh-error-template-" + cls);
    if (classAttr) return { template: classAttr, boundary: null };

    // 3. generic on element
    var generic = el.getAttribute("xh-error-template");
    if (generic) return { template: generic, boundary: null };

    // 4. nearest ancestor xh-error-boundary
    var boundary = findErrorBoundary(el, status);
    if (boundary) return { template: boundary.template, boundary: boundary };

    // 5. global config
    if (config.defaultErrorTemplate) return { template: config.defaultErrorTemplate, boundary: null };

    return null;
  }

  /**
   * Walk up the DOM to find the nearest xh-error-boundary ancestor.
   * An error boundary can have its own xh-error-template[-code] attributes.
   *
   * @param {Element} el
   * @param {number}  status
   * @returns {{template: string, target: Element|null}|null}
   */
  function findErrorBoundary(el, status) {
    var node = el.parentElement;
    while (node) {
      if (node.hasAttribute("xh-error-boundary")) {
        // Check status-specific template on boundary
        var cls = Math.floor(status / 100) + "xx";
        var tmpl = node.getAttribute("xh-error-template-" + status) ||
                   node.getAttribute("xh-error-template-" + cls) ||
                   node.getAttribute("xh-error-template");
        if (tmpl) {
          return { template: tmpl, boundaryEl: node };
        }
      }
      node = node.parentElement;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Swap helpers
  // ---------------------------------------------------------------------------

  /**
   * Get the target element for swapping content.
   * @param {Element} el          – The element that triggered the request.
   * @param {boolean} isError     – Whether this is an error swap.
   * @returns {Element}
   */
  function getSwapTarget(el, isError, status, cachedBoundary) {
    var sel;
    if (isError) {
      // 1. Element-level xh-error-target
      sel = el.getAttribute("xh-error-target");
      if (sel) {
        var t = document.querySelector(sel);
        if (t) return t;
      }

      // 2. Error boundary target (use cached boundary to avoid redundant DOM walk)
      var boundary = cachedBoundary !== undefined ? cachedBoundary : (status ? findErrorBoundary(el, status) : null);
      if (boundary) {
        var bTarget = boundary.boundaryEl.getAttribute("xh-error-target");
        if (bTarget) {
          var bt = document.querySelector(bTarget);
          if (bt) return bt;
        }
        // If boundary has no xh-error-target, swap into the boundary itself
        return boundary.boundaryEl;
      }

      // 3. Global config error target
      if (config.defaultErrorTarget) {
        var gt = document.querySelector(config.defaultErrorTarget);
        if (gt) return gt;
      }

      // 4. Fall back to xh-target or self
      sel = el.getAttribute("xh-target");
      if (sel) {
        var xt = document.querySelector(sel);
        if (xt) return xt;
      }
    } else {
      sel = el.getAttribute("xh-target");
      if (sel) {
        var target = document.querySelector(sel);
        if (target) return target;
        if (config.debug) console.warn("[xhtmlx] target not found:", sel);
      }
    }
    return el;
  }

  /**
   * Clean up any intervals or observers associated with elements that are
   * about to be removed from the DOM.
   * @param {Element} container
   */
  // Selector targeting elements likely to have cleanup state (REST verbs, WS, intervals)
  var CLEANUP_SELECTOR = "[xh-get],[xh-post],[xh-put],[xh-delete],[xh-patch],[xh-ws],[xh-model]";

  // Global flag: set to true when any element with REST/WS/model bindings is
  // processed. When false, cleanupBeforeSwap can skip the querySelectorAll
  // entirely — a major win for templates that never use stateful directives.
  var _hasStatefulElements = false;

  function cleanupBeforeSwap(container, includeContainer) {
    // Fast path: no stateful elements have been registered anywhere
    if (!_hasStatefulElements) return;

    // Only visit elements likely to have intervals/observers/ws state
    var all = container.querySelectorAll(CLEANUP_SELECTOR);
    for (var i = 0; i < all.length; i++) {
      cleanupElement(all[i]);
    }
    // Only clean up the container itself when it will be removed from the DOM
    // (outerHTML, delete). For innerHTML, the container survives and should
    // keep its own intervals/observers.
    if (includeContainer) {
      cleanupElement(container);
    }
  }

  /**
   * Clean up a single element's intervals and state.
   * @param {Element} el
   */
  function cleanupElement(el) {
    var state = elementStates.get(el);
    if (!state) return;
    if (state.intervalIds) {
      for (var j = 0; j < state.intervalIds.length; j++) {
        clearInterval(state.intervalIds[j]);
      }
    }
    if (state.observers) {
      for (var k = 0; k < state.observers.length; k++) {
        state.observers[k].disconnect();
      }
    }
    if (state.ws) {
      state.ws.close(1000);
      state.ws = null;
    }
    if (state.unsubscribes) {
      for (var u = 0; u < state.unsubscribes.length; u++) {
        state.unsubscribes[u]();
      }
      state.unsubscribes = [];
    }
  }

  /**
   * Perform the DOM swap.
   *
   * @param {Element}          target   – The target element.
   * @param {DocumentFragment} fragment – Rendered content.
   * @param {string}           mode     – Swap mode.
   * @returns {Element|null}   The element that should be processed recursively,
   *                           or null for "none"/"delete".
   */
  function performSwap(target, fragment, mode) {
    switch (mode) {
      case "innerHTML":
        if (target.firstChild) {
          cleanupBeforeSwap(target, false);
          if (config.cspSafe) {
            while (target.firstChild) target.removeChild(target.firstChild);
          } else {
            target.textContent = "";
          }
        }
        target.appendChild(fragment);
        return target;

      case "outerHTML":
        cleanupBeforeSwap(target, true);
        // Fast path: single-child fragment (most common case)
        if (fragment.childNodes.length === 1) {
          var single = fragment.firstChild;
          target.parentNode.replaceChild(single, target);
          return single.nodeType === 1 ? single : null;
        }
        var placeholder = document.createComment("xhtmlx-swap");
        target.parentNode.insertBefore(placeholder, target);
        target.parentNode.removeChild(target);
        // Insert all children of fragment before the placeholder
        var wrapper = document.createElement("div");
        wrapper.appendChild(fragment);
        var children = Array.prototype.slice.call(wrapper.childNodes);
        for (var i = 0; i < children.length; i++) {
          placeholder.parentNode.insertBefore(children[i], placeholder);
        }
        placeholder.parentNode.removeChild(placeholder);
        // Return the parent so we process the new nodes
        return children.length === 1 && children[0].nodeType === 1 ? children[0] : null;

      case "beforeend":
        target.appendChild(fragment);
        return target;

      case "afterbegin":
        target.insertBefore(fragment, target.firstChild);
        return target;

      case "beforebegin":
        target.parentNode.insertBefore(fragment, target);
        return target.parentNode;

      case "afterend":
        target.parentNode.insertBefore(fragment, target.nextSibling);
        return target.parentNode;

      case "delete":
        cleanupBeforeSwap(target, true);
        target.remove();
        return null;

      case "none":
        return null;

      default:
        console.warn("[xhtmlx] unknown swap mode:", mode);
        cleanupBeforeSwap(target, false);
        if (config.cspSafe) {
          while (target.firstChild) target.removeChild(target.firstChild);
        } else {
          target.textContent = "";
        }
        target.appendChild(fragment);
        return target;
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering pipeline
  // ---------------------------------------------------------------------------

  /**
   * Render a template HTML string with a DataContext, producing a
   * DocumentFragment ready for DOM insertion.
   *
   * Steps:
   *   1. Interpolate {{field}} tokens
   *   2. Parse into a DocumentFragment
   *   3. Process directives (xh-each, xh-if, xh-unless, xh-text, xh-html, xh-attr-*)
   *
   * @param {string}      html
   * @param {DataContext}  ctx
   * @returns {DocumentFragment}
   */
  // ---------------------------------------------------------------------------
  // Compiled render plan — eliminates cloneNode(true) and post-clone TreeWalker
  // ---------------------------------------------------------------------------

  /**
   * Compile a DOM subtree into a flat render plan.
   * Each entry describes how to recreate one DOM node from scratch.
   */
  function compileRenderPlan(parent) {
    var plan = [];
    if (_compilePlanChildren(parent, plan) === false) return null;
    return plan;
  }

  /**
   * Encode an xh-* attribute name and value into the plan's numeric type code
   * format (stride 3: [typeCode, arg1, arg2]).
   */
  function _pushXhCode(arr, name, value) {
    switch (name) {
      case "xh-if":         arr.push(XH_IF, value, 0); break;
      case "xh-unless":     arr.push(XH_UNLESS, value, 0); break;
      case "xh-text":       arr.push(XH_TEXT, value, 0); break;
      case "xh-html":       arr.push(XH_HTML, value, 0); break;
      case "xh-show":       arr.push(XH_SHOW, value, 0); break;
      case "xh-hide":       arr.push(XH_HIDE, value, 0); break;
      case "xh-track":      arr.push(XH_TRACK, value, 0); break;
      case "xh-track-view": arr.push(XH_TRACK_VIEW, value, 0); break;
      default:
        if (name.indexOf("xh-attr-") === 0)  arr.push(XH_ATTR, name.slice(8), value);
        else if (name.indexOf("xh-class-") === 0) arr.push(XH_CLASS, name.slice(9), value);
        else if (name.indexOf("xh-on-") === 0)    arr.push(XH_ON, name.slice(6), value);
        else arr.push(XH_UNKNOWN, name, value);
    }
  }

  /**
   * Compile a single element (e.g. an xh-each template) into a plan node.
   * Returns a plan entry for that element including its children.
   */
  function compileElementPlan(el) {
    var entry = {
      t: 1,
      tag: el.tagName.toLowerCase(),
      attrs: null,
      iAttrs: null,
      xh: null,
      skipCh: false,
      children: null
    };
    var attrs = el.attributes;
    var staticAttrs = null;
    var interpAttrs = null;
    var xhAttrs = null;
    for (var i = 0; i < attrs.length; i++) {
      var name = attrs[i].name;
      if (name.charCodeAt(0) === 120 && name.charCodeAt(1) === 104 && name.charCodeAt(2) === 45) {
        if (!xhAttrs) xhAttrs = [];
        _pushXhCode(xhAttrs, name, attrs[i].value);
      } else if (attrs[i].value.indexOf("{{") !== -1) {
        if (!interpAttrs) interpAttrs = [];
        interpAttrs.push(name, attrs[i].value);
      } else {
        if (!staticAttrs) staticAttrs = [];
        staticAttrs.push(name, attrs[i].value);
      }
    }
    entry.attrs = staticAttrs;
    entry.iAttrs = interpAttrs;
    entry.xh = xhAttrs;
    if (xhAttrs) {
      for (var sc = 0; sc < xhAttrs.length; sc += 3) {
        if (xhAttrs[sc] === XH_TEXT || xhAttrs[sc] === XH_HTML) { entry.skipCh = true; break; }
      }
    }
    var children = [];
    _compilePlanChildren(el, children);
    entry.children = children.length ? children : null;
    return entry;
  }

  /**
   * @returns {boolean} true on success, false if plan can't be compiled
   *                    (e.g. xh-each with nested xh-each or REST verbs).
   */
  function _compilePlanChildren(parent, planArr) {
    var child = parent.firstChild;
    while (child) {
      if (child.nodeType === 1) { // Element
        // xh-each: compile as a special plan node (t: 4)
        if (child.hasAttribute("xh-each")) {
          // Check if root has xh-on-* handlers (can't be plan-compiled)
          var hasXhOn = false;
          for (var chk = 0; chk < child.attributes.length; chk++) {
            if (child.attributes[chk].name.indexOf("xh-on-") === 0) { hasXhOn = true; break; }
          }
          // Clone to avoid mutating the prototype, remove xh-each, check eligibility
          var cloneForPlan = child.cloneNode(true);
          cloneForPlan.removeAttribute("xh-each");
          var eachP = compileEachPlan(cloneForPlan);
          if (!eachP || hasXhOn) return false; // Can't compile — bail out
          var itemPlan = compileElementPlan(cloneForPlan);
          planArr.push({ t: 4, eachAttr: child.getAttribute("xh-each"), itemPlan: itemPlan });
          child = child.nextSibling;
          continue;
        }

        var entry = {
          t: 1, // element
          tag: child.tagName.toLowerCase(),
          attrs: null,
          iAttrs: null,
          xh: null,
          skipCh: false,
          children: null
        };
        var attrs = child.attributes;
        var staticAttrs = null;
        var interpAttrs = null;
        var xhAttrs = null;
        for (var i = 0; i < attrs.length; i++) {
          var name = attrs[i].name;
          if (name.charCodeAt(0) === 120 && name.charCodeAt(1) === 104 && name.charCodeAt(2) === 45) {
            if (!xhAttrs) xhAttrs = [];
            _pushXhCode(xhAttrs, name, attrs[i].value);
          } else if (attrs[i].value.indexOf("{{") !== -1) {
            if (!interpAttrs) interpAttrs = [];
            interpAttrs.push(name, attrs[i].value);
          } else {
            if (!staticAttrs) staticAttrs = [];
            staticAttrs.push(name, attrs[i].value);
          }
        }
        entry.attrs = staticAttrs;
        entry.iAttrs = interpAttrs;
        entry.xh = xhAttrs;
        if (xhAttrs) {
          for (var sc = 0; sc < xhAttrs.length; sc += 3) {
            if (xhAttrs[sc] === XH_TEXT || xhAttrs[sc] === XH_HTML) { entry.skipCh = true; break; }
          }
        }
        var children = [];
        if (_compilePlanChildren(child, children) === false) return false;
        entry.children = children.length ? children : null;
        planArr.push(entry);
      } else if (child.nodeType === 3) { // Text
        var text = child.nodeValue;
        if (text.indexOf("{{") !== -1) {
          planArr.push({ t: 3, v: text }); // interpolated text
        } else {
          planArr.push({ t: 2, v: text }); // static text
        }
      }
      child = child.nextSibling;
    }
    return true;
  }

  /**
   * Apply bindings directly from a plan's xh array, bypassing the DOM
   * setAttribute → applyBindings round-trip. Only used for immutable
   * (non-MutableDataContext) contexts where no reactive subscriptions are
   * needed.
   *
   * @param {Element}    el  – The freshly created element.
   * @param {string[]}   xh  – Flat array of [name, value, name, value, ...].
   * @param {DataContext} ctx – The (immutable) data context.
   * @returns {boolean}  false if element was removed (xh-if/xh-unless), true otherwise.
   */
  function _applyPlanBindings(el, xh, ctx) {
    var hasUnknown = false;
    var classes = null;
    for (var i = 0; i < xh.length; i += 3) {
      var type = xh[i], a1 = xh[i + 1], a2 = xh[i + 2];
      switch (type) {
        case 0: // XH_IF
          if (!ctx.resolve(a1)) return false;
          break;
        case 1: // XH_UNLESS
          if (ctx.resolve(a1)) return false;
          break;
        case 2: // XH_TEXT
          var tv = ctx.resolve(a1);
          el.textContent = tv != null ? (typeof tv === "string" ? tv : String(tv)) : "";
          break;
        case 3: // XH_HTML
          if (!config.cspSafe) {
            var hv = ctx.resolve(a1);
            el.innerHTML = hv != null ? String(hv) : "";
          }
          break;
        case 4: // XH_SHOW
          el.style.display = ctx.resolve(a1) ? "" : "none";
          break;
        case 5: // XH_HIDE
          el.style.display = ctx.resolve(a1) ? "none" : "";
          break;
        case 6: // XH_ATTR
          var av = ctx.resolve(a2);
          if (av != null) el.setAttribute(a1, String(av));
          break;
        case 7: // XH_CLASS
          if (ctx.resolve(a2)) {
            if (!classes) classes = [a1];
            else classes.push(a1);
          }
          break;
        default:
          // XH_UNKNOWN — set on DOM for compatibility
          el.setAttribute(a1, a2);
          hasUnknown = true;
      }
    }
    if (classes) el.classList.add.apply(el.classList, classes);
    if (hasUnknown) applyBindings(el, ctx);
    return true;
  }

  /**
   * Execute a compiled render plan, building DOM directly via createElement.
   * Avoids cloneNode(true) overhead.
   */
  function executePlan(plan, ctx) {
    var frag = document.createDocumentFragment();
    var isMutable = ctx instanceof MutableDataContext;
    for (var i = 0; i < plan.length; i++) {
      _execPlanNode(frag, plan[i], ctx, false, isMutable);
    }
    return frag;
  }

  function _execPlanNode(parent, node, ctx, markProcessed, isMutable) {
    if (node.t === 2) { // static text
      parent.appendChild(document.createTextNode(node.v));
      return;
    }
    if (node.t === 3) { // interpolated text
      var tnode = document.createTextNode(interpolate(node.v, ctx, false));
      tnode._xhTpl = node.v;
      parent.appendChild(tnode);
      return;
    }
    if (node.t === 4) { // xh-each
      var arr = ctx.resolve(node.eachAttr);
      if (!Array.isArray(arr)) return;
      var EachCtx = isMutable ? MutableDataContext : DataContext;
      if (arr.length > config.batchThreshold && typeof requestAnimationFrame === "function") {
        var batchSize = config.batchThreshold;
        for (var ei = 0; ei < Math.min(batchSize, arr.length); ei++) {
          _renderPlanEachItem(arr[ei], ei, parent, EachCtx, ctx, node.itemPlan);
        }
        var offset = batchSize;
        var parentRef = parent;
        var itemPlanRef = node.itemPlan;
        function _planBatchInner() {
          var end = Math.min(offset + batchSize, arr.length);
          for (var rb = offset; rb < end; rb++) {
            _renderPlanEachItem(arr[rb], rb, parentRef, EachCtx, ctx, itemPlanRef);
          }
          offset = end;
          if (offset < arr.length) requestAnimationFrame(_planBatchInner);
        }
        if (offset < arr.length) requestAnimationFrame(_planBatchInner);
      } else {
        for (var ei2 = 0; ei2 < arr.length; ei2++) {
          _renderPlanEachItem(arr[ei2], ei2, parent, EachCtx, ctx, node.itemPlan);
        }
      }
      return;
    }
    // Element node (t === 1)
    var xh = node.xh;

    // Fast path: check xh-if/xh-unless BEFORE creating children or element attrs
    if (xh && !isMutable) {
      for (var pre = 0; pre < xh.length; pre += 3) {
        if (xh[pre] === XH_IF) { if (!ctx.resolve(xh[pre + 1])) return; }
        else if (xh[pre] === XH_UNLESS) { if (ctx.resolve(xh[pre + 1])) return; }
      }
    }

    var el = document.createElement(node.tag);
    // Set static attributes (no interpolation needed — pre-split at compile time)
    var sa = node.attrs;
    if (sa) {
      for (var i = 0; i < sa.length; i += 2) {
        el.setAttribute(sa[i], sa[i + 1]);
      }
    }
    // Set interpolated attributes
    var ia = node.iAttrs;
    if (ia) {
      for (var ii = 0; ii < ia.length; ii += 2) {
        el.setAttribute(ia[ii], interpolate(ia[ii + 1], ctx, false));
      }
    }
    // Skip children if xh-text/xh-html will overwrite them
    var ch = node.children;
    if (ch && !node.skipCh) {
      for (var k = 0; k < ch.length; k++) {
        _execPlanNode(el, ch[k], ctx, markProcessed, isMutable);
      }
    }
    // Apply bindings
    if (xh) {
      if (!isMutable) {
        // Fast path: apply bindings directly from plan array (no DOM round-trip)
        var kept = _applyPlanBindings(el, xh, ctx);
        if (kept === false) return;
      } else {
        // Mutable path: reconstitute attrs on DOM for reactive subscriptions
        for (var j = 0; j < xh.length; j += 3) {
          switch (xh[j]) {
            case XH_IF: el.setAttribute("xh-if", xh[j+1]); break;
            case XH_UNLESS: el.setAttribute("xh-unless", xh[j+1]); break;
            case XH_TEXT: el.setAttribute("xh-text", xh[j+1]); break;
            case XH_HTML: el.setAttribute("xh-html", xh[j+1]); break;
            case XH_SHOW: el.setAttribute("xh-show", xh[j+1]); break;
            case XH_HIDE: el.setAttribute("xh-hide", xh[j+1]); break;
            case XH_ATTR: el.setAttribute("xh-attr-" + xh[j+1], xh[j+2]); break;
            case XH_CLASS: el.setAttribute("xh-class-" + xh[j+1], xh[j+2]); break;
            case XH_ON: el.setAttribute("xh-on-" + xh[j+1], xh[j+2]); break;
            case XH_TRACK: el.setAttribute("xh-track", xh[j+1]); break;
            case XH_TRACK_VIEW: el.setAttribute("xh-track-view", xh[j+1]); break;
            default: el.setAttribute(xh[j+1], xh[j+2]); break;
          }
        }
        var kept2 = applyBindings(el, ctx);
        if (kept2 === false) return;
      }
      if (markProcessed) {
        for (var m = 0; m < xh.length; m += 3) {
          if (xh[m] === XH_ON) {
            attachOnHandler(el, xh[m + 1], xh[m + 2]);
          } else if (xh[m] === XH_TRACK) {
            el.setAttribute("xh-track", xh[m + 1]);
            setupTrack(el, ctx);
          } else if (xh[m] === XH_TRACK_VIEW) {
            el.setAttribute("xh-track-view", xh[m + 1]);
            setupTrackView(el, ctx);
          }
        }
        elementStates.set(el, PROCESSED_STATE);
      }
    }
    parent.appendChild(el);
  }

  /**
   * Execute a single element plan node and return the created element.
   * Used for xh-each item rendering.
   */
  function execElementPlan(plan, ctx) {
    var xh = plan.xh;
    var isMutable = ctx instanceof MutableDataContext;

    // Fast path: check xh-if/xh-unless BEFORE creating element or children
    if (xh && !isMutable) {
      for (var pre = 0; pre < xh.length; pre += 3) {
        if (xh[pre] === XH_IF) { if (!ctx.resolve(xh[pre + 1])) return null; }
        else if (xh[pre] === XH_UNLESS) { if (ctx.resolve(xh[pre + 1])) return null; }
      }
    }

    var el = document.createElement(plan.tag);
    // Set static attributes (no interpolation needed — pre-split at compile time)
    var sa = plan.attrs;
    if (sa) {
      for (var i = 0; i < sa.length; i += 2) {
        el.setAttribute(sa[i], sa[i + 1]);
      }
    }
    // Set interpolated attributes
    var ia = plan.iAttrs;
    if (ia) {
      for (var ii = 0; ii < ia.length; ii += 2) {
        el.setAttribute(ia[ii], interpolate(ia[ii + 1], ctx, false));
      }
    }
    // Skip children if xh-text/xh-html will overwrite them
    // markProcessed=true because xh-each items must not be re-processed by processNode
    var ch = plan.children;
    if (ch && !plan.skipCh) {
      for (var k = 0; k < ch.length; k++) {
        _execPlanNode(el, ch[k], ctx, true, isMutable);
      }
    }
    // Apply bindings
    if (xh) {
      if (!isMutable) {
        var kept = _applyPlanBindings(el, xh, ctx);
        if (kept === false) return null;
      } else {
        // Mutable path: reconstitute attrs on DOM for reactive subscriptions
        for (var j = 0; j < xh.length; j += 3) {
          switch (xh[j]) {
            case XH_IF: el.setAttribute("xh-if", xh[j+1]); break;
            case XH_UNLESS: el.setAttribute("xh-unless", xh[j+1]); break;
            case XH_TEXT: el.setAttribute("xh-text", xh[j+1]); break;
            case XH_HTML: el.setAttribute("xh-html", xh[j+1]); break;
            case XH_SHOW: el.setAttribute("xh-show", xh[j+1]); break;
            case XH_HIDE: el.setAttribute("xh-hide", xh[j+1]); break;
            case XH_ATTR: el.setAttribute("xh-attr-" + xh[j+1], xh[j+2]); break;
            case XH_CLASS: el.setAttribute("xh-class-" + xh[j+1], xh[j+2]); break;
            case XH_ON: el.setAttribute("xh-on-" + xh[j+1], xh[j+2]); break;
            case XH_TRACK: el.setAttribute("xh-track", xh[j+1]); break;
            case XH_TRACK_VIEW: el.setAttribute("xh-track-view", xh[j+1]); break;
            default: el.setAttribute(xh[j+1], xh[j+2]); break;
          }
        }
        var kept2 = applyBindings(el, ctx);
        if (kept2 === false) return null;
      }
    }
    return el;
  }

  /**
   * Analyze a prototype container for xh-each and REST verb presence.
   * Used to enable fast paths that skip unnecessary per-element checks.
   */
  function analyzePrototype(container) {
    var hasEach = false, hasRest = false;
    var tw = document.createTreeWalker(container, 1 /* SHOW_ELEMENT */);
    while (tw.nextNode()) {
      var el = tw.currentNode;
      if (!hasEach && el.hasAttribute("xh-each")) hasEach = true;
      if (!hasRest) {
        for (var r = 0; r < REST_VERBS.length; r++) {
          if (el.hasAttribute(REST_VERBS[r])) { hasRest = true; break; }
        }
      }
      if (hasEach && hasRest) break;
    }
    return { hasEach: hasEach, hasRest: hasRest };
  }

  function renderTemplate(html, ctx) {
    // 1. Parse into fragment, using a cache to avoid re-parsing the same HTML
    //    string on every call.  The cache stores a pristine (un-interpolated)
    //    prototype DOM plus the pre-built CSS selector for xh-* elements.
    var cached = renderFragmentCache.get(html);
    var container, targetedSelector, hasInterp, hasEach, hasRest;

    if (cached) {
      // Compiled plan path: build DOM directly via createElement (no cloneNode)
      if (cached.plan) {
        return executePlan(cached.plan, ctx);
      }
      // Fallback: clone the pristine prototype — avoids HTML parsing entirely
      container = cached.prototype.cloneNode(true);
      targetedSelector = cached.selector;
      hasInterp = cached.hasInterp;
      hasEach = cached.hasEach;
      hasRest = cached.hasRest;
    } else {
      // Slow path: first time seeing this HTML string — parse it
      container = document.createElement("div");

      var parsedFragment;
      if (config.cspSafe) {
        var parser = new DOMParser();
        var doc = parser.parseFromString("<body>" + html + "</body>", "text/html");
        parsedFragment = document.createDocumentFragment();
        var children = Array.prototype.slice.call(doc.body.childNodes);
        for (var c = 0; c < children.length; c++) {
          parsedFragment.appendChild(document.importNode(children[c], true));
        }
      } else {
        var tpl = document.createElement("template");
        tpl.innerHTML = html;
        parsedFragment = document.importNode(tpl.content, true);
      }
      container.appendChild(parsedFragment);

      // Build selector once from the pristine DOM (also registers dynamic attrs globally)
      targetedSelector = buildCloneSelector(container);
      hasInterp = html.indexOf("{{") !== -1;

      // Analyze for fast-path eligibility
      var analysis = analyzePrototype(container);
      hasEach = analysis.hasEach;
      hasRest = analysis.hasRest;

      // Compile a render plan (supports xh-each; bails out for REST verbs
      // or complex xh-each that can't be plan-compiled)
      var plan = !hasRest ? compileRenderPlan(container) : null;

      // Cache the pristine prototype before any data-dependent mutations
      if (renderFragmentCache.size >= RENDER_FRAGMENT_CACHE_MAX) {
        renderFragmentCache.delete(renderFragmentCache.keys().next().value);
      }
      renderFragmentCache.set(html, {
        prototype: container.cloneNode(true),
        selector: targetedSelector,
        hasInterp: hasInterp,
        hasEach: hasEach,
        hasRest: hasRest,
        plan: plan
      });

      // Use the plan immediately on first call too
      if (plan) {
        return executePlan(plan, ctx);
      }
    }

    // 2. Process directives in the (possibly cloned) fragment

    // 2a. Interpolate {{field}} in text nodes and attributes.
    if (hasInterp) {
      interpolateDOM(container, ctx);
    }

    // -----------------------------------------------------------------------
    // General path: templates with xh-each and/or REST verbs (no plan available)
    // -----------------------------------------------------------------------
    var allEls = Array.prototype.slice.call(container.querySelectorAll(targetedSelector));
    var eachEls = [];
    var bindEls = [];

    for (var p = 0; p < allEls.length; p++) {
      if (allEls[p].hasAttribute("xh-each")) {
        eachEls.push(allEls[p]);
      } else {
        bindEls.push(allEls[p]);
      }
    }

    // Process xh-each first (top-level only, they handle their own children).
    var eachSet = new Set(eachEls);
    for (var i = 0; i < eachEls.length; i++) {
      if (!eachEls[i].parentNode) continue;
      var isNested = false;
      var check = eachEls[i].parentNode;
      while (check && check !== container) {
        if (eachSet.has(check)) { isNested = true; break; }
        check = check.parentNode;
      }
      if (!isNested) {
        processEach(eachEls[i], ctx, targetedSelector);
      }
    }

    // Process other bindings
    for (var j = 0; j < bindEls.length; j++) {
      if (!bindEls[j].parentNode) continue;
      if (hasRest && getRestVerb(bindEls[j])) continue;
      if (hasEach) {
        // Walk up to check if inside an xh-each item (WeakSet replaces DOM attribute)
        var inEach = false;
        var p = bindEls[j];
        while (p && p !== container) {
          if (eachItemSet.has(p)) { inEach = true; break; }
          p = p.parentNode;
        }
        if (inEach) continue;
      }
      applyBindings(bindEls[j], ctx);
    }

    var resultFragment = document.createDocumentFragment();
    while (container.firstChild) resultFragment.appendChild(container.firstChild);
    return resultFragment;
  }

  // ---------------------------------------------------------------------------
  // Settle class helpers
  // ---------------------------------------------------------------------------

  /**
   * Apply settle classes to newly inserted elements.
   * Adds "xh-added" immediately, then swaps to "xh-settled" after two
   * animation frames so that CSS transitions can react.
   *
   * @param {Element} processTarget – The container of new elements.
   */
  /**
   * Mark top-level element children in a DocumentFragment as owned by xhtmlx
   * so that MutationObserver skips them (they'll be processed via processNode
   * with the correct data context instead of the root context).
   *
   * Only top-level children need marking because the MutationObserver receives
   * them as addedNodes and checks data-xh-owned on each one directly.
   */
  function markFragmentOwned(fragment) {
    if (!fragment) return;
    var children = fragment.childNodes;
    for (var i = 0; i < children.length; i++) {
      if (children[i].nodeType === 1 && children[i].setAttribute) {
        children[i].setAttribute("data-xh-owned", "");
      }
    }
  }

  function applySettleClasses(processTarget) {
    if (!processTarget) return;
    // Only apply settle classes to the target and its direct children,
    // not every descendant — CSS transitions typically target top-level elements.
    var newEls = [];
    if (processTarget.classList) newEls.push(processTarget);
    if (processTarget.children) {
      for (var c = 0; c < processTarget.children.length; c++) {
        newEls.push(processTarget.children[c]);
      }
    }

    for (var se = 0; se < newEls.length; se++) {
      newEls[se].classList.add("xh-added");
    }

    var raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : function(fn) { setTimeout(fn, 16); };
    raf(function () {
      raf(function () {
        for (var sf = 0; sf < newEls.length; sf++) {
          if (newEls[sf].classList) {
            newEls[sf].classList.remove("xh-added");
            newEls[sf].classList.add("xh-settled");
          }
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Retry with backoff helper
  // ---------------------------------------------------------------------------

  /**
   * Fetch with automatic retry on 5xx errors and network failures.
   *
   * @param {string}  url       – Request URL.
   * @param {Object}  opts      – Fetch options.
   * @param {number}  retries   – Maximum number of retries.
   * @param {number}  delay     – Base delay in ms (doubled each attempt).
   * @param {number}  attempt   – Current attempt (0-based).
   * @param {Element} el        – Element for emitting events.
   * @returns {Promise<Response>}
   */
  function fetchWithRetry(url, opts, retries, delay, attempt, el) {
    return fetch(url, opts).then(function (response) {
      if (!response.ok && response.status >= 500 && attempt < retries) {
        emitEvent(el, "xh:retry", { attempt: attempt + 1, maxRetries: retries, status: response.status }, false);
        return new Promise(function (resolve) {
          setTimeout(function () {
            resolve(fetchWithRetry(url, opts, retries, delay, attempt + 1, el));
          }, delay * Math.pow(2, attempt));
        });
      }
      return response;
    }).catch(function (err) {
      if (attempt < retries) {
        emitEvent(el, "xh:retry", { attempt: attempt + 1, maxRetries: retries, error: err.message }, false);
        return new Promise(function (resolve) {
          setTimeout(function () {
            resolve(fetchWithRetry(url, opts, retries, delay, attempt + 1, el));
          }, delay * Math.pow(2, attempt));
        });
      }
      throw err;
    });
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  // Cache compiled validation regexes by pattern string
  var validationRegexCache = {};

  /**
   * Validate fields within the scope of an element.
   * Looks for [xh-validate] elements in the form or element scope and checks
   * rules: required, pattern, min/max, minlength/maxlength.
   *
   * @param {Element} el – The element that triggered the request.
   * @returns {boolean} true if all valid, false if errors found.
   */
  function validateElement(el) {
    var scope = el.tagName.toLowerCase() === "form" ? el : el.closest("form") || el;
    var fields = scope.querySelectorAll("[xh-validate]");
    var errors = [];

    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      var rules = field.getAttribute("xh-validate").split(" ");
      var value = field.value || "";
      var fieldName = field.getAttribute("name") || field.getAttribute("xh-model") || "field";
      var customMsg = field.getAttribute("xh-validate-message");
      var errorClass = field.getAttribute("xh-validate-class") || "xh-invalid";
      var errorTarget = field.getAttribute("xh-validate-target");
      var error = null;

      for (var r = 0; r < rules.length; r++) {
        var rule = rules[r];
        if (rule === "required" && !value.trim()) {
          error = customMsg || fieldName + " is required";
        }
      }

      // xh-validate-pattern
      var pattern = field.getAttribute("xh-validate-pattern");
      if (pattern && value) {
        if (!validationRegexCache[pattern]) validationRegexCache[pattern] = new RegExp(pattern);
      }
      if (pattern && value && !validationRegexCache[pattern].test(value)) {
        error = customMsg || fieldName + " format is invalid";
      }

      // xh-validate-min / xh-validate-max
      var min = field.getAttribute("xh-validate-min");
      var max = field.getAttribute("xh-validate-max");
      if (min != null && Number(value) < Number(min)) {
        error = customMsg || fieldName + " must be at least " + min;
      }
      if (max != null && Number(value) > Number(max)) {
        error = customMsg || fieldName + " must be at most " + max;
      }

      // xh-validate-minlength / xh-validate-maxlength
      var minlen = field.getAttribute("xh-validate-minlength");
      var maxlen = field.getAttribute("xh-validate-maxlength");
      if (minlen != null && value.length < Number(minlen)) {
        error = customMsg || fieldName + " must be at least " + minlen + " characters";
      }
      if (maxlen != null && value.length > Number(maxlen)) {
        error = customMsg || fieldName + " must be at most " + maxlen + " characters";
      }

      if (error) {
        field.classList.add(errorClass);
        if (errorTarget) {
          var tgt = document.querySelector(errorTarget);
          if (tgt) tgt.textContent = error;
        }
        errors.push({ field: fieldName, message: error, element: field });
      } else {
        field.classList.remove(errorClass);
        if (errorTarget) {
          var tgt2 = document.querySelector(errorTarget);
          if (tgt2) tgt2.textContent = "";
        }
      }
    }

    if (errors.length > 0) {
      emitEvent(el, "xh:validationError", { errors: errors }, false);
      return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Main request handler
  // ---------------------------------------------------------------------------

  /**
   * Execute a REST request triggered by an element.
   *
   * @param {Element}     el
   * @param {DataContext}  ctx
   * @param {string[]}    templateStack – For circular template detection.
   */
  function executeRequest(el, ctx, templateStack) {
    var restInfo = getRestVerb(el);
    if (!restInfo) return;

    // Increment generation counter to handle stale responses
    var gen = (generationMap.get(el) || 0) + 1;
    generationMap.set(el, gen);

    // -- Request deduplication: skip if already in-flight ---------------------
    var state = elementStates.get(el);
    if (state && state.requestInFlight) {
      if (config.debug) console.warn("[xhtmlx] request already in-flight, skipping");
      return;
    }

    // Mark request in-flight
    if (state) state.requestInFlight = true;

    // Interpolate URL with URI encoding, prepend API prefix for versioning
    var url = interpolate(restInfo.url, ctx, true);
    if (config.apiPrefix && url.indexOf("://") === -1) {
      url = config.apiPrefix + url;
    }

    // Build fetch options
    var fetchOpts = { method: restInfo.verb, headers: {} };

    // Custom headers
    var customHeaders = parseHeaders(el, ctx);
    for (var h in customHeaders) {
      if (customHeaders.hasOwnProperty(h)) {
        fetchOpts.headers[h] = customHeaders[h];
      }
    }

    // Request body for POST/PUT/PATCH
    if (restInfo.verb === "POST" || restInfo.verb === "PUT" || restInfo.verb === "PATCH") {
      fetchOpts.headers["Content-Type"] = fetchOpts.headers["Content-Type"] || "application/json";
      fetchOpts.body = buildRequestBody(el, ctx);
    }

    // Run global plugin hooks before request
    var hookAllowed = runHooks("beforeRequest", {
      url: url, method: restInfo.verb, headers: fetchOpts.headers, element: el
    });
    if (!hookAllowed) {
      if (state) state.requestInFlight = false;
      return;
    }

    // Emit xh:beforeRequest (cancelable)
    var allowed = emitEvent(el, "xh:beforeRequest", {
      url: url,
      method: restInfo.verb,
      headers: fetchOpts.headers
    }, true);
    if (!allowed) {
      if (state) state.requestInFlight = false;
      return;
    }

    // Validate before sending
    if (!validateElement(el)) {
      if (state) state.requestInFlight = false;
      return;
    }

    // Show indicator
    var indicatorEl = showIndicator(el);

    // Accessibility: mark target as busy
    var ariaTarget = getSwapTarget(el, false);
    if (ariaTarget) ariaTarget.setAttribute("aria-busy", "true");

    // xh-disabled-class: add CSS class while request is in-flight
    var disabledClass = el.getAttribute("xh-disabled-class");
    if (disabledClass) {
      el.classList.add(disabledClass);
      el.setAttribute("aria-disabled", "true");
    }

    // -- Response caching (xh-cache) ------------------------------------------
    var cacheAttr = el.getAttribute("xh-cache");
    var cacheKey = restInfo.verb + ":" + url;

    if (cacheAttr && restInfo.verb === "GET") {
      var cached = responseCache.get(cacheKey);
      if (cached) {
        var age = Date.now() - cached.timestamp;
        var ttl = cacheAttr === "forever" ? Infinity : parseInt(cacheAttr, 10) * 1000;
        if (age < ttl) {
          // Use cached parsed JSON directly — avoids JSON.parse on every cache hit
          processJsonData(cached.data);
          return;
        }
        responseCache.delete(cacheKey);
      }
    }

    // -- Retry with backoff (xh-retry) ----------------------------------------
    var retryAttr = el.getAttribute("xh-retry");
    var retryCount = retryAttr ? parseInt(retryAttr, 10) : 0;
    var retryDelayAttr = el.getAttribute("xh-retry-delay");
    var retryDelay = retryDelayAttr ? parseInt(retryDelayAttr, 10) : 1000;

    var fetchPromise = retryCount > 0
      ? fetchWithRetry(url, fetchOpts, retryCount, retryDelay, 0, el)
      : fetch(url, fetchOpts);

    // Track request start time for auto-analytics
    var requestStartTime = config.trackRequests ? Date.now() : 0;
    var trackResponseStatus = 0;

    fetchPromise
      .then(function (response) {
        trackResponseStatus = response.status;
        return processFetchResponse(response);
      })
      .catch(function (err) {
        console.error("[xhtmlx] request failed:", url, err);
        handleError(el, ctx, 0, "Network Error", err.message, templateStack);
      })
      .finally(function () {
        hideIndicator(el, indicatorEl);
        if (ariaTarget) ariaTarget.removeAttribute("aria-busy");
        if (disabledClass) {
          el.classList.remove(disabledClass);
          el.removeAttribute("aria-disabled");
        }
        if (state) state.requestInFlight = false;

        // Auto-track REST requests when enabled
        if (config.trackRequests && analyticsHandlers.length > 0) {
          sendAnalytics("xh:request", {
            method: restInfo.verb,
            url: url,
            status: trackResponseStatus,
            duration: Date.now() - requestStartTime
          }, el);
        }
      });

    function processJsonData(jsonData) {
      var childCtx = new MutableDataContext(jsonData, ctx);

      // Resolve and render template
      return resolveTemplate(el, templateStack).then(function (tmpl) {
        var swapMode = el.getAttribute("xh-swap") || config.defaultSwapMode;
        var target = getSwapTarget(el, false);

        if (tmpl.html !== null) {
          // Render from template HTML
          var fragment = renderTemplate(tmpl.html, childCtx);

          // Emit xh:beforeSwap (cancelable)
          var swapAllowed = emitEvent(el, "xh:beforeSwap", {
            target: target,
            fragment: fragment,
            swapMode: swapMode
          }, true);
          if (!swapAllowed) return;

          // Mark fragment children so MutationObserver skips them
          markFragmentOwned(fragment);
          var processTarget = performSwap(target, fragment, swapMode);

          // Apply settle classes to newly added elements
          applySettleClasses(processTarget);

          // Recursively process new content with correct data context
          if (processTarget) {
            processNode(processTarget, childCtx, tmpl.templateStack);
          }

          // Emit xh:afterSwap
          emitEvent(el, "xh:afterSwap", { target: target }, false);

          // -- xh-focus: focus management after swap ----------------------------
          var focusEl = el.getAttribute("xh-focus");
          if (focusEl && focusEl !== "auto") {
            var toFocus = document.querySelector(focusEl);
            if (toFocus) toFocus.focus();
          } else if (focusEl === "auto" && processTarget) {
            var focusable = processTarget.querySelector("a, button, input, select, textarea, [tabindex]");
            if (focusable) focusable.focus();
          }

        } else {
          // Self-binding: apply bindings directly to the element
          applyBindings(el, childCtx);

          // Also process children for bindings
          processBindingsInTree(el, childCtx);

          // Emit swap events
          emitEvent(el, "xh:afterSwap", { target: el }, false);
        }

        // -- xh-push-url -------------------------------------------------------
        var pushUrl = el.getAttribute("xh-push-url");
        if (pushUrl) {
          var historyUrl = pushUrl === "true" ? url : interpolate(pushUrl, childCtx, false);
          var historyState = {
            xhtmlx: true,
            url: restInfo.url,
            verb: restInfo.verb,
            targetSel: el.getAttribute("xh-target"),
            templateUrl: el.getAttribute("xh-template")
          };
          history.pushState(historyState, "", historyUrl);
        }

        // -- xh-replace-url ----------------------------------------------------
        var replaceUrl = el.getAttribute("xh-replace-url");
        if (replaceUrl) {
          var rUrl = replaceUrl === "true" ? url : interpolate(replaceUrl, childCtx, false);
          history.replaceState({ xhtmlx: true }, "", rUrl);
        }

        // Store data context and URLs for reload/versioning
        if (state) {
          state.dataContext = childCtx;
          state.templateUrl = el.getAttribute("xh-template");
          state.apiUrl = restInfo.url;
          state.apiVerb = restInfo.verb;
        }
      });
    }

    function processFetchResponse(response) {
      // Emit xh:afterRequest
      emitEvent(el, "xh:afterRequest", { url: url, status: response.status }, false);

      // Stale response check
      if (generationMap.get(el) !== gen) {
        if (config.debug) console.warn("[xhtmlx] discarding stale response for", url);
        return;
      }

      if (!response.ok) {
        // Error path
        return response.text().then(function (bodyText) {
          var errorBody;
          try {
            errorBody = JSON.parse(bodyText);
          } catch (_) {
            errorBody = bodyText;
          }
          handleError(el, ctx, response.status, response.statusText, errorBody, templateStack);
        });
      }

      // Success path — parse JSON
      return response.text().then(function (bodyText) {
        var jsonData;
        if (bodyText.trim() === "") {
          jsonData = {};
        } else {
          try {
            jsonData = JSON.parse(bodyText);
          } catch (e) {
            console.error("[xhtmlx] invalid JSON response from", url, e);
            handleError(el, ctx, response.status, "Invalid JSON", bodyText, templateStack);
            return;
          }
        }

        // Cache the parsed JSON if xh-cache is set (avoids re-parsing on cache hits)
        if (cacheAttr && restInfo.verb === "GET" && bodyText) {
          if (responseCache.size >= RESPONSE_CACHE_MAX) {
            // Evict oldest half (Map preserves insertion order)
            var toEvict = RESPONSE_CACHE_MAX >> 1;
            var rcIter = responseCache.keys();
            for (var rc = 0; rc < toEvict; rc++) {
              responseCache.delete(rcIter.next().value);
            }
          }
          responseCache.set(cacheKey, { data: jsonData, timestamp: Date.now() });
        }

        return processJsonData(jsonData);
      });
    }
  }

  /**
   * Handle an error response: resolve error template, render, and swap.
   *
   * @param {Element}     el
   * @param {DataContext}  ctx
   * @param {number}       status
   * @param {string}       statusText
   * @param {*}            body
   * @param {string[]}     templateStack
   */
  function handleError(el, ctx, status, statusText, body, templateStack) {
    var errorData = { status: status, statusText: statusText, body: body };
    var errorCtx = new DataContext(errorData, ctx);

    // Emit xh:responseError
    emitEvent(el, "xh:responseError", errorData, false);

    // Resolve error template (returns {template, boundary} or null)
    var errorResult = resolveErrorTemplate(el, status);

    if (!errorResult) {
      // No error template — just add error class
      el.classList.add(config.errorClass);
      return;
    }

    // Fetch and render error template
    fetchTemplate(errorResult.template)
      .then(function (html) {
        var fragment = renderTemplate(html, errorCtx);
        // Pass cached boundary to avoid redundant DOM walk
        var errorTarget = getSwapTarget(el, true, status, errorResult.boundary);
        var swapMode = el.getAttribute("xh-swap") || config.defaultSwapMode;

        var swapAllowed = emitEvent(el, "xh:beforeSwap", {
          target: errorTarget,
          fragment: fragment,
          swapMode: swapMode,
          isError: true
        }, true);
        if (!swapAllowed) return;

        markFragmentOwned(fragment);
        var processTarget = performSwap(errorTarget, fragment, swapMode);

        // Apply settle classes to newly added error elements
        applySettleClasses(processTarget);

        if (processTarget) {
          processNode(processTarget, errorCtx, templateStack);
        }

        // Accessibility: mark error container with role="alert"
        errorTarget.setAttribute("role", "alert");

        el.classList.add(config.errorClass);
        emitEvent(el, "xh:afterSwap", { target: errorTarget, isError: true }, false);
      })
      .catch(function (err) {
        console.error("[xhtmlx] error template fetch failed:", err);
        el.classList.add(config.errorClass);
      });
  }

  // ---------------------------------------------------------------------------
  // Trigger attachment
  // ---------------------------------------------------------------------------

  /**
   * Attach trigger listeners to an element.
   *
   * @param {Element}     el
   * @param {DataContext}  ctx
   * @param {string[]}     templateStack
   */
  function attachTriggers(el, ctx, templateStack) {
    var triggerAttr = el.getAttribute("xh-trigger");
    var specs;

    if (triggerAttr) {
      specs = parseTrigger(triggerAttr);
    } else {
      // Use default trigger
      specs = [{ event: defaultTrigger(el), delay: 0, throttle: 0, once: false, changed: false, from: null, interval: 0 }];
    }

    var state = elementStates.get(el) || {};
    state.triggerSpecs = specs;
    state.intervalIds = state.intervalIds || [];
    state.observers = state.observers || [];
    state.processed = true;
    elementStates.set(el, state);

    for (var i = 0; i < specs.length; i++) {
      attachSingleTrigger(el, ctx, templateStack, specs[i], state);
    }
  }

  // ---------------------------------------------------------------------------
  // Global resize handler — single listener delegates to all registered elements
  // ---------------------------------------------------------------------------
  var resizeElements = [];
  var resizeElementSet = new WeakSet();
  var resizeGlobalTimer = null;
  var resizeGlobalDelay = 300;
  var resizeListenerAttached = false;

  function globalResizeHandler() {
    // Invalidate viewport cache immediately so synchronous reads are fresh
    _vpCache = null;
    clearTimeout(resizeGlobalTimer);
    resizeGlobalTimer = setTimeout(function() {
      // Check for breakpoint changes (merged — avoids a second resize listener)
      checkBreakpointChange();
      for (var i = resizeElements.length - 1; i >= 0; i--) {
        var entry = resizeElements[i];
        // Skip elements no longer in DOM
        if (!entry.el.parentNode) {
          resizeElements.splice(i, 1);
          continue;
        }
        executeRequest(entry.el, entry.ctx, entry.templateStack);
      }
    }, resizeGlobalDelay);
  }

  function registerResizeElement(el, ctx, templateStack, delay) {
    // Prevent duplicates with O(1) check
    if (resizeElementSet.has(el)) return;
    resizeElementSet.add(el);
    resizeElements.push({ el: el, ctx: ctx, templateStack: templateStack });
    if (delay < resizeGlobalDelay) resizeGlobalDelay = delay;
    if (!resizeListenerAttached && typeof window !== "undefined") {
      window.addEventListener("resize", globalResizeHandler);
      resizeListenerAttached = true;
    }
  }

  /**
   * Attach a single trigger spec to an element.
   */
  function attachSingleTrigger(el, ctx, templateStack, spec, state) {
    // --- "load" trigger: fire immediately -------------------------------------
    if (spec.event === "load") {
      executeRequest(el, ctx, templateStack);
      return;
    }

    // --- "every Ns" trigger: set an interval ---------------------------------
    if (spec.event === "every" && spec.interval > 0) {
      var intervalId = setInterval(function () {
        executeRequest(el, ctx, templateStack);
      }, spec.interval);
      state.intervalIds.push(intervalId);
      return;
    }

    // --- "revealed" trigger: IntersectionObserver -----------------------------
    if (spec.event === "revealed") {
      var observer = new IntersectionObserver(function (entries) {
        for (var e = 0; e < entries.length; e++) {
          if (entries[e].isIntersecting) {
            executeRequest(el, ctx, templateStack);
            if (spec.once) observer.disconnect();
          }
        }
      }, { threshold: 0.1 });
      observer.observe(el);
      state.observers.push(observer);
      return;
    }

    // --- "resize" trigger: single global handler, delegates to registered elements
    if (spec.event === "resize") {
      registerResizeElement(el, ctx, templateStack, spec.delay || 300);
      return;
    }

    // --- Standard DOM event trigger ------------------------------------------
    var listenTarget = el;
    if (spec.from) {
      var fromEl = document.querySelector(spec.from);
      if (fromEl) {
        listenTarget = fromEl;
      } else if (config.debug) {
        console.warn("[xhtmlx] from: selector not found:", spec.from);
      }
    }

    // Build the handler with optional modifiers
    var handler = buildHandler(el, ctx, templateStack, spec);

    var eventOptions = spec.once ? { once: true } : false;
    listenTarget.addEventListener(spec.event, handler, eventOptions);
  }

  /**
   * Build an event handler function incorporating delay, throttle, and changed
   * modifiers.
   */
  function buildHandler(el, ctx, templateStack, spec) {
    var lastValue = undefined;
    var delayTimer = null;
    var throttleTimer = null;
    var throttlePending = false;

    return function (evt) {
      // Prevent default for forms
      if (spec.event === "submit") {
        evt.preventDefault();
      }

      // "changed" modifier — only fire if value changed
      if (spec.changed) {
        var currentValue;
        var source = evt.target || el;
        if ("value" in source) {
          currentValue = source.value;
        } else {
          currentValue = source.textContent;
        }
        if (currentValue === lastValue) return;
        lastValue = currentValue;
      }

      var fire = function () {
        executeRequest(el, ctx, templateStack);
      };

      // "delay" modifier — debounce
      if (spec.delay > 0) {
        if (delayTimer) clearTimeout(delayTimer);
        delayTimer = setTimeout(fire, spec.delay);
        return;
      }

      // "throttle" modifier
      if (spec.throttle > 0) {
        if (throttleTimer) {
          throttlePending = true;
          return;
        }
        fire();
        throttleTimer = setTimeout(function () {
          throttleTimer = null;
          if (throttlePending) {
            throttlePending = false;
            fire();
          }
        }, spec.throttle);
        return;
      }

      fire();
    };
  }

  // ---------------------------------------------------------------------------
  // WebSocket support
  // ---------------------------------------------------------------------------

  function setupWebSocket(el, ctx, templateStack) {
    var wsUrl = el.getAttribute("xh-ws");
    if (!wsUrl) return;

    var ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      console.error("[xhtmlx] WebSocket connection failed:", wsUrl, e);
      return;
    }

    var state = elementStates.get(el) || {};
    state.ws = ws;
    elementStates.set(el, state);

    ws.addEventListener("message", function(event) {
      var jsonData;
      try {
        jsonData = JSON.parse(event.data);
      } catch (e) {
        if (config.debug) console.warn("[xhtmlx] WebSocket message is not JSON:", event.data);
        return;
      }

      var childCtx = new DataContext(jsonData, ctx);

      resolveTemplate(el, templateStack).then(function(tmpl) {
        if (tmpl.html !== null) {
          var swapMode = el.getAttribute("xh-swap") || config.defaultSwapMode;
          var target = getSwapTarget(el, false);
          var fragment = renderTemplate(tmpl.html, childCtx);

          var swapAllowed = emitEvent(el, "xh:beforeSwap", {
            target: target, fragment: fragment, swapMode: swapMode
          }, true);
          if (!swapAllowed) return;

          markFragmentOwned(fragment);
          var processTarget = performSwap(target, fragment, swapMode);
          if (processTarget) {
            processNode(processTarget, childCtx, tmpl.templateStack);
          }
          emitEvent(el, "xh:afterSwap", { target: target }, false);
        } else {
          applyBindings(el, childCtx);
          processBindingsInTree(el, childCtx);
        }
      });
    });

    ws.addEventListener("open", function() {
      emitEvent(el, "xh:wsOpen", { url: wsUrl }, false);
    });

    ws.addEventListener("close", function(event) {
      emitEvent(el, "xh:wsClose", { code: event.code, reason: event.reason }, false);
      // Auto-reconnect after 3 seconds if not deliberately closed
      if (event.code !== 1000) {
        setTimeout(function() {
          if (el.parentNode) setupWebSocket(el, ctx, templateStack);
        }, 3000);
      }
    });

    ws.addEventListener("error", function() {
      emitEvent(el, "xh:wsError", { url: wsUrl }, false);
    });
  }

  // For sending messages
  function setupWsSend(el) {
    var sendTarget = el.getAttribute("xh-ws-send");
    if (!sendTarget) return;

    el.addEventListener(el.tagName.toLowerCase() === "form" ? "submit" : "click", function(evt) {
      evt.preventDefault();
      var wsEl = document.querySelector(sendTarget);
      if (!wsEl) return;
      var wsState = elementStates.get(wsEl);
      if (!wsState || !wsState.ws || wsState.ws.readyState !== 1) return;

      var data = {};
      var form = el.tagName.toLowerCase() === "form" ? el : el.closest("form");
      if (form) {
        data = formDataToObject(form);
      }
      var vals = el.getAttribute("xh-vals");
      if (vals) {
        try {
          var parsed = JSON.parse(vals);
          for (var k in parsed) {
            if (parsed.hasOwnProperty(k)) data[k] = parsed[k];
          }
        } catch(e) {
          // ignore invalid JSON
        }
      }
      wsState.ws.send(JSON.stringify(data));
    });
  }

  // ---------------------------------------------------------------------------
  // xh-boost — enhance regular links and forms
  // ---------------------------------------------------------------------------

  function boostElement(container, ctx) {
    // Boost links
    var links = container.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) {
      if (links[i].hasAttribute("xh-get") || links[i].hasAttribute("data-xh-boosted")) continue;
      boostLink(links[i], ctx);
    }

    // Boost forms
    var forms = container.querySelectorAll("form[action]");
    for (var j = 0; j < forms.length; j++) {
      if (getRestVerb(forms[j]) || forms[j].hasAttribute("data-xh-boosted")) continue;
      boostForm(forms[j], ctx);
    }
  }

  function boostLink(link, ctx) {
    var href = link.getAttribute("href");
    if (!href || href.indexOf("#") === 0 || href.indexOf("javascript:") === 0 || href.indexOf("mailto:") === 0 || link.getAttribute("target") === "_blank") return;

    link.setAttribute("data-xh-boosted", "");
    link.addEventListener("click", function(e) {
      e.preventDefault();
      var boostContainer = link.closest("[xh-boost]");
      var boostTarget = boostContainer.getAttribute("xh-boost-target") || "#xh-boost-content";
      var target = document.querySelector(boostTarget);
      if (!target) target = document.body;

      showIndicator(boostContainer);

      fetch(href).then(function(response) {
        return response.text();
      }).then(function(text) {
        var jsonData;
        try {
          jsonData = JSON.parse(text);
        } catch(e) {
          // If not JSON, treat as HTML and swap directly
          cleanupBeforeSwap(target, false);
          target.innerHTML = text;
          processNode(target, ctx, []);
          return;
        }
        var childCtx = new DataContext(jsonData, ctx);
        var templateUrl = boostContainer.getAttribute("xh-boost-template");
        if (templateUrl) {
          fetchTemplate(templateUrl).then(function(html) {
            var fragment = renderTemplate(html, childCtx);
            cleanupBeforeSwap(target, false);
            target.innerHTML = "";
            target.appendChild(fragment);
            processNode(target, childCtx, []);
          });
        } else {
          // Self-bind
          applyBindings(target, childCtx);
          processBindingsInTree(target, childCtx);
        }
      }).finally(function() {
        hideIndicator(boostContainer);
      });

      // Push URL
      if (typeof history !== "undefined" && history.pushState) {
        history.pushState({ xhtmlx: true, url: href }, "", href);
      }
    });
  }

  function boostForm(form, ctx) {
    var action = form.getAttribute("action");
    var method = (form.getAttribute("method") || "GET").toUpperCase();
    if (!action) return;

    form.setAttribute("data-xh-boosted", "");
    form.addEventListener("submit", function(e) {
      e.preventDefault();
      var body = formDataToObject(form);

      var fetchOpts = { method: method, headers: {} };
      if (method !== "GET") {
        fetchOpts.headers["Content-Type"] = "application/json";
        fetchOpts.body = JSON.stringify(body);
      }

      var boostContainer = form.closest("[xh-boost]");
      var boostTarget = boostContainer.getAttribute("xh-boost-target") || "#xh-boost-content";
      var target = document.querySelector(boostTarget);
      if (!target) target = form;

      fetch(action, fetchOpts).then(function(response) {
        return response.text();
      }).then(function(text) {
        var jsonData;
        try { jsonData = JSON.parse(text); } catch(e) { return; }
        var childCtx = new DataContext(jsonData, ctx);
        var templateUrl = boostContainer.getAttribute("xh-boost-template");
        if (templateUrl) {
          fetchTemplate(templateUrl).then(function(html) {
            var fragment = renderTemplate(html, childCtx);
            cleanupBeforeSwap(target, false);
            target.innerHTML = "";
            target.appendChild(fragment);
            processNode(target, childCtx, []);
          });
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Plugin / Extension API
  // ---------------------------------------------------------------------------

  var customDirectives = []; // [{name, handler}]
  var globalHooks = {};      // event -> [handler]
  var transforms = {};       // name -> function

  function registerDirective(name, handler) {
    customDirectives.push({ name: name, handler: handler });
    // Include the custom directive's attribute in targeted selectors
    var sel = "[" + name + "]";
    if (!dynamicAttrSelectors[sel]) {
      dynamicAttrSelectors[sel] = true;
      rebuildDetectSelector();
    }
  }

  function registerHook(event, handler) {
    if (!globalHooks[event]) globalHooks[event] = [];
    globalHooks[event].push(handler);
  }

  function registerTransform(name, fn) {
    transforms[name] = fn;
  }

  function runHooks(event, detail) {
    var hooks = globalHooks[event];
    if (!hooks) return true;
    for (var i = 0; i < hooks.length; i++) {
      var result = hooks[i](detail);
      if (result === false) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------------------

  var analyticsHandlers = [];

  /**
   * Register an analytics handler that receives all tracking events.
   * Multiple handlers can be registered.
   *
   * @param {Function} handler – function(eventName, data)
   */
  function registerAnalytics(handler) {
    if (typeof handler === "function") {
      analyticsHandlers.push(handler);
    }
  }

  /**
   * Send an analytics event to all registered handlers and emit
   * an xh:track CustomEvent on the element.
   *
   * @param {string}  eventName – The tracking event name.
   * @param {Object}  data      – Event metadata.
   * @param {Element} [el]      – Source element (for CustomEvent).
   */
  function sendAnalytics(eventName, data, el) {
    for (var i = 0; i < analyticsHandlers.length; i++) {
      try {
        analyticsHandlers[i](eventName, data);
      } catch (e) {
        if (config.debug) console.error("[xhtmlx] analytics handler error:", e);
      }
    }
    if (el) {
      emitEvent(el, "xh:track", { event: eventName, data: data }, false);
    }
  }

  /**
   * Set up xh-track on an element. Fires an analytics event on the
   * element's natural trigger (click/submit/change).
   *
   * @param {Element}     el
   * @param {DataContext}  ctx
   */
  function setupTrack(el, ctx) {
    var trackEvent = el.getAttribute("xh-track");
    if (!trackEvent) return;

    var triggerEvent = defaultTrigger(el);
    el.addEventListener(triggerEvent, function () {
      var data = { element: el.tagName.toLowerCase() };
      var valsAttr = el.getAttribute("xh-track-vals");
      if (valsAttr) {
        try {
          var interpolated = interpolate(valsAttr, ctx, false);
          var vals = JSON.parse(interpolated);
          for (var k in vals) {
            if (vals.hasOwnProperty(k)) data[k] = vals[k];
          }
        } catch (e) {
          if (config.debug) console.error("[xhtmlx] invalid JSON in xh-track-vals:", valsAttr, e);
        }
      }
      sendAnalytics(trackEvent, data, el);
    });
  }

  /**
   * Set up xh-track-view on an element. Fires an analytics event when
   * the element enters the viewport via IntersectionObserver.
   *
   * @param {Element}     el
   * @param {DataContext}  ctx
   */
  function setupTrackView(el, ctx) {
    var trackEvent = el.getAttribute("xh-track-view");
    if (!trackEvent) return;

    if (typeof IntersectionObserver === "undefined") return;

    var observer = new IntersectionObserver(function (entries) {
      for (var e = 0; e < entries.length; e++) {
        if (entries[e].isIntersecting) {
          var data = { element: el.tagName.toLowerCase() };
          var valsAttr = el.getAttribute("xh-track-vals");
          if (valsAttr) {
            try {
              var interpolated = interpolate(valsAttr, ctx, false);
              var vals = JSON.parse(interpolated);
              for (var k in vals) {
                if (vals.hasOwnProperty(k)) data[k] = vals[k];
              }
            } catch (e2) {
              if (config.debug) console.error("[xhtmlx] invalid JSON in xh-track-vals:", valsAttr, e2);
            }
          }
          sendAnalytics(trackEvent, data, el);
          observer.disconnect();
        }
      }
    }, { threshold: 0.1 });
    observer.observe(el);

    // Store observer for cleanup
    var state = elementStates.get(el) || {};
    if (!state.observers) state.observers = [];
    state.observers.push(observer);
    elementStates.set(el, state);
  }

  // ---------------------------------------------------------------------------
  // Core processing loop
  // ---------------------------------------------------------------------------

  /**
   * Process a DOM node: find all descendants with xh-* attributes, attach
   * triggers for REST verb elements, and apply bindings for binding-only
   * elements.
   *
   * @param {Element}     root
   * @param {DataContext}  ctx
   * @param {string[]}     templateStack – For circular template detection.
   */
  function processNode(root, ctx, templateStack) {
    templateStack = templateStack || [];

    if (!root || root.nodeType !== 1) return;
    if (root.tagName && root.tagName.toLowerCase() === "template") return;

    // Process the root element itself if it has xh-* attributes
    processElement(root, ctx, templateStack);

    // Find all descendant elements with any xh-* attribute
    // Use a broad selector that catches all xh- prefixed attributes
    var candidates = gatherXhElements(root);

    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      // Skip already processed elements
      var existingState = elementStates.get(el);
      if (existingState && existingState.processed) continue;
      // Skip detached elements
      if (!el.parentNode) continue;

      processElement(el, ctx, templateStack);
    }
  }

  // Compound CSS selector covering all known xh-* attributes.
  // Lets the browser's native selector engine find elements directly
  // instead of scanning every element and checking attributes manually.
  var XH_KNOWN_SELECTOR = [
    "[xh-get]", "[xh-post]", "[xh-put]", "[xh-delete]", "[xh-patch]",
    "[xh-text]", "[xh-html]", "[xh-each]", "[xh-if]", "[xh-unless]",
    "[xh-model]", "[xh-trigger]", "[xh-template]", "[xh-swap]", "[xh-target]",
    "[xh-indicator]", "[xh-show]", "[xh-hide]", "[xh-boost]", "[xh-ws]",
    "[xh-ws-send]", "[xh-push-url]", "[xh-replace-url]", "[xh-vals]",
    "[xh-headers]", "[xh-cache]", "[xh-retry]", "[xh-validate]",
    "[xh-error-template]", "[xh-error-boundary]", "[xh-error-target]",
    "[xh-focus]", "[xh-disabled-class]", "[xh-i18n]", "[xh-router]",
    "[xh-route]", "[xh-aria-live]", "[xh-track]", "[xh-track-view]"
  ].join(",");

  /**
   * Gather elements that have xh-* attributes within a root node.
   * Single-pass: queries with XH_KNOWN_SELECTOR first, then scans results
   * for dynamic attrs to avoid a separate buildCloneSelector scan.
   * @param {Element} root
   * @returns {Element[]}
   */
  function gatherXhElements(root) {
    // Use the cached combined selector (rebuilt by rebuildDetectSelector when
    // new dynamic attrs are discovered — avoids Object.keys + join per call).
    var selector = _gatherSelector;

    // Check for undiscovered dynamic attrs using querySelector (avoids
    // expensive innerHTML serialization of the entire subtree).
    var candidates = root.querySelectorAll(selector);
    for (var i = 0; i < candidates.length; i++) {
      var attrs = candidates[i].attributes;
      for (var a = 0; a < attrs.length; a++) {
        var name = attrs[a].name;
        if ((name.indexOf("xh-on-") === 0 || name.indexOf("xh-attr-") === 0 ||
             name.indexOf("xh-class-") === 0 || name.indexOf("xh-i18n-") === 0) &&
            !dynamicAttrSelectors["[" + name + "]"]) {
          // Found undiscovered dynamic attrs — do a full scan once
          selector = buildCloneSelector(root);
          return Array.prototype.slice.call(root.querySelectorAll(selector));
        }
      }
    }

    return Array.prototype.slice.call(candidates);
  }

  // ---------------------------------------------------------------------------
  // xh-on-* event handler helper
  // ---------------------------------------------------------------------------

  /**
   * Attach a declarative event handler for xh-on-{event} directives.
   *
   * @param {Element} el        – The element to attach the handler to.
   * @param {string}  event     – The DOM event name (e.g. "click", "dblclick").
   * @param {string}  actionStr – The action string (e.g. "toggleClass:active").
   */
  function attachOnHandler(el, event, actionStr) {
    var parts = actionStr.split(":");
    var action = parts[0];
    var arg = parts.slice(1).join(":");

    el.addEventListener(event, function(_evt) {
      switch (action) {
        case "toggleClass":
          el.classList.toggle(arg);
          break;
        case "addClass":
          el.classList.add(arg);
          break;
        case "removeClass":
          el.classList.remove(arg);
          break;
        case "remove":
          el.remove();
          break;
        case "toggle":
          var target = document.querySelector(arg);
          if (target) {
            target.style.display = target.style.display === "none" ? "" : "none";
          }
          break;
        case "dispatch":
          el.dispatchEvent(new CustomEvent(arg, { bubbles: true, detail: {} }));
          break;
        default:
          if (config.debug) console.warn("[xhtmlx] unknown xh-on action:", action);
      }
    });
  }

  /**
   * Process a single element: either attach REST triggers or apply
   * binding-only directives.
   *
   * @param {Element}     el
   * @param {DataContext}  ctx
   * @param {string[]}     templateStack
   */
  function processElement(el, ctx, templateStack) {
    // Skip already-processed elements to prevent double processing
    // (e.g. MutationObserver + explicit process() call)
    var existing = elementStates.get(el);
    if (existing && existing.processed) return;

    // -- xh-on-* event handlers (single pass, no intermediate array) ----------
    for (var oa = 0; oa < el.attributes.length; oa++) {
      if (el.attributes[oa].name.indexOf("xh-on-") === 0) {
        attachOnHandler(el, el.attributes[oa].name.slice(6), el.attributes[oa].value);
      }
    }

    // -- analytics tracking -----------------------------------------------------
    if (el.hasAttribute("xh-track")) {
      setupTrack(el, ctx);
    }
    if (el.hasAttribute("xh-track-view")) {
      setupTrackView(el, ctx);
    }

    // -- i18n support (skip attribute scan when no locales are loaded) ----------
    if (i18n._locale && (el.hasAttribute("xh-i18n") || checkElementForI18nAttr(el))) {
      applyI18n(el);
    }

    if (el.hasAttribute("xh-ws")) {
      _hasStatefulElements = true;
      setupWebSocket(el, ctx, templateStack);
      var wState = elementStates.get(el) || {};
      wState.processed = true;
      elementStates.set(el, wState);
    }
    if (el.hasAttribute("xh-ws-send")) {
      setupWsSend(el);
    }

    if (el.hasAttribute("xh-boost")) {
      boostElement(el, ctx);
      var boostState = elementStates.get(el) || {};
      boostState.processed = true;
      elementStates.set(el, boostState);
    }

    // Accessibility: auto-set aria-live on xh-target elements
    var targetSel = el.getAttribute("xh-target");
    if (targetSel) {
      var ariaLiveTarget = document.querySelector(targetSel);
      if (ariaLiveTarget && !ariaLiveTarget.hasAttribute("aria-live")) {
        var ariaLive = el.getAttribute("xh-aria-live") || "polite";
        ariaLiveTarget.setAttribute("aria-live", ariaLive);
      }
    }

    var restInfo = getRestVerb(el);

    if (restInfo) {
      _hasStatefulElements = true;
      // Initialize element state
      var state = existing || {};
      state.dataContext = ctx;
      state.requestInFlight = false;
      state.intervalIds = state.intervalIds || [];
      state.observers = state.observers || [];
      elementStates.set(el, state);

      // Attach triggers
      attachTriggers(el, ctx, templateStack);
    } else {
      // Binding-only element — apply immediately
      // Note: xh-each elements should have been handled in renderTemplate
      // This handles binding-only elements found directly in the document
      if (el.hasAttribute("xh-each")) {
        processEach(el, ctx);
      } else {
        var kept = applyBindings(el, ctx);
        if (kept) {
          // Mark as processed
          var bState = elementStates.get(el) || {};
          bState.processed = true;
          elementStates.set(el, bState);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // MutationObserver — auto-process dynamically added elements
  // ---------------------------------------------------------------------------

  var mutationObserver = null;

  function setupMutationObserver(ctx) {
    if (mutationObserver) return;

    mutationObserver = new MutationObserver(function (mutations) {
      for (var m = 0; m < mutations.length; m++) {
        var added = mutations[m].addedNodes;
        for (var n = 0; n < added.length; n++) {
          var node = added[n];
          if (node.nodeType !== 1) continue; // Element nodes only

          // Skip nodes inserted by xhtmlx swap/render (they are processed
          // via processNode with the correct data context, not root context)
          if (node.hasAttribute && node.hasAttribute("data-xh-owned")) continue;

          // Check if this node or any descendant has xh-* attributes
          var hasXh = hasXhAttributes(node);
          if (hasXh) {
            // Use the root data context
            processNode(node, ctx, []);
          }
        }
      }
    });

    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Check whether an element or any of its descendants have xh-* attributes.
   * Uses the known selector plus any dynamic attribute selectors discovered
   * during processing (tracked in dynamicAttrSelectors).
   * @param {Element} el
   * @returns {boolean}
   */
  var dynamicAttrSelectors = {};
  var XH_DETECT_SELECTOR = XH_KNOWN_SELECTOR;
  /** Cached combined selector for gatherXhElements (invalidated by rebuildDetectSelector) */
  var _gatherSelector = XH_KNOWN_SELECTOR;

  /** Rebuild the detect selector when new dynamic attrs are discovered. */
  function rebuildDetectSelector() {
    var extra = Object.keys(dynamicAttrSelectors);
    XH_DETECT_SELECTOR = extra.length ? XH_KNOWN_SELECTOR + "," + extra.join(",") : XH_KNOWN_SELECTOR;
    _gatherSelector = XH_DETECT_SELECTOR;
  }

  function hasXhAttributes(el) {
    // Skip nodes owned by xhtmlx (inserted via swap/render)
    if (el.hasAttribute && el.hasAttribute("data-xh-owned")) return false;
    // Check the element itself (fast path — avoids full subtree scan)
    if (checkElementForXh(el)) return true;
    // Single querySelector check covers both known and discovered dynamic attrs
    if (el.querySelector && el.querySelector(XH_DETECT_SELECTOR)) return true;
    return false;
  }

  /**
   * Check if a single element has any xh-* attribute.
   * @param {Element} el
   * @returns {boolean}
   */
  function checkElementForXh(el) {
    // Delegate to browser's optimized CSS matching engine
    if (el.matches) return el.matches(XH_DETECT_SELECTOR);
    // Fallback for elements without matches (shouldn't happen in modern browsers)
    if (!el.attributes) return false;
    for (var i = 0; i < el.attributes.length; i++) {
      if (el.attributes[i].name.indexOf("xh-") === 0) return true;
    }
    return false;
  }

  /**
   * Check if an element has any xh-i18n-{attr} attribute (not xh-i18n-vars).
   * @param {Element} el
   * @returns {boolean}
   */
  function checkElementForI18nAttr(el) {
    if (!el.attributes) return false;
    for (var i = 0; i < el.attributes.length; i++) {
      var name = el.attributes[i].name;
      if (name.indexOf("xh-i18n-") === 0 && name !== "xh-i18n-vars") return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // i18n — Internationalization support
  // ---------------------------------------------------------------------------

  var i18n = {
    _locales: {},
    _locale: null,
    _fallback: "en",

    load: function(locale, translations) {
      i18n._locales[locale] = i18n._locales[locale] || {};
      for (var k in translations) {
        if (translations.hasOwnProperty(k)) {
          i18n._locales[locale][k] = translations[k];
        }
      }
    },

    get locale() { return i18n._locale || i18n._fallback; },
    set locale(val) {
      i18n._locale = val;
      if (typeof document !== "undefined") {
        applyI18n(document.body);
        emitEvent(document.body, "xh:localeChanged", { locale: val }, false);
      }
    },

    /** Cache of compiled regexes for variable substitution: varName -> RegExp */
    _varRegexCache: {},

    t: function(key, vars) {
      var locales = [i18n._locale, i18n._fallback];
      for (var l = 0; l < locales.length; l++) {
        if (!locales[l]) continue;
        var dict = i18n._locales[locales[l]];
        if (dict && dict[key] != null) {
          var text = String(dict[key]);
          if (vars) {
            for (var v in vars) {
              if (vars.hasOwnProperty(v)) {
                var re = i18n._varRegexCache[v];
                if (!re) {
                  re = new RegExp("\\{" + v + "\\}", "g");
                  i18n._varRegexCache[v] = re;
                }
                re.lastIndex = 0;
                text = text.replace(re, vars[v]);
              }
            }
          }
          return text;
        }
      }
      return key; // fallback to key itself
    }
  };

  /**
   * Apply i18n translations to elements with xh-i18n and xh-i18n-{attr} attributes.
   *
   * @param {Element} root – The root element to scan.
   */
  // Common i18n attribute selectors for targeted scanning
  var I18N_ATTR_SELECTOR = "[xh-i18n-placeholder],[xh-i18n-title],[xh-i18n-alt],[xh-i18n-label],[xh-i18n-aria-label]";

  // Track discovered i18n attribute selectors to avoid full DOM scan
  var discoveredI18nSelectors = {};
  var _i18nSelectorCache = null;

  /** Rebuild the combined i18n selector from known + discovered attrs. */
  function getI18nSelector() {
    if (_i18nSelectorCache) return _i18nSelectorCache;
    var extra = Object.keys(discoveredI18nSelectors);
    _i18nSelectorCache = extra.length ? "[xh-i18n]," + I18N_ATTR_SELECTOR + "," + extra.join(",")
                                      : "[xh-i18n]," + I18N_ATTR_SELECTOR;
    return _i18nSelectorCache;
  }

  function applyI18n(root) {
    var els = root.querySelectorAll(getI18nSelector());
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      // Handle xh-i18n (textContent translation)
      var key = el.getAttribute("xh-i18n");
      if (key) {
        var vars = el.getAttribute("xh-i18n-vars");
        var parsedVars = null;
        if (vars) {
          try { parsedVars = JSON.parse(vars); } catch(e) { /* ignore */ }
        }
        el.textContent = i18n.t(key, parsedVars);
      }
      // Handle xh-i18n-{attr} attribute translations and track new selectors
      applyI18nAttrs(el);
    }
  }

  function applyI18nAttrs(el) {
    var attrs = el.attributes;
    for (var a = 0; a < attrs.length; a++) {
      var name = attrs[a].name;
      if (name.indexOf("xh-i18n-") === 0 && name !== "xh-i18n-vars") {
        var targetAttr = name.slice(8);
        var attrKey = attrs[a].value;
        el.setAttribute(targetAttr, i18n.t(attrKey));
        // Track uncommon i18n attr selectors so future applyI18n calls find them
        var sel = "[" + name + "]";
        if (!discoveredI18nSelectors[sel]) {
          discoveredI18nSelectors[sel] = true;
          _i18nSelectorCache = null; // Invalidate cached selector
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // SPA Router
  // ---------------------------------------------------------------------------

  var router = {
    _routes: [],
    _outlet: null,
    _activeLink: null,
    _activeClass: "xh-route-active",
    _notFoundTemplate: null,

    _init: function() {
      // Scan for xh-router containers
      if (typeof document === "undefined") return;
      var containers = document.querySelectorAll("[xh-router]");
      for (var c = 0; c < containers.length; c++) {
        var outlet = containers[c].getAttribute("xh-router-outlet") || "#router-outlet";
        router._outlet = document.querySelector(outlet);

        var links = containers[c].querySelectorAll("[xh-route]");
        for (var l = 0; l < links.length; l++) {
          var link = links[l];
          var route = {
            path: link.getAttribute("xh-route"),
            template: link.getAttribute("xh-template"),
            api: link.getAttribute("xh-get"),
            element: link,
            regex: null,
            paramNames: []
          };

          // Convert path pattern to regex: /users/:id -> /users/([^/]+)
          var paramNames = [];
          var regexStr = route.path.replace(/:([^/]+)/g, function(_, name) {
            paramNames.push(name);
            return "([^/]+)";
          });
          route.regex = new RegExp("^" + regexStr + "$");
          route.paramNames = paramNames;
          router._routes.push(route);

          // Click handler
          (function(r) {
            r.element.addEventListener("click", function(e) {
              e.preventDefault();
              router.navigate(r.path);
            });
          })(route);
        }

        // 404 fallback
        var notFound = containers[c].getAttribute("xh-router-404");
        if (notFound) router._notFoundTemplate = notFound;
      }

      // Handle popstate for back/forward
      window.addEventListener("popstate", function() {
        router._resolve(window.location.pathname);
      });

      // Resolve current URL on init
      if (router._routes.length > 0) {
        router._resolve(window.location.pathname);
      }
    },

    navigate: function(path) {
      history.pushState({ xhtmlx: true, route: path }, "", path);
      router._resolve(path);
    },

    _resolve: function(path) {
      if (!router._outlet) return;

      for (var i = 0; i < router._routes.length; i++) {
        var route = router._routes[i];
        var match = path.match(route.regex);
        if (match) {
          // Extract params
          var params = {};
          for (var p = 0; p < route.paramNames.length; p++) {
            params[route.paramNames[p]] = match[p + 1];
          }

          // Update active class
          if (router._activeLink) {
            router._activeLink.classList.remove(router._activeClass);
          }
          route.element.classList.add(router._activeClass);
          router._activeLink = route.element;

          // Fetch data and render
          var ctx = new DataContext(params);

          if (route.api) {
            var url = interpolate(route.api, ctx, true);
            fetch(url).then(function(r) { return r.text(); }).then(function(text) {
              var data;
              try { data = JSON.parse(text); } catch(e) { data = {}; }
              var childCtx = new DataContext(data, ctx);

              if (route.template) {
                fetchTemplate(route.template).then(function(html) {
                  var fragment = renderTemplate(html, childCtx);
                  cleanupBeforeSwap(router._outlet, false);
                  router._outlet.innerHTML = "";
                  router._outlet.appendChild(fragment);
                  processNode(router._outlet, childCtx, []);
                });
              }
            });
          } else if (route.template) {
            fetchTemplate(route.template).then(function(html) {
              var fragment = renderTemplate(html, ctx);
              cleanupBeforeSwap(router._outlet, false);
              router._outlet.innerHTML = "";
              router._outlet.appendChild(fragment);
              processNode(router._outlet, ctx, []);
            });
          }

          emitEvent(router._outlet, "xh:routeChanged", { path: path, params: params }, false);
          return;
        }
      }

      // 404
      if (router._notFoundTemplate) {
        var ctx404 = new DataContext({ path: path });
        fetchTemplate(router._notFoundTemplate).then(function(html) {
          var fragment = renderTemplate(html, ctx404);
          cleanupBeforeSwap(router._outlet, false);
          router._outlet.innerHTML = "";
          router._outlet.appendChild(fragment);
        });
      }

      emitEvent(document.body, "xh:routeNotFound", { path: path }, false);
    }
  };

  // ---------------------------------------------------------------------------
  // DOM patching — render() with in-place updates
  // ---------------------------------------------------------------------------

  /**
   * Collect binding state from live DOM elements for future patching.
   * Walks the target and records references to bound elements and their values.
   *
   * @param {Element}     target – The container holding rendered content.
   * @param {DataContext}  ctx    – The data context used for this render.
   * @param {string}       html   – The template HTML string.
   * @returns {Object} Patch state for future updates.
   */
  function collectBindingState(target, ctx, html) {
    var bindings = [];
    var tw = document.createTreeWalker(target, 1 /* SHOW_ELEMENT */);
    while (tw.nextNode()) {
      var el = tw.currentNode;
      var attrs = el.attributes;
      var entry = null;

      for (var i = 0; i < attrs.length; i++) {
        var name = attrs[i].name;
        if (name.charCodeAt(0) !== 120 || name.charCodeAt(1) !== 104 ||
            name.charCodeAt(2) !== 45) continue;

        if (!entry) entry = { el: el, ops: [] };
        var value = attrs[i].value;

        switch (name) {
          case "xh-text":
            entry.ops.push({ type: 0 /* text */, field: value, last: ctx.resolve(value) });
            break;
          case "xh-html":
            entry.ops.push({ type: 1 /* html */, field: value, last: ctx.resolve(value) });
            break;
          case "xh-show":
            entry.ops.push({ type: 2 /* show */, field: value, last: ctx.resolve(value) });
            break;
          case "xh-hide":
            entry.ops.push({ type: 3 /* hide */, field: value, last: ctx.resolve(value) });
            break;
          case "xh-if":
            entry.ops.push({ type: 4 /* if */, field: value, last: ctx.resolve(value) });
            break;
          case "xh-unless":
            entry.ops.push({ type: 5 /* unless */, field: value, last: ctx.resolve(value) });
            break;
          default:
            if (name.indexOf("xh-attr-") === 0) {
              entry.ops.push({ type: 6 /* attr */, target: name.slice(8), field: value, last: ctx.resolve(value) });
            } else if (name.indexOf("xh-class-") === 0) {
              entry.ops.push({ type: 7 /* class */, className: name.slice(9), field: value, last: ctx.resolve(value) });
            }
        }
      }
      if (entry) bindings.push(entry);
    }

    // Also capture text-node interpolation state
    var interpNodes = [];
    var txtWalker = document.createTreeWalker(target, 4 /* SHOW_TEXT */);
    while (txtWalker.nextNode()) {
      var tnode = txtWalker.currentNode;
      // Check if this text node's original template had interpolation.
      // We mark it by storing the template string in a custom property.
      if (tnode._xhTpl) {
        interpNodes.push({ node: tnode, tpl: tnode._xhTpl, last: tnode.nodeValue });
      }
    }

    return { html: html, bindings: bindings, interpNodes: interpNodes, ctx: ctx };
  }

  /**
   * Patch existing bound DOM nodes in place instead of full re-render.
   * Only updates DOM properties whose data values have changed.
   *
   * @param {Object}      state – Patch state from collectBindingState.
   * @param {DataContext}  ctx   – New data context.
   * @returns {boolean} true if patching succeeded, false if full re-render needed.
   */
  function patchBindings(state, ctx) {
    var bindings = state.bindings;
    for (var i = 0; i < bindings.length; i++) {
      var entry = bindings[i];
      var el = entry.el;
      // If element was removed from DOM (e.g. parent got replaced), bail out
      if (!el.parentNode) return false;

      var ops = entry.ops;
      for (var j = 0; j < ops.length; j++) {
        var op = ops[j];
        var newVal = ctx.resolve(op.field);

        if (newVal === op.last) continue; // No change — skip DOM mutation

        switch (op.type) {
          case 0: // text
            op.last = newVal;
            var text = newVal != null ? (typeof newVal === "string" ? newVal : String(newVal)) : "";
            if (el.firstChild && el.firstChild.nodeType === 3) {
              el.firstChild.nodeValue = text;
            } else {
              el.textContent = text;
            }
            break;
          case 1: // html
            op.last = newVal;
            el.innerHTML = newVal != null ? (typeof newVal === "string" ? newVal : String(newVal)) : "";
            break;
          case 2: // show
            op.last = newVal;
            el.style.display = newVal ? "" : "none";
            break;
          case 3: // hide
            op.last = newVal;
            el.style.display = newVal ? "none" : "";
            break;
          case 4: // if
            // xh-if change requires full re-render (element removal/addition)
            if (!newVal !== !op.last) return false;
            op.last = newVal;
            break;
          case 5: // unless
            if (!newVal !== !op.last) return false;
            op.last = newVal;
            break;
          case 6: // attr
            op.last = newVal;
            if (newVal != null) el.setAttribute(op.target, String(newVal));
            else el.removeAttribute(op.target);
            break;
          case 7: // class
            op.last = newVal;
            if (newVal) el.classList.add(op.className);
            else el.classList.remove(op.className);
            break;
        }
      }
    }

    // Patch text-node interpolation
    var interpNodes = state.interpNodes;
    for (var k = 0; k < interpNodes.length; k++) {
      var entry2 = interpNodes[k];
      if (!entry2.node.parentNode) return false;
      var newText = interpolate(entry2.tpl, ctx, false);
      if (newText !== entry2.last) {
        entry2.node.nodeValue = newText;
        entry2.last = newText;
      }
    }

    return true;
  }

  /**
   * Render a template into a target element with DOM patching.
   * On the first call for a target, does a full render. On subsequent calls
   * with the same template, patches only changed bindings in place.
   *
   * @param {string}       html   – Template HTML string.
   * @param {DataContext|Object} ctx – Data context or plain object.
   * @param {Element}      target – Target element to render into.
   */
  function renderInto(html, ctx, target) {
    // Check for existing patch state
    var state = patchStates.get(target);
    if (state && state.html === html) {
      // Reuse cached DataContext, just update the data
      if (!(ctx instanceof DataContext)) {
        state.ctx.data = ctx;
        ctx = state.ctx;
      }
      // Patch path: update only changed bindings
      if (patchBindings(state, ctx)) return;
      // Patching failed (xh-if change, etc.) — fall through to full render
    }

    if (!(ctx instanceof DataContext)) {
      ctx = new DataContext(ctx);
    }

    // Full render path
    var fragment = renderTemplate(html, ctx);
    performSwap(target, fragment, "innerHTML");

    // Collect and store binding state for future patching
    patchStates.set(target, collectBindingState(target, ctx, html));
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  var xhtmlx = {
    /** Library configuration */
    config: config,

    /**
     * Manually process a DOM node and its descendants.
     * @param {Element}     root – Element to process.
     * @param {DataContext}  ctx  – Optional data context.
     */
    process: function (root, ctx) {
      processNode(root || document.body, ctx || new DataContext({}), []);
    },

    /**
     * Render a template into a target element with DOM patching.
     * First call does a full render. Subsequent calls with the same template
     * patch only changed bindings in place (no DOM rebuild).
     *
     * @param {string}       html   – Template HTML string.
     * @param {*}            data   – Data (plain object or DataContext).
     * @param {Element}      target – Target element to render into.
     */
    render: function (html, data, target) {
      renderInto(html, data, target);
    },

    /**
     * Create a DataContext for programmatic use.
     * @param {*}           data
     * @param {DataContext}  parent
     * @param {number}       index
     * @returns {DataContext}
     */
    createContext: function (data, parent, index) {
      return new DataContext(data, parent, index);
    },

    /**
     * Clear the template cache.
     */
    clearTemplateCache: function () {
      templateCache.clear();
      renderFragmentCache.clear();
    },

    /**
     * Clear the response cache.
     */
    clearResponseCache: function () {
      responseCache.clear();
    },

    /**
     * Scan for <template xh-name="..."> and populate template cache.
     * Called automatically on DOMContentLoaded. Call manually after
     * dynamically adding named templates.
     */
    scanNamedTemplates: scanNamedTemplates,

    /**
     * Interpolate a string using a data context.
     * @param {string}      str
     * @param {DataContext}  ctx
     * @param {boolean}      uriEncode
     * @returns {string}
     */
    interpolate: function (str, ctx, uriEncode) {
      return interpolate(str, ctx, !!uriEncode);
    },

    /** Register a custom directive processed in applyBindings. */
    directive: registerDirective,

    /** Register a global hook (e.g. "beforeRequest"). */
    hook: registerHook,

    /** Register a named transform for pipe syntax in bindings. */
    transform: registerTransform,

    /**
     * Switch UI version. Sets template and API prefixes, clears all caches.
     * Version can be any string: "v2", "abc123", "20260315", a git SHA, etc.
     *
     * @param {string}  version     – Version identifier.
     * @param {Object}  [opts]      – Options.
     * @param {string}  [opts.templatePrefix] – Template prefix. Defaults to "/ui/{version}".
     * @param {string}  [opts.apiPrefix]      – API prefix. Defaults to "" (unchanged).
     * @param {boolean} [opts.reload]         – Re-render all active widgets. Defaults to true.
     */
    switchVersion: function (version, opts) {
      opts = opts || {};
      config.uiVersion = version;
      config.templatePrefix = opts.templatePrefix != null ? opts.templatePrefix : "/ui/" + version;
      config.apiPrefix = opts.apiPrefix != null ? opts.apiPrefix : config.apiPrefix;
      templateCache.clear();
      renderFragmentCache.clear();
      responseCache.clear();

      if (typeof document !== "undefined") {
        emitEvent(document.body, "xh:versionChanged", {
          version: version,
          templatePrefix: config.templatePrefix,
          apiPrefix: config.apiPrefix
        }, false);
      }

      if (opts.reload !== false) {
        this.reload();
      }
    },

    /**
     * Re-render all active widgets, or only those using a specific template.
     * Re-fetches data from API and re-renders with (possibly new) templates.
     *
     * @param {string} [templateUrl] – If provided, only reload widgets using this template.
     */
    reload: function (templateUrl) {
      if (typeof document === "undefined") return;
      var allEls = gatherXhElements(document.body);
      for (var i = 0; i < allEls.length; i++) {
        var el = allEls[i];
        var st = elementStates.get(el);
        if (!st || !st.apiUrl) continue;
        if (templateUrl && st.templateUrl !== templateUrl) continue;
        // Reset processed flag so element can be re-triggered
        st.processed = false;
        elementStates.set(el, st);
        // Re-execute the request
        var restInfo = getRestVerb(el);
        if (restInfo) {
          var ctx = st.dataContext || new DataContext({});
          executeRequest(el, ctx, []);
        }
      }
    },

    /** i18n module for internationalization support */
    i18n: i18n,

    /** SPA Router */
    router: router,

    /**
     * Register an analytics handler to receive all tracking events.
     * @param {Function} handler – function(eventName, data)
     */
    analytics: registerAnalytics,

    /**
     * Tear down xhtmlx: remove global event listeners, disconnect the
     * MutationObserver, and clear timers.  Useful in SPA scenarios where
     * the library may be re-initialized.
     */
    destroy: function () {
      if (typeof window !== "undefined") {
        window.removeEventListener("popstate", popstateHandler);
        if (resizeListenerAttached) {
          window.removeEventListener("resize", globalResizeHandler);
          resizeListenerAttached = false;
        }
      }
      clearTimeout(resizeGlobalTimer);
      resizeElements.length = 0;
      if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
      }
      templateCache.clear();
      renderFragmentCache.clear();
      responseCache.clear();
    },

    /** Internal version string */
    version: "0.3.0",

    // --- Internals exposed for testing (not part of the public API) ----------
    _internals: {
      DataContext: DataContext,
      MutableDataContext: MutableDataContext,
      interpolate: interpolate,
      parseTrigger: parseTrigger,
      parseTimeValue: parseTimeValue,
      renderTemplate: renderTemplate,
      applyBindings: applyBindings,
      processEach: processEach,
      processBindingsInTree: processBindingsInTree,
      processElement: processElement,
      attachOnHandler: attachOnHandler,
      executeRequest: executeRequest,
      resolveErrorTemplate: resolveErrorTemplate,
      findErrorBoundary: findErrorBoundary,
      getRestVerb: getRestVerb,
      performSwap: performSwap,
      buildRequestBody: buildRequestBody,
      fetchTemplate: fetchTemplate,
      scanNamedTemplates: scanNamedTemplates,
      resolveTemplate: resolveTemplate,
      getSwapTarget: getSwapTarget,
      defaultTrigger: defaultTrigger,
      resolveDot: resolveDot,
      templateCache: templateCache,
      renderFragmentCache: renderFragmentCache,
      patchStates: patchStates,
      renderInto: renderInto,
      collectBindingState: collectBindingState,
      patchBindings: patchBindings,
      responseCache: responseCache,
      elementStates: elementStates,
      generationMap: generationMap,
      fetchWithRetry: fetchWithRetry,
      applySettleClasses: applySettleClasses,
      setupWebSocket: setupWebSocket,
      setupWsSend: setupWsSend,
      boostElement: boostElement,
      boostLink: boostLink,
      boostForm: boostForm,
      customDirectives: customDirectives,
      globalHooks: globalHooks,
      transforms: transforms,
      runHooks: runHooks,
      registerDirective: registerDirective,
      registerHook: registerHook,
      registerTransform: registerTransform,
      config: config,
      validateElement: validateElement,
      applyI18n: applyI18n,
      i18n: i18n,
      router: router,
      injectDefaultCSS: injectDefaultCSS,
      getCurrentBreakpoint: getCurrentBreakpoint,
      getViewportContext: getViewportContext,
      analyticsHandlers: analyticsHandlers,
      sendAnalytics: sendAnalytics,
      setupTrack: setupTrack,
      setupTrackView: setupTrackView,
      registerAnalytics: registerAnalytics
    }
  };

  // Expose globally (browser) or as module (Node/test)
  if (typeof window !== "undefined") {
    window.xhtmlx = xhtmlx;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = xhtmlx;
  }

  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Named template scanning — <template xh-name="/path"> → cache
  // ---------------------------------------------------------------------------

  function scanNamedTemplates() {
    if (typeof document === "undefined") return;
    var named = document.querySelectorAll("template[xh-name]");
    for (var i = 0; i < named.length; i++) {
      var name = named[i].getAttribute("xh-name");
      if (name) {
        var prefixedName = config.templatePrefix ? config.templatePrefix + name : name;
        templateCache.set(prefixedName, Promise.resolve(named[i].innerHTML));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Auto-init on DOMContentLoaded (browser only)
  // ---------------------------------------------------------------------------

  if (typeof document !== "undefined" && document.addEventListener) {
    function autoInit() {
      injectDefaultCSS();
      scanNamedTemplates();
      var rootCtx = new DataContext({});
      processNode(document.body, rootCtx, []);
      setupMutationObserver(rootCtx);
      router._init();
      // Ensure the global resize listener is attached for breakpoint detection
      // even when no xh-trigger="resize" elements exist.
      if (!resizeListenerAttached && typeof window !== "undefined") {
        window.addEventListener("resize", globalResizeHandler);
        resizeListenerAttached = true;
      }
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", autoInit);
    } else {
      autoInit();
    }
  }

  // ---------------------------------------------------------------------------
  // popstate listener — browser history back/forward (xh-push-url support)
  // ---------------------------------------------------------------------------

  function popstateHandler(e) {
    if (e.state && e.state.xhtmlx && e.state.url) {
      var target = e.state.targetSel ? document.querySelector(e.state.targetSel) : document.body;
      if (target) {
        fetch(e.state.url).then(function (r) { return r.text(); }).then(function (text) {
          var data;
          try {
            data = JSON.parse(text);
          } catch (_) {
            return;
          }
          var ctx = new DataContext(data);
          if (e.state.templateUrl) {
            fetchTemplate(e.state.templateUrl).then(function (html) {
              var fragment = renderTemplate(html, ctx);
              cleanupBeforeSwap(target, false);
              target.innerHTML = "";
              target.appendChild(fragment);
              processNode(target, ctx, []);
            });
          }
        }).catch(function () {});
      }
    }
  }

  if (typeof window !== "undefined") {
    window.addEventListener("popstate", popstateHandler);
  }

  // ---------------------------------------------------------------------------
  // Breakpoint change detection — emits xh:breakpointChanged on resize
  // Merged into the globalResizeHandler to avoid a second resize listener.
  // ---------------------------------------------------------------------------

  var lastBreakpoint = typeof window !== "undefined" ? getCurrentBreakpoint() : "desktop";

  function checkBreakpointChange() {
    // Invalidate cached viewport context on every resize
    _vpCache = null;
    var current = getCurrentBreakpoint();
    if (current !== lastBreakpoint) {
      lastBreakpoint = current;
      if (typeof document !== "undefined") {
        emitEvent(document.body, "xh:breakpointChanged", {
          breakpoint: current,
          width: window.innerWidth,
          mobile: current === "mobile",
          tablet: current === "tablet",
          desktop: current === "desktop"
        }, false);
      }
    }
  }

})();
