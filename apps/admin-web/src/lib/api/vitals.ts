/**
 * Field Core Web Vitals (admin-api GET /api/vitals/summary, ops:read): sampled p75 LCP, CLS and INP
 * of the videos site from Analytics Engine (docs/operations/rum.md). Server components only.
 */
import { fetchAdmin } from './request';

export type VitalsEnv = 'production' | 'stage' | 'qa';
export const VITALS_ENVS: VitalsEnv[] = ['production', 'stage', 'qa'];
export const VITALS_METRICS = ['LCP', 'CLS', 'INP'] as const;
export type VitalsMetric = (typeof VITALS_METRICS)[number];
export const VITALS_DAYS = [1, 7, 28] as const;
export const VITALS_LOCALES = ['all', 'en', 'ar'] as const;
export type VitalsLocale = (typeof VITALS_LOCALES)[number];
export type VitalsRating = 'good' | 'needs_improvement' | 'poor';
/** The page kinds and devices apps/web reports (lib/rum); others are shown as sent */
export const VITALS_KINDS = ['home', 'watch', 'short', 'channel', 'playlist', 'search', 'explore', 'feed', 'studio', 'other'] as const;
export const VITALS_DEVICES = ['phone', 'tablet', 'desktop'] as const;

export interface VitalsValue {
  p75: number;
  samples: number;
  rating: VitalsRating;
  few: boolean;
}

export interface VitalsSummary {
  env: VitalsEnv;
  days: number;
  locale: VitalsLocale;
  generatedAt: string;
  overall: Partial<Record<VitalsMetric, VitalsValue>>;
  rows: { kind: string; device: string; metrics: Partial<Record<VitalsMetric, VitalsValue>> }[];
}

export async function getVitalsSummary(env: VitalsEnv, days: number, locale: VitalsLocale): Promise<VitalsSummary> {
  return fetchAdmin<VitalsSummary>(`/api/vitals/summary?env=${env}&days=${days}&locale=${locale}`);
}

/** LCP and INP in seconds / milliseconds, CLS unitless with 2 decimals, in the reader's digits */
export function formatVital(metric: VitalsMetric, p75: number, locale: string): string {
  if (metric === 'CLS') return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(p75);
  if (metric === 'LCP') return new Intl.NumberFormat(locale, { style: 'unit', unit: 'second', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(p75 / 1000);
  return new Intl.NumberFormat(locale, { style: 'unit', unit: 'millisecond', maximumFractionDigits: 0 }).format(p75);
}
