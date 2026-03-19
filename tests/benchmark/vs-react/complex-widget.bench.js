/**
 * @jest-environment jsdom
 */

/**
 * Comparison: Complex realistic widgets
 *
 * Tests that simulate real-world UI patterns:
 * - User profile card
 * - Data table
 * - Navigation menu
 * - Todo list
 */

const { bench } = require('../bench-helper');
const xhtmlx = require('../../../xhtmlx.js');
const { DataContext, renderTemplate, performSwap } = xhtmlx._internals;
const { h, syncRender, syncUnmount } = require('./react-helper');

describe('vs React: Complex widgets', () => {
  let xhContainer, reactContainer;

  beforeEach(() => {
    xhContainer = document.createElement('div');
    reactContainer = document.createElement('div');
    document.body.appendChild(xhContainer);
    document.body.appendChild(reactContainer);
  });

  afterEach(() => {
    syncUnmount(reactContainer);
    xhContainer.remove();
    reactContainer.remove();
  });

  // --- User profile card ---

  test('[xhtmlx] user profile card', () => {
    const ctx = new DataContext({
      name: 'Alice Johnson', email: 'alice@example.com',
      avatar: '/img/alice.png', role: 'Senior Developer',
      location: 'San Francisco, CA', joined: '2022-03-15',
      verified: true, posts: 142, followers: 1283
    });
    const html = `
      <div class="profile-card">
        <img xh-attr-src="avatar" xh-attr-alt="name" class="avatar">
        <div class="info">
          <h2 xh-text="name" xh-class-verified="verified"></h2>
          <p class="role" xh-text="role"></p>
          <p class="email" xh-text="email"></p>
          <p class="location" xh-text="location"></p>
          <span class="joined">Joined: <span xh-text="joined"></span></span>
          <div class="stats">
            <span xh-text="posts"></span>
            <span xh-text="followers"></span>
          </div>
        </div>
      </div>`;
    bench('xhtmlx: user profile card', 3000, () => {
      const frag = renderTemplate(html, ctx);
      performSwap(xhContainer, frag, 'innerHTML');
    });
  });

  test('[React]  user profile card', () => {
    const d = {
      name: 'Alice Johnson', email: 'alice@example.com',
      avatar: '/img/alice.png', role: 'Senior Developer',
      location: 'San Francisco, CA', joined: '2022-03-15',
      verified: true, posts: 142, followers: 1283
    };
    bench('React:  user profile card', 3000, () => {
      syncRender(
        h('div', { className: 'profile-card' },
          h('img', { src: d.avatar, alt: d.name, className: 'avatar' }),
          h('div', { className: 'info' },
            h('h2', { className: d.verified ? 'verified' : '' }, d.name),
            h('p', { className: 'role' }, d.role),
            h('p', { className: 'email' }, d.email),
            h('p', { className: 'location' }, d.location),
            h('span', { className: 'joined' }, 'Joined: ', h('span', null, d.joined)),
            h('div', { className: 'stats' },
              h('span', null, d.posts),
              h('span', null, d.followers)
            )
          )
        ),
        reactContainer
      );
    });
  });

  // --- Data table ---

  test('[xhtmlx] data table — 20 rows × 4 cols', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1, name: `User ${i}`, email: `user${i}@test.com`, role: i % 2 ? 'admin' : 'user'
    }));
    const ctx = new DataContext({ rows });
    const html = `
      <table>
        <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Role</th></tr></thead>
        <tbody>
          <tr xh-each="rows">
            <td xh-text="id"></td>
            <td xh-text="name"></td>
            <td xh-text="email"></td>
            <td xh-text="role"></td>
          </tr>
        </tbody>
      </table>`;
    bench('xhtmlx: table 20×4', 500, () => {
      const frag = renderTemplate(html, ctx);
      performSwap(xhContainer, frag, 'innerHTML');
    });
  });

  test('[React]  data table — 20 rows × 4 cols', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1, name: `User ${i}`, email: `user${i}@test.com`, role: i % 2 ? 'admin' : 'user'
    }));
    bench('React:  table 20×4', 500, () => {
      syncRender(
        h('table', null,
          h('thead', null,
            h('tr', null,
              h('th', null, 'ID'), h('th', null, 'Name'),
              h('th', null, 'Email'), h('th', null, 'Role')
            )
          ),
          h('tbody', null,
            rows.map(r => h('tr', { key: r.id },
              h('td', null, r.id),
              h('td', null, r.name),
              h('td', null, r.email),
              h('td', null, r.role)
            ))
          )
        ),
        reactContainer
      );
    });
  });

  // --- Data table 100 rows ---

  test('[xhtmlx] data table — 100 rows × 4 cols', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1, name: `User ${i}`, email: `user${i}@test.com`, role: i % 2 ? 'admin' : 'user'
    }));
    const ctx = new DataContext({ rows });
    const html = `
      <table>
        <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Role</th></tr></thead>
        <tbody>
          <tr xh-each="rows">
            <td xh-text="id"></td>
            <td xh-text="name"></td>
            <td xh-text="email"></td>
            <td xh-text="role"></td>
          </tr>
        </tbody>
      </table>`;
    bench('xhtmlx: table 100×4', 100, () => {
      const frag = renderTemplate(html, ctx);
      performSwap(xhContainer, frag, 'innerHTML');
    });
  });

  test('[React]  data table — 100 rows × 4 cols', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1, name: `User ${i}`, email: `user${i}@test.com`, role: i % 2 ? 'admin' : 'user'
    }));
    bench('React:  table 100×4', 100, () => {
      syncRender(
        h('table', null,
          h('thead', null,
            h('tr', null,
              h('th', null, 'ID'), h('th', null, 'Name'),
              h('th', null, 'Email'), h('th', null, 'Role')
            )
          ),
          h('tbody', null,
            rows.map(r => h('tr', { key: r.id },
              h('td', null, r.id),
              h('td', null, r.name),
              h('td', null, r.email),
              h('td', null, r.role)
            ))
          )
        ),
        reactContainer
      );
    });
  });

  // --- Todo list with conditionals ---

  test('[xhtmlx] todo list — 30 items with conditional classes', () => {
    const todos = Array.from({ length: 30 }, (_, i) => ({
      id: i, text: `Task ${i}`, done: i % 3 === 0, priority: i % 5 === 0
    }));
    const ctx = new DataContext({ todos });
    const html = `
      <ul class="todo-list">
        <li xh-each="todos" xh-class-done="done" xh-class-priority="priority">
          <span xh-text="text"></span>
          <span xh-if="done" class="check">✓</span>
        </li>
      </ul>`;
    bench('xhtmlx: todo list 30', 200, () => {
      const frag = renderTemplate(html, ctx);
      performSwap(xhContainer, frag, 'innerHTML');
    });
  });

  test('[React]  todo list — 30 items with conditional classes', () => {
    const todos = Array.from({ length: 30 }, (_, i) => ({
      id: i, text: `Task ${i}`, done: i % 3 === 0, priority: i % 5 === 0
    }));
    bench('React:  todo list 30', 200, () => {
      syncRender(
        h('ul', { className: 'todo-list' },
          todos.map(t => h('li', {
            key: t.id,
            className: [t.done && 'done', t.priority && 'priority'].filter(Boolean).join(' ')
          },
            h('span', null, t.text),
            t.done ? h('span', { className: 'check' }, '\u2713') : null
          ))
        ),
        reactContainer
      );
    });
  });

  // --- Navigation menu ---

  test('[xhtmlx] nav menu — 8 items with active state', () => {
    const items = [
      { label: 'Home', href: '/', active: true },
      { label: 'Products', href: '/products', active: false },
      { label: 'Services', href: '/services', active: false },
      { label: 'About', href: '/about', active: false },
      { label: 'Blog', href: '/blog', active: false },
      { label: 'Contact', href: '/contact', active: false },
      { label: 'FAQ', href: '/faq', active: false },
      { label: 'Login', href: '/login', active: false },
    ];
    const ctx = new DataContext({ items });
    const html = `
      <nav>
        <a xh-each="items" xh-attr-href="href" xh-text="label" xh-class-active="active"></a>
      </nav>`;
    bench('xhtmlx: nav menu 8 items', 2000, () => {
      const frag = renderTemplate(html, ctx);
      performSwap(xhContainer, frag, 'innerHTML');
    });
  });

  test('[React]  nav menu — 8 items with active state', () => {
    const items = [
      { label: 'Home', href: '/', active: true },
      { label: 'Products', href: '/products', active: false },
      { label: 'Services', href: '/services', active: false },
      { label: 'About', href: '/about', active: false },
      { label: 'Blog', href: '/blog', active: false },
      { label: 'Contact', href: '/contact', active: false },
      { label: 'FAQ', href: '/faq', active: false },
      { label: 'Login', href: '/login', active: false },
    ];
    bench('React:  nav menu 8 items', 2000, () => {
      syncRender(
        h('nav', null,
          items.map((item, i) => h('a', {
            key: i, href: item.href,
            className: item.active ? 'active' : ''
          }, item.label))
        ),
        reactContainer
      );
    });
  });
});
