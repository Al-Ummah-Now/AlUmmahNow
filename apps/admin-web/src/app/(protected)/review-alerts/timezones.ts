/**
 * Time zones for the rota's type-to-search picker: every IANA zone with its current UTC offset,
 * a name in the admin's language and the words it can be found by (the id, its city, the zone's
 * generic name and its country in English and in the admin's language, and an Arabic city name
 * for the zones staff most often use: Intl names countries and zones but not cities).
 * Pure apart from Intl; the list is built once per language and kept.
 */

export interface ZoneOption {
  id: string;
  /** City in the admin's language when known, else from the id ("New York"). */
  city: string;
  /** The zone's generic name in the admin's language ("Eastern Time", "توقيت الأردن"). */
  name: string;
  /** "UTC+3", "UTC−4:30", "UTC" */
  offset: string;
  offsetMinutes: number;
  /** Normalised words it matches (see normalizeSearch). */
  terms: string;
}

/** Arabic city names for common zones (CLDR exemplar cities; Intl does not expose these). */
export const ZONE_CITY_AR: Record<string, string> = {
  UTC: 'التوقيت العالمي',
  'Asia/Riyadh': 'الرياض',
  'Asia/Amman': 'عمّان',
  'Asia/Dubai': 'دبي',
  'Asia/Qatar': 'الدوحة',
  'Asia/Kuwait': 'الكويت',
  'Asia/Bahrain': 'البحرين',
  'Asia/Muscat': 'مسقط',
  'Asia/Aden': 'عدن',
  'Asia/Baghdad': 'بغداد',
  'Asia/Damascus': 'دمشق',
  'Asia/Beirut': 'بيروت',
  'Asia/Jerusalem': 'القدس',
  'Asia/Gaza': 'غزة',
  'Asia/Hebron': 'الخليل',
  'Africa/Cairo': 'القاهرة',
  'Africa/Khartoum': 'الخرطوم',
  'Africa/Tripoli': 'طرابلس',
  'Africa/Tunis': 'تونس',
  'Africa/Algiers': 'الجزائر',
  'Africa/Casablanca': 'الدار البيضاء',
  'Africa/Nouakchott': 'نواكشوط',
  'Africa/Mogadishu': 'مقديشو',
  'Africa/Djibouti': 'جيبوتي',
  'Africa/Lagos': 'لاغوس',
  'Africa/Nairobi': 'نيروبي',
  'Asia/Tehran': 'طهران',
  'Europe/Istanbul': 'إسطنبول',
  'Asia/Karachi': 'كراتشي',
  'Asia/Kolkata': 'كولكاتا',
  'Asia/Dhaka': 'دكا',
  'Asia/Jakarta': 'جاكرتا',
  'Asia/Kuala_Lumpur': 'كوالالمبور',
  'Asia/Singapore': 'سنغافورة',
  'Asia/Tokyo': 'طوكيو',
  'Asia/Shanghai': 'شنغهاي',
  'Europe/London': 'لندن',
  'Europe/Dublin': 'دبلن',
  'Europe/Paris': 'باريس',
  'Europe/Berlin': 'برلين',
  'Europe/Amsterdam': 'أمستردام',
  'Europe/Brussels': 'بروكسل',
  'Europe/Madrid': 'مدريد',
  'Europe/Rome': 'روما',
  'Europe/Stockholm': 'ستوكهولم',
  'Europe/Moscow': 'موسكو',
  'America/New_York': 'نيويورك',
  'America/Detroit': 'ديترويت',
  'America/Chicago': 'شيكاغو',
  'America/Denver': 'دنفر',
  'America/Los_Angeles': 'لوس أنجلوس',
  'America/Toronto': 'تورونتو',
  'America/Vancouver': 'فانكوفر',
  'America/Sao_Paulo': 'ساو باولو',
  'Australia/Sydney': 'سيدني',
  'Australia/Melbourne': 'ملبورن',
};

/** Lower case, no accents or Arabic diacritics/tatweel, one alef/yeh/heh form, "_" and "/" as spaces. */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[_/]+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** "New_York" from "America/New_York", "Buenos Aires" from "America/Argentina/Buenos_Aires". */
export function cityFromId(id: string): string {
  return (id.split('/').pop() ?? id).replace(/_/g, ' ');
}

