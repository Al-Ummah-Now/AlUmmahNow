import { act, renderHook } from '@testing-library/react';
import { useWhenReady } from '../useWhenReady';

describe('useWhenReady', () => {
  it('waits for a value that is not there yet, and answers at once when it is', async () => {
    const { result, rerender } = renderHook(({ v }: { v: { id: string } | null }) => useWhenReady(v), { initialProps: { v: null as { id: string } | null } });
    let got: { id: string } | undefined;
    void result.current().then((v) => (got = v));
    await act(async () => undefined);
    expect(got).toBeUndefined();
    await act(async () => rerender({ v: { id: 'p1' } }));
    expect(got).toEqual({ id: 'p1' });
    await expect(result.current()).resolves.toEqual({ id: 'p1' });
  });
});
