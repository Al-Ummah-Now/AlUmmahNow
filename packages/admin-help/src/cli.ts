/**
 * pnpm check:admin-help (wiki AUN-ADMIN-HELP): the help content is valid and every admin setting
 * in the covered folders has an entry. Prints one line per problem (GitHub annotations in CI).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HelpArea } from './types.ts';
import { checkControls, duplicateIds, tipIds, validateArea, type Problem } from './validate.ts';

const repo = resolve(fileURLToPath(import.meta.url), '../../../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

export function run(root = repo): { problems: Problem[]; settings: number; files: number } {
  const config = JSON.parse(readFileSync(join(root, 'packages/admin-help/coverage.json'), 'utf8')) as {
    apps: Record<string, { content: string; root: string; covered: string[] }>;
  };
  const problems: Problem[] = [];
  let settings = 0;
  let files = 0;
  for (const app of Object.values(config.apps)) {
    const dir = join(root, app.content);
    const areas: { file: string; area: HelpArea }[] = [];
    const index = readFileSync(join(dir, 'index.ts'), 'utf8');
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
      const file = relative(root, join(dir, name));
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      } catch (e) {
        problems.push({ file, message: `not valid JSON: ${e instanceof Error ? e.message : String(e)}` });
        continue;
      }
      problems.push(...validateArea(file, raw, basename(name, '.json')));
      if (!index.includes(`'./${name}'`)) problems.push({ file, message: `missing from ${relative(root, join(dir, 'index.ts'))}` });
      areas.push({ file, area: raw as HelpArea });
    }
    problems.push(...duplicateIds(areas));
    const known = new Set(areas.flatMap(({ area }) => (area.settings ?? []).map((e) => e.id)));
    settings += known.size;

    const appRoot = join(root, app.root);
    const shown = new Set<string>();
    for (const f of walk(appRoot)) for (const id of tipIds(readFileSync(f, 'utf8'))) shown.add(id);
    for (const { file, area } of areas) for (const e of area.settings ?? []) if (!shown.has(e.id)) problems.push({ file, message: `${e.id} is not shown by any <HelpTip id="${e.id}"> in ${app.root}` });

    for (const folder of app.covered) {
      for (const f of walk(join(appRoot, folder))) {
        files++;
        problems.push(...checkControls(relative(root, f), readFileSync(f, 'utf8'), known));
      }
    }
  }
  return { problems, settings, files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { problems, settings, files } = run();
  for (const p of problems) console.error(`::error file=${p.file}${p.line ? `,line=${p.line}` : ''}::${p.message}`);
  if (problems.length) {
    console.error(`admin help: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.warn(`admin help: ${settings} settings, ${files} covered files, all have help`);
}
