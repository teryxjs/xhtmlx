/**
 * @jest-environment jsdom
 */

const xhtmlx = require('../../xhtmlx.js');
const { MutableDataContext, applyBindings, processEach } = xhtmlx._internals;

describe('Live reactivity end-to-end', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('xh-model input updates xh-text elements', () => {
    it('changing input value updates text span via reactivity', () => {
      const input = document.createElement('input');
      input.setAttribute('type', 'text');
      input.setAttribute('xh-model', 'name');
      container.appendChild(input);

      const span = document.createElement('span');
      span.setAttribute('xh-text', 'name');
      container.appendChild(span);

      const ctx = new MutableDataContext({ name: 'Alice' });
      applyBindings(input, ctx);
      applyBindings(span, ctx);

      expect(span.textContent).toBe('Alice');
      expect(input.value).toBe('Alice');

      // Simulate user typing
      input.value = 'Bob';
      input.dispatchEvent(new Event('input'));

      expect(span.textContent).toBe('Bob');
      expect(ctx.resolve('name')).toBe('Bob');
    });

    it('changing input value updates multiple xh-text elements', () => {
      const input = document.createElement('input');
      input.setAttribute('type', 'text');
      input.setAttribute('xh-model', 'title');
      container.appendChild(input);

      const span1 = document.createElement('span');
      span1.setAttribute('xh-text', 'title');
      container.appendChild(span1);

      const span2 = document.createElement('h1');
      span2.setAttribute('xh-text', 'title');
      container.appendChild(span2);

      const ctx = new MutableDataContext({ title: 'Original' });
      applyBindings(input, ctx);
      applyBindings(span1, ctx);
      applyBindings(span2, ctx);

      input.value = 'Updated';
      input.dispatchEvent(new Event('input'));

      expect(span1.textContent).toBe('Updated');
      expect(span2.textContent).toBe('Updated');
    });
  });

  describe('xh-model checkbox updates xh-class-* elements', () => {
    it('toggling checkbox updates class binding', () => {
      const checkbox = document.createElement('input');
      checkbox.setAttribute('type', 'checkbox');
      checkbox.setAttribute('xh-model', 'active');
      container.appendChild(checkbox);

      const div = document.createElement('div');
      div.setAttribute('xh-class-highlighted', 'active');
      container.appendChild(div);

      const ctx = new MutableDataContext({ active: false });
      applyBindings(checkbox, ctx);
      applyBindings(div, ctx);

      expect(div.classList.contains('highlighted')).toBe(false);
      expect(checkbox.checked).toBe(false);

      // Toggle checkbox on
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      expect(div.classList.contains('highlighted')).toBe(true);

      // Toggle checkbox off
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change'));

      expect(div.classList.contains('highlighted')).toBe(false);
    });
  });

  describe('xh-model input updates xh-attr-* elements', () => {
    it('changing input value updates attribute binding', () => {
      const input = document.createElement('input');
      input.setAttribute('type', 'text');
      input.setAttribute('xh-model', 'url');
      container.appendChild(input);

      const link = document.createElement('a');
      link.setAttribute('xh-attr-href', 'url');
      container.appendChild(link);

      const ctx = new MutableDataContext({ url: 'https://example.com' });
      applyBindings(input, ctx);
      applyBindings(link, ctx);

      expect(link.getAttribute('href')).toBe('https://example.com');

      input.value = 'https://updated.com';
      input.dispatchEvent(new Event('input'));

      expect(link.getAttribute('href')).toBe('https://updated.com');
    });
  });

  describe('xh-model updates xh-show/xh-hide visibility', () => {
    it('changing checkbox updates xh-show element visibility', () => {
      const checkbox = document.createElement('input');
      checkbox.setAttribute('type', 'checkbox');
      checkbox.setAttribute('xh-model', 'visible');
      container.appendChild(checkbox);

      const panel = document.createElement('div');
      panel.setAttribute('xh-show', 'visible');
      panel.textContent = 'Shown content';
      container.appendChild(panel);

      const ctx = new MutableDataContext({ visible: false });
      applyBindings(checkbox, ctx);
      applyBindings(panel, ctx);

      expect(panel.style.display).toBe('none');

      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      expect(panel.style.display).toBe('');
    });

    it('changing checkbox updates xh-hide element visibility', () => {
      const checkbox = document.createElement('input');
      checkbox.setAttribute('type', 'checkbox');
      checkbox.setAttribute('xh-model', 'hidden');
      container.appendChild(checkbox);

      const panel = document.createElement('div');
      panel.setAttribute('xh-hide', 'hidden');
      panel.textContent = 'Hidden content';
      container.appendChild(panel);

      const ctx = new MutableDataContext({ hidden: false });
      applyBindings(checkbox, ctx);
      applyBindings(panel, ctx);

      expect(panel.style.display).toBe('');

      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));

      expect(panel.style.display).toBe('none');
    });
  });

  describe('xh-model updates xh-html elements', () => {
    it('changing input value updates xh-html element', () => {
      const input = document.createElement('input');
      input.setAttribute('type', 'text');
      input.setAttribute('xh-model', 'markup');
      container.appendChild(input);

      const div = document.createElement('div');
      div.setAttribute('xh-html', 'markup');
      container.appendChild(div);

      const ctx = new MutableDataContext({ markup: '<b>bold</b>' });
      applyBindings(input, ctx);
      applyBindings(div, ctx);

      expect(div.innerHTML).toBe('<b>bold</b>');

      input.value = '<em>italic</em>';
      input.dispatchEvent(new Event('input'));

      expect(div.innerHTML).toBe('<em>italic</em>');
    });
  });

  describe('xh-each items have independent reactivity', () => {
    it('each iterated item has its own reactive context', () => {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('xh-each', 'items');
      wrapper.innerHTML = '<div><input type="text" xh-model="name" /><span xh-text="name"></span></div>';
      container.appendChild(wrapper);

      const ctx = new MutableDataContext({
        items: [
          { name: 'Alice' },
          { name: 'Bob' }
        ]
      });

      processEach(wrapper, ctx);

      const inputs = container.querySelectorAll('input');
      const spans = container.querySelectorAll('span');

      expect(inputs.length).toBe(2);
      expect(spans.length).toBe(2);
      expect(inputs[0].value).toBe('Alice');
      expect(inputs[1].value).toBe('Bob');
      expect(spans[0].textContent).toBe('Alice');
      expect(spans[1].textContent).toBe('Bob');

      // Change first item's input — should only update first span
      inputs[0].value = 'Charlie';
      inputs[0].dispatchEvent(new Event('input'));

      expect(spans[0].textContent).toBe('Charlie');
      expect(spans[1].textContent).toBe('Bob'); // Unchanged
    });
  });

  describe('select element reactivity', () => {
    it('changing select updates bound text element', () => {
      const select = document.createElement('select');
      select.setAttribute('xh-model', 'color');
      select.innerHTML = '<option value="red">Red</option><option value="blue">Blue</option>';
      container.appendChild(select);

      const span = document.createElement('span');
      span.setAttribute('xh-text', 'color');
      container.appendChild(span);

      const ctx = new MutableDataContext({ color: 'red' });
      applyBindings(select, ctx);
      applyBindings(span, ctx);

      expect(span.textContent).toBe('red');

      select.value = 'blue';
      select.dispatchEvent(new Event('change'));

      expect(span.textContent).toBe('blue');
    });
  });
});
