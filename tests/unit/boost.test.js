/**
 * @jest-environment jsdom
 */

const xhtmlx = require('../../xhtmlx.js');
const {
  DataContext,
  boostElement
} = xhtmlx._internals;

// Mock fetch globally
beforeEach(() => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      text: () => Promise.resolve('{"title":"Test Page"}')
    })
  );
});

afterEach(() => {
  delete global.fetch;
});

describe('xh-boost — enhance regular links and forms', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('xh-boost enhances child links with data-xh-boosted attribute', () => {
    const boost = document.createElement('div');
    boost.setAttribute('xh-boost', '');
    boost.innerHTML = '<a href="/page1">Page 1</a><a href="/page2">Page 2</a>';
    container.appendChild(boost);

    const ctx = new DataContext({});
    boostElement(boost, ctx);

    const links = boost.querySelectorAll('a');
    expect(links[0].hasAttribute('data-xh-boosted')).toBe(true);
    expect(links[1].hasAttribute('data-xh-boosted')).toBe(true);
  });

  it('boosted link click prevents default and calls fetch', () => {
    const boost = document.createElement('div');
    boost.setAttribute('xh-boost', '');
    boost.setAttribute('xh-boost-target', '#content');

    const targetDiv = document.createElement('div');
    targetDiv.id = 'content';
    container.appendChild(targetDiv);

    const link = document.createElement('a');
    link.setAttribute('href', '/api/data');
    boost.appendChild(link);
    container.appendChild(boost);

    const ctx = new DataContext({});
    boostElement(boost, ctx);

    // Click the boosted link
    const event = new Event('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);

    expect(global.fetch).toHaveBeenCalledWith('/api/data');
  });

  it('boosted form submit prevents default and calls fetch', () => {
    const boost = document.createElement('div');
    boost.setAttribute('xh-boost', '');
    boost.setAttribute('xh-boost-target', '#result');

    const targetDiv = document.createElement('div');
    targetDiv.id = 'result';
    container.appendChild(targetDiv);

    const form = document.createElement('form');
    form.setAttribute('action', '/api/submit');
    form.setAttribute('method', 'POST');
    const input = document.createElement('input');
    input.name = 'name';
    input.value = 'Alice';
    form.appendChild(input);
    boost.appendChild(form);
    container.appendChild(boost);

    const ctx = new DataContext({});
    boostElement(boost, ctx);

    const event = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(event);

    expect(global.fetch).toHaveBeenCalledWith('/api/submit', expect.objectContaining({
      method: 'POST'
    }));
  });

  it('links with xh-get are NOT boosted', () => {
    const boost = document.createElement('div');
    boost.setAttribute('xh-boost', '');

    const link = document.createElement('a');
    link.setAttribute('href', '/page');
    link.setAttribute('xh-get', '/api/page');
    boost.appendChild(link);
    container.appendChild(boost);

    const ctx = new DataContext({});
    boostElement(boost, ctx);

    expect(link.hasAttribute('data-xh-boosted')).toBe(false);
  });

  it('already boosted links are not re-boosted', () => {
    const boost = document.createElement('div');
    boost.setAttribute('xh-boost', '');

    const link = document.createElement('a');
    link.setAttribute('href', '/page');
    link.setAttribute('data-xh-boosted', '');
    boost.appendChild(link);
    container.appendChild(boost);

    const ctx = new DataContext({});
    boostElement(boost, ctx);

    // Clicking should not use our boosted handler since we skipped it
    // (it was already boosted so we didn't add a new listener)
    // The link count should remain the same
    const links = boost.querySelectorAll('[data-xh-boosted]');
    expect(links.length).toBe(1);
  });

  it('xh-boost-target specifies swap target for links', (done) => {
    const boost = document.createElement('div');
    boost.setAttribute('xh-boost', '');
    boost.setAttribute('xh-boost-target', '#my-target');

    const targetDiv = document.createElement('div');
    targetDiv.id = 'my-target';
    container.appendChild(targetDiv);

    const link = document.createElement('a');
    link.setAttribute('href', '/api/data');
    boost.appendChild(link);
    container.appendChild(boost);

    // Return HTML that will be treated as non-JSON
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve('<p>Loaded content</p>')
      })
    );

    const ctx = new DataContext({});
    boostElement(boost, ctx);

    link.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));

    setTimeout(() => {
      expect(targetDiv.innerHTML).toBe('<p>Loaded content</p>');
      done();
    }, 50);
  });

  it('hash links are not boosted', () => {
    const boost = document.createElement('div');
    boost.setAttribute('xh-boost', '');

    const link = document.createElement('a');
    link.setAttribute('href', '#section');
    boost.appendChild(link);
    container.appendChild(boost);

    const ctx = new DataContext({});
    boostElement(boost, ctx);

    expect(link.hasAttribute('data-xh-boosted')).toBe(false);
  });

  it('_blank target links are not boosted', () => {
    const boost = document.createElement('div');
    boost.setAttribute('xh-boost', '');

    const link = document.createElement('a');
    link.setAttribute('href', '/page');
    link.setAttribute('target', '_blank');
    boost.appendChild(link);
    container.appendChild(boost);

    const ctx = new DataContext({});
    boostElement(boost, ctx);

    expect(link.hasAttribute('data-xh-boosted')).toBe(false);
  });
});
