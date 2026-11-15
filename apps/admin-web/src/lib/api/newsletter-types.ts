/** admin-api /api/newsletter shapes (apps/admin-api/src/routers/newsletter.router.ts). */
export type SubscriberStatus = 'pending' | 'confirmed' | 'unsubscribed';
export type IssueStatus = 'draft' | 'sending' | 'sent';

export interface NewsletterSubscriber {
  id: string;
  email: string;
  locale: 'en' | 'ar';
  status: SubscriberStatus;
  confirm_status: string | null;
  confirm_error: string | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
}

export type SubscriberCounts = Record<SubscriberStatus, number>;
export interface DeliveryCounts { queued: number; sent: number; sunk: number; skipped: number; failed: number }

export interface NewsletterIssueContent {
  subject_en: string;
  subject_ar: string;
  body_en: string;
  body_ar: string;
}

export interface NewsletterIssue extends NewsletterIssueContent {
  id: string;
  status: IssueStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  sent_by: string | null;
  send_started_at: string | null;
  fanned_out_at: string | null;
  finished_at: string | null;
  counts: DeliveryCounts;
}

export interface SubscriberList { items: NewsletterSubscriber[]; total: number; counts: SubscriberCounts; limit: number; offset: number }
export interface IssueList { items: NewsletterIssue[]; total: number; subscribers: SubscriberCounts; limit: number; offset: number }
