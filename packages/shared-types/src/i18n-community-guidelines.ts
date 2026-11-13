/**
 * Community guidelines page (Epic 6.3), en/ar. Shared by the web static
 * fallback and the api-videos translation seed, like i18n-library.ts.
 */

export interface GuidelineSection {
  heading: string;
  /** Short paragraph under the heading. */
  intro: string;
  /** Bullet points (may be empty). */
  points: string[];
}

export interface CommunityGuidelinesTranslations {
  navLabel: string;
  title: string;
  lead: string;
  lastUpdated: string;
  sections: {
    respect: GuidelineSection;
    knowledge: GuidelineSection;
    prohibited: GuidelineSection;
    comments: GuidelineSection;
    creators: GuidelineSection;
    enforcement: GuidelineSection;
    reporting: GuidelineSection;
  };
}

export const COMMUNITY_GUIDELINES_EN: CommunityGuidelinesTranslations = {
  navLabel: 'Community guidelines',
  title: 'Community guidelines',
  lead: 'Al Ummah Now is a place to learn, share beneficial knowledge and support each other. These guidelines apply to videos, live streams, shorts, comments, community posts, playlists, channel pages and profiles.',
  lastUpdated: 'Last updated: November 2026',
  sections: {
    respect: {
      heading: 'Good character (adab)',
      intro: 'Speak to others the way you would want to be spoken to.',
      points: [
        'Disagree with ideas, not with people. Differences of opinion between schools of thought are respected.',
        'No insults, mockery, name-calling or takfir of other users.',
        'Do not harass, threaten or single out anyone, on or off the platform.',
      ],
    },
    knowledge: {
      heading: 'Religious content with care',
      intro: 'Religious knowledge is a trust. Share it with honesty and with sources.',
      points: [
        'Cite your sources (Qur’an, hadith with grading, scholars) when you make religious claims.',
        'Do not present opinions as rulings, and do not attribute words to scholars that they did not say.',
        'Do not claim a scholarly title or a verification you do not have.',
      ],
    },
    prohibited: {
      heading: 'Not allowed',
      intro: 'The following is removed, and may lead to the account being suspended:',
      points: [
        'Hate speech or incitement against any people because of religion, sect, ethnicity, nationality or gender.',
        'Violent extremism: promoting, praising or recruiting for terrorist groups or violence.',
        'Sexual or indecent content, and any content that sexualises or endangers children.',
        'Graphic violence shown to shock, or content that encourages self-harm.',
        'Spam, scams, fake giveaways, misleading links and fraudulent fundraising.',
        'Impersonating a person, a scholar, a channel or an organisation.',
        'Sharing someone’s private information without consent.',
        'Content you do not have the rights to share.',
      ],
    },
    comments: {
      heading: 'Comments and community posts',
      intro: 'Keep discussions on topic and beneficial.',
      points: [
        'No repeated, copy-pasted or promotional comments.',
        'Creators can remove comments on their own videos and posts.',
      ],
    },
    creators: {
      heading: 'For creators',
      intro: 'Titles, thumbnails and descriptions must match what the video contains.',
      points: [
        'Mark videos for children correctly and keep them suitable for children.',
        'Music and other content follow the same rules as everything else on the platform.',
      ],
    },
    enforcement: {
      heading: 'How we enforce these guidelines',
      intro: 'Moderators review reported content. Automated tools may help us find content that breaks these guidelines, and people make the final decisions.',
      points: [
        'Content that breaks the guidelines is hidden or removed.',
        'Serious or repeated violations can lead to a channel or account being suspended.',
        'Content that puts someone in immediate danger, or harms children, is reported to the authorities where the law requires it.',
      ],
    },
    reporting: {
      heading: 'Reporting',
      intro: 'If you see something that breaks these guidelines, use the Report button on the video, comment or post. Reports are confidential: the person you report is not told who reported them.',
      points: [],
    },
  },
};

