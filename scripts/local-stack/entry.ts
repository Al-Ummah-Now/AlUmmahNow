/**
 * The generated entry module's assets-first wrapper (boot.ts writeEntry). Pure: no wrangler, so the
 * release checks can test it without an install.
 */

/** A wrangler run_worker_first pattern ("/_next/static/*") as a RegExp source. */
export function workerFirstPattern(pattern: string): string {
  return `^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`;
}

/**
 * Cloudflare serves a worker's static assets before the worker, except for its run_worker_first
 * paths. The stack's sockets go straight to the worker, so the entry does the same: a GET/HEAD
 * the assets binding has a file for is answered from it; everything else (and every
 * run_worker_first path, such as OpenNext's skew-protected /_next/static/*) goes to the worker.
 * Without this, public files (web's /brand/logo-*.webp, favicons, icons) reach the app's router
 * and answer 404.
 */
export function assetsFirstEntry(target: string, binding: string, workerFirst: string[]): string {
  const patterns = workerFirst.filter((p) => !p.startsWith('!')).map(workerFirstPattern);
  return [
    `import worker from ${JSON.stringify(target)};`,
    `const WORKER_FIRST = ${JSON.stringify(patterns)}.map((p) => new RegExp(p));`,
    'export default {',
    '  ...worker,',
    '  async fetch(request, env, ctx) {',
    '    const { pathname } = new URL(request.url);',
    "    if ((request.method === 'GET' || request.method === 'HEAD') && pathname !== '/' && !WORKER_FIRST.some((re) => re.test(pathname))) {",
    `      const asset = await env[${JSON.stringify(binding)}].fetch(request);`,
    '      if (asset.status !== 404) return asset;',
    '    }',
    '    return worker.fetch(request, env, ctx);',
    '  },',
    '};',
  ].join('\n');
}
