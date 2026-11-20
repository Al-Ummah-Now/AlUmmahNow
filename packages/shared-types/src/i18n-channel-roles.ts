/**
 * Per-channel roles (account menu groups, role badges, the channel Team page),
 * en/ar. Shared by the web static fallback and the api-videos translation
 * seed, like i18n-contact.ts. Channel roles are not site roles, so the shared
 * words "admin" and "moderator" always read "Channel admin" / "Channel moderator".
 */
import type { PluralTexts } from './i18n-library';

export interface ChannelRolesTranslations {
  roles: { owner: string; admin: string; editor: string; moderator: string };
  roleHelp: { admin: string; editor: string; moderator: string };
  yourChannels: string;
  channelsYouManage: string;
  /** Badge's accessible label, e.g. "Your role: Editor" */
  yourRole: string;
  team: string;
  teamDescription: string;
  teamLoading: string;
  noMembers: string;
  tabTeam: string;
  tabActivity: string;
  inviteTitle: string;
  inviteLabel: string;
  invitePlaceholder: string;
  roleLabel: string;
  invite: string;
  inviting: string;
  invited: string;
  pendingTitle: string;
  /** "Editor · expires in {days} days" */
  /** CLDR plural table on the days left: `{count}` days, `{role}` the role */
  pendingMeta: PluralTexts;
  pendingMetaToday: string;
  cancelInvite: string;
  cancelInviteLabel: string;
  inviteCancelled: string;
  activityLoading: string;
  noActivity: string;
  loadMore: string;
  /** Activity lines: {actor}, {target}, {role}, {oldRole} */
  activity: {
    invite_sent: string;
    invite_sent_email: string;
    invite_cancelled: string;
    invite_accepted: string;
    invite_declined: string;
    invite_expired: string;
    role_changed: string;
    member_removed: string;
    member_left: string;
    member_removed_account_deleted: string;
    transfer_kept_old_owner: string;
    video_deleted: string;
    channel_edited: string;
    stream_key_rotated: string;
    comment_removed: string;
    post_deleted: string;
  };
  someone: string;
  deletedAccount: string;
  invitations: string;
  invitationsCount: string;
  invitationsTitle: string;
  invitationsDescription: string;
  invitationsLoading: string;
  noInvitations: string;
  /** "{inviter} invited you as {role}" */
  invitedBy: string;
  /** CLDR plural table on the days left (`{count}`) */
  expiresIn: PluralTexts;
  expiresToday: string;
  accept: string;
  decline: string;
  accepted: string;
  declined: string;
  openChannel: string;
  changeRole: string;
  roleSaved: string;
  remove: string;
  removeConfirm: string;
  removed: string;
  leave: string;
  leaveConfirm: string;
  you: string;
  limit: string;
  cannotUpload: string;
  cannotUploadHint: string;
  noAccess: string;
  errors: {
    personNotFound: string;
    alreadyMember: string;
    cannotInviteOwner: string;
    memberLimit: string;
    forbidden: string;
    alreadyInvited: string;
    pendingLimit: string;
    rateLimited: string;
    sharedLimit: string;
    inviteNotFound: string;
    invalidEmail: string;
    loadFailed: string;
    generic: string;
  };
}

