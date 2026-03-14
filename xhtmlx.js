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
    defaultErrorTarget: null    // Global fallback error target CSS selector
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
      ".xh-request .xh-indicator, .xh-request.xh-indicator { opacity: 1; }\n";
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
    if (templateCache.has(url)) return templateCache.get(url);
    var promise = fetch(url).then(function (res) {
      if (!res.ok) throw new Error("Template fetch failed: " + url + " (" + res.status + ")");
      return res.text();
    });
    templateCache.set(url, promise);
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
    }

    // -- xh-html --------------------------------------------------------------
    var htmlAttr = el.getAttribute("xh-html");
    if (htmlAttr != null) {
      var hv = ctx.resolve(htmlAttr);
      el.innerHTML = hv != null ? String(hv) : "";
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
      var itemCtx = new DataContext(item, ctx, idx);
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

    // Mark request in-flight
    var state = elementStates.get(el);
    if (state) state.requestInFlight = true;

    // Interpolate URL with URI encoding
    var url = interpolate(restInfo.url, ctx, true);

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

    fetch(url, fetchOpts)
      .then(function (response) {
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

          var childCtx = new DataContext(jsonData, ctx);

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

            // Store data context on element
            if (state) state.dataContext = childCtx;
          });
        });
      })
      .catch(function (err) {
        console.error("[xhtmlx] request failed:", url, err);
        handleError(el, ctx, 0, "Network Error", err.message, templateStack);
      })
      .finally(function () {
        hideIndicator(el);
        if (state) state.requestInFlight = false;
      });
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
      "[xh-error-template]", "[xh-error-target]"
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
            attrs[k].name.indexOf("xh-error-template-") === 0) {
          results.push(allEls[j]);
          seen.add(allEls[j]);
          break;
        }
      }
    }

    return results;
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
     * Interpolate a string using a data context.
     * @param {string}      str
     * @param {DataContext}  ctx
     * @param {boolean}      uriEncode
     * @returns {string}
     */
    interpolate: function (str, ctx, uriEncode) {
      return interpolate(str, ctx, !!uriEncode);
    },

    /** Internal version string */
    version: "0.1.0",

    // --- Internals exposed for testing (not part of the public API) ----------
    _internals: {
      DataContext: DataContext,
      interpolate: interpolate,
      parseTrigger: parseTrigger,
      parseTimeValue: parseTimeValue,
      renderTemplate: renderTemplate,
      applyBindings: applyBindings,
      processEach: processEach,
      processBindingsInTree: processBindingsInTree,
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
      elementStates: elementStates,
      generationMap: generationMap,
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

})();
