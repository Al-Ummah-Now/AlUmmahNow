/**
 * Help and the identity tour (/[locale]/help, docs/features/HELP-AND-TOUR.md), en/ar.
 *
 * Every page is data: a topic has sections, a section has blocks. Inline text may use **bold**
 * and [a link](/path); a link's path is under the page's locale (`/settings/privacy` opens
 * `/{lang}/settings/privacy`). Pictures and clips are named by id; the capture script
 * (apps/web/e2e/help-capture) makes one file per id, language, device and light/dark.
 *
 * Wording rules: names match what is on screen in each language; «مرئي / مرئيات» for video,
 * «المقاطع القصيرة» for Shorts (CLAUDE.md, wiki glossary).
 */

export const HELP_TOPIC_IDS = ['start', 'watching', 'identity', 'creating', 'community', 'privacy', 'appearance'] as const;
export type HelpTopicId = (typeof HELP_TOPIC_IDS)[number];

/** Still pictures made by the capture script, one per language × desktop/phone × light/dark */
export const HELP_PICTURE_IDS = [
  'identity-menu',
  'identity-switch',
  'identity-comment',
  'start-signin',
  'start-profile',
  'watching-actions',
  'watching-library',
  'watching-playlists',
  'creating-upload',
  'creating-studio',
  'community-tab',
  'privacy-settings',
  'appearance-rail',
] as const;
export type HelpPictureId = (typeof HELP_PICTURE_IDS)[number];

/** Short silent loops (desktop, one per language × light/dark) with a still poster */
export const HELP_CLIP_IDS = ['identity-switch', 'creating-upload', 'watching-mini-player'] as const;
export type HelpClipId = (typeof HELP_CLIP_IDS)[number];

export type HelpBlock =
  | { type: 'p'; text: string }
  | { type: 'steps'; items: string[] }
  | { type: 'list'; items: string[] }
  | { type: 'tip'; text: string }
  /** `markers` explains the numbered markers drawn on the picture, in order */
  | { type: 'figure'; picture: HelpPictureId; alt: string; markers?: string[] }
  | { type: 'clip'; clip: HelpClipId; label: string; caption: string }
  | { type: 'table'; head: [string, string]; rows: Array<[string, string]> }
  /** The "Show me" button: starts the identity tour on this page */
  | { type: 'tour'; text: string };

export interface HelpSection {
  /** Anchor on the page (#id), stable across languages */
  id: string;
  heading: string;
  blocks: HelpBlock[];
}

export interface HelpTopic {
  title: string;
  /** One line on the Help home and in search */
  summary: string;
  sections: HelpSection[];
}

export interface HelpTourStep {
  title: string;
  body: string;
}

export interface HelpTranslations {
  navLabel: string;
  title: string;
  lead: string;
  searchLabel: string;
  searchPlaceholder: string;
  searchEmpty: string;
  topicsHeading: string;
  onThisPage: string;
  related: string;
  backToHelp: string;
  takeTour: string;
  takeTourHint: string;
  /** Under each picture: "Numbered markers on the picture:" */
  markersLabel: string;
  playClip: string;
  /** "What's this?" link next to messages about channels */
  whatsThis: string;
  topics: Record<HelpTopicId, HelpTopic>;
  tour: {
    /** Accessible name of the tour card */
    label: string;
    welcomeTitle: string;
    welcomeBody: string;
    start: string;
    notNow: string;
    back: string;
    next: string;
    done: string;
    skip: string;
    /** "Step {current} of {total}" */
    stepOf: string;
    closed: string;
    steps: {
      account: HelpTourStep;
      actingAs: HelpTourStep;
      switch: HelpTourStep;
      upload: HelpTourStep;
      help: HelpTourStep;
    };
  };
}

