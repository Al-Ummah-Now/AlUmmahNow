/**
 * Story 1.4 - focus order, focus trapping and skip-link focus targets
 */
import { getFocusableElements, trapFocus, focusElementById } from '../focus-manager';

function tab(container: HTMLElement, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
  (document.activeElement ?? container).dispatchEvent(event);
  return event;
}

describe('getFocusableElements', () => {
  it('returns tabbable elements in DOM order, skipping disabled/hidden/negative tabindex', () => {
    document.body.innerHTML = `
      <div id="c">
        <a id="a" href="#x">link</a>
        <button id="b">ok</button>
        <button id="disabled" disabled>no</button>
        <button id="hidden" style="display:none">no</button>
        <span id="neg" tabindex="-1">no</span>
        <span id="hiddenAria" tabindex="0" aria-hidden="true">no</span>
        <input id="i" />
        <div id="t" tabindex="0">custom</div>
      </div>`;
    const ids = getFocusableElements(document.getElementById('c')!).map((el) => el.id);
    expect(ids).toEqual(['a', 'b', 'i', 't']);
  });
});

describe('trapFocus', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="opener">open</button>
      <div id="dialog">
        <button id="first">close</button>
        <a id="middle" href="#m">more</a>
        <button id="last">done</button>
      </div>`;
  });

  it('moves focus into the dialog and wraps Tab / Shift+Tab', () => {
    const opener = document.getElementById('opener')!;
    opener.focus();
    const dialog = document.getElementById('dialog')!;
    const release = trapFocus(dialog);

    expect(document.activeElement?.id).toBe('first');

    document.getElementById('last')!.focus();
    const forward = tab(dialog);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('first');

    const backward = tab(dialog, true);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('last');

    release();
  });

  it('honours initialFocus and restores focus to the opener on release', () => {
    const opener = document.getElementById('opener')!;
    opener.focus();
    const release = trapFocus(document.getElementById('dialog')!, {
      initialFocus: document.getElementById('middle'),
    });
    expect(document.activeElement?.id).toBe('middle');
    release();
    expect(document.activeElement).toBe(opener);
  });

  it('does not intercept Tab between inner elements', () => {
    const release = trapFocus(document.getElementById('dialog')!);
    document.getElementById('middle')!.focus();
    const event = tab(document.getElementById('dialog')!);
    expect(event.defaultPrevented).toBe(false);
    release();
  });
});

describe('focusElementById', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn();
  });

  it('focuses a non-interactive landmark without adding it to the tab order', () => {
    document.body.innerHTML = '<main id="main-content"><p>content</p></main>';
    expect(focusElementById('main-content')).toBe(true);
    const main = document.getElementById('main-content')!;
    expect(document.activeElement).toBe(main);
    expect(main.getAttribute('tabindex')).toBe('-1');
  });

  it('falls back to a selector when the id is missing', () => {
    document.body.innerHTML = '<main><p>content</p></main>';
    expect(focusElementById('main-content', 'main')).toBe(true);
    expect(document.activeElement?.tagName).toBe('MAIN');
  });

  it('returns false when no target exists', () => {
    document.body.innerHTML = '<div></div>';
    expect(focusElementById('missing')).toBe(false);
  });
});
