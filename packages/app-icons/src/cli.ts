// pnpm --filter @al-ummah/app-icons build --app <id> --out <dir> [--base /icons/] [--legacy-png]
// pnpm --filter @al-ummah/app-icons build --app <id> --format ts --out <file.ts>
// pnpm --filter @al-ummah/app-icons build --sheet <file.html>   (contact sheet of every app)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { asModule, buildApp } from './build.ts';
import { APP_IDS, type AppId } from './marks.ts';
import { contactSheet } from './sheet.ts';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
// pnpm runs package scripts in the package dir; resolve paths against the caller's directory
const cwd = process.env.INIT_CWD ?? process.cwd();

const sheet = flag('sheet');
if (sheet) {
  const out = resolve(cwd, sheet);
  writeFileSync(out, await contactSheet());
  console.log(`wrote ${out}`);
  process.exit(0);
}

const app = flag('app') as AppId | undefined;
const outArg = flag('out');
if (!app || !APP_IDS.includes(app) || !outArg) {
  console.error(`usage: --app <${APP_IDS.join('|')}> --out <dir|file.ts> [--format files|ts] [--base /icons/] [--start-url /] [--legacy-png]`);
  process.exit(2);
}
const out = resolve(cwd, outArg);
const files = await buildApp(app, { base: flag('base'), startUrl: flag('start-url'), legacyPng: args.includes('--legacy-png') });
if (flag('format') === 'ts') {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, asModule(app, files));
  console.log(`wrote ${out}`);
} else {
  mkdirSync(out, { recursive: true });
  for (const f of files) {
    writeFileSync(join(out, f.path), f.body);
    console.log(`${f.path.padEnd(24)} ${String(f.body.length).padStart(6)} B`);
  }
}
