/**
 * One error envelope for every API we own (wiki AUN-FEATURES §5.2, decision O40; owner 2026-11-22:
 * errors from the server must show properly "even when a client doesn't support them yet").
 *
 *   { success: false, code, message, lang, action, retryAfter?, helpUrl?, reference?, feature?,
 *     error (old clients), errors (chanfana field list, 400s) }
 *
 * - `code` is stable snake_case; clients branch on it, never on the text.
 * - `message` is a whole sentence for a person, in `lang`, from the catalogue below, never from an
 *   exception, a binding or a provider: no internals reach users.
 * - A client that doesn't know `code` shows `message` as sent, with the button for `action`.
 * - The status code never changes; `feature_off` stays 404.
 *
 * `buildErrorEnvelope` is pure: each worker's response middleware calls it for every
 * `success: false` JSON answer, so endpoints written before the envelope get it too.
 */
import { featureOffMessage, isFeatureKey, type FeatureKey } from './feature-registry';

export type ApiErrorLang = 'en' | 'ar';
export const API_ERROR_ACTIONS = ['retry', 'sign_in', 'update_app', 'contact_support', 'none'] as const;
export type ApiErrorAction = (typeof API_ERROR_ACTIONS)[number];

export interface ApiErrorBody {
  success: false;
  code: string;
  message: string;
  lang: ApiErrorLang;
  action: ApiErrorAction;
  retryAfter?: number;
  helpUrl?: string;
  reference?: string;
  feature?: FeatureKey;
  /** Kept for clients written before the envelope (its old value) */
  error?: unknown;
  /** chanfana's field list on validation errors */
  errors?: unknown;
  [extra: string]: unknown;
}

/** What an endpoint may add to an error besides its code; the envelope fills in the rest. */
export interface ApiErrorExtra {
  feature?: FeatureKey;
  retryAfter?: number;
  helpUrl?: string;
  /** The old `error` value, for clients written before the envelope that read it */
  error?: string;
  [extra: string]: unknown;
}

/**
 * The body an endpoint answers with on an error (wiki AUN-FEATURES §5.2): `success: false`, a
 * catalogue code and anything extra. The error envelope middleware adds `message`, `lang` and
 * `action`. Workers answer through their `apiError(c, status, code, extra)` helper, never a
 * hand-written `{ success: false, ... }` (scripts/ci/check-error-bodies.ts).
 */
export function apiErrorBody(code: string, extra: ApiErrorExtra = {}): { success: false; code: string } & ApiErrorExtra {
  return { ...extra, success: false, code };
}

interface CatalogueEntry {
  action: ApiErrorAction;
  en: string;
  ar: string;
}