export const COMMUNITY_GUIDELINES_AR: CommunityGuidelinesTranslations = {
  navLabel: 'إرشادات المجتمع',
  title: 'إرشادات المجتمع',
  lead: 'الأمة الآن مكان للتعلّم ونشر العلم النافع والتعاون على الخير. تنطبق هذه الإرشادات على المرئيات والبث المباشر والمقاطع القصيرة والتعليقات ومنشورات المجتمع وقوائم التشغيل وصفحات القنوات والملفات الشخصية.',
  lastUpdated: 'آخر تحديث: نوفمبر 2026',
  sections: {
    respect: {
      heading: 'حسن الخلق (الأدب)',
      intro: 'خاطب الآخرين كما تحب أن يخاطبوك.',
      points: [
        'اختلف مع الأفكار لا مع الأشخاص. الخلاف المعتبر بين المذاهب محترم.',
        'لا للسبّ أو السخرية أو التنابز بالألقاب أو تكفير المستخدمين الآخرين.',
        'لا تضايق أحدًا أو تهدده أو تستهدفه، داخل المنصة أو خارجها.',
      ],
    },
    knowledge: {
      heading: 'المحتوى الديني بعناية',
      intro: 'العلم الشرعي أمانة، فانقله بصدق ومع ذكر المصادر.',
      points: [
        'اذكر مصادرك (القرآن، والحديث مع درجته، وأقوال العلماء) عند الحديث في المسائل الشرعية.',
        'لا تقدّم الرأي على أنه فتوى، ولا تنسب إلى العلماء ما لم يقولوه.',
        'لا تدّعِ لقبًا علميًا أو توثيقًا ليس لك.',
      ],
    },
    prohibited: {
      heading: 'غير مسموح',
      intro: 'يُزال ما يلي، وقد يؤدي إلى إيقاف الحساب:',
      points: [
        'خطاب الكراهية أو التحريض ضد أي فئة بسبب الدين أو المذهب أو العرق أو الجنسية أو الجنس.',
        'التطرف العنيف: الترويج للجماعات الإرهابية أو العنف أو تمجيدها أو التجنيد لها.',
        'المحتوى الجنسي أو الخادش للحياء، وأي محتوى يستغل الأطفال جنسيًا أو يعرّضهم للخطر.',
        'العنف المصوّر بقصد الصدمة، أو المحتوى الذي يشجّع على إيذاء النفس.',
        'الرسائل المزعجة والاحتيال والمسابقات الوهمية والروابط المضللة وجمع التبرعات الاحتيالي.',
        'انتحال صفة شخص أو عالم أو قناة أو جهة.',
        'نشر المعلومات الخاصة لأي شخص دون إذنه.',
        'محتوى لا تملك حق نشره.',
      ],
    },
    comments: {
      heading: 'التعليقات ومنشورات المجتمع',
      intro: 'اجعل النقاش في صلب الموضوع ونافعًا.',
      points: [
        'لا للتعليقات المكررة أو المنسوخة أو الترويجية.',
        'يمكن لصنّاع المحتوى حذف التعليقات على مرئياتهم ومنشوراتهم.',
      ],
    },
    creators: {
      heading: 'لصنّاع المحتوى',
      intro: 'يجب أن تطابق العناوين والصور المصغّرة والأوصاف محتوى المرئي.',
      points: [
        'حدّد مرئيات الأطفال بشكل صحيح واجعلها مناسبة لهم.',
        'تخضع الموسيقى وغيرها من المحتوى للقواعد نفسها المطبقة على كل ما في المنصة.',
      ],
    },
    enforcement: {
      heading: 'كيف نطبّق هذه الإرشادات',
      intro: 'يراجع المشرفون المحتوى المُبلَّغ عنه. قد تساعدنا أدوات آلية في العثور على المحتوى المخالف، ويبقى القرار النهائي للبشر.',
      points: [
        'يُخفى المحتوى المخالف أو يُزال.',
        'قد تؤدي المخالفات الجسيمة أو المتكررة إلى إيقاف القناة أو الحساب.',
        'يُبلَّغ عن المحتوى الذي يعرّض أحدًا لخطر وشيك أو يؤذي الأطفال إلى الجهات المختصة حيث يلزم القانون بذلك.',
      ],
    },
    reporting: {
      heading: 'الإبلاغ',
      intro: 'إذا رأيت ما يخالف هذه الإرشادات، فاستخدم زر الإبلاغ على المرئي أو التعليق أو المنشور. البلاغات سرية: لا يُخبَر الشخص المُبلَّغ عنه بهوية من أبلغ.',
      points: [],
    },
  },
};
