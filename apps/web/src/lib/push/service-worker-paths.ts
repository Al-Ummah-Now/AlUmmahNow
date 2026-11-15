/** Where the Web Push service worker is served (app/push-sw.js/route.ts) and the scope it is registered with. */
export const PUSH_SW_PATH = '/push-sw.js';
/** A scope no page lives under: the worker handles pushes and clicks, never page or asset requests. */
export const PUSH_SW_SCOPE = '/push/';
