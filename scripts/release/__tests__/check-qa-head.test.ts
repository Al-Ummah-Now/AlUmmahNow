import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../check-qa-head.sh', import.meta.url));

test('QA head guard skips a superseded build and permits the current build', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'qa-head-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('remote', 'add', 'origin', cwd);
  const commit = (message: string) => {
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', message, '--allow-empty');
    return git('rev-parse', 'HEAD');
  };
  const stale = commit('older build');
  const current = commit('newer build');
  const check = (sha: string, output: string) => spawnSync('bash', [script], {
    cwd,
    env: { ...process.env, GITHUB_SHA: sha, GITHUB_OUTPUT: output },
    encoding: 'utf8',
  });

  const staleOutput = join(cwd, 'stale');
  const staleCheck = check(stale, staleOutput);
  assert.equal(staleCheck.status, 0, staleCheck.stderr);
  assert.equal(readFileSync(staleOutput, 'utf8'), 'current=false\n');

  const currentOutput = join(cwd, 'current');
  const currentCheck = check(current, currentOutput);
  assert.equal(currentCheck.status, 0, currentCheck.stderr);
  assert.equal(readFileSync(currentOutput, 'utf8'), 'current=true\n');

  git('branch', '-m', 'renamed');
  const missingOutput = join(cwd, 'missing');
  assert.notEqual(check(current, missingOutput).status, 0);
  assert.equal(existsSync(missingOutput), false);
});
