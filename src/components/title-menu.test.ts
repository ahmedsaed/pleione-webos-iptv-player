// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Focus, Tier } from '../navigation/focus-scope';
import { TitleMenu } from './title-menu';

let menu: TitleMenu;
let onAction: ReturnType<typeof vi.fn>;

const focused = () => Array.from(document.querySelectorAll('.focused'))
  .map(el => el.getAttribute('data-key'));

beforeEach(() => {
  document.body.innerHTML = '';
  menu = new TitleMenu('prompt.title-menu.test');
  onAction = vi.fn();
  menu.show({ title: 'Title <b>1</b>', actions: [{ key: 'remove', label: 'Remove' }], onAction });
  Focus.flush();
});

afterEach(() => Focus.uninstall());

describe('TitleMenu', () => {
  it('opens as a prompt-tier modal on its first action, with one ring', () => {
    expect(Focus.owner()?.tier).toBe(Tier.prompt);
    expect(Focus.owner()?.modal).toBe(true);
    expect(focused()).toEqual(['remove']);
    expect(document.querySelector('.title-menu-title')!.textContent).toBe('Title <b>1</b>');
  });

  it('runs the focused action and closes', () => {
    menu.handleAction('select');
    expect(onAction).toHaveBeenCalledWith('remove');
    expect(menu.visible).toBe(false);
    expect(Focus.owner()).toBeNull();
  });

  it('moves down to Cancel, and Cancel or Back run nothing', () => {
    menu.handleAction('down');
    Focus.flush();
    expect(focused()).toEqual(['cancel']);
    menu.handleAction('down');
    menu.handleAction('select');
    expect(onAction).not.toHaveBeenCalled();
    expect(menu.visible).toBe(false);

    menu.show({ title: 'Title 1', actions: [{ key: 'remove', label: 'Remove' }], onAction });
    menu.handleAction('back');
    expect(onAction).not.toHaveBeenCalled();
    expect(menu.visible).toBe(false);
  });

  it('follows the pointer and activates the clicked action', () => {
    const remove = document.querySelector<HTMLElement>('[data-menu-action="remove"]')!;
    menu.handleAction('down');
    remove.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    Focus.flush();
    expect(focused()).toEqual(['remove']);
    remove.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onAction).toHaveBeenCalledWith('remove');
  });
});