/** Messages by code. Codes may be added, never renamed. */
export const API_ERROR_CATALOGUE: Readonly<Record<string, CatalogueEntry>> = Object.freeze({
  // 400 family
  bad_request: { action: 'none', en: 'Something in this request isn’t right. Check it and try again.', ar: 'في هذا الطلب ما لا يصح. راجعه وحاول مرة أخرى.' },
  invalid_request: { action: 'none', en: 'Some details aren’t right. Check them and try again.', ar: 'بعض التفاصيل غير صحيحة. راجعها وحاول مرة أخرى.' },
  validation_error: { action: 'none', en: 'Some details aren’t right. Check them and try again.', ar: 'بعض التفاصيل غير صحيحة. راجعها وحاول مرة أخرى.' },
  not_official_handle: { action: 'none', en: 'Only a handle on the official list can be taken back.', ar: 'لا يُستعاد إلا معرّف من القائمة الرسمية.' },
  official_handle_take_back: { action: 'none', en: 'Official handles are given with Take back handle.', ar: 'تُمنح المعرّفات الرسمية عبر «استعادة المعرّف».' },
  // Channel move offers (wiki AUN-CHANNEL-CLAIM §5). move_* where another route has its own use of the plain code
  move_not_owner: { action: 'none', en: 'Only the channel owner can move it.', ar: 'لا ينقل القناة إلا مالكها.' },
  move_already_owner: { action: 'none', en: 'That account already owns this channel.', ar: 'هذا الحساب يملك القناة بالفعل.' },
  reauth_required: { action: 'sign_in', en: 'Sign in again to continue.', ar: 'سجّل الدخول مرة أخرى للمتابعة.' },
  move_confirm_mismatch: { action: 'none', en: 'Type the channel’s @handle to confirm.', ar: 'اكتب معرّف القناة لتأكيد النقل.' },
  receiver_not_channel_admin: { action: 'none', en: 'A channel can only go to one of its admins.', ar: 'لا تُنقل القناة إلا إلى أحد مشرفيها.' },
  official_handle: { action: 'none', en: 'A channel with an official handle is moved by the team.', ar: 'القناة ذات المعرّف الرسمي ينقلها الفريق.' },
  move_in_progress: { action: 'none', en: 'This channel is already being moved. Try again once that finishes.', ar: 'يجري نقل هذه القناة بالفعل. حاول مرة أخرى بعد انتهائه.' },
  move_channel_live: { action: 'none', en: 'This channel is live now. Try again after the broadcast ends.', ar: 'هذه القناة تبث مباشرةً الآن. حاول مرة أخرى بعد انتهاء البث.' },
  move_channel_has_support: { action: 'none', en: 'A channel that receives creator support can’t be moved this way.', ar: 'لا يمكن نقل قناة تتلقى دعمًا لصانع المحتوى بهذه الطريقة.' },
  move_channel_suspended: { action: 'none', en: 'This channel is suspended, so it can’t be moved.', ar: 'هذه القناة موقوفة، فلا يمكن نقلها.' },
  channel_under_review: { action: 'none', en: 'A report about this channel is under review, so it can’t be moved now.', ar: 'بلاغ عن هذه القناة قيد المراجعة، فلا يمكن نقلها الآن.' },
  move_check_unavailable: { action: 'retry', en: 'We couldn’t check this channel just now, so it wasn’t moved. Please try again shortly.', ar: 'تعذّر فحص هذه القناة الآن، فلم تُنقل. يُرجى المحاولة بعد قليل.' },
  move_receiver_not_allowed: { action: 'none', en: 'That account can’t receive a channel.', ar: 'لا يمكن لهذا الحساب استلام قناة.' },
  move_receiver_channel_limit: { action: 'none', en: 'That account already has as many channels as it can.', ar: 'لدى هذا الحساب أقصى عدد من القنوات المسموح له.' },
  moved_recently: { action: 'none', en: 'This channel was moved less than 30 days ago.', ar: 'نُقلت هذه القناة قبل أقل من ٣٠ يومًا.' },
  offer_open: { action: 'none', en: 'This channel already has an open offer.', ar: 'لهذه القناة عرض مفتوح بالفعل.' },
  offer_not_found: { action: 'none', en: 'This offer is no longer open.', ar: 'لم يعد هذا العرض مفتوحًا.' },
  owner_changed: { action: 'none', en: 'The channel’s owner changed since the offer was made.', ar: 'تغيّر مالك القناة منذ تقديم العرض.' },
  transfer_reason_required: { action: 'none', en: 'Give a reason of 10 to 500 characters.', ar: 'اكتب سببًا من ١٠ إلى ٥٠٠ حرف.' },
  unauthorized: { action: 'sign_in', en: 'Please sign in again.', ar: 'يُرجى تسجيل الدخول مرة أخرى.' },
  authentication_required: { action: 'sign_in', en: 'Please sign in to continue.', ar: 'يُرجى تسجيل الدخول للمتابعة.' },
  token_expired: { action: 'sign_in', en: 'Your session has ended. Please sign in again.', ar: 'انتهت جلستك. يُرجى تسجيل الدخول مرة أخرى.' },
  forbidden: { action: 'none', en: 'You don’t have permission to do this.', ar: 'ليست لديك صلاحية للقيام بهذا.' },
  not_found: { action: 'none', en: 'We couldn’t find what you were looking for.', ar: 'لم نعثر على ما تبحث عنه.' },
  video_not_found: { action: 'none', en: 'This video isn’t available.', ar: 'هذا المرئي غير متاح.' },
  channel_not_found: { action: 'none', en: 'This channel isn’t available.', ar: 'هذه القناة غير متاحة.' },
  playlist_not_found: { action: 'none', en: 'This playlist isn’t available.', ar: 'قائمة التشغيل هذه غير متاحة.' },
  method_not_allowed: { action: 'none', en: 'This action isn’t possible here.', ar: 'لا يمكن القيام بهذا الإجراء هنا.' },
  conflict: { action: 'retry', en: 'This changed while you were working on it. Reload and try again.', ar: 'تغيّر هذا أثناء عملك عليه. أعد التحميل وحاول مرة أخرى.' },
  feature_precondition: { action: 'none', en: 'This can’t be turned on yet.', ar: 'لا يمكن تشغيل هذا بعد.' },
  feature_changed: { action: 'none', en: 'Someone else changed this a moment ago.', ar: 'غيّر شخص آخر هذا قبل لحظات.' },
  payload_too_large: { action: 'none', en: 'This is too large to send.', ar: 'هذا أكبر من أن يُرسل.' },
  rate_limited: { action: 'retry', en: 'That was a lot of requests in a short time. Please wait a moment and try again.', ar: 'كانت هذه طلبات كثيرة في وقت قصير. يُرجى الانتظار قليلًا ثم المحاولة مرة أخرى.' },
  download_rate_limited: { action: 'retry', en: 'You’ve reached the download rate limit. Please wait a while and try again.', ar: 'وصلت إلى الحد المسموح به لطلبات التنزيل. يُرجى الانتظار قليلًا ثم المحاولة مرة أخرى.' },
  human_check_failed: { action: 'retry', en: 'We couldn’t confirm you’re a person. Please try again.', ar: 'لم نتمكن من التأكد من أنك شخص. يُرجى المحاولة مرة أخرى.' },
  unsupported_api_version: { action: 'update_app', en: 'This version of the app is no longer supported. Please update it.', ar: 'لم يعد هذا الإصدار من التطبيق مدعومًا. يُرجى تحديثه.' },
  app_update_required: { action: 'update_app', en: 'Please update the app to continue.', ar: 'يُرجى تحديث التطبيق للمتابعة.' },
  // Feature switches (the message comes from the registry entry; this is the fallback)
  feature_off: { action: 'none', en: 'This feature isn’t available right now.', ar: 'هذه الميزة غير متاحة الآن.' },
  // Creator Terms gate (Play UGC policy)
  terms_required: { action: 'none', en: 'Please review and accept the Terms of Service and Community Guidelines before continuing.', ar: 'يُرجى مراجعة شروط الاستخدام وإرشادات المجتمع والموافقة عليها قبل المتابعة.' },
  terms_version_changed: { action: 'retry', en: 'The Terms of Service were updated. Please review and accept the latest version.', ar: 'تم تحديث شروط الاستخدام. يُرجى مراجعة أحدث إصدار والموافقة عليه.' },
  // Live chat (wiki E17)
  live_chat_empty: { action: 'none', en: 'Write a message first.', ar: 'اكتب رسالة أولًا.' },
  live_chat_too_long: { action: 'none', en: 'This message is too long.', ar: 'هذه الرسالة طويلة جدًا.' },
  live_chat_link: { action: 'none', en: 'Links can’t be sent in this chat.', ar: 'لا يمكن إرسال الروابط في هذه المحادثة.' },
  live_chat_blocked_word: { action: 'none', en: 'This message can’t be sent. Please change the wording.', ar: 'لا يمكن إرسال هذه الرسالة. يُرجى تغيير الصياغة.' },
  live_chat_subscribers_only: { action: 'none', en: 'Only the channel’s subscribers can write here.', ar: 'الكتابة هنا للمشتركين في القناة فقط.' },
  live_chat_slow_mode: { action: 'retry', en: 'Please wait a moment before your next message.', ar: 'يُرجى الانتظار قليلًا قبل رسالتك التالية.' },
  live_chat_duplicate: { action: 'none', en: 'You just sent this message.', ar: 'أرسلت هذه الرسالة قبل قليل.' },
  live_chat_cannot_block: { action: 'none', en: 'This person can’t be blocked here.', ar: 'لا يمكن حظر هذا الشخص هنا.' },
  // Premieres (wiki E17)
  premiere_bad_time: { action: 'none', en: 'Choose a time from 5 minutes to a year ahead.', ar: 'اختر وقتًا بعد ٥ دقائق على الأقل وخلال سنة.' },
  premiere_video_unsuitable: { action: 'none', en: 'This video can’t be shown as a premiere.', ar: 'لا يمكن عرض هذا المرئي عرضًا أول.' },
  premiere_video_not_ready: { action: 'none', en: 'This video isn’t ready yet.', ar: 'هذا المرئي ليس جاهزًا بعد.' },
  premiere_video_already_open: { action: 'none', en: 'People can already watch this video, so it can’t be a premiere.', ar: 'هذا المرئي متاح للمشاهدة بالفعل، فلا يمكن عرضه عرضًا أول.' },
  premiere_video_scheduled: { action: 'none', en: 'This video has a publish date. Cancel it first.', ar: 'لهذا المرئي موعد نشر. ألغه أولًا.' },
  premiere_exists: { action: 'none', en: 'This video already has a premiere.', ar: 'لهذا المرئي عرض أول بالفعل.' },
  premiere_scheduled: { action: 'none', en: 'This video is waiting for its premiere. Cancel the premiere first.', ar: 'ينتظر هذا المرئي عرضه الأول. ألغِ العرض الأول أولًا.' },
  premiere_started: { action: 'none', en: 'This premiere has already started.', ar: 'بدأ هذا العرض الأول بالفعل.' },
  live_stream_removed: { action: 'none', en: 'A moderator removed this live stream.', ar: 'أزال أحد المشرفين هذا البث.' },
  premiere_not_startable: { action: 'retry', en: 'This premiere can’t start right now.', ar: 'لا يمكن بدء هذا العرض الأول الآن.' },
  premiere_no_ingest: { action: 'none', en: 'A premiere plays an uploaded video, so there’s nothing to stream.', ar: 'يعرض العرض الأول مرئيًا مرفوعًا، فلا يوجد ما يُبث.' },
  premiere_fixed: { action: 'none', en: 'This can’t be changed on a premiere.', ar: 'لا يمكن تغيير هذا في عرض أول.' },
  // Creator support (wiki AUN-MEMBERS): Studio › Support payout setup
  support_invalid_country: { action: 'none', en: 'Choose the country your bank account or wallet is in.', ar: 'اختر الدولة التي يوجد فيها حسابك المصرفي أو محفظتك.' },
  support_decision_open: { action: 'none', en: 'Payouts can’t be set up yet.', ar: 'لا يمكن إعداد استلام الدفعات بعد.' },
  support_country_blocked: { action: 'none', en: 'Payouts aren’t available in this country.', ar: 'استلام الدفعات غير متاح في هذه الدولة.' },
  support_country_waitlist: { action: 'none', en: 'Payouts aren’t available in this country yet. We’ll let you know when they are.', ar: 'استلام الدفعات غير متاح في هذه الدولة بعد. سنخبرك عندما يتاح.' },
  support_country_external_link_only: { action: 'none', en: 'Payouts through Al Ummah Now aren’t available in this country.', ar: 'استلام الدفعات عبر الأمة الآن غير متاح في هذه الدولة.' },
  support_no_rail_for_country: { action: 'none', en: 'No payout service we use reaches this country yet.', ar: 'لا تصل أيٌّ من خدمات الدفع التي نستخدمها إلى هذه الدولة بعد.' },
  support_rail_unavailable: { action: 'retry', en: 'The payout service didn’t answer. Please try again in a moment.', ar: 'لم تستجب خدمة الدفع. يُرجى المحاولة بعد قليل.' },
  support_no_payee: { action: 'none', en: 'Set up payouts first.', ar: 'أعدّ استلام الدفعات أولًا.' },
  // Creator support: the support sheet and Settings › Support (wiki AUN-MEMBERS §11)
  support_amount_too_small: { action: 'none', en: 'Choose a larger amount.', ar: 'اختر مبلغًا أكبر.' },
  support_currency_unavailable: { action: 'none', en: 'Support isn’t available in this currency.', ar: 'الدعم غير متاح بهذه العملة.' },
  support_age_required: { action: 'none', en: 'Confirm you’re old enough to send support.', ar: 'أكّد أنك بلغت السن التي تسمح لك بإرسال الدعم.' },
  support_consent_required: { action: 'none', en: 'Tick the box to agree to the monthly charge.', ar: 'حدّد المربع للموافقة على الاقتطاع الشهري.' },
  support_message_too_long: { action: 'none', en: 'Your message is too long.', ar: 'رسالتك طويلة جدًا.' },
  support_pledge_ended: { action: 'retry', en: 'We couldn’t stop this monthly support right now. Please try again in a moment.', ar: 'تعذّر إيقاف هذا الدعم الشهري الآن. يُرجى المحاولة بعد قليل.' },
  // Creator support admin (wiki AUN-MEMBERS §9.6): finance list, payouts, settings
  support_not_finance: { action: 'none', en: 'Only people on the organization’s finance list can do this.', ar: 'لا يقوم بهذا إلا من هم في قائمة المالية في المؤسسة.' },
  support_tech_staff: { action: 'none', en: 'Tech staff can’t be on the finance list or hold money permissions.', ar: 'لا يمكن أن يكون فريق التقنية في قائمة المالية أو أن يملك صلاحيات الأموال.' },
  // Approval workflows (wiki AUN-WORKFLOWS §8; same text as WORKFLOW_ERROR_MESSAGES)
  change_pending: { action: 'none', en: 'A change to this is already waiting for approval.', ar: 'هناك تغيير على هذا ينتظر الموافقة بالفعل.' },
  approval_not_allowed: { action: 'none', en: 'You can’t approve or reject this request.', ar: 'لا يمكنك الموافقة على هذا الطلب أو رفضه.' },
  propose_not_allowed: { action: 'none', en: 'You can’t propose this change.', ar: 'لا يمكنك اقتراح هذا التغيير.' },
  request_closed: { action: 'none', en: 'This request is already closed.', ar: 'هذا الطلب مُغلق بالفعل.' },
  request_stale: { action: 'none', en: 'This changed since the request was made. Propose it again with the current values.', ar: 'تغيّر هذا منذ تقديم الطلب. اقترحه مرة أخرى بالقيم الحالية.' },
  version_conflict: { action: 'retry', en: 'Someone else acted on this request a moment ago. It has been refreshed.', ar: 'تصرّف شخص آخر في هذا الطلب قبل لحظات. جرى تحديثه.' },
  rule_below_floor: { action: 'none', en: 'This rule can’t be set lower than its minimum.', ar: 'لا يمكن ضبط هذه القاعدة أقل من حدّها الأدنى.' },
  rule_invalid: { action: 'none', en: 'Check the rule’s values.', ar: 'راجِع قيم القاعدة.' },
  nobody_can_approve: { action: 'none', en: 'Nobody can approve this yet.', ar: 'لا أحد يستطيع الموافقة على هذا بعد.' },
  support_same_person: { action: 'none', en: 'A second person has to do this.', ar: 'يجب أن يقوم بهذا شخص ثانٍ.' },
  support_not_clean: { action: 'none', en: 'The last reconciliation has a gap or hasn’t run, so payouts are stopped.', ar: 'في آخر مطابقة فرق أو لم تُجرَ بعد، لذا توقفت التحويلات.' },
  support_held: { action: 'none', en: 'All payouts are on hold.', ar: 'جميع التحويلات موقوفة.' },
  support_already_approved: { action: 'none', en: 'You already approved this, or you prepared it.', ar: 'سبق أن اعتمدت هذا، أو أنك من أعدّه.' },
  support_wrong_status: { action: 'retry', en: 'This changed while you were looking at it. Reload and try again.', ar: 'تغيّر هذا أثناء اطلاعك عليه. أعد التحميل وحاول مرة أخرى.' },
  support_exists: { action: 'none', en: 'A payout batch for this period already exists.', ar: 'توجد دفعة تحويلات لهذه الفترة بالفعل.' },
  support_not_built: { action: 'none', en: 'This option isn’t available yet.', ar: 'هذا الخيار غير متاح بعد.' },
  // Social import sources (wiki TOOLS-ADMIN TA-9, super admins)
  invalid_address: { action: 'none', en: 'We can’t import from this address. Check it and try again.', ar: 'لا يمكن الاستيراد من هذا العنوان. راجعه وحاول مرة أخرى.' },
  not_connected: { action: 'none', en: 'The channel’s owner hasn’t connected this account.', ar: 'لم يربط صاحب القناة هذا الحساب.' },
  permission_required: { action: 'none', en: 'Record whose written permission you have, with a note.', ar: 'سجّل صاحب الإذن الكتابي الذي لديك، مع ملاحظة.' },
  source_exists: { action: 'none', en: 'This channel already imports from this address.', ar: 'تستورد هذه القناة من هذا العنوان بالفعل.' },
  source_not_found: { action: 'none', en: 'We couldn’t find this source.', ar: 'لم نعثر على هذا المصدر.' },
  job_not_found: { action: 'none', en: 'This job isn’t available.', ar: 'هذه المهمة غير متاحة.' },
  channel_unavailable: { action: 'none', en: 'This channel can’t take imports right now.', ar: 'لا يمكن لهذه القناة استقبال الاستيراد الآن.' },
  source_unreachable: { action: 'retry', en: 'The source didn’t answer. Please try again later.', ar: 'لم يستجب المصدر. يُرجى المحاولة لاحقًا.' },
  source_bad_response: { action: 'retry', en: 'The source sent an answer we can’t use.', ar: 'أرسل المصدر ردًّا لا يمكننا استخدامه.' },
  source_not_a_feed: { action: 'none', en: 'This address isn’t an RSS or Atom feed.', ar: 'هذا العنوان ليس موجزًا يمكن الاستيراد منه.' },
  source_forbidden: { action: 'none', en: 'The source refused access to this address.', ar: 'رفض المصدر الوصول إلى هذا العنوان.' },
  // YouTube Takeout files for a social import source (wiki TOOLS-ADMIN TA-9/TA-13)
  not_youtube: { action: 'none', en: 'Takeout files are only for YouTube sources.', ar: 'ملفات النسخة المصدَّرة لمصادر يوتيوب فقط.' },
  file_not_found: { action: 'none', en: 'We couldn’t find this file.', ar: 'لم نعثر على هذا الملف.' },
  not_a_candidate: { action: 'none', en: 'This file can’t belong to that record. Choose one of the suggested records.', ar: 'لا يمكن أن يعود هذا الملف إلى ذلك السجل. اختر أحد السجلات المقترحة.' },
  not_ambiguous: { action: 'none', en: 'This file doesn’t need a choice.', ar: 'لا يحتاج هذا الملف إلى اختيار.' },
  file_taken: { action: 'none', en: 'Another file already matched that record.', ar: 'طابق ملف آخر ذلك السجل بالفعل.' },
  not_matched: { action: 'none', en: 'Only a matched file can be uploaded.', ar: 'لا يُرفع إلا ملف تمت مطابقته.' },
  has_file: { action: 'none', en: 'That record already has its video.', ar: 'لذلك السجل مرئي بالفعل.' },
  not_uploading: { action: 'none', en: 'This file isn’t being uploaded.', ar: 'هذا الملف لا يُرفع الآن.' },
  // Content flags (wiki E20)
  content_flags_conflict: { action: 'none', en: 'A video can’t be both age-restricted and made for kids.', ar: 'لا يمكن أن يكون المرئي مقيّدًا بالعمر ومخصصًا للأطفال معًا.' },
  age_restricted_locked: { action: 'none', en: 'Our team set this age restriction, so it can’t be removed here.', ar: 'وضع فريقنا هذا التقييد العمري، لذلك لا يمكن إزالته من هنا.' },
  // 500 family
  server_error: { action: 'retry', en: 'Something on our side failed. We’ve been told, so please try again in a moment.', ar: 'حدث خطأ من جهتنا وأُبلغنا به. يُرجى المحاولة بعد قليل.' },
  internal_error: { action: 'retry', en: 'Something on our side failed. We’ve been told, so please try again in a moment.', ar: 'حدث خطأ من جهتنا وأُبلغنا به. يُرجى المحاولة بعد قليل.' },
  notes_limit: { action: 'none', en: 'You’ve reached the number of notes your plan allows. Delete some notes to add new ones.', ar: 'بلغتَ عدد الملاحظات الذي تسمح به خطتك. احذف بعض الملاحظات لتضيف ملاحظات جديدة.' },
  prayer_provider_unavailable: { action: 'retry', en: 'Prayer times aren’t available right now. Please try again shortly.', ar: 'أوقات الصلاة غير متاحة الآن. يُرجى المحاولة بعد قليل.' },
  service_unavailable: { action: 'retry', en: 'This is unavailable for a moment. Please try again shortly.', ar: 'هذا غير متاح لحظيًا. يُرجى المحاولة بعد قليل.' },
  storage_unavailable: { action: 'retry', en: 'This is unavailable for a moment. Please try again shortly.', ar: 'هذا غير متاح لحظيًا. يُرجى المحاولة بعد قليل.' },
  index_unavailable: { action: 'retry', en: 'This is unavailable for a moment. Please try again shortly.', ar: 'هذا غير متاح لحظيًا. يُرجى المحاولة بعد قليل.' },
  search_unavailable: { action: 'retry', en: 'Search is unavailable for a moment. Please try again shortly.', ar: 'البحث غير متاح لحظيًا. يُرجى المحاولة بعد قليل.' },
});

