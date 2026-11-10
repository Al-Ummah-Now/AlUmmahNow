/**
 * Classifying browser failures and reading the user agent, shared by the
 * client reporter (what to show, what to sample) and admin-api (browser/OS
 * columns; the raw user agent is never stored).
 */

/** The page and the server are on different deployments (after a deploy, an open tab calls code that no longer exists). */
export function isVersionSkewError(error: unknown): boolean {
  const msg = messageOf(error);
  return (
    /Server Action "[^"]*" was not found on the server/i.test(msg) ||
    /failed-to-find-server-action/i.test(msg) ||
    /Failed to find Server Action/i.test(msg) ||
    /deployment.*(mismatch|skew)/i.test(msg)
  );
}

/** A script/style chunk failed to load: after a deploy, or a flaky network. */
export function isChunkLoadError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name ?? '';
  const msg = messageOf(error);
  return (
    name === 'ChunkLoadError' ||
    /Loading (CSS )?chunk [\w-]+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg)
  );
}

/** A request never got an answer (offline, DNS, CORS, aborted). */
export function isNetworkError(error: unknown): boolean {
  const msg = messageOf(error);
  return /^(TypeError: )?(Failed to fetch|NetworkError when attempting to fetch resource\.|Load failed|Network request failed)$/i.test(msg);
}

/** Noise that is not ours or not actionable: never reported. */
export function isIgnorableError(error: unknown, stack?: string): boolean {
  const msg = messageOf(error);
  if (!msg) return true;
  if (/^Script error\.?$/i.test(msg)) return true; // cross-origin script, no details
  if (/ResizeObserver loop (limit exceeded|completed with undelivered notifications)/i.test(msg)) return true;
  if (/^(AbortError|The (operation|user) (was|aborted)|signal is aborted)/i.test(msg) || (error as { name?: string })?.name === 'AbortError') return true;
  if (/NEXT_(REDIRECT|NOT_FOUND|HTTP_ERROR_FALLBACK)/.test(msg)) return true; // Next control flow, not errors
  if (stack && /(chrome|moz|safari-web)-extension:\/\//.test(stack) && !/\/_next\//.test(stack)) return true;
  return false;
}

export function messageOf(error: unknown): string {
  if (error == null) return '';
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  try {
    return String(error);
  } catch {
    return '';
  }
}

/** "Chrome 131" / "Safari 18" / "Firefox 133" and "macOS" / "iOS 18" / "Android 15" / "Windows". */
export function parseUserAgent(ua: string | undefined | null): { browser: string; os: string } {
  if (!ua) return { browser: '', os: '' };
  const pick = (re: RegExp) => re.exec(ua)?.[1]?.split('.')[0];
  let browser = '';
  let v: string | undefined;
  if ((v = pick(/Edg(?:e|A|iOS)?\/([\d.]+)/))) browser = `Edge ${v}`;
  else if ((v = pick(/SamsungBrowser\/([\d.]+)/))) browser = `Samsung Internet ${v}`;
  else if ((v = pick(/OPR\/([\d.]+)/))) browser = `Opera ${v}`;
  else if ((v = pick(/(?:Firefox|FxiOS)\/([\d.]+)/))) browser = `Firefox ${v}`;
  else if ((v = pick(/(?:Chrome|CriOS)\/([\d.]+)/))) browser = `Chrome ${v}`;
  else if ((v = pick(/Version\/([\d.]+).*Safari/))) browser = `Safari ${v}`;
  else if (/bot|crawler|spider|HeadlessChrome/i.test(ua)) browser = 'Bot';
  if (/HeadlessChrome/.test(ua)) browser = `Headless ${browser || 'Chrome'}`;

  let os = '';
  if ((v = pick(/(?:iPhone|CPU) OS ([\d_]+)/))) os = `iOS ${v}`;
  else if (/iPad/.test(ua)) os = 'iPadOS';
  else if ((v = pick(/Android ([\d.]+)/))) os = `Android ${v}`;
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  return { browser: browser.slice(0, 40), os: os.slice(0, 40) };
}
