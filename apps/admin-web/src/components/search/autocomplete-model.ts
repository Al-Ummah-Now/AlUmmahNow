/**
 * The admin autocomplete's behaviour, kept apart from React so every key and
 * every choice can be tested without a browser (test/autocomplete.test.ts).
 *
 * The keyboard follows the WAI-ARIA 1.2 combobox pattern with a listbox popup
 * and list autocomplete with manual selection: focus stays in the input, the
 * active option is pointed at with aria-activedescendant, and nothing is chosen
 * until Enter or a click.
 */
import type { AdminSuggestion, AdminSuggestKind } from '@al-ummah/shared-types';

/**
 * search: a free-text search box. Enter runs the full-text filter; choosing a
 *   suggestion opens that item.
 * pick: a field whose value is an id (a filter or an action's target). The admin
 *   types a name and chooses; the id goes in a hidden field.
 */
export type AutocompleteMode = 'search' | 'pick';

/**
 * A suggestion as the box shows it. A box with its own search source (the channel
 * transfer) adds a line of facts under the name and can list items that cannot be
 * chosen (banned users: shown, so the admin knows why, but skipped by the keys).
 */
export interface AutocompleteItem extends AdminSuggestion {
  /** A line under the name ("Owns 2 channels · Channel editor here") */
  meta?: string | null;
  /** Listed but cannot be chosen */
  disabled?: boolean;
}

/** What a box lists: the suggest API's kinds, and features (from the registry, always with an own source). */
export type AutocompleteKind = AdminSuggestKind | 'feature';
/** An own source's item: also a feature. */
export type SourceItem = Omit<AutocompleteItem, 'kind'> & { kind: AutocompleteKind };

/** Options of a box that change its rules. allowIds: offer "Use this ID" for a pasted id (default yes). */
export interface AutocompleteRules {
  allowIds?: boolean;
}

export type AutocompleteOption =
  | { type: 'suggestion'; suggestion: AutocompleteItem }
  /** pick mode: the typed text looks like an id and no suggestion has it exactly */
  | { type: 'useId'; id: string }
  /** search mode: run the full-text filter for the typed text (what Enter does) */
  | { type: 'searchAll'; query: string };

export type AutocompleteStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Initial results (pick mode; owner rule 2026-11-11: pickers open with
 * content): the newest items of the kind, shown when the box opens before
 * anything is typed, paged on scroll. One typed character filters what is
 * loaded; from MIN_QUERY the server is asked as before.
 */
export interface InitialList {
  items: AutocompleteItem[];
  /** Cursor of the next page; null after the last */
  next: string | null;
  status: 'loading' | 'more' | 'ready' | 'error';
}

export interface AutocompleteState {
  query: string;
  open: boolean;
  /** Index into options; -1 when no option is active */
  active: number;
  options: AutocompleteOption[];
  status: AutocompleteStatus;
}

/** Characters before suggestions are asked for: one letter matches too much to be useful. */
export const MIN_QUERY = 2;
/** Wait after the last keystroke before asking, so typing a word sends one request. */
export const DEBOUNCE_MS = 200;

export const initialState = (query = ''): AutocompleteState => ({ query, open: false, active: -1, options: [], status: 'idle' });

/**
 * Ids in this platform are opaque tokens (usr_…, ch_…, UUIDs, nanoids): one
 * word of letters, digits, `_` and `-`, at least 6 long, with a digit or a
 * separator so ordinary words are not taken for ids.
 */
export function looksLikeId(text: string): boolean {
  const value = text.trim();
  return /^[A-Za-z0-9_-]{6,200}$/.test(value) && /[0-9_-]/.test(value);
}

/** The options shown for a query: the suggestions, then the fallback for the mode. */
export function optionsFor(mode: AutocompleteMode, query: string, suggestions: AutocompleteItem[], rules: AutocompleteRules = {}): AutocompleteOption[] {
  const options: AutocompleteOption[] = suggestions.map((suggestion) => ({ type: 'suggestion', suggestion }));
  const q = query.trim();
  if (!q) return options;
  if (mode === 'search') options.push({ type: 'searchAll', query: q });
  else if (rules.allowIds !== false && looksLikeId(q) && !suggestions.some((s) => s.id === q)) options.push({ type: 'useId', id: q });
  return options;
}

/** Whether an option can be chosen (a disabled suggestion is only shown). */
export const selectable = (option: AutocompleteOption | undefined): boolean => !!option && !(option.type === 'suggestion' && option.suggestion.disabled);

/** The next option that can be chosen from `from` in direction `by`, wrapping; -1 when none can. From -1, Down starts at the first and Up at the last. */
export function step(options: AutocompleteOption[], from: number, by: 1 | -1): number {
  const n = options.length;
  let i = from;
  for (let k = 0; k < n; k++) {
    i = i < 0 ? (by === 1 ? 0 : n - 1) : (i + by + n) % n;
    if (selectable(options[i])) return i;
  }
  return -1;
}

/**
 * The box's state in one word, for tests and the status line: idle (nothing typed), short (one
 * character, which only filters the opening list), loading, done (an answer is shown) or error.
 */