const CODE_SHAPE = /^[a-z][a-z0-9_]{1,63}$/;

/** The code for a status when the answer names none. */
export function codeForStatus(status: number): string {
  if (status === 400) return 'bad_request';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 405) return 'method_not_allowed';
  if (status === 409) return 'conflict';
  if (status === 413) return 'payload_too_large';
  if (status === 422) return 'invalid_request';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'service_unavailable';
  if (status >= 500) return 'server_error';
  return 'bad_request';
}

function catalogueFor(code: string, status: number): CatalogueEntry {
  return API_ERROR_CATALOGUE[code] ?? API_ERROR_CATALOGUE[codeForStatus(status)];
}

function langOf(value?: string | null): ApiErrorLang | null {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'ar' || v.startsWith('ar-') || v.startsWith('ar_')) return 'ar';
  if (v === 'en' || v.startsWith('en-') || v.startsWith('en_')) return 'en';
  return null;
}

/**
 * The language of an error message: the language the user chose in the app, never the browser's.
 * The app's language header (X-App-Locale), else the request's own `?lang=` or `/ar/`·`/en/` path
 * prefix, else English. Accept-Language is never read: a user on the English interface with an
 * Arabic browser gets English (standing rule, as on short-links).
 */
export function negotiateErrorLang(appLocale?: string | null, url?: string | URL | null): ApiErrorLang {
  const chosen = langOf(appLocale);
  if (chosen) return chosen;
  if (url) {
    let parsed: URL | null = null;
    try {
      parsed = typeof url === 'string' ? new URL(url, 'https://local.invalid') : url;
    } catch {
      parsed = null;
    }
    if (parsed) {
      const fromQuery = langOf(parsed.searchParams.get('lang') ?? parsed.searchParams.get('locale'));
      if (fromQuery) return fromQuery;
      const first = parsed.pathname.split('/')[1] ?? '';
      if (first === 'ar' || first === 'en') return first;
    }
  }
  return 'en';
}

