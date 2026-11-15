/**
 * The Move from YouTube wizard's logic (wiki AUN-YT-IMPORT): where it opens,
 * the selection and matches payloads, review groups and progress counts, and
 * the uploader's initiate call.
 */
import type { TakeoutFile, YtFileMatch, YtImport, YtImportPlaylist } from '@al-ummah/shared-types';
import { item } from './fixtures';
import {
  computeMatches,
  connectErrorKey,
  finishErrorKey,
  importErrorKey,
  itemErrorKey,
  filterItems,
  formatDuration,
  freeFiles,
  importItems,
  initialStep,
  isSettled,
  matchesPayload,
  playlistItemIds,
  progressCounts,
  reviewGroup,
  rowPhase,
  selectionPayload,
  type LiveState,
} from '../wizard';


const imp = (status: YtImport['status']): YtImport => ({
  id: 'imp1', channelId: 'c1', userId: 'u1', status, ytChannel: null, captions: false, visibilityMode: 'keep', connected: true, error: null,
  counts: { videos: 0, selected: 0, matched: 0, uploading: 0, processing: 0, ready: 0, failed: 0, playlists: 0 },
  createdAt: '', updatedAt: '', finishedAt: null,
});

const file = (fileName: string, zipName = 'takeout-001.zip'): TakeoutFile => ({
  key: zipName ? `${zipName}/Takeout/videos/${fileName}` : fileName,
  zipName,
  entryName: zipName ? `Takeout/videos/${fileName}` : fileName,
  fileName,
  size: 1000,
});

describe('where the wizard opens', () => {
  it.each([
    [null, 'connect'],
    ['listing', 'connect'],
    ['ready', 'pick'],
    ['importing', 'import'],
    ['finished', 'import'],
    ['cancelled', 'connect'],
    ['failed', 'connect'],
  ] as const)('%s → %s', (status, step) => {
    expect(initialStep(status ? imp(status) : null)).toBe(step);
  });

  it('reads ?error= codes, unknown ones as "failed"', () => {
    expect(connectErrorKey(null)).toBeNull();
    expect(connectErrorKey('youtube_denied')).toBe('youtube_denied');
    expect(connectErrorKey('youtube_no_channel')).toBe('youtube_no_channel');
    expect(connectErrorKey('youtube_import_off')).toBe('youtube_import_off');
    expect(connectErrorKey('<script>')).toBe('failed');
  });

  it("maps the server's reasons to their copy, unknown ones to the generic message", () => {
    expect(itemErrorKey('video_removed')).toBe('video_removed');
    expect(itemErrorKey('upload_failed')).toBe('upload_failed');
    expect(itemErrorKey('weird')).toBe('generic');
    expect(itemErrorKey(null)).toBe('generic');
    expect(importErrorKey('youtube_not_connected')).toBe('import_disconnected');
    expect(importErrorKey('listing_failed')).toBe('import_failed');
    expect(importErrorKey(null)).toBe('import_failed');
  });

  it('reads oauth/finish refusals: 403 another account, other 4xx expired, the rest a failure', () => {
    expect(finishErrorKey(403)).toBe('connect_other_account');
    expect(finishErrorKey(400)).toBe('connect_expired');
    expect(finishErrorKey(404)).toBe('connect_expired');
    expect(finishErrorKey(410)).toBe('connect_expired');
    expect(finishErrorKey(401)).toBeNull();
    expect(finishErrorKey(500)).toBeNull();
    expect(finishErrorKey(undefined)).toBeNull();
  });
});

describe('choosing videos', () => {
  const items = [item('a'), item('b', { state: 'imported' }), item('c', { title: 'محاضرة الفجر' }), item('d')];
  const playlists: YtImportPlaylist[] = [
    { ytPlaylistId: 'PL1', title: 'Series', description: '', ytVisibility: 'public', ytVideoIds: [items[3]!.ytVideoId, items[1]!.ytVideoId, 'NOTINIMPORT', items[0]!.ytVideoId], selected: false, playlistId: null, state: 'none' },
    { ytPlaylistId: 'PL2', title: 'Other', description: '', ytVisibility: 'private', ytVideoIds: [], selected: false, playlistId: null, state: 'none' },
  ];

  it('sends the full selected sets in YouTube order, never an imported video', () => {
    expect(selectionPayload(items, new Set(['d', 'b', 'a']), new Set(['PL2', 'PL1', 'gone']), playlists, 'private')).toEqual({
      itemIds: ['a', 'd'],
      playlistIds: ['PL1', 'PL2'],
      visibilityMode: 'private',
    });
  });

  it("selects a playlist's videos in its order, skipping imported and unknown ones", () => {
    expect(playlistItemIds(playlists[0]!, items)).toEqual(['d', 'a']);
  });

  it('searches titles ignoring accents and case, or by YouTube id', () => {
    expect(filterItems(items, 'مُحاضَرة').map((i) => i.id)).toEqual(['c']);
    expect(filterItems(items, 'VIDEO A').map((i) => i.id)).toEqual(['a']);
    expect(filterItems(items, items[3]!.ytVideoId).map((i) => i.id)).toEqual(['d']);
    expect(filterItems(items, '  ')).toHaveLength(4);
  });
});

