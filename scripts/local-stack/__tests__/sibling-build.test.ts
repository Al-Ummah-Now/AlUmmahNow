import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../sibling-build.ts';

test('sibling-build: a repo and exactly one source', () => {
  assert.deepEqual(parseArgs(['--repo', 'cms', '--checkout', '../AlUmmahNowCMS']), { repo: 'cms', checkout: '../AlUmmahNowCMS', ref: null });
  assert.deepEqual(parseArgs(['--repo', 'www', '--ref', 'feat/page-builder']), { repo: 'www', checkout: null, ref: 'feat/page-builder' });
  assert.throws(() => parseArgs(['--repo', 'auth', '--ref', 'main']), /cms or www/);
  assert.throws(() => parseArgs(['--repo', 'cms']), /exactly one/);
  assert.throws(() => parseArgs(['--repo', 'cms', '--ref', 'main', '--checkout', '.']), /exactly one/);
  assert.throws(() => parseArgs(['--repo', 'cms', '--ref']), /needs a value/);
});

test('sibling-build: only plain ref names', () => {
  for (const bad of ['-x', '--upload-pack=sh', 'a b', 'a;rm', '$(id)']) assert.throws(() => parseArgs(['--repo', 'cms', '--ref', bad]));
  assert.equal(parseArgs(['--repo', 'cms', '--ref', '38149bb471345b0ea70e9a5212f73a11bdd1cd35']).ref, '38149bb471345b0ea70e9a5212f73a11bdd1cd35');
  assert.equal(parseArgs(['--repo', 'cms', '--ref', 'v2026.11.14.2']).ref, 'v2026.11.14.2');
});
