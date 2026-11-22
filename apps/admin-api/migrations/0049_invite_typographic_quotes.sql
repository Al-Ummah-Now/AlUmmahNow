-- Migration: 0049_invite_typographic_quotes
-- The English creator invite used straight apostrophes and quotes ("You're", "don't", "weren't",
-- Play "{title}"); the site's English copy uses typographic ones (’ “ ”). This swaps the glyph in
-- each of the four sentences ONLY where the stored text is still exactly the seeded one (0036, 0045),
-- so an admin's own wording is never touched. When anything changes it is a new version (action
-- 'update', by 'system') in History, restorable like any other. json_replace never adds a field
-- that is not there. A second run finds nothing to change (idempotent). Data only: no schema change.

INSERT INTO email_template_versions (key, version, content, action, source_version, created_at, created_by)
SELECT key, version + 1,
  json_replace(content,
    '$.copy.en.subject', CASE WHEN json_extract(content, '$.copy.en.subject') = 'You''re invited to Al Ummah Now'
      THEN 'You’re invited to Al Ummah Now' ELSE json_extract(content, '$.copy.en.subject') END,
    '$.copy.en.how', CASE WHEN json_extract(content, '$.copy.en.how') = 'Accept the invite to sign in as {email}. You don''t need a password: the button signs you in, and you can add a passkey (Face ID or fingerprint) right after.'
      THEN 'Accept the invite to sign in as {email}. You don’t need a password: the button signs you in, and you can add a passkey (Face ID or fingerprint) right after.' ELSE json_extract(content, '$.copy.en.how') END,
    '$.copy.en.videoAlt', CASE WHEN json_extract(content, '$.copy.en.videoAlt') = 'Play "{title}" on Al Ummah Now'
      THEN 'Play “{title}” on Al Ummah Now' ELSE json_extract(content, '$.copy.en.videoAlt') END,
    '$.copy.en.reason', CASE WHEN json_extract(content, '$.copy.en.reason') = 'You got this email because an Al Ummah Now admin invited this address to a creator account. If you weren''t expecting it, you can ignore it.'
      THEN 'You got this email because an Al Ummah Now admin invited this address to a creator account. If you weren’t expecting it, you can ignore it.' ELSE json_extract(content, '$.copy.en.reason') END
  ),
  'update', version, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system'
FROM email_templates
WHERE key = 'creator_invite' AND (
    json_extract(content, '$.copy.en.subject') = 'You''re invited to Al Ummah Now'
    OR json_extract(content, '$.copy.en.how') = 'Accept the invite to sign in as {email}. You don''t need a password: the button signs you in, and you can add a passkey (Face ID or fingerprint) right after.'
    OR json_extract(content, '$.copy.en.videoAlt') = 'Play "{title}" on Al Ummah Now'
    OR json_extract(content, '$.copy.en.reason') = 'You got this email because an Al Ummah Now admin invited this address to a creator account. If you weren''t expecting it, you can ignore it.'
  );

UPDATE email_templates SET
  version = version + 1,
  content = json_replace(content,
    '$.copy.en.subject', CASE WHEN json_extract(content, '$.copy.en.subject') = 'You''re invited to Al Ummah Now'
      THEN 'You’re invited to Al Ummah Now' ELSE json_extract(content, '$.copy.en.subject') END,
    '$.copy.en.how', CASE WHEN json_extract(content, '$.copy.en.how') = 'Accept the invite to sign in as {email}. You don''t need a password: the button signs you in, and you can add a passkey (Face ID or fingerprint) right after.'
      THEN 'Accept the invite to sign in as {email}. You don’t need a password: the button signs you in, and you can add a passkey (Face ID or fingerprint) right after.' ELSE json_extract(content, '$.copy.en.how') END,
    '$.copy.en.videoAlt', CASE WHEN json_extract(content, '$.copy.en.videoAlt') = 'Play "{title}" on Al Ummah Now'
      THEN 'Play “{title}” on Al Ummah Now' ELSE json_extract(content, '$.copy.en.videoAlt') END,
    '$.copy.en.reason', CASE WHEN json_extract(content, '$.copy.en.reason') = 'You got this email because an Al Ummah Now admin invited this address to a creator account. If you weren''t expecting it, you can ignore it.'
      THEN 'You got this email because an Al Ummah Now admin invited this address to a creator account. If you weren’t expecting it, you can ignore it.' ELSE json_extract(content, '$.copy.en.reason') END
  ),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  updated_by = 'system'
WHERE key = 'creator_invite' AND (
    json_extract(content, '$.copy.en.subject') = 'You''re invited to Al Ummah Now'
    OR json_extract(content, '$.copy.en.how') = 'Accept the invite to sign in as {email}. You don''t need a password: the button signs you in, and you can add a passkey (Face ID or fingerprint) right after.'
    OR json_extract(content, '$.copy.en.videoAlt') = 'Play "{title}" on Al Ummah Now'
    OR json_extract(content, '$.copy.en.reason') = 'You got this email because an Al Ummah Now admin invited this address to a creator account. If you weren''t expecting it, you can ignore it.'
  );
