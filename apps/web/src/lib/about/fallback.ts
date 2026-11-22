/**
 * The About page shown when the CMS cannot be reached and no copy of it is cached: the copy the CMS
 * was seeded with (AlUmmahNowCMS migration 0021, the owner's text, the same as www's built-in About).
 * Editors change the live page in the CMS; this is only the last resort, so the page is never blank.
 */
import type { CmsPage } from './cms-page';

export const ABOUT_FALLBACK: Record<'en' | 'ar', CmsPage> = {
  en: {
    slug: 'about',
    locale: 'en',
    title: 'About Al Ummah Now',
    summary: 'An Islamic video and community platform, in Arabic and English.',
    body: [
      'Al Ummah Now is a platform where you can share videos, Shorts and community posts.',
      '',
      "## What you’ll find here",
      '',
      '- Watch and share **videos and Shorts**.',
      '- Read **community posts** from the channels you subscribe to.',
      '- Share **news** that matters to the Ummah.',
      '- Share **your videos and posts** with the community.',
      '- Watch **live streams** as they happen.',
      '',
      '## Get started',
      '',
      'Explore videos, or create an account to subscribe to channels and save what you want to come back to.',
    ].join('\n'),
    seo_title: null,
    seo_description: null,
    blocks: [],
    alternates: [{ locale: 'ar', slug: 'about' }],
  },
  ar: {
    slug: 'about',
    locale: 'ar',
    title: 'عن الأمة الآن',
    summary: 'منصة إسلامية للمرئيات والمجتمع، بالعربية والإنجليزية.',
    body: [
      'الأمة الآن منصة تشارك فيها المرئيات والمقاطع القصيرة ومنشورات المجتمع.',
      '',
      '## ماذا تجد هنا؟',
      '',
      '- شاهد **المرئيات والمقاطع القصيرة** وشاركها.',
      '- اقرأ **منشورات المجتمع** من القنوات التي تشترك فيها.',
      '- شارك **الأخبار** التي تهمّ الأمة.',
      '- شارك **مرئياتك ومنشوراتك** مع المجتمع.',
      '- شاهد **البث المباشر** لحظة بلحظة.',
      '',
      '## ابدأ الآن',
      '',
      'استكشف المرئيات، أو أنشئ حسابًا لتشترك في القنوات وتحفظ ما تريد الرجوع إليه.',
    ].join('\n'),
    seo_title: null,
    seo_description: null,
    blocks: [],
    alternates: [{ locale: 'en', slug: 'about' }],
  },
};
