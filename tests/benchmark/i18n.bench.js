/**
 * @jest-environment jsdom
 */

const { bench } = require('./bench-helper');
const xhtmlx = require('../../xhtmlx.js');
const { i18n, applyI18n, DataContext } = xhtmlx._internals;

describe('Benchmark: i18n', () => {
  beforeEach(() => {
    // Load a locale with typical translations
    i18n.locales = {};
    i18n.locales.en = {
      'greeting': 'Hello',
      'farewell': 'Goodbye',
      'welcome.title': 'Welcome to our app',
      'welcome.subtitle': 'Enjoy your stay',
      'nav.home': 'Home',
      'nav.about': 'About',
      'nav.contact': 'Contact',
      'form.submit': 'Submit',
      'form.cancel': 'Cancel',
      'form.placeholder.name': 'Enter your name',
    };
    i18n.locale = 'en';
  });

  test('i18n.t — simple key lookup', () => {
    bench('i18n.t simple key', 500000, () => {
      i18n.t('greeting');
    });
  });

  test('i18n.t — dotted key lookup', () => {
    bench('i18n.t dotted key', 500000, () => {
      i18n.t('welcome.title');
    });
  });

  test('i18n.t — deep dotted key', () => {
    bench('i18n.t deep dotted key', 500000, () => {
      i18n.t('form.placeholder.name');
    });
  });

  test('i18n.t — missing key (fallback)', () => {
    bench('i18n.t missing key', 500000, () => {
      i18n.t('nonexistent.key');
    });
  });

  test('applyI18n — element with xh-i18n', () => {
    const el = document.createElement('span');
    el.setAttribute('xh-i18n', 'greeting');
    bench('applyI18n (text)', 100000, () => {
      applyI18n(el);
    });
  });

  test('applyI18n — element with xh-i18n-title', () => {
    const el = document.createElement('span');
    el.setAttribute('xh-i18n-title', 'farewell');
    bench('applyI18n (title attr)', 100000, () => {
      applyI18n(el);
    });
  });
});
