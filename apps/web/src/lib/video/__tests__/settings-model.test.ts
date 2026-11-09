import {
  AUTO,
  OFF,
  audioOptions,
  captionOptions,
  currentAudioId,
  currentCaptionId,
  currentQualityId,
  menuKeyAction,
  moveIndex,
  qualityOptions,
  qualityValue,
  rootRows,
  selectAudio,
  selectCaption,
  selectQuality,
  speedLabel,
  speedOptions,
} from '../settings-model';

const levels = () => [
  { height: 360, enabled: true },
  { height: 720, enabled: true },
  { height: 720, enabled: true },
  { height: 1080, enabled: true },
];

describe('quality (production behaviour)', () => {
  it('lists Auto then each distinct height, highest first', () => {
    expect(qualityOptions(levels(), 'Auto')).toEqual([
      { id: AUTO, label: 'Auto' },
      { id: '1080', label: '1080p' },
      { id: '720', label: '720p' },
      { id: '360', label: '360p' },
    ]);
  });

  it('offers no quality row without renditions (Safari native HLS)', () => {
    expect(qualityOptions([], 'Auto')).toEqual([]);
    expect(qualityOptions(undefined, 'Auto')).toEqual([]);
    expect(qualityOptions([{ enabled: true }], 'Auto')).toEqual([]);
  });

  it('enables only the chosen height, and every rendition for Auto', () => {
    const l = levels();
    selectQuality(l, '720');
    expect(l.map((x) => x.enabled)).toEqual([false, true, true, false]);
    expect(currentQualityId(l)).toBe('720');
    selectQuality(l, AUTO);
    expect(l.every((x) => x.enabled)).toBe(true);
    expect(currentQualityId(l)).toBe(AUTO);
  });

  it('shows what Auto is playing', () => {
    expect(qualityValue(AUTO, 720, 'Auto')).toBe('Auto (720p)');
    expect(qualityValue(AUTO, undefined, 'Auto')).toBe('Auto');
    expect(qualityValue('1080', 720, 'Auto')).toBe('1080p');
  });
});

describe('speed', () => {
  it('names 1× Normal and the rest with a times sign', () => {
    expect(speedLabel(1, 'Normal')).toBe('Normal');
    expect(speedLabel(1.5, 'Normal')).toBe('1.5×');
    expect(speedOptions([0.5, 1, 2], 'Normal').map((o) => o.label)).toEqual(['0.5×', 'Normal', '2×']);
  });
});

describe('captions', () => {
  const tracks = () => [
    { kind: 'metadata', label: 'thumbs', mode: 'hidden' },
    { kind: 'subtitles', label: 'English', language: 'en', mode: 'disabled' },
    { kind: 'captions', language: 'ar', mode: 'disabled' },
    { kind: 'chapters', label: 'Chapters', mode: 'hidden' },
  ];

  it('lists Off then subtitle and caption tracks only', () => {
    expect(captionOptions(tracks(), 'Off')).toEqual([
      { id: OFF, label: 'Off' },
      { id: '0', label: 'English' },
      { id: '1', label: 'ar' },
    ]);
    expect(captionOptions([{ kind: 'metadata', mode: 'hidden' }], 'Off')).toEqual([]);
  });

  it('shows one track at a time and leaves metadata and chapters alone', () => {
    const t = tracks();
    selectCaption(t, '1');
    expect(t.map((x) => x.mode)).toEqual(['hidden', 'disabled', 'showing', 'hidden']);
    expect(currentCaptionId(t)).toBe('1');
    selectCaption(t, OFF);
    expect(currentCaptionId(t)).toBe(OFF);
    expect(t[0].mode).toBe('hidden');
  });
});

describe('audio tracks', () => {
  it('offers a choice only when there are two or more', () => {
    expect(audioOptions([{ label: 'Main', enabled: true }])).toEqual([]);
    const t = [{ label: 'Arabic', enabled: true }, { language: 'en', enabled: false }];
    expect(audioOptions(t)).toEqual([{ id: '0', label: 'Arabic' }, { id: '1', label: 'en' }]);
    selectAudio(t, '1');
    expect(t.map((x) => x.enabled)).toEqual([false, true]);
    expect(currentAudioId(t)).toBe('1');
  });
});

describe('root rows', () => {
  const labels = { quality: 'Quality', speed: 'Speed', captions: 'Subtitles', audio: 'Audio', shortcuts: 'Shortcuts' };

  it('keeps the spec order and leaves out rows with nothing to choose', () => {
    expect(rootRows({ labels, quality: 'Auto', speed: 'Normal', captions: 'Off', audio: 'Arabic' }).map((r) => r.id))
      .toEqual(['quality', 'speed', 'captions', 'audio', 'shortcuts']);
    // A live stream with one audio track and no renditions: no speed, quality or audio
    expect(rootRows({ labels, captions: 'Off' }).map((r) => r.id)).toEqual(['captions', 'shortcuts']);
  });
});

describe('menu keys', () => {
  it('opens with the end-side arrow and goes back with the start-side arrow', () => {
    expect(menuKeyAction('ArrowRight', 'ltr', false)).toBe('open');
    expect(menuKeyAction('ArrowLeft', 'ltr', true)).toBe('back');
    // Mirrored in Arabic
    expect(menuKeyAction('ArrowLeft', 'rtl', false)).toBe('open');
    expect(menuKeyAction('ArrowRight', 'rtl', true)).toBe('back');
    expect(menuKeyAction('ArrowRight', 'rtl', false)).toBeNull();
  });

  it('goes back with Escape in a submenu and closes from the root', () => {
    expect(menuKeyAction('Escape', 'ltr', true)).toBe('back');
    expect(menuKeyAction('Escape', 'ltr', false)).toBe('close');
    expect(menuKeyAction('Backspace', 'ltr', true)).toBe('back');
    expect(menuKeyAction('Tab', 'ltr', true)).toBe('close');
  });

  it('moves and activates', () => {
    expect(menuKeyAction('ArrowDown', 'rtl', false)).toBe('next');
    expect(menuKeyAction('ArrowUp', 'ltr', true)).toBe('prev');
    expect(menuKeyAction('Home', 'ltr', true)).toBe('first');
    expect(menuKeyAction('End', 'ltr', true)).toBe('last');
    expect(menuKeyAction('Enter', 'ltr', true)).toBe('activate');
    expect(menuKeyAction(' ', 'ltr', true)).toBe('activate');
    expect(menuKeyAction('k', 'ltr', true)).toBeNull();
  });

  it('wraps roving focus', () => {
    expect(moveIndex(2, 3, 'next')).toBe(0);
    expect(moveIndex(0, 3, 'prev')).toBe(2);
    expect(moveIndex(1, 3, 'first')).toBe(0);
    expect(moveIndex(1, 3, 'last')).toBe(2);
    expect(moveIndex(0, 0, 'next')).toBe(-1);
  });
});