describe('matching files', () => {
  const selected = [
    item('a', { ytVideoId: 'AAAAAAAAAAA', title: 'Opening talk', selected: true }),
    item('b', { ytVideoId: 'BBBBBBBBBBB', title: 'Q&A: Part 2?', selected: true }),
    item('c', { ytVideoId: 'CCCCCCCCCCC', title: 'No file', selected: true }),
  ];
  const files = [file('Opening talk [AAAAAAAAAAA].mp4'), file('QA Part 2.mp4'), file('Extra.mp4', '')];

  it('matches by id then title, and builds one PUT entry per selected video', () => {
    const m = computeMatches(selected, files, []);
    expect(m.get('a')).toEqual({ zipName: 'takeout-001.zip', entryName: 'Takeout/videos/Opening talk [AAAAAAAAAAA].mp4', fileName: 'Opening talk [AAAAAAAAAAA].mp4', size: 1000, by: 'id' });
    expect(m.get('b')?.by).toBe('title');
    expect(m.get('c')).toBeNull();
    expect(matchesPayload(selected, m)).toEqual([
      { itemId: 'a', match: m.get('a') },
      { itemId: 'b', match: m.get('b') },
      { itemId: 'c', match: null },
    ]);
    expect(['byId', 'byTitle', 'noFile'].map((g, i) => reviewGroup(m.get(selected[i]!.id)) === g)).toEqual([true, true, true]);
  });

  it("keeps the creator's own choices and left-out videos while their files are picked", () => {
    const manual: YtFileMatch = { zipName: '', entryName: 'Extra.mp4', fileName: 'Extra.mp4', size: 1000, by: 'manual' };
    const kept = new Map<string, YtFileMatch | null>([['c', manual], ['b', null]]);
    const m = computeMatches(selected, files, [], kept);
    expect(m.get('c')).toEqual(manual);
    expect(m.get('b')).toBeNull();
    expect(reviewGroup(m.get('c'))).toBe('manual');
    // The manual file is gone: matched again (nothing fits, so no file)
    const without = computeMatches(selected, files.slice(0, 2), [], new Map([['c', manual]]));
    expect(without.get('c')).toBeNull();
  });

  it('offers only files no other video uses', () => {
    const m = computeMatches(selected, files, []);
    expect(freeFiles(files, m, 'c').map((f) => f.fileName)).toEqual(['Extra.mp4']);
    expect(freeFiles(files, m, 'a').map((f) => f.fileName)).toEqual(['Opening talk [AAAAAAAAAAA].mp4', 'Extra.mp4']);
  });
});

describe('progress', () => {
  const match: YtFileMatch = { zipName: 'z.zip', entryName: 'v.mp4', fileName: 'v.mp4', size: 1, by: 'id' };
  const items = [
    item('ready', { selected: true, match, state: 'ready', videoId: 'v1' }),
    item('proc', { selected: true, match, state: 'processing', videoId: 'v2' }),
    item('up', { selected: true, match, state: 'uploading', videoId: 'v3' }),
    item('fail', { selected: true, match, state: 'failed', videoId: 'v4' }),
    item('wait', { selected: true, match, state: 'selected' }),
    item('nofile', { selected: true, match: null, state: 'selected' }),
    item('notpicked', { state: 'available' }),
  ];

  it('follows the selected videos that have a file', () => {
    expect(importItems(items).map((i) => i.id)).toEqual(['ready', 'proc', 'up', 'fail', 'wait']);
  });

  it("overlays the page's own upload on the server's state", () => {
    const live = new Map<string, LiveState>([['up', { phase: 'uploading', percent: 42 }], ['fail', { phase: 'preparing' }]]);
    expect(rowPhase(items[0]!, undefined)).toBe('ready');
    expect(rowPhase(items[1]!, live.get('proc'))).toBe('processing');
    expect(rowPhase(items[2]!, live.get('up'))).toBe('uploading');
    // Try again: the server still says failed until its next poll
    expect(rowPhase(items[3]!, live.get('fail'))).toBe('preparing');
    expect(rowPhase(items[3]!, undefined)).toBe('failed');
    expect(rowPhase(items[4]!, undefined)).toBe('waiting');
    expect(rowPhase(items[5]!, undefined)).toBe('needsFile');
    expect(progressCounts(importItems(items), live)).toEqual({ ready: 1, active: 3, failed: 0, waiting: 1, total: 5 });
    expect(isSettled(importItems(items), live)).toBe(false);
    expect(isSettled([items[0]!, items[3]!], new Map())).toBe(true);
  });

  it('formats lengths', () => {
    expect(formatDuration(61)).toBe('1:01');
    expect(formatDuration(3723)).toBe('1:02:03');
    expect(formatDuration(null)).toBe('');
  });
});
