// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { swapInterfaceStylesheets, uiPx, uiScale } from './ui-scale';

afterEach(() => {
  delete document.documentElement.dataset.interfaceSize;
});

describe('uiScale', () => {
  it('is 1 when no interface size is set', () => {
    expect(uiScale()).toBe(1);
    expect(uiPx(88)).toBe(88);
  });

  it('follows the data-interface-size percentage', () => {
    document.documentElement.dataset.interfaceSize = '120';
    expect(uiScale()).toBeCloseTo(1.2);
    expect(uiPx(88)).toBeCloseTo(105.6);
  });

  it('ignores an unknown size', () => {
    document.documentElement.dataset.interfaceSize = '175';
    expect(uiScale()).toBe(1);
  });
});

describe('swapInterfaceStylesheets', () => {
  const hrefs = () => Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .map(link => link.getAttribute('href'));
  const loadAll = () => document.querySelectorAll('link[rel="stylesheet"]:not([data-retiring])')
    .forEach(link => link.dispatchEvent(new Event('load')));

  afterEach(() => { document.head.innerHTML = ''; });

  function linkSheets(...files: string[]): void {
    document.head.innerHTML = files.map(f => `<link rel="stylesheet" href="${f}">`).join('');
  }

  it('keeps the old sheet until its scaled copy loads, in the same order', () => {
    linkSheets('css/main.css', 'css/tab-bar.css', 'other/vendor.css');
    swapInterfaceStylesheets('120');
    expect(hrefs()).toEqual([
      'css/main.css', 'css/ui-120/main.css', 'css/tab-bar.css', 'css/ui-120/tab-bar.css', 'other/vendor.css',
    ]);
    loadAll();
    expect(hrefs()).toEqual(['css/ui-120/main.css', 'css/ui-120/tab-bar.css', 'other/vendor.css']);
  });

  it('returns to the default sheets and ignores a no-op switch', () => {
    linkSheets('css/ui-110/main.css');
    swapInterfaceStylesheets('110');
    expect(hrefs()).toEqual(['css/ui-110/main.css']);
    swapInterfaceStylesheets('100');
    loadAll();
    expect(hrefs()).toEqual(['css/main.css']);
  });

  it('picks the mirrored copies in a right-to-left document, and back', () => {
    linkSheets('css/ui-110/main.css');
    document.documentElement.dir = 'rtl';
    try {
      swapInterfaceStylesheets('110');
      loadAll();
      expect(hrefs()).toEqual(['css/rtl/ui-110/main.css']);
      swapInterfaceStylesheets('100');
      loadAll();
      expect(hrefs()).toEqual(['css/rtl/main.css']);
    } finally {
      document.documentElement.removeAttribute('dir');
    }
    swapInterfaceStylesheets('100');
    loadAll();
    expect(hrefs()).toEqual(['css/main.css']);
  });

  it('retires every older copy when a later switch loads first', () => {
    linkSheets('css/main.css');
    swapInterfaceStylesheets('110');
    swapInterfaceStylesheets('130');
    const latest = document.querySelector('link[href="css/ui-130/main.css"]')!;
    latest.dispatchEvent(new Event('load'));
    expect(hrefs()).toEqual(['css/ui-130/main.css']);
  });
});
