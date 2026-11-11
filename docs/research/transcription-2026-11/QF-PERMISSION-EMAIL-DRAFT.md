# DRAFT (not sent): partner permission request to Quran Foundation

**Status:** draft for the owner to review and send. It hasn't been sent.
**To:** developers@quran.com (the contact given in the QF Developer Terms and docs)
**Subject:** Permission request: Search/Content API use in on-demand captioning, and keeping verse text in stored captions

---

Assalamu alaykum,

We have registered applications in the QF Developer Console (pre-production and production clients; ids below). Both currently get `invalid_scope` for `content`. We'd like written confirmation, or a partner permission, for the following use of the Quran Foundation APIs.

**What the application does**
- Creators of videos can request captions on demand.
- When a caption contains a recitation or a quotation of the Qur'an, we identify the exact surah, ayah and word range.
- We then show only the canonical Uthmani text for that range, never speech-recognition output. Each identified range needs the creator's explicit confirmation before it is published.
- A translated caption carries a recognised translation edition for those verses, never machine translation.

**What we're asking permission for**
1. **Search and Content APIs during on-demand jobs.** While a captioning job runs, our backend calls the Search API for candidate verses, then fetches those verses by key from the Content API to verify them against the speech-recognition output. Calls happen only when a creator requests captions. The fetched text is held only for the job, and cached for at most 7 days.
2. **Live display with an edge cache.** Our captions store only verse references (surah, ayah and word range) and a translation resource id, never Quran text. When a viewer plays the video, our server fetches the Uthmani text and the chosen translation for that range from the Content API with our server-side token. The response is cached at our edge for at most 6 days. We read Developer Terms §3.1 as allowing this ("longer than 1 week" being the limit); please confirm.
3. **Content Sync access for our matching index.** To identify verses without a search call for every passage, we'd like production access to Content Sync for `quran_core:1` and `mushafs:4`. We'd keep a private, internal normalised index built from the synced copy, rebuilt after every sync (at least daily), never exposed, and deleted if syncing stops. Is this acceptable as a Derived Material?
4. **Optional: keeping text inside stored captions.** If you'd allow it, we'd prefer to keep the confirmed verse text and translation text inside stored captions, re-rendered after each sync. Until you permit it, we won't store any.
5. **Attribution.** We'd credit Quran Foundation (quran.com), and the translation edition by name, wherever these verses appear. Please tell us the exact wording you'd like.
6. **Downloads.** Would offering viewers a per-video subtitle file download, with the verses filled in at download time, count as "offering QF Content … as data" under §2.2? Until you advise, we won't offer downloads for captions that contain Quran.
7. **Timing data.** We won't store QF recitation timing data. Our caption timings come from our own alignment.

**Which translation editions**
- English: Saheeh International.
- Further languages to follow; we'd confirm with you which are public for Content Sync.

Jazakum Allahu khayran for your work on these resources.

[Name]
[Role / contact]
[Developer Console client id]
