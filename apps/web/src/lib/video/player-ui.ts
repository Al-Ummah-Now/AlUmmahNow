/**
 * Page-level player features (docs/specs/VIDEO-PLAYER.md section 5).
 *
 * The watch page owns the theatre layout, the mini player and the next video; the player's
 * controls only show them. This store connects the two without threading props through every
 * player wrapper. Surfaces that never opt in (embeds, previews) keep all three off.
 */
export interface UpNext {
  title: string;
  channel: string;
  thumbnail?: string;
  /** Navigates to the next video */
  go: () => void;
}

export interface PlayerUiState {
  /** The page lays out a theatre view (watch page only) */
  theatreAvailable: boolean;
  theatre: boolean;
  /** The page floats the player while it plays off screen (watch page only) */
  miniPlayerAvailable: boolean;
  upNext: UpNext | null;
  /** Opens the page's report flow from the player's error panel */
  reportProblem: (() => void) | null;
  /** Chapter starts and titles (in the page language), for the progress bar's hover tooltip */
  chapters: ChapterTip[];
}

export interface ChapterTip {
  startTime: number;
  title: string;
}

export const THEATRE_STORAGE_KEY = 'aun.player.theatre';

type Listener = () => void;
const listeners = new Set<Listener>();
let state: PlayerUiState = { theatreAvailable: false, theatre: false, miniPlayerAvailable: false, upNext: null, reportProblem: null, chapters: [] };

/** The viewer's remembered theatre choice. Storage can be missing or throw (private mode). */
export function readTheatrePreference(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): boolean {
  try {
    return storage?.getItem(THEATRE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeTheatrePreference(on: boolean, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(THEATRE_STORAGE_KEY, on ? '1' : '0');
  } catch {
    // A blocked storage only loses the preference for the next visit.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function getPlayerUi(): PlayerUiState {
  return state;
}

export function subscribePlayerUi(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updatePlayerUi(patch: Partial<PlayerUiState>): void {
  const next = { ...state, ...patch };
  if (Object.keys(next).every((k) => next[k as keyof PlayerUiState] === state[k as keyof PlayerUiState])) return;
  state = next;
  listeners.forEach((l) => l());
}

export function setTheatre(on: boolean): void {
  if (!state.theatreAvailable) return;
  writeTheatrePreference(on);
  updatePlayerUi({ theatre: on });
}

/** The watch page turns its features on while mounted. Returns the cleanup. */
export function enableWatchPageFeatures(): () => void {
  updatePlayerUi({ theatreAvailable: true, miniPlayerAvailable: true, theatre: readTheatrePreference() });
  return () => updatePlayerUi({ theatreAvailable: false, miniPlayerAvailable: false, theatre: false, upNext: null, reportProblem: null });
}

/** Test helper: back to the initial state. */
export function resetPlayerUi(): void {
  state = { theatreAvailable: false, theatre: false, miniPlayerAvailable: false, upNext: null, reportProblem: null, chapters: [] };
  listeners.forEach((l) => l());
}
