/**
 * Puts a CMS or www build from a branch or a local checkout where the local stack runs it, in
 * place of the released bundle fetch-auth.ts --repo cms|www downloads. For trying cross-app changes
 * (a CMS feature with the www and videos pages that show it) before the sibling repo releases them:
 *
 *   node --experimental-strip-types --no-warnings scripts/local-stack/sibling-build.ts --repo cms --checkout ../AlUmmahNowCMS
 *   node --experimental-strip-types --no-warnings scripts/local-stack/sibling-build.ts --repo www --ref feat/page-builder
 *
 * --checkout <dir>  an existing checkout of that repo, used as it is (dependencies installed when
 *                   node_modules is missing).
 * --ref <ref>       a branch, tag or commit of that repo: fetched (depth 1) into
 *                   .local-stack/src/<repo>, then installed with npm ci.
 *
 * Then the repo's own scripts/release/local-stack-bundle.sh (the same one its local-stack-bundle.yml
 * runs for releases; www is built first) assembles dist/local-stack, which replaces CMS_DIR / WWW_DIR
 * (LOCAL_STACK_CMS_DIR / LOCAL_STACK_WWW_DIR when set). Boot it as usual afterwards.
 *
 * Local only: it checks out and runs another repo's code, which CI on main and in releases never does
 * (released bundles only, fetch-auth.ts). Prints <repo>_sha=<sha>.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CMS_DIR, STATE_DIR, WWW_DIR } from './stack.ts';
import { SIBLINGS } from './resolve-refs.ts';

type Repo = 'cms' | 'www';
const TARGET: Record<Repo, string> = { cms: CMS_DIR, www: WWW_DIR };

export interface SiblingArgs {
  repo: Repo;
  checkout: string | null;
  ref: string | null;
}

export function parseArgs(argv: string[]): SiblingArgs {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    if (i < 0) return null;
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) throw new Error(`${flag} needs a value`);
    return v;
  };
  const repo = value('--repo');
  if (repo !== 'cms' && repo !== 'www') throw new Error('--repo must be cms or www');
  const checkout = value('--checkout');
  const ref = value('--ref');
  if (!!checkout === !!ref) throw new Error('give exactly one of --checkout <dir> or --ref <branch|tag|sha>');
  // A ref reaches git as an argument (never a shell); still, refuse anything that is not a plain ref name
  if (ref && !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(ref)) throw new Error(`not a plain git ref: ${ref}`);
  return { repo, checkout, ref };
}

const log = (m: string) => process.stderr.write(`[local-stack] ${m}\n`);
const run = (cmd: string, args: string[], cwd: string) => execFileSync(cmd, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' } });

function fetchRef(repo: Repo, ref: string): string {
  const dir = join(STATE_DIR, 'src', repo);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const url = `https://github.com/${SIBLINGS[repo].repo}.git`;
  run('git', ['init', '-q'], dir);
  // A token, when set, goes in a header for this one command (never in the stored remote URL)
  const auth = token ? ['-c', `http.extraHeader=Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`] : [];
  run('git', [...auth, 'fetch', '-q', '--depth', '1', url, ref], dir);
  run('git', ['checkout', '-q', 'FETCH_HEAD'], dir);
  return dir;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const src = args.checkout ? resolve(args.checkout) : fetchRef(args.repo, args.ref as string);
  const script = join(src, 'scripts/release/local-stack-bundle.sh');
  if (!existsSync(script)) throw new Error(`${src} has no scripts/release/local-stack-bundle.sh: not an ${SIBLINGS[args.repo].repo} checkout, or one older than its local-stack bundles`);
  if (args.ref || !existsSync(join(src, 'node_modules'))) run('npm', ['ci', '--no-audit', '--no-fund'], src);
  if (args.repo === 'www') run('npm', ['run', 'build'], join(src, 'apps/www'));
  run('bash', [script], src);
  const out = join(src, 'dist/local-stack');
  const target = TARGET[args.repo];
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(out, target, { recursive: true });
  const sha = (JSON.parse(readFileSync(join(target, 'local-stack.json'), 'utf8')) as { sha?: string }).sha ?? '';
  log(`${SIBLINGS[args.repo].repo} ${sha.slice(0, 7)} (${args.checkout ? `checkout ${src}` : `ref ${args.ref}`}) in ${target}`);
  process.stdout.write(`${args.repo}_sha=${sha}\n`);
}

if (import.meta.main) main();
