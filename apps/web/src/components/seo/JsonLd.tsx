import { jsonLdText } from '@/lib/seo/structured-data';

/** Structured data for search engines (a data block the browser never runs, so no CSP nonce). */
export function JsonLd({ data }: { data: unknown }) {
  if (!data || (Array.isArray(data) && data.length === 0)) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(data) }} />;
}