/** The error language of a request (X-App-Locale, else its URL, else English). */
export function errorLangOf(req: Request): ApiErrorLang {
  return negotiateErrorLang(req.headers.get('x-app-locale'), req.url);
}

/** The message for a code in a language (`feature` names the switched-off feature). */
export function apiErrorMessage(code: string, status: number, lang: ApiErrorLang, feature?: string | null): string {
  if (code === 'feature_off') return featureOffMessage(isFeatureKey(feature) ? feature : null, lang);
  return catalogueFor(code, status)[lang];
}

export interface EnvelopeContext {
  status: number;
  lang: ApiErrorLang;
  /** The Retry-After header already on the answer, if any */
  retryAfterHeader?: string | null;
  /** The X-Error-Ref header already on the answer, if any */
  referenceHeader?: string | null;
}

/** True for a JSON body that is an error answer we should fill in. */
export function isErrorBody(status: number, body: unknown): body is Record<string, unknown> {
  if (status < 400 || !body || typeof body !== 'object' || Array.isArray(body)) return false;
  const b = body as Record<string, unknown>;
  if (b.success === false) return true;
  return !('success' in b) && (typeof b.error === 'string' || typeof b.code === 'string');
}

/**
 * Completes an error answer's body. Existing fields stay (old clients read them). The message
 * is the catalogue's for a known code; for a code the catalogue doesn't know, an English
 * endpoint message is kept for English callers and the status fallback is used otherwise, so an
 * Arabic interface never gets English text.
 */
