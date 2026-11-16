import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmailText, emailParts } from '../src/components/EmailText';
import { personView } from '../src/components/audit/audit-model';
import { createTranslator } from '../src/i18n/translate';

(globalThis as unknown as { React: unknown }).React = React;

describe('email text', () => {
  it('breaks only after "@" and before each "."', () => {
    assert.deepEqual(emailParts('bilal@alummahnow.net'), ['bilal@', 'alummahnow', '.net']);
    assert.deepEqual(emailParts('yusuf.ali@mail.example.org'), ['yusuf.ali@', 'mail', '.example', '.org']);
    assert.deepEqual(emailParts('no-at-sign'), ['no-at-sign']);
  });

  it('renders isolated left to right, never broken inside a word, with the full address as its title', () => {
    const html = renderToStaticMarkup(React.createElement(EmailText as never, { email: 'bilal@alummahnow.net' } as never));
    assert.match(html, /^<bdi dir="ltr" title="bilal@alummahnow.net" class="\[overflow-wrap:normal\] \[word-break:normal\] ">bilal@<wbr\/>alummahnow<wbr\/>.net<\/bdi>$/);
  });

  it('a person with only an email is shown by that email, marked so it renders as one', () => {
    const t = createTranslator('ar');
    const p = personView('usr_b', { users: { usr_b: { id: 'usr_b', found: true, name: null, userName: null, email: 'bilal@alummahnow.net' } }, items: {} }, t);
    assert.equal(p.label, 'bilal@alummahnow.net');
    assert.equal(p.labelIsEmail, true);
    const named = personView('usr_a', { users: { usr_a: { id: 'usr_a', found: true, name: 'Amina', userName: null, email: 'a@x.org' } }, items: {} }, t);
    assert.equal(named.labelIsEmail, undefined);
  });
});
