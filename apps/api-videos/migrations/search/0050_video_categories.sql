-- Admin-managed video categories (owner 2026-11-15: "can you add categories in admin?").
-- Owned by api-videos; admin-api writes it (Videos admin › Categories), api-videos and the processor
-- read it through a short in-memory/edge cache with packages/shared-types VIDEO_CATEGORIES as the fallback.
-- value is the slug stored on videos and channels: immutable once created. retired = 1 hides a category from
-- pickers, Explore, search filters and AI suggestions; videos that already have it keep it and its label.
-- Seeded from the built-in list in its order, so nothing changes on day one.
CREATE TABLE IF NOT EXISTS video_categories (
  value TEXT PRIMARY KEY,
  label_en TEXT NOT NULL,
  label_ar TEXT NOT NULL,
  hint TEXT,                          -- what belongs there, for the AI category suggestion prompt
  position INTEGER NOT NULL,
  retired INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

INSERT OR IGNORE INTO video_categories (value, label_en, label_ar, hint, position, retired, created_at, updated_at, updated_by) VALUES
  ('quran_recitation', 'Quran Recitation', 'تلاوة القرآن', 'recitation of the Quran, tilawa, tarteel, a surah or juz read aloud (تلاوة، ترتيل، سورة، جزء، قارئ، مقرئ)', 10, 0, 1763164800000, 1763164800000, NULL),
  ('quran_tafsir', 'Quran Tafsir', 'تفسير القرآن', 'explaining verses or surahs, tadabbur (تفسير، تدبر، معاني الآيات، وقفات مع سورة)', 20, 0, 1763164800000, 1763164800000, NULL),
  ('hadith_studies', 'Hadith Studies', 'دراسات الحديث', 'explaining hadith, hadith books and sciences (شرح حديث، صحيح البخاري، صحيح مسلم، الأربعين النووية، رياض الصالحين، مصطلح الحديث)', 30, 0, 1763164800000, 1763164800000, NULL),
  ('islamic_history', 'Islamic History', 'التاريخ الإسلامي', 'seerah, prophets, companions, caliphates, battles and historical events (السيرة النبوية، قصص الأنبياء، الصحابة، الخلافة، غزوة، التاريخ)', 40, 0, 1763164800000, 1763164800000, NULL),
  ('fiqh', 'Fiqh', 'الفقه', 'rulings and jurisprudence: prayer, purity, fasting rulings, zakat, marriage, divorce, trade, fatwas (أحكام، حكم، فتوى، فقه، الصلاة، الطهارة، الزكاة، البيوع، النكاح)', 50, 0, 1763164800000, 1763164800000, NULL),
  ('aqeedah', 'Aqeedah', 'العقيدة', 'creed: tawheed, names and attributes of Allah, iman, the unseen, shirk (العقيدة، التوحيد، الأسماء والصفات، الإيمان، الشرك، اليوم الآخر)', 60, 0, 1763164800000, 1763164800000, NULL),
  ('dawah', 'Dawah', 'الدعوة', 'inviting to Islam, talks for non-Muslims or new Muslims, comparative religion (الدعوة، دعوة غير المسلمين، مقارنة الأديان، المسلمون الجدد)', 70, 0, 1763164800000, 1763164800000, NULL),
  ('khutbah', 'Friday Sermon', 'خطبة الجمعة', 'Friday or Eid sermons (خطبة الجمعة، خطبة العيد، خطبة)', 80, 0, 1763164800000, 1763164800000, NULL),
  ('islamic_lectures', 'Islamic Lectures', 'محاضرات إسلامية', 'general lessons, admonitions and reminders whose subject fits no more specific category (محاضرة، درس، موعظة، تذكير، كلمة)', 90, 0, 1763164800000, 1763164800000, NULL),
  ('islamic_nasheed', 'Islamic Nasheed', 'الأناشيد الإسلامية', 'nasheeds and vocals (نشيد، أنشودة، أناشيد، إنشاد)', 100, 0, 1763164800000, 1763164800000, NULL),
  ('islamic_kids', 'Islamic Kids Content', 'محتوى إسلامي للأطفال', 'content made for children (أطفال، للأطفال، قصص للأطفال، تعليم الصغار)', 110, 0, 1763164800000, 1763164800000, NULL),
  ('islamic_news', 'Islamic News', 'أخبار إسلامية', 'news and current affairs of Muslims (أخبار، الأمة، حدث، تقرير)', 120, 0, 1763164800000, 1763164800000, NULL),
  ('hajj_umrah', 'Hajj & Umrah', 'الحج والعمرة', 'Hajj and Umrah rites, guides and journeys (الحج، العمرة، المناسك، مكة، عرفة، الطواف)', 130, 0, 1763164800000, 1763164800000, NULL),
  ('ramadan', 'Ramadan', 'رمضان', 'Ramadan, its nights, taraweeh, Laylat al-Qadr, Eid al-Fitr (رمضان، التراويح، ليلة القدر، الصيام في رمضان، زكاة الفطر)', 140, 0, 1763164800000, 1763164800000, NULL),
  ('islamic_lifestyle', 'Islamic Lifestyle', 'نمط الحياة الإسلامي', 'family, marriage life, parenting, health, character, everyday halal living (الأسرة، تربية الأبناء، الأخلاق، الحياة الزوجية، تطوير الذات)', 150, 0, 1763164800000, 1763164800000, NULL);
