'use client';
/** Help search: the shared Autocomplete over every Help topic and section, in the page's language
 * (the other language's headings match too). Picking one opens it. */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { HELP_AR, HELP_EN } from '@al-ummah/shared-types';
import { Autocomplete, type AutocompleteOption } from '@/components/ui/Autocomplete';
import { useLanguage } from '@/hooks/useLanguage';
import { helpHref, helpSearchEntries } from '@/lib/help/content';

export function HelpSearch() {
  const { t, lang } = useLanguage();
  const router = useRouter();
  const [value, setValue] = useState('');
  const options = useMemo<AutocompleteOption[]>(() => {
    const other = lang === 'ar' ? HELP_EN : HELP_AR;
    return helpSearchEntries(t.help, other).map((entry) => ({
      id: entry.id,
      label: entry.label,
      subtitle: entry.subtitle,
      keywords: entry.keywords,
      value: entry,
    }));
  }, [t.help, lang]);
  const topics = useMemo(() => options.filter((o) => !o.id.includes('#')), [options]);

  return (
    <div className="hp-search" data-testid="help-search">
      <label htmlFor="help-search-input" className="hp-search-label">{t.help.searchLabel}</label>
      <div className="hp-search-box">
        <Search className="hp-search-icon" aria-hidden="true" />
        <Autocomplete
          inputId="help-search-input"
          testId="help-search-input"
          inputClassName="hp-search-input"
          inputProps={{ placeholder: t.help.searchPlaceholder, type: 'search' }}
          value={value}
          onValueChange={setValue}
          options={options}
          emptyOptions={topics}
          emptyText={t.help.searchEmpty}
          maxOptions={8}
          onSelect={(option) => {
            const entry = option.value as { topic: Parameters<typeof helpHref>[1]; section?: string };
            setValue('');
            router.push(helpHref(lang, entry.topic, entry.section));
          }}
        />
      </div>
    </div>
  );
}
