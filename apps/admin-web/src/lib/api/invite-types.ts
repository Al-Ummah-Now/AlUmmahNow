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
  role: 'creator' | 'viewer';
  tierId: string | null;
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
  role: 'creator' | 'viewer';
  tierId?: string | null;
  authRoles?: string[];
  locale: 'en' | 'ar';
  note?: string;
  expiresInDays?: number;
  channels?: { create: Array<{ name: string; handle?: string }>; transfer: string[] };
}
