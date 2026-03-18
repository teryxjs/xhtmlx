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
   * @returns {Object}
   */
  function getViewportContext() {
    var bp = getCurrentBreakpoint();
    return {
      width: typeof window !== "undefined" ? window.innerWidth : 0,
      height: typeof window !== "undefined" ? window.innerHeight : 0,
      breakpoint: bp,
      mobile: bp === "mobile",
      tablet: bp === "tablet",
      desktop: bp === "desktop"
    };
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

  /** Map<string, {data: string, timestamp: number}> — response cache (verb:url → body) */
  var responseCache = new Map();

  /** Cache for path.split(".") results in DataContext.resolve (bounded) */
  var pathSplitCache = {};
  var pathSplitCacheSize = 0;
  var PATH_SPLIT_CACHE_MAX = 1000;

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

    // -- transform pipe support: "price | currency" --------------------------
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

    var parts = pathSplitCache[path];
    if (!parts) {
      if (pathSplitCacheSize >= PATH_SPLIT_CACHE_MAX) { pathSplitCache = {}; pathSplitCacheSize = 0; }
      parts = path.split(".");
      pathSplitCache[path] = parts;
      pathSplitCacheSize++;
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
      var root = this;
      while (root.parent) root = root.parent;
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
      var root = this;
      while (root.parent) root = root.parent;
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
    var cur = obj;
    for (var i = startIdx || 0; i < parts.length; i++) {
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
    var parts = path.split(".");
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
    if (subs) {
      for (var i = 0; i < subs.length; i++) subs[i]();
    }
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
      var replaced = interpolate(original, ctx, false);
      if (replaced !== original) node.nodeValue = replaced;
    }

    // Interpolate non-xh-* attributes on all elements
    var elements = root.querySelectorAll("*");
    for (var e = 0; e < elements.length; e++) {
      var attrs = elements[e].attributes;
      for (var a = 0; a < attrs.length; a++) {
        var name = attrs[a].name;
        // Skip xh-* attributes — they are processed by directives/executeRequest
        if (name.indexOf("xh-") === 0) continue;
        var origAttr = attrs[a].value;
        var replacedAttr = interpolate(origAttr, ctx, false);
        if (replacedAttr !== origAttr) attrs[a].value = replacedAttr;
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

  /**
   * Returns the REST verb attribute on an element, if any.
   * @param {Element} el
   * @returns {{verb: string, url: string}|null}
   */
  function getRestVerb(el) {
    for (var i = 0; i < REST_VERBS.length; i++) {
      var url = el.getAttribute(REST_VERBS[i]);
      if (url != null) {
        var method = REST_VERBS[i].replace("xh-", "").toUpperCase();
        return { verb: method, url: url };
      }
    }
    return null;
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

  function applyBindings(el, ctx) {
    // -- xh-show ----------------------------------------------------------------
    var showAttr = el.getAttribute("xh-show");
    if (showAttr != null) {
      var sval = ctx.resolve(showAttr);
      el.style.display = sval ? "" : "none";
      if (ctx instanceof MutableDataContext) {
        (function(field, element, context) {
          trackSubscription(element, context, field, function() {
            var newVal = context.resolve(field);
            element.style.display = newVal ? "" : "none";
          });
        })(showAttr, el, ctx);
      }
    }

    // -- xh-hide ----------------------------------------------------------------
    var hideAttr = el.getAttribute("xh-hide");
    if (hideAttr != null) {
      var hdval = ctx.resolve(hideAttr);
      el.style.display = hdval ? "none" : "";
      if (ctx instanceof MutableDataContext) {
        (function(field, element, context) {
          trackSubscription(element, context, field, function() {
            var newVal = context.resolve(field);
            element.style.display = newVal ? "none" : "";
          });
        })(hideAttr, el, ctx);
      }
    }

    // -- xh-if ----------------------------------------------------------------
    var ifAttr = el.getAttribute("xh-if");
    if (ifAttr != null) {
      var val = ctx.resolve(ifAttr);
      if (!val) {
        el.remove();
        return false;
      }
    }

    // -- xh-unless ------------------------------------------------------------
    var unlessAttr = el.getAttribute("xh-unless");
    if (unlessAttr != null) {
      var uval = ctx.resolve(unlessAttr);
      if (uval) {
        el.remove();
        return false;
      }
    }

    // -- xh-text --------------------------------------------------------------
    var textAttr = el.getAttribute("xh-text");
    if (textAttr != null) {
      var tv = ctx.resolve(textAttr);
      el.textContent = tv != null ? String(tv) : "";
      if (ctx instanceof MutableDataContext) {
        (function(field, element, context) {
          trackSubscription(element, context, field, function() {
            var newVal = context.resolve(field);
            element.textContent = newVal != null ? String(newVal) : "";
          });
        })(textAttr, el, ctx);
      }
    }

    // -- xh-html --------------------------------------------------------------
    var htmlAttr = el.getAttribute("xh-html");
    if (htmlAttr != null) {
      var hv = ctx.resolve(htmlAttr);
      if (config.cspSafe) {
        if (config.debug) console.warn("[xhtmlx] xh-html is disabled in CSP-safe mode, falling back to xh-text");
        el.textContent = hv != null ? String(hv) : "";
      } else {
        el.innerHTML = hv != null ? String(hv) : "";
        if (ctx instanceof MutableDataContext) {
          (function(field, element, context) {
            trackSubscription(element, context, field, function() {
              var newVal = context.resolve(field);
              element.innerHTML = newVal != null ? String(newVal) : "";
            });
          })(htmlAttr, el, ctx);
        }
      }
    }

    // -- xh-attr-* + xh-class-* (single pass) ----------------------------------
    var attrs = el.attributes;
    for (var i = attrs.length - 1; i >= 0; i--) {
      var aName = attrs[i].name;
      if (aName.indexOf("xh-attr-") === 0) {
        var targetAttr = aName.slice(8);
        var aval = ctx.resolve(attrs[i].value);
        if (aval != null) {
          el.setAttribute(targetAttr, String(aval));
        }
        if (ctx instanceof MutableDataContext) {
          (function(field, tAttr, element, context) {
            trackSubscription(element, context, field, function() {
              var newVal = context.resolve(field);
              if (newVal != null) {
                element.setAttribute(tAttr, String(newVal));
              }
            });
          })(attrs[i].value, targetAttr, el, ctx);
        }
      } else if (aName.indexOf("xh-class-") === 0) {
        var className = aName.slice(9);
        var cval = ctx.resolve(attrs[i].value);
        if (cval) {
          el.classList.add(className);
        } else {
          el.classList.remove(className);
        }
        if (ctx instanceof MutableDataContext) {
          (function(field, clsName, element, context) {
            trackSubscription(element, context, field, function() {
              var newVal = context.resolve(field);
              if (newVal) {
                element.classList.add(clsName);
              } else {
                element.classList.remove(clsName);
              }
            });
          })(attrs[i].value, className, el, ctx);
        }
      }
    }

    // -- xh-model ---------------------------------------------------------------
    var modelAttr = el.getAttribute("xh-model");
    if (modelAttr != null) {
      var mv = ctx.resolve(modelAttr);
      var tag = el.tagName.toLowerCase();
      var type = (el.getAttribute("type") || "").toLowerCase();

      if (tag === "select") {
        // Set the matching option as selected
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
        // text, email, number, hidden, etc.
        el.value = mv != null ? String(mv) : "";
      }

      // Live reactivity: when the user edits an xh-model input, call ctx.set()
      if (ctx instanceof MutableDataContext) {
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
        })(modelAttr, el, ctx);
      }
    }

    // xh-class-* is now handled in the xh-attr-* loop above (single pass)

    // -- custom directives -------------------------------------------------------
    for (var cd = 0; cd < customDirectives.length; cd++) {
      var directive = customDirectives[cd];
      var cdVal = el.getAttribute(directive.name);
      if (cdVal != null) {
        directive.handler(el, cdVal, ctx);
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
    var dynamicAttrs = {};
    var all = templateEl.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var attrs = all[i].attributes;
      for (var a = 0; a < attrs.length; a++) {
        var name = attrs[a].name;
        if (name.indexOf("xh-on-") === 0 || name.indexOf("xh-attr-") === 0 ||
            name.indexOf("xh-class-") === 0 || name.indexOf("xh-i18n-") === 0) {
          dynamicAttrs["[" + name + "]"] = true;
        }
      }
    }
    var extra = Object.keys(dynamicAttrs);
    return extra.length ? XH_KNOWN_SELECTOR + "," + extra.join(",") : XH_KNOWN_SELECTOR;
  }

  /**
   * Process xh-each on an element. Clones the element for each item in the
   * array, applies bindings, and recursively processes each clone.
   *
   * @param {Element}     el
   * @param {DataContext}  ctx
   */
  function processEach(el, ctx) {
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

    // Pre-build a targeted selector from the template once, reused for all
    // cloned items instead of querySelectorAll("*") per clone.
    var cloneSelector = buildCloneSelector(el);

    var fragment = document.createDocumentFragment();

    var ItemCtxClass = (ctx instanceof MutableDataContext) ? MutableDataContext : DataContext;

    var renderItem = function (item, idx) {
      var clone = el.cloneNode(true);
      // Mark only the clone root — descendants are detected via closest()
      clone.setAttribute("data-xh-each-item", "");
      var itemCtx = new ItemCtxClass(item, ctx, idx);
      applyBindings(clone, itemCtx);
      // Handle xh-on-* event handlers on the clone root itself
      for (var oa = 0; oa < clone.attributes.length; oa++) {
        if (clone.attributes[oa].name.indexOf("xh-on-") === 0) {
          attachOnHandler(clone, clone.attributes[oa].name.slice(6), clone.attributes[oa].value);
        }
      }
      // Mark clone root as processed to prevent re-processing by processNode
      var cloneState = elementStates.get(clone) || {};
      cloneState.processed = true;
      elementStates.set(clone, cloneState);
      // Single combined pass: bindings + REST triggers for all descendants
      processEachCloneChildren(clone, itemCtx, cloneSelector);
      fragment.appendChild(clone);
    };

    if (arr.length > config.batchThreshold && typeof requestAnimationFrame === "function") {
      // Render first batch immediately (above-the-fold content)
      var batchSize = config.batchThreshold;
      for (var i = 0; i < Math.min(batchSize, arr.length); i++) {
        renderItem(arr[i], i);
      }
      parent.insertBefore(fragment, el);

      // Render remaining in chunks via rAF
      var offset = batchSize;

      function renderBatch() {
        var batchFragment = document.createDocumentFragment();
        var end = Math.min(offset + batchSize, arr.length);
        for (var b = offset; b < end; b++) {
          var clone = el.cloneNode(true);
          clone.setAttribute("data-xh-each-item", "");
          var itemCtx = new ItemCtxClass(arr[b], ctx, b);
          applyBindings(clone, itemCtx);
          processEachCloneChildren(clone, itemCtx, cloneSelector);
          batchFragment.appendChild(clone);
        }
        // Insert after the last inserted batch
        parent.appendChild(batchFragment);
        offset = end;
        if (offset < arr.length) {
          requestAnimationFrame(renderBatch);
        }
      }

      if (offset < arr.length) {
        requestAnimationFrame(renderBatch);
      }
      parent.removeChild(el);
      return true;
    } else {
      for (var j = 0; j < arr.length; j++) {
        renderItem(arr[j], j);
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
  function processBindingsInTree(root, ctx) {
    // Use a targeted selector instead of querySelectorAll("*") so we only
    // visit elements that actually have xh-* attributes.
    var elements = Array.prototype.slice.call(root.querySelectorAll(buildCloneSelector(root)));
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
    var elements = Array.prototype.slice.call(root.querySelectorAll(selector));
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
  function parseTrigger(raw) {
    if (!raw || !raw.trim()) return [];

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
      var formData = new FormData(form);
      formData.forEach(function (value, key) {
        body[key] = value;
      });
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
    if (exact) return exact;

    // 2. class (4xx, 5xx) on element
    var cls = Math.floor(status / 100) + "xx";
    var classAttr = el.getAttribute("xh-error-template-" + cls);
    if (classAttr) return classAttr;

    // 3. generic on element
    var generic = el.getAttribute("xh-error-template");
    if (generic) return generic;

    // 4. nearest ancestor xh-error-boundary
    var boundary = findErrorBoundary(el, status);
    if (boundary) return boundary.template;

    // 5. global config
    if (config.defaultErrorTemplate) return config.defaultErrorTemplate;

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
  function getSwapTarget(el, isError, status) {
    var sel;
    if (isError) {
      // 1. Element-level xh-error-target
      sel = el.getAttribute("xh-error-target");
      if (sel) {
        var t = document.querySelector(sel);
        if (t) return t;
      }

      // 2. Error boundary target
      if (status) {
        var boundary = findErrorBoundary(el, status);
        if (boundary) {
          var bTarget = boundary.boundaryEl.getAttribute("xh-error-target");
          if (bTarget) {
            var bt = document.querySelector(bTarget);
            if (bt) return bt;
          }
          // If boundary has no xh-error-target, swap into the boundary itself
          return boundary.boundaryEl;
        }
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
  function cleanupBeforeSwap(container, includeContainer) {
    // Clean up elements inside the container
    var all = container.querySelectorAll("*");
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
        cleanupBeforeSwap(target, false);
        if (config.cspSafe) {
          while (target.firstChild) target.removeChild(target.firstChild);
        } else {
          target.innerHTML = "";
        }
        target.appendChild(fragment);
        return target;

      case "outerHTML":
        cleanupBeforeSwap(target, true);
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
        target.innerHTML = "";
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
  function renderTemplate(html, ctx) {
    // 1. Parse into fragment (no global interpolation — that would replace
    //    {{field}} inside xh-* attributes with the wrong context)
    var container = document.createElement("div");

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

    // 2. Process directives in the fragment
    // We need a temporary container because DocumentFragment doesn't support
    // querySelectorAll with :scope or certain traversals in all browsers.

    // 2a. Interpolate {{field}} in text nodes and non-xh-* attributes only.
    //     This leaves xh-get URLs, xh-text values, etc. for later processing
    //     with the correct per-item data context.
    interpolateDOM(container, ctx);

    // Instead of two querySelectorAll calls, do one pass
    var allEls = Array.prototype.slice.call(container.querySelectorAll("*"));
    var eachEls = [];
    var bindEls = [];

    for (var p = 0; p < allEls.length; p++) {
      if (allEls[p].hasAttribute("xh-each")) {
        eachEls.push(allEls[p]);
      } else {
        bindEls.push(allEls[p]);
      }
    }

    // Process xh-each first (top-level only, they handle their own children)
    for (var i = 0; i < eachEls.length; i++) {
      if (!eachEls[i].parentNode) continue;
      // Only process top-level xh-each (not nested inside another xh-each)
      var isNested = false;
      var check = eachEls[i].parentNode;
      while (check && check !== container) {
        if (check.hasAttribute && check.hasAttribute("xh-each")) {
          isNested = true;
          break;
        }
        check = check.parentNode;
      }
      if (!isNested) {
        processEach(eachEls[i], ctx);
      }
    }

    // Process other bindings (skip elements already handled by xh-each)
    for (var j = 0; j < bindEls.length; j++) {
      if (!bindEls[j].parentNode) continue;
      // Skip elements with REST verbs — they will be processed by processNode
      if (getRestVerb(bindEls[j])) continue;
      // Skip elements created by xh-each — they were already bound with the
      // correct per-item context inside processEach.
      // Only the clone root is marked, so check via closest().
      if (bindEls[j].closest && bindEls[j].closest("[data-xh-each-item]")) continue;
      if (!bindEls[j].closest && bindEls[j].hasAttribute("data-xh-each-item")) continue;
      applyBindings(bindEls[j], ctx);
    }

    // Move children back into a new fragment
    var resultFragment = document.createDocumentFragment();
    while (container.firstChild) {
      resultFragment.appendChild(container.firstChild);
    }
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
    var newEls = processTarget.querySelectorAll ? Array.prototype.slice.call(processTarget.querySelectorAll("*")) : [];
    if (processTarget.classList) newEls.unshift(processTarget);

    for (var se = 0; se < newEls.length; se++) {
      if (newEls[se].classList) newEls[se].classList.add("xh-added");
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
      if (pattern && value && !new RegExp(pattern).test(value)) {
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
          // Use cached response — create a fake Response-like object
          var fakeResponse = {
            ok: true, status: 200, statusText: "OK (cached)",
            text: function () { return Promise.resolve(cached.data); }
          };
          processFetchResponse(fakeResponse);
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

        // Cache the response if xh-cache is set
        if (cacheAttr && restInfo.verb === "GET" && bodyText) {
          responseCache.set(cacheKey, { data: bodyText, timestamp: Date.now() });
        }

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

    // Resolve error template
    var errorTemplateUrl = resolveErrorTemplate(el, status);

    if (!errorTemplateUrl) {
      // No error template — just add error class
      el.classList.add(config.errorClass);
      return;
    }

    // Fetch and render error template
    fetchTemplate(errorTemplateUrl)
      .then(function (html) {
        var fragment = renderTemplate(html, errorCtx);
        var errorTarget = getSwapTarget(el, true, status);
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
  var resizeGlobalTimer = null;
  var resizeGlobalDelay = 300;
  var resizeListenerAttached = false;

  function globalResizeHandler() {
    clearTimeout(resizeGlobalTimer);
    resizeGlobalTimer = setTimeout(function() {
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
        new FormData(form).forEach(function(v, k) { data[k] = v; });
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
          target.innerHTML = text;
          processNode(target, ctx, []);
          return;
        }
        var childCtx = new DataContext(jsonData, ctx);
        var templateUrl = boostContainer.getAttribute("xh-boost-template");
        if (templateUrl) {
          fetchTemplate(templateUrl).then(function(html) {
            var fragment = renderTemplate(html, childCtx);
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
      var body = {};
      new FormData(form).forEach(function(v, k) { body[k] = v; });

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
   * Uses a compound CSS selector for known attributes (fast path) and only
   * falls back to manual scanning for dynamic attributes (xh-attr-*, xh-on-*,
   * xh-class-*, xh-i18n-*).
   * @param {Element} root
   * @returns {Element[]}
   */
  function gatherXhElements(root) {
    var seen = new Set();
    var results = [];

    // Fast path: use native CSS selector for known xh-* attributes
    var known = root.querySelectorAll(XH_KNOWN_SELECTOR);
    for (var i = 0; i < known.length; i++) {
      seen.add(known[i]);
      results.push(known[i]);
    }

    // Slow path: scan for dynamic xh-attr-*, xh-on-*, xh-class-*, xh-i18n-*
    // Only needed if elements use these wildcard attribute patterns
    var all = root.querySelectorAll("*");
    for (var j = 0; j < all.length; j++) {
      if (seen.has(all[j])) continue;
      var attrs = all[j].attributes;
      for (var k = 0; k < attrs.length; k++) {
        var name = attrs[k].name;
        if (name.indexOf("xh-attr-") === 0 || name.indexOf("xh-on-") === 0 ||
            name.indexOf("xh-class-") === 0 || name.indexOf("xh-i18n-") === 0 ||
            name.indexOf("xh-error-template-") === 0 || name.indexOf("xh-template-") === 0) {
          results.push(all[j]);
          break;
        }
      }
    }

    return results;
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

    // -- xh-on-* event handlers -----------------------------------------------
    var onAttrs = [];
    for (var oa = 0; oa < el.attributes.length; oa++) {
      if (el.attributes[oa].name.indexOf("xh-on-") === 0) {
        onAttrs.push({
          event: el.attributes[oa].name.slice(6),
          action: el.attributes[oa].value
        });
      }
    }
    for (var ob = 0; ob < onAttrs.length; ob++) {
      attachOnHandler(el, onAttrs[ob].event, onAttrs[ob].action);
    }

    // -- analytics tracking -----------------------------------------------------
    if (el.hasAttribute("xh-track")) {
      setupTrack(el, ctx);
    }
    if (el.hasAttribute("xh-track-view")) {
      setupTrackView(el, ctx);
    }

    // -- i18n support -----------------------------------------------------------
    if (el.hasAttribute("xh-i18n") || checkElementForI18nAttr(el)) {
      applyI18n(el);
    }

    if (el.hasAttribute("xh-ws")) {
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
   * @param {Element} el
   * @returns {boolean}
   */
  // Reuse the same compound selector for detection.
  var XH_DETECT_SELECTOR = XH_KNOWN_SELECTOR;

  function hasXhAttributes(el) {
    // Skip nodes owned by xhtmlx (inserted via swap/render)
    if (el.hasAttribute && el.hasAttribute("data-xh-owned")) return false;
    // Check the element itself (fast path — avoids full subtree scan)
    if (checkElementForXh(el)) return true;
    // Single check using querySelector (stops at first match)
    if (el.querySelectorAll) {
      // Fast path covers all known fixed-name attributes
      if (el.querySelector(XH_DETECT_SELECTOR)) return true;
      // Fallback for dynamic wildcard attrs (xh-attr-*, xh-on-*, xh-class-*, xh-i18n-*)
      var all = el.querySelectorAll("*");
      for (var i = 0; i < all.length; i++) {
        if (checkElementForXh(all[i])) return true;
      }
    }
    return false;
  }

  /**
   * Check if a single element has any xh-* attribute.
   * @param {Element} el
   * @returns {boolean}
   */
  function checkElementForXh(el) {
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

  function applyI18n(root) {
    var els = root.querySelectorAll("[xh-i18n]");
    for (var i = 0; i < els.length; i++) {
      var key = els[i].getAttribute("xh-i18n");
      var vars = els[i].getAttribute("xh-i18n-vars");
      var parsedVars = null;
      if (vars) {
        try { parsedVars = JSON.parse(vars); } catch(e) { /* ignore */ }
      }
      els[i].textContent = i18n.t(key, parsedVars);
    }

    // xh-i18n-{attr} for attribute translations
    // Fast path: use targeted selectors for common i18n attribute names
    var targeted = root.querySelectorAll(I18N_ATTR_SELECTOR);
    var seen = new Set();
    for (var t = 0; t < targeted.length; t++) {
      seen.add(targeted[t]);
      applyI18nAttrs(targeted[t]);
    }

    // Slow path: scan for uncommon xh-i18n-* attributes
    var all = root.querySelectorAll("*");
    for (var j = 0; j < all.length; j++) {
      if (seen.has(all[j])) continue;
      if (checkElementForI18nAttr(all[j])) {
        applyI18nAttrs(all[j]);
      }
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
                  router._outlet.innerHTML = "";
                  router._outlet.appendChild(fragment);
                  processNode(router._outlet, childCtx, []);
                });
              }
            });
          } else if (route.template) {
            fetchTemplate(route.template).then(function(html) {
              var fragment = renderTemplate(html, ctx);
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
          router._outlet.innerHTML = "";
          router._outlet.appendChild(fragment);
        });
      }

      emitEvent(document.body, "xh:routeNotFound", { path: path }, false);
    }
  };

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

  if (typeof window !== "undefined") {
    window.addEventListener("popstate", function (e) {
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
                target.innerHTML = "";
                target.appendChild(fragment);
                processNode(target, ctx, []);
              });
            }
          }).catch(function () {});
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Breakpoint change detection — emits xh:breakpointChanged on resize
  // ---------------------------------------------------------------------------

  if (typeof window !== "undefined") {
    var lastBreakpoint = getCurrentBreakpoint();
    var bpTimer = null;
    window.addEventListener("resize", function() {
      clearTimeout(bpTimer);
      bpTimer = setTimeout(function() {
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
      }, 200);
    });
  }

})();