export const HELP_EN: HelpTranslations = {
  navLabel: 'Help',
  title: 'Help',
  lead: 'How to watch, take part and share on Al Ummah Now, as yourself or as a channel.',
  searchLabel: 'Search Help',
  searchPlaceholder: 'Search Help, e.g. "switch channel"',
  searchEmpty: 'Type to search every Help page',
  topicsHeading: 'Topics',
  onThisPage: 'On this page',
  related: 'Related',
  backToHelp: 'All Help topics',
  takeTour: 'Take the tour',
  takeTourHint: 'A five-step tour of who you appear as on the site.',
  markersLabel: 'Numbered markers on the picture:',
  playClip: 'Play the clip',
  whatsThis: "What's this?",
  topics: {
    start: {
      title: 'Getting started',
      summary: 'Sign in, set up your profile and find your way around.',
      sections: [
        {
          id: 'sign-in',
          heading: 'Sign in',
          blocks: [
            { type: 'p', text: 'Select **Sign In** at the end of the header. One Al Ummah Now account works on all our sites — videos, the main site and your profile — so you sign in once.' },
            { type: 'figure', picture: 'start-signin', alt: 'The header with the Sign In button at its end', markers: ['Sign In'] },
          ],
        },
        {
          id: 'profile',
          heading: 'Your profile and your name',
          blocks: [
            { type: 'p', text: 'Open the account menu (your picture at the top of the page) and select your name to open your profile.' },
            { type: 'p', text: 'Add a **display name**. It is what people see next to your comments when you act as yourself. Without one, we show your first and last name.' },
            { type: 'figure', picture: 'start-profile', alt: 'Your profile with the display name field', markers: ['Display name'] },
          ],
        },
        {
          id: 'find-your-way',
          heading: 'Find your way',
          blocks: [
            { type: 'p', text: 'The side menu has Home, Explore, Subscriptions, your Library, History, Watch later and Liked videos. On a phone, open it with the menu button at the start of the header; Home, Explore, Subscriptions and Library are also in the bar at the bottom of the screen.' },
          ],
        },
      ],
    },
    watching: {
      title: 'Watching',
      summary: 'The player, captions, quality, the mini player, your playlists, Shorts, Watch later and History.',
      sections: [
        {
          id: 'player',
          heading: 'The player',
          blocks: [
            { type: 'p', text: 'Use the controls or the keyboard to play, pause, skip and change the volume. The settings button (the gear) holds **Quality** (Auto picks the best for your connection), **Speed** and **Autoplay next**.' },
            { type: 'p', text: 'Select **CC** to turn captions on. When a video has captions in more than one language, choose one in the same menu.' },
            { type: 'figure', picture: 'watching-actions', alt: 'The watch page with the action buttons under the player', markers: ['Like', 'Watch later', 'Save to a playlist'] },
          ],
        },
        {
          id: 'mini-player',
          heading: 'Keep watching while you browse',
          blocks: [
            { type: 'p', text: 'Scroll down the watch page while a video plays, to read the comments for example, and it carries on in a small player in the corner. Select it to go back up to the video, or close it. On a phone the player stays at the top of the screen instead.' },
            { type: 'clip', clip: 'watching-mini-player', label: 'Clip: the mini player', caption: 'Scrolling down to the comments: the video keeps playing in the corner.' },
          ],
        },
        {
          id: 'playlists',
          heading: 'Playlists and autoplay',
          blocks: [
            { type: 'p', text: 'Select **Save** under a video, or **Save to playlist** in a video card’s ⋮ menu, to add it to a playlist or start a new one. You don’t need a channel: without one, the playlists are your own.' },
            { type: 'p', text: 'Your playlists are in the **Playlists** section of your **Library**. **See all** lists them with **New playlist**, and each one opens in an editor for its details, cover and order, where you can also remove videos or delete it.' },
            { type: 'list', items: [
              '**Public:** listed and searchable.',
              '**Unlisted:** anyone with the link can open and play it, but it never shows in lists, channels, search or feeds.',
              '**Private:** only you (for a channel’s playlist, the people who manage the channel’s playlists).',
            ] },
            { type: 'figure', picture: 'watching-playlists', alt: 'Your playlists in the Library, with New playlist', markers: ['Your playlist', 'New playlist'] },
            { type: 'p', text: 'Play a playlist and the next video starts when one ends. Turn off **Autoplay next** in the settings menu to stop after each video. Your choice is kept on your account.' },
          ],
        },
        {
          id: 'shorts',
          heading: 'Shorts',
          blocks: [
            { type: 'p', text: 'Shorts are vertical or square videos up to three minutes long. Swipe, scroll or use the arrow keys to move to the next one.' },
          ],
        },
        {
          id: 'watch-later',
          heading: 'Watch later and History',
          blocks: [
            { type: 'p', text: 'Select **Watch later** on a video, or in a video card’s menu, to keep it for later. Both lists are in your **Library**.' },
            { type: 'p', text: 'They belong to your account, so they stay the same whichever channel you are acting as.' },
            { type: 'figure', picture: 'watching-library', alt: 'Your Library with Watch later and History', markers: ['Watch later', 'History'] },
          ],
        },
      ],
    },
    identity: {
      title: 'Acting as yourself or as a channel',
      summary: 'Who you appear as when you comment, like or subscribe, and how to switch.',
      sections: [
        {
          id: 'what-is-an-identity',
          heading: 'What “acting as” means',
          blocks: [
            { type: 'p', text: 'Everything you do in public — comments, replies, likes, votes and subscriptions — is done as one identity: **yourself**, or a **channel** you own or help run.' },
            { type: 'p', text: 'Your account is always you. A channel is a public face you can switch to and back from at any time.' },
          ],
        },
        {
          id: 'see-who',
          heading: 'See who you are acting as',
          blocks: [
            { type: 'p', text: 'Open the account menu. Your name is at the top. Under **Acting as** you see the channel in use, or **Yourself (no channel)**. When a channel is active, its picture also takes the place of yours on the account button.' },
            { type: 'figure', picture: 'identity-menu', alt: 'The account menu: your account at the top, then Acting as with the active channel and Switch channel', markers: ['Your account. Always you.', 'The identity you are acting as now.', 'Switch channel'] },
            { type: 'tour', text: 'Show me in the menu' },
          ],
        },
        {
          id: 'switch',
          heading: 'Switch',
          blocks: [
            { type: 'steps', items: [
              'Open the account menu and select **Switch channel**.',
              'Pick one of **Your Channels** or **Channels you manage**, or **Use without a channel** to act as yourself. A check mark shows the one in use.',
            ] },
            { type: 'p', text: 'The comment box says who you are commenting as. If you have channels, **Switch** next to it opens the same list.' },
            { type: 'clip', clip: 'identity-switch', label: 'Clip: switching who you act as', caption: 'Switching from a channel to yourself in the account menu; the comment box changes name.' },
            { type: 'figure', picture: 'identity-switch', alt: 'The channel list in the account menu', markers: ['Your Channels', 'Use without a channel'] },
            { type: 'tip', text: 'Switching never signs you out and never changes your account. Watch later, History, your subscriptions list and your settings stay the same.' },
          ],
        },
        {
          id: 'what-you-can-do',
          heading: 'What you can do as each',
          blocks: [
            { type: 'table', head: ['As yourself', 'As a channel'], rows: [
              ['Watch, and keep videos in Watch later and History', 'The same lists: they belong to your account'],
              ['Comment and reply on videos and posts', 'Comment and reply with the channel’s name and picture'],
              ['Like videos and comments, vote in polls', 'Like and vote as the channel'],
              ['Subscribe to channels', 'Subscribe as the channel'],
              ['Make your own playlists and save videos to them', 'Save to and manage the channel’s playlists'],
              ['—', 'Upload, use Studio, schedule and go live'],
              ['—', 'Write posts on the channel’s Community tab (the owner)'],
            ] },
            { type: 'p', text: 'A like or a subscription belongs to the identity that made it. If you like a video as yourself and again as your channel, that is two likes. The **Subscribe** button shows whether the identity you are using now is subscribed.' },
            { type: 'p', text: '**Save** shows the playlists of whoever you are acting as: your own playlists, or the channel’s.' },
            { type: 'p', text: 'Your **Subscriptions** feed and list are for your whole account: each channel shows once, however you subscribed to it. **Unsubscribe** on the manage page removes all of your subscriptions to that channel. You can’t subscribe to your own channel.' },
            { type: 'figure', picture: 'identity-comment', alt: 'The comment box under a video saying who you are commenting as', markers: ['Commenting as …', 'Switch'] },
          ],
        },
        {
          id: 'what-others-see',
          heading: 'What other people see',
          blocks: [
            { type: 'table', head: ['You act as', 'They see'], rows: [
              ['Yourself', 'Your display name and profile picture'],
              ['A channel', 'The channel’s name and picture, linking to the channel'],
            ] },
          ],
        },
        {
          id: 'create-a-channel',
          heading: 'Create a channel',
          blocks: [
            { type: 'p', text: 'Channels are by invitation. If you have been invited, open the account menu and select **Create Channel**, give it a name, and it becomes the channel you are acting as.' },
            { type: 'p', text: 'If you don’t see Create Channel, your account can’t create one yet. You can still watch, comment, like, subscribe and make playlists as yourself.' },
          ],
        },
        {
          id: 'teams',
          heading: 'Channel teams',
          blocks: [
            { type: 'p', text: 'A channel has one owner. The owner can add other accounts as **Channel admin**, **Editor** or **Channel moderator**. Those channels appear under **Channels you manage**, with the role next to the name.' },
          ],
        },
        {
          id: 'accounts',
          heading: 'Several accounts or several channels?',
          blocks: [
            { type: 'list', items: [
              'A **channel** is another public face of the same person: one sign-in, one history.',
              'A second **account** is a separate sign-in with its own email, history and channels.',
            ] },
            { type: 'p', text: 'To add an account, select **Sign in to another account** in the account menu. It then appears under **More accounts**, so you can move between them.' },
          ],
        },
      ],
    },
    creating: {
      title: 'Uploading and Studio',
      summary: 'Upload videos, find files you already uploaded, use Studio and schedule.',
      sections: [
        {
          id: 'upload',
          heading: 'Upload',
          blocks: [
            { type: 'p', text: 'Uploading needs a channel. What you upload goes to the **channel you are acting as**, so check the account menu first.' },
            { type: 'steps', items: [
              'Select **+ Upload** in the header.',
              'Drop one or more files, or choose them.',
              'Add a title and details while the files upload. You can keep browsing while they finish.',
            ] },
            { type: 'clip', clip: 'creating-upload', label: 'Clip: uploading a video', caption: 'Choosing a file on the upload page, then adding its title while it uploads.' },
            { type: 'figure', picture: 'creating-upload', alt: 'The upload page', markers: ['The channel it goes to', 'Choose files'] },
          ],
        },
        {
          id: 'already-uploaded',
          heading: 'Already uploaded',
          blocks: [
            { type: 'p', text: 'If you pick a file you uploaded before, we say so: **Already uploaded**. Watch the existing video, or upload it again as a separate video.' },
          ],
        },
        {
          id: 'studio',
          heading: 'Studio',
          blocks: [
            { type: 'p', text: 'Open the account menu and select **Studio**. It opens the channel you are acting as: its videos, drafts, edits, analytics and live streams. Switch channel in the menu to manage another.' },
            { type: 'figure', picture: 'creating-studio', alt: 'Studio with the channel’s videos', markers: ['Your videos', 'Edit'] },
          ],
        },
        {
          id: 'scheduling',
          heading: 'Scheduling',
          blocks: [
            { type: 'p', text: 'Choose a publish date and time when you upload or in Studio. The video stays private until then.' },
          ],
        },
      ],
    },
    community: {
      title: 'Community',
      summary: 'Posts, polls, comments and the community guidelines.',
      sections: [
        {
          id: 'posts',
          heading: 'Posts and polls',
          blocks: [
            { type: 'p', text: 'Channels share updates, pictures and polls on their **Community** tab. Only the channel’s owner writes posts there.' },
            { type: 'figure', picture: 'community-tab', alt: 'A channel’s Community tab with a post and its comments', markers: ['A post', 'Commenting as …'] },
          ],
        },
        {
          id: 'comments',
          heading: 'Comments and likes',
          blocks: [
            { type: 'p', text: 'Comment, reply, like and vote as whoever you are acting as. The comment box shows the name you will comment as. You can edit or delete your own comments.' },
          ],
        },
        {
          id: 'guidelines',
          heading: 'Community guidelines',
          blocks: [
            { type: 'p', text: 'Be respectful and stay on topic. The [community guidelines](/community-guidelines) say what is allowed. Comments that break them may be held for review or removed.' },
          ],
        },
      ],
    },
    privacy: {
      title: 'Privacy and your data',
      summary: 'Tracking choices, downloading your data and deleting it.',
      sections: [
        {
          id: 'privacy-data',
          heading: 'Privacy & data',
          blocks: [
            { type: 'p', text: 'Go to [Privacy & data](/settings/privacy).' },
            { type: 'list', items: [
              '**Tracking consent:** choose which optional data we may collect. Sign-in and language are always on.',
              '**Download your data:** a copy of everything we keep about you — profile, channels, videos, comments, history, subscriptions, posts and playlists.',
              '**Data on this device:** watch progress saved while you were signed out. Clear it any time.',
              '**Delete your data:** permanently deletes your profile, channels, videos, playlists, history, subscriptions and likes. Your comments and posts stay, without your name. You type a word to confirm.',
            ] },
            { type: 'figure', picture: 'privacy-settings', alt: 'The Privacy & data page', markers: ['Download your data', 'Delete your data'] },
          ],
        },
      ],
    },
    appearance: {
      title: 'Language and appearance',
      summary: 'English or Arabic, light or dark.',
      sections: [
        {
          id: 'language',
          heading: 'Language',
          blocks: [
            { type: 'p', text: 'At the foot of the side menu, select **العربية** (or **English**) to switch the whole site, including the player.' },
            { type: 'figure', picture: 'appearance-rail', alt: 'The foot of the side menu with the language and light/dark buttons', markers: ['Light or dark', 'Language'] },
          ],
        },
        {
          id: 'light-dark',
          heading: 'Light and dark',
          blocks: [
            { type: 'p', text: 'The site follows your device’s light or dark setting. The button next to the language switches between light and dark.' },
          ],
        },
      ],
    },
  },
  tour: {
    label: 'Tour',
    welcomeTitle: 'Welcome to Al Ummah Now',
    welcomeBody: 'A five-step tour of who you appear as on the site. You can skip it and open it again from Help.',
    start: 'Start the tour',
    notNow: 'Not now',
    back: 'Back',
    next: 'Next',
    done: 'Done',
    skip: 'Skip tour',
    stepOf: 'Step {current} of {total}',
    closed: 'Tour closed',
    steps: {
      account: { title: 'This is you', body: 'Your account menu. When a channel is active, its picture shows here instead of yours; your name stays.' },
      actingAs: { title: 'Who you are acting as', body: 'Comments, likes and subscriptions you make now carry this name and picture: a channel, or yourself.' },
      switch: { title: 'Switch any time', body: 'Pick a channel you own or manage, or “Use without a channel” to act as yourself. You stay in the same account.' },
      upload: { title: 'Uploads go to the active channel', body: 'No channel? You can still watch, comment, like, subscribe and make playlists as yourself. Channels are by invitation.' },
      help: { title: 'Find this again in Help', body: 'Help is in the account menu and the side menu, with “Take the tour”. Enjoy watching.' },
    },
  },
};

