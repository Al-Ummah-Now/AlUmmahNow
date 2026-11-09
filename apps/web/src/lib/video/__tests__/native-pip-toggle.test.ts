/**
 * Firefox's own Picture-in-Picture toggle stays off over the player, while the player's own
 * Picture-in-Picture keeps working (lib/video/native-pip-toggle.ts).
 *
 * The browser is modelled by a native `disablePictureInPicture` accessor on the prototype (what
 * Firefox's toggle reads) and a request that the native value refuses.
 */
import { guardNativePipToggle, hasNativePipToggle } from '../native-pip-toggle';

type PipVideo = HTMLVideoElement & { disablePictureInPicture?: boolean };

const FIREFOX = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:159.0) Gecko/20100101 Firefox/159.0' };
const CHROME = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36' };
const SAFARI = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15' };
const FIREFOX_IOS = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/140.0 Mobile/15E148 Safari/605.1.15' };

const nativeValue = new WeakMap<HTMLVideoElement, boolean>();
const native = (v: HTMLVideoElement) => nativeValue.get(v) ?? false;

beforeAll(() => {
  Object.defineProperty(HTMLVideoElement.prototype, 'disablePictureInPicture', {
    configurable: true,
    get(this: HTMLVideoElement) { return native(this); },
    set(this: HTMLVideoElement, value: boolean) { nativeValue.set(this, !!value); },
  });
});

afterAll(() => {
  delete (HTMLVideoElement.prototype as { disablePictureInPicture?: boolean }).disablePictureInPicture;
});

/** A video whose request behaves like the browser's: refused while the native value is set */
function video(outcome: 'enter' | 'fail' = 'enter') {
  const v = document.createElement('video') as PipVideo;
  const seen: boolean[] = [];
  v.requestPictureInPicture = jest.fn(() => {
    seen.push(native(v));
    if (native(v)) return Promise.reject(new DOMException('disabled', 'InvalidStateError'));
    return outcome === 'enter' ? Promise.resolve({} as PictureInPictureWindow) : Promise.reject(new DOMException('no gesture', 'NotAllowedError'));
  });
  return { v, seen };
}

describe('guardNativePipToggle', () => {
  it('applies to Firefox only: the one browser that draws its own toggle over the page', () => {
    expect(hasNativePipToggle(FIREFOX)).toBe(true);
    expect(hasNativePipToggle(CHROME)).toBe(false);
    expect(hasNativePipToggle(SAFARI)).toBe(false);
    // Firefox on iOS is WebKit and draws no toggle
    expect(hasNativePipToggle(FIREFOX_IOS)).toBe(false);
  });

  it('leaves other browsers alone', () => {
    const { v } = video();
    guardNativePipToggle(v, CHROME);
    expect(native(v)).toBe(false);
  });

  it('turns the toggle off for the browser and asks it to check again, while the page still reads Picture-in-Picture as allowed', () => {
    const { v } = video();
    const checks = jest.fn();
    v.addEventListener('durationchange', checks);
    guardNativePipToggle(v, FIREFOX);
    expect(native(v)).toBe(true);
    expect(checks).toHaveBeenCalledTimes(1);
    // What Video.js reads to enable its button and to allow its request
    expect(v.disablePictureInPicture).toBe(false);
  });

  it('lets the player request Picture-in-Picture, and turns the toggle off again when it ends', async () => {
    const { v, seen } = video();
    guardNativePipToggle(v, FIREFOX);
    await v.requestPictureInPicture();
    expect(seen).toEqual([false]);
    v.dispatchEvent(new Event('leavepictureinpicture'));
    expect(native(v)).toBe(true);
  });

  it('turns the toggle off again when a request fails, and passes the error on', async () => {
    const { v } = video('fail');
    guardNativePipToggle(v, FIREFOX);
    await expect(v.requestPictureInPicture()).rejects.toThrow('no gesture');
    expect(native(v)).toBe(true);
  });

  it('keeps the page in charge: a page that turns Picture-in-Picture off has its request refused', async () => {
    const { v } = video();
    guardNativePipToggle(v, FIREFOX);
    v.disablePictureInPicture = true;
    expect(v.disablePictureInPicture).toBe(true);
    await expect(v.requestPictureInPicture()).rejects.toThrow('disabled');
  });

  it('guards a video once, and undoes everything on release', async () => {
    const { v, seen } = video();
    const release = guardNativePipToggle(v, FIREFOX);
    guardNativePipToggle(v, FIREFOX);
    release();
    expect(native(v)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(v, 'disablePictureInPicture')).toBe(false);
    await v.requestPictureInPicture();
    expect(seen).toEqual([false]);
  });

  it('does nothing without a video', () => {
    expect(() => guardNativePipToggle(null, FIREFOX)()).not.toThrow();
  });
});
