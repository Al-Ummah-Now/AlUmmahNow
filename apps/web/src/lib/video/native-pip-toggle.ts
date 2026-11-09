/**
 * Firefox's own Picture-in-Picture toggle (docs/specs/VIDEO-PLAYER.md section 5, Layers).
 *
 * Firefox draws its own toggle on a video's edge when the pointer is over the video, and takes
 * presses there before the page does: it opens Picture-in-Picture instead of letting the press reach
 * whatever covers the video, unless that cover paints fully opaque. Our bar, menus, dialogs and end
 * screen are translucent, so a press on any of them where it overlaps the toggle was lost (in a
 * small player the toggle sits over the bar itself). The player has its own Picture-in-Picture
 * button and the P shortcut, so in Firefox the toggle is turned off for the player's whole life
 * with `disablePictureInPicture`, which Firefox honours and checks again on `durationchange`.
 *
 * The attribute also makes `requestPictureInPicture()` fail and makes Video.js disable its own
 * Picture-in-Picture button, so only the browser sees it: the video gets an own property that
 * shows page script (Video.js included) the page's own value, while the native value, which
 * Firefox's toggle reads through its privileged view of the element, stays on. The video's request
 * clears the native value for the request (still inside the viewer's gesture), and it goes back on
 * when Picture-in-Picture ends.
 *
 * Other browsers draw no such toggle over a page's own controls, so they are left alone.
 */

type PipVideo = HTMLVideoElement & { disablePictureInPicture?: boolean };

const guarded = new WeakSet<HTMLVideoElement>();

/** Whether the browser draws its own Picture-in-Picture toggle over videos on hover (Firefox) */
export function hasNativePipToggle(nav: Pick<Navigator, 'userAgent'> | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  return !!nav && /\bFirefox\//.test(nav.userAgent);
}

/**
 * Turn the browser's own toggle off on this video, keeping the page's own Picture-in-Picture
 * working. Returns a function that undoes it.
 */
export function guardNativePipToggle(video: HTMLVideoElement | null | undefined, nav?: Pick<Navigator, 'userAgent'>): () => void {
  const agent = nav ?? (typeof navigator === 'undefined' ? undefined : navigator);
  if (!video || guarded.has(video) || !hasNativePipToggle(agent)) return () => undefined;
  const native = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'disablePictureInPicture');
  if (!native?.get || !native.set) return () => undefined;
  const v = video as PipVideo;
  guarded.add(video);

  const getNative = () => !!native.get!.call(v);
  const setNative = (off: boolean) => {
    if (getNative() === off) return;
    native.set!.call(v, off);
    // Firefox re-evaluates whether to draw its toggle on this event
    v.dispatchEvent(new Event('durationchange'));
  };
  // What the page itself asked for; Picture-in-Picture stays off when the page turned it off
  let pageValue = getNative();
  Object.defineProperty(v, 'disablePictureInPicture', {
    configurable: true,
    get: () => pageValue,
    set: (value: boolean) => {
      pageValue = !!value;
      setNative(true);
    },
  });

  const request = typeof v.requestPictureInPicture === 'function' ? v.requestPictureInPicture : null;
  const ownRequest = Object.prototype.hasOwnProperty.call(v, 'requestPictureInPicture');
  if (request) {
    v.requestPictureInPicture = function requestPictureInPicture(this: PipVideo) {
      if (!pageValue) setNative(false);
      return request.call(this).catch((error: unknown) => {
        setNative(true);
        throw error;
      });
    };
  }
  const onLeave = () => setNative(true);
  v.addEventListener('leavepictureinpicture', onLeave);
  setNative(true);

  return () => {
    v.removeEventListener('leavepictureinpicture', onLeave);
    if (request && ownRequest) v.requestPictureInPicture = request;
    else if (request) delete (v as { requestPictureInPicture?: unknown }).requestPictureInPicture;
    delete (v as { disablePictureInPicture?: boolean }).disablePictureInPicture;
    guarded.delete(video);
    setNative(pageValue);
  };
}
