'use client';

import { useEffect, useId, useState, type FormEvent, type RefObject } from 'react';
import { BookOpen, Search } from 'lucide-react';
import { QAF_PASSAGE_URL, QAF_TURATH_URL, localizeDigits, parseLocaleNumber, writeQafQuote, type QafCandidate, type QafContext, type QafPassage } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/hooks/useLanguage';
import { QafRequestError, requestSource } from '@/lib/api/qaf-client';

const genres = [
  ['hanafi-fiqh', 'hanafi'], ['maliki-fiqh', 'maliki'], ['shafii-fiqh', 'shafii'], ['hanbali-fiqh', 'hanbali'],
  ['general-fiqh', 'generalFiqh'], ['fatwas', 'fatwas'], ['principles-of-jurisprudence', 'principles'],
  ['hadith-collections', 'hadith'], ['hadith-commentary', 'hadithCommentary'], ['quran-commentary', 'tafsir'],
] as const;
const field = 'h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm';
const link = 'text-[var(--fanous-color-link)] underline underline-offset-2';

function citation(passage: QafPassage, lang: 'ar' | 'en') {
  const ar = lang === 'ar';
  const names = ar ? [passage.book.titleArabic, passage.author.nameArabic] : [passage.book.title, passage.author.name];
  const sep = ar ? '، ' : ', ';
  const pages = passage.pages.map(({ vol, page }) => [
    vol === null ? '' : `${ar ? 'ج' : 'vol.'} ${localizeDigits(lang, vol)}`,
    page === null ? '' : `${ar ? 'ص' : 'p.'} ${localizeDigits(lang, page)}`,
  ].filter(Boolean).join(sep)).filter(Boolean);
  return [names.join(' — '), pages.join(ar ? '؛ ' : '; ')].filter(Boolean).join(sep);
}

function useQafError() {
  const { t } = useLanguage();
  return (error: unknown) => {
    const copy = t.community.sources;
    switch (error instanceof QafRequestError ? error.code : '') {
      case 'minute': return copy.minute;
      case 'week': return copy.week;
      case 'user_week': return copy.userWeek;
      case 'invalid_keys': return copy.invalidKey;
      case 'not_configured': return copy.notConfigured;
      case 'no_matching_books': return copy.noBooks;
      default: return copy.unavailable;
    }
  };
}

export function QafSourcePicker({ channelId, postLocale, editor, value, onChange, maxLength, onSelectPassage }: {
  channelId: string;
  postLocale: 'ar' | 'en';
  editor: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  onSelectPassage?: (passage: QafPassage) => void;
}) {
  const { t, dir } = useLanguage();
  const copy = t.community.sources;
  const [enabledChannel, setEnabledChannel] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    requestSource<{ enabled: boolean }>(channelId, '', { signal: controller.signal })
      .then(({ enabled }) => { if (!controller.signal.aborted) setEnabledChannel(enabled ? channelId : null); })
      .catch(() => { if (!controller.signal.aborted) setEnabledChannel(null); });
    return () => controller.abort();
  }, [channelId]);

  if (enabledChannel !== channelId) return null;
  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (next) {
        const selected = editor.current?.value.slice(editor.current.selectionStart, editor.current.selectionEnd).trim();
        setTopic((selected || value.trim()).slice(0, 2000));
      }
      setOpen(next);
    }}>
      <DialogTrigger asChild><Button type="button" size="sm" variant="outline"><BookOpen aria-hidden="true" />{copy.find}</Button></DialogTrigger>
      {open && <DialogContent dir={dir} className="max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-[760px] overflow-y-auto text-start">
        <DialogTitle className="pe-10">{copy.find}</DialogTitle>
        <DialogDescription>{copy.hint}</DialogDescription>
        <SourceSearch key={postLocale} channelId={channelId} postLocale={postLocale} topic={topic} onInsert={(passage) => {
          if (onSelectPassage) {
            onSelectPassage(passage);
            setOpen(false);
            return true;
          }
          const quote = writeQafQuote(passage.text, citation(passage, postLocale), passage.url);
          const candidate = value.trimEnd() ? `${value.trimEnd()}\n\n${quote}` : quote;
          if (candidate.length > maxLength) return false;
          onChange(candidate);
          setOpen(false);
          return true;
        }} />
      </DialogContent>}
    </Dialog>
  );
}

