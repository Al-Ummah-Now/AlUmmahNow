'use client';

/**
 * Granular consent toggles (Story 1.3, AC 3, 4). Used by the consent banner and
 * the Privacy settings page. "Strictly necessary" is shown but cannot be
 * switched off; every optional category defaults to off.
 */

import React from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import { Switch } from '@/components/common/Switch';
import type { ConsentChoices } from '@/lib/consent/ConsentManager';

interface ConsentPreferencesProps {
  value: ConsentChoices;
  onChange: (next: ConsentChoices) => void;
  idPrefix?: string;
}

export function ConsentPreferences({ value, onChange, idPrefix = 'consent' }: ConsentPreferencesProps) {
  const { t, dir } = useLanguage();
  const p = t.privacy;

  const rows: Array<{ key: keyof ConsentChoices; title: string; description: string }> = [
    { key: 'analytics', title: p.analyticsTitle, description: p.analyticsDescription },
    { key: 'experiments', title: p.experimentsTitle, description: p.experimentsDescription },
    { key: 'performance', title: p.performanceTitle, description: p.performanceDescription },
  ];

  return (
    <ul className="space-y-3" dir={dir}>
      <li className="flex items-start justify-between gap-4 rounded-md border border-gray-200 dark:border-gray-700 p-3">
        <div className="text-start">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{p.necessaryTitle}</p>
          <p className="text-xs text-gray-600 dark:text-gray-400">{p.necessaryDescription}</p>
        </div>
        <span className="shrink-0 text-xs font-medium text-gray-500 dark:text-gray-400">{p.alwaysOn}</span>
      </li>
      {rows.map(row => {
        const id = `${idPrefix}-${row.key}`;
        return (
          <li
            key={row.key}
            className="sw-row rounded-md border border-gray-200 dark:border-gray-700 p-3"
          >
            <label htmlFor={id} className="text-start cursor-pointer">
              <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">{row.title}</span>
              <span className="block text-xs text-gray-600 dark:text-gray-400">{row.description}</span>
            </label>
            <Switch
              id={id}
              checked={value[row.key]}
              onCheckedChange={(next) => onChange({ ...value, [row.key]: next })}
              data-testid={`${idPrefix}-switch-${row.key}`}
            />
          </li>
        );
      })}
    </ul>
  );
}

export default ConsentPreferences;
