/**
 * Video.js controls added by the production player (docs/specs/VIDEO-PLAYER.md section 4):
 * next, captions toggle, settings, theatre and the live badge, plus SVG icons for the built-in
 * controls. They are Video.js Buttons, so they get Video.js's focus handling, control text and
 * user-activity behaviour like the built-in controls.
 */
import videojs, { type Player } from 'video.js';
import { setControlIcons, type IconName } from './icons';
import { isLivePlayback, isTrackingLive } from './live-state';
import { captionTracks } from './settings-model';
import { getPlayerUi, setAutoplayNext, setTheatre, subscribePlayerUi } from './player-ui';
import { formatTime as formatPlayerTime } from './progress-preview';
import { FULLSCREEN_EVENTS, layerHostFor, PLAYER_LAYER_ATTR } from './player-layer';

/** Copy the controls need, from the player's translations. */
export interface ChromeCopy {
  next: string;
  theatre: string;
  exitTheatre: string;
  captions: string;
  settings: string;
  live: string;
  goToLive: string;
  behind: string;
  autoplay: string;
  autoplayOn: string;
  autoplayOff: string;
}

export const SETTINGS_TOGGLE_EVENT = 'fanous:settings-toggle';
export const NEXT_EVENT = 'fanous:next';

interface ButtonInstance {
  el(): HTMLElement;
  player(): Player & { trigger(event: string): void };
  options_: Record<string, unknown>;
  controlText(text?: string): string;
  addClass(c: string): void;
  removeClass(c: string): void;
  toggleClass(c: string, on?: boolean): void;
  show(): void;
  hide(): void;
  on(target: unknown, event: string, fn: (...a: unknown[]) => void): void;
  on(event: string, fn: (...a: unknown[]) => void): void;
  dispose(): void;
  setAttribute(name: string, value: string): void;
  buildCSSClass(): string;
}
type ButtonCtor = new (player: Player, options?: Record<string, unknown>) => ButtonInstance;
interface VjsStatic {
  getComponent(name: string): unknown;
  registerComponent(name: string, c: unknown): void;
}

const vjs = videojs as unknown as VjsStatic;

function copy(b: ButtonInstance): ChromeCopy {
  return b.options_.copy as ChromeCopy;
}

/** Calls fn now and on each store change until the component is disposed. */
function followUi(b: ButtonInstance, fn: () => void) {
  fn();
  const off = subscribePlayerUi(fn);
  b.on('dispose', off);
}

let registered = false;