export function buildErrorEnvelope(body: Record<string, unknown>, ctx: EnvelopeContext): ApiErrorBody {
  const { status, lang } = ctx;
  const legacyError = body.error;
  const explicitCode = typeof body.code === 'string' && CODE_SHAPE.test(body.code) ? body.code : null;
  const errorCode = typeof legacyError === 'string' && CODE_SHAPE.test(legacyError) ? legacyError : null;
  const chanfanaErrors = Array.isArray(body.errors);
  const code = explicitCode ?? errorCode ?? (chanfanaErrors && status === 400 ? 'invalid_request' : codeForStatus(status));
  const feature = typeof body.feature === 'string' && isFeatureKey(body.feature) ? body.feature : undefined;

  const known = code === 'feature_off' || code in API_ERROR_CATALOGUE;
  const endpointMessage = typeof body.message === 'string' && body.message.trim() ? body.message : null;
  const alreadyLocalized = body.lang === 'en' || body.lang === 'ar';
  let message: string;
  if (alreadyLocalized && endpointMessage) message = endpointMessage;
  else if (known) message = apiErrorMessage(code, status, lang, feature);
  else if (lang === 'en' && endpointMessage && status < 500) message = endpointMessage;
  else message = apiErrorMessage(code, status, lang);

  const actionRaw = body.action;
  const action: ApiErrorAction = typeof actionRaw === 'string' && (API_ERROR_ACTIONS as readonly string[]).includes(actionRaw)
    ? (actionRaw as ApiErrorAction)
    : code === 'feature_off' ? 'none' : catalogueFor(code, status).action;

  const out: ApiErrorBody = {
    ...body,
    success: false,
    code,
    message,
    lang: alreadyLocalized && endpointMessage ? (body.lang as ApiErrorLang) : lang,
    action,
  };
  if (!('error' in body)) out.error = code;
  // A 5xx keeps no handler text: a code-shaped legacy error stays, anything else is replaced
  if (status >= 500) {
    if (typeof out.error !== 'string' || !CODE_SHAPE.test(out.error)) out.error = 'Internal server error';
    if (!(alreadyLocalized && endpointMessage)) out.message = apiErrorMessage(code, status, lang);
  }
  if (feature) out.feature = feature;
  else delete out.feature;

  const retry = typeof body.retryAfter === 'number' ? body.retryAfter : Number(ctx.retryAfterHeader);
  if (Number.isFinite(retry) && retry > 0) out.retryAfter = Math.ceil(retry);
  else delete out.retryAfter;

  const reference = typeof body.reference === 'string' ? body.reference : ctx.referenceHeader ?? undefined;
  if (reference) out.reference = reference;

  if (typeof body.helpUrl !== 'string' || !/^https:\/\//.test(body.helpUrl)) delete out.helpUrl;
  return out;
}

/** What a client reads from any error answer: never throws; no envelope → no message. */
export interface ParsedApiError {
  status: number;
  code: string;
  message?: string;
  lang?: ApiErrorLang;
  action: ApiErrorAction;
  retryAfter?: number;
  helpUrl?: string;
  reference?: string;
  feature?: FeatureKey;
}

export function parseApiError(status: number, body: unknown): ParsedApiError {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const code = typeof b.code === 'string' && CODE_SHAPE.test(b.code)
    ? b.code
    : typeof b.error === 'string' && CODE_SHAPE.test(b.error) ? b.error : `http_${status}`;
  const lang = b.lang === 'ar' || b.lang === 'en' ? b.lang : undefined;
  const action = typeof b.action === 'string' && (API_ERROR_ACTIONS as readonly string[]).includes(b.action) ? (b.action as ApiErrorAction) : 'none';
  return {
    status,
    code,
    message: lang && typeof b.message === 'string' && b.message.trim() ? b.message : undefined,
    lang,
    action,
    retryAfter: typeof b.retryAfter === 'number' && b.retryAfter > 0 ? b.retryAfter : undefined,
    helpUrl: typeof b.helpUrl === 'string' && /^https:\/\//.test(b.helpUrl) ? b.helpUrl : undefined,
    reference: typeof b.reference === 'string' ? b.reference : undefined,
    feature: typeof b.feature === 'string' && isFeatureKey(b.feature) ? b.feature : undefined,
  };
}

/** The headers an error answer varies on (its message language). */
export const API_ERROR_VARY = 'X-App-Locale';

const MAX_ENVELOPE_BODY = 64 * 1024;

/**
 * Wraps a finished error answer in the envelope (any worker, plain Fetch API). Leaves alone:
 * successes, non-JSON bodies, bodies over 64 KiB and JSON that isn't an error object.
 */
export async function envelopeResponse(res: Response, req: Request): Promise<Response> {
  if (res.status < 400 || !res.body) return res;
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) return res;
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_ENVELOPE_BODY) return res;
  let text: string;
  try {
    text = await res.clone().text();
  } catch {
    return res;
  }
  if (text.length > MAX_ENVELOPE_BODY) return res;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return res;
  }
  if (!isErrorBody(res.status, body)) return res;
  const lang = errorLangOf(req);
  const envelope = buildErrorEnvelope(body, {
    status: res.status,
    lang,
    retryAfterHeader: res.headers.get('retry-after'),
    referenceHeader: res.headers.get('x-error-ref'),
  });
  const headers = new Headers(res.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('content-language', envelope.lang);
  const vary = headers.get('vary');
  const have = new Set((vary ?? '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean));
  if (!have.has('*')) {
    const add = API_ERROR_VARY.split(', ').filter((v) => !have.has(v.toLowerCase()));
    if (add.length) headers.set('vary', [vary, ...add].filter(Boolean).join(', '));
  }
  if (envelope.retryAfter && !headers.has('retry-after')) headers.set('retry-after', String(envelope.retryAfter));
  return new Response(JSON.stringify(envelope), { status: res.status, statusText: res.statusText, headers });
}
