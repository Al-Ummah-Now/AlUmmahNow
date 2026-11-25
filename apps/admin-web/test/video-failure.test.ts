/** Why a video failed and what to do: words in both languages, whose turn it is, what Retry does. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { explainTranscodeFailure, VIDEO_FAILURE_REASONS, VIDEO_FAILURE_STEPS, VIDEO_FAILURES_MAX } from '@al-ummah/shared-types';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';
import { createTranslator } from '../src/i18n/translate';
import { causedByFile, failureHref, failureIds, failureReasonLabel, failureStepLabel, splitRetry } from '../src/lib/video-failure';

const t = { en: createTranslator('en'), ar: createTranslator('ar') };

describe('video failure words', () => {
  it('every reason and step, in English and Arabic', () => {
    for (const reason of VIDEO_FAILURE_REASONS) {
      const key = failureReasonLabel(reason);
      assert.notEqual(t.en(key), key, reason);
      assert.match(t.ar(key), /[؀-ۿ]/, reason);
    }
    for (const step of VIDEO_FAILURE_STEPS) {
      for (const importBatchId of [null, 'b1']) {
        const key = failureStepLabel({ step, importBatchId });
        assert.notEqual(t.en(key), key, step);
        assert.match(t.ar(key), /[؀-ۿ]/, step);
        assert.doesNotMatch(t.ar(key), /فيديو|[a-z]/, step);
      }
    }
    assert.equal(failureReasonLabel('new'), failureReasonLabel('unknown'));
    assert.ok(failureStepLabel({ step: 'new' as never, importBatchId: null }));
    assert.deepEqual(Object.keys(en.videoFailure.steps), Object.keys(ar.videoFailure.steps));
  });

  it('an imported file is imported again; any other is its uploader’s', () => {
    const f = explainTranscodeFailure({ reason: 'no_video_stream', source: { bytes: 1, container: 'mp4', zeroStartPercent: 0, zeroEndPercent: 0, streams: [{ kind: 'audio', codec: 'aac' }] } });
    assert.equal(t.en(failureReasonLabel(f.reason)), 'The file has sound only, no picture.');
    assert.match(t.en(failureStepLabel({ ...f, importBatchId: 'b' })), /^Import the original again, with its picture/);
    assert.match(t.en(failureStepLabel({ ...f, importBatchId: null })), /^Its uploader needs to upload the original/);
    assert.equal(causedByFile(f), true);
    assert.equal(causedByFile(null), false);
  });

  it('one link for all pages, and no more ids than one read takes', () => {
    assert.equal(failureHref('a b'), '/delivery?video=a%20b#transcode-troubleshooting');
    assert.deepEqual(failureIds([{ id: 'a', failed: true }, { id: 'b', failed: false }, { id: 'a', failed: true }]), ['a']);
    assert.equal(failureIds(Array.from({ length: 300 }, (_, i) => ({ id: `v${i}`, failed: true }))).length, VIDEO_FAILURES_MAX);
  });

  it('Retry transcodes an R2 failure again and asks Bunny for the rest', () => {
    assert.deepEqual(splitRetry(['a', 'b', 'c'], { a: { where: 'r2' }, b: { where: 'bunny' } }), { r2: ['a'], bunny: ['b', 'c'] });
  });
});
