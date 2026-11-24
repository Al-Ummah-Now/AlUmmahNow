'use client';

import { useId } from 'react';
import { Icon } from '@/components/shell/icons';
import { useLanguage } from '@/i18n/I18nProvider';
import { cardClass } from '@/components/ui';
import type { AgeRulesView } from '@/lib/api/ageRules';

const LABELS = { birthDate: 'ageRules.checkBirthDate', numbers: 'ageRules.checkNumbers', accountEvents: 'ageRules.checkAccountEvents' } as const;

/** What must be true before the switch can be turned on; a check that fails says why, in words, not color alone. */
export function AgeRulesChecks({ checks, switchOn }: { checks: AgeRulesView['checks']; switchOn: boolean }) {
  const { t, locale } = useLanguage();
  const ids = useId();
  const ready = checks.every((check) => check.ok);
  return (
    <section className={`${cardClass} mb-6`} aria-labelledby={`${ids}-title`} data-testid="age-rules-checks" data-ready={ready} data-switch={switchOn ? 'on' : 'off'}>
      <h2 id={`${ids}-title`} className="text-lg font-semibold text-fg mb-1">{t('ageRules.statusTitle')}</h2>
      <p className="text-sm text-fg-muted mb-4">{t(switchOn ? 'ageRules.statusOn' : ready ? 'ageRules.statusReady' : 'ageRules.statusNotReady')}</p>
      <ul className="space-y-3">
        {checks.map((check) => {
          return (
            <li key={check.key} className="flex items-start gap-3 text-sm" data-testid={`age-rules-check-${check.key}`} data-ok={check.ok}>
              <Icon name={check.ok ? 'check' : 'alert'} className={`mt-0.5 h-5 w-5 shrink-0 ${check.ok ? 'text-success-fg' : 'text-danger-fg'}`} />
              <span>
                <span className="block text-fg font-medium">
                  {t(LABELS[check.key])}
                  <span className="sr-only">: {t(check.ok ? 'ageRules.checkPassed' : 'ageRules.checkFailed')}</span>
                </span>
                {!check.ok && <span className="block text-fg-muted">{check.reason[locale === 'ar' ? 'ar' : 'en']}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
