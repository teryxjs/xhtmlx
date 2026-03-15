/**
 * @jest-environment jsdom
 */

const xhtmlx = require('../../xhtmlx.js');
const { DataContext, getRestVerb, buildRequestBody, getSwapTarget } = xhtmlx._internals;

describe('getRestVerb', () => {
  describe('detects REST verb attributes', () => {
    it('detects xh-get', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-get', '/api/items');
      const result = getRestVerb(el);

      expect(result).not.toBeNull();
      expect(result.verb).toBe('GET');
      expect(result.url).toBe('/api/items');
    });

    it('detects xh-post', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-post', '/api/items');
      const result = getRestVerb(el);

      expect(result).not.toBeNull();
      expect(result.verb).toBe('POST');
      expect(result.url).toBe('/api/items');
    });

    it('detects xh-put', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-put', '/api/items/1');
      const result = getRestVerb(el);

      expect(result).not.toBeNull();
      expect(result.verb).toBe('PUT');
      expect(result.url).toBe('/api/items/1');
    });

    it('detects xh-delete', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-delete', '/api/items/1');
      const result = getRestVerb(el);

      expect(result).not.toBeNull();
      expect(result.verb).toBe('DELETE');
      expect(result.url).toBe('/api/items/1');
    });

    it('detects xh-patch', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-patch', '/api/items/1');
      const result = getRestVerb(el);

      expect(result).not.toBeNull();
      expect(result.verb).toBe('PATCH');
      expect(result.url).toBe('/api/items/1');
    });
  });

  describe('returns correct method', () => {
    it('returns uppercase method name', () => {
      const el = document.createElement('button');
      el.setAttribute('xh-post', '/api/submit');
      expect(getRestVerb(el).verb).toBe('POST');
    });

    it('returns the URL from the attribute value', () => {
      const el = document.createElement('button');
      el.setAttribute('xh-get', '/api/data?page=1');
      expect(getRestVerb(el).url).toBe('/api/data?page=1');
    });
  });

  describe('returns null when no verb', () => {
    it('returns null for element without REST attributes', () => {
      const el = document.createElement('div');
      expect(getRestVerb(el)).toBeNull();
    });

    it('returns null for element with non-REST xh attributes', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-text', 'name');
      expect(getRestVerb(el)).toBeNull();
    });

    it('returns null for element with regular attributes', () => {
      const el = document.createElement('div');
      el.setAttribute('class', 'something');
      el.setAttribute('data-value', '123');
      expect(getRestVerb(el)).toBeNull();
    });
  });

  describe('priority of REST verb detection', () => {
    it('returns first detected verb when multiple are present', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-get', '/api/get');
      el.setAttribute('xh-post', '/api/post');
      const result = getRestVerb(el);

      // Should return the first one found in REST_VERBS order
      expect(result.verb).toBe('GET');
      expect(result.url).toBe('/api/get');
    });
  });
});

describe('buildRequestBody', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('serializes form fields', () => {
    it('serializes input fields from a form', () => {
      const form = document.createElement('form');
      const input = document.createElement('input');
      input.name = 'username';
      input.value = 'Alice';
      form.appendChild(input);
      container.appendChild(form);

      const ctx = new DataContext({});
      const body = buildRequestBody(form, ctx);
      const parsed = JSON.parse(body);

      expect(parsed.username).toBe('Alice');
    });

    it('serializes multiple fields', () => {
      const form = document.createElement('form');
      const input1 = document.createElement('input');
      input1.name = 'first';
      input1.value = 'John';
      const input2 = document.createElement('input');
      input2.name = 'last';
      input2.value = 'Doe';
      form.appendChild(input1);
      form.appendChild(input2);
      container.appendChild(form);

      const ctx = new DataContext({});
      const body = buildRequestBody(form, ctx);
      const parsed = JSON.parse(body);

      expect(parsed.first).toBe('John');
      expect(parsed.last).toBe('Doe');
    });

    it('serializes textarea fields', () => {
      const form = document.createElement('form');
      const textarea = document.createElement('textarea');
      textarea.name = 'content';
      textarea.value = 'Hello World';
      form.appendChild(textarea);
      container.appendChild(form);

      const ctx = new DataContext({});
      const body = buildRequestBody(form, ctx);
      const parsed = JSON.parse(body);

      expect(parsed.content).toBe('Hello World');
    });

    it('finds form when button is inside form', () => {
      const form = document.createElement('form');
      const input = document.createElement('input');
      input.name = 'field';
      input.value = 'value';
      const button = document.createElement('button');
      form.appendChild(input);
      form.appendChild(button);
      container.appendChild(form);

      const ctx = new DataContext({});
      const body = buildRequestBody(button, ctx);
      const parsed = JSON.parse(body);

      expect(parsed.field).toBe('value');
    });
  });

  describe('merges xh-vals', () => {
    it('includes values from xh-vals JSON', () => {
      const el = document.createElement('button');
      el.setAttribute('xh-vals', '{"key": "value"}');
      container.appendChild(el);

      const ctx = new DataContext({});
      const body = buildRequestBody(el, ctx);
      const parsed = JSON.parse(body);

      expect(parsed.key).toBe('value');
    });

    it('merges xh-vals with form data', () => {
      const form = document.createElement('form');
      const input = document.createElement('input');
      input.name = 'formField';
      input.value = 'formValue';
      const button = document.createElement('button');
      button.setAttribute('xh-vals', '{"extra": "extraValue"}');
      form.appendChild(input);
      form.appendChild(button);
      container.appendChild(form);

      const ctx = new DataContext({});
      const body = buildRequestBody(button, ctx);
      const parsed = JSON.parse(body);

      expect(parsed.formField).toBe('formValue');
      expect(parsed.extra).toBe('extraValue');
    });

    it('xh-vals overrides form data with same key', () => {
      const form = document.createElement('form');
      const input = document.createElement('input');
      input.name = 'key';
      input.value = 'fromForm';
      const button = document.createElement('button');
      button.setAttribute('xh-vals', '{"key": "fromVals"}');
      form.appendChild(input);
      form.appendChild(button);
      container.appendChild(form);

      const ctx = new DataContext({});
      const body = buildRequestBody(button, ctx);
      const parsed = JSON.parse(body);

      expect(parsed.key).toBe('fromVals');
    });

    it('interpolates values in xh-vals', () => {
      const el = document.createElement('button');
      el.setAttribute('xh-vals', '{"id": "{{itemId}}"}');
      container.appendChild(el);

      const ctx = new DataContext({ itemId: '42' });
      const body = buildRequestBody(el, ctx);
      const parsed = JSON.parse(body);

      expect(parsed.id).toBe('42');
    });

    it('handles numeric values in xh-vals', () => {
      const el = document.createElement('button');
      el.setAttribute('xh-vals', '{"count": 5}');
      container.appendChild(el);

      const ctx = new DataContext({});
      const body = buildRequestBody(el, ctx);
      const parsed = JSON.parse(body);

      expect(parsed.count).toBe(5);
    });
  });

  describe('returns JSON string', () => {
    it('returns valid JSON string', () => {
      const el = document.createElement('div');
      container.appendChild(el);

      const ctx = new DataContext({});
      const body = buildRequestBody(el, ctx);

      expect(() => JSON.parse(body)).not.toThrow();
    });

    it('returns empty object JSON for element without form or xh-vals', () => {
      const el = document.createElement('div');
      container.appendChild(el);

      const ctx = new DataContext({});
      const body = buildRequestBody(el, ctx);

      expect(JSON.parse(body)).toEqual({});
    });
  });
});

