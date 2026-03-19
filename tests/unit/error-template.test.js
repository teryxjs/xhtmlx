/**
 * @jest-environment jsdom
 */

const xhtmlx = require('../../xhtmlx.js');
const { resolveErrorTemplate, findErrorBoundary, config } = xhtmlx._internals;

describe('resolveErrorTemplate', () => {
  let el;

  beforeEach(() => {
    el = document.createElement('div');
  });

  describe('exact status code match', () => {
    it('returns template URL for exact 404 match', () => {
      el.setAttribute('xh-error-template-404', '/errors/404.html');
      expect(resolveErrorTemplate(el, 404).template).toBe('/errors/404.html');
    });

    it('returns template URL for exact 500 match', () => {
      el.setAttribute('xh-error-template-500', '/errors/500.html');
      expect(resolveErrorTemplate(el, 500).template).toBe('/errors/500.html');
    });

    it('returns template URL for exact 422 match', () => {
      el.setAttribute('xh-error-template-422', '/errors/422.html');
      expect(resolveErrorTemplate(el, 422).template).toBe('/errors/422.html');
    });

    it('returns template URL for exact 400 match', () => {
      el.setAttribute('xh-error-template-400', '/errors/400.html');
      expect(resolveErrorTemplate(el, 400).template).toBe('/errors/400.html');
    });

    it('returns template URL for exact 503 match', () => {
      el.setAttribute('xh-error-template-503', '/errors/503.html');
      expect(resolveErrorTemplate(el, 503).template).toBe('/errors/503.html');
    });
  });

  describe('class match (Nxx)', () => {
    it('returns template URL for 4xx class match', () => {
      el.setAttribute('xh-error-template-4xx', '/errors/4xx.html');
      expect(resolveErrorTemplate(el, 404).template).toBe('/errors/4xx.html');
    });

    it('returns template URL for 5xx class match', () => {
      el.setAttribute('xh-error-template-5xx', '/errors/5xx.html');
      expect(resolveErrorTemplate(el, 500).template).toBe('/errors/5xx.html');
    });

    it('4xx class matches 400', () => {
      el.setAttribute('xh-error-template-4xx', '/errors/4xx.html');
      expect(resolveErrorTemplate(el, 400).template).toBe('/errors/4xx.html');
    });

    it('4xx class matches 422', () => {
      el.setAttribute('xh-error-template-4xx', '/errors/4xx.html');
      expect(resolveErrorTemplate(el, 422).template).toBe('/errors/4xx.html');
    });

    it('5xx class matches 503', () => {
      el.setAttribute('xh-error-template-5xx', '/errors/5xx.html');
      expect(resolveErrorTemplate(el, 503).template).toBe('/errors/5xx.html');
    });
  });

  describe('generic fallback', () => {
    it('returns generic template when no specific match', () => {
      el.setAttribute('xh-error-template', '/errors/generic.html');
      expect(resolveErrorTemplate(el, 404).template).toBe('/errors/generic.html');
    });

    it('returns generic template for 500 when no specific match', () => {
      el.setAttribute('xh-error-template', '/errors/generic.html');
      expect(resolveErrorTemplate(el, 500).template).toBe('/errors/generic.html');
    });
  });

  describe('resolution order: exact > class > generic', () => {
    it('prefers exact match over class match', () => {
      el.setAttribute('xh-error-template-404', '/errors/404.html');
      el.setAttribute('xh-error-template-4xx', '/errors/4xx.html');
      el.setAttribute('xh-error-template', '/errors/generic.html');

      expect(resolveErrorTemplate(el, 404).template).toBe('/errors/404.html');
    });

    it('prefers class match over generic when no exact match', () => {
      el.setAttribute('xh-error-template-4xx', '/errors/4xx.html');
      el.setAttribute('xh-error-template', '/errors/generic.html');

      expect(resolveErrorTemplate(el, 422).template).toBe('/errors/4xx.html');
    });

    it('falls back to generic when neither exact nor class match', () => {
      el.setAttribute('xh-error-template-404', '/errors/404.html');
      el.setAttribute('xh-error-template-4xx', '/errors/4xx.html');
      el.setAttribute('xh-error-template', '/errors/generic.html');

      expect(resolveErrorTemplate(el, 500).template).toBe('/errors/generic.html');
    });

    it('uses class match for status in same class as exact match for different status', () => {
      el.setAttribute('xh-error-template-404', '/errors/404.html');
      el.setAttribute('xh-error-template-4xx', '/errors/4xx.html');

      expect(resolveErrorTemplate(el, 400).template).toBe('/errors/4xx.html');
    });
  });

  describe('no error template returns null', () => {
    it('returns null when no error template attributes exist', () => {
      expect(resolveErrorTemplate(el, 404)).toBeNull();
    });

    it('returns null for 500 when only 4xx templates exist', () => {
      el.setAttribute('xh-error-template-4xx', '/errors/4xx.html');
      expect(resolveErrorTemplate(el, 500)).toBeNull();
    });

    it('returns null for 400 when only exact 404 exists', () => {
      el.setAttribute('xh-error-template-404', '/errors/404.html');
      expect(resolveErrorTemplate(el, 400)).toBeNull();
    });
  });

  describe('various status codes', () => {
    it('handles 400 Bad Request', () => {
      el.setAttribute('xh-error-template-400', '/errors/400.html');
      expect(resolveErrorTemplate(el, 400).template).toBe('/errors/400.html');
    });

    it('handles 401 Unauthorized via 4xx class', () => {
      el.setAttribute('xh-error-template-4xx', '/errors/4xx.html');
      expect(resolveErrorTemplate(el, 401).template).toBe('/errors/4xx.html');
    });

    it('handles 403 Forbidden via generic', () => {
      el.setAttribute('xh-error-template', '/errors/generic.html');
      expect(resolveErrorTemplate(el, 403).template).toBe('/errors/generic.html');
    });

    it('handles 404 Not Found exact match', () => {
      el.setAttribute('xh-error-template-404', '/errors/not-found.html');
      expect(resolveErrorTemplate(el, 404).template).toBe('/errors/not-found.html');
    });

    it('handles 422 Unprocessable Entity', () => {
      el.setAttribute('xh-error-template-422', '/errors/validation.html');
      expect(resolveErrorTemplate(el, 422).template).toBe('/errors/validation.html');
    });

    it('handles 500 Internal Server Error', () => {
      el.setAttribute('xh-error-template-500', '/errors/server.html');
      expect(resolveErrorTemplate(el, 500).template).toBe('/errors/server.html');
    });

    it('handles 502 Bad Gateway via 5xx class', () => {
      el.setAttribute('xh-error-template-5xx', '/errors/5xx.html');
      expect(resolveErrorTemplate(el, 502).template).toBe('/errors/5xx.html');
    });

    it('handles 503 Service Unavailable', () => {
      el.setAttribute('xh-error-template-503', '/errors/503.html');
      expect(resolveErrorTemplate(el, 503).template).toBe('/errors/503.html');
    });
  });

  describe('error boundary resolution', () => {
    afterEach(() => {
      config.defaultErrorTemplate = null;
      config.defaultErrorTarget = null;
    });

    it('finds error boundary on parent element', () => {
      document.body.innerHTML = `
        <div id="boundary" xh-error-boundary xh-error-template="/errors/boundary.html">
          <div id="child"></div>
        </div>
      `;
      const child = document.getElementById('child');
      const result = findErrorBoundary(child, 404);
      expect(result).not.toBeNull();
      expect(result.template).toBe('/errors/boundary.html');
      expect(result.boundaryEl).toBe(document.getElementById('boundary'));
    });

    it('finds error boundary on grandparent', () => {
      document.body.innerHTML = `
        <div id="boundary" xh-error-boundary xh-error-template="/errors/boundary.html">
          <div>
            <div id="deep-child"></div>
          </div>
        </div>
      `;
      const child = document.getElementById('deep-child');
      const result = findErrorBoundary(child, 500);
      expect(result).not.toBeNull();
      expect(result.template).toBe('/errors/boundary.html');
    });

    it('finds nearest boundary when multiple exist', () => {
      document.body.innerHTML = `
        <div xh-error-boundary xh-error-template="/errors/outer.html">
          <div id="inner" xh-error-boundary xh-error-template="/errors/inner.html">
            <div id="child"></div>
          </div>
        </div>
      `;
      const child = document.getElementById('child');
      const result = findErrorBoundary(child, 404);
      expect(result.template).toBe('/errors/inner.html');
    });

    it('boundary supports status-specific templates', () => {
      document.body.innerHTML = `
        <div id="boundary" xh-error-boundary
             xh-error-template="/errors/generic.html"
             xh-error-template-404="/errors/not-found.html">
          <div id="child"></div>
        </div>
      `;
      const child = document.getElementById('child');
      expect(findErrorBoundary(child, 404).template).toBe('/errors/not-found.html');
      expect(findErrorBoundary(child, 500).template).toBe('/errors/generic.html');
    });

    it('boundary supports class templates (4xx/5xx)', () => {
      document.body.innerHTML = `
        <div xh-error-boundary xh-error-template-4xx="/errors/client.html"
             xh-error-template-5xx="/errors/server.html">
          <div id="child"></div>
        </div>
      `;
      const child = document.getElementById('child');
      expect(findErrorBoundary(child, 400).template).toBe('/errors/client.html');
      expect(findErrorBoundary(child, 422).template).toBe('/errors/client.html');
      expect(findErrorBoundary(child, 500).template).toBe('/errors/server.html');
      expect(findErrorBoundary(child, 503).template).toBe('/errors/server.html');
    });

    it('returns null when no boundary exists', () => {
      document.body.innerHTML = `<div id="child"></div>`;
      const child = document.getElementById('child');
      expect(findErrorBoundary(child, 404)).toBeNull();
    });

    it('skips boundary without matching template', () => {
      document.body.innerHTML = `
        <div xh-error-boundary xh-error-template-404="/errors/404.html">
          <div id="child"></div>
        </div>
      `;
      const child = document.getElementById('child');
      // 500 doesn't match the boundary's 404-only template
      expect(findErrorBoundary(child, 500)).toBeNull();
    });

    it('resolveErrorTemplate falls through to boundary', () => {
      document.body.innerHTML = `
        <div xh-error-boundary xh-error-template="/errors/boundary.html">
          <div id="child"></div>
        </div>
      `;
      const child = document.getElementById('child');
      // child has no element-level error template → boundary should be found
      expect(resolveErrorTemplate(child, 404).template).toBe('/errors/boundary.html');
    });

    it('element-level template wins over boundary', () => {
      document.body.innerHTML = `
        <div xh-error-boundary xh-error-template="/errors/boundary.html">
          <div id="child" xh-error-template="/errors/element.html"></div>
        </div>
      `;
      const child = document.getElementById('child');
      expect(resolveErrorTemplate(child, 404).template).toBe('/errors/element.html');
    });
  });

  describe('global config fallback', () => {
    afterEach(() => {
      config.defaultErrorTemplate = null;
      config.defaultErrorTarget = null;
    });

    it('resolveErrorTemplate uses global config when no element or boundary match', () => {
      config.defaultErrorTemplate = '/errors/global.html';
      document.body.innerHTML = `<div id="child"></div>`;
      const child = document.getElementById('child');
      expect(resolveErrorTemplate(child, 404).template).toBe('/errors/global.html');
    });

    it('boundary wins over global config', () => {
      config.defaultErrorTemplate = '/errors/global.html';
      document.body.innerHTML = `
        <div xh-error-boundary xh-error-template="/errors/boundary.html">
          <div id="child"></div>
        </div>
      `;
      const child = document.getElementById('child');
      expect(resolveErrorTemplate(child, 404).template).toBe('/errors/boundary.html');
    });

    it('element-level wins over both boundary and global', () => {
      config.defaultErrorTemplate = '/errors/global.html';
      document.body.innerHTML = `
        <div xh-error-boundary xh-error-template="/errors/boundary.html">
          <div id="child" xh-error-template="/errors/element.html"></div>
        </div>
      `;
      const child = document.getElementById('child');
      expect(resolveErrorTemplate(child, 404).template).toBe('/errors/element.html');
    });

    it('returns null when no match at any level', () => {
      document.body.innerHTML = `<div id="child"></div>`;
      const child = document.getElementById('child');
      expect(resolveErrorTemplate(child, 404)).toBeNull();
    });
  });
});
