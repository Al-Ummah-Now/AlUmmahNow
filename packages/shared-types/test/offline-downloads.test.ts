/**
 * Offline downloads & Listen mode types, quality ordering, tier helpers and switch defaults (E14-S1).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CREATOR_TIER,
  DEFAULT_MEMBER_TIER,
  DEFAULT_UNLIMITED_TIER,
  OFFLINE_DOWNLOAD_QUALITIES,
  isOfflineDownloadQuality,
  offlineQualityAllowed,
  offlineQualityRank,
  tierAllowsOfflineDownloads,
  tierOfflineLimits,
} from '../src/creator-tiers.ts';
import { DEFAULT_FEATURE_SWITCHES } from '../src/feature-registry.ts';

describe('offline download qualities and tier helpers', () => {
  it('orders qualities from audio up to 1080p', () => {
    assert.deepEqual([...OFFLINE_DOWNLOAD_QUALITIES], ['audio', '360p', '480p', '720p', '1080p']);
    assert.equal(isOfflineDownloadQuality('audio'), true);
    assert.equal(isOfflineDownloadQuality('480p'), true);
    assert.equal(isOfflineDownloadQuality('4k'), false);
    assert.equal(offlineQualityRank('audio'), 0);
    assert.equal(offlineQualityRank('1080p'), 4);
    assert.equal(offlineQualityAllowed('audio', 'audio'), true);
    assert.equal(offlineQualityAllowed('360p', 'audio'), false);
    assert.equal(offlineQualityAllowed('480p', '480p'), true);
    assert.equal(offlineQualityAllowed('720p', '480p'), false);
    assert.equal(offlineQualityAllowed('1080p', '1080p'), true);
  });

  it('provides expected shipped tier defaults and unlimited override', () => {
    assert.equal(tierAllowsOfflineDownloads(DEFAULT_MEMBER_TIER), true);
    assert.deepEqual(tierOfflineLimits(DEFAULT_MEMBER_TIER), {
      allowed: true,
      maxQuality: '480p',
      maxVideos: 25,
      licenseDays: 30,
    });
    assert.deepEqual(tierOfflineLimits(DEFAULT_CREATOR_TIER), {
      allowed: true,
      maxQuality: '1080p',
      maxVideos: 100,
      licenseDays: 30,
    });
    assert.deepEqual(tierOfflineLimits(DEFAULT_UNLIMITED_TIER), {
      allowed: true,
      maxQuality: '1080p',
      maxVideos: null,
      licenseDays: 30,
    });
    assert.equal(tierAllowsOfflineDownloads({ unlimited: false, offlineDownloads: false }), false);
    assert.equal(tierAllowsOfflineDownloads({ unlimited: true, offlineDownloads: false }), true);
    assert.equal(tierAllowsOfflineDownloads(null), false);
  });

  it('defaults listenMode and offlineDownloads switches OFF', () => {
    assert.equal(DEFAULT_FEATURE_SWITCHES.listenMode, false);
    assert.equal(DEFAULT_FEATURE_SWITCHES.offlineDownloads, false);
  });
});
