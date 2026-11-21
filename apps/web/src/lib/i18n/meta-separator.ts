/**
 * How a meta line joins its parts ("6 views • 1 day ago"). English keeps its dot; Arabic uses the
 * Arabic comma «،», because a bullet or middle dot next to Arabic digits reads as the digit zero «٠»
 * («مشاهدتان • قبل ٥ دقائق»). The same rule as the Android (#51) and desktop (#69) apps and the
 * videos admin; one implementation in shared-types locale-format (O38).
 */
export { metaMark, metaSeparator, joinMeta } from '@al-ummah/shared-types';
export type MetaSeparatorLang = 'en' | 'ar' | string;
