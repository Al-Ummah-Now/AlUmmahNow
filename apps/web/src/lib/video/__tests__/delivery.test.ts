import { chooseDelivery, deviceClass } from '../delivery';

const BUNNY = 'https://vz-x.b-cdn.net/bcdn_token=t/v/playlist.m3u8';
const R2 = { playUrl: 'https://media.qa.alummahnow.net/pub/v/r/master.m3u8', thumbnailUrl: 'https://media.qa.alummahnow.net/pub/v/r/thumb.jpg' };

describe('chooseDelivery', () => {
  it('plays Bunny when the API sends no delivery or no R2 rendition', () => {
    expect(chooseDelivery(BUNNY, undefined)).toEqual({ provider: 'bunny', src: BUNNY });
    expect(chooseDelivery(BUNNY, { source: 'r2', r2Percent: 100 })).toEqual({ provider: 'bunny', src: BUNNY });
  });
  it('plays R2 with Bunny as the fallback when the API chose R2', () => {
    expect(chooseDelivery(BUNNY, { source: 'r2', r2Percent: 10, r2: R2 })).toEqual({ provider: 'r2', src: R2.playUrl, fallbackSrc: BUNNY, poster: R2.thumbnailUrl });
  });
  it('keeps Bunny when the API chose Bunny even if R2 is ready', () => {
    expect(chooseDelivery(BUNNY, { source: 'bunny', r2Percent: 10, r2: R2 }).provider).toBe('bunny');
  });
  it('draws per play with the percent', () => {
    expect(chooseDelivery(BUNNY, { source: 'draw', r2Percent: 30, r2: R2 }, () => 0.2).provider).toBe('r2');
    expect(chooseDelivery(BUNNY, { source: 'draw', r2Percent: 30, r2: R2 }, () => 0.31).provider).toBe('bunny');
    expect(chooseDelivery(BUNNY, { source: 'draw', r2Percent: 0, r2: R2 }, () => 0).provider).toBe('bunny');
  });
});

describe('deviceClass', () => {
  it('classifies common agents', () => {
    expect(deviceClass('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148')).toBe('mobile');
    expect(deviceClass('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('tablet');
    expect(deviceClass('Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 Safari/537.36')).toBe('tablet');
    expect(deviceClass('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36')).toBe('mobile');
    expect(deviceClass('Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0)')).toBe('tv');
    expect(deviceClass('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('desktop');
  });
});
