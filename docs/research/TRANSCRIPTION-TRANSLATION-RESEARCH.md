# Transcription, translation and Quran detection: research and measurements

**Date:** 2026-11-11
**Feeds:** [docs/specs/TRANSCRIPTION-TRANSLATION.md](../specs/TRANSCRIPTION-TRANSLATION.md)
**Supersedes for pricing:** [transcription-and-search-architecture.md](transcription-and-search-architecture.md) (2025-01-25, RunPod-based)

Prices come from each provider's own pages, fetched on 2026-11-11 (sources in §7). Quality numbers come from our own runs on 2026-11-11, using the al-ummah Cloudflare account, the QA Bunny test library and a local whisper.cpp, unless a row says it is the vendor's claim.

---

## 1. Test set

| Clip | Length | Content | Reference |
|---|---|---|---|
| `q_mulk` | 3:06 | Quran, Mishary Alafasy murattal, Al-Mulk 67:1–13 (EveryAyah) | Tanzil text, exact |
| `q_rahman_mujawwad` | 5:50 | Quran, Abdul Basit mujawwad, Ar-Rahman 55:1–25 (long elongations, repeated refrain) | Tanzil text, exact |
| `ar_duat3` | 0:52 | Prod lecture (MSA, Egyptian speaker), quotes 3:166–167 and 5:82 mid-sentence | Quran parts exact; rest judged by hand |
| `x_ashura2` | 2:57 | Prod lecture with a full hadith and honorifics. **Titled "Ashura 2" in English, but the speech is Arabic.** | Judged by hand |
| `ar_tahinu` | 6:41 | Prod lecture (aqeedah), quotes 3:139 | Quran part exact |
| `ar_gaza16`, `x_shahrour1`, `en_gooddeeds1` | ~3:00 each | Prod lectures. The last two have English titles but Arabic speech. | False-positive check for Quran detection |
| `en_pickthall` | 4:00 | LibriVox (public domain) reading of Pickthall's English translation, surahs 91–94 | Pickthall text, exact |
| `en_spiritofislam` | 3:00 | LibriVox reading of Ameer Ali, *The Spirit of Islam* (English prose with Arabic names) | Translation test only |

Gaps:
- **No nasheed.** None is public on QA or prod.
- **No real English lecture.** Every English-titled prod video turned out to be Arabic speech, and the QA seed videos are silent. The two LibriVox readings stand in for English.
- **ElevenLabs wasn't measured** (no key). DeepL was measured in the follow-up on the owner's API Pro account (§9).

WER is word error rate on normalised text. For Arabic, normalisation strips diacritics and tatweel and unifies alef, ya and ta marbuta. Lower is better.

## 2. Speech-to-text results

### 2.1 Quran recitation (exact reference)