export const HELP_AR: HelpTranslations = {
  navLabel: 'المساعدة',
  title: 'المساعدة',
  lead: 'كيف تشاهد وتشارك وتنشر في الأمة الآن، باسمك أو باسم قناة.',
  searchLabel: 'ابحث في المساعدة',
  searchPlaceholder: 'ابحث في المساعدة، مثل «تبديل القناة»',
  searchEmpty: 'اكتب للبحث في كل صفحات المساعدة',
  topicsHeading: 'المواضيع',
  onThisPage: 'في هذه الصفحة',
  related: 'ذو صلة',
  backToHelp: 'كل مواضيع المساعدة',
  takeTour: 'ابدأ الجولة',
  takeTourHint: 'جولة من خمس خطوات تعرّفك بالهوية التي تظهر بها في الموقع.',
  markersLabel: 'العلامات المرقّمة على الصورة:',
  playClip: 'شغّل المقطع',
  whatsThis: 'ما هذا؟',
  topics: {
    start: {
      title: 'البدء',
      summary: 'سجّل الدخول، وجهّز ملفك الشخصي، وتعرّف على الموقع.',
      sections: [
        {
          id: 'sign-in',
          heading: 'تسجيل الدخول',
          blocks: [
            { type: 'p', text: 'اختر **تسجيل الدخول** في طرف الشريط العلوي. حساب واحد في الأمة الآن يكفيك في كل مواقعنا: موقع المرئيات والموقع الرئيسي وملفك الشخصي، فتسجّل الدخول مرة واحدة.' },
            { type: 'figure', picture: 'start-signin', alt: 'الشريط العلوي وفي طرفه زر تسجيل الدخول', markers: ['تسجيل الدخول'] },
          ],
        },
        {
          id: 'profile',
          heading: 'ملفك واسمك',
          blocks: [
            { type: 'p', text: 'افتح قائمة الحساب (صورتك في أعلى الصفحة) واختر اسمك لفتح ملفك الشخصي.' },
            { type: 'p', text: 'أضف **اسمًا معروضًا**، فهو ما يراه الناس بجانب تعليقاتك حين تتصرّف باسمك. وإن لم تضفه نعرض اسمك الأول واسم العائلة.' },
            { type: 'figure', picture: 'start-profile', alt: 'ملفك الشخصي وفيه حقل الاسم المعروض', markers: ['الاسم المعروض'] },
          ],
        },
        {
          id: 'find-your-way',
          heading: 'التنقّل في الموقع',
          blocks: [
            { type: 'p', text: 'في القائمة الجانبية: الرئيسية والاستكشاف والاشتراكات ومكتبتك والسجل والمشاهدة لاحقًا والمرئيات التي أعجبتك. وعلى الهاتف تفتحها بزر القائمة في بداية الشريط العلوي، وتجد الرئيسية والاستكشاف والاشتراكات والمكتبة أيضًا في الشريط أسفل الشاشة.' },
          ],
        },
      ],
    },
    watching: {
      title: 'المشاهدة',
      summary: 'المشغّل والترجمة والجودة والمشغّل المصغّر وقوائم التشغيل والمقاطع القصيرة والمشاهدة لاحقًا والسجل.',
      sections: [
        {
          id: 'player',
          heading: 'المشغّل',
          blocks: [
            { type: 'p', text: 'استخدم أزرار التحكم أو لوحة المفاتيح للتشغيل والإيقاف والتقديم وتغيير الصوت. وفي زر الإعدادات (الترس): **الجودة** (التلقائية تختار الأنسب لاتصالك)، و**السرعة**، و**التشغيل التلقائي للتالي**.' },
            { type: 'p', text: 'اختر **CC** لإظهار الترجمة. وإن كان للمرئي ترجمات بأكثر من لغة فاختر ما تريد من القائمة نفسها.' },
            { type: 'figure', picture: 'watching-actions', alt: 'صفحة المشاهدة وأزرار الإجراءات تحت المشغّل', markers: ['أعجبني', 'مشاهدة لاحقاً', 'الحفظ في قائمة تشغيل'] },
          ],
        },
        {
          id: 'mini-player',
          heading: 'تابع المشاهدة أثناء التصفّح',
          blocks: [
            { type: 'p', text: 'إذا مرّرت صفحة المشاهدة إلى الأسفل والمرئي يعمل، لقراءة التعليقات مثلًا، يستمرّ في مشغّل صغير في زاوية الشاشة. اختره للعودة إلى المرئي، أو أغلقه. وعلى الهاتف يبقى المشغّل في أعلى الشاشة بدلًا من ذلك.' },
            { type: 'clip', clip: 'watching-mini-player', label: 'مقطع: المشغّل المصغّر', caption: 'التمرير إلى التعليقات: يستمرّ المرئي في الزاوية.' },
          ],
        },
        {
          id: 'playlists',
          heading: 'قوائم التشغيل والتشغيل التلقائي',
          blocks: [
            { type: 'p', text: 'اختر **حفظ** تحت المرئي، أو **حفظ في قائمة تشغيل** من قائمة ⋮ في بطاقة المرئي، لتضيفه إلى قائمة تشغيل أو تبدأ قائمة جديدة. ولا تحتاج إلى قناة: فبدونها تكون القوائم لك أنت.' },
            { type: 'p', text: 'تجد قوائمك في قسم **قوائم التشغيل** في **المكتبة**. ويعرضها **عرض الكل** مع **قائمة تشغيل جديدة**، وتُفتح كل قائمة في محرّر لتفاصيلها وغلافها وترتيبها، ومنه تحذف منها المرئيات أو تحذفها كلها.' },
            { type: 'list', items: [
              '**عامة:** تظهر في القوائم والبحث.',
              '**غير مُدرجة:** يفتحها ويشغّلها كل من لديه الرابط، لكنها لا تظهر في القوائم أو القنوات أو البحث أو الخلاصات.',
              '**خاصة:** لك وحدك (وفي قوائم القناة: لمن يديرون قوائم تشغيلها).',
            ] },
            { type: 'figure', picture: 'watching-playlists', alt: 'قوائم تشغيلك في المكتبة، ومعها «قائمة تشغيل جديدة»', markers: ['قائمتك', 'قائمة تشغيل جديدة'] },
            { type: 'p', text: 'شغّل قائمة تشغيل، وحين ينتهي مرئي يبدأ الذي يليه. أوقف **التشغيل التلقائي للتالي** من قائمة الإعدادات إن أردت التوقف بعد كل مرئي، ويُحفظ اختيارك في حسابك.' },
          ],
        },
        {
          id: 'shorts',
          heading: 'المقاطع القصيرة',
          blocks: [
            { type: 'p', text: 'المقاطع القصيرة مرئيات عمودية أو مربّعة لا تزيد على ثلاث دقائق. اسحب أو مرّر أو استخدم مفاتيح الأسهم للانتقال إلى التالي.' },
          ],
        },
        {
          id: 'watch-later',
          heading: 'المشاهدة لاحقًا والسجل',
          blocks: [
            { type: 'p', text: 'اختر **مشاهدة لاحقاً** في صفحة المرئي أو من قائمة بطاقته لتحفظه لوقت لاحق. وتجد القائمتين في **المكتبة**.' },
            { type: 'p', text: 'وهما لحسابك، فتبقيان كما هما أيًّا كانت القناة التي تتصرّف باسمها.' },
            { type: 'figure', picture: 'watching-library', alt: 'مكتبتك وفيها المشاهدة لاحقًا والسجل', markers: ['مشاهدة لاحقاً', 'السجل'] },
          ],
        },
      ],
    },
    identity: {
      title: 'التصرّف باسمك أو باسم قناة',
      summary: 'الهوية التي تظهر بها حين تعلّق أو تُعجب أو تشترك، وكيف تبدّلها.',
      sections: [
        {
          id: 'what-is-an-identity',
          heading: 'ما معنى «تتصرّف باسم»؟',
          blocks: [
            { type: 'p', text: 'كل ما تفعله أمام الناس، من تعليق وردّ وإعجاب وتصويت واشتراك، تفعله بهوية واحدة: **باسمك أنت**، أو **باسم قناة** تملكها أو تساعد في إدارتها.' },
            { type: 'p', text: 'حسابك هو أنت دائمًا، والقناة وجه عامّ تنتقل إليه وتعود منه متى شئت.' },
          ],
        },
        {
          id: 'see-who',
          heading: 'اعرف باسم من تتصرّف',
          blocks: [
            { type: 'p', text: 'افتح قائمة الحساب. في أعلاها اسمك، وتحت **تتصرّف باسم** تظهر القناة المستخدمة، أو **اسمك الشخصي (بدون قناة)**. وحين تكون قناة نشطة تحلّ صورتها محلّ صورتك على زر الحساب.' },
            { type: 'figure', picture: 'identity-menu', alt: 'قائمة الحساب: حسابك في أعلاها، ثم «تتصرّف باسم» والقناة النشطة و«تبديل القناة»', markers: ['حسابك، وهو أنت دائمًا.', 'الهوية التي تتصرّف بها الآن.', 'تبديل القناة'] },
            { type: 'tour', text: 'أرني في القائمة' },
          ],
        },
        {
          id: 'switch',
          heading: 'التبديل',
          blocks: [
            { type: 'steps', items: [
              'افتح قائمة الحساب واختر **تبديل القناة**.',
              'اختر من **قنواتك** أو **القنوات التي تديرها**، أو **الاستخدام بدون قناة** لتتصرّف باسمك. وتدلّ علامة الصح على المستخدمة الآن.',
            ] },
            { type: 'p', text: 'يُظهر لك صندوق التعليق الاسم الذي ستعلّق به. وإن كانت لديك قنوات فزر **تبديل** بجانبه يفتح القائمة نفسها.' },
            { type: 'clip', clip: 'identity-switch', label: 'مقطع: تبديل الهوية', caption: 'التبديل من قناة إلى اسمك الشخصي في قائمة الحساب، فيتغيّر الاسم في صندوق التعليق.' },
            { type: 'figure', picture: 'identity-switch', alt: 'قائمة القنوات في قائمة الحساب', markers: ['قنواتك', 'الاستخدام بدون قناة'] },
            { type: 'tip', text: 'التبديل لا يُخرجك من حسابك ولا يغيّره، وتبقى «مشاهدة لاحقاً» و«السجل» وقائمة اشتراكاتك وإعداداتك كما هي.' },
          ],
        },
        {
          id: 'what-you-can-do',
          heading: 'ما يمكنك فعله بكل هوية',
          blocks: [
            { type: 'table', head: ['باسمك', 'باسم قناة'], rows: [
              ['المشاهدة، وحفظ المرئيات في «مشاهدة لاحقاً» والسجل', 'القوائم نفسها، فهي لحسابك'],
              ['التعليق والردّ على المرئيات والمنشورات', 'التعليق والردّ باسم القناة وصورتها'],
              ['الإعجاب بالمرئيات والتعليقات، والتصويت', 'الإعجاب والتصويت باسم القناة'],
              ['الاشتراك في القنوات', 'الاشتراك باسم القناة'],
              ['إنشاء قوائم تشغيلك وحفظ المرئيات فيها', 'الحفظ في قوائم تشغيل القناة وإدارتها'],
              ['—', 'رفع المرئيات والاستوديو والجدولة والبث المباشر'],
              ['—', 'كتابة المنشورات في تبويب المجتمع (لمالك القناة)'],
            ] },
            { type: 'p', text: 'الإعجاب والاشتراك يتبعان الهوية التي قامت بهما؛ فإن أعجبك مرئي باسمك ثم باسم قناتك فهذان إعجابان. ويُظهر زر **اشترك** هل الهوية التي تستخدمها الآن مشتركة أم لا.' },
            { type: 'p', text: 'ويعرض زر **حفظ** قوائم تشغيل الهوية التي تتصرّف بها: قوائمك أنت، أو قوائم القناة.' },
            { type: 'p', text: 'صفحة **الاشتراكات** وقائمتها لحسابك كله: تظهر كل قناة مرة واحدة أيًّا كانت الهوية التي اشتركت بها. و**إلغاء الاشتراك** في صفحة الإدارة يلغي كل اشتراكاتك في تلك القناة. ولا يمكنك الاشتراك في قناتك.' },
            { type: 'figure', picture: 'identity-comment', alt: 'صندوق التعليق تحت المرئي يُظهر الاسم الذي ستعلّق به', markers: ['تعلّق باسم …', 'تبديل'] },
          ],
        },
        {
          id: 'what-others-see',
          heading: 'ما يراه الآخرون',
          blocks: [
            { type: 'table', head: ['تتصرّف باسم', 'يرون'], rows: [
              ['نفسك', 'اسمك المعروض وصورة ملفك'],
              ['قناة', 'اسم القناة وصورتها مع رابط إليها'],
            ] },
          ],
        },
        {
          id: 'create-a-channel',
          heading: 'إنشاء قناة',
          blocks: [
            { type: 'p', text: 'إنشاء القنوات بدعوة. فإن دُعيت فافتح قائمة الحساب واختر **إنشاء قناة** وسمِّها، فتصبح القناة التي تتصرّف باسمها.' },
            { type: 'p', text: 'وإن لم يظهر لك «إنشاء قناة» فحسابك لا يستطيع إنشاء قناة بعد، وما زال بإمكانك المشاهدة والتعليق والإعجاب والاشتراك وإنشاء قوائم التشغيل باسمك.' },
          ],
        },
        {
          id: 'teams',
          heading: 'فريق القناة',
          blocks: [
            { type: 'p', text: 'لكل قناة مالك واحد، ويستطيع أن يضيف حسابات أخرى بدور **مشرف القناة** أو **محرر** أو **مراقب القناة**. وتظهر هذه القنوات لهم تحت **القنوات التي تديرها** وبجانب الاسم الدور.' },
          ],
        },
        {
          id: 'accounts',
          heading: 'أكثر من حساب أم أكثر من قناة؟',
          blocks: [
            { type: 'list', items: [
              '**القناة** وجه عامّ آخر للشخص نفسه: تسجيل دخول واحد وسجل واحد.',
              '**الحساب** الثاني دخول منفصل ببريد وسجل وقنوات خاصة به.',
            ] },
            { type: 'p', text: 'لإضافة حساب اختر **تسجيل الدخول بحساب آخر** في قائمة الحساب، فيظهر بعدها تحت **حسابات أخرى** لتنتقل بينهما.' },
          ],
        },
      ],
    },
    creating: {
      title: 'الرفع والاستوديو',
      summary: 'ارفع المرئيات، واعرف الملفات المرفوعة من قبل، واستخدم الاستوديو والجدولة.',
      sections: [
        {
          id: 'upload',
          heading: 'رفع مرئي',
          blocks: [
            { type: 'p', text: 'الرفع يحتاج قناة. ما ترفعه يذهب إلى **القناة التي تتصرّف باسمها**، فتحقّق منها في قائمة الحساب أولًا.' },
            { type: 'steps', items: [
              'اختر **+ رفع مرئي** في الشريط العلوي.',
              'أفلت ملفًا أو أكثر، أو اخترها.',
              'أضف العنوان والتفاصيل أثناء الرفع، ويمكنك متابعة التصفّح حتى يكتمل.',
            ] },
            { type: 'clip', clip: 'creating-upload', label: 'مقطع: رفع مرئي', caption: 'اختيار ملف في صفحة الرفع ثم إضافة عنوانه أثناء الرفع.' },
            { type: 'figure', picture: 'creating-upload', alt: 'صفحة الرفع', markers: ['القناة التي يذهب إليها', 'اختيار الملفات'] },
          ],
        },
        {
          id: 'already-uploaded',
          heading: 'تم رفعه من قبل',
          blocks: [
            { type: 'p', text: 'إذا اخترت ملفًا رفعته سابقًا نخبرك بأنه **تم رفعه من قبل**، فشاهد المرئي الموجود، أو ارفعه مرة أخرى مرئيًا منفصلًا.' },
          ],
        },
        {
          id: 'studio',
          heading: 'الاستوديو',
          blocks: [
            { type: 'p', text: 'افتح قائمة الحساب واختر **الاستوديو**. يفتح على القناة التي تتصرّف باسمها: مرئياتها والمسودات والتعديل والإحصاءات والبث المباشر. ولإدارة قناة أخرى بدّل القناة من القائمة.' },
            { type: 'figure', picture: 'creating-studio', alt: 'الاستوديو ومرئيات القناة', markers: ['مرئياتك', 'تعديل'] },
          ],
        },
        {
          id: 'scheduling',
          heading: 'الجدولة',
          blocks: [
            { type: 'p', text: 'اختر تاريخ النشر ووقته عند الرفع أو في الاستوديو، ويبقى المرئي خاصًا حتى ذلك الحين.' },
          ],
        },
      ],
    },
    community: {
      title: 'المجتمع',
      summary: 'المنشورات واستطلاعات الرأي والتعليقات وإرشادات المجتمع.',
      sections: [
        {
          id: 'posts',
          heading: 'المنشورات واستطلاعات الرأي',
          blocks: [
            { type: 'p', text: 'تنشر القنوات أخبارها وصورها واستطلاعاتها في تبويب **المجتمع**، ولا يكتب المنشورات فيه إلا مالك القناة.' },
            { type: 'figure', picture: 'community-tab', alt: 'تبويب المجتمع في قناة وفيه منشور وتعليقاته', markers: ['منشور', 'تعلّق باسم …'] },
          ],
        },
        {
          id: 'comments',
          heading: 'التعليقات والإعجابات',
          blocks: [
            { type: 'p', text: 'علّق ورُدّ وأعجب وصوّت بالهوية التي تتصرّف بها، ويُظهر لك صندوق التعليق الاسم الذي ستعلّق به. ويمكنك تعديل تعليقاتك أو حذفها.' },
          ],
        },
        {
          id: 'guidelines',
          heading: 'إرشادات المجتمع',
          blocks: [
            { type: 'p', text: 'احترم الآخرين والتزم بموضوع النقاش. تبيّن [إرشادات المجتمع](/community-guidelines) المسموح، وقد تُحجز التعليقات المخالفة للمراجعة أو تُحذف.' },
          ],
        },
      ],
    },
    privacy: {
      title: 'الخصوصية وبياناتك',
      summary: 'خيارات التتبع وتنزيل بياناتك وحذفها.',
      sections: [
        {
          id: 'privacy-data',
          heading: 'الخصوصية والبيانات',
          blocks: [
            { type: 'p', text: 'اذهب إلى [الخصوصية والبيانات](/settings/privacy).' },
            { type: 'list', items: [
              '**الموافقة على التتبع:** اختر البيانات الاختيارية التي يمكننا جمعها، أما تسجيل الدخول واللغة فدائمان.',
              '**تنزيل بياناتك:** نسخة من كل ما نحفظه عنك: الملف الشخصي والقنوات والمرئيات والتعليقات والسجل والاشتراكات والمنشورات وقوائم التشغيل.',
              '**البيانات على هذا الجهاز:** تقدّم المشاهدة المحفوظ أثناء عدم تسجيل الدخول، وتستطيع مسحه متى شئت.',
              '**حذف بياناتك:** يحذف نهائيًا ملفك وقنواتك ومرئياتك وقوائم التشغيل والسجل والاشتراكات والإعجابات، وتبقى تعليقاتك ومنشوراتك بلا اسمك. وتكتب كلمة للتأكيد.',
            ] },
            { type: 'figure', picture: 'privacy-settings', alt: 'صفحة الخصوصية والبيانات', markers: ['تنزيل بياناتك', 'حذف بياناتك'] },
          ],
        },
      ],
    },
    appearance: {
      title: 'اللغة والمظهر',
      summary: 'العربية أو الإنجليزية، فاتح أو داكن.',
      sections: [
        {
          id: 'language',
          heading: 'اللغة',
          blocks: [
            { type: 'p', text: 'في أسفل القائمة الجانبية اختر **English** (أو **العربية**) لتبديل لغة الموقع كله، ومنه المشغّل.' },
            { type: 'figure', picture: 'appearance-rail', alt: 'أسفل القائمة الجانبية وفيه زرّا اللغة والوضع الفاتح والداكن', markers: ['فاتح أو داكن', 'اللغة'] },
          ],
        },
        {
          id: 'light-dark',
          heading: 'الفاتح والداكن',
          blocks: [
            { type: 'p', text: 'يتبع الموقع إعداد جهازك للوضع الفاتح أو الداكن، والزر بجانب اللغة يبدّل بينهما.' },
          ],
        },
      ],
    },
  },
  tour: {
    label: 'الجولة',
    welcomeTitle: 'أهلًا بك في الأمة الآن',
    welcomeBody: 'جولة من خمس خطوات تعرّفك بالهوية التي تظهر بها في الموقع. يمكنك تخطّيها وفتحها لاحقًا من المساعدة.',
    start: 'ابدأ الجولة',
    notNow: 'ليس الآن',
    back: 'السابق',
    next: 'التالي',
    done: 'تم',
    skip: 'تخطَّ الجولة',
    stepOf: 'الخطوة {current} من {total}',
    closed: 'انتهت الجولة',
    steps: {
      account: { title: 'هذا أنت', body: 'قائمة حسابك. حين تكون قناة نشطة تظهر صورتها هنا بدل صورتك، ويبقى اسمك.' },
      actingAs: { title: 'باسم من تتصرّف', body: 'التعليقات والإعجابات والاشتراكات التي تقوم بها الآن تحمل هذا الاسم وهذه الصورة: قناة، أو اسمك أنت.' },
      switch: { title: 'بدّل متى شئت', body: 'اختر قناة تملكها أو تديرها، أو «الاستخدام بدون قناة» لتتصرّف باسمك. وتبقى في الحساب نفسه.' },
      upload: { title: 'الرفع يذهب إلى القناة النشطة', body: 'ليست لديك قناة؟ ما زال بإمكانك المشاهدة والتعليق والإعجاب والاشتراك وإنشاء قوائم التشغيل باسمك. وإنشاء القنوات بدعوة.' },
      help: { title: 'تجد الجولة في المساعدة', body: 'المساعدة في قائمة الحساب والقائمة الجانبية، ومنها «ابدأ الجولة». مشاهدة طيبة.' },
    },
  },
};