export function registerFanousComponents(): void {
  if (registered || vjs.getComponent('FanousSettingsButton')) {
    registered = true;
    return;
  }
  registered = true;
  const Button = vjs.getComponent('Button') as ButtonCtor;

  class FanousNextButton extends Button {
    constructor(player: Player, options?: Record<string, unknown>) {
      super(player, options);
      setControlIcons(this.el(), 'skipForward');
      this.controlText(copy(this).next);
      followUi(this, () => (getPlayerUi().upNext ? this.show() : this.hide()));
    }
    buildCSSClass() {
      return `vjs-fanous-next ${super.buildCSSClass()}`;
    }
    handleClick() {
      this.player().trigger(NEXT_EVENT);
      getPlayerUi().upNext?.go();
    }
  }

  class FanousCaptionsToggle extends Button {
    private last = 0;
    constructor(player: Player, options?: Record<string, unknown>) {
      super(player, options);
      setControlIcons(this.el(), 'captions');
      this.controlText(copy(this).captions);
      const tracks = (this.player() as unknown as { textTracks(): ArrayLike<{ kind: string; mode: string }> & EventTarget }).textTracks();
      const update = () => {
        const subs = captionTracks(tracks);
        if (subs.length === 0) this.hide();
        else this.show();
        const on = subs.findIndex((t) => t.mode === 'showing');
        if (on >= 0) this.last = on;
        this.el().setAttribute('aria-pressed', String(on >= 0));
        this.toggleClass('vjs-fanous-on', on >= 0);
      };
      update();
      tracks.addEventListener('change', update);
      tracks.addEventListener('addtrack', update);
      tracks.addEventListener('removetrack', update);
      this.on('dispose', () => {
        tracks.removeEventListener('change', update);
        tracks.removeEventListener('addtrack', update);
        tracks.removeEventListener('removetrack', update);
      });
    }
    buildCSSClass() {
      return `vjs-fanous-captions ${super.buildCSSClass()}`;
    }
    handleClick() {
      const subs = captionTracks((this.player() as unknown as { textTracks(): ArrayLike<{ kind: string; mode: string }> }).textTracks());
      const on = subs.some((t) => t.mode === 'showing');
      subs.forEach((t, i) => {
        t.mode = !on && i === Math.min(this.last, subs.length - 1) ? 'showing' : 'disabled';
      });
    }
  }

  class FanousSettingsButton extends Button {
    constructor(player: Player, options?: Record<string, unknown>) {
      super(player, options);
      setControlIcons(this.el(), 'settings');
      this.controlText(copy(this).settings);
      this.el().setAttribute('aria-haspopup', 'menu');
      this.el().setAttribute('aria-expanded', 'false');
    }
    buildCSSClass() {
      return `vjs-fanous-settings ${super.buildCSSClass()}`;
    }
    handleClick() {
      this.player().trigger(SETTINGS_TOGGLE_EVENT);
    }
  }

  class FanousTheatreToggle extends Button {
    constructor(player: Player, options?: Record<string, unknown>) {
      super(player, options);
      setControlIcons(this.el(), 'rectangleHorizontal');
      followUi(this, () => {
        const ui = getPlayerUi();
        if (ui.theatreAvailable) this.show();
        else this.hide();
        this.el().setAttribute('aria-pressed', String(ui.theatre));
        this.toggleClass('vjs-fanous-on', ui.theatre);
        this.controlText(ui.theatre ? copy(this).exitTheatre : copy(this).theatre);
      });
    }
    buildCSSClass() {
      return `vjs-fanous-theatre ${super.buildCSSClass()}`;
    }
    handleClick() {
      setTheatre(!getPlayerUi().theatre);
    }
  }

  /**
   * YouTube-style autoplay switch (docs/specs/PLAYLIST-PLAYBACK.md, "auto play like youtube"): on
   * the watch page only. A real switch for assistive tech (role="switch", aria-checked) named
   * "Autoplay"; the tooltip says "Autoplay is on/off". Saved on this device and, signed in, on the
   * account (hooks/useAutoplaySetting.ts).
   */
  class FanousAutoplayToggle extends Button {
    constructor(player: Player, options?: Record<string, unknown>) {
      super(player, options);
      const el = this.el();
      el.setAttribute('role', 'switch');
      el.setAttribute('data-testid', 'player-autoplay-toggle');
      const track = document.createElement('span');
      track.className = 'vjs-fanous-switch';
      track.setAttribute('aria-hidden', 'true');
      const knob = document.createElement('span');
      knob.className = 'vjs-fanous-switch-knob';
      track.appendChild(knob);
      el.querySelector('.vjs-icon-placeholder')?.replaceWith(track);
      this.controlText(copy(this).autoplay);
      followUi(this, () => {
        const ui = getPlayerUi();
        if (ui.theatreAvailable) this.show();
        else this.hide();
        el.setAttribute('aria-checked', String(ui.autoplayNext));
        el.setAttribute('title', ui.autoplayNext ? copy(this).autoplayOn : copy(this).autoplayOff);
        this.toggleClass('vjs-fanous-on', ui.autoplayNext);
      });
    }
    buildCSSClass() {
      return `vjs-fanous-autoplay ${super.buildCSSClass()}`;
    }
    handleClick() {
      setAutoplayNext(!getPlayerUi().autoplayNext);
    }
  }

  /** "Live" at the edge; "Live · 0:42 behind" otherwise. Clicking seeks to the edge. */
  class FanousLiveBadge extends Button {
    constructor(player: Player, options?: Record<string, unknown>) {
      super(player, options);
      const el = this.el();
      const dot = document.createElement('i');
      dot.className = 'vjs-fanous-live-dot';
      el.querySelector('.vjs-icon-placeholder')?.prepend(dot);
      const label = document.createElement('span');
      label.className = 'vjs-fanous-live-label';
      label.setAttribute('aria-hidden', 'true');
      el.appendChild(label);
      const update = () => {
        const p = this.player() as unknown as { liveTracker?: { isLive(): boolean; atLiveEdge(): boolean; behindLiveEdge(): boolean; liveCurrentTime(): number }; currentTime(): number; duration(): number };
        const lt = p.liveTracker;
        // Live even when the window is too short for the tracker; "behind" needs the tracker
        const tracking = isTrackingLive(p);
        const live = isLivePlayback(p);
        if (!live) {
          this.hide();
          return;
        }
        this.show();
        const behindBy = tracking ? Math.max(0, (lt!.liveCurrentTime() || 0) - (p.currentTime() || 0)) : 0;
        const behind = tracking && lt!.behindLiveEdge() && behindBy > 10;
        this.toggleClass('vjs-fanous-behind', behind);
        const c = copy(this);
        const text = behind ? `${c.live} · ${c.behind.replace('{time}', formatPlayerTime(behindBy))}` : c.live;
        label.textContent = text;
        this.controlText(behind ? `${text}. ${c.goToLive}` : c.live);
      };
      update();
      ['timeupdate', 'durationchange', 'liveedgechange', 'seeked', 'loadedmetadata'].forEach((e) => this.on(this.player(), e, update));
      const lt = (this.player() as unknown as { liveTracker?: unknown }).liveTracker;
      if (lt) {
        this.on(lt, 'liveedgechange', update);
        this.on(lt, 'seekableendchange', update);
      }
    }
    buildCSSClass() {
      return `vjs-fanous-live ${super.buildCSSClass()}`;
    }
    handleClick() {
      (this.player() as unknown as { liveTracker?: { seekToLiveEdge(): void } }).liveTracker?.seekToLiveEdge();
    }
  }

  vjs.registerComponent('FanousNextButton', FanousNextButton);
  vjs.registerComponent('FanousCaptionsToggle', FanousCaptionsToggle);
  vjs.registerComponent('FanousSettingsButton', FanousSettingsButton);
  vjs.registerComponent('FanousTheatreToggle', FanousTheatreToggle);
  vjs.registerComponent('FanousAutoplayToggle', FanousAutoplayToggle);
  vjs.registerComponent('FanousLiveBadge', FanousLiveBadge);
}

