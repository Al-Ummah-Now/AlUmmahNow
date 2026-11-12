/**
 * Both watch-page players (LTR and the Arabic RTL one) play what the admin delivery switch chose
 * (epic #687). 2026-11-12: the RTL player kept playing Bunny's playUrl with the switch on R2.
 */
import React from 'react';
import { render } from '@testing-library/react';
import type { PlayerOptions } from '../interface';

const seen: { sources: { src: string }[]; poster?: string }[] = [];
jest.mock('@/components/VideoPagePlayer/VideoPlayerWithChapters', () => ({
  VideoPlayerWithChapters: (props: { sources: { src: string }[]; poster?: string }) => {
    seen.push({ sources: props.sources, poster: props.poster });
    return null;
  },
}));
jest.mock('@/components/VideoPagePlayer/VideoDetails', () => ({ VideoDetails: () => null }));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS, lang: 'ar', locale: 'ar', dir: 'rtl', isRTL: true }),
}));

import VideoPlayer from '../index';
import VideoPlayerRTL from '../rtl/index';

const BUNNY = 'https://vz-215a1ffd-a5a.b-cdn.net/bcdn_token=t&expires=1&token_path=%2Fv%2F/v/playlist.m3u8';
const R2 = 'https://media.alummahnow.net/pub/37bcecd3-2449-4c8d-b4f8-f7af7367d95c/e29db4ad6918a943/master.m3u8';
const R2_THUMB = 'https://media.alummahnow.net/pub/37bcecd3-2449-4c8d-b4f8-f7af7367d95c/e29db4ad6918a943/thumb.jpg';

function options(delivery?: PlayerOptions['delivery']): PlayerOptions {
  return {
    id: '37bcecd3-2449-4c8d-b4f8-f7af7367d95c', title: 'وقفة', channel: 'c', channelName: 'c', channelAvatar: '', description: '', views: '0',
    url: '', playUrl: BUNNY, autoplay: false, type: 'video/mp4', dateCreated: new Date(0), delivery,
  } as PlayerOptions;
}

describe.each([
  ['LTR player', VideoPlayer],
  ['RTL (Arabic) player', VideoPlayerRTL],
])('%s', (_name, Player) => {
  beforeEach(() => { seen.length = 0; });

  it('plays R2 when the switch chose R2, with the R2 poster', () => {
    render(<Player options={options({ source: 'r2', r2Percent: 10, r2: { playUrl: R2, thumbnailUrl: R2_THUMB } })} />);
    expect(seen.at(-1)?.sources[0]?.src).toBe(R2);
    expect(seen.at(-1)?.poster).toBe(R2_THUMB);
  });

  it('plays Bunny when the switch chose Bunny, or R2 is not ready', () => {
    render(<Player options={options({ source: 'bunny', r2Percent: 10, r2: { playUrl: R2, thumbnailUrl: R2_THUMB } })} />);
    expect(seen.at(-1)?.sources[0]?.src).toBe(BUNNY);
    render(<Player options={options({ source: 'bunny', r2Percent: 10 })} />);
    expect(seen.at(-1)?.sources[0]?.src).toBe(BUNNY);
  });
});
