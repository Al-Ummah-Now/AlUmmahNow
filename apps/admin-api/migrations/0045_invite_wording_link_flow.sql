-- Migration: 0045_invite_wording_link_flow
-- The creator invite's sign-in sentences (how, expires; en and ar) still described the flow before
-- AlUmmahNowAuth #434 ("choose Create account and we will email you a code", "after that you can
-- still sign in"). Since #434 the invite button signs the person in and the link works once; an
-- old link offers a new one. This replaces each of the four sentences ONLY where the stored text
-- is still exactly the seeded one (migration 0036), so an admin's own wording is never touched.
-- When anything changes it is a new version (action 'update', by 'system') in History, so it can
-- be restored like any other version. A second run finds nothing to change (idempotent).
-- The new words are the ones Auth's built-in copy uses (AlUmmahNowAuth apps/auth/src/invites/email.ts).
-- Data only: no schema change.

INSERT INTO email_template_versions (key, version, content, action, source_version, created_at, created_by)
SELECT key, version + 1,
  json_set(content,
    '$.copy.en.how', CASE WHEN json_extract(content, '$.copy.en.how') = 'Sign in with {email}. If you have not set a password yet, choose "Create account" and we will email you a code to confirm it is you.'
      THEN 'Accept the invite to sign in as {email}. You don''t need a password: the button signs you in, and you can add a passkey (Face ID or fingerprint) right after.' ELSE json_extract(content, '$.copy.en.how') END,
    '$.copy.en.expires', CASE WHEN json_extract(content, '$.copy.en.expires') = 'This link works until {expires}. After that you can still sign in with this email address.'
      THEN 'This link works once, until {expires}. If it has expired or was already used, open it anyway and ask for a new one.' ELSE json_extract(content, '$.copy.en.expires') END,
    '$.copy.ar.how', CASE WHEN json_extract(content, '$.copy.ar.how') = 'سجّل الدخول باستخدام {email}. إن لم تكن قد عيّنت كلمة مرور بعد، فاختر «إنشاء حساب» وسنرسل إليك رمزًا للتأكد من أنك صاحب البريد.'
      THEN 'اقبل الدعوة لتسجيل الدخول باسم {email}. لا تحتاج إلى كلمة مرور: يسجّل الزر دخولك، ويمكنك بعدها مباشرة إضافة مفتاح مرور (بصمة الوجه أو الإصبع).' ELSE json_extract(content, '$.copy.ar.how') END,
    '$.copy.ar.expires', CASE WHEN json_extract(content, '$.copy.ar.expires') = 'يعمل هذا الرابط حتى {expires}. وبعد ذلك يمكنك تسجيل الدخول بهذا البريد الإلكتروني.'
      THEN 'يعمل هذا الرابط مرة واحدة حتى {expires}. إن انتهت صلاحيته أو استُخدم من قبل، فافتحه واطلب رابطًا جديدًا.' ELSE json_extract(content, '$.copy.ar.expires') END
  ),
  'update', version, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system'
FROM email_templates
WHERE key = 'creator_invite' AND (
    json_extract(content, '$.copy.en.how') = 'Sign in with {email}. If you have not set a password yet, choose "Create account" and we will email you a code to confirm it is you.'
    OR json_extract(content, '$.copy.en.expires') = 'This link works until {expires}. After that you can still sign in with this email address.'
    OR json_extract(content, '$.copy.ar.how') = 'سجّل الدخول باستخدام {email}. إن لم تكن قد عيّنت كلمة مرور بعد، فاختر «إنشاء حساب» وسنرسل إليك رمزًا للتأكد من أنك صاحب البريد.'
    OR json_extract(content, '$.copy.ar.expires') = 'يعمل هذا الرابط حتى {expires}. وبعد ذلك يمكنك تسجيل الدخول بهذا البريد الإلكتروني.'
  );

UPDATE email_templates SET
  version = version + 1,
  content = json_set(content,
    '$.copy.en.how', CASE WHEN json_extract(content, '$.copy.en.how') = 'Sign in with {email}. If you have not set a password yet, choose "Create account" and we will email you a code to confirm it is you.'
      THEN 'Accept the invite to sign in as {email}. You don''t need a password: the button signs you in, and you can add a passkey (Face ID or fingerprint) right after.' ELSE json_extract(content, '$.copy.en.how') END,
    '$.copy.en.expires', CASE WHEN json_extract(content, '$.copy.en.expires') = 'This link works until {expires}. After that you can still sign in with this email address.'
      THEN 'This link works once, until {expires}. If it has expired or was already used, open it anyway and ask for a new one.' ELSE json_extract(content, '$.copy.en.expires') END,
    '$.copy.ar.how', CASE WHEN json_extract(content, '$.copy.ar.how') = 'سجّل الدخول باستخدام {email}. إن لم تكن قد عيّنت كلمة مرور بعد، فاختر «إنشاء حساب» وسنرسل إليك رمزًا للتأكد من أنك صاحب البريد.'
      THEN 'اقبل الدعوة لتسجيل الدخول باسم {email}. لا تحتاج إلى كلمة مرور: يسجّل الزر دخولك، ويمكنك بعدها مباشرة إضافة مفتاح مرور (بصمة الوجه أو الإصبع).' ELSE json_extract(content, '$.copy.ar.how') END,
    '$.copy.ar.expires', CASE WHEN json_extract(content, '$.copy.ar.expires') = 'يعمل هذا الرابط حتى {expires}. وبعد ذلك يمكنك تسجيل الدخول بهذا البريد الإلكتروني.'
      THEN 'يعمل هذا الرابط مرة واحدة حتى {expires}. إن انتهت صلاحيته أو استُخدم من قبل، فافتحه واطلب رابطًا جديدًا.' ELSE json_extract(content, '$.copy.ar.expires') END
  ),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  updated_by = 'system'
WHERE key = 'creator_invite' AND (
    json_extract(content, '$.copy.en.how') = 'Sign in with {email}. If you have not set a password yet, choose "Create account" and we will email you a code to confirm it is you.'
    OR json_extract(content, '$.copy.en.expires') = 'This link works until {expires}. After that you can still sign in with this email address.'
    OR json_extract(content, '$.copy.ar.how') = 'سجّل الدخول باستخدام {email}. إن لم تكن قد عيّنت كلمة مرور بعد، فاختر «إنشاء حساب» وسنرسل إليك رمزًا للتأكد من أنك صاحب البريد.'
    OR json_extract(content, '$.copy.ar.expires') = 'يعمل هذا الرابط حتى {expires}. وبعد ذلك يمكنك تسجيل الدخول بهذا البريد الإلكتروني.'
  );
