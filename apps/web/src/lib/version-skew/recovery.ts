/**
 * Version-skew recovery (a deploy while a page is open).
 *
 * A page keeps the JavaScript of the build that served it. After a deploy, a
 * request from that page can reach a build that no longer has what it asks
 * for: a Server Action id ("Server Action ... was not found on the server"),
 * an RSC payload, or a code-split chunk (ChunkLoadError). Skew protection
 * (open-next.config.ts) routes such requests to the old Worker version for
 * a while; this module is the last line of defence when that is not possible
 * (version too old, rollback, local dev): detect the error, show a small
 * "new version" notice and reload, but never while an upload is running.
 *
 * Pure logic, no React. VersionSkewProvider wires it to the window.
 * apps/admin-web/src/lib/version-skew/recovery.ts is a copy: keep them in step.
 */

/** Detects the errors a deploy causes in an open page. Never matches ordinary failures. */
export function isVersionSkewError(error: unknown): boolean {
  if (!error || (typeof error !== 'object' && typeof error !== 'string')) return false;
  const name = typeof error === 'object' ? String((error as { name?: unknown }).name ?? '') : '';
  const message = typeof error === 'string' ? error : String((error as { message?: unknown }).message ?? '');
  if (name === 'UnrecognizedActionError' || name === 'ChunkLoadError') return true;
  return SKEW_MESSAGES.some((re) => re.test(message));
}

const SKEW_MESSAGES: RegExp[] = [
  // Next.js: an action id the server does not have (E715)
  /Server Action "?[\w-]*"? was not found on the server/i,
  /failed-to-find-server-action/i,
  // webpack chunk loading (JS and CSS)
  /Loading (?:CSS )?chunk \S+ failed/i,
  // native dynamic import() of a chunk that no longer exists (Chrome, Firefox, Safari)
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
];

/** What the notice shows. */
export type SkewState = 'idle' | 'reloading' | 'waiting-for-uploads' | 'reload-blocked';

export interface SkewEvent {
  source: string;
  message: string;
  name: string;
  /** True when the reload waits for an upload to finish first */
  deferred: boolean;
}

// ---------------------------------------------------------------------------
// Reload holds: work that a reload would destroy (uploads) holds the reload.

let holds = 0;
const holdListeners = new Set<() => void>();

/**
 * Holds any automatic reload until the returned release() is called.
 * Uploads call this while bytes are in flight; release() is idempotent.
 */
export function holdReload(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
    if (holds === 0) holdListeners.forEach((l) => l());
  };
}

export function isReloadHeld(): boolean {
  return holds > 0;
}

function onHoldsReleased(listener: () => void): () => void {
  holdListeners.add(listener);
  return () => holdListeners.delete(listener);
}

// ---------------------------------------------------------------------------

export interface RecoveryDeps {
  reload: () => void;
  /** Called once per skew event, before recovering (error reporting hooks in here) */
  report: (event: SkewEvent) => void;
  setState: (state: SkewState) => void;
  /** sessionStorage-like store for the reload-loop guard; null when unavailable */
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  now?: () => number;
  /** How long the notice shows before the reload */
  delayMs?: number;
  schedule?: (fn: () => void, ms: number) => unknown;
}

const RELOAD_KEY = 'aun:version-skew-reload-at';
/** A second skew within this window after a reload means reloading does not help */
export const RELOAD_LOOP_WINDOW_MS = 60_000;

export interface SkewRecovery {
  /** Returns true when the error was version skew and recovery has started */
  handle: (error: unknown, source: string) => boolean;
  dispose: () => void;
}

export function createSkewRecovery(deps: RecoveryDeps): SkewRecovery {
  const now = deps.now ?? Date.now;
  const schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const delayMs = deps.delayMs ?? 1500;
  let started = false;
  let unsubscribe: (() => void) | null = null;

  const recentlyReloaded = () => {
    try {
      const at = Number(deps.storage?.getItem(RELOAD_KEY) ?? 0);
      return at > 0 && now() - at < RELOAD_LOOP_WINDOW_MS;
    } catch {
      return false;
    }
  };

  const reloadNow = () => {
    deps.setState('reloading');
    schedule(() => {
      // An upload may have started while the notice showed
      if (isReloadHeld()) return waitForUploads();
      try {
        deps.storage?.setItem(RELOAD_KEY, String(now()));
      } catch {
        // storage blocked: the loop guard is best effort
      }
      deps.reload();
    }, delayMs);
  };

  const waitForUploads = () => {
    deps.setState('waiting-for-uploads');
    unsubscribe?.();
    unsubscribe = onHoldsReleased(() => {
      unsubscribe?.();
      unsubscribe = null;
      reloadNow();
    });
  };

  return {
    handle(error, source) {
      if (!isVersionSkewError(error)) return false;
      if (started) return true;
      started = true;
      const deferred = isReloadHeld();
      const e = (typeof error === 'object' && error) || {};
      deps.report({
        source,
        name: String((e as { name?: unknown }).name ?? ''),
        message: typeof error === 'string' ? error : String((e as { message?: unknown }).message ?? ''),
        deferred,
      });
      if (recentlyReloaded()) {
        // Reloading already failed to fix it: ask the user instead of looping
        deps.setState('reload-blocked');
        return true;
      }
      if (deferred) waitForUploads();
      else reloadNow();
      return true;
    },
    dispose() {
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}

// ---------------------------------------------------------------------------
// Page-wide singleton, so catch blocks and error boundaries can hand an error over.

let active: SkewRecovery | null = null;

export function setActiveSkewRecovery(recovery: SkewRecovery | null): void {
  active = recovery;
}

/**
 * For catch blocks and error boundaries: if `error` is version skew, starts
 * the recovery (notice + reload) and returns true, so the caller shows nothing
 * of its own. Returns false for every other error.
 */
export function recoverFromVersionSkew(error: unknown, source = 'caught'): boolean {
  if (!isVersionSkewError(error)) return false;
  if (active) return active.handle(error, source);
  // No provider mounted (should not happen): plain reload is still better than a raw error
  if (typeof window !== 'undefined' && !isReloadHeld()) window.location.reload();
  return true;
}
