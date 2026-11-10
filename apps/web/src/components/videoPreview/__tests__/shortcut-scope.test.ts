import { previewOwnsKey } from '../shortcut-scope';

function keydown(target: EventTarget, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

describe('previewOwnsKey', () => {
  let root: HTMLDivElement;
  let playButton: HTMLButtonElement;
  let title: HTMLInputElement;
  let description: HTMLTextAreaElement;
  let save: HTMLButtonElement;

  beforeEach(() => {
    document.body.innerHTML = `
      <form>
        <input id="title" /><textarea id="description"></textarea><button id="save" type="submit">Save</button>
        <div id="preview"><video></video><button id="play" type="button">Play</button></div>
      </form>`;
    root = document.getElementById('preview') as HTMLDivElement;
    playButton = document.getElementById('play') as HTMLButtonElement;
    title = document.getElementById('title') as HTMLInputElement;
    description = document.getElementById('description') as HTMLTextAreaElement;
    save = document.getElementById('save') as HTMLButtonElement;
  });

  it('leaves keys typed into the form fields alone (Space, f, m)', () => {
    for (const key of [' ', 'f', 'F', 'm', 'ArrowLeft']) {
      expect(previewOwnsKey(keydown(title, { key }), root)).toBe(false);
      expect(previewOwnsKey(keydown(description, { key }), root)).toBe(false);
    }
  });

  it('leaves Space on another control of the page to that control', () => {
    expect(previewOwnsKey(keydown(save), root)).toBe(false);
  });

  it('acts when nothing is focused or focus is inside the preview', () => {
    expect(previewOwnsKey(keydown(document.body), root)).toBe(true);
    expect(previewOwnsKey(keydown(playButton, { key: 'm' }), root)).toBe(true);
    expect(previewOwnsKey(keydown(root.querySelector('video') as HTMLVideoElement, { key: 'f' }), root)).toBe(true);
  });

  it('ignores modified keys (Ctrl/Cmd+F is Find) and keys already handled', () => {
    expect(previewOwnsKey(keydown(document.body, { key: 'f', metaKey: true }), root)).toBe(false);
    expect(previewOwnsKey(keydown(document.body, { key: 'f', ctrlKey: true }), root)).toBe(false);
    expect(previewOwnsKey(keydown(document.body, { key: 'ArrowLeft', altKey: true }), root)).toBe(false);
    const handled = keydown(document.body);
    handled.preventDefault();
    expect(previewOwnsKey(handled, root)).toBe(false);
  });

  it('does nothing without a mounted preview', () => {
    expect(previewOwnsKey(keydown(playButton), null)).toBe(false);
  });
});