describe('getSwapTarget', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('with xh-target attribute', () => {
    it('returns the element matching xh-target selector', () => {
      const target = document.createElement('div');
      target.id = 'result';
      container.appendChild(target);

      const el = document.createElement('button');
      el.setAttribute('xh-target', '#result');
      container.appendChild(el);

      const result = getSwapTarget(el, false);
      expect(result).toBe(target);
    });

    it('returns the element for class selector', () => {
      const target = document.createElement('div');
      target.className = 'output';
      container.appendChild(target);

      const el = document.createElement('button');
      el.setAttribute('xh-target', '.output');
      container.appendChild(el);

      const result = getSwapTarget(el, false);
      expect(result).toBe(target);
    });
  });

  describe('with xh-error-target for errors', () => {
    it('uses xh-error-target when isError is true', () => {
      const errorTarget = document.createElement('div');
      errorTarget.id = 'errors';
      container.appendChild(errorTarget);

      const regularTarget = document.createElement('div');
      regularTarget.id = 'content';
      container.appendChild(regularTarget);

      const el = document.createElement('button');
      el.setAttribute('xh-target', '#content');
      el.setAttribute('xh-error-target', '#errors');
      container.appendChild(el);

      const result = getSwapTarget(el, true);
      expect(result).toBe(errorTarget);
    });

    it('falls back to xh-target when xh-error-target is missing and isError is true', () => {
      const target = document.createElement('div');
      target.id = 'content';
      container.appendChild(target);

      const el = document.createElement('button');
      el.setAttribute('xh-target', '#content');
      container.appendChild(el);

      const result = getSwapTarget(el, true);
      expect(result).toBe(target);
    });

    it('ignores xh-error-target when isError is false', () => {
      const errorTarget = document.createElement('div');
      errorTarget.id = 'errors';
      container.appendChild(errorTarget);

      const regularTarget = document.createElement('div');
      regularTarget.id = 'content';
      container.appendChild(regularTarget);

      const el = document.createElement('button');
      el.setAttribute('xh-target', '#content');
      el.setAttribute('xh-error-target', '#errors');
      container.appendChild(el);

      const result = getSwapTarget(el, false);
      expect(result).toBe(regularTarget);
    });
  });

  describe('falls back to element itself', () => {
    it('returns the element when no xh-target set', () => {
      const el = document.createElement('div');
      container.appendChild(el);

      const result = getSwapTarget(el, false);
      expect(result).toBe(el);
    });

    it('returns the element when xh-target selector matches nothing', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-target', '#nonexistent');
      container.appendChild(el);

      const result = getSwapTarget(el, false);
      expect(result).toBe(el);
    });

    it('returns the element when xh-error-target matches nothing and isError is true', () => {
      const el = document.createElement('div');
      el.setAttribute('xh-error-target', '#nonexistent');
      container.appendChild(el);

      const result = getSwapTarget(el, true);
      expect(result).toBe(el);
    });
  });
});
