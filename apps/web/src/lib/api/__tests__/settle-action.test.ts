const mockRecover = jest.fn((..._a: unknown[]) => false);
jest.mock('@/lib/version-skew', () => ({ recoverFromVersionSkew: (...a: unknown[]) => mockRecover(...a) }));
jest.mock('@/lib/logger-client', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import { ACTION_UNREACHABLE, settleAction } from '../settle-action';

type Result = { ok: true; data: number } | { ok: false; status: number; error: string };

describe('settleAction (owner review 2026-11-16: no endless spinners)', () => {
  beforeEach(() => mockRecover.mockReset().mockReturnValue(false));

  it('passes a completed call through untouched, ok or not', async () => {
    const ok = settleAction('ok', async (n: number): Promise<Result> => ({ ok: true, data: n * 2 }));
    await expect(ok(2)).resolves.toEqual({ ok: true, data: 4 });
    const off = settleAction('off', async (): Promise<Result> => ({ ok: false, status: 404, error: 'feature_off' }));
    await expect(off()).resolves.toEqual({ ok: false, status: 404, error: 'feature_off' });
  });

  it('a call that rejects (dropped connection, cancelled) resolves to network instead', async () => {
    const dropped = settleAction('dropped', async (): Promise<Result> => {
      throw new TypeError('Failed to fetch');
    });
    await expect(dropped()).resolves.toEqual({ ok: false, status: 0, error: 'network' });
    const aborted = settleAction('aborted', async (): Promise<Result> => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    });
    await expect(aborted()).resolves.toEqual(ACTION_UNREACHABLE);
    expect(mockRecover).toHaveBeenCalledWith(expect.any(TypeError), 'action:dropped');
  });

  it('version skew still starts the reload recovery, and the caller settles too', async () => {
    mockRecover.mockReturnValue(true);
    const skew = settleAction('skew', async (): Promise<Result> => {
      throw new Error('Failed to find Server Action "abc". This request might be from an older or newer deployment.');
    });
    await expect(skew()).resolves.toEqual({ ok: false, status: 0, error: 'network' });
    expect(mockRecover).toHaveBeenCalledTimes(1);
  });

  it('each settled result is a fresh object (callers may not mutate the shared one)', async () => {
    const a = settleAction('a', async (): Promise<Result> => Promise.reject(new Error('x')));
    const r = await a();
    expect(r).not.toBe(ACTION_UNREACHABLE);
    expect(Object.isFrozen(ACTION_UNREACHABLE)).toBe(true);
  });
});
