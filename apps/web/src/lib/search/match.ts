/**
 * In-page list filtering with the search index's normalisation: Arabic
 * tashkeel, alef forms, taa marbuta and alef maqsura, case and accents are
 * ignored, and words match by prefix (also after ال), so filters agree with
 * the suggestions shown above them.
 */

import { normalizeSearchText, scoreSuggestionMatch } from '@al-ummah/shared-types';

/** True when the query is blank or any of the texts matches it. */
export function matchesSearch(query: string | null | undefined, ...texts: Array<string | null | undefined>): boolean {
  if (!normalizeSearchText(query)) return true;
  return texts.some((text) => scoreSuggestionMatch(text, query) > 0);
}
