/**
 * The admin guide's pieces (wiki AUN-ADMIN-HELP), server-rendered: one frosted-glass card per
 * setting with its whole entry, buttons in the card footer at the end edge (owner rule for info
 * pages), and the "not legal advice" note.
 */
import Link from 'next/link';
import { getI18n } from '@/i18n/server';
import type { LocalizedEntry } from '@/lib/help/content';

const term = 'text-sm font-semibold text-fg';

export async function HelpEntryCard({ entry, settingHref }: { entry: LocalizedEntry; settingHref: string }) {
  const { t } = await getI18n();
  const titleId = `${entry.anchor}-title`;
  return (
    <section
      id={entry.anchor}
      aria-labelledby={titleId}
      className="aun-glass aun-card-pad scroll-mt-24 rounded-[var(--aun-radius-card)] target:outline target:outline-2 target:outline-offset-4 target:outline-[var(--fanous-color-primary)]"
      data-testid="help-entry"
      data-help-id={entry.id}
    >
      <h2 id={titleId} className="text-xl font-semibold text-fg">
        {entry.label}
      </h2>
      <p className="mt-1 text-fg">{entry.summary}</p>

      <dl className="mt-4 space-y-4">
        <div>
          <dt className={term}>{t('adminHelp.whatItIs')}</dt>
          <dd className="mt-1 text-sm text-fg">{entry.what}</dd>
        </div>
        <div>
          <dt className={term}>{t('adminHelp.whatChanges')}</dt>
          <dd className="mt-1 text-sm text-fg">{entry.changes}</dd>
        </div>
        {entry.options.length > 0 && (
          <div>
            <dt className={term}>{t('adminHelp.options')}</dt>
            <dd className="mt-1">
              <ul className="space-y-2" data-testid="help-entry-options">
                {entry.options.map((o) => (
                  <li key={o.value} className="text-sm text-fg">
                    <span className="font-medium">{o.label}</span>
                    {o.default && (
                      <span className="ms-2 rounded-full border border-border px-2 py-0.5 text-xs text-fg-muted" data-testid="help-entry-default">
                        {t('adminHelp.defaultTag')}
                      </span>
                    )}
                    <span className="block text-fg-muted">{o.text}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        {entry.default && (
          <div>
            <dt className={term}>{t('adminHelp.defaultValue')}</dt>
            <dd className="mt-1 text-sm text-fg">{entry.default}</dd>
          </div>
        )}
        {entry.range && (
          <div>
            <dt className={term}>{t('adminHelp.range')}</dt>
            <dd className="mt-1 text-sm text-fg">{entry.range}</dd>
          </div>
        )}
        {entry.cautions.length > 0 && (
          <div>
            <dt className={term}>{t('adminHelp.cautions')}</dt>
            <dd className="mt-1">
              <ul className="list-disc space-y-1 ps-5 text-sm text-fg">
                {entry.cautions.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        {entry.rules.length > 0 && (
          <div>
            <dt className={term}>{t('adminHelp.rules')}</dt>
            <dd className="mt-1">
              <ul className="list-disc space-y-1 ps-5 text-sm text-fg" data-testid="help-entry-rules">
                {entry.rules.map((r) => (
                  <li key={r.text}>
                    {r.text}
                    {r.source && (
                      <>
                        {' '}
                        <a href={r.source} target="_blank" rel="noopener noreferrer" className="text-link underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded">
                          {t('adminHelp.source')}
                        </a>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        {entry.approval && <p className="text-sm text-fg-muted">{t('adminHelp.approval')}</p>}
      </dl>
      <div className="aun-actions">
        <Link href={settingHref} className="aun-btn aun-btn-tonal" data-testid="help-entry-go">
          {t('adminHelp.goToSetting')}
        </Link>
      </div>
    </section>
  );
}

export async function HelpFooterNote() {
  const { t } = await getI18n();
  return (
    <p className="mt-8 text-sm text-fg-muted" data-testid="help-not-legal-advice">
      {t('adminHelp.notLegalAdvice')}
    </p>
  );
}
