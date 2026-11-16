-- Admin-editable system emails (videos admin › Settings › Emails; shared-types email-templates.ts).
-- email_templates holds the current version of each template; email_template_versions keeps every
-- saved version (who and when) so an earlier one can be restored. Staff are stored by user id only
-- (names are resolved for display), so erasing a person leaves no email here.
-- Version 1 of the creator invite is the copy Auth sent until now (AlUmmahNowAuth
-- apps/auth/src/invites/email.ts), with no default videos.
-- Expand-only: new tables and their first rows.
CREATE TABLE IF NOT EXISTS email_templates (
  key TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_template_versions (
  key TEXT NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  action TEXT NOT NULL,
  source_version INTEGER,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  PRIMARY KEY (key, version)
);

INSERT OR IGNORE INTO email_templates (key, version, content, updated_at, updated_by)
VALUES ('creator_invite', 1, '{"copy":{"en":{"subject":"You''re invited to Al Ummah Now","preheader":"Your creator account is ready. Accept the invite to sign in.","preheaderChannels":"Your creator account and {channels} are ready. Accept the invite to sign in.","greeting":"Assalamu alaikum {name},","greetingNoName":"Assalamu alaikum,","account":"An Al Ummah Now admin has set up a creator account for you.","createdOne":"It comes with the channel {channels}, ready for you to manage.","createdMany":"It comes with the channels {channels}, ready for you to manage.","transferredOne":"The channel {channels} has been moved to your account.","transferredMany":"The channels {channels} have been moved to your account.","how":"Sign in with {email}. If you have not set a password yet, choose \"Create account\" and we will email you a code to confirm it is you.","button":"Accept the invite","videoIntro":"They also shared this video with you:","videoAlt":"Play \"{title}\" on Al Ummah Now","noteLabel":"Note from the admin","expires":"This link works until {expires}. After that you can still sign in with this email address.","reason":"You got this email because an Al Ummah Now admin invited this address to a creator account. If you weren''t expecting it, you can ignore it."},"ar":{"subject":"دعوة للانضمام إلى الأمة الآن","preheader":"حساب صانع المحتوى الخاص بك جاهز. اقبل الدعوة لتسجيل الدخول.","preheaderChannels":"حساب صانع المحتوى الخاص بك جاهز مع {channels}. اقبل الدعوة لتسجيل الدخول.","greeting":"السلام عليكم {name}،","greetingNoName":"السلام عليكم،","account":"أنشأ لك أحد مشرفي الأمة الآن حساب صانع محتوى.","createdOne":"ويضم القناة {channels} جاهزةً لتديرها.","createdMany":"ويضم القنوات {channels} جاهزةً لتديرها.","transferredOne":"ونُقلت إليه القناة {channels}.","transferredMany":"ونُقلت إليه القنوات {channels}.","how":"سجّل الدخول باستخدام {email}. إن لم تكن قد عيّنت كلمة مرور بعد، فاختر «إنشاء حساب» وسنرسل إليك رمزًا للتأكد من أنك صاحب البريد.","button":"قبول الدعوة","videoIntro":"وشارك معك هذا المرئي:","videoAlt":"شغّل «{title}» على الأمة الآن","noteLabel":"ملاحظة من المشرف","expires":"يعمل هذا الرابط حتى {expires}. وبعد ذلك يمكنك تسجيل الدخول بهذا البريد الإلكتروني.","reason":"وصلتك هذه الرسالة لأن أحد مشرفي الأمة الآن دعا هذا العنوان إلى حساب صانع محتوى. إن لم تكن تتوقعها، فيمكنك تجاهلها."}},"defaultVideos":{"en":null,"ar":null}}', '2026-11-16T00:00:00.000Z', 'system');

INSERT OR IGNORE INTO email_template_versions (key, version, content, action, source_version, created_at, created_by)
VALUES ('creator_invite', 1, '{"copy":{"en":{"subject":"You''re invited to Al Ummah Now","preheader":"Your creator account is ready. Accept the invite to sign in.","preheaderChannels":"Your creator account and {channels} are ready. Accept the invite to sign in.","greeting":"Assalamu alaikum {name},","greetingNoName":"Assalamu alaikum,","account":"An Al Ummah Now admin has set up a creator account for you.","createdOne":"It comes with the channel {channels}, ready for you to manage.","createdMany":"It comes with the channels {channels}, ready for you to manage.","transferredOne":"The channel {channels} has been moved to your account.","transferredMany":"The channels {channels} have been moved to your account.","how":"Sign in with {email}. If you have not set a password yet, choose \"Create account\" and we will email you a code to confirm it is you.","button":"Accept the invite","videoIntro":"They also shared this video with you:","videoAlt":"Play \"{title}\" on Al Ummah Now","noteLabel":"Note from the admin","expires":"This link works until {expires}. After that you can still sign in with this email address.","reason":"You got this email because an Al Ummah Now admin invited this address to a creator account. If you weren''t expecting it, you can ignore it."},"ar":{"subject":"دعوة للانضمام إلى الأمة الآن","preheader":"حساب صانع المحتوى الخاص بك جاهز. اقبل الدعوة لتسجيل الدخول.","preheaderChannels":"حساب صانع المحتوى الخاص بك جاهز مع {channels}. اقبل الدعوة لتسجيل الدخول.","greeting":"السلام عليكم {name}،","greetingNoName":"السلام عليكم،","account":"أنشأ لك أحد مشرفي الأمة الآن حساب صانع محتوى.","createdOne":"ويضم القناة {channels} جاهزةً لتديرها.","createdMany":"ويضم القنوات {channels} جاهزةً لتديرها.","transferredOne":"ونُقلت إليه القناة {channels}.","transferredMany":"ونُقلت إليه القنوات {channels}.","how":"سجّل الدخول باستخدام {email}. إن لم تكن قد عيّنت كلمة مرور بعد، فاختر «إنشاء حساب» وسنرسل إليك رمزًا للتأكد من أنك صاحب البريد.","button":"قبول الدعوة","videoIntro":"وشارك معك هذا المرئي:","videoAlt":"شغّل «{title}» على الأمة الآن","noteLabel":"ملاحظة من المشرف","expires":"يعمل هذا الرابط حتى {expires}. وبعد ذلك يمكنك تسجيل الدخول بهذا البريد الإلكتروني.","reason":"وصلتك هذه الرسالة لأن أحد مشرفي الأمة الآن دعا هذا العنوان إلى حساب صانع محتوى. إن لم تكن تتوقعها، فيمكنك تجاهلها."}},"defaultVideos":{"en":null,"ar":null}}', 'seed', NULL, '2026-11-16T00:00:00.000Z', 'system');