export const CHANNEL_ROLES_EN: ChannelRolesTranslations = {
  roles: { owner: 'Owner', admin: 'Channel admin', editor: 'Editor', moderator: 'Channel moderator' },
  roleHelp: {
    admin: 'Can do everything except change the handle, delete the channel or add other channel admins.',
    editor: 'Uploads, edits and schedules videos, and manages posts and playlists. Deletes only their own uploads.',
    moderator: 'Moderates comments on videos and posts.',
  },
  yourChannels: 'Your channels',
  channelsYouManage: 'Channels you manage',
  yourRole: 'Your role: {role}',
  team: 'Team',
  teamDescription: 'People who help run this channel. A channel role applies to this channel only.',
  teamLoading: 'Loading the team…',
  noMembers: 'No one else has a role on this channel yet.',
  tabTeam: 'Team',
  tabActivity: 'Activity',
  inviteTitle: 'Invite someone',
  inviteLabel: 'Email or @handle',
  invitePlaceholder: 'name@example.com or @handle',
  roleLabel: 'Role',
  invite: 'Send invitation',
  inviting: 'Sending…',
  invited: 'Invitation sent. They get the role when they accept.',
  pendingTitle: 'Pending invitations',
  pendingMeta: { one: '{role} • expires in 1 day', other: '{role} • expires in {count} days' },
  pendingMetaToday: '{role} • expires today',
  cancelInvite: 'Cancel',
  cancelInviteLabel: 'Cancel the invitation for {name}',
  inviteCancelled: 'Invitation cancelled.',
  activityLoading: 'Loading activity…',
  noActivity: 'No team activity yet.',
  loadMore: 'Show more',
  activity: {
    invite_sent: '{actor} invited {target} as {role}',
    invite_sent_email: '{actor} invited someone by email as {role}',
    invite_cancelled: '{actor} cancelled the invitation for {target}',
    invite_accepted: '{actor} joined as {role}',
    invite_declined: '{actor} declined the invitation',
    invite_expired: 'An invitation as {role} expired',
    role_changed: '{actor} changed {target} from {oldRole} to {role}',
    member_removed: '{actor} removed {target}',
    member_left: '{actor} left the channel',
    member_removed_account_deleted: '{target} was removed because their account was deleted',
    transfer_kept_old_owner: '{target} stayed on as channel admin after the ownership transfer',
    video_deleted: '{actor} deleted a video',
    channel_edited: '{actor} edited the channel',
    stream_key_rotated: 'The live stream key was replaced after {target} lost access',
    comment_removed: '{actor} removed a comment',
    post_deleted: '{actor} deleted a post',
  },
  someone: 'someone',
  deletedAccount: 'a deleted account',
  invitations: 'Channel invitations',
  invitationsCount: 'Channel invitations ({count})',
  invitationsTitle: 'Channel invitations',
  invitationsDescription: 'Channels that invited you to help run them. You get the role only when you accept.',
  invitationsLoading: 'Loading invitations…',
  noInvitations: 'You have no channel invitations.',
  invitedBy: '{inviter} invited you as {role}',
  expiresIn: { one: 'Expires in 1 day', other: 'Expires in {count} days' },
  expiresToday: 'Expires today',
  accept: 'Accept',
  decline: 'Decline',
  accepted: 'You joined {channel} as {role}.',
  declined: 'Invitation declined.',
  openChannel: 'Open the channel',
  changeRole: 'Change role for {name}',
  roleSaved: 'Role updated.',
  remove: 'Remove',
  removeConfirm: 'Remove {name} from this channel?',
  removed: 'Removed from the team.',
  leave: 'Leave this channel',
  leaveConfirm: 'Leave this channel? You will lose access to it.',
  you: 'You',
  limit: 'Up to {count} people',
  cannotUpload: 'Your role on this channel can\'t upload videos',
  cannotUploadHint: 'Ask the channel owner or a channel admin for the editor role, or switch to another channel.',
  noAccess: 'You don\'t have permission to manage this.',
  errors: {
    personNotFound: 'No channel has that handle.',
    alreadyMember: 'This person already has a role on this channel.',
    cannotInviteOwner: 'The owner already has every permission.',
    memberLimit: 'This channel\'s team is full.',
    forbidden: 'You can\'t make this change.',
    alreadyInvited: 'This person already has a pending invitation.',
    pendingLimit: 'This channel has too many pending invitations. Cancel some first.',
    rateLimited: 'Too many invitations sent. Try again later.',
    sharedLimit: 'You already help run the most channels allowed (50).',
    inviteNotFound: 'This invitation is no longer open.',
    invalidEmail: 'Enter a valid email address or an @handle.',
    loadFailed: 'We couldn\'t load the team. Please try again.',
    generic: 'Something went wrong. Please try again.',
  },
};

