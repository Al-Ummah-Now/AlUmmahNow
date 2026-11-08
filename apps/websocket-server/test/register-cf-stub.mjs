// Make `cloudflare:workers` resolve to a local stub under Node (node/tsx --import this file).
// tsx may load the sources as CommonJS or ESM, so hook both resolvers.
import Module, { register } from 'node:module';
import { fileURLToPath } from 'node:url';

const stubUrl = new URL('./cloudflare-workers-stub.cjs', import.meta.url);
const stubPath = fileURLToPath(stubUrl);

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'cloudflare:workers') return stubPath;
  return originalResolve.call(this, request, ...rest);
};

register(
  'data:text/javascript,' +
    encodeURIComponent(`
      export async function resolve(specifier, context, next) {
        if (specifier === 'cloudflare:workers') {
          return { url: ${JSON.stringify(stubUrl.href)}, shortCircuit: true };
        }
        return next(specifier, context);
      }
    `),
);
