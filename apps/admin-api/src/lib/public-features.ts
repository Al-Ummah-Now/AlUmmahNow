/**
 * GET /public/features: which optional public-site features can work right now, for the www
 * server (AlUmmahNowUI apps/www src/lib/features.ts). A feature that can't work is left out of the
 * sites entirely: no footer section, no page (404), no "not working right now" text.
 *
 *   newsletter: the sign-up form can deliver its confirmation email: the Resend key is bound, the
 *               mail queue is bound, and www has the internal key to reach /internal/newsletter.
 *
 *               And the Features page's newsletter switch is on (FEAT-4, wiki AUN-FEATURES §5.3).
 *
 * Booleans only, nothing secret. When a feature is off, its /internal routes answer
 * 404 { success: false, code: 'feature_off' } (unsubscribe always keeps working).
 */
import type { Context } from 'hono';
import { readFeatureSwitches } from '@al-ummah/shared-types';
import type { AdminBindings } from '../base/types';

export interface PublicFeatures {
  newsletter: boolean;
}

type SecretBinding = string | { get(): Promise<string> } | undefined;

async function hasSecret(binding: SecretBinding): Promise<boolean> {
  if (typeof binding === 'string') return binding.length > 0;
  try {
    return !!(await binding?.get());
  } catch {
    return false;
  }
}

export type FeaturesEnv = Pick<AdminBindings, 'RESEND_API_KEY' | 'INTERNAL_API_KEY' | 'CONTACT_MAIL_QUEUE'> & {
  SEARCH_DB?: unknown;
  FEATURES_FORCE_OFF?: string;
};

/** The newsletter can send: the Resend key, the mail queue and the internal key are bound. */
export async function newsletterConfigured(env: FeaturesEnv): Promise<boolean> {
  if (!env.CONTACT_MAIL_QUEUE) return false;
  const [resend, internal] = await Promise.all([hasSecret(env.RESEND_API_KEY), hasSecret(env.INTERNAL_API_KEY)]);
  return resend && internal;
}

/** Configured and switched on (an unreadable switch table keeps the default: on). */
export async function newsletterAvailable(env: FeaturesEnv): Promise<boolean> {
  const [configured, switches] = await Promise.all([
    newsletterConfigured(env),
    readFeatureSwitches(env).catch(() => null),
  ]);
  return configured && (switches ? switches.effective.newsletter : true);
}

export async function publicFeatures(env: FeaturesEnv): Promise<PublicFeatures> {
  return { newsletter: await newsletterAvailable(env) };
}

export const FEATURE_OFF = { success: false, code: 'feature_off' } as const;

/** The GET /public/features handler (src/index.ts): short-lived at the edge, like /public/site-theme. */
export async function publicFeaturesRoute(c: Context): Promise<Response> {
  return c.json(await publicFeatures(c.env as FeaturesEnv), 200, { 'Cache-Control': 'public, max-age=30' });
}
