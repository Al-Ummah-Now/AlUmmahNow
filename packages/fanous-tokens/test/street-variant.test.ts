/**
 * street/fanous-street.js pickStreetVariant: the server picks the street tile variant per response
 * (<html data-fanous-street-variant>); a valid aun_street_variant cookie pins it for visual tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickStreetVariant, STREET_VARIANTS, STREET_VARIANT_ATTR, STREET_VARIANT_COOKIE } from '../street/fanous-street.js';

test('random pick covers 1..STREET_VARIANTS and never leaves it', () => {
  assert.equal(STREET_VARIANTS, 4);
  assert.equal(pickStreetVariant(null, () => 0), 1);
  assert.equal(pickStreetVariant(undefined, () => 0.26), 2);
  assert.equal(pickStreetVariant('', () => 0.5), 3);
  assert.equal(pickStreetVariant('a=b', () => 0.999999), 4);
  // A random source that returns 1 (out of contract) still stays in range
  assert.equal(pickStreetVariant(null, () => 1), 4);
  const seen = new Set<number>();
  for (let i = 0; i < 400; i++) seen.add(pickStreetVariant(null));
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4]);
});

test('the cookie pins a variant; anything else is ignored', () => {
  assert.equal(STREET_VARIANT_COOKIE, 'aun_street_variant');
  assert.equal(STREET_VARIANT_ATTR, 'data-fanous-street-variant');
  const rnd = () => 0; // would pick 1
  assert.equal(pickStreetVariant('aun_street_variant=3', rnd), 3);
  assert.equal(pickStreetVariant('x=1; aun_street_variant=4; y=2', rnd), 4);
  assert.equal(pickStreetVariant('x=1;aun_street_variant=2', rnd), 2);
  for (const bad of ['aun_street_variant=5', 'aun_street_variant=0', 'aun_street_variant=12', 'aun_street_variant=two', 'my_aun_street_variant=3', 'aun_street_variant=3x']) {
    assert.equal(pickStreetVariant(bad, rnd), 1, bad);
  }
});
