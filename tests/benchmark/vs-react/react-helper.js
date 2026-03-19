/**
 * React helpers for benchmark comparison.
 * Uses React.createElement directly (no JSX/Babel needed).
 */

const React = require('react');
const ReactDOM = require('react-dom');
const { createRoot } = require('react-dom/client');

const h = React.createElement;

/**
 * Synchronous render into a container using ReactDOM.flushSync.
 * This forces React to commit synchronously (no batching / concurrent mode),
 * making it a fair comparison with xhtmlx's synchronous DOM writes.
 */
function syncRender(element, container) {
  const { flushSync } = require('react-dom');
  let root = container._reactRoot;
  if (!root) {
    root = createRoot(container);
    container._reactRoot = root;
  }
  flushSync(() => {
    root.render(element);
  });
}

/**
 * Unmount React root from container.
 */
function syncUnmount(container) {
  if (container._reactRoot) {
    const { flushSync } = require('react-dom');
    flushSync(() => {
      container._reactRoot.unmount();
    });
    delete container._reactRoot;
  }
}

module.exports = { h, React, ReactDOM, syncRender, syncUnmount };
