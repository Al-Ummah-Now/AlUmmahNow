/**
 * The sign-in banner at the top of the videos home page, shown to signed-out
 * visitors only (apps/web SignInBanner), en/ar. Shared by the web static
 * fallback and the api-videos translation seed, like i18n-contact.ts.
 *
 * Tone (wiki "Copy Tone Guide"): subscribe to channels, never "follow" them;
 * Arabic says «مرئي / مرئيات», never «فيديو».
 *
 * Only what an account unlocks for a viewer: upgrades (creator access) live in the header button
 * and on the Upgrade page after sign-in, never here (owner review of #1359).
 */

export interface SignInBannerTranslations {
  /** Accessible name of the banner's region */
  regionLabel: string;
  /** Small line above the heading */
  eyebrow: string;
  title: string;
  body: string;
  /** What an account unlocks, one short word or two each */
  perks: {
    comment: string;
    like: string;
    subscribe: string;
    save: string;
  };
  /** Accessible name of the perks list */
  perksLabel: string;
  signIn: string;
  /** Accessible name of the close (X) button */
  dismiss: string;
}

export const SIGN_IN_BANNER_EN: SignInBannerTranslations = {
  regionLabel: 'Join Al Ummah Now',
  eyebrow: 'Join the community',
  title: 'Sign in to take part',
  body: 'Comment, like, subscribe to channels and save videos for later.',
  perks: {
    comment: 'Comment',
    like: 'Like',
    subscribe: 'Subscribe',
    save: 'Save',
  },
  perksLabel: 'What you can do with an account',
  signIn: 'Sign in',
  dismiss: 'Hide this message',
};

export const SIGN_IN_BANNER_AR: SignInBannerTranslations = {
  regionLabel: 'انضم إلى الأمة الآن',
  eyebrow: 'انضم إلى المجتمع',
  title: 'سجل حسابك لتشارك',
  body: 'علّق وأعجب واشترك في القنوات واحفظ المرئيات لوقت لاحق.',
  perks: {
    comment: 'تعليق',
    like: 'إعجاب',
    subscribe: 'اشتراك',
    save: 'حفظ',
  },
  perksLabel: 'ما يمكنك فعله بالحساب',
  signIn: 'تسجيل الدخول',
  dismiss: 'إخفاء هذه الرسالة',
};
