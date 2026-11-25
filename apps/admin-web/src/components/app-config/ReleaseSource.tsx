import { fillNodes } from '@/components/audit/fill';
import type { Translator } from '@/i18n/translate';

const NAMES = { github: 'appConfig.releases.sourceGitHub', admin: 'appConfig.releases.sourcePrivate' } as const;

/**
 * Where the index read a release (api-videos: `github:<repo>`, `admin:<repo>` for the private
 * bucket), in words. The repo is isolated left to right, so it never joins "GitHub" in an Arabic
 * line; a source without words, or without a repo, shows as it is.
 */
export function ReleaseSource({ source, t }: { source: string; t: Translator }) {
  const at = source.indexOf(':');
  const kind = at < 0 ? source : source.slice(0, at);
  const repo = at < 0 ? '' : source.slice(at + 1).trim();
  if (!repo || (kind !== 'github' && kind !== 'admin')) return <bdi dir="ltr" className="font-mono">{source}</bdi>;
  return <>{fillNodes(t(NAMES[kind]), { repo: <bdi dir="ltr">{repo}</bdi> })}</>;
}
