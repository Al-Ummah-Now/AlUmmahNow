import { Suspense } from 'react';
import type { Metadata } from 'next';
import { GUEST_REPORT_COPY } from '@/lib/report/guest-report';
import { GuestReportPage } from '@/components/report/GuestReportPage';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const copy = locale === 'ar' ? GUEST_REPORT_COPY.ar : GUEST_REPORT_COPY.en;
  return {
    title: copy.title,
    description: copy.lead,
    robots: { index: false, follow: false },
  };
}

export default function ReportRoute() {
  return (
    <Suspense fallback={null}>
      <GuestReportPage />
    </Suspense>
  );
}
