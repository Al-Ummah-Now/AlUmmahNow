'use client';

/**
 * Privacy & data settings (Story 1.3, AC 2, 3, 4, 5): consent management,
 * data export, on-device data, data erasure and the link to the auth service's
 * account settings. Shared by the LTR and RTL variants.
 */

import React, { useEffect, useState } from 'react';
import { Download, ExternalLink, Shield, Smartphone, Trash2, Clock } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { ConsentManager, type ConsentChoices } from '@/lib/consent/ConsentManager';
import { ConsentPreferences } from '@/components/consent/ConsentPreferences';
import { PrivacyService, downloadBlob } from '@/services/api/privacy.service';
import { clearLocalPersonalData } from '@/lib/privacy/local-data';
import { getAuthProfileUrl } from '@/lib/runtime-config';
import { logger } from '@/lib/logger-client';

export interface PrivacySettingsViewProps {
  dir: 'ltr' | 'rtl';
  /** Whether a user is signed in (export / erase need an account). */
  signedIn: boolean;
}

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; message: string } | { kind: 'error'; message: string };

const NONE: ConsentChoices = { analytics: false, experiments: false, performance: false };

const card = 'rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800';
const heading = 'flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-100';
const body = 'mt-1 text-sm text-gray-600 dark:text-gray-400';
const primaryButton =
  'inline-flex items-center gap-2 rounded-md bg-[#ffa037] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ff8c00] disabled:opacity-50';
const secondaryButton =
  'inline-flex items-center gap-2 rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700';

function StatusLine({ status }: { status: Status }) {
  if (status.kind === 'done') return <p role="status" className="mt-2 text-sm text-green-700 dark:text-green-400">{status.message}</p>;
  if (status.kind === 'error') return <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">{status.message}</p>;
  return null;
}

