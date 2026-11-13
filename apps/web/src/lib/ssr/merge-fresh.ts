/**
 * Server-rendered lists carry stable images only (lib/ssr/stable-images.ts); when the server had to drop
 * one (a video only the viewer may see), the client reloads the list and takes the fresh items in
 * place: same order and length as shown, each item replaced by its fresh copy when it has one.
 */
export function mergeFresh<T extends { id?: string }>(shown: T[], fresh: T[] | null | undefined): T[] {
  if (!fresh?.length) return shown;
  const byId = new Map(fresh.filter((item) => item.id).map((item) => [item.id as string, item]));
  return shown.map((item) => (item.id && byId.get(item.id)) || item);
}
