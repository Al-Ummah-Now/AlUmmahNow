/**
 * What the embed spec's failure message may say about the console
 * (apps/web/e2e/release/console-counts.ts): the CI logs are public, so only counts come out.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { countConsoleLine, noConsoleCounts } from '../../../apps/web/e2e/release/console-counts.ts';

describe('countConsoleLine', () => {
  it('counts levels, known markers and HTTP error statuses', () => {
    const counts = noConsoleCounts();
    countConsoleLine(counts, 'error', 'Failed to load resource: the server responded with a status of 403 ()');
    countConsoleLine(counts, 'error', 'Origin https://x is not allowed by Access-Control-Allow-Origin. Status code: 403');
    countConsoleLine(counts, 'error', 'VIDEOJS: ERROR: (CODE:4 MEDIA_ERR_SRC_NOT_SUPPORTED) HTTP 502');
    countConsoleLine(counts, 'warning', 'play() failed: NotAllowedError, then AbortError and NotSupportedError');
    countConsoleLine(counts, 'warning', "Refused by the Content Security Policy; CORS");
    assert.deepEqual(counts.levels, { error: 3, warning: 2 });
    assert.deepEqual(counts.markers, {
      'HTTP 403': 2,
      'HTTP 502': 1,
      CORS: 2,
      CSP: 1,
      VIDEOJS: 1,
      MEDIA_ERR_SRC_NOT_SUPPORTED: 1,
      NotAllowedError: 1,
      AbortError: 1,
      NotSupportedError: 1,
    });
  });

  it('keeps nothing of a line: no URL, token, address or other text', () => {
    const counts = noConsoleCounts();
    countConsoleLine(
      counts,
      'log',
      'https://cdn.example.net/bcdn_token=SECRET&expires=1/v.m3u8 /priv/1799999999.SIG/x Bearer abc.def Cookie: s=1 someone@example.com id 40312',
    );
    assert.deepEqual(counts, { levels: { log: 1 }, markers: {} });
  });
});
