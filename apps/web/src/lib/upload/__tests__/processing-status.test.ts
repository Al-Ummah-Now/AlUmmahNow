import { batchNotice, isTerminalPhase, nextProcessingPollDelay, phaseFromStatus } from '../processing-status';

type Item = { status: 'pending' | 'uploading' | 'paused' | 'processing' | 'completed' | 'failed' | 'cancelled'; videoId: string };
const item = (status: Item['status'], videoId = `v-${Math.random()}`): Item => ({ status, videoId });

describe('processing status', () => {
  it('maps upload statuses to phases (same values as the video record)', () => {
    expect(phaseFromStatus('ready')).toBe('ready');
    expect(phaseFromStatus('failed')).toBe('failed');
    for (const s of ['processing', 'uploading', 'initiated', undefined, null, 'weird']) expect(phaseFromStatus(s)).toBe('processing');
    expect(isTerminalPhase('ready')).toBe(true);
    expect(isTerminalPhase('failed')).toBe(true);
    expect(isTerminalPhase('processing')).toBe(false);
  });

  it('backs off status polls from 5 s to 30 s', () => {
    expect([0, 1, 2, 3, 4, 50].map(nextProcessingPollDelay)).toEqual([5000, 10000, 20000, 30000, 30000, 30000]);
  });

  describe('batch notice', () => {
    it('asks to keep the page open while any file is uploading or paused', () => {
      expect(batchNotice([item('completed', 'a'), item('uploading')], { a: 'ready' }, true)).toBe('keepOpen');
      expect(batchNotice([item('completed', 'a'), item('paused')], { a: 'ready' }, false)).toBe('keepOpen');
    });

    it('counts queued files as in flight only once the batch runs', () => {
      expect(batchNotice([item('pending')], {}, true)).toBe('keepOpen');
      expect(batchNotice([item('pending')], {}, false)).toBeNull();
    });

    it('says processing continues once every file is uploaded', () => {
      expect(batchNotice([item('completed', 'a'), item('completed', 'b')], { a: 'ready' }, false)).toBe('processing');
      expect(batchNotice([item('completed', 'a'), item('cancelled')], {}, false)).toBe('processing');
    });

    it('says all are ready when every uploaded file is ready', () => {
      expect(batchNotice([item('completed', 'a'), item('completed', 'b'), item('failed')], { a: 'ready', b: 'ready' }, false)).toBe('allReady');
    });

    it('leaves it to the rows when some failed processing and none still process', () => {
      expect(batchNotice([item('completed', 'a'), item('completed', 'b')], { a: 'ready', b: 'failed' }, false)).toBeNull();
    });
  });
});