export function PrivacySettingsView({ dir, signedIn }: PrivacySettingsViewProps) {
  const { t } = useLanguage();
  const p = t.privacy;
  const [choices, setChoices] = useState<ConsentChoices>(NONE);
  const [consentStatus, setConsentStatus] = useState<Status>({ kind: 'idle' });
  const [exportStatus, setExportStatus] = useState<Status>({ kind: 'idle' });
  const [deviceStatus, setDeviceStatus] = useState<Status>({ kind: 'idle' });
  const [deleteStatus, setDeleteStatus] = useState<Status>({ kind: 'idle' });
  const [confirmText, setConfirmText] = useState('');
  const [accountUrl, setAccountUrl] = useState('');

  useEffect(() => {
    const current = ConsentManager.getConsent();
    if (current) setChoices({ analytics: current.analytics, experiments: current.experiments, performance: current.performance });
    setAccountUrl(getAuthProfileUrl());
  }, []);

  const saveConsent = () => {
    ConsentManager.setConsent(choices, 'settings');
    setConsentStatus({ kind: 'done', message: p.consentSaved });
  };

  const exportData = async () => {
    setExportStatus({ kind: 'busy' });
    try {
      const blob = await PrivacyService.exportData();
      downloadBlob(blob, `al-ummah-now-data-${new Date().toISOString().slice(0, 10)}.json`);
      setExportStatus({ kind: 'done', message: p.exportReady });
    } catch (error) {
      logger.warn('[PrivacySettings] Export failed', { error: error instanceof Error ? error.message : String(error) });
      setExportStatus({ kind: 'error', message: p.exportFailed });
    }
  };

  const clearDevice = async () => {
    await clearLocalPersonalData();
    setDeviceStatus({ kind: 'done', message: p.deviceDataCleared });
  };

  const confirmWord = p.deleteConfirmWord;
  const eraseData = async () => {
    if (confirmText.trim() !== confirmWord) return;
    setDeleteStatus({ kind: 'busy' });
    try {
      const result = await PrivacyService.eraseData();
      await clearLocalPersonalData();
      setDeleteStatus(result.complete ? { kind: 'done', message: p.deleteDone } : { kind: 'error', message: p.deleteFailed });
    } catch (error) {
      logger.warn('[PrivacySettings] Erasure failed', { error: error instanceof Error ? error.message : String(error) });
      setDeleteStatus({ kind: 'error', message: p.deleteFailed });
    }
  };

  return (
    <div dir={dir} className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 text-start">
        <header>
          <h1 className="flex items-center gap-3 text-3xl font-bold text-gray-900 dark:text-gray-100">
            <Shield className="h-8 w-8 text-[#ffa037]" aria-hidden="true" />
            {p.settingsTitle}
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">{p.settingsDescription}</p>
        </header>

        <section className={card} aria-labelledby="privacy-consent">
          <h2 id="privacy-consent" className={heading}>{p.consentSectionTitle}</h2>
          <p className={body}>{p.consentSectionDescription}</p>
          <div className="mt-4">
            <ConsentPreferences value={choices} onChange={next => { setChoices(next); setConsentStatus({ kind: 'idle' }); }} idPrefix="settings-consent" />
          </div>
          <div className="mt-4">
            <button type="button" className={primaryButton} onClick={saveConsent}>{p.savePreferences}</button>
          </div>
          <StatusLine status={consentStatus} />
        </section>

        <section className={card} aria-labelledby="privacy-retention">
          <h2 id="privacy-retention" className={heading}><Clock className="h-5 w-5" aria-hidden="true" />{p.retentionTitle}</h2>
          <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-gray-600 dark:text-gray-400">
            <li>{p.retentionWatchHistory}</li>
            <li>{p.retentionAnalytics}</li>
            <li>{p.retentionDevice}</li>
            <li>{p.retentionConsent}</li>
          </ul>
        </section>

        <section className={card} aria-labelledby="privacy-device">
          <h2 id="privacy-device" className={heading}><Smartphone className="h-5 w-5" aria-hidden="true" />{p.deviceDataTitle}</h2>
          <p className={body}>{p.deviceDataDescription}</p>
          <div className="mt-4">
            <button type="button" className={secondaryButton} onClick={clearDevice}>{p.clearDeviceData}</button>
          </div>
          <StatusLine status={deviceStatus} />
        </section>

        {!signedIn && <p className="text-sm text-gray-600 dark:text-gray-400">{p.signInRequired}</p>}

        {signedIn && (
          <>
            <section className={card} aria-labelledby="privacy-export">
              <h2 id="privacy-export" className={heading}><Download className="h-5 w-5" aria-hidden="true" />{p.exportTitle}</h2>
              <p className={body}>{p.exportDescription}</p>
              <div className="mt-4">
                <button type="button" className={primaryButton} onClick={exportData} disabled={exportStatus.kind === 'busy'}>
                  {exportStatus.kind === 'busy' ? p.exporting : p.exportButton}
                </button>
              </div>
              <StatusLine status={exportStatus} />
            </section>

            <section className={`${card} border-red-200 dark:border-red-900`} aria-labelledby="privacy-delete">
              <h2 id="privacy-delete" className={heading}><Trash2 className="h-5 w-5 text-red-600" aria-hidden="true" />{p.deleteTitle}</h2>
              <p className={body}>{p.deleteDescription}</p>
              <label htmlFor="privacy-delete-confirm" className="mt-4 block text-sm font-medium text-gray-900 dark:text-gray-100">
                {p.deleteConfirmLabel.replace('{word}', confirmWord)}
              </label>
              <input
                id="privacy-delete-confirm"
                type="text"
                value={confirmText}
                onChange={event => setConfirmText(event.target.value)}
                autoComplete="off"
                className="mt-1 w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              />
              <div className="mt-4">
                <button
                  type="button"
                  onClick={eraseData}
                  disabled={confirmText.trim() !== confirmWord || deleteStatus.kind === 'busy'}
                  className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {deleteStatus.kind === 'busy' ? p.deleting : p.deleteButton}
                </button>
              </div>
              <StatusLine status={deleteStatus} />
            </section>

            <section className={card} aria-labelledby="privacy-account">
              <h2 id="privacy-account" className={heading}>{p.accountTitle}</h2>
              <p className={body}>{p.accountDescription}</p>
              {accountUrl && (
                <a href={accountUrl} target="_blank" rel="noopener noreferrer" className={`${secondaryButton} mt-4`}>
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  {p.manageAccount}
                </a>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export default PrivacySettingsView;