function zonePart(locale: string, timeZone: string, timeZoneName: Intl.DateTimeFormatOptions['timeZoneName'], at: Date): string {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone, timeZoneName }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

/** The zone's offset at `at`: "UTC+3" / "UTC−4:30" / "UTC", and in minutes for sorting. */
export function zoneOffset(timeZone: string, at: Date = new Date()): { label: string; minutes: number } {
  const raw = zonePart('en-US', timeZone, 'shortOffset', at); // "GMT+3", "GMT-4:30", "GMT"
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(raw);
  if (!m) return { label: 'UTC', minutes: 0 };
  const sign = m[1] === '-' ? -1 : 1;
  const minutes = sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  return { label: `UTC${sign < 0 ? '−' : '+'}${Number(m[2])}${m[3] && m[3] !== '00' ? `:${m[3]}` : ''}`, minutes };
}

/** Zone id → ISO region, from Intl.Locale's time zones per region (Chrome, Safari; empty elsewhere). */
let regionsByZone: Map<string, string> | null = null;
function zoneRegions(): Map<string, string> {
  if (regionsByZone) return regionsByZone;
  regionsByZone = new Map();
  const A = 'A'.charCodeAt(0);
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < 26; j++) {
      const region = String.fromCharCode(A + i, A + j);
      try {
        const loc = new Intl.Locale(`und-${region}`) as Intl.Locale & { getTimeZones?: () => string[]; timeZones?: string[] };
        const zones = loc.getTimeZones?.() ?? loc.timeZones;
        // Old codes (NT, UK, YU) canonicalise to the current one (SA, GB, RS)
        for (const z of zones ?? []) if (!regionsByZone.has(z)) regionsByZone.set(z, loc.region ?? region);
      } catch {
        // not a region this runtime knows
      }
    }
  }
  return regionsByZone;
}

function regionName(locale: string, region: string | undefined): string {
  if (!region) return '';
  try {
    return new Intl.DisplayNames(locale, { type: 'region', fallback: 'none' }).of(region) ?? '';
  } catch {
    return '';
  }
}

/** One zone's option (also used for the chosen zone before the list is built). */
export function zoneOption(locale: string, id: string, at: Date = new Date(), regions?: Map<string, string>): ZoneOption {
  const ar = locale.startsWith('ar');
  const cityEn = cityFromId(id);
  const cityAr = ZONE_CITY_AR[id];
  const name = zonePart(locale, id, 'longGeneric', at);
  const nameEn = ar ? zonePart('en', id, 'longGeneric', at) : name;
  const region = regions?.get(id);
  const offset = zoneOffset(id, at);
  return {
    id,
    city: (ar && cityAr) || cityEn,
    name: name && !/^(GMT|UTC|غرينتش)/.test(name) ? name : '',
    offset: offset.label,
    offsetMinutes: offset.minutes,
    terms: normalizeSearch([id, cityEn, cityAr ?? '', name, nameEn, regionName(locale, region), ar ? regionName('en', region) : ''].join(' ')),
  };
}

const cache = new Map<string, ZoneOption[]>();

/** Every zone for `locale`, by offset then city. Built once per language. */
export function zoneOptions(locale: string, zones: string[], at: Date = new Date()): ZoneOption[] {
  const key = `${locale}|${zones.length}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const regions = zoneRegions();
  const list = zones.map((id) => zoneOption(locale, id, at, regions)).sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.city.localeCompare(b.city, locale));
  cache.set(key, list);
  return list;
}

/** Zones matching every word of `query`; cities that start with it first. Empty query: all. */
export function matchZones(options: ZoneOption[], query: string): ZoneOption[] {
  const q = normalizeSearch(query);
  if (!q) return options;
  const words = q.split(' ');
  const hits = options.filter((o) => words.every((w) => o.terms.includes(w)));
  const starts = (o: ZoneOption) => normalizeSearch(o.city).startsWith(q) || normalizeSearch(cityFromId(o.id)).startsWith(q);
  return [...hits.filter(starts), ...hits.filter((o) => !starts(o))];
}
