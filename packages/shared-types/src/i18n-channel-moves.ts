/**
 * Channel moves by owners (wiki AUN-CHANNEL-CLAIM §5): Move channel in the channel's settings, the
 * offer page and my offers. Refusals use the error catalogue (api-error.ts). `{name}`-style values
 * that are names are put in bidi isolates by the pages.
 */
import type { PluralTexts } from './i18n-library';

export interface ChannelMovesTranslations {
  /** Channel settings card and page */
  title: string;
  description: string;
  loading: string;
  loadFailed: string;
  happens: { title: string; everything: string; access: string; live: string; once: string };
  /** The fresh sign-in, asked before anything else */
  signIn: { title: string; text: string; button: string };
  /** Signed in, but not the channel's owner */
  notYours: { title: string; text: string; signedInAs: string; button: string; backToChannel: string };
  form: {
    receiver: string;
    receiverHelp: string;
    receiverPlaceholder: string;
    noAdmins: string;
    noMatches: string;
    openTeam: string;
    change: string;
    keepContactEmail: string;
    keepContactEmailHelp: string;
    confirm: string;
    send: string;
    sending: string;
    sent: string;
  };
  movableAt: string;
  open: { title: string; text: string; starting: string };
  withdraw: string;
  withdrawTitle: string;
  withdrawText: string;
  withdrawn: string;
  /** Offer page and list */
  offers: { title: string; description: string; received: string; sent: string; none: string; view: string; more: string; someone: string; channel: string };
  receivedText: string;
  sentText: string;
  becomes: string;
  keepsEmail: string;
  expiresIn: PluralTexts;
  expiresToday: string;
  accept: string;
  accepting: string;
  acceptTitle: string;
  acceptText: string;
  accepted: string;
  decline: string;
  declined: string;
  openChannel: string;
  /** What became of an offer, by status; `to`: read by its receiver, `from`: by anyone else */
  closed: Record<'accepting' | 'moved' | 'declined' | 'cancelled' | 'expired' | 'stopped' | 'refused', { to: string; from: string }>;
}

export const CHANNEL_MOVES_EN: ChannelMovesTranslations = {
  title: 'Move channel',
  description: 'Hand this channel over to one of its admins.',
  loading: 'Loading…',
  loadFailed: 'This couldn’t be loaded. Try again.',
  happens: {
    title: 'What happens when they accept',
    everything: 'They become the owner of the channel, its videos (private ones too), playlists and posts.',
    access: 'You lose access to the channel. The new owner can add you to its team again.',
    live: 'Live stream keys are replaced.',
    once: 'The channel can’t be moved by its owner again for {days} days.',
  },
  signIn: {
    title: 'Sign in again first',
    text: 'Moving a channel needs a recent sign-in. You come straight back here.',
    button: 'Sign in again',
  },
  notYours: {
    title: 'This isn’t your channel',
    text: 'Only the channel’s owner can move it. Nothing has changed.',
    signedInAs: 'You’re signed in as {name}.',
    button: 'Sign in with another account',
    backToChannel: 'Back to the channel',
  },
  form: {
    receiver: 'New owner',
    receiverHelp: 'One of this channel’s admins.',
    receiverPlaceholder: 'Search by name',
    noAdmins: 'This channel has no admins yet. Make someone a channel admin on the Team page first.',
    noMatches: 'No admin matches.',
    openTeam: 'Open Team',
    change: 'Choose someone else',
    keepContactEmail: 'Keep the public contact email',
    keepContactEmailHelp: 'Otherwise it is cleared when the channel moves.',
    confirm: 'Type {handle} to confirm',
    send: 'Send offer',
    sending: 'Sending…',
    sent: 'Offer sent. The channel stays yours until they accept.',
  },
  movableAt: 'This channel was moved recently. You can move it again from {date}.',
  open: {
    title: 'Offered to {person}',
    text: 'The channel stays yours until they accept.',
    starting: 'They accepted. The move is starting.',
  },
  withdraw: 'Withdraw offer',
  withdrawTitle: 'Withdraw this offer?',
  withdrawText: 'It can no longer be accepted.',
  withdrawn: 'Offer withdrawn.',
  offers: {
    title: 'Channel offers',
    description: 'Channels offered to you, and offers you made.',
    received: 'Offered to you',
    sent: 'Your offers',
    none: 'There are no open offers.',
    view: 'View offer',
    more: 'Show more offers',
    someone: 'Someone',
    channel: 'A channel',
  },
  receivedText: '{person} wants to hand this channel over to you.',
  sentText: 'You offered this channel to {person}.',
  becomes: 'If you accept, you become the owner of the channel, its videos, playlists and posts.',
  keepsEmail: 'Its public contact email stays.',
  expiresIn: { one: 'Expires in {count} day', other: 'Expires in {count} days' },
  expiresToday: 'Expires today',
  accept: 'Accept',
  accepting: 'Accepting…',
  acceptTitle: 'Become the owner of {channel}?',
  acceptText: 'The move starts at once.',
  accepted: 'The move has started. The channel joins your channels in a moment.',
  decline: 'Decline',
  declined: 'Offer declined.',
  openChannel: 'Open the channel',
  closed: {
    accepting: { to: 'The move is starting.', from: 'The offer was accepted. The move is starting.' },
    moved: { to: 'You accepted this offer. The channel is yours.', from: 'The offer was accepted, and the channel moved.' },
    declined: { to: 'You declined this offer.', from: 'The offer was declined.' },
    cancelled: { to: 'This offer was withdrawn.', from: 'The offer was withdrawn.' },
    expired: { to: 'This offer has expired.', from: 'The offer expired without an answer.' },
    stopped: { to: 'The Al Ummah Now team stopped this offer.', from: 'The Al Ummah Now team stopped this offer.' },
    refused: { to: 'This offer can no longer be accepted.', from: 'This offer could no longer be accepted.' },
  },
};

