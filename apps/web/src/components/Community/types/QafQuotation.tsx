import type { QafQuote } from '@al-ummah/shared-types';

export default function QafQuotation({ quote }: { quote: QafQuote }) {
  return (
    <figure className="space-y-2" data-testid="qaf-quotation">
      <blockquote cite={quote.url} lang="ar" dir="rtl" className="whitespace-pre-wrap break-words border-s-4 border-[var(--fanous-color-divider)] ps-3 text-start">
        {quote.text}
      </blockquote>
      <figcaption dir="auto" className="text-start text-sm">
        <a href={quote.url} target="_blank" rel="noopener noreferrer nofollow" className="text-[var(--fanous-color-link)] underline underline-offset-2">{quote.label}</a>
      </figcaption>
    </figure>
  );
}
