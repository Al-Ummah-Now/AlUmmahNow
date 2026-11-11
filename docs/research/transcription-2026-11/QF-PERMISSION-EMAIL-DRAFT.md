# DRAFT (not sent): partner permission request to Quran Foundation

**Status:** draft for the owner to review and send. It hasn't been sent.
**To:** developers@quran.com (the contact given in the QF Developer Terms and docs)
**Subject:** Permission request: Search/Content API use in on-demand captioning, and keeping verse text in stored captions

---

Assalamu alaykum,

We're registering an application in the QF Developer Console (client id to follow once created). We'd like written confirmation, or a partner permission, for the following use of the Quran Foundation APIs.

**What the application does**
- Creators of videos can request captions on demand.
- When a caption contains a recitation or a quotation of the Qur'an, we identify the exact surah, ayah and word range.
- We then show only the canonical Uthmani text for that range, never speech-recognition output. Each identified range needs the creator's explicit confirmation before it is published.
- A translated caption carries a recognised translation edition for those verses, never machine translation.

**What we're asking permission for**
1. **Search and Content APIs during on-demand jobs.** We want to call the Search API (and, where useful, the Content API) from our backend while a captioning job runs, to suggest verse references for segments our own matcher couldn't confirm. Calls happen only when a creator requests captions.
2. **Keeping verse text and translations in stored captions.** Once a creator publishes a caption, its text includes the Uthmani text of the confirmed ayat and, for translated tracks, the text of a translation edition. The caption files are stored and served to viewers in our player and embeds for as long as the video is published.
   - Developer Terms §3.1 limits storage of QF Content to one week unless it is maintained through Content Sync.
   - Our plan is to sync `quran_core:1`, `mushafs:4` and selected `translations:<id>` through Content Sync at least daily, and to re-render every stored caption whose ayat change after a sync.
   - Could you confirm that captions kept up to date this way satisfy §3.1? If not, could you grant permission to keep the verse text and translation text inside stored captions?
3. **Attribution.** We'd credit Quran Foundation, and the translation edition by name, on every video page with such a caption, and in the description of any video export. Please tell us the exact wording you'd like.
4. **Two clarifications**
   - **Downloads:** would offering viewers a per-video subtitle file download, containing those verses, count as "offering QF Content … as data" under §2.2? Until you advise, we won't offer downloads for captions that contain QF text.
   - **Our matching index:** we build a private, internal index from the synced text (normalised words), used only to match speech-recognition output to verses. It is never exposed and is rebuilt after every sync. Is this acceptable as a Derived Material under the Terms?
5. **Timing data.** We won't store QF recitation timing data in captions. Our caption timings come from our own alignment.

**Which translation editions**
- English: Saheeh International.
- Further languages to follow; we'd confirm with you which are public for Content Sync.

Jazakum Allahu khayran for your work on these resources.

[Name]
[Role / contact]
[Developer Console client id]
