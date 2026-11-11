/**
 * Autocomplete: the ARIA 1.2 combobox every search and lookup input uses.
 */
import React, { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { EN_TRANSLATIONS as en } from '@/lib/i18n/translations/en';
import { AR_TRANSLATIONS as ar } from '@/lib/i18n/translations/ar';
import { Autocomplete, Highlight, type AutocompleteOption, type AutocompletePage, type AutocompleteProps } from '../Autocomplete';

const mockLanguage = { t: en, lang: 'en', locale: 'en', isRTL: false, dir: 'ltr' };
jest.mock('@/hooks/useLanguage', () => ({ useLanguage: () => mockLanguage }));

const OPTIONS: AutocompleteOption[] = [
  { id: 'v1', label: 'أحكام الصَّلاة', group: 'video' },
  { id: 'v2', label: 'Seerah part 1', group: 'video' },
  { id: 'c1', label: 'Seerah Studies', group: 'channel', subtitle: '@seerah' },
  { id: 'v3', label: 'Fasting rules', group: 'video', disabled: true },
];

function Harness(props: Partial<AutocompleteProps> & { initial?: string }) {
  const { initial = '', ...rest } = props;
  const [value, setValue] = useState(initial);
  return (
    <Autocomplete
      value={value}
      onValueChange={setValue}
      onSelect={jest.fn()}
      label="Search"
      testId="ac-input"
      options={OPTIONS}
      {...rest}
    />
  );
}

const input = () => screen.getByTestId('ac-input');
const listbox = () => screen.getByRole('listbox', { hidden: true });
const options = () => within(listbox()).queryAllByRole('option');

describe('Autocomplete', () => {
  beforeEach(() => Object.assign(mockLanguage, { t: en, lang: 'en', locale: 'en', isRTL: false, dir: 'ltr' }));

  it('is a combobox wired to its listbox', () => {
    render(<Harness />);
    const box = input();
    expect(box).toHaveAttribute('role', 'combobox');
    expect(box).toHaveAttribute('aria-autocomplete', 'list');
    expect(box).toHaveAttribute('aria-controls', listbox().id);
    expect(box).toHaveAttribute('aria-expanded', 'false');
    expect(box).not.toHaveAttribute('aria-activedescendant');
  });

  it('filters local options with Arabic normalisation and highlights the match', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: 'الصلاه' } });
    expect(input()).toHaveAttribute('aria-expanded', 'true');
    expect(options()).toHaveLength(1);
    expect(within(options()[0]).getByTestId('autocomplete-mark')).toHaveTextContent('الصَّلاة');
  });

  it('groups options under labelled groups in the given order', () => {
    render(<Harness groups={[{ key: 'channel', label: 'Channels' }, { key: 'video', label: 'Videos' }]} />);
    fireEvent.change(input(), { target: { value: 'seerah' } });
    const groups = within(listbox()).getAllByRole('group');
    expect(groups.map((g) => g.getAttribute('aria-labelledby') && document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent))
      .toEqual(['Channels', 'Videos']);
    expect(options().map((o) => o.textContent)).toEqual(['Seerah Studies@seerah', 'Seerah part 1']);
  });

  it('moves with the arrows, skips disabled options, and picks with Enter', () => {
    const onSelect = jest.fn();
    render(<Harness onSelect={onSelect} options={OPTIONS.filter((o) => o.id !== 'v1')} />);
    fireEvent.change(input(), { target: { value: 's' } });
    // Seerah Studies, Seerah part 1 match "s"; Fasting rules matches as a word start but is disabled
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    const first = options()[0];
    expect(input()).toHaveAttribute('aria-activedescendant', first.id);
    expect(first).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input()).not.toHaveAttribute('aria-activedescendant');
    // Up from the input wraps to the last option, skipping the disabled one
    expect(options().map((o) => o.getAttribute('data-option-id'))).toEqual(['v2', 'c1', 'v3']);
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[1].id);
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
    expect(input()).toHaveAttribute('aria-expanded', 'false');
  });

  it('runs onSubmit on Enter when no option is highlighted', () => {
    const onSubmit = jest.fn();
    const onSelect = jest.fn();
    render(<Harness onSubmit={onSubmit} onSelect={onSelect} />);
    fireEvent.change(input(), { target: { value: 'seerah' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('seerah');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes with Escape, then clears the text with a second Escape', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: 'seerah' } });
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(input()).toHaveAttribute('aria-expanded', 'false');
    expect(input()).toHaveValue('seerah');
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(input()).toHaveValue('');
  });

  it('announces how many suggestions there are, in Arabic too', () => {
    const { rerender } = render(<Harness />);
    fireEvent.change(input(), { target: { value: 'seerah' } });
    expect(screen.getByTestId('autocomplete-status')).toHaveTextContent(en.autocomplete.resultsCount.replace('{count}', '2'));
    fireEvent.change(input(), { target: { value: 'zzzz' } });
    expect(screen.getByTestId('autocomplete-status')).toHaveTextContent(en.autocomplete.noResults);
    expect(screen.getByTestId('autocomplete-no-matches')).toHaveTextContent('zzzz');

    Object.assign(mockLanguage, { t: ar, lang: 'ar', locale: 'ar', isRTL: true, dir: 'rtl' });
    rerender(<Harness key="ar" />);
    fireEvent.change(input(), { target: { value: 'احكام' } });
    expect(screen.getByTestId('autocomplete-status')).toHaveTextContent(ar.autocomplete.oneResult);
  });

  it('shows empty-state options (recent searches) and removes one with Delete or its button', () => {
    const onRemove = jest.fn();
    const recent: AutocompleteOption[] = [
      { id: 'r1', label: 'tafsir', removable: true },
      { id: 'r2', label: 'hadith', removable: true },
    ];
    render(<Harness options={[]} emptyOptions={recent} onRemove={onRemove} emptyHeader={<p>Recent</p>} />);
    fireEvent.focus(input());
    expect(options().map((o) => o.textContent)).toEqual(['tafsir', 'hadith']);
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'Delete' });
    expect(onRemove).toHaveBeenCalledWith(recent[0]);
    fireEvent.click(screen.getAllByTestId('autocomplete-remove')[1]);
    expect(onRemove).toHaveBeenCalledWith(recent[1]);
    expect(screen.getAllByTestId('autocomplete-remove')[0]).toHaveAccessibleName(en.autocomplete.removeRecent.replace('{query}', 'tafsir'));
  });

  describe('remote lookups', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('waits for a pause in typing, cancels superseded requests and caches answers', async () => {
      const signals: AbortSignal[] = [];
      const load = jest.fn(async (q: string, signal: AbortSignal) => {
        signals.push(signal);
        return [{ id: `r-${q}`, label: `${q} result` }];
      });
      render(<Harness options={undefined} load={load} debounceMs={200} />);
      fireEvent.change(input(), { target: { value: 's' } });
      fireEvent.change(input(), { target: { value: 'se' } });
      fireEvent.change(input(), { target: { value: 'see' } });
      expect(load).not.toHaveBeenCalled();
      await act(async () => { jest.advanceTimersByTime(200); });
      expect(load).toHaveBeenCalledTimes(1);
      expect(load).toHaveBeenCalledWith('see', expect.any(Object));
      expect(options().map((o) => o.textContent)).toEqual(['see result']);

      fireEvent.change(input(), { target: { value: 'seer' } });
      await act(async () => { jest.advanceTimersByTime(50); });
      fireEvent.change(input(), { target: { value: 'see' } });
      await act(async () => { jest.advanceTimersByTime(300); });
      // "seer" never fired; "see" came from the cache
      expect(load).toHaveBeenCalledTimes(1);
      expect(options().map((o) => o.textContent)).toEqual(['see result']);
    });

    it('does not look up below minChars', async () => {
      const load = jest.fn(async () => []);
      render(<Harness options={undefined} load={load} minChars={2} />);
      fireEvent.change(input(), { target: { value: 'a' } });
      await act(async () => { jest.advanceTimersByTime(500); });
      expect(load).not.toHaveBeenCalled();
    });
  });

  it('keeps an inline list open and marks selected options with aria-checked', () => {
    const onSelect = jest.fn();
    render(<Harness mode="inline" keepOpenOnSelect emptyOptions={OPTIONS} onSelect={onSelect} decorate={(o) => ({ selected: o.id === 'v2' })} />);
    expect(input()).toHaveAttribute('aria-expanded', 'true');
    const selected = options().find((o) => o.getAttribute('data-option-id') === 'v2')!;
    expect(selected).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(options()[0]);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'v1' }));
    expect(input()).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('Autocomplete initial results (pickers open with content)', () => {
  beforeEach(() => Object.assign(mockLanguage, { t: en, lang: 'en', locale: 'en', isRTL: false, dir: 'ltr' }));

  const pageOf = (from: number, count: number, next: string | null): AutocompletePage => ({
    options: Array.from({ length: count }, (_, i) => ({ id: `p${from + i}`, label: `Item ${from + i}` })),
    next,
  });

  it('opens with results: an inline picker shows the first page before anything is typed', async () => {
    let resolve!: (page: AutocompletePage) => void;
    const loadInitial = jest.fn(() => new Promise<AutocompletePage>((r) => { resolve = r; }));
    render(<Harness options={undefined} mode="inline" loadInitial={loadInitial} emptyText="Nothing yet" />);
    // Loading: a skeleton, the list is busy, no empty text yet
    expect(loadInitial).toHaveBeenCalledWith(null, expect.any(Object));
    expect(screen.getByTestId('autocomplete-skeleton')).toBeInTheDocument();
    expect(listbox()).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('autocomplete-empty')).not.toBeInTheDocument();
    await act(async () => { resolve(pageOf(0, 3, null)); });
    expect(screen.queryByTestId('autocomplete-skeleton')).not.toBeInTheDocument();
    expect(options().map((o) => o.textContent)).toEqual(['Item 0', 'Item 1', 'Item 2']);
    expect(input()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('autocomplete-status')).toHaveTextContent('3 suggestions available');
  });

  it('an overlay picker loads its first page when it opens, and typing filters what is loaded', async () => {
    const loadInitial = jest.fn(async () => ({ options: [{ id: 'a', label: 'Seerah Studies' }, { id: 'b', label: 'Fiqh Daily' }], next: null }));
    render(<Harness options={undefined} loadInitial={loadInitial} />);
    expect(loadInitial).not.toHaveBeenCalled();
    await act(async () => { fireEvent.focus(input()); });
    expect(loadInitial).toHaveBeenCalledTimes(1);
    expect(options()).toHaveLength(2);
    fireEvent.change(input(), { target: { value: 'fiq' } });
    expect(options().map((o) => o.textContent)).toEqual(['Fiqh Daily']);
  });

  it('loads the next page when the list is scrolled to its end, and when arrowed onto the last option', async () => {
    const loadInitial = jest.fn(async (cursor: string | null) => (cursor === null ? pageOf(0, 2, 'c2') : cursor === 'c2' ? pageOf(2, 2, 'c4') : pageOf(4, 1, null)));
    render(<Harness options={undefined} mode="inline" loadInitial={loadInitial} />);
    await act(async () => {});
    expect(options()).toHaveLength(2);
    const list = listbox();
    Object.defineProperties(list, { scrollHeight: { value: 400, configurable: true }, clientHeight: { value: 300, configurable: true } });
    list.scrollTop = 80;
    await act(async () => { fireEvent.scroll(list); });
    expect(loadInitial).toHaveBeenLastCalledWith('c2', expect.any(Object));
    expect(options()).toHaveLength(4);
    // Keyboard users reach the next page by arrowing to the end
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    await act(async () => {});
    expect(loadInitial).toHaveBeenLastCalledWith('c4', expect.any(Object));
    expect(options().map((o) => o.textContent)).toEqual(['Item 0', 'Item 1', 'Item 2', 'Item 3', 'Item 4']);
  });

  it('shows the empty state when there is nothing to pick', async () => {
    render(<Harness options={undefined} mode="inline" loadInitial={async () => ({ options: [], next: null })} emptyText="No videos yet" />);
    await act(async () => {});
    expect(screen.getByTestId('autocomplete-empty')).toHaveTextContent('No videos yet');
    expect(options()).toHaveLength(0);
  });

  it('shows an error with a retry that loads the first page again', async () => {
    const loadInitial = jest.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(pageOf(0, 1, null));
    render(<Harness options={undefined} mode="inline" loadInitial={loadInitial} emptyText="Nothing" />);
    await act(async () => {});
    expect(screen.getByTestId('autocomplete-error')).toHaveTextContent(en.autocomplete.loadFailed);
    expect(screen.getByTestId('autocomplete-status')).toHaveTextContent(en.autocomplete.loadFailed);
    expect(screen.queryByTestId('autocomplete-empty')).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByTestId('autocomplete-retry')); });
    expect(loadInitial).toHaveBeenLastCalledWith(null, expect.any(Object));
    expect(options().map((o) => o.textContent)).toEqual(['Item 0']);
  });

  it('marks already added items (decorate) and speaks Arabic', async () => {
    Object.assign(mockLanguage, { t: ar, lang: 'ar', locale: 'ar', isRTL: true, dir: 'rtl' });
    render(<Harness options={undefined} mode="inline" loadInitial={async () => pageOf(0, 2, null)}
      decorate={(o) => ({ selected: o.id === 'p1', disabled: o.id === 'p1' })} />);
    await act(async () => {});
    const added = options().find((o) => o.getAttribute('data-option-id') === 'p1')!;
    expect(added).toHaveAttribute('aria-checked', 'true');
    expect(added).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('autocomplete-status')).toHaveTextContent(ar.autocomplete.resultsCount.replace('{count}', '2'));
  });

  it('starts again from the first page when loadKey changes (another channel)', async () => {
    const loadInitial = jest.fn(async () => pageOf(0, 1, null));
    const { rerender } = render(<Harness options={undefined} mode="inline" loadInitial={loadInitial} loadKey="ch-1" />);
    await act(async () => {});
    rerender(<Harness options={undefined} mode="inline" loadInitial={loadInitial} loadKey="ch-2" />);
    await act(async () => {});
    expect(loadInitial).toHaveBeenCalledTimes(2);
  });
});

describe('Autocomplete popupHost', () => {
  it('renders the popup into the host and still picks with a pointer there', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onSelect = jest.fn();
    render(<Harness popupHost={host} onSelect={onSelect} />);
    fireEvent.change(input(), { target: { value: 'seerah' } });
    const option = within(host).getAllByRole('option')[0];
    fireEvent.pointerDown(option);
    fireEvent.click(option);
    // The channel's @seerah handle is an exact match, so it ranks first
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
    expect(input()).toHaveAttribute('aria-controls', within(host).getByRole('listbox', { hidden: true }).id);
    host.remove();
  });
});

describe('Highlight', () => {
  it('marks the matched words of the original text', () => {
    const { container } = render(<Highlight text="École normale" query="ecole" />);
    expect(container.querySelector('mark')).toHaveTextContent('École');
  });
});
