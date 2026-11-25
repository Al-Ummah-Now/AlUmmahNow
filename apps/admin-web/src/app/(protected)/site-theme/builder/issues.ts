// A theme package's problems in the admin's words. The validator gives a code and its numbers with
// its own English message; the list, the field errors and the "Publishing is blocked" line are worded here.
import type { Issue, IssueCode } from '@al-ummah/theme-packages';
import { formatFixed } from '@al-ummah/shared-types';
import type { Locale } from '@/i18n/config';
import type { MessageKey, Translator } from '@/i18n/translate';

/** A name from the package (a color role, a file) kept left to right inside Arabic text. */
export const isolate = (name: string | number | undefined) => `⁦${name ?? ''}⁩`;

/** What is wrong, in words. A problem without a code (an older API) is "not valid". */
export function issueText(t: Translator, locale: Locale, issue: Issue): string {
  const p = issue.params ?? {};
  const code: IssueCode = issue.code ?? 'invalid';
  return t(`themeBuilder.issues.${code}` as MessageKey, {
    ...p,
    ...(typeof p.ratio === 'number' ? { ratio: formatFixed(locale, p.ratio, 2) } : {}),
    ...(p.color !== undefined ? { color: isolate(p.color), background: isolate(p.background) } : {}),
    ...(p.file !== undefined ? { file: isolate(p.file) } : {}),
    ...(p.ref !== undefined ? { ref: isolate(p.ref) } : {}),
    ...(p.type !== undefined ? { type: isolate(p.type) } : {}),
  });
}

/** Where it is: the part of the editor in words, then the package's own name for the value (if any). */
export function issueWhere(t: Translator, path: string): { label: string; name: string } {
  const mode = (m: string) => t(m === 'dark' ? 'themeBuilder.modeDark' : 'themeBuilder.modeLight');
  let m = /^(name|description)(?:\.(en|ar))?$/.exec(path);
  if (m) {
    const field = t(`themeBuilder.${m[1]}` as MessageKey);
    return { label: m[2] ? t('localized.fieldIn', { field, lang: t(m[2] === 'en' ? 'localized.langEnglish' : 'localized.langArabic') }) : field, name: '' };
  }
  if ((m = /^tokens\.color\.(light|dark)\.(.+)$/.exec(path))) return { label: t('themeBuilder.colours', { mode: mode(m[1]) }), name: m[2] };
  if ((m = /^tokens\.brand\.(.+)$/.exec(path))) return { label: t('themeBuilder.brandColours'), name: m[1] };
  if ((m = /^components\.([a-zA-Z]+)\.colors\.(light|dark)\.(.+)$/.exec(path))) return { label: t('themeBuilder.issuesAt.component', { mode: mode(m[2]) }), name: `${m[1]} ${m[3]}` };
  const rest = path.slice(path.indexOf('.') + 1);
  if (path === 'author') return { label: t('themeBuilder.author'), name: '' };
  if (path === 'banner' || path.startsWith('banner.')) return { label: t('themeBuilder.issuesAt.banner'), name: '' };
  if (path.startsWith('components')) return { label: t('themeBuilder.sectionComponents'), name: rest };
  if (path.startsWith('tokens.color')) return { label: t('themeBuilder.sectionColours'), name: '' };
  if (path.startsWith('tokens') || path.startsWith('materials')) return { label: t('themeBuilder.sectionMaterials'), name: rest };
  if (path.startsWith('typography')) return { label: t('themeBuilder.sectionTypography'), name: rest };
  if (path.startsWith('assets')) return { label: t('themeBuilder.sectionAssets'), name: path === 'assets' ? '' : path.slice('assets/'.length) };
  if (path.startsWith('imagery')) return { label: t('themeBuilder.sectionImagery'), name: rest };
  return { label: t('themeBuilder.issuesAt.other'), name: path === '(root)' ? '' : path };
}

export type BlockReason = 'texts' | 'contrast' | 'files' | 'values';
const FILES = new Set<IssueCode>(['fileMissing', 'fileName', 'fileSize', 'fileType', 'fileUnsafe', 'totalSize']);

/** Why publishing is blocked: the kinds of problem there are, in the order they are named. */
export function blockReasons(issues: Issue[]): BlockReason[] {
  const kinds = new Set(
    issues.map((i): BlockReason => {
      if (i.code === 'contrast' || i.code === 'headerContrast') return 'contrast';
      if (i.code && FILES.has(i.code)) return 'files';
      if (i.code === 'bannerText' || /^(name|description|author|banner\.text)(\.|$)/.test(i.path)) return 'texts';
      return 'values';
    }),
  );
  return (['texts', 'contrast', 'files', 'values'] as const).filter((r) => kinds.has(r));
}

/** "Publishing is blocked: …" with the real reasons. */
export function blockedText(t: Translator, locale: Locale, issues: Issue[]): string {
  const reasons = blockReasons(issues).map((r) => t(`themeBuilder.blockedBy.${r}` as MessageKey));
  return t('themeBuilder.publishBlocked', { reasons: new Intl.ListFormat(locale, { type: 'conjunction' }).format(reasons) });
}
