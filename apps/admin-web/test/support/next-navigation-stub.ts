/**
 * Client components call next/navigation's useRouter. Under node:test that
 * module reads the router from Next's own React copy (not this app's), so a
 * render fails with "Invalid hook call". Import this module first: it puts a
 * stand-in for next/navigation in the require cache (tsx runs the tests as
 * CommonJS), whose router records refresh() calls. next/link has the same
 * problem; it renders as a plain anchor here.
 */
import Module from 'node:module';
import * as React from 'react';

export const routerCalls: string[] = [];
export const testRouter = {
  push: (href: string) => void routerCalls.push(`push ${href}`),
  replace: (href: string) => void routerCalls.push(`replace ${href}`),
  refresh: () => void routerCalls.push('refresh'),
  back: () => void routerCalls.push('back'),
  forward: () => void routerCalls.push('forward'),
  prefetch: () => undefined,
};

const require = Module.createRequire(__filename);

function stubModule(name: string, exports: unknown) {
  const id = require.resolve(name);
  const stub = new Module(id);
  stub.filename = id;
  stub.loaded = true;
  stub.exports = exports;
  require.cache[id] = stub;
}

stubModule('next/navigation', {
  useRouter: () => testRouter,
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
});

function Link({ href, children, prefetch: _prefetch, ...rest }: { href: string; children?: React.ReactNode; prefetch?: boolean } & Record<string, unknown>) {
  return React.createElement('a', { href, ...rest }, children);
}
stubModule('next/link', { __esModule: true, default: Link });
