import { act, renderHook, waitFor } from '@testing-library/react';
import { useCursorList, type FetchCursorPage } from '@/hooks/useCursorList';

jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));

type Item = { id: string };
const page = (ids: string[], cursor: string | null) => ({ data: ids.map((id) => ({ id })), cursor });

describe('useCursorList', () => {
  it('reads every page until the API stops returning a cursor', async () => {
    const fetchPage = jest.fn<ReturnType<FetchCursorPage<Item>>, [string | undefined]>(async (cursor) =>
      cursor === undefined ? page(['a', 'b'], 'c1') : cursor === 'c1' ? page(['c', 'd'], 'c2') : page(['e'], null)
    );
    const { result } = renderHook(() => useCursorList<Item>('ch1', fetchPage, 'shorts'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(4));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(5));
    expect(result.current.hasMore).toBe(false);
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([undefined, 'c1', 'c2']);
  });

  it('hands the API keyset and scan cursors back verbatim (they are opaque)', async () => {
    // api-videos: `ks:` keyset positions (base64url) and `scan:<n>:<R2 cursor>` fallbacks
    const keyset = 'ks:WyJsYXRlc3QiLDE3NzUwMDE2MDAwMDAsIm0tYyJd';
    const scan = 'scan:7:AAAA/bb+cc==';
    const fetchPage = jest.fn(async (cursor: string | undefined) =>
      cursor === undefined ? page(['a'], keyset) : cursor === keyset ? page(['b'], scan) : page(['c'], '')
    );
    const { result } = renderHook(() => useCursorList<Item>('ch1', fetchPage, 'playlists'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.hasMore).toBe(false));
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([undefined, keyset, scan]);
    expect(result.current.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    // The API clients put them in the query string encoded, so they arrive unchanged
    const { buildQueryParams } = jest.requireActual('@/lib/api/api-client');
    expect(new URLSearchParams(buildQueryParams({ cursor: scan }).slice(1)).get('cursor')).toBe(scan);
  });

  it('drops items a later page repeats', async () => {
    const fetchPage = jest.fn(async (cursor: string | undefined) => (cursor ? page(['b', 'c'], null) : page(['a', 'b'], 'c1')));
    const { result } = renderHook(() => useCursorList<Item>('ch1', fetchPage, 'videos'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.hasMore).toBe(false));
    expect(result.current.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps what is shown when a later page fails, and retries it', async () => {
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce(page(['a'], 'c1'))
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(page(['b'], null));
    const { result } = renderHook(() => useCursorList<Item>('ch1', fetchPage, 'videos'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.moreFailed).toBe(true));
    expect(result.current.items.map((i) => i.id)).toEqual(['a']);
    expect(result.current.hasMore).toBe(true);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual(['a', 'b']));
    expect(result.current.moreFailed).toBe(false);
  });

  it('reports a failed first page and loads again on retry', async () => {
    const fetchPage = jest.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(page(['a'], null));
    const { result } = renderHook(() => useCursorList<Item>('ch1', fetchPage, 'live'));
    await waitFor(() => expect(result.current.failed).toBe(true));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.failed).toBe(false);
  });

  it('ignores an answer for a channel the user already left', async () => {
    let resolveOld: (v: ReturnType<typeof page>) => void = () => {};
    const slow = new Promise<ReturnType<typeof page>>((r) => (resolveOld = r));
    const fetchFor = (key: string) => (key === 'old' ? () => slow : async () => page(['new1'], null));
    const { result, rerender } = renderHook(({ k }) => useCursorList<Item>(k, fetchFor(k), 'videos'), { initialProps: { k: 'old' } });
    rerender({ k: 'new' });
    await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual(['new1']));
    await act(async () => resolveOld(page(['stale'], 'x')));
    expect(result.current.items.map((i) => i.id)).toEqual(['new1']);
    expect(result.current.hasMore).toBe(false);
  });
});