/** SVG icons for Video.js's built-in controls. CSS shows the one that matches the player state. */
const BUILT_IN_ICONS: Array<[string, IconName[]]> = [
  ['.vjs-play-control', ['play', 'pause', 'rotateCcw']],
  ['.vjs-mute-control', ['volumeX', 'volume1', 'volume2']],
  ['.vjs-picture-in-picture-control', ['pictureInPicture2']],
  ['.vjs-fullscreen-control', ['maximize', 'minimize']],
  ['.vjs-big-play-button', ['play']],
];

export function applyBuiltInIcons(playerEl: Element | null | undefined): void {
  if (!playerEl) return;
  for (const [selector, icons] of BUILT_IN_ICONS) {
    playerEl.querySelectorAll(selector).forEach((el) => setControlIcons(el, ...icons));
  }
}

interface CaptionSettingsHost {
  addClass(name: string): void;
  removeClass(name: string): void;
  getChild(name: string): { getValues?(): Record<string, unknown>; on?(event: string, fn: () => void): void } | undefined;
}

/**
 * The theme styles captions until the viewer picks their own in Caption style. Video.js's
 * getValues() returns only the options that differ from its defaults, so an empty object means
 * the viewer has not customised anything.
 */
export function syncCustomCaptions(player: CaptionSettingsHost): void {
  const settings = player.getChild('textTrackSettings') ?? player.getChild('TextTrackSettings');
  if (!settings?.getValues) return;
  const sync = () => {
    const custom = Object.keys(settings.getValues?.() ?? {}).length > 0;
    if (custom) player.addClass('vjs-fanous-custom-captions');
    else player.removeClass('vjs-fanous-custom-captions');
  };
  sync();
  settings.on?.('modalclose', sync);
}

interface CaptionDialogHost {
  el(): HTMLElement;
  getChild(name: string): { el?(): HTMLElement; on?(event: string, fn: () => void): void } | undefined;
  on?(event: string, fn: () => void): void;
}

/**
 * Caption style (Video.js's text track settings) is a dialog, so like every player dialog it opens
 * in the player layer (lib/video/player-layer.ts) over a scrim instead of inside the clipped frame.
 * The dialog element moves to the layer just before it opens (before Video.js focuses it), follows
 * the player into and out of fullscreen while open, and goes back where it was when it closes.
 */
export function layerCaptionSettings(player: CaptionDialogHost, doc: Document = document): void {
  const settings = player.getChild('textTrackSettings') ?? player.getChild('TextTrackSettings');
  const dialog = settings?.el?.();
  if (!settings?.on || !dialog) return;
  let layer: HTMLElement | null = null;
  let home: { parent: Node; next: Node | null } | null = null;
  // The page behind does not scroll while the dialog is open, as with the shortcuts dialog
  let bodyOverflow = '';

  const place = () => {
    if (layer) layerHostFor(player.el(), doc).appendChild(layer);
  };
  const open = () => {
    if (layer) return;
    home = { parent: dialog.parentNode ?? player.el(), next: dialog.nextSibling };
    layer = doc.createElement('div');
    layer.className = 'vjs-fanous-layer vjs-fanous-dialog-layer vjs-fanous-caption-layer';
    layer.setAttribute(PLAYER_LAYER_ATTR, '');
    layer.setAttribute('data-testid', 'player-caption-style-layer');
    layer.dir = player.el().closest('[dir]')?.getAttribute('dir') || doc.documentElement.dir || 'ltr';
    dialog.classList.add('vjs-fanous-caption-dialog');
    layer.appendChild(dialog);
    place();
    bodyOverflow = doc.body.style.overflow;
    doc.body.style.overflow = 'hidden';
    for (const name of FULLSCREEN_EVENTS) doc.addEventListener(name, place);
  };
  // Video.js moves focus in only when it was inside the player, and listens for Escape on the dialog
  // itself; opened from the portalled menu, focus would stay outside and Escape would do nothing
  const focusIn = () => {
    if (!dialog.contains(doc.activeElement)) dialog.focus();
  };
  const close = () => {
    if (!layer) return;
    for (const name of FULLSCREEN_EVENTS) doc.removeEventListener(name, place);
    const hadFocus = layer.contains(doc.activeElement) || doc.activeElement === doc.body;
    if (home) home.parent.insertBefore(dialog, home.next && home.next.parentNode === home.parent ? home.next : null);
    if (hadFocus) player.el().querySelector<HTMLElement>('.vjs-fanous-settings')?.focus();
    layer.remove();
    doc.body.style.overflow = bodyOverflow;
    layer = null;
    home = null;
  };
  settings.on('beforemodalopen', open);
  settings.on('modalopen', focusIn);
  settings.on('modalclose', close);
  player.on?.('dispose', close);
}
