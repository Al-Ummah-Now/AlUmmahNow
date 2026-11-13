/**
 * First-run guides the signed-in viewer has seen, kept on their account
 * (GET/PUT /api/profile/onboarding; api-videos lib/onboarding.ts).
 */
import { getApiUrl } from '@/lib/runtime-config';
import { getClientAuthHeaders } from '@/lib/auth/client-token';
import { logger } from '@/lib/logger-client';

export interface OnboardingState {
  identityTour: number;
}

async function request(method: 'GET' | 'PUT', body?: OnboardingState): Promise<OnboardingState | null> {
  try {
    const headers: Record<string, string> = { ...(await getClientAuthHeaders()) };
    if (!headers.Authorization) return null;
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${getApiUrl()}/api/profile/onboarding`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) {
      logger.warn('[Onboarding] Request failed', { method, status: response.status });
      return null;
    }
    const data = (await response.json()) as { identityTour?: unknown };
    return typeof data.identityTour === 'number' ? { identityTour: data.identityTour } : null;
  } catch (error) {
    logger.warn('[Onboarding] Request error', { method, error });
    return null;
  }
}

export const fetchOnboarding = (): Promise<OnboardingState | null> => request('GET');
export const markIdentityTourSeen = (version: number): Promise<OnboardingState | null> => request('PUT', { identityTour: version });
