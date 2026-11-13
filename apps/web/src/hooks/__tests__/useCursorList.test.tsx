import { act, renderHook, waitFor } from '@testing-library/react';
import { useCursorList, type FetchCursorPage } from '@/hooks/useCursorList';

jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));

type Item = { id: string };
const page = (ids: string[], cursor: string | null) => ({ data: ids.map((id) => ({ id })), cursor });

describe('useCursorList', () => {
  it('should show the server page at once and not fetch it again when given an initial page', async () => {
    const fetchPage = jest.fn(async () => page(['c'], null));
    const { result } = renderHook(() => useCursorList<Item>('ch1', fetchPage, 'videos', page(['a', 'b'], 'c1')));
    expect(result.current.loading).toBe(false);
    expect(result.current.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(result.current.hasMore).toBe(true);
    expect(fetchPage).not.toHaveBeenCalled();
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    expect(fetchPage.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['c1']);
  });

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
