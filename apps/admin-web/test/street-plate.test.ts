/**
 * Street plate layering contract (packages/fanous-tokens/street/fanous-street.css,
 * apps/admin-web/src/app/globals.css, apps/web/src/theme/fawanees.css):
 *
 * A street plate blocks the Fawanees lantern street behind loose page text. It MUST paint on
 * ::before at z-index: -1 (with z-index: auto on the host) so it never paints over sibling text,
 * icons, pills or card borders when plated elements are flex items, grid items or inline-blocks.
 * Inside solid cards/heroes/panels (such as CostsHeader .cost-hero or .bg-surface cards) and on
 * styled pills/chips, the admin page-title selector must not apply at all.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('street-plate layering contract', () => {
  it('shared fanous-street.css paints street layers at z-index -2 and .street-plate on ::before at z-index -1', () => {
    const css = stripComments(read('packages/fanous-tokens/street/fanous-street.css'));
    const streetMatch = css.match(/html\.fanous-street\s+body::before,\s*html\.fanous-street\s+body::after\s*\{([^}]*)\}/);
    assert.ok(streetMatch, 'expected body::before/::after street layer rule');
    assert.match(streetMatch[1], /z-index:\s*-2/, 'street layers must be at z-index -2 so ::after sits behind ::before plates at -1');

    const webGlobals = stripComments(read('apps/web/src/app/globals.css'));
    const webStreetMatch = webGlobals.match(/html\.fanous-street\s+\.demo-layer::before,\s*html\.fanous-street\s+\.demo-layer::after\s*\{([^}]*)\}/);
    assert.ok(webStreetMatch, 'expected .demo-layer::before/::after street layer rule');
    assert.match(webStreetMatch[1], /z-index:\s*-2/, 'web street layers must be at z-index -2 so ::after sits behind ::before plates at -1');

    const hostMatch = css.match(/html\.fanous-street\s+\.street-plate\s*\{([^}]*)\}/);
    assert.ok(hostMatch, 'expected html.fanous-street .street-plate host rule');
    assert.match(hostMatch[1], /position:\s*relative/);
    assert.doesNotMatch(hostMatch[1], /box-shadow\s*:/, 'host must not paint box-shadow directly');
    assert.doesNotMatch(hostMatch[1], /background\s*:/, 'host must not paint background directly');
    assert.doesNotMatch(hostMatch[1], /z-index\s*:/, 'host must not create a stacking context');

    const beforeMatch = css.match(/html\.fanous-street\s+\.street-plate::before\s*\{([^}]*)\}/);
    assert.ok(beforeMatch, 'expected html.fanous-street .street-plate::before rule');
    assert.match(beforeMatch[1], /z-index:\s*-1/);
    assert.match(beforeMatch[1], /pointer-events:\s*none/);
    assert.match(beforeMatch[1], /box-shadow\s*:/);
  });

  it('admin-web globals.css paints page-title plates on ::before at z-index: -1 and excludes cards and pills', () => {
    const css = stripComments(read('apps/admin-web/src/app/globals.css'));
    // Extract every rule whose selector targets #main-content and h1
    const rules = [...css.matchAll(/([^{}]*#main-content[^{}]*h1[^{}]*)\{([^}]*)\}/g)];
    assert.ok(rules.length >= 2, 'expected host and ::before rules for admin page-title plates');

    const hostRules = rules.filter(([, sel]) => !sel.includes('::before'));
    const beforeRules = rules.filter(([, sel, body]) => sel.includes('::before') && !body.includes('display: none'));
    assert.ok(hostRules.length >= 1, 'expected admin page-title host rule');
    assert.ok(beforeRules.length >= 1, 'expected admin page-title ::before rule');

    for (const [, sel, body] of hostRules) {
      assert.doesNotMatch(body, /box-shadow\s*:/, 'admin host rule must not paint box-shadow directly');
      assert.doesNotMatch(body, /background\s*:/, 'admin host rule must not paint background directly');
      assert.doesNotMatch(body, /z-index\s*:/, 'admin host rule must not create a stacking context');
      for (const excluded of ['.cost-hero *', '.bg-surface *', '.cost-panel *', '.cost-pill', "[class*='bg-']", "[class*='border']"]) {
        assert.ok(sel.includes(excluded), `admin street-plate selector must exclude ${excluded}`);
      }
    }

    const plateBefore = beforeRules.find(([, , body]) => body.includes('box-shadow'));
    assert.ok(plateBefore, 'expected ::before rule painting the street plate');
    assert.match(plateBefore[2], /z-index:\s*-1/);
    assert.match(plateBefore[2], /pointer-events:\s*none/);
    for (const excluded of ['.cost-hero *', '.bg-surface *', '.cost-pill']) {
      assert.ok(plateBefore[1].includes(excluded), `admin ::before selector must exclude ${excluded}`);
    }
  });

  it('web fawanees.css delegates .street-plate to fanous-street.css without a host box-shadow', () => {
    const css = stripComments(read('apps/web/src/theme/fawanees.css'));
    assert.doesNotMatch(css, /\.street-plate\s*\{[^}]*box-shadow/, 'fawanees.css must not paint box-shadow directly on .street-plate');
  });
});
