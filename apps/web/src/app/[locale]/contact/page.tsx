import { Suspense } from 'react';
import type { Metadata } from 'next';
import { CONTACT_AR, CONTACT_EN } from '@al-ummah/shared-types';
import { ContactPage } from '@/components/contact/ContactPage';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const c = locale === 'ar' ? CONTACT_AR : CONTACT_EN;
  return { title: c.title, description: c.lead };
}

export default function ContactRoute() {
  // useSearchParams (topic and page prefill) needs a boundary
  return (
    <Suspense fallback={null}>
      <ContactPage />
    </Suspense>
  );
}
