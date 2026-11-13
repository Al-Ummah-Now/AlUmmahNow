/**
 * Puts a sibling repo's last released build where the local stack expects it, without checking out
 * or installing that repo:
 *
 *   node --experimental-strip-types --no-warnings scripts/local-stack/fetch-auth.ts [--sha <sha>]
 *   node --experimental-strip-types --no-warnings scripts/local-stack/fetch-auth.ts --repo cms|www --optional
 *
 * auth → AUTH_DIR (required by the stack). cms, www → CMS_DIR, WWW_DIR: optional (`--optional`: no
 * bundle yet is a notice and exit 0, the stack then runs without them and the specs that cross into
 * them skip). AlUmmahNowCMS and AlUmmahNowUI publish the same kind of bundle (their
 * .github/workflows/local-stack-bundle.yml).
 *
 * The Auth repo publishes, for every released commit, the prerelease local-stack-<sha12> with
 * local-stack.tar.gz (prebuilt auth, profile and admin workers, their wrangler configs, every
 * migration) and local-stack.tar.gz.sha256 (AlUmmahNowAuth .github/workflows/local-stack-bundle.yml).
 * This resolves the released commit (resolve-refs.ts), downloads both, checks the sha256 and
 * unpacks into AUTH_DIR. Prints auth_sha=<sha> (append to $GITHUB_OUTPUT in CI).
 *
 * Nothing from that repo is checked out or installed here, so main and release runs of this repo
 * execute no second checkout (CodeQL actions/cache-poisoning). Uses GITHUB_TOKEN / GH_TOKEN when set.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUTH_DIR, CMS_DIR, STATE_DIR, WWW_DIR } from './stack.ts';
import { releasedRefs, SIBLINGS, type Sibling } from './resolve-refs.ts';

const TARGET_DIR: Record<Sibling, string> = { auth: AUTH_DIR, cms: CMS_DIR, www: WWW_DIR };

export function bundleTag(sha: string): string {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`not a full commit sha: ${sha}`);
  return `local-stack-${sha.slice(0, 12)}`;
}

async function download(url: string, token: string | undefined): Promise<Buffer> {
  const res = await fetch(url, { headers: { Accept: 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, redirect: 'follow' });
  if (!res.ok) throw new Error(`GET ${url} answered ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const given = args[args.indexOf('--sha') + 1];
  const name = (args.includes('--repo') ? args[args.indexOf('--repo') + 1] : 'auth') as Sibling;
  if (!(name in SIBLINGS)) throw new Error(`--repo must be one of ${Object.keys(SIBLINGS).join(', ')}`);
  const optional = args.includes('--optional');
  const REPO = SIBLINGS[name].repo;
  const TARGET = TARGET_DIR[name];
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  // The newest released commit whose bundle is published (it follows its release by a few minutes)
  const candidates = args.includes('--sha') && given ? [given] : (await releasedRefs(name)).slice(0, 5).map((r) => r.sha);
  let sha = '';
  let tag = '';
  let release: Response | null = null;
  for (const candidate of candidates) {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${bundleTag(candidate)}`, {
      headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (res.ok) {
      [sha, tag, release] = [candidate, bundleTag(candidate), res];
      break;
    }
    process.stderr.write(`[local-stack] ${REPO} ${candidate.slice(0, 7)}: no ${bundleTag(candidate)} yet (${res.status})\n`);
  }
  if (!release) {
    if (optional) {
      process.stderr.write(`[local-stack] ${REPO}: no local-stack bundle among its last released commits; the stack runs without ${name}\n`);
      return;
    }
    throw new Error(`${REPO}: none of its last released commits has a local-stack bundle; run its local-stack-bundle workflow by hand with sha=${candidates[0]}`);
  }
  const { assets } = (await release.json()) as { assets: { name: string; url: string }[] };
  const asset = (name: string) => {
    const found = assets.find((a) => a.name === name);
    if (!found) throw new Error(`${tag} has no ${name}`);
    return found.url;
  };
  const tarball = await download(asset('local-stack.tar.gz'), token);
  const expected = (await download(asset('local-stack.tar.gz.sha256'), token)).toString('utf8').trim().split(/\s+/)[0];
  const actual = createHash('sha256').update(tarball).digest('hex');
  if (actual !== expected) throw new Error(`${tag}: sha256 ${actual} does not match the published ${expected}`);

  rmSync(TARGET, { recursive: true, force: true });
  mkdirSync(TARGET, { recursive: true });
  const file = join(STATE_DIR, `${name}-local-stack.tar.gz`);
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(file, tarball);
  execFileSync('tar', ['-xzf', file, '-C', TARGET]);
  rmSync(file, { force: true });
  process.stderr.write(`[local-stack] ${REPO} ${sha.slice(0, 7)} (${tag}, sha256 ok) in ${TARGET}\n`);
  process.stdout.write(`${name}_sha=${sha}\n`);
}

if (import.meta.main) await main();
