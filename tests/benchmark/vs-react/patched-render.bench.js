/**
 * @jest-environment jsdom
 */

/**
 * Comparison: xhtmlx render() with DOM patching vs React re-render
 *
 * xhtmlx.render() patches bound DOM nodes in place on subsequent calls,
 * similar to how React's reconciler diffs and patches.
 */

const { bench } = require('../bench-helper');
const xhtmlx = require('../../../xhtmlx.js');
const { DataContext } = xhtmlx._internals;
const { h, syncRender, syncUnmount } = require('./react-helper');

describe('vs React: Patched render (DOM diffing)', () => {
  let xhContainer, reactContainer;

  beforeEach(() => {
    xhContainer = document.createElement('div');
    reactContainer = document.createElement('div');
    document.body.appendChild(xhContainer);
    document.body.appendChild(reactContainer);
    xhtmlx.clearTemplateCache();
  });

  afterEach(() => {
    syncUnmount(reactContainer);
    xhContainer.remove();
    reactContainer.remove();
  });

  // --- Single text binding, same data (patch = noop) ---

  test('[xhtmlx render()] single text — same data (patch noop)', () => {
    const html = '<span xh-text="name"></span>';
    const data = { name: 'Alice' };
    bench('xhtmlx render(): 1 text same data', 50000, () => {
      xhtmlx.render(html, data, xhContainer);
    });
  });

  test('[React]             single text — same data', () => {
    const data = { name: 'Alice' };
    bench('React:            1 text same data', 50000, () => {
      syncRender(h('span', null, data.name), reactContainer);
    });
  });

  // --- Single text binding, changing data ---

  test('[xhtmlx render()] single text — changing data', () => {
    const html = '<span xh-text="count"></span>';
    let i = 0;
    bench('xhtmlx render(): 1 text changing', 50000, () => {
      xhtmlx.render(html, { count: i++ }, xhContainer);
    });
  });

  test('[React]             single text — changing data', () => {
    let i = 0;
    bench('React:            1 text changing', 50000, () => {
      syncRender(h('span', null, i++), reactContainer);
    });
  });

  // --- 5 text bindings, same data ---

  test('[xhtmlx render()] 5 texts — same data', () => {
    const html = `<div>
      <span xh-text="a"></span><span xh-text="b"></span>
      <span xh-text="c"></span><span xh-text="d"></span>
      <span xh-text="e"></span></div>`;
    const data = { a: 'A', b: 'B', c: 'C', d: 'D', e: 'E' };
    bench('xhtmlx render(): 5 text same', 20000, () => {
      xhtmlx.render(html, data, xhContainer);
    });
  });

  test('[React]             5 texts — same data', () => {
    const data = { a: 'A', b: 'B', c: 'C', d: 'D', e: 'E' };
    const tree = h('div', null,
      h('span', null, data.a), h('span', null, data.b),
      h('span', null, data.c), h('span', null, data.d),
      h('span', null, data.e)
    );
    bench('React:            5 text same', 20000, () => {
      syncRender(tree, reactContainer);
    });
  });

  // --- 10 text bindings, changing data ---

  test('[xhtmlx render()] 10 texts — changing data', () => {
    const fields = {};
    for (let i = 0; i < 10; i++) fields[`f${i}`] = `v${i}`;
    const html = '<div>' + Array.from({ length: 10 }, (_, i) =>
      `<span xh-text="f${i}"></span>`
    ).join('') + '</div>';
    let n = 0;
    bench('xhtmlx render(): 10 text changing', 10000, () => {
      const data = {};
      for (let i = 0; i < 10; i++) data[`f${i}`] = `v${n + i}`;
      xhtmlx.render(html, data, xhContainer);
      n++;
    });
  });

  test('[React]             10 texts — changing data', () => {
    let n = 0;
    bench('React:            10 text changing', 10000, () => {
      const children = Array.from({ length: 10 }, (_, i) =>
        h('span', { key: i }, `v${n + i}`)
      );
      syncRender(h('div', null, ...children), reactContainer);
      n++;
    });
  });

  // --- Dashboard card (mixed bindings), same data ---

  test('[xhtmlx render()] dashboard card — same data', () => {
    const html = `<div class="card">
      <h3 xh-text="title"></h3>
      <div xh-text="value"></div>
      <span xh-class-up="positive" xh-text="change"></span>
      <a xh-attr-href="link">Details</a></div>`;
    const data = { title: 'Revenue', value: '$12,345', change: '+5%', positive: true, link: '/r' };
    bench('xhtmlx render(): card same', 20000, () => {
      xhtmlx.render(html, data, xhContainer);
    });
  });

  test('[React]             dashboard card — same data', () => {
    const data = { title: 'Revenue', value: '$12,345', change: '+5%', positive: true, link: '/r' };
    bench('React:            card same', 20000, () => {
      syncRender(
        h('div', { className: 'card' },
          h('h3', null, data.title),
          h('div', null, data.value),
          h('span', { className: data.positive ? 'up' : '' }, data.change),
          h('a', { href: data.link }, 'Details')
        ),
        reactContainer
      );
    });
  });

  // --- Dashboard card, changing data ---

  test('[xhtmlx render()] dashboard card — changing data', () => {
    const html = `<div class="card">
      <h3 xh-text="title"></h3>
      <div xh-text="value"></div>
      <span xh-class-up="positive" xh-text="change"></span>
      <a xh-attr-href="link">Details</a></div>`;
    let i = 0;
    bench('xhtmlx render(): card changing', 20000, () => {
      xhtmlx.render(html, {
        title: 'Revenue', value: `$${10000 + i}`,
        change: `+${i % 10}%`, positive: i % 2 === 0,
        link: `/r/${i}`
      }, xhContainer);
      i++;
    });
  });

  test('[React]             dashboard card — changing data', () => {
    let i = 0;
    bench('React:            card changing', 20000, () => {
      syncRender(
        h('div', { className: 'card' },
          h('h3', null, 'Revenue'),
          h('div', null, `$${10000 + i}`),
          h('span', { className: i % 2 === 0 ? 'up' : '' }, `+${i % 10}%`),
          h('a', { href: `/r/${i}` }, 'Details')
        ),
        reactContainer
      );
      i++;
    });
  });

  // --- User profile card (9 bindings), same data ---

  test('[xhtmlx render()] profile card — same data', () => {
    const html = `<div class="profile-card">
      <img xh-attr-src="avatar" xh-attr-alt="name" class="avatar">
      <h2 xh-text="name" xh-class-verified="verified"></h2>
      <p xh-text="role"></p><p xh-text="email"></p>
      <p xh-text="location"></p>
      <span xh-text="posts"></span><span xh-text="followers"></span></div>`;
    const data = {
      name: 'Alice', email: 'a@b.com', avatar: '/a.png', role: 'Dev',
      location: 'SF', verified: true, posts: 142, followers: 1283
    };
    bench('xhtmlx render(): profile same', 10000, () => {
      xhtmlx.render(html, data, xhContainer);
    });
  });

  test('[React]             profile card — same data', () => {
    const d = {
      name: 'Alice', email: 'a@b.com', avatar: '/a.png', role: 'Dev',
      location: 'SF', verified: true, posts: 142, followers: 1283
    };
    bench('React:            profile same', 10000, () => {
      syncRender(
        h('div', { className: 'profile-card' },
          h('img', { src: d.avatar, alt: d.name, className: 'avatar' }),
          h('h2', { className: d.verified ? 'verified' : '' }, d.name),
          h('p', null, d.role), h('p', null, d.email),
          h('p', null, d.location),
          h('span', null, d.posts), h('span', null, d.followers)
        ),
        reactContainer
      );
    });
  });

  // --- Conditional (xh-if) with toggle ---

  test('[xhtmlx render()] conditional — same (no toggle)', () => {
    const html = '<div><div xh-show="show"><span xh-text="name"></span></div></div>';
    const data = { show: true, name: 'Alice' };
    bench('xhtmlx render(): cond same', 20000, () => {
      xhtmlx.render(html, data, xhContainer);
    });
  });

  test('[React]             conditional — same (no toggle)', () => {
    bench('React:            cond same', 20000, () => {
      syncRender(
        h('div', null, h('div', null, h('span', null, 'Alice'))),
        reactContainer
      );
    });
  });
});