function SourceSearch({ channelId, postLocale, topic, onInsert }: {
  channelId: string; postLocale: 'en' | 'ar'; topic: string; onInsert: (passage: QafPassage) => boolean;
}) {
  const { t } = useLanguage();
  const copy = t.community.sources;
  const explain = useQafError();
  const id = useId();
  const [query, setQuery] = useState(topic);
  const [genre, setGenre] = useState('');
  const [author, setAuthor] = useState<QafCandidate | null>(null);
  const [book, setBook] = useState<QafCandidate | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pending, setPending] = useState(false);
  const [results, setResults] = useState<QafPassage[] | null>(null);
  const [error, setError] = useState('');
  const [insertError, setInsertError] = useState('');

  async function search(event: FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (pending || !query.trim()) return;
    const first = from.trim() ? parseLocaleNumber(from) : undefined;
    const last = to.trim() ? parseLocaleNumber(to) : undefined;
    if ([first, last].some((year) => year !== undefined && (!Number.isSafeInteger(year) || year < 1)) ||
      (first !== undefined && last !== undefined && first > last)) {
      setError(copy.invalidYears);
      return;
    }
    setError('');
    setInsertError('');
    setResults(null);
    setPending(true);
    try {
      const data = await requestSource<{ results: QafPassage[] }>(channelId, '/search', {
        body: { query, locale: postLocale, limit: 8, filters: {
          genres: genre ? [genre] : undefined,
          authorIds: author?.type === 'author' ? [author.id] : undefined,
          bookIds: book?.type === 'book' ? [book.id] : undefined,
          deathYearAH: first !== undefined || last !== undefined ? { gte: first, lte: last } : undefined,
        } },
      });
      setResults(data.results);
    } catch (error) {
      setError(explain(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <form className="grid gap-3" onSubmit={search}>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-query`}>{copy.topic}</Label>
          <div className="flex gap-2">
            <Input id={`${id}-query`} dir="auto" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={2000} />
            <Button type="submit" disabled={pending || !query.trim()}><Search aria-hidden="true" />{pending ? copy.searching : copy.search}</Button>
          </div>
        </div>
        <details className="rounded-md border px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">{copy.filters}</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor={`${id}-genre`}>{copy.genre}</Label>
              <select id={`${id}-genre`} className={field} value={genre} onChange={(event) => setGenre(event.target.value)}>
                <option value="">{copy.anyGenre}</option>
                {genres.map(([slug, key]) => <option key={slug} value={slug}>{copy[key]}</option>)}
              </select>
            </div>
            <p id={`${id}-lookup-hint`} className="text-xs text-muted-foreground sm:col-span-2">{copy.lookupHint}</p>
            <CatalogField type="author" channelId={channelId} postLocale={postLocale} hintId={`${id}-lookup-hint`} onChange={setAuthor} />
            <CatalogField type="book" channelId={channelId} postLocale={postLocale} hintId={`${id}-lookup-hint`} onChange={setBook} />
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-from`}>{copy.fromYear}</Label>
              <Input id={`${id}-from`} inputMode="numeric" maxLength={8} value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-to`}>{copy.toYear}</Label>
              <Input id={`${id}-to`} inputMode="numeric" maxLength={8} value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        </details>
      </form>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {insertError && <p role="alert" className="text-sm text-destructive">{insertError}</p>}
      {results?.length === 0 && <p role="status" className="text-sm text-muted-foreground">{copy.noResults}</p>}
      {!!results?.length && (
        <ul className="space-y-3" aria-live="polite">
          {results.map((passage) => <li key={passage.id}><SourceResult channelId={channelId} postLocale={postLocale} passage={passage} onInsert={() => {
            if (!onInsert(passage)) setInsertError(copy.tooLong);
          }} /></li>)}
        </ul>
      )}
    </>
  );
}

function CatalogField({ type, channelId, postLocale, hintId, onChange }: {
  type: 'author' | 'book'; channelId: string; postLocale: 'en' | 'ar'; hintId: string;
  onChange: (value: QafCandidate | null) => void;
}) {
  const { t } = useLanguage();
  const copy = t.community.sources;
  const explain = useQafError();
  const id = useId();
  const [query, setQuery] = useState('');
  const [choices, setChoices] = useState<QafCandidate[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function lookup() {
    setError('');
    setChoices(null);
    onChange(null);
    setPending(true);
    try {
      const params = new URLSearchParams({ type, query, locale: postLocale });
      const data = await requestSource<{ candidates: QafCandidate[] }>(channelId, `/catalog?${params}`);
      setChoices(data.candidates);
    } catch (error) {
      setError(explain(error));
    } finally {
      setPending(false);
    }
  }

  return <div className="grid content-start gap-1.5">
    <Label htmlFor={id}>{copy[type]}</Label>
    <div className="flex gap-1.5">
      <Input id={id} dir="auto" className="min-w-0" value={query} disabled={pending} onChange={(event) => {
        setQuery(event.target.value);
        onChange(null);
        setChoices(null);
      }} onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          if (query.trim() && !pending) void lookup();
        }
      }} maxLength={200} />
      <Button
        type="button" size="sm" variant="outline" disabled={pending || !query.trim()}
        aria-describedby={query.trim() ? undefined : hintId}
        className="disabled:opacity-100 disabled:bg-[var(--fanous-c-button-secondary-disabled-bg)] disabled:text-[var(--fanous-c-button-secondary-disabled-text)]"
        onClick={lookup}
      >{pending ? copy.searching : copy.lookup}</Button>
    </div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {choices?.length === 0 && <p role="status" className="text-xs text-muted-foreground">{copy.emptyCatalog}</p>}
    {!!choices?.length && <select aria-label={type === 'author' ? copy.chooseAuthor : copy.chooseBook} className={field} defaultValue="" onChange={(event) => {
      onChange(choices.find((choice) => String(choice.id) === event.target.value) ?? null);
    }}>
      <option value="">{type === 'author' ? copy.chooseAuthor : copy.chooseBook}</option>
      {choices.map((choice) => <option value={choice.id} key={choice.id}>{[
        choice.label, choice.type === 'book' ? choice.authorLabel : '',
        choice.deathYearAH === null ? choice.deathInexactLabel : localizeDigits(postLocale, choice.deathYearAH),
      ].filter(Boolean).join(postLocale === 'ar' ? '، ' : ', ')}</option>)}
    </select>}
  </div>;
}

function SourceResult({ passage, channelId, postLocale, onInsert }: { passage: QafPassage; channelId: string; postLocale: 'en' | 'ar'; onInsert: () => void }) {
  const { t } = useLanguage();
  const copy = t.community.sources;
  const explain = useQafError();
  const [expanded, setExpanded] = useState(false);
  const [context, setContext] = useState<QafContext>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function toggleContext() {
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    if (context) return;
    setPending(true);
    setError('');
    try {
      setContext(await requestSource<QafContext>(channelId, `/passages/${encodeURIComponent(passage.id)}?radius=2&locale=${postLocale}`));
    } catch (error) {
      setError(explain(error));
    } finally {
      setPending(false);
    }
  }
  const safeCitation = QAF_PASSAGE_URL.test(passage.url);
  const prose = 'whitespace-pre-wrap break-words text-start';
  return <div className="space-y-2 rounded-lg border bg-[var(--fanous-color-surface-raised)] p-4">
    {safeCitation ? <a className={`${link} block text-sm font-medium`} dir="auto" href={passage.url} rel="noopener noreferrer nofollow" target="_blank">{citation(passage, postLocale)}</a> : <p dir="auto" className="text-sm font-medium">{citation(passage, postLocale)}</p>}
    {expanded && context?.before.map((item) => <p key={item.id} className={`${prose} text-sm text-muted-foreground`} lang="ar" dir="rtl">{item.text}</p>)}
    <p lang="ar" dir="rtl" className={prose}>{passage.text}</p>
    {expanded && context?.after.map((item) => <p key={item.id} className={`${prose} text-sm text-muted-foreground`} lang="ar" dir="rtl">{item.text}</p>)}
    {expanded && context?.footnotes && <div className="text-sm"><p className="font-medium">{copy.footnotes}</p><p lang="ar" dir="rtl" className={prose}>{context.footnotes}</p></div>}
    {expanded && error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" disabled={!safeCitation} onClick={onInsert}>{copy.insert}</Button>
      {QAF_TURATH_URL.test(passage.turathUrl) && (
        <Button asChild size="sm" variant="outline">
          <a href={passage.turathUrl} target="_blank" rel="noopener noreferrer nofollow">{copy.readInTurath}</a>
        </Button>
      )}
      <Button type="button" size="sm" variant="outline" onClick={toggleContext} aria-expanded={expanded} disabled={pending}>{pending ? copy.searching : expanded ? copy.closeContext : copy.context}</Button>
    </div>
  </div>;
}