export type AutocompletePhase = 'idle' | 'short' | 'loading' | 'done' | 'error';

export function phaseOf(state: AutocompleteState): AutocompletePhase {
  const q = state.query.trim();
  if (q.length > 0 && q.length < MIN_QUERY) return 'short';
  if (state.status === 'loading') return 'loading';
  if (state.status === 'error') return 'error';
  if (state.status === 'ready') return 'done';
  return 'idle';
}

/** Where choosing a suggestion in a search box goes. Kinds without a page of their own open their list filtered to them. */
export function hrefFor(s: Pick<AdminSuggestion, 'kind' | 'id' | 'parentId'>): string {
  const id = encodeURIComponent(s.id);
  switch (s.kind) {
    case 'channel':
      return `/channels/${id}`;
    case 'user':
      return `/users/${id}`;
    case 'video':
      return `/videos/${id}`;
    case 'contact':
      return `/contact/${id}`;
    case 'error':
      return `/errors/${id}`;
    case 'invite':
      return `/users/invites?q=${id}`;
    case 'playlist':
      return `/playlists?q=${id}`;
    case 'post':
      return `/community?q=${id}`;
    case 'comment':
      return s.parentId ? `/comments?videoId=${encodeURIComponent(s.parentId)}` : `/comments`;
    case 'report': {
      // The id is the reported item's group key `${type}:${id}`: the queue filtered to that item
      const at = s.id.indexOf(':');
      return `/moderation?entity_type=${encodeURIComponent(s.id.slice(0, at))}&entity_id=${encodeURIComponent(s.id.slice(at + 1))}`;
    }
  }
}

