/**
 * Contact us page (/[locale]/contact), en/ar. Shared by the web static
 * fallback and the api-videos translation seed, like i18n-community-guidelines.ts.
 * Placeholders in braces ({min}, {max}, {count}, {email}) are filled by the page.
 */

export type ContactTopicKey = 'general' | 'account' | 'problem' | 'content' | 'partnership';

export interface ContactTranslations {
  navLabel: string;
  title: string;
  lead: string;
  settingsTitle: string;
  settingsDescription: string;
  formLabel: string;
  fields: {
    name: string;
    email: string;
    emailHint: string;
    emailLocked: string;
    topic: string;
    message: string;
    messageHint: string;
    page: string;
    pageHint: string;
    pageRemove: string;
    counter: string;
  };
  topics: Record<ContactTopicKey, { label: string; hint: string }>;
  submit: string;
  sending: string;
  errors: {
    summary: string;
    nameRequired: string;
    nameTooLong: string;
    emailRequired: string;
    emailInvalid: string;
    emailTooLong: string;
    topicRequired: string;
    messageRequired: string;
    messageTooShort: string;
    messageTooLong: string;
    rateLimited: string;
    network: string;
    generic: string;
  };
  success: {
    title: string;
    body: string;
    another: string;
    home: string;
  };
  aside: {
    title: string;
    reply: string;
    privacy: string;
    guidelines: string;
  };
}

export const CONTACT_EN: ContactTranslations = {
  navLabel: 'Contact us',
  title: 'Contact us',
  lead: 'Questions, problems or ideas: write to us and a member of the team will reply by email.',
  settingsTitle: 'Contact us',
  settingsDescription: 'Get help with your account, report a problem or send us feedback',
  formLabel: 'Contact form',
  fields: {
    name: 'Your name',
    email: 'Email',
    emailHint: 'We reply to this address.',
    emailLocked: 'Your account email. We reply to this address.',
    topic: 'Topic',
    message: 'Message',
    messageHint: 'At least {min} characters. Include links or steps if something went wrong.',
    page: 'Page',
    pageHint: 'The page you were on is sent with your message.',
    pageRemove: 'Don’t send the page',
    counter: '{count} of {max}',
  },
  topics: {
    general: { label: 'General', hint: 'Questions and feedback' },
    account: { label: 'Account & sign-in', hint: 'Signing in, your profile and data' },
    problem: { label: 'Report a problem', hint: 'Something isn’t working' },
    content: { label: 'Content & copyright', hint: 'Rights, takedowns and corrections' },
    partnership: { label: 'Partnership', hint: 'Channels, organisations and press' },
  },
  submit: 'Send message',
  sending: 'Sending…',
  errors: {
    summary: 'Please check the highlighted fields.',
    nameRequired: 'Enter your name.',
    nameTooLong: 'Use at most {max} characters.',
    emailRequired: 'Enter your email address.',
    emailInvalid: 'Enter an email address like name@example.com.',
    emailTooLong: 'Use at most {max} characters.',
    topicRequired: 'Choose a topic.',
    messageRequired: 'Write your message.',
    messageTooShort: 'Write at least {min} characters.',
    messageTooLong: 'Use at most {max} characters.',
    rateLimited: 'You have sent several messages in a short time. Please try again in an hour.',
    network: 'We couldn’t reach the server. Check your connection and try again.',
    generic: 'Your message wasn’t sent. Please try again.',
  },
  success: {
    title: 'Message sent',
    body: 'Thank you. We’ve sent a confirmation to {email} and will reply there.',
    another: 'Send another message',
    home: 'Back to home',
  },
  aside: {
    title: 'Before you write',
    reply: 'We usually reply within two working days, in the language you write in.',
    privacy: 'We use your name and email only to answer this message.',
    guidelines: 'Read the community guidelines',
  },
};

export const CONTACT_AR: ContactTranslations = {
  navLabel: 'اتصل بنا',
  title: 'اتصل بنا',
  lead: 'لديك سؤال أو مشكلة أو فكرة؟ اكتب لنا وسيرد عليك أحد أعضاء الفريق عبر البريد الإلكتروني.',
  settingsTitle: 'اتصل بنا',
  settingsDescription: 'احصل على مساعدة في حسابك أو أبلغ عن مشكلة أو أرسل إلينا ملاحظاتك',
  formLabel: 'نموذج التواصل',
  fields: {
    name: 'اسمك',
    email: 'البريد الإلكتروني',
    emailHint: 'سنرد على هذا العنوان.',
    emailLocked: 'بريد حسابك. سنرد على هذا العنوان.',
    topic: 'الموضوع',
    message: 'الرسالة',
    messageHint: 'اكتب {min} أحرف على الأقل. أضف الروابط أو الخطوات إن كان هناك خلل.',
    page: 'الصفحة',
    pageHint: 'نرسل مع رسالتك رابط الصفحة التي كنت فيها.',
    pageRemove: 'لا ترسل الصفحة',
    counter: '{count} من {max}',
  },
  topics: {
    general: { label: 'استفسار عام', hint: 'أسئلة وملاحظات' },
    account: { label: 'الحساب وتسجيل الدخول', hint: 'تسجيل الدخول وملفك الشخصي وبياناتك' },
    problem: { label: 'الإبلاغ عن مشكلة', hint: 'شيء لا يعمل كما ينبغي' },
    content: { label: 'المحتوى وحقوق النشر', hint: 'الحقوق وطلبات الإزالة والتصحيحات' },
    partnership: { label: 'الشراكات', hint: 'القنوات والمؤسسات والصحافة' },
  },
  submit: 'إرسال الرسالة',
  sending: 'جارٍ الإرسال…',
  errors: {
    summary: 'يرجى مراجعة الحقول المحددة.',
    nameRequired: 'اكتب اسمك.',
    nameTooLong: 'استخدم {max} حرفًا على الأكثر.',
    emailRequired: 'اكتب بريدك الإلكتروني.',
    emailInvalid: 'اكتب بريدًا إلكترونيًا صحيحًا مثل name@example.com.',
    emailTooLong: 'استخدم {max} حرفًا على الأكثر.',
    topicRequired: 'اختر موضوعًا.',
    messageRequired: 'اكتب رسالتك.',
    messageTooShort: 'اكتب {min} أحرف على الأقل.',
    messageTooLong: 'استخدم {max} حرفًا على الأكثر.',
    rateLimited: 'أرسلت عدة رسائل في وقت قصير. يرجى المحاولة مرة أخرى بعد ساعة.',
    network: 'تعذّر الاتصال بالخادم. تحقق من اتصالك وحاول مرة أخرى.',
    generic: 'لم تُرسل رسالتك. يرجى المحاولة مرة أخرى.',
  },
  success: {
    title: 'أُرسلت رسالتك',
    body: 'شكرًا لك. أرسلنا تأكيدًا إلى {email} وسنرد عليك هناك.',
    another: 'إرسال رسالة أخرى',
    home: 'العودة إلى الرئيسية',
  },
  aside: {
    title: 'قبل أن تكتب',
    reply: 'نرد عادةً خلال يومي عمل، باللغة التي تكتب بها.',
    privacy: 'نستخدم اسمك وبريدك فقط للرد على هذه الرسالة.',
    guidelines: 'اقرأ إرشادات المجتمع',
  },
};
