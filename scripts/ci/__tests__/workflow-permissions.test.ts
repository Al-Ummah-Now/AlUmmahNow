/**
 * Every workflow limits its GITHUB_TOKEN: a top-level `permissions:` block, or
 * one on every job (CodeQL actions/missing-workflow-permissions). Without it
 * the token gets the repository default, which may be read/write.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '..', '..', '..', '.github', 'workflows');

/** Job ids under `jobs:` whose block has no `permissions:` of its own. */
export function jobsWithoutPermissions(yaml: string): string[] {
  const lines = yaml.split('\n');
  if (lines.some((l) => /^permissions:/.test(l))) return [];
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start < 0) return [];
  const missing: string[] = [];
  let job: string | null = null;
  let hasPermissions = false;
  const close = () => {
    if (job && !hasPermissions) missing.push(job);
  };
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // next top-level key
    const id = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (id) {
      close();
      job = id[1];
      hasPermissions = false;
    } else if (/^ {4}permissions:/.test(line)) {
      hasPermissions = true;
    }
  }
  close();
  return missing;
}

describe('workflow permissions', () => {
  it('finds a job without permissions and accepts top-level or per-job blocks', () => {
    assert.deepEqual(jobsWithoutPermissions('on: push\njobs:\n  a:\n    runs-on: x\n  b:\n    permissions: {}\n'), ['a']);
    assert.deepEqual(jobsWithoutPermissions('on: push\npermissions: {}\njobs:\n  a:\n    runs-on: x\n'), []);
  });

  it('every workflow in .github/workflows limits its token', () => {
    const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));
    assert.ok(files.length > 0);
    const offenders = files.flatMap((f) => jobsWithoutPermissions(readFileSync(join(DIR, f), 'utf8')).map((job) => `${f}: ${job}`));
    assert.deepEqual(offenders, []);
  });
});
