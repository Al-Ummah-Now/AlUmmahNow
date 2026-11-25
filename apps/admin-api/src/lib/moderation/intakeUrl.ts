/**
 * The page a super admin pastes to open a case for a reported item (docs/specs/CSAM-RESPONSE.md §3), or null
 * when no page names exactly that item. The URL is read back with the intake's own parser: a link that would
 * map to anything else (the video a comment is on, say) is never offered.
 */
import { parseCsamUrl, type AdminLookupItem, type ReportableEntityType } from '@al-ummah/shared-types';

export function reportIntakeUrl(origin: string | null, item: { type: ReportableEntityType; id: string; live: Pick<AdminLookupItem, 'found' | 'parentId' | 'parentType'> | null }): string | null {
  if (!origin) return null;
  const { type, id, live } = item;
  const e = encodeURIComponent;
  const check = (path: string, names: (t: NonNullable<ReturnType<typeof parseCsamUrl>>) => boolean): string | null => {
    const url = `${origin}${path}`;
    const target = parseCsamUrl(url);
    return target && names(target) ? url : null;
  };
  switch (type) {
    case 'video':
      return check(`/en/video/${e(id)}`, (t) => t.kind === 'page' && t.page === 'video' && t.id === id);
    case 'post':
      return check(`/en/post/${e(id)}`, (t) => t.kind === 'page' && t.page === 'post' && t.postId === id);
    case 'livestream':
      return check(`/en/live/${e(id)}`, (t) => t.kind === 'live_stream' && t.streamId === id);
    case 'comment': {
      // Only with what it is on, and then only as the comment
      if (!live?.found || !live.parentId || !live.parentType) return null;
      const path = live.parentType === 'post' ? `/en/post/${e(live.parentId)}` : `/en/video/${e(live.parentId)}`;
      return check(`${path}?comment=${e(id)}`, (t) => t.kind === 'comment' && t.commentId === id && t.parentId === live.parentId && t.on === live.parentType);
    }
    default:
      // A channel page, a playlist and a chat message are no single item of the intake
      return null;
  }
}