| Engine (settings) | Al-Mulk raw WER | Al-Mulk after Quran layer | Ar-Rahman (mujawwad) raw | Ar-Rahman after Quran layer |
|---|---|---|---|---|
| Workers AI whisper-large-v3-turbo, `vad_filter: true` | 6.9% | 4.9% | **99%**: whole clip became «اشتركوا في القناة» | 99% |
| Workers AI turbo, no VAD | 6.2% | 4.9% | 32.3% | 23.2% |
| Workers AI turbo, no VAD, 30 s chunks | – | – | 43.4% | 8.1% |
| Workers AI turbo, no VAD, `initial_prompt` naming the surah | – | – | **27.3%** | **4.0%** |
| Bunny Stream transcribe (Whisper "v1.2.0") | 11.1% (e.g. «البصل» for «البصر») | **2.8%** | 30.3% | **4.0%** |
| Local whisper.cpp large-v3-turbo q5_0 (Core's model), M3 Ultra Metal | 33–42% | 7.6–24% | – | – |

"After Quran layer" means the run with detection, merging of neighbouring ayat and replacement by the Tanzil text (§4). What's left is mostly the isti'adha or basmala before the first ayah, plus boundary words. After replacement, the text on screen is the full-diacritic Uthmani text. Raw ASR has no diacritics at all.

### 2.2 Lectures and English

| Engine | `en_pickthall` WER | `ar_duat3` | `x_ashura2` | Notes |
|---|---|---|---|---|
| Workers AI turbo + VAD | 30.2%: **dropped the first 40 s** (LibriVox preamble and 91:1–10) | good: «انتقل الجمعان» for «التقى», «المؤنين» | good: full hadith, honorifics spelled out | VAD silently deletes speech |
| Workers AI turbo, no VAD | 12.7% | – | – | |
| Workers AI `@cf/deepgram/nova-3` | **4.8%** | **unsupported** ("No such model/language/tier") | unsupported | English only on Workers AI |
| Bunny transcribe | 16.4% ("an'", "th'") | worse: «يا مؤلثق الجمعان», «تعألو قتل فيه سبل» | 30% word disagreement with Workers AI; worse to the ear | |
| Local whisper.cpp (`-mc 0 -bs 5`) | 13.0% | – | – | the default settings lost most of the clip |

### 2.3 Speed and cost measured

| Engine | Time | Cost |
|---|---|---|
| Workers AI turbo | 52 s clip: 6.6–7.4 s · 3 min: 9–30 s · 6.7 min: 100 s (single request, no chunking) | 46.6 Neurons per audio minute = **$0.00051/min** (matches the price page) |
| Bunny transcribe | Captions arrived within ~10 min of the upload finishing encoding (QA library, 5 videos at once) | $0.10 per language-minute (vendor) |
| Local whisper.cpp turbo q5_0 | 3:06 audio in 4.6 s with Metal (≈ 40× real time); 58 s on 4 CPU threads (≈ 3×) | free; 574 MB model download |

On-device numbers come from a desktop-class Apple chip. Phones and low-end Windows/Linux machines weren't measured and will be much slower.

## 3. Translation results

### 3.1 Titles: 38 real prod titles ar→en and 29 en→ar (14 real, 15 written to cover honorifics and references)

| Model (Workers AI unless noted) | Clear errors / 67 | p50 / p95 latency | Neurons per title | $ per title | Typical failures |
|---|---|---|---|---|---|
| **Gemma 4 26B A4B** (thinking off) | ~5 | **1.04 s / 2.13 s** | 1.9 | $0.00002 | "شهرور" for Shahrour (شحرور) |
| **DeepSeek V4.1 Flash** (reasoning none) | ~6 | 1.58 s / 2.40 s | 6.5 | $0.00007 | same name slip; "Apology (Caused)" |
| Llama 4 Scout 17B | ~10 | 1.23 s / 2.36 s | 5.6 | $0.00006 | «اهل عزة» → "People of Honor" (it is a typo for Gaza); "Interventionists" for المداخلة; repeated a verse |
| gpt-oss-120b (reasoning low) | ~17 | 1.73 s / 5.85 s | 16 | $0.00018 | answered with made-up explanations ("Shahrour 2 is a radio programme…"), leaked "analysis:", left 8 verses untranslated |
| m2m100-1.2b | ~55 (unusable) | 1.48 s / 7.45 s | 1.8 | $0.00002 | "قصة قصة قصة…", invented hadith, "Mahatma Gandhi", "I am 25 years old" |

What went right:
- Honorifics: ﷺ, (رضي الله عنه), (رحمه الله) and the reverse all came through correctly on Gemma, DeepSeek and Llama.
- Quran references such as (18:1–10) and (2:255) were kept.
- Names were transliterated consistently (Mustafa al-Badri, Abu Ishaq al-Huwaini).

What went wrong:
- Rare proper names were the weak point. A per-channel glossary and the video description as context fix this (spec §8).
- Digits were sometimes turned into Arabic-Indic numerals. The spec requires the source's digits to be kept.

### 3.2 Transcripts (cue-aligned JSON, one call per ≤ 6,000 characters)

| Model | `x_ashura2` ar→en (49 cues) | Neurons per audio minute | $ per audio minute |
|---|---|---|---|
| DeepSeek V4.1 Flash | 49/49 cues, 7.5 s. Accurate; ﷺ, (may Allah be pleased with them), Musa, Madinah. | 36 | **$0.00040** |
| Gemma 4 26B | 49/49 cues, 20 s. Equally accurate; "(may Allah be pleased with them both)". | 11 | $0.00012 |
| Bunny translation (`targetLanguages`) | Fluent; "peace and blessings be upon him" written out, Moses rather than Musa. | – | $0.10 |

Two things only showed up in the transcript test:
1. **Quran detection has to run on the whole transcript and then be mapped back to cues.** Detecting per cue missed 3:166 in `ar_duat3`, because the ayah spans three cues, and the LLM then translated the ayah itself.
2. **Bunny's en→ar translation of the Pickthall reading output Quran Arabic** («والشمس وضحاها…»), but not reliably the exact text. Any LLM will try to "translate" Quran, so the spec masks Quran spans before translation.

## 4. Quran detection prototype

Normalised Tanzil text, a 3-gram verse index, then greedy fuzzy alignment: words match at a Levenshtein ratio of 0.7 or more, with up to two misses in a row. A span is mapped to a surah:ayah range, and spans within two ayat of each other are merged so the gaps are filled. The code is [`transcription-2026-11/quran_detect.py`](transcription-2026-11/quran_detect.py).

| Clip | Detections | Verdict |
|---|---|---|
| `ar_duat3` | 3:166–167 (conf 0.95, 21 words), 5:82 partial (1.0, 8 words) | correct; ASR slips «انتقل» and «المؤنين» fixed by the official text |
| `ar_tahinu` | 3:139 (1.0, 7 words) | correct |
| `en_gooddeeds1` | 35:7 partial (1.0, 6 words) | correct |
| `x_ashura2` | 7:59 (0.89, 9 words), 91:13 (0.83, 6), 12:50 (1.0, 5) | 7:59 is a real quote but the same words also occur at 7:65, 7:73, 7:85 and 11:50 (ambiguous). 91:13 is a false positive («فقال لهم رسول الله» from a hadith). 12:50 is doubtful. |
| `ar_gaza16` | 2:190, 2:246 ×2 (0.8, 5 words, starting «في سبيل الله») | false positives |
| `x_shahrour1` | none | correct |
| 13 titles quoting an ayah in `{…}` | 10 unique and correct; 2 correctly reported as appearing in 2 places (23:53/30:32, 2:193/8:39); 1 missed (19:66, because «أئذا» and «أإذا» spell the hamza differently) | |

Thresholds from this run:
- **Suggest automatically** at 6 or more words with confidence ≥ 0.9. That gave 5 true positives and no false positives.
- **Show "possible Quran"** at 5 words or ≥ 0.8.
- **Mark as ambiguous** when the matched words occur in more than one place.

A short quote such as «لتكونوا شهداء على الناس» (4 words, 2:143) falls below the threshold, so only the editor's manual "mark as Quran" catches it.

## 5. Provider facts (fetched 2026-11-11)

### Speech-to-text

| Provider | List price | Arabic | Notes |
|---|---|---|---|
| Workers AI whisper-large-v3-turbo | $0.0005/min | yes (Whisper) | no published input limit; Batch API needs payload < 10 MB; ASR rate limit 720 requests/min; `vad_filter`, `initial_prompt`, word timestamps, VTT out |
| Workers AI nova-3 | $0.0052/min | **no** (our test) | Deepgram's own API does list Arabic |
| Bunny Stream transcribe | **$0.10 per language-minute**, $1 monthly minimum | `ar` listed first of 56 languages; per-language accuracy only via the account API | `POST /library/{id}/videos/{guid}/transcribe` with `sourceLanguage` and `targetLanguages`; `force` re-bills; VTT at `/{guid}/captions/{lang}.vtt`; language is guessed from the first 30 s, so always pass `sourceLanguage` |
| Cloudflare Stream captions | included | **no Arabic** | not an option |
| ElevenLabs Scribe v3 / v2 | **$0.20/h** batch, $0.22/h realtime; plan hours 4.5 (Free) to 4,950 (Business) | v2 rated "Good" (WER 10–20%); lowest overall WER (13.2%) on Egyptian/Saudi code-switching in arXiv 2605.19069 | word timestamps, diarization up to 32 speakers, `source_url`, webhooks, 5 GB / 15 h per file; zero retention for enterprise only |
| Google STT v2 Chirp 3 | $0.016/min standard, **$0.003/min dynamic batch** | 18 ar-* locales, all Preview, no Arabic diarization | |
| Azure Speech | $0.18/h batch | not checked | |
| AWS Transcribe | $0.006/min | ar-SA (MSA), ar-AE | |
| Deepgram Nova-3 (direct) | $0.0043–0.0052/min | ar, ar-AE, ar-SA, ar-EG… | |
| AssemblyAI Universal-2 | $0.15/h | "Good" (10–25%) | |
| OpenAI gpt-4o-mini-transcribe / gpt-transcribe / whisper-1 | $0.003 / $0.0045 / $0.006 per min | yes | |
| Speechmatics Melia 1 | $0.24/h | vendor claim: Arabic WER 4.5% vs Whisper 6.2%; MSA plus 4 dialect groups, ar–en code-switching | the strongest Arabic claim, unverified |
| Open Universal Arabic ASR Leaderboard (independent) | – | whisper-large-v3 36.9% average, **turbo 40.1%**, best open model (Jais-ASR) 22.8%; MGB-2 broadcast: large-v3 16.3% | open models only |

### Translation

| Provider | List price per 1M characters | Arabic | Notes |
|---|---|---|---|
| Workers AI DeepSeek V4.1 Flash | $0.30 in / $1.20 out per M tokens ≈ **$0.65 per 1M characters** of transcript (measured) | good | already the CMS default |
| Workers AI Gemma 4 26B | $0.10 / $0.30 per M tokens ≈ $0.20 per 1M characters | good | fastest |
| DeepL Growth | €22 overage + €29.75/month base (1M characters included) | `AR` since Q1 2024; glossaries, tag handling and next-gen model all support Arabic; formality not documented for Arabic | API Free/Pro can no longer be bought; VTT/SRT documents supported (VTT GA 2026-11-02); texts deleted after translation |
| Google NMT / LLM | $20 / $10+$10 | yes | |
| Azure Translator | $10 | yes | |
| AWS Translate | $15 | yes | |

### Quran text and translations

| Source | Use | Licence |
|---|---|---|
| **Tanzil Uthmani 1.1** | fallback text source. **Use the XML export**: the TXT export glues the basmala onto ayah 1 of every surah (§8) | CC BY 3.0, **verbatim only**; credit "Tanzil Project" with a link, keep the notice, watch for updates |
| **QuranEnc** `english_saheeh` 1.1.2 (Noor International), `english_rwwad` 1.0.21, `english_hilali_khan` 1.1.3, plus other languages | official translation per language, stored offline (SQLite download) | republishing allowed: no changes, credit publisher and QuranEnc with the version number, keep it updated, no inappropriate ads next to it |
| **Quran Foundation Content Sync** (corrected in v2, §11) | primary source for the Uthmani text, word-level text, translations and reciter timings | an offline copy is allowed when kept through Content Sync, with a next sync at least every 7 days; Developer Console account; credit QF. The v1 text here said "cache ≤ 1 week" without the Content Sync exception, which was wrong. |
| alquran.cloud | – | non-commercial; doesn't clear translation rights |
| Tanzil translations | – | **non-commercial only** |
| The Clear Quran (Khattab) | – | needs written consent from Al-Furqaan Foundation |
| Saheeh International from any source other than QuranEnc | – | publisher permission |
| tarteel-ai/whisper-base-ar-quran (Apache-2.0), basharalrfooh/whisper-small-quran (MIT) | possible recitation-specific ASR later | model weights; WER 5.75% and 10% on their own test sets |

## 6. Conclusions

1. **Workers AI Whisper turbo is the right default**, with VAD off, a ≤ 10-minute chunk size and an `initial_prompt`. It matched or beat Bunny on every clip at about 1/200 of the cost. VAD must stay off: it deleted the whole mujawwad recitation and 40 s of English.
2. **The Quran layer pays off more than switching ASR vendors.** On recitation both Bunny and Workers AI dropped to about 3–5% after replacement, and the text shown is the full-diacritic official text. It costs only Worker CPU.
3. **Bunny's built-in transcription isn't worth it.** It is Whisper-based too, at $0.10 per language-minute, so a single 1,000-hour month is $6,000 just to transcribe. Its translations read well, but they spell honorifics out and can't be steered with a glossary.
4. **ElevenLabs Scribe is the best-documented Arabic option** at $0.20/h, cheap enough to be the fallback. It needs a key to measure before we rely on it.
5. **Translation: Gemma 4 26B for inline titles** (fast, cheapest) and **DeepSeek V4.1 Flash for transcripts** (proven in the CMS). Each falls back to the other. m2m100 must not be used, including where the processor's moderation still uses it.
6. **Quran sources (v2, owner clarification):** identifying and storing are separate steps.
   - **Identify:** local fuzzy search decides; QF search can suggest candidates for review (§8.6).
   - **Store:** captions keep references plus text from a storage-cleared source. That is Tanzil XML and QuranEnc until QF confirms in writing; QF Content Sync can render after that, provided it stays in step with every sync (§11).

## 7. Sources (all fetched 2026-11-11)

- Workers AI: https://developers.cloudflare.com/workers-ai/platform/pricing/ · https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/ · https://developers.cloudflare.com/workers-ai/models/nova-3/ · https://developers.cloudflare.com/workers-ai/models/m2m100-1.2b/ · https://developers.cloudflare.com/workers-ai/models/deepseek-v4.1-flash-1017/ · https://developers.cloudflare.com/workers-ai/features/batch-api/ · https://developers.cloudflare.com/workers-ai/platform/limits/ · https://developers.cloudflare.com/workers-ai/guides/tutorials/build-a-workers-ai-whisper-with-chunking/
- Containers and Queues: https://developers.cloudflare.com/containers/platform/pricing/ · https://developers.cloudflare.com/queues/platform/pricing/
- Media Transformations audio extraction ($0.50 per 1,000 output seconds, 10-minute input limit): https://developers.cloudflare.com/stream/transform-videos/
- Cloudflare Stream captions: https://developers.cloudflare.com/stream/edit-videos/adding-captions/
- Bunny: https://bunny.net/docs/stream/transcribing.md · https://bunny.net/docs/stream/pricing.md · https://bunny.net/docs/api-reference/stream/manage-videos/transcribe-video.md · https://bunny.net/docs/stream/storage-structure · https://bunny.net/docs/stream/webhooks.md · https://bunny.net/docs/changelog
- ElevenLabs: https://elevenlabs.io/pricing/api · https://elevenlabs.io/docs/overview/capabilities/speech-to-text · https://elevenlabs.io/docs/api-reference/speech-to-text/convert · https://elevenlabs.io/docs/developers/resources/zero-retention-mode
- DeepL: https://support.deepl.com/hc/en-us/articles/360021200939-DeepL-API-plans · https://www.deepl.com/en/pro · https://developers.deepl.com/docs/resources/roadmap-and-release-notes · https://developers.deepl.com/docs/getting-started/supported-languages · https://developers.deepl.com/docs/customize/managing-glossaries · https://developers.deepl.com/docs/translate/understanding-model-types · https://support.deepl.com/hc/en-us/articles/360020582359-File-formats
- Benchmarks: https://cloud.google.com/speech-to-text/pricing · https://docs.cloud.google.com/speech-to-text/docs/models/chirp-3 · https://cloud.google.com/translate/pricing · https://prices.azure.com/api/retail/prices · https://aws.amazon.com/transcribe/pricing/ · https://docs.aws.amazon.com/transcribe/latest/dg/supported-languages.html · https://aws.amazon.com/translate/pricing/ · https://deepgram.com/pricing · https://developers.deepgram.com/docs/models-languages-overview · https://www.assemblyai.com/pricing · https://developers.openai.com/api/docs/pricing · https://www.speechmatics.com/pricing · https://www.speechmatics.com/speech-to-text/arabic · https://huggingface.co/spaces/elmresearchcenter/open_universal_arabic_asr_leaderboard · https://artificialanalysis.ai/speech-to-text · https://arxiv.org/abs/2605.19069
- Quran: https://api-docs.quran.foundation/docs/quickstart/ · https://api-docs.quran.foundation/legal/developer-terms/ · https://api-docs.quran.foundation/docs/tutorials/content-sync/getting-started/ · https://tanzil.net/download/ · https://tanzil.net/docs/text_license · https://tanzil.net/trans/ · https://alquran.cloud/terms-and-conditions · https://quranenc.com/en/home/api/ · https://quranenc.com/api/v1/translations/list/en · https://huggingface.co/tarteel-ai/whisper-base-ar-quran · https://huggingface.co/basharalrfooh/whisper-small-quran · https://github.com/cpfair/quran-align · https://qul.tarteel.ai/faq · https://github.com/adelpro/quran-search-engine
- Test audio: https://everyayah.com/data/ (Alafasy_128kbps, Abdul_Basit_Mujawwad_128kbps) · https://archive.org/details/meaning_glorious_koran_0810_librivox · https://archive.org/details/spiritofislam_2601_librivox

---

# v2 follow-up (2026-11-11): zero-mistake Quran, DeepL measured, Quran-specialised alternatives, QF Content Sync

## 8. Zero-mistake Quran: design measured

**Rule tested:** ASR text is never shown for Quran. A span shows only the official text for an exact `(surah, ayah, word)` range when it is auto-suggested; everything else becomes a reference-only review item. The code is in [`transcription-2026-11/quran_zero.py`](transcription-2026-11/quran_zero.py), the evaluator in `eval_zero.py`, and per-clip results in `zero_eval_results.json`.

### 8.1 Test set, extended

| Clip | Reciter / style | Ayat | Ground truth |
|---|---|---|---|
| `r1_husary_kahf` | Husary, murattal | 18:1–10 | EveryAyah per-ayah files, so ayah boundaries are exact |
| `r2_minshawy_mj_fajr` | Minshawy, **mujawwad** | 89:1–16 | same |
| `r3_sudais_kursi` | Sudais, murattal (reverberant) | 2:255–257 | same |
| `r4_maher_yasin` | Maher al-Muaiqly | 36:1–12 (starts with muqatta'at يس) | same |
| `r5_ghamdi_hashr` | Saad al-Ghamdi (40 kbps) | 59:21–24 | same |
| `r6_husary_mj_falaq_nas` | Husary, **mujawwad** | 113:1–5 + 114:1–6 (both open «قل أعوذ برب») | same |
| `r7_hudhaify_fatiha` | Hudhaify | 1:1–7 | same |
| `r8_ajamy_baqarah_end` | al-Ajamy | 2:285–286 (long ayat) | same |
| `q_mulk`, `q_rahman_mujawwad` | Alafasy; Abdul Basit mujawwad | 67:1–13; 55:1–25 | same (from v1) |
| `p1`, `p2`, `p3` | Alafasy (Quran.com chapter audio) | **partial ayat**: 67:3 w5 → 67:5 w4; 67:15 w3 → 67:16 w5; 67:2 w1–6 | QF word segments, millisecond word timings |
| `m1_lecture_quote_67_2` | lecture speech + a 6-word quote of 67:2 + lecture speech | 67:2 w1–6 | same |
| 6 prod lectures (v1) | MSA/Egyptian | known quotes | judged by hand |

ASR: Workers AI Whisper turbo, `language: ar`, no VAD, no prompt (the generic pipeline).

### 8.2 Bug found in the source data
The Tanzil **TXT** export prepends the basmala to ayah 1 of every surah (`18|1|بسم الله الرحمن الرحيم الحمد لله…`). Displaying that as 18:1 would itself be a wrong-text error. The **XML** export keeps it in a separate `bismillah` attribute. QF's `mushafs` positioned words likewise "do not include surah headings or the bismillah". All v2 numbers use the XML.

### 8.3 Results (Workers AI ASR)

| Clip | Ayat auto-suggested / recited | **Wrong ayat shown** | **Extra words shown** | Recited words not shown | Review items |
|---|---|---|---|---|---|
| r1 Husary Kahf | 10/10 | 0 | 0 | 0 | 0 |
| r2 Minshawy mujawwad Fajr | 13/16 | 0 | 0 | 26 | 0 |
| r3 Sudais Kursi | 3/3 | 0 | 0 | 3 | 0 (one repeated phrase resolved by verse order) |
| r4 Maher Yasin | 12/12 | 0 | 0 | 0 | 0 (يس via the spoken-letters table) |
| r5 Ghamdi Hashr | 4/4 | 0 | 0 | 0 | 0 |
| r6 Husary mujawwad Falaq+Nas | 9/11 | 0 | 0 | 8 | 1 |
| r7 Hudhaify Fatiha | 7/7 | 0 | 0 | 0 | 0 |
| r8 Ajamy Baqarah 285–286 | 2/2 | 0 | 0 | 0 | 0 |
| q_mulk | 13/13 | 0 | 0 | 0 | 0 |
| q_rahman mujawwad | 16/25 | 0 | 0 | 37 | 1 (the refrain repeats 31× in the surah) |
| p1/p2/p3 partial ayat | 6/6 | 0 | 0 | 1 (p1's first word) | 0 |
| m1 lecture + quote | 1/1 | 0 | 0 | 0 | 0 |
| **Recitation + partial total** | **96/110 (87.3%)** | **0** | **0** | 75 of 866 (91.3% of words shown) | 2 |

**Lectures (6 clips):**
- **Auto-suggested:** 5 true quotes (3:166–167, 5:82, 3:139, 35:7, plus 67:2 in m1), all correct.
- **Sent to review:** 3 true quotes. They are too short (2:143, 4 words) or occur in several places (7:59 = 7:65 = 7:73 …, and a 3:167 fragment).
- **False candidates:** 6, all sent to review, **none shown** («في سبيل الله…» ×3, «فقال لهم رسول الله», «قال ارجع إلى ربك»).

**Identification:** **0 wrong ayat shown** across 20 clips. 87% of recited ayat were auto-suggested. The rest are omissions that a person reviews; none are errors.

**Boundaries:** **0 extra words** shown, so text was never shown for something not recited. Omitted words are concentrated in mujawwad, where the ASR garbles elongations.

### 8.6 Identification: QF Search API vs local fuzzy search

- **Test set:** 55 snippets of up to 10 noisy Whisper words, one per recited ayah, cut by the EveryAyah ayah timings across the 8 new recitation clips. Plus 20 non-Quran snippets (8 words each) from the `x_shahrour1` lecture.
- **QF endpoint used:** the legacy unauthenticated `https://api.quran.com/api/v4/search?q=…` (2026-11-11). Production would use the authenticated QF Search API, which needs a `search` scope.

| Method | Right verse | Wrong verse | Non-Quran snippets given a verse | Confidence signal |
|---|---|---|---|---|
| QF search, top result | 44/55 (80%) | 11 | **20/20** | none: at most 3 words are highlighted, for right and wrong answers alike |
| Local fuzzy + uniqueness gate (auto-confirm class) | 27/55 | **0** | **0** | length, agreement, number of occurrences |
| QF search on the 28 snippets local search didn't auto-confirm | 17 right | 11 wrong | – | – |
| Local "review" class and QF search agreeing | 6/6 right | 0 | – | – |

- **QF search is a good candidate generator but can't decide.** It always returns a verse, including for non-Quran speech, and gives no usable score.
- **Local search** decides, with QF suggestions offered only inside review.
- **On whole transcripts** (§8.3) local search auto-suggests 87% of ayat with 0 wrong. Short isolated snippets are the hard case.

### 8.4 Timing (ayah start vs ground truth, 52 ayat in 8 clips)

| Method | Median error | p90 | ≤ 300 ms | ≤ 100 ms |
|---|---|---|---|---|
| Whisper word timestamps | 445 ms | 1,517 ms | 33% | – |
| + snap to the nearest pause (fixed −35 dB) | 37 ms | 492 ms | 73% | 63% |
| **+ snap to the nearest pause (adaptive −40…−20 dB)** | **33 ms** | **278 ms** | **88%** | **71%** |

**Partial-quote word timing** (QF word segments as truth): start errors 0 to −1,230 ms, end errors −30 to −693 ms (Whisper timestamps without snapping). Forced alignment (§10) is the next step if word-level highlighting is wanted.

### 8.5 DeepL ASR in the same pipeline (§9)

| Clip | Workers AI | DeepL Voice |
|---|---|---|
| q_mulk | 13/13 | 13/13 (raw WER 3.6%, normalised the same way) |
| Minshawy mujawwad | 13/16 | **16/16** |
| Abdul Basit mujawwad Rahman | **16/25** | 7/25 |
| wrong ayat shown | 0 | 0 |

The two engines fail on different clips, which is why the spec proposes DeepL as a "second opinion" on Quran spans for the high-accuracy tier.

## 9. DeepL measured (owner's API Pro account, 2026-11-11)

**Usage for the whole test** (`/v2/usage` after the runs):
- **13,365 characters** → $0.37
- **20 speech-to-text minutes** → $0.62 (includes one 408-timeout session; minutes round up per session)
- **2 speech-to-speech minutes** (one timed out, one completed); the Pro plan lists no STS price, so ask DeepL

**Total ≈ $1.00** plus STS. The test glossary was deleted afterwards.

### 9.1 Speech-to-text (Voice API)
- **How it works:**
  - The interface is `POST /v3/voice/realtime`, which returns a session URL; audio then streams over WebSocket at **2× real time at most** ([Voice API requirements](https://developers.deepl.com/docs/voice/voice-api-requirements.md): "Audio stream speed: maximum 2x real-time").
  - There is no batch file upload. Our wall time was 0.54–0.62× the audio length.
- **Arabic:** transcription is "provided by an external service partner" and must be given an explicit source language ([Supported Voice Languages](https://developers.deepl.com/docs/voice/supported-voice-languages.md)).

| Clip | DeepL | Workers AI | Bunny |
|---|---|---|---|
| q_mulk WER | **2.1%** | 6.2% | 11.1% |
| ar_duat3 | «التقى الجمعان», «المؤمنين» correct (Whisper had «انتقل», «المؤنين») | | |
| x_ashura2 | clean, with punctuation; «عاشوراء» correct | 7% word disagreement | |
| en_pickthall WER | 15.0% | 12.7% (Workers AI nova-3: 4.8%) | 16.4% |
| Mujawwad | Minshawy good (16/16 ayat via the pipeline); Rahman poor (61% raw WER) | | |

### 9.2 Translation (quality_optimized; 67 titles × 2 runs and 2 transcripts)
- **Speed:** titles p50 0.56 s and p95 0.68 s; with a glossary 0.59 s and 0.84 s. A 49-cue transcript in 0.8 s.
- **What the glossary fixed:**
  - "Shahrour" (it had written «شهور», which means "months"); «الحويني» (Hawini → Huwaini);
  - «المداخلة» ("critics" → "the Madkhalis"); "Nasheed" («أغاني», songs → «أنشودات»);
  - "Musa", "ﷺ", "Tawakkul", "Friday Khutbah".
- **Errors that remained** (the default LLM did not make these):
  - «فصامه موسى شكرا» → "Moses fasted, so thank you"
  - "He is the One…" → «هو المخلص» ("the Saviour")
  - «فوجد اليهود صياما» → the "he found" was dropped
  - «رضي الله عنهما» + glossary → "may Allah be pleased with him and her": the glossary matched a sub-phrase
  - a quoted verse turned from a question into a statement (19:66)
  - "Year 11" / "Part 3" invented
- **Quran:** like every MT, DeepL "translated" the ayat itself, which reinforces masking Quran before any MT.

### 9.3 Speech-to-speech (one 52 s Arabic clip → English voice)
- **Output:** 59 s of coherent English speech (Ogg/Opus, preset voice). Speaker match isn't offered for partner-provided Arabic.
- **Content check:** we transcribed the output. «أو ادفعوا» became "or pay the ransom", it said "God" and "Allah" inconsistently, and it **spoke a machine translation of 3:166–167 and 5:82**.
- **Usable as a future dubbing option** only if Quran spans keep the original audio.

## 10. Quran-specialised alternatives (researched 2026-11-11)

| Option | What it is | Accuracy (published) | Licence / access | Verdict |
|---|---|---|---|---|
| Tarteel | Quran recitation app (NVIDIA NeMo CitriNet) | "4 percent word-error rate" (NVIDIA case study) | "we currently do not offer a public API" ([support](https://support.tarteel.ai/en/articles/12414464-do-you-have-an-api-i-can-use)) | not available |
| tarteel-ai/whisper-base-ar-quran, whisper-tiny-ar-quran | Whisper fine-tunes | WER 5.75 / 7.05 (unnamed eval set) | Apache-2.0 | candidate second-opinion ASR on a GPU; not needed given §8 |
| wav2vec2 / XLS-R fine-tunes (arXiv 2606.19747) | Quran ASR study | WER 0.08 on EveryAyah | paper | research only |
| obadx Muaalem / HisnLabs tajweed-v2 | phoneme-level recitation checking | PER 0.21% (own test) / 7.0% on QDAT; tajweed-v2 runs on CPU, about 28 ms per 4 s | CC BY 4.0 paper / Apache-2.0 model | a future per-word verifier for mujawwad gaps |
| QV Finder (IJEECS 2025) | Whisper + Levenshtein verse search | "100% verse retrieval" with 2.5% false positives | paper | the same family as ours; their false positives are why we need review classes |
| Tadabur (arXiv 2604.18932) | ASR + embeddings vs fuzzy | 96.63% vs 86.03% coverage | data CC BY-NC | not usable commercially |
| Audio fingerprinting | match against known recordings | no Quran study found | – | identifies copies of famous reciters only |
| **Quran-Lab mfa-quran-hafs** | Montreal Forced Aligner Quran model | phone boundaries 10–20 ms median | **Apache-2.0** | **P5 forced alignment**, on CPU in the container |
| cpfair/quran-align | PocketSphinx per reciter | mean < 73 ms | MIT / CC BY 4.0 | older |
| ctc-forced-aligner (MMS), torchaudio MMS_FA | multilingual aligners | – | **CC-BY-NC** model; MMS_FA removed in torchaudio 2.9 | excluded |
| whisper-timestamped | Whisper attention DTW | – | **AGPL-3.0** | excluded |
| QF `chapter_recitations` segments | word timings for QF reciters | ms-level, as used for our p1–p3 truth | Content Sync (§11) | exact timings when the video uses a QF recitation |
| AyahFlow, Quran Caption, Minbar Caption | Quran video captioners | – | consumer apps / open source, no API | none caption lectures with verified references |

Sources: the subagent report of 2026-11-11, which fetched every URL listed in its table (Tarteel support pages, the Hugging Face model cards, arXiv 2606.19747, 2509.00094, 2604.18932, the IJEECS QV Finder PDF, Quran-Lab/mfa-quran-hafs, github.com/cpfair/quran-align, github.com/MahmoudAshraf97/ctc-forced-aligner, the pytorch audio docs, github.com/linto-ai/whisper-timestamped, ayahflow.ai, github.com/zonetecde/qurancaption, minbarcaption.com).

## 11. Quran Foundation Content Sync (corrects v1 §5)

v1 said QF "forbids a static cache". That left out the exception. Quotes, fetched 2026-11-11:
- **Developer Terms** (https://api-docs.quran.foundation/legal/developer-terms/, "Last updated: 2026-10-11"), §3.1: "Cache or store QF Content longer than 1 week **unless it is obtained and maintained through the Content Sync APIs** listed under Content Available for Offline Sync, or consists of font files or Mushaf images cached or bundled as described below." Also: "When using Content Sync, you must perform a next sync at least every 7 days when connectivity to QF permits and apply all available changes."
- **Content Sync guide** (https://api-docs.quran.foundation/docs/tutorials/content-sync/getting-started/): "Content Sync supports these resource groups: quran_core, mushafs, translations, word_by_word_translations, word_by_word_transliterations, tafsirs, recitations, chapter_recitations, and articles."

| Need | Group | Syncable? |
|---|---|---|
| Uthmani verse text with diacritics, word-level Imla'i/IndoPak/Tajweed text, juz/hizb boundaries | `quran_core:1` | yes ("canonical Uthmani verse text, word-level IndoPak Nastaleeq, IndoPak, Uthmani Tajweed, and Imla'i text") |
| Word-level Uthmani text | `mushafs:4` | yes ("For word-level Uthmani text, sync mushafs:4 (Uthmani Hafs)") |
| Translations (per edition) | `translations:<id>` | yes for **public** resources: "Bootstrap returns only public resources matching your filter" (the list needs credentials) |
| Word-by-word translation / transliteration | `word_by_word_*` | yes, for eligible resources |
| Reciter chapter audio + verse/word timings | `chapter_recitations:<id>` | yes ("Chapter audio file rows and associated verse and word timing segment rows") |
| Fonts, Mushaf images | not in sync | may be bundled with an active Developer Console account and QF credit (Terms §3.1) |

**Conditions we must meet (quoted in spec §9.4):** sync at least every 7 days; no prepackaged or build-time bundle; Quran text not modified; credit QF; no ML training without consent. Derived Materials, which explicitly include "indexes", follow the same restrictions.

**Not verifiable without credentials:** which translation ids are public for sync, and the rate limits. These are owner decisions O12 and O13 in the spec.

---

# v3 follow-up (2026-11-11): DeepL on lectures, quran.com-only identification

## 12. Lectures: Workers AI vs DeepL vs local whisper.cpp vs Bunny

**DeepL usage for this round:**
- 14 STT minutes, about **$0.43**. That covers `ar_gaza16`, `x_shahrour1`, `en_gooddeeds1` (each about 3 min) and the first 3 min of `ar_tahinu`. One session hung and was restarted with a timeout guard, and it was billed.
- **Account total across all tests:** 34 STT minutes (≈ $1.05), 13,365 characters (≈ $0.37) and 2 STS minutes.

**Reference transcripts (5.3 min of speech: `ar_duat3` 52 s, `x_ashura2` 177 s, `ar_gaza16` first 90 s).** No human listened to these. They were built as follows:
1. Word-level alignment of 3–4 independent transcripts: Workers AI, DeepL, local whisper.cpp, and Bunny where available.
2. Majority vote.
3. Manual adjudication of every disagreement, on Arabic grammar and sense and on the canonical wording of the quoted hadith (Ashura: «نحن أحق وأولى بموسى منكم», «فصامه رسول الله ﷺ وأمر بصيامه», «فاسأله التخفيف», «إني قد بلوت بني إسرائيل»; Gaza: «ما شحب وجه ولا اغبرت قدم في عمل تبتغى فيه درجات الجنة…») and the Quran (3:166 «التقى الجمعان»).
4. 11 spots that couldn't be resolved are wildcards, matching any word.

**Bias:** the draft used Workers AI as its backbone, and two of the voters are Whisper models, so the reference leans toward Workers AI. A native speaker should spot-check the files (`lecture_refs.json`, 610 words) before these numbers are quoted outside the team.

| Lecture | Workers AI | DeepL | local whisper.cpp | Bunny |
|---|---|---|---|---|
| ar_duat3 (MSA, Egyptian accent, Quran quotes) | 3.7% | 6.5% | 9.3% | 38.9% |
| x_ashura2 (hadith + commentary) | 3.4% | 3.1% | 6.2% | 30.4% |
| ar_gaza16, first 90 s (khutbah style) | 3.4% | **0.7%** | – | – |
| **Pooled, 610 words** | **3.4%** | **3.1%** | 6.9% (463 words) | 32.4% (463 words) |

**What differs between the two leaders:**
- **Workers AI:**
  - produced «عاشراء» for «عاشوراء» and «انتقل/المؤنين» in the 3:166 quote;
  - **hallucinated a subtitle credit at the end** («ترجمة نانسي قنقر»), a known Whisper failure (§5.4 filter);
  - turned «ولا اغبرت قدم» into «ولغ برت قدم».
- **DeepL:**
  - got the hadith and Quran wording right («بموسى منكم», «فاسأله», «بني إسرائيل», «التقى الجمعان»);
  - added punctuation;
  - dropped a few short words (للمنافقين…).

**Lectures without a reference** (word disagreement between Workers AI and DeepL): x_shahrour1 11.7%, en_gooddeeds1 7.8%, ar_tahinu 0–3 min 14.3% (the most colloquial and emotional delivery).

**Dialect:** the 6 production lectures are MSA with an Egyptian accent and some colloquial phrases. The library has no strongly dialectal clip, so dialect accuracy is still untested.

**Quran detection** gave identical results on DeepL and Workers AI transcripts for all 6 lectures: the same confirmed and review spans, and 0 wrong.

**Conclusion:** on lectures the two engines are at parity (≈ 3% WER). DeepL is better on formulaic religious wording (hadith and Quran). Workers AI stays the default at 1/54 of the cost; DeepL remains the high-accuracy option.

**DeepL translation errors, for the record (§9.2):**
- The meaning errors were in **titles and lecture sentences**: «فصامه موسى شكرا» → "so thank you"; "He is the One" → «هو المخلص»; a dropped "he found".
- One title error was on a **Quran verse quoted inside a title** (19:66, a question turned into a statement).
- The design never sends Quran to any MT (§5.5). Quran in titles and captions is a reference plus QF text fetched live, so that class of error can't reach viewers.

## 13. quran.com-only identification (mode B: QF Search + Content fetch + local verification, no stored index)

**Method, per snippet:**
1. QF search, top 10 (legacy `api.quran.com/api/v4/search`).
2. Fetch each candidate verse (`verses/by_key/{key}?fields=text_imlaei_simple`), held only for the run.
3. Our fuzzy matcher aligns the ASR words to each candidate.
4. Auto-suggest only if exactly one candidate passes: ≥ 6 matched words, ≥ 75% of the snippet, ≥ 90% inside the span.

| Set | Auto-suggested | Wrong | Review items with the correct suggestion |
|---|---|---|---|
| 55 per-ayah snippets (8 reciters) | 22 | **0** | 17 of 33 |
| 20 non-Quran snippets (lecture) | 0 | – | – |

- **API calls:** 64 searches and 519 verse fetches for 75 snippets. In production these are deduplicated per job and edge-cached for at most 7 days.
- **Compared with a local index (mode A):** 27/55 with 0 wrong.
- **Terms:** a full local index built from regular API responses isn't allowed (Content Sync is "the only permitted path for obtaining and maintaining an offline copy" of `quran_core`). So mode A needs Content Sync access (spec §5.5, O12/O13).


## 14. ElevenLabs Scribe v3, measured (2026-11-11)

**Setup:**
- **Key:** test-only, restricted to Speech to Text. It wasn't wired into any environment.
- **Request:** `POST https://api.elevenlabs.io/v1/speech-to-text` with `model_id=scribe_v3`, `language_code=ar`, `diarize=true`, `timestamps_granularity=word`.
- **Audio:** 6 clips, 16.7 min ≈ **$0.06** at $0.20/h, inside the plan's included hours. The key can't read usage (it lacks the `user_read` permission).

**Quran recitation** (Tanzil text as test reference; Workers AI and DeepL results from §8–9):

| Clip | Raw WER: Workers AI / DeepL / **Scribe** | Ayat auto-suggested: Workers AI / DeepL / **Scribe** | Wrong shown |
|---|---|---|---|
| Al-Mulk (Alafasy) | 6.2% / 3.6% / **1.4%** | 13/13 / 13/13 / **13/13** | 0 |
| al-Fajr (Minshawy, mujawwad) | – / 17.8% / **1.4%** | 13/16 / 16/16 / **16/16** | 0 |
| Ar-Rahman (Abdul Basit, mujawwad) | 32.3% / 61.1% / **1.1%** | 16/25 / 7/25 / **25/25** | 0 |

**Lectures** (adjudicated reference, §12; built from Workers AI, DeepL, whisper.cpp and Bunny, **without Scribe**, so the reference leans against it):

| Lecture | Workers AI | DeepL | **Scribe** |
|---|---|---|---|
| ar_duat3 | 3.7% | 6.5% | 6.5% |
| x_ashura2 | 3.4% | 3.1% | 4.5% |
| ar_gaza16 (first 90 s) | 3.4% | 0.7% | 1.4% |
| pooled (610 words) | 3.4% | 3.1% | 4.1% |

- **Quran detection on lectures:** identical to the other engines (3:166–167 and 5:82 confirmed; the same review items).
- **Timestamps:** Minshawy ayah starts were a median **95 ms** off raw (Whisper: 445 ms) and 38 ms after pause snapping.
- **Diarization:** all three single-speaker lectures were labelled as one speaker (`speaker_0`), with no false splits. Multi-speaker audio wasn't tested.
- **Latency:** the batch API answered in **2–5 s per clip** (52 s to 5.8 min of audio). DeepL Voice streams at 2× real time at most (1–2 min per clip).

**Conclusion:**
- Scribe v3 is the best engine measured for Quran recitation, the hardest case, and clearly better than DeepL there. On lectures it is close to the others, within this reference's bias.
- It is the preferred optional high-accuracy provider and the preferred Quran second opinion: off by default, never in tests or QA, and production use needs a paid ElevenLabs plan (spec §7.3a).
