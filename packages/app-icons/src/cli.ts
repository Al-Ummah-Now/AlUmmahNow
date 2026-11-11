// pnpm --filter @al-ummah/app-icons build crop --candidates <dir> --logo <logo.png>   (refresh assets/crops)
// pnpm --filter @al-ummah/app-icons build --app <id> --out <dir> [--base /icons/]
// pnpm --filter @al-ummah/app-icons build --app <id> --format ts --out <file.ts>
// pnpm --filter @al-ummah/app-icons build --app tools --format ico --out <app-icon.ico>
// pnpm --filter @al-ummah/app-icons build --sheet <file.html>
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { asModule, buildApp, CROPS, desktopIco } from './build.ts';
import { APP_IDS, cropFile, logoCrop, sourcesIn, type AppId } from './crop.ts';
import { contactSheet } from './sheet.ts';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
// pnpm runs package scripts in the package dir; resolve paths against the caller's directory
const cwd = process.env.INIT_CWD ?? process.cwd();

if (args[0] === 'crop') {
  const dir = resolve(cwd, flag('candidates') ?? 'icon-candidates');
  const logo = resolve(cwd, flag('logo') ?? '../AlUmmahNowUI/public/brand/alummah-now-logo.png');
  const sources = sourcesIn(dir);
  mkdirSync(CROPS, { recursive: true });
  for (const app of APP_IDS) {
    const src = sources[app];
    const crop = src === 'logo' ? await logoCrop(logo) : await cropFile(join(dir, src), app);
    // stored at 512 px (the largest output), lossless
    await sharp(crop).resize(512, 512, { kernel: 'lanczos3' }).webp({ lossless: true, effort: 6 }).toFile(join(CROPS, `${app}.webp`));
    console.log(`${app.padEnd(14)} <- ${src}`);
  }
  process.exit(0);
}

const sheet = flag('sheet');
if (sheet) {
  writeFileSync(resolve(cwd, sheet), await contactSheet());
  console.log(`wrote ${resolve(cwd, sheet)}`);
  process.exit(0);
}

const app = flag('app') as AppId | undefined;
const outArg = flag('out');
if (!app || !APP_IDS.includes(app) || !outArg) {
  console.error(`usage: crop | --app <${APP_IDS.join('|')}> --out <dir|file> [--format files|ts|ico] [--base /icons/] [--start-url /] | --sheet <file.html>`);
  process.exit(2);
}
const out = resolve(cwd, outArg);
if (flag('format') === 'ico') {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, await desktopIco(app));
  console.log(`wrote ${out}`);
  process.exit(0);
}
const files = await buildApp(app, { base: flag('base'), startUrl: flag('start-url') });
if (flag('format') === 'ts') {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, asModule(app, files));
  console.log(`wrote ${out}`);
} else {
  mkdirSync(out, { recursive: true });
  for (const f of files) {
    writeFileSync(join(out, f.path), f.body);
    console.log(`${f.path.padEnd(24)} ${String(f.body.length).padStart(7)} B`);
  }
}
