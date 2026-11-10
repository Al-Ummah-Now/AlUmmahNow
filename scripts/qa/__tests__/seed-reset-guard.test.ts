import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { passwordResetRefusal, seedTargetOf } from '../../../apps/web/e2e/seed/seed-reset-guard.ts';

const SEED = ['qa-admin@e2e.alummahnow.net', 'qa-sso-cms@e2e.alummahnow.net', 'qa-admin@delivered.resend.dev'];
const STAGE = 'https://auth.stage.alummahnow.net';
const QA = 'https://auth.qa.alummahnow.net';

describe('seed password reset guard', () => {
  it('knows the environments from the issuer', () => {
    assert.equal(seedTargetOf(QA), 'qa');
    assert.equal(seedTargetOf(STAGE), 'stage');
    assert.equal(seedTargetOf('https://auth.alummahnow.net'), 'production');
    assert.equal(seedTargetOf('https://auth.alummahnow.net/'), 'production');
    assert.equal(seedTargetOf('https://evil.example'), 'unknown');
    assert.equal(seedTargetOf('not a url'), 'unknown');
  });

  it('refuses the production auth server, even for a seed account', () => {
    const refusal = passwordResetRefusal('https://auth.alummahnow.net', 'qa-admin@e2e.alummahnow.net', SEED);
    assert.match(refusal ?? '', /only for the QA and stage/);
    assert.match(refusal ?? '', /production/);
  });

  it('refuses unknown or look-alike auth servers', () => {
    for (const issuer of ['https://auth.stage.alummahnow.net.evil.example', 'http://localhost:3301', 'https://admin.stage.alummahnow.net']) {
      assert.notEqual(passwordResetRefusal(issuer, 'qa-admin@e2e.alummahnow.net', SEED), null, issuer);
    }
  });

  it('allows only the seed accounts on the code sink domain, on QA and stage', () => {
    assert.equal(passwordResetRefusal(STAGE, 'qa-sso-cms@e2e.alummahnow.net', SEED), null);
    assert.equal(passwordResetRefusal(QA, ' QA-Admin@e2e.alummahnow.net ', SEED), null);
    // Not a seed account, even on the sink domain
    assert.match(passwordResetRefusal(STAGE, 'someone@e2e.alummahnow.net', SEED) ?? '', /only for the seed accounts/);
    // A real user
    assert.match(passwordResetRefusal(STAGE, 'scholar@gmail.com', SEED) ?? '', /only for the seed accounts/);
    // A seed account whose mail is really delivered (Resend), not the sink
    assert.match(passwordResetRefusal(QA, 'qa-admin@delivered.resend.dev', SEED) ?? '', /code sink domain/);
  });
});
