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
    uiVersion: null             // Current UI version identifier (any string)
  };

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

  // ---------------------------------------------------------------------------
  // Default CSS injection
  // ---------------------------------------------------------------------------
  function injectDefaultCSS() {
    var id = "xhtmlx-default-css";
    if (document.getElementById(id)) return;
    var style = document.createElement("style");
    style.id = id;
    style.textContent =
      ".xh-indicator { opacity: 0; transition: opacity 200ms ease-in; }\n" +
      ".xh-request .xh-indicator, .xh-request.xh-indicator { opacity: 1; }\n" +
      ".xh-added { }\n" +
      ".xh-settled { }\n";
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

    var parts = path.split(".");

    // --- special variables ---------------------------------------------------
    if (parts[0] === "$index") {
      if (parts.length === 1) return this.index;
      // $index doesn't have sub-properties
      return undefined;
    }

    if (parts[0] === "$parent") {
      if (!this.parent) return undefined;
      if (parts.length === 1) return this.parent.data;
      return this.parent.resolve(parts.slice(1).join("."));
    }

    if (parts[0] === "$root") {
      var root = this;
      while (root.parent) root = root.parent;
      if (parts.length === 1) return root.data;
      return root.resolve(parts.slice(1).join("."));
    }

    // --- local lookup --------------------------------------------------------
    var value = resolveDot(this.data, parts);
    if (value !== undefined) return value;

    // --- walk parent chain ---------------------------------------------------
    if (this.parent) return this.parent.resolve(path);

    return undefined;
  };

  /**
   * Resolve a dotted path against a plain object.
   * @param {Object} obj
   * @param {string[]} parts
   * @returns {*}
   */
  function resolveDot(obj, parts) {
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
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
    var textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }
    for (var t = 0; t < textNodes.length; t++) {
      var node = textNodes[t];
      if (INTERP_RE.test(node.nodeValue)) {
        node.nodeValue = interpolate(node.nodeValue, ctx, false);
      }
    }

    // Interpolate non-xh-* attributes on all elements
    var elements = root.querySelectorAll("*");
    for (var e = 0; e < elements.length; e++) {
      var attrs = elements[e].attributes;
      for (var a = 0; a < attrs.length; a++) {
        var name = attrs[a].name;
        // Skip xh-* attributes — they are processed by directives/executeRequest
        if (name.indexOf("xh-") === 0) continue;
        if (INTERP_RE.test(attrs[a].value)) {
          attrs[a].value = interpolate(attrs[a].value, ctx, false);
        }
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
  function applyBindings(el, ctx) {
    // -- xh-show ----------------------------------------------------------------
    var showAttr = el.getAttribute("xh-show");
    if (showAttr != null) {
      var sval = ctx.resolve(showAttr);
      el.style.display = sval ? "" : "none";
      if (ctx instanceof MutableDataContext) {
        (function(field, element, context) {
          context.subscribe(field, function() {
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
          context.subscribe(field, function() {
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
          context.subscribe(field, function() {
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
      el.innerHTML = hv != null ? String(hv) : "";
      if (ctx instanceof MutableDataContext) {
        (function(field, element, context) {
          context.subscribe(field, function() {
            var newVal = context.resolve(field);
            element.innerHTML = newVal != null ? String(newVal) : "";
          });
        })(htmlAttr, el, ctx);
      }
    }

    // -- xh-attr-* ------------------------------------------------------------
    var attrs = el.attributes;
    for (var i = attrs.length - 1; i >= 0; i--) {
      var aName = attrs[i].name;
      if (aName.indexOf("xh-attr-") === 0) {
        var targetAttr = aName.slice(8); // after "xh-attr-"
        var aval = ctx.resolve(attrs[i].value);
        if (aval != null) {
          el.setAttribute(targetAttr, String(aval));
        }
        if (ctx instanceof MutableDataContext) {
          (function(field, tAttr, element, context) {
            context.subscribe(field, function() {
              var newVal = context.resolve(field);
              if (newVal != null) {
                element.setAttribute(tAttr, String(newVal));
              }
            });
          })(attrs[i].value, targetAttr, el, ctx);
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

    // -- xh-class-* -------------------------------------------------------------
    for (var c = attrs.length - 1; c >= 0; c--) {
      var cName = attrs[c].name;
      if (cName.indexOf("xh-class-") === 0) {
        var className = cName.slice(9); // after "xh-class-"
        var cval = ctx.resolve(attrs[c].value);
        if (cval) {
          el.classList.add(className);
        } else {
          el.classList.remove(className);
        }
        if (ctx instanceof MutableDataContext) {
          (function(field, clsName, element, context) {
            context.subscribe(field, function() {
              var newVal = context.resolve(field);
              if (newVal) {
                element.classList.add(clsName);
              } else {
                element.classList.remove(clsName);
              }
            });
          })(attrs[c].value, className, el, ctx);
        }
      }
    }

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

    var fragment = document.createDocumentFragment();

    var renderItem = function (item, idx) {
      var clone = el.cloneNode(true);
      // Mark clone so renderTemplate's second pass doesn't rebind with wrong context
      clone.setAttribute("data-xh-each-item", "");
      var ItemCtxClass = (ctx instanceof MutableDataContext) ? MutableDataContext : DataContext;
      var itemCtx = new ItemCtxClass(item, ctx, idx);
      applyBindings(clone, itemCtx);
      // Process children bindings
      processBindingsInTree(clone, itemCtx);
      // Recursively process for nested REST verb elements
      processNode(clone, itemCtx);
      fragment.appendChild(clone);
    };

    if (arr.length > config.batchThreshold) {
      // For large arrays we still render synchronously for simplicity but
      // could be enhanced with rAF batching in a future version.
      for (var i = 0; i < arr.length; i++) {
        renderItem(arr[i], i);
      }
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
    // Collect elements that need processing. We snapshot because DOM
    // mutations (xh-each, xh-if) can modify the live list.
    var elements = Array.prototype.slice.call(root.querySelectorAll("*"));
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
    if (!sel) return;
    var ind = document.querySelector(sel);
    if (ind) ind.classList.add(config.requestClass);
  }

  function hideIndicator(el) {
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
        target.innerHTML = "";
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
    var tpl = document.createElement("template");
    tpl.innerHTML = html;
    var fragment = document.importNode(tpl.content, true);

    // 2. Process directives in the fragment
    // We need a temporary container because DocumentFragment doesn't support
    // querySelectorAll with :scope or certain traversals in all browsers.
    var container = document.createElement("div");
    container.appendChild(fragment);

    // 2a. Interpolate {{field}} in text nodes and non-xh-* attributes only.
    //     This leaves xh-get URLs, xh-text values, etc. for later processing
    //     with the correct per-item data context.
    interpolateDOM(container, ctx);

    // Process xh-each first (top-level only, they handle their own children)
    var eachEls = Array.prototype.slice.call(container.querySelectorAll("[xh-each]"));
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
    var allEls = Array.prototype.slice.call(container.querySelectorAll("*"));
    for (var j = 0; j < allEls.length; j++) {
      if (!allEls[j].parentNode) continue;
      // Skip elements that still have xh-each (shouldn't happen, but guard)
      if (allEls[j].hasAttribute("xh-each")) continue;
      // Skip elements with REST verbs — they will be processed by processNode
      if (getRestVerb(allEls[j])) continue;
      // Skip elements created by xh-each — they were already bound with the
      // correct per-item context inside processEach
      if (allEls[j].hasAttribute("data-xh-each-item") ||
          allEls[j].closest("[data-xh-each-item]")) continue;
      applyBindings(allEls[j], ctx);
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
  function applySettleClasses(processTarget) {
    if (!processTarget) return;
    var newEls = processTarget.querySelectorAll ? Array.prototype.slice.call(processTarget.querySelectorAll("*")) : [];
    if (processTarget.classList) newEls.unshift(processTarget);

    for (var se = 0; se < newEls.length; se++) {
      if (newEls[se].classList) newEls[se].classList.add("xh-added");
    }

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
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

    // Show indicator
    showIndicator(el);

    // xh-disabled-class: add CSS class while request is in-flight
    var disabledClass = el.getAttribute("xh-disabled-class");
    if (disabledClass) el.classList.add(disabledClass);

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

    fetchPromise
      .then(processFetchResponse)
      .catch(function (err) {
        console.error("[xhtmlx] request failed:", url, err);
        handleError(el, ctx, 0, "Network Error", err.message, templateStack);
      })
      .finally(function () {
        hideIndicator(el);
        if (disabledClass) el.classList.remove(disabledClass);
        if (state) state.requestInFlight = false;
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

            var processTarget = performSwap(target, fragment, swapMode);

            // Apply settle classes to newly added elements
            applySettleClasses(processTarget);

            // Recursively process new content
            if (processTarget) {
              processNode(processTarget, childCtx, tmpl.templateStack);
            }

            // Emit xh:afterSwap
            emitEvent(el, "xh:afterSwap", { target: target }, false);

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

        var processTarget = performSwap(errorTarget, fragment, swapMode);

        // Apply settle classes to newly added error elements
        applySettleClasses(processTarget);

        if (processTarget) {
          processNode(processTarget, errorCtx, templateStack);
        }

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

  /**
   * Gather elements that have xh-* attributes within a root node.
   * @param {Element} root
   * @returns {Element[]}
   */
  function gatherXhElements(root) {
    // We need a comprehensive selector for any element with xh-* attributes
    var selectors = [
      "[xh-get]", "[xh-post]", "[xh-put]", "[xh-delete]", "[xh-patch]",
      "[xh-text]", "[xh-html]", "[xh-each]", "[xh-if]", "[xh-unless]",
      "[xh-trigger]", "[xh-template]", "[xh-target]", "[xh-swap]",
      "[xh-indicator]", "[xh-vals]", "[xh-headers]",
      "[xh-error-template]", "[xh-error-target]",
      "[xh-model]", "[xh-show]", "[xh-hide]",
      "[xh-disabled-class]",
      "[xh-push-url]", "[xh-replace-url]",
      "[xh-cache]",
      "[xh-retry]",
      "[xh-ws]", "[xh-ws-send]",
      "[xh-boost]"
    ];

    // Also match xh-attr-* and xh-error-template-*
    var results = [];
    var all;
    try {
      all = root.querySelectorAll(selectors.join(","));
    } catch (_) {
      all = root.querySelectorAll("*");
    }

    var seen = new Set();
    for (var i = 0; i < all.length; i++) {
      if (!seen.has(all[i])) {
        seen.add(all[i]);
        results.push(all[i]);
      }
    }

    // Also check for xh-attr-* elements (they won't match the fixed selectors)
    var allEls = root.querySelectorAll("*");
    for (var j = 0; j < allEls.length; j++) {
      if (seen.has(allEls[j])) continue;
      var attrs = allEls[j].attributes;
      for (var k = 0; k < attrs.length; k++) {
        if (attrs[k].name.indexOf("xh-attr-") === 0 ||
            attrs[k].name.indexOf("xh-error-template-") === 0 ||
            attrs[k].name.indexOf("xh-class-") === 0 ||
            attrs[k].name.indexOf("xh-on-") === 0) {
          results.push(allEls[j]);
          seen.add(allEls[j]);
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
    el.addEventListener(event, function(_evt) {
      var parts = actionStr.split(":");
      var action = parts[0];
      var arg = parts.slice(1).join(":");

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
  function hasXhAttributes(el) {
    // Check the element itself
    if (checkElementForXh(el)) return true;
    // Check descendants
    var all = el.querySelectorAll ? el.querySelectorAll("*") : [];
    for (var i = 0; i < all.length; i++) {
      if (checkElementForXh(all[i])) return true;
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

    /** Internal version string */
    version: "0.2.0",

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
      config: config
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
  // Auto-init on DOMContentLoaded (browser only)
  // ---------------------------------------------------------------------------

  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("DOMContentLoaded", function () {
      injectDefaultCSS();
      var rootCtx = new DataContext({});
      processNode(document.body, rootCtx, []);
      setupMutationObserver(rootCtx);
    });
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

})();
