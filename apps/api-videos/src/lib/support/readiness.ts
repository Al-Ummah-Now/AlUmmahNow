/**
 * `creatorSupport` turn-on precondition (wiki AUN-MEMBERS §9.7). The check itself lives in
 * shared-types (`support-readiness.ts`) so admin-api's Features page (AUN-FEATURES FEAT-4,
 * `FEATURE_PRECONDITIONS`) runs the same code; api-videos re-exports it.
 */
export { SUPPORT_TURN_ON_REASONS, supportCanTurnOn, supportCanTurnOnHook } from '@al-ummah/shared-types';
