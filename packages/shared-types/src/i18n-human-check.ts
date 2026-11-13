/**
 * Bot protection messages (Cloudflare Turnstile and rate limits), en/ar. Shared by
 * the web static fallback and the api-videos translation seed, like i18n-contact.ts.
 * See docs/features/bot-protection.md.
 */

export interface HumanCheckTranslations {
  /** Status line while the (usually invisible) check runs */
  checking: string;
  /** Label of the box Cloudflare shows when it needs a click */
  dialogLabel: string;
  /** The check could not run or did not pass */
  failed: string;
  /** 429 rate_limited from the API */
  rateLimited: string;
}

export const HUMAN_CHECK_EN: HumanCheckTranslations = {
  checking: 'Checking that you are not a robot…',
  dialogLabel: 'Confirm that you are not a robot',
  failed: 'We could not confirm that you are not a robot. Please try again.',
  rateLimited: 'You are doing that too often. Please wait a minute and try again.',
};

export const HUMAN_CHECK_AR: HumanCheckTranslations = {
  checking: 'جارٍ التحقق من أنك لست روبوتًا…',
  dialogLabel: 'أكّد أنك لست روبوتًا',
  failed: 'تعذّر التأكد من أنك لست روبوتًا. يُرجى المحاولة مرة أخرى.',
  rateLimited: 'تكرّر هذا الإجراء كثيرًا. يُرجى الانتظار دقيقة ثم المحاولة مرة أخرى.',
};
