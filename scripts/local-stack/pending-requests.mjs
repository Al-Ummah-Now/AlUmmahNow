// Diagnostic (local E2E, WebKit): opens a page through the stack's browser proxy, waits, and prints
// every request that started but never finished: what a page's `load` event is still waiting on.
//   node scripts/local-stack/pending-requests.mjs [webkit|chromium|firefox] [url]
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const pw = require('@playwright/test');
const [name = 'webkit', target = 'http://localhost:3001/en'] = process.argv.slice(2);
const browser = await pw[name].launch();
const context = await browser.newContext({ proxy: { server: 'http://127.0.0.1:3191', bypass: 'localhost,127.0.0.1' }, ignoreHTTPSErrors: true });
const page = await context.newPage();
const pending = new Map();
page.on('request', (r) => pending.set(r, Date.now()));
page.on('requestfinished', (r) => pending.delete(r));
page.on('requestfailed', (r) => { console.log(`failed  ${r.method()} ${r.url().slice(0, 160)} (${r.failure()?.errorText})`); pending.delete(r); });
page.on('console', (m) => m.type() === 'error' && console.log(`console ${m.text().slice(0, 200)}`));
const loaded = page.waitForEvent('load', { timeout: 25000 }).then(() => 'load fired', () => 'no load event in 25 s');
await page.goto(target, { waitUntil: 'commit' });
console.log(`${name} ${target}: ${await loaded}`);
for (const [r, at] of pending) console.log(`pending ${r.method()} ${r.resourceType()} ${r.url().slice(0, 160)} (${Math.round((Date.now() - at) / 1000)} s)`);
await browser.close();
