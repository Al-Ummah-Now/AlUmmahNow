/**
 * Videos list titles and table column widths: the title in the admin's language, never the id;
 * the primary column keeps a minimum width so it never collapses to one letter per line.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adminVideoTitle } from '../src/lib/video-title';
import { PRIMARY_MIN_WIDTH, columnDisplayClass, columnWidthClass } from '../src/components/list/DataTable';

describe('adminVideoTitle', () => {
  const id = '55e83716-15ca-4b2e-9d6f-0a1b2c3d4e5f';
  it('prefers the creator title in the admin language', () => {
    const v = { id, title: 'Lesson one', titleLocalized: { en: 'Lesson one', ar: 'الدرس الأول' } };
    assert.equal(adminVideoTitle(v, 'ar'), 'الدرس الأول');
    assert.equal(adminVideoTitle(v, 'en'), 'Lesson one');
  });
  it('falls back to the stored title, then any localized title', () => {
    assert.equal(adminVideoTitle({ id, title: 'Stored', titleLocalized: { en: 'Eng' } }, 'ar'), 'Stored');
    assert.equal(adminVideoTitle({ id, title: '', titleLocalized: { ar: 'عربي' } }, 'en'), 'عربي');
  });
  it('never returns the id (older APIs filled an empty title with it)', () => {
    assert.equal(adminVideoTitle({ id, title: id }, 'en'), null);
    assert.equal(adminVideoTitle({ id, title: '  ' }, 'en'), null);
    assert.equal(adminVideoTitle({ id }, 'ar'), null);
  });
});

describe('DataTable column widths', () => {
  it('the primary column has a minimum width unless it sets its own', () => {
    assert.equal(columnWidthClass({ primary: true }), PRIMARY_MIN_WIDTH);
    assert.equal(columnWidthClass({ primary: true, minWidth: 'md:min-w-[18rem]' }), 'md:min-w-[18rem]');
    assert.equal(columnWidthClass({}), '');
    assert.equal(columnWidthClass({ nowrap: true }), 'md:whitespace-nowrap');
  });
  it('columns wait for the table width (container query), the md breakpoint, or always show', () => {
    assert.equal(columnDisplayClass({ from: '4xl' }, true), 'hidden @4xl:table-cell');
    assert.equal(columnDisplayClass({ wide: true }, true), 'hidden md:table-cell');
    assert.equal(columnDisplayClass({}, true), 'block md:table-cell');
    assert.equal(columnDisplayClass({}, false), '');
  });
  it('the Videos list sets a wider title column and keeps short columns on one line, and shows no ids', () => {
    const src = readFileSync(new URL('../src/app/(protected)/videos/VideosList.tsx', import.meta.url), 'utf8');
    assert.match(src, /minWidth: 'md:min-w-\[18rem\]'/);
    assert.match(src, /clamp-fade-2/);
    assert.doesNotMatch(src, /MonoId/);
    assert.doesNotMatch(src, /v\.title \|\| v\.id/);
  });
  it('the shared clamp never uses -webkit-line-clamp with an ellipsis (WebKit bidi crash pattern)', () => {
    const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');
    const util = css.slice(css.indexOf('@utility clamp-fade-2'), css.indexOf('@layer base'));
    assert.ok(util.includes('mask-image'));
    assert.doesNotMatch(util, /line-clamp|text-overflow/);
  });
});