export const suggestUrl = (kind: AutocompleteKind, query: string): string => `/api/suggest/${kind}?q=${encodeURIComponent(query.trim())}`;
/** A picker's page before anything is typed (null cursor: the first). */
export const initialUrl = (kind: AutocompleteKind, cursor: string | null): string =>
  `/api/suggest/${kind}?q=${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
export const resolveUrl = (kind: AutocompleteKind, id: string): string => `/api/suggest/${kind}/${encodeURIComponent(id)}`;

// ---------------------------------------------------------------------------
// State changes
// ---------------------------------------------------------------------------

/** The admin typed: the list opens and waits for suggestions (or closes when too short; with initial results it shows them). */
export function typed(state: AutocompleteState, query: string, initial?: InitialList | null): AutocompleteState {
  const asks = query.trim().length >= MIN_QUERY;
  if (!asks && initial !== undefined) return showInitial({ ...state, query, open: true, active: -1 }, initial);
  return {
    query,
    open: asks,
    active: -1,
    // Suggestions for a shorter query stay while the next answer comes; the initial list does not (it isn't a match)
    options: asks && state.query.trim().length >= MIN_QUERY ? state.options : [],
    status: asks ? 'loading' : 'idle',
  };
}

/** Suggestions arrived. Answers for an older query are dropped. */
export function received(state: AutocompleteState, mode: AutocompleteMode, query: string, suggestions: AutocompleteItem[], rules: AutocompleteRules = {}): AutocompleteState {
  if (query.trim() !== state.query.trim()) return state;
  return { ...state, options: optionsFor(mode, query, suggestions, rules), status: 'ready', active: -1 };
}

/** The request failed: the fallback option still works (Enter searches, a pasted id can be used). */
export function failed(state: AutocompleteState, mode: AutocompleteMode, query: string, rules: AutocompleteRules = {}): AutocompleteState {
  if (query.trim() !== state.query.trim()) return state;
  return { ...state, options: optionsFor(mode, query, [], rules), status: 'error', active: -1 };
}

/**
 * The box got focus or a click (pickers with initial results). Nothing real typed: the initial list.
 * A real query typed: open while its answer is on the way, too. Focus can land after the typing (a
 * test's fill, a hydration replay); closing then left the answer's options hidden, since an
 * answer never reopens the list (TRANSFER-02 flake, #1399).
 */
export function reopened(state: AutocompleteState, initial: InitialList | null): AutocompleteState {
  if (state.query.trim().length < MIN_QUERY) return showInitial({ ...state, open: true }, initial);
  return { ...state, open: state.options.length > 0 || state.status === 'loading' };
}

export const closed = (state: AutocompleteState): AutocompleteState => ({ ...state, open: false, active: -1 });

const fold = (text: string | null | undefined) => (text ?? '').toLocaleLowerCase();

/**
 * The initial list as the options (while fewer than MIN_QUERY characters are
 * typed): all of it for an empty box, the items containing the character
 * otherwise. Kept as is once a real query is typed (its answer wins).
 */
export function showInitial(state: AutocompleteState, initial: InitialList | null): AutocompleteState {
  const q = fold(state.query.trim());
  if (q.length >= MIN_QUERY) return state;
  const items = initial?.items ?? [];
  const shown = q ? items.filter((s) => fold(s.label).includes(q) || fold(s.secondary).includes(q) || fold(s.id).includes(q)) : items;
  const status: AutocompleteStatus = !initial || initial.status === 'loading' ? 'loading' : initial.status === 'error' && items.length === 0 ? 'error' : 'ready';
  const options: AutocompleteOption[] = shown.map((suggestion) => ({ type: 'suggestion', suggestion }));
  return { ...state, options, status, active: state.active < options.length ? state.active : -1 };
}

/** A page of the initial list arrived (the first replaces, later ones append; duplicates dropped). */
export function addPage(initial: InitialList | null, page: { items: AutocompleteItem[]; next: string | null }, append: boolean): InitialList {
  const base = append && initial ? initial.items : [];
  const seen = new Set(base.map((s) => s.id));
  return { items: [...base, ...page.items.filter((s) => !seen.has(s.id))], next: page.next, status: 'ready' };
}

export type KeyEffect =
  | { type: 'none' }
  | { type: 'choose'; option: AutocompleteOption }
  /** Let the key do what it does in a form (Enter submits) */
  | { type: 'default' }
  | { type: 'clear' };

export interface KeyResult {
  state: AutocompleteState;
  effect: KeyEffect;
  /** Whether the browser's own handling of the key must be stopped */
  preventDefault: boolean;
}

const NONE: KeyEffect = { type: 'none' };

/** One key press in the input. */
export function keyDown(state: AutocompleteState, mode: AutocompleteMode, key: string, alt = false, rules: AutocompleteRules = {}): KeyResult {
  switch (key) {
    // Arrows move over the options that can be chosen (disabled ones are skipped), wrapping
    case 'ArrowDown': {
      if (alt) return { state: { ...state, open: state.options.length > 0 || state.status === 'loading' }, effect: NONE, preventDefault: true };
      if (state.options.length === 0) return { state, effect: NONE, preventDefault: true };
      if (!state.open) return { state: { ...state, open: true, active: step(state.options, -1, 1) }, effect: NONE, preventDefault: true };
      return { state: { ...state, active: step(state.options, state.active, 1) }, effect: NONE, preventDefault: true };
    }
    case 'ArrowUp': {
      if (alt) return { state: closed(state), effect: NONE, preventDefault: true };
      if (state.options.length === 0) return { state, effect: NONE, preventDefault: true };
      if (!state.open) return { state: { ...state, open: true, active: step(state.options, -1, -1) }, effect: NONE, preventDefault: true };
      return { state: { ...state, active: step(state.options, state.active, -1) }, effect: NONE, preventDefault: true };
    }
    case 'Enter': {
      if (state.open && state.active >= 0 && state.options[state.active]) {
        if (!selectable(state.options[state.active])) return { state, effect: NONE, preventDefault: true };
        return { state: closed(state), effect: { type: 'choose', option: state.options[state.active] }, preventDefault: true };
      }
      if (mode === 'search') return { state: closed(state), effect: { type: 'default' }, preventDefault: false };
      // pick: an empty box applies the rest of the form; typed text takes the top match that can be chosen (or the pasted id)
      if (!state.query.trim()) return { state: closed(state), effect: { type: 'default' }, preventDefault: false };
      const first = state.options.find((o) => o.type !== 'searchAll' && selectable(o));
      if (first) return { state: closed(state), effect: { type: 'choose', option: first }, preventDefault: true };
      if (rules.allowIds !== false && looksLikeId(state.query)) return { state: closed(state), effect: { type: 'choose', option: { type: 'useId', id: state.query.trim() } }, preventDefault: true };
      return { state, effect: NONE, preventDefault: true };
    }
    case 'Escape': {
      if (state.open) return { state: closed(state), effect: NONE, preventDefault: true };
      if (state.query) return { state: initialState(), effect: { type: 'clear' }, preventDefault: true };
      return { state, effect: NONE, preventDefault: false };
    }
    case 'Tab':
      return { state: closed(state), effect: NONE, preventDefault: false };
    default:
      return { state, effect: NONE, preventDefault: false };
  }
}

/**
 * An avatar's letter: the first letter grapheme of the name, skipping spaces, marks, emoji and
 * punctuation ("  ✨Sara" → "S"). An Arabic letter alone takes its isolated form, where some
 * (ه) look like a dot, so it is followed by a zero-width joiner to show its initial form (هـ).
 */
export function avatarInitial(label: string): string {
  const text = label.normalize('NFC');
  const graphemes =
    typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
      ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.segment)
      : Array.from(text);
  const first = graphemes.find((g) => /^\p{L}/u.test(g));
  if (!first) return '?';
  const letter = first.replace(/\p{M}/gu, '');
  return /\p{Script=Arabic}/u.test(letter) ? `${letter}‍` : letter.toLocaleUpperCase();
}

/** Whether an avatar letter is Arabic: drawn in the Arabic font a size up (the Latin font's fallback draws it small). */
export const isArabicInitial = (initial: string): boolean => /\p{Script=Arabic}/u.test(initial);

/** The avatar letter's font for an Arabic initial on any page (the page's own font may be Latin only). */
export const ARABIC_INITIAL_STYLE = { fontFamily: 'var(--fanous-font-arabic), system-ui, sans-serif' } as const;
