/**
 * Environment for the admin-web E2E suite. Defaults target QA; every value
 * can be overridden through environment variables. Passwords are never
 * committed: QA_SEED_PASSWORD must come from the environment (CI secret or a
 * local `export QA_SEED_PASSWORD=...`).
 */
import path from 'node:path';

export const ADMIN_WEB_URL = (process.env.ADMIN_WEB_URL || 'https://admin.qa.alummahnow.net').replace(/\/$/, '');
export const ADMIN_API_URL = (process.env.ADMIN_API_URL || 'https://admin.api.qa.alummahnow.net').replace(/\/$/, '');
export const VIDEOS_API_URL = (process.env.VIDEOS_API_URL || 'https://videos.api.qa.alummahnow.net').replace(/\/$/, '');
export const OPENAUTH_URL = (process.env.OPENAUTH_URL || 'https://auth.qa.alummahnow.net').replace(/\/$/, '');
export const ADMIN_CLIENT_ID = process.env.ADMIN_OPENAUTH_CLIENT_ID || 'b24e39de-601d-463b-b50d-37a0a94e986b';
export const CALLBACK_URL = `${ADMIN_WEB_URL}/api/callback`;

export interface Account {
  role: 'admin' | 'moderator' | 'nonadmin';
  email: string;
  password: string;
}

function seedPassword(): string {
  const value = process.env.QA_SEED_PASSWORD;
  if (!value) {
    throw new Error('QA_SEED_PASSWORD is not set. Export it (see docs/testing/ADMIN-UI-TEST-PLAN.md) before running the admin suite.');
  }
  return value;
}

export const accounts = {
  get admin(): Account {
    return { role: 'admin', email: process.env.QA_ADMIN_EMAIL || 'qa-admin@delivered.resend.dev', password: seedPassword() };
  },
  get moderator(): Account {
    return {
      role: 'moderator',
      email: process.env.QA_MODERATOR_EMAIL || 'qa-moderator@delivered.resend.dev',
      password: seedPassword(),
    };
  },
  get nonadmin(): Account {
    // Throwaway QA account without any admin role; it also files the test reports.
    return {
      role: 'nonadmin',
      email: process.env.QA_NONADMIN_EMAIL || 'test-none-1794007739628@delivered.resend.dev',
      password: process.env.QA_NONADMIN_PASSWORD || 'TestPassword789!',
    };
  },
};

export const AUTH_DIR = path.join(__dirname, '..', '.auth');
export const storageStatePath = (role: Account['role']) => path.join(AUTH_DIR, `${role}.json`);
export const TOKENS_PATH = path.join(AUTH_DIR, 'tokens.json');

/** Prefix for every entity id the suite reports, so leftovers can be found and closed. */
export const E2E_ENTITY_PREFIX = 'e2e-admin-';
export const E2E_DESCRIPTION_TAG = '[e2e-admin]';