export const CHANNEL_MOVES_AR: ChannelMovesTranslations = {
  title: 'نقل القناة',
  description: 'سلّم هذه القناة إلى أحد مشرفيها.',
  loading: 'جارٍ التحميل…',
  loadFailed: 'تعذّر التحميل. حاول مرة أخرى.',
  happens: {
    title: 'ما يحدث عند القبول',
    everything: 'تنتقل إلى المالك الجديد ملكية القناة ومرئياتها، حتى الخاصة، وقوائم تشغيلها ومنشوراتها.',
    access: 'تفقد الوصول إلى القناة. يستطيع المالك الجديد إضافتك إلى فريقها من جديد.',
    live: 'تُستبدل مفاتيح البث المباشر.',
    once: 'لا يستطيع المالك نقل القناة مرة أخرى قبل {days} يومًا.',
  },
  signIn: {
    title: 'سجّل الدخول مرة أخرى أولًا',
    text: 'يحتاج نقل القناة إلى تسجيل دخول حديث. ستعود إلى هنا مباشرةً.',
    button: 'تسجيل الدخول مرة أخرى',
  },
  notYours: {
    title: 'هذه ليست قناتك',
    text: 'لا ينقل القناة إلا مالكها. لم يتغيّر شيء.',
    signedInAs: 'سجّلت الدخول باسم {name}.',
    button: 'تسجيل الدخول بحساب آخر',
    backToChannel: 'العودة إلى القناة',
  },
  form: {
    receiver: 'المالك الجديد',
    receiverHelp: 'أحد مشرفي هذه القناة.',
    receiverPlaceholder: 'ابحث بالاسم',
    noAdmins: 'ليس لهذه القناة مشرفون بعد. عيّن مشرفًا للقناة من صفحة الفريق أولًا.',
    noMatches: 'لا يوجد مشرف مطابق.',
    openTeam: 'فتح صفحة الفريق',
    change: 'اختيار شخص آخر',
    keepContactEmail: 'إبقاء بريد التواصل العام',
    keepContactEmailHelp: 'وإلا فسيُمسح عند نقل القناة.',
    confirm: 'اكتب {handle} للتأكيد',
    send: 'إرسال العرض',
    sending: 'جارٍ الإرسال…',
    sent: 'أُرسل العرض. تبقى القناة لك حتى يُقبل.',
  },
  movableAt: 'نُقلت هذه القناة مؤخرًا. يمكنك نقلها مرة أخرى ابتداءً من {date}.',
  open: {
    title: 'عُرضت القناة على {person}',
    text: 'تبقى القناة لك حتى يُقبل العرض.',
    starting: 'قُبل العرض، وبدأ النقل.',
  },
  withdraw: 'سحب العرض',
  withdrawTitle: 'هل تريد سحب هذا العرض؟',
  withdrawText: 'لن يعود قبول العرض ممكنًا.',
  withdrawn: 'سُحب العرض.',
  offers: {
    title: 'عروض القنوات',
    description: 'القنوات المعروضة عليك، والعروض التي قدّمتها.',
    received: 'معروضة عليك',
    sent: 'عروضك',
    none: 'لا توجد عروض مفتوحة.',
    view: 'عرض التفاصيل',
    more: 'عرض مزيد من العروض',
    someone: 'أحد الأشخاص',
    channel: 'قناة',
  },
  receivedText: 'وصلك عرض من {person} لنقل هذه القناة إليك.',
  sentText: 'قدّمت عرضًا لنقل هذه القناة إلى {person}.',
  becomes: 'إذا قبلت، انتقلت إليك ملكية القناة ومرئياتها وقوائم تشغيلها ومنشوراتها.',
  keepsEmail: 'يبقى بريد التواصل العام كما هو.',
  expiresIn: { one: 'ينتهي بعد يوم', two: 'ينتهي بعد يومين', few: 'ينتهي بعد {count} أيام', many: 'ينتهي بعد {count} يومًا', other: 'ينتهي بعد {count} يوم' },
  expiresToday: 'ينتهي اليوم',
  accept: 'قبول',
  accepting: 'جارٍ القبول…',
  acceptTitle: 'هل تريد تسلّم ملكية {channel}؟',
  acceptText: 'يبدأ النقل فورًا.',
  accepted: 'بدأ النقل. ستظهر القناة ضمن قنواتك بعد لحظات.',
  decline: 'رفض',
  declined: 'رُفض العرض.',
  openChannel: 'فتح القناة',
  closed: {
    accepting: { to: 'بدأ النقل.', from: 'قُبل العرض، وبدأ النقل.' },
    moved: { to: 'قبلت هذا العرض، وأصبحت القناة لك.', from: 'قُبل العرض، ونُقلت القناة.' },
    declined: { to: 'رفضت هذا العرض.', from: 'رُفض العرض.' },
    cancelled: { to: 'سُحب هذا العرض.', from: 'سُحب العرض.' },
    expired: { to: 'انتهت مدة هذا العرض.', from: 'انتهت مدة العرض دون رد.' },
    stopped: { to: 'أوقف فريق الأمة الآن هذا العرض.', from: 'أوقف فريق الأمة الآن هذا العرض.' },
    refused: { to: 'لم يعد قبول هذا العرض ممكنًا.', from: 'لم يعد قبول هذا العرض ممكنًا.' },
  },
};