export const CHANNEL_ROLES_AR: ChannelRolesTranslations = {
  roles: { owner: 'المالك', admin: 'مشرف القناة', editor: 'محرر', moderator: 'مراقب القناة' },
  roleHelp: {
    admin: 'يمكنه فعل كل شيء ما عدا تغيير المعرّف أو حذف القناة أو إضافة مشرفين آخرين.',
    editor: 'يرفع المرئيات ويعدّلها ويجدولها، ويدير المنشورات وقوائم التشغيل. لا يحذف إلا ما رفعه بنفسه.',
    moderator: 'يراقب التعليقات على المرئيات والمنشورات.',
  },
  yourChannels: 'قنواتك',
  channelsYouManage: 'القنوات التي تديرها',
  yourRole: 'دورك: {role}',
  team: 'الفريق',
  teamDescription: 'الأشخاص الذين يساعدون في إدارة هذه القناة. دور القناة يخص هذه القناة فقط.',
  teamLoading: 'جارٍ تحميل الفريق…',
  noMembers: 'لا يوجد أحد آخر له دور في هذه القناة بعد.',
  tabTeam: 'الفريق',
  tabActivity: 'النشاط',
  inviteTitle: 'دعوة شخص',
  inviteLabel: 'البريد الإلكتروني أو المعرّف @',
  invitePlaceholder: 'name@example.com أو ‎@handle',
  roleLabel: 'الدور',
  invite: 'إرسال الدعوة',
  inviting: 'جارٍ الإرسال…',
  invited: 'أُرسلت الدعوة. يحصل على الدور عندما يقبلها.',
  pendingTitle: 'دعوات معلّقة',
  pendingMeta: { one: '{role} • تنتهي بعد يوم', two: '{role} • تنتهي بعد يومين', few: '{role} • تنتهي بعد {count} أيام', many: '{role} • تنتهي بعد {count} يومًا', other: '{role} • تنتهي بعد {count} يوم' },
  pendingMetaToday: '{role} • تنتهي اليوم',
  cancelInvite: 'إلغاء',
  cancelInviteLabel: 'إلغاء دعوة {name}',
  inviteCancelled: 'أُلغيت الدعوة.',
  activityLoading: 'جارٍ تحميل النشاط…',
  noActivity: 'لا يوجد نشاط للفريق بعد.',
  loadMore: 'عرض المزيد',
  activity: {
    invite_sent: 'دعا {actor} {target} بدور {role}',
    invite_sent_email: 'دعا {actor} شخصًا عبر البريد الإلكتروني بدور {role}',
    invite_cancelled: 'ألغى {actor} دعوة {target}',
    invite_accepted: 'انضم {actor} بدور {role}',
    invite_declined: 'رفض {actor} الدعوة',
    invite_expired: 'انتهت صلاحية دعوة بدور {role}',
    role_changed: 'غيّر {actor} دور {target} من {oldRole} إلى {role}',
    member_removed: 'أزال {actor} {target}',
    member_left: 'غادر {actor} القناة',
    member_removed_account_deleted: 'أُزيل {target} لأن حسابه حُذف',
    transfer_kept_old_owner: 'بقي {target} مشرفًا للقناة بعد نقل الملكية',
    video_deleted: 'حذف {actor} مرئيًا',
    channel_edited: 'عدّل {actor} القناة',
    stream_key_rotated: 'استُبدل مفتاح البث المباشر بعد أن فقد {target} الوصول',
    comment_removed: 'أزال {actor} تعليقًا',
    post_deleted: 'حذف {actor} منشورًا',
  },
  someone: 'شخص',
  deletedAccount: 'حساب محذوف',
  invitations: 'دعوات القنوات',
  invitationsCount: 'دعوات القنوات ({count})',
  invitationsTitle: 'دعوات القنوات',
  invitationsDescription: 'قنوات دعتك للمساعدة في إدارتها. لا تحصل على الدور إلا عندما تقبل.',
  invitationsLoading: 'جارٍ تحميل الدعوات…',
  noInvitations: 'ليست لديك دعوات من قنوات.',
  invitedBy: 'دعاك {inviter} بدور {role}',
  expiresIn: { one: 'تنتهي بعد يوم', two: 'تنتهي بعد يومين', few: 'تنتهي بعد {count} أيام', many: 'تنتهي بعد {count} يومًا', other: 'تنتهي بعد {count} يوم' },
  expiresToday: 'تنتهي اليوم',
  accept: 'قبول',
  decline: 'رفض',
  accepted: 'انضممت إلى {channel} بدور {role}.',
  declined: 'رُفضت الدعوة.',
  openChannel: 'فتح القناة',
  changeRole: 'تغيير دور {name}',
  roleSaved: 'تم تحديث الدور.',
  remove: 'إزالة',
  removeConfirm: 'هل تريد إزالة {name} من هذه القناة؟',
  removed: 'تمت الإزالة من الفريق.',
  leave: 'مغادرة هذه القناة',
  leaveConfirm: 'هل تريد مغادرة هذه القناة؟ ستفقد الوصول إليها.',
  you: 'أنت',
  limit: 'حتى {count} شخصًا',
  cannotUpload: 'دورك في هذه القناة لا يسمح برفع المرئيات',
  cannotUploadHint: 'اطلب دور المحرر من مالك القناة أو أحد مشرفيها، أو انتقل إلى قناة أخرى.',
  noAccess: 'ليست لديك صلاحية لإدارة هذا.',
  errors: {
    personNotFound: 'لا توجد قناة بهذا المعرّف.',
    alreadyMember: 'لهذا الشخص دور في هذه القناة بالفعل.',
    cannotInviteOwner: 'المالك لديه كل الصلاحيات بالفعل.',
    memberLimit: 'فريق هذه القناة مكتمل.',
    forbidden: 'لا يمكنك إجراء هذا التغيير.',
    alreadyInvited: 'لهذا الشخص دعوة معلّقة بالفعل.',
    pendingLimit: 'لدى هذه القناة دعوات معلّقة كثيرة. ألغِ بعضها أولًا.',
    rateLimited: 'أُرسلت دعوات كثيرة. حاول لاحقًا.',
    sharedLimit: 'أنت تساعد بالفعل في إدارة الحد الأقصى من القنوات (٥٠).',
    inviteNotFound: 'هذه الدعوة لم تعد متاحة.',
    invalidEmail: 'أدخل بريدًا إلكترونيًا صحيحًا أو معرّفًا @.',
    loadFailed: 'تعذّر تحميل الفريق. حاول مرة أخرى.',
    generic: 'حدث خطأ ما. حاول مرة أخرى.',
  },
};
