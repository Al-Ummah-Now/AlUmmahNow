/** Invite shapes from admin-api /api/invites (apps/admin-api/src/lib/invites.ts). */
export type InviteListStatus = 'sending' | 'failed' | 'invited' | 'active' | 'expired' | 'revoked';
export const INVITE_STATUSES: InviteListStatus[] = ['invited', 'active', 'expired', 'revoked', 'sending', 'failed'];

export interface InviteChannel {
  id: string;
  name: string;
  handle?: string | null;
  action: 'created' | 'transferred';
  jobId?: string | null;
}

export interface InviteView {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  locale: 'en' | 'ar';
  note: string | null;
  /** The tier the invite gave; null = the current default tier (no creator/viewer role: the tier decides) */
  tierId: string | null;
  /** The video per email language (ids); an email uses its own language's and never the other's */
  videos: { en: string | null; ar: string | null };
  authRoles: string[];
  channels: InviteChannel[];
  status: InviteListStatus;
  delivery: 'sending' | 'sent' | 'failed';
  deliveryError: string | null;
  emailSent: boolean;
  expiresAt: string | null;
  acceptedAt: string | null;
  lastSentAt: string | null;
  sendCount: number;
  pendingOp: string | null;
  opError: string | null;
  createdBy: string;
  createdByEmail: string | null;
  createdAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
  deletedReason: string | null;
  purgeRequestedAt: string | null;
  purgeAfter: string | null;
}

export interface InviteLookup {
  authUser: { id: string; email: string; name: string | null; status: string } | null;
  profile: { id: string; displayName: string | null } | null;
  invite: InviteView | null;
}

export interface NewInviteInput {
  email: string;
  name?: string;
  tierId?: string | null;
  /** A public video per email language, shown in the email as a picture card linking to it */
  videos?: { en: string | null; ar: string | null };
  authRoles?: string[];
  locale: 'en' | 'ar';
  note?: string;
  expiresInDays?: number;
  channels?: { create: Array<{ name: string; nameLocalized?: { en: string; ar: string }; handle?: string }>; transfer: string[] };
}

/** A video the invite form can attach (admin-api GET /api/invites/videos): public, ready and listed. */
export interface InviteVideoChoice {
  kind: 'video';
  id: string;
  label: string;
  secondary: string | null;
  imageUrl: string | null;
  parentId?: string | null;
  duration: number | null;
}

