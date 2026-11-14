/**
 * The sign-in banner at the top of the videos home page, shown to signed-out
 * visitors only (apps/web SignInBanner), en/ar. Shared by the web static
 * fallback and the api-videos translation seed, like i18n-contact.ts.
 *
 * Tone (wiki "Copy Tone Guide"): subscribe to channels, never "follow" them;
 * Arabic says «مرئي / مرئيات», never «فيديو».
 *
 * Uploading is by request during the beta (creator tiers, requested on /upgrade): the copy
 * offers creating and sharing videos through a creator-access request, never as instant access.
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
    /** Uploading is requested, not granted on sign-in */
    creatorAccess: string;
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
  title: 'Sign in to take part, and request creator access to share your own videos',
  body: 'Comment, like, subscribe to channels and save videos for later. Uploading is by request during the beta: once signed in, request creator access to create and share your own videos.',
  perks: {
    comment: 'Comment',
    like: 'Like',
    subscribe: 'Subscribe',
    save: 'Save',
    creatorAccess: 'Request creator access',
  },
  perksLabel: 'What you can do with an account',
  signIn: 'Sign in',
  dismiss: 'Hide this message',
};

export const SIGN_IN_BANNER_AR: SignInBannerTranslations = {
  regionLabel: 'انضم إلى الأمة الآن',
  eyebrow: 'انضم إلى المجتمع',
  title: 'سجّل الدخول لتشارك، واطلب صلاحية صانع المحتوى لتنشر مرئياتك',
  body: 'علّق وأعجب واشترك في القنوات واحفظ المرئيات لوقت لاحق. الرفع بطلب خلال المرحلة التجريبية: بعد تسجيل الدخول اطلب صلاحية صانع المحتوى لتنشئ مرئياتك وتنشرها.',
  perks: {
    comment: 'تعليق',
    like: 'إعجاب',
    subscribe: 'اشتراك',
    save: 'حفظ',
    creatorAccess: 'اطلب صلاحية صانع المحتوى',
  },
  perksLabel: 'ما يمكنك فعله بالحساب',
  signIn: 'تسجيل الدخول',
  dismiss: 'إخفاء هذه الرسالة',
};
