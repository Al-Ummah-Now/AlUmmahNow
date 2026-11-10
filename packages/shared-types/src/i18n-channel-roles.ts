/**
 * Per-channel roles (account menu groups, role badges, the channel Team page),
 * en/ar. Shared by the web static fallback and the api-videos translation
 * seed, like i18n-contact.ts. Channel roles are not site roles, so the shared
 * words "admin" and "moderator" always read "Channel admin" / "Channel moderator".
 */

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
  addTitle: string;
  handleLabel: string;
  handlePlaceholder: string;
  roleLabel: string;
  add: string;
  adding: string;
  added: string;
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
    loadFailed: string;
    generic: string;
  };
}

export const CHANNEL_ROLES_EN: ChannelRolesTranslations = {
  roles: { owner: 'Owner', admin: 'Channel admin', editor: 'Editor', moderator: 'Channel moderator' },
  roleHelp: {
    admin: 'Can do everything except change the handle, delete the channel or add other channel admins.',
    editor: 'Uploads, edits and schedules videos.',
    moderator: 'Moderates comments.',
  },
  yourChannels: 'Your channels',
  channelsYouManage: 'Channels you manage',
  yourRole: 'Your role: {role}',
  team: 'Team',
  teamDescription: 'People who help run this channel. A channel role applies to this channel only.',
  teamLoading: 'Loading the team…',
  noMembers: 'No one else has a role on this channel yet.',
  addTitle: 'Add someone',
  handleLabel: 'The @handle of one of their channels',
  handlePlaceholder: '@handle',
  roleLabel: 'Role',
  add: 'Add',
  adding: 'Adding…',
  added: '{name} now has a role on this channel.',
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
    loadFailed: 'We couldn\'t load the team. Please try again.',
    generic: 'Something went wrong. Please try again.',
  },
};

export const CHANNEL_ROLES_AR: ChannelRolesTranslations = {
  roles: { owner: 'المالك', admin: 'مشرف القناة', editor: 'محرر', moderator: 'مراقب القناة' },
  roleHelp: {
    admin: 'يمكنه فعل كل شيء ما عدا تغيير المعرّف أو حذف القناة أو إضافة مشرفين آخرين.',
    editor: 'يرفع الفيديوهات ويعدّلها ويجدولها.',
    moderator: 'يراقب التعليقات.',
  },
  yourChannels: 'قنواتك',
  channelsYouManage: 'القنوات التي تديرها',
  yourRole: 'دورك: {role}',
  team: 'الفريق',
  teamDescription: 'الأشخاص الذين يساعدون في إدارة هذه القناة. دور القناة يخص هذه القناة فقط.',
  teamLoading: 'جارٍ تحميل الفريق…',
  noMembers: 'لا يوجد أحد آخر له دور في هذه القناة بعد.',
  addTitle: 'إضافة شخص',
  handleLabel: 'المعرّف @ لإحدى قنواته',
  handlePlaceholder: '@المعرّف',
  roleLabel: 'الدور',
  add: 'إضافة',
  adding: 'جارٍ الإضافة…',
  added: 'أصبح لـ {name} دور في هذه القناة.',
  changeRole: 'تغيير دور {name}',
  roleSaved: 'تم تحديث الدور.',
  remove: 'إزالة',
  removeConfirm: 'هل تريد إزالة {name} من هذه القناة؟',
  removed: 'تمت الإزالة من الفريق.',
  leave: 'مغادرة هذه القناة',
  leaveConfirm: 'هل تريد مغادرة هذه القناة؟ ستفقد الوصول إليها.',
  you: 'أنت',
  limit: 'حتى {count} شخصًا',
  cannotUpload: 'دورك في هذه القناة لا يسمح برفع الفيديوهات',
  cannotUploadHint: 'اطلب دور المحرر من مالك القناة أو أحد مشرفيها، أو انتقل إلى قناة أخرى.',
  noAccess: 'ليست لديك صلاحية لإدارة هذا.',
  errors: {
    personNotFound: 'لا توجد قناة بهذا المعرّف.',
    alreadyMember: 'لهذا الشخص دور في هذه القناة بالفعل.',
    cannotInviteOwner: 'المالك لديه كل الصلاحيات بالفعل.',
    memberLimit: 'فريق هذه القناة مكتمل.',
    forbidden: 'لا يمكنك إجراء هذا التغيير.',
    loadFailed: 'تعذّر تحميل الفريق. حاول مرة أخرى.',
    generic: 'حدث خطأ ما. حاول مرة أخرى.',
  },
};
