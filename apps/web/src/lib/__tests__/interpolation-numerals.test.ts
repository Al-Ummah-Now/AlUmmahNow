/**
 * Every helper that puts a number into a translated string writes it in the page's digits:
 * Eastern Arabic (Hindi) numerals ٠–٩ in Arabic, Arabic numerals 0–9 in English (#1488/#1496).
 * A helper that String()s a number would put 0–9 into Arabic text (Studio caption cost, #1507).
 */
import { fillTemplate as fillShared } from '@al-ummah/shared-types';
import { fill as fillContact } from '@/lib/contact/form';
import { fillTemplate as fillLibrary } from '@/lib/i18n/translations/library-notifications';
import { fill as fillPlaylist } from '@/components/playlists/text';
import { fill as fillEmbed } from '@/lib/embed/strings';

const AR = 'تستهلك {minutes} من الدقائق. يتبقى {remaining}. الحد {max}.';
const values = { minutes: 2, remaining: 30, max: 5000 };

describe('interpolation helpers write Arabic numbers in ٠–٩', () => {
  const helpers: Array<[string, (t: string, v: Record<string, number>) => string]> = [
    ['shared fillTemplate', (t, v) => fillShared('ar', t, v)],
    ['contact fill', (t, v) => fillContact(t, v, 'ar')],
    ['library fillTemplate', (t, v) => fillLibrary(t, v, 'ar')],
    ['playlist fill', (t, v) => fillPlaylist(t, v, 'ar')],
    ['embed fill', (t, v) => fillEmbed(t, v, 'ar')],
  ];
  it.each(helpers)('%s', (_name, fill) => {
    const out = fill(AR, values);
    expect(out).not.toMatch(/[0-9]/);
    expect(out).toContain('٢');
    expect(out).toContain('٣٠');
  });

  it('English keeps 0–9, and helpers without a language keep their old output', () => {
    expect(fillShared('en', 'Uses {minutes}. {remaining} left.', values)).toBe('Uses 2. 30 left.');
    expect(fillContact('At least {min}', { min: 10 })).toBe('At least 10');
    expect(fillLibrary('{count} videos', { count: 3 })).toBe('3 videos');
  });
});
