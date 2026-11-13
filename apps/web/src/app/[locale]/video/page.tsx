import { notFound } from 'next/navigation';

/**
 * /[locale]/video: the legacy /video?vid=<id> form is a 301 to /[locale]/video/<id> (middleware.ts),
 * so this page only answers when no video was given: 404.
 */
export default function LegacyVideoPage(): never {
  notFound();
}
