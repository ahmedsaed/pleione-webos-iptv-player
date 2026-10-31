import { html, withInstantScroll, type Safe } from '../utils/dom';
import type { SpatialNav } from '../navigation/spatial-nav';

/** Custom single-select dropdown — remote/D-pad friendly and app-styled (the app
 *  uses no native `<select>`). The trigger toggles the menu; each option carries a
 *  `data-dropdown-value`; the chosen value lives on the root's `data-value`. */
export function dropdown(
  id: string,
  options: { value: string; label: string }[],
  active: string,
): Safe {
  const current = options.find(o => o.value === active) ?? options[0];
  return html`
    <div class="dropdown" id="${id}" data-value="${active}">
      <span class="dropdown-sizer" aria-hidden="true">
        ${options.map(o => html`<span>${o.label}</span>`)}
      </span>
      <button class="dropdown-trigger" data-focusable data-dropdown-trigger
              data-key="${id}:trigger" aria-expanded="false">
        <span class="dropdown-current">${current.label}</span>
        <span class="dropdown-caret"></span>
      </button>
      <div class="dropdown-menu">
        ${options.map(o => html`
          <button class="dropdown-option ${o.value === active ? 'active' : ''}"
                  data-focusable data-key="${id}:${o.value}"
                  data-dropdown-value="${o.value}">${o.label}</button>
        `)}
      </div>
    </div>`;
}

export function toggleDropdown(
  container: HTMLElement,
  nav: SpatialNav,
  dd: HTMLElement | null,
): void {
  if (!dd) return;
  const open = !dd.classList.contains('open');
  const current = container.querySelector<HTMLElement>('.dropdown.open');
  if (current && current !== dd) closeDropdown(nav, current);
  if (!open) {
    closeDropdown(nav, dd);
    return;
  }
  dd.classList.add('open');
  dd.querySelector('.dropdown-trigger')?.setAttribute('aria-expanded', 'true');
  placeDropdownMenu(dd);
  const opt = dd.querySelector<HTMLElement>('.dropdown-option.active')
    ?? dd.querySelector<HTMLElement>('.dropdown-option');
  if (opt) nav.focus(opt);
}

interface Box { top: number; bottom: number }

// The part of the screen `el` can paint in: the window, cut by every
// ancestor that clips its overflow (the Settings pane above its action bar).
function visibleBox(el: HTMLElement): { box: Box; scroller: HTMLElement | null } {
  const box: Box = { top: 0, bottom: window.innerHeight };
  let scroller: HTMLElement | null = null;
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'visible') continue;
    const r = node.getBoundingClientRect();
    const top = r.top + node.clientTop;
    box.top = Math.max(box.top, top);
    box.bottom = Math.min(box.bottom, top + node.clientHeight);
    if (!scroller && (overflow === 'auto' || overflow === 'scroll')) scroller = node;
  }
  return { box, scroller };
}

/**
 * Open the menu where it shows whole: below the trigger when it fits, above
 * it when only that side has room, and otherwise below with the pane
 * scrolled just enough to show it, the trigger kept in view.
 */
export function placeDropdownMenu(dd: HTMLElement): void {
  dd.classList.remove('drop-up');
  const menu = dd.querySelector<HTMLElement>('.dropdown-menu');
  const trigger = dd.querySelector<HTMLElement>('.dropdown-trigger');
  if (!menu || !trigger) return;
  const { box, scroller } = visibleBox(dd);
  const t = trigger.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  if (m.height <= 0 || m.bottom <= box.bottom) return;
  const gap = m.top - t.bottom;
  if (t.top - gap - m.height >= box.top) {
    dd.classList.add('drop-up');
    return;
  }
  if (!scroller) return;
  const delta = Math.min(m.bottom - box.bottom, t.top - box.top);
  if (delta > 0) withInstantScroll([scroller], () => { scroller.scrollTop += delta; });
}

export function closeDropdown(nav: SpatialNav, dd: HTMLElement): void {
  dd.classList.remove('open');
  dd.querySelector('.dropdown-trigger')?.setAttribute('aria-expanded', 'false');
  const trigger = dd.querySelector<HTMLElement>('.dropdown-trigger');
  if (trigger) nav.focus(trigger);
}

// Record the chosen option on the root's data-value, update the trigger label,
// and close the menu. Callers apply side effects, then refocus the trigger.
export function commitDropdownOption(el: HTMLElement): HTMLElement | null {
  const dd = el.closest<HTMLElement>('.dropdown');
  if (!dd) return null;
  dd.dataset.value = el.dataset.dropdownValue ?? '';
  dd.querySelectorAll('.dropdown-option').forEach(o => o.classList.remove('active'));
  el.classList.add('active');
  const cur = dd.querySelector('.dropdown-current');
  if (cur) cur.textContent = el.textContent;
  dd.classList.remove('open');
  dd.querySelector('.dropdown-trigger')?.setAttribute('aria-expanded', 'false');
  return dd;
}
