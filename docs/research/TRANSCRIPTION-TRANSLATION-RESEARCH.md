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
- **ElevenLabs and DeepL weren't measured.** No keys are in the Secrets Store, and the owner didn't answer the key request in time. Their rows below use vendor and independent figures.

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
| **Tanzil Uthmani 1.1** | detection index and replacement text, stored offline | CC BY 3.0, **verbatim only**; credit "Tanzil Project" with a link, keep the notice, watch for updates |
| **QuranEnc** `english_saheeh` 1.1.2 (Noor International), `english_rwwad` 1.0.21, `english_hilali_khan` 1.1.3, plus other languages | official translation per language, stored offline (SQLite download) | republishing allowed: no changes, credit publisher and QuranEnc with the version number, keep it updated, no inappropriate ads next to it |
| Quran Foundation (quran.com) Content API v4 | verse/word timestamps, search, live fallback | OAuth2 client credentials; **cache ≤ 1 week**; offline copies only through Content Sync with a 7-day refresh; no ML training without consent; in-video use allowed with credit |
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
6. **Quran sources:** Tanzil Uthmani for the Arabic text and QuranEnc for translations, both stored offline. Quran Foundation's terms forbid a static cache, so their API is only for timestamps, search and live fallback.

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
