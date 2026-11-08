/**
 * Timezone Utility Functions
 * Provides timezone detection, conversion, and common timezone lists
 */

/**
 * Get the user's browser timezone using Intl API
 * Returns IANA timezone (e.g., 'America/New_York', 'Asia/Dubai')
 */
export function getBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Validate if a timezone string is valid IANA timezone
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch (_error) {
    return false;
  }
}

/**
 * Get timezone offset in minutes for a given timezone
 * Positive values are ahead of UTC, negative values are behind
 */
export function getTimezoneOffset(timezone: string, date: Date = new Date()): number {
  try {
    // Get the UTC time
    const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
    // Get the time in the target timezone
    const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
    // Calculate difference in minutes
    return (tzDate.getTime() - utcDate.getTime()) / (1000 * 60);
  } catch (_error) {
    return 0;
  }
}

/**
 * Format timezone offset as string (e.g., 'UTC+3', 'UTC-5')
 */
export function formatTimezoneOffset(timezone: string): string {
  const offset = getTimezoneOffset(timezone);
  const hours = Math.abs(offset / 60);
  const sign = offset >= 0 ? '+' : '-';
  return `UTC${sign}${hours}`;
}

/**
 * Common timezones grouped by region
 * Useful for timezone selector dropdowns
 */
export const COMMON_TIMEZONES = {
  'North America': [
    { value: 'America/New_York', label: 'Eastern Time (ET)', offset: 'UTC-5' },
    { value: 'America/Chicago', label: 'Central Time (CT)', offset: 'UTC-6' },
    { value: 'America/Denver', label: 'Mountain Time (MT)', offset: 'UTC-7' },
    { value: 'America/Los_Angeles', label: 'Pacific Time (PT)', offset: 'UTC-8' },
    { value: 'America/Anchorage', label: 'Alaska Time (AKT)', offset: 'UTC-9' },
    { value: 'Pacific/Honolulu', label: 'Hawaii Time (HT)', offset: 'UTC-10' },
  ],
  'Europe': [
    { value: 'Europe/London', label: 'London (GMT)', offset: 'UTC+0' },
    { value: 'Europe/Paris', label: 'Paris (CET)', offset: 'UTC+1' },
    { value: 'Europe/Berlin', label: 'Berlin (CET)', offset: 'UTC+1' },
    { value: 'Europe/Rome', label: 'Rome (CET)', offset: 'UTC+1' },
    { value: 'Europe/Athens', label: 'Athens (EET)', offset: 'UTC+2' },
    { value: 'Europe/Moscow', label: 'Moscow (MSK)', offset: 'UTC+3' },
    { value: 'Europe/Istanbul', label: 'Istanbul (TRT)', offset: 'UTC+3' },
  ],
  'Middle East': [
    { value: 'Asia/Dubai', label: 'Dubai (GST)', offset: 'UTC+4' },
    { value: 'Asia/Riyadh', label: 'Riyadh (AST)', offset: 'UTC+3' },
    { value: 'Asia/Kuwait', label: 'Kuwait (AST)', offset: 'UTC+3' },
    { value: 'Asia/Qatar', label: 'Doha (AST)', offset: 'UTC+3' },
    { value: 'Asia/Bahrain', label: 'Manama (AST)', offset: 'UTC+3' },
    { value: 'Asia/Jerusalem', label: 'Jerusalem (IST)', offset: 'UTC+2' },
    { value: 'Asia/Amman', label: 'Amman (EET)', offset: 'UTC+2' },
    { value: 'Asia/Beirut', label: 'Beirut (EET)', offset: 'UTC+2' },
  ],
  'Asia': [
    { value: 'Asia/Karachi', label: 'Karachi (PKT)', offset: 'UTC+5' },
    { value: 'Asia/Kolkata', label: 'Mumbai/Delhi (IST)', offset: 'UTC+5:30' },
    { value: 'Asia/Dhaka', label: 'Dhaka (BST)', offset: 'UTC+6' },
    { value: 'Asia/Bangkok', label: 'Bangkok (ICT)', offset: 'UTC+7' },
    { value: 'Asia/Singapore', label: 'Singapore (SGT)', offset: 'UTC+8' },
    { value: 'Asia/Hong_Kong', label: 'Hong Kong (HKT)', offset: 'UTC+8' },
    { value: 'Asia/Shanghai', label: 'Beijing (CST)', offset: 'UTC+8' },
    { value: 'Asia/Tokyo', label: 'Tokyo (JST)', offset: 'UTC+9' },
    { value: 'Asia/Seoul', label: 'Seoul (KST)', offset: 'UTC+9' },
  ],
  'Africa': [
    { value: 'Africa/Cairo', label: 'Cairo (EET)', offset: 'UTC+2' },
    { value: 'Africa/Lagos', label: 'Lagos (WAT)', offset: 'UTC+1' },
    { value: 'Africa/Johannesburg', label: 'Johannesburg (SAST)', offset: 'UTC+2' },
    { value: 'Africa/Nairobi', label: 'Nairobi (EAT)', offset: 'UTC+3' },
  ],
  'Australia & Pacific': [
    { value: 'Australia/Sydney', label: 'Sydney (AEDT)', offset: 'UTC+11' },
    { value: 'Australia/Melbourne', label: 'Melbourne (AEDT)', offset: 'UTC+11' },
    { value: 'Australia/Perth', label: 'Perth (AWST)', offset: 'UTC+8' },
    { value: 'Pacific/Auckland', label: 'Auckland (NZDT)', offset: 'UTC+13' },
  ],
  'South America': [
    { value: 'America/Sao_Paulo', label: 'São Paulo (BRT)', offset: 'UTC-3' },
    { value: 'America/Buenos_Aires', label: 'Buenos Aires (ART)', offset: 'UTC-3' },
    { value: 'America/Bogota', label: 'Bogotá (COT)', offset: 'UTC-5' },
    { value: 'America/Santiago', label: 'Santiago (CLT)', offset: 'UTC-3' },
  ],
};

const REGION_NAMES_AR: Record<string, string> = {
  'North America': 'أمريكا الشمالية',
  'Europe': 'أوروبا',
  'Middle East': 'الشرق الأوسط',
  'Asia': 'آسيا',
  'Africa': 'أفريقيا',
  'Australia & Pacific': 'أستراليا والمحيط الهادئ',
  'South America': 'أمريكا الجنوبية',
};

const TIMEZONE_NAMES_AR: Record<string, string> = {
  'America/New_York': 'التوقيت الشرقي (أمريكا)',
  'America/Chicago': 'التوقيت المركزي (أمريكا)',
  'America/Denver': 'التوقيت الجبلي (أمريكا)',
  'America/Los_Angeles': 'توقيت المحيط الهادئ (أمريكا)',
  'America/Anchorage': 'توقيت ألاسكا',
  'Pacific/Honolulu': 'توقيت هاواي',
  'Europe/London': 'لندن',
  'Europe/Paris': 'باريس',
  'Europe/Berlin': 'برلين',
  'Europe/Rome': 'روما',
  'Europe/Athens': 'أثينا',
  'Europe/Moscow': 'موسكو',
  'Europe/Istanbul': 'إسطنبول',
  'Asia/Dubai': 'دبي',
  'Asia/Riyadh': 'الرياض',
  'Asia/Kuwait': 'الكويت',
  'Asia/Qatar': 'الدوحة',
  'Asia/Bahrain': 'المنامة',
  'Asia/Jerusalem': 'القدس',
  'Asia/Amman': 'عمّان',
  'Asia/Beirut': 'بيروت',
  'Asia/Karachi': 'كراتشي',
  'Asia/Kolkata': 'مومباي/دلهي',
  'Asia/Dhaka': 'دكا',
  'Asia/Bangkok': 'بانكوك',
  'Asia/Singapore': 'سنغافورة',
  'Asia/Hong_Kong': 'هونغ كونغ',
  'Asia/Shanghai': 'بكين',
  'Asia/Tokyo': 'طوكيو',
  'Asia/Seoul': 'سيول',
  'Africa/Cairo': 'القاهرة',
  'Africa/Lagos': 'لاغوس',
  'Africa/Johannesburg': 'جوهانسبرغ',
  'Africa/Nairobi': 'نيروبي',
  'Australia/Sydney': 'سيدني',
  'Australia/Melbourne': 'ملبورن',
  'Australia/Perth': 'بيرث',
  'Pacific/Auckland': 'أوكلاند',
  'America/Sao_Paulo': 'ساو باولو',
  'America/Buenos_Aires': 'بوينس آيرس',
  'America/Bogota': 'بوغوتا',
  'America/Santiago': 'سانتياغو',
};

/** A COMMON_TIMEZONES entry's label in the page language. */
export function localizedTimezoneLabel(tz: { value: string; label: string }, locale: string): string {
  return (locale === 'ar' && TIMEZONE_NAMES_AR[tz.value]) || tz.label;
}

/** A COMMON_TIMEZONES region name in the page language. */
export function localizedTimezoneRegion(region: string, locale: string): string {
  return (locale === 'ar' && REGION_NAMES_AR[region]) || region;
}

/**
 * Get flat list of all timezones (for searchable dropdowns)
 */
export function getAllTimezones(): Array<{ value: string; label: string; offset: string; region: string }> {
  const timezones: Array<{ value: string; label: string; offset: string; region: string }> = [];

  for (const [region, tzList] of Object.entries(COMMON_TIMEZONES)) {
    for (const tz of tzList) {
      timezones.push({ ...tz, region });
    }
  }

  return timezones;
}

/**
 * Whether a timezone is one of the COMMON_TIMEZONES dropdown options. A stored
 * or detected zone outside the list (e.g. "UTC") must be added as its own
 * option, otherwise the select shows (and saves) the first entry instead.
 */
export function isListedTimezone(timezone: string): boolean {
  return getAllTimezones().some(tz => tz.value === timezone);
}

/**
 * Get timezone display name
 * Returns a friendly name like "Dubai (GST) UTC+4"
 */
export function getTimezoneDisplayName(timezone: string, locale: string = 'en'): string {
  const allTimezones = getAllTimezones();
  const found = allTimezones.find(tz => tz.value === timezone);

  if (found) {
    return `${localizedTimezoneLabel(found, locale)} ${found.offset}`;
  }

  // Fallback: format the timezone name
  const offset = formatTimezoneOffset(timezone);
  const name = timezone.split('/').pop()?.replace(/_/g, ' ') || timezone;
  return `${name} (${offset})`;
}

/**
 * Convert a UTC date string to user's timezone
 * Returns a Date object in the user's timezone
 */
export function convertUTCToTimezone(utcDateString: string, timezone: string): Date {
  const utcDate = new Date(utcDateString);

  // Convert to the target timezone
  const tzDateString = utcDate.toLocaleString('en-US', { timeZone: timezone });
  return new Date(tzDateString);
}

/**
 * Convert a date in user's timezone to UTC
 * Returns ISO 8601 string in UTC
 */
export function convertTimezoneToUTC(date: Date, timezone: string): string {
  // Get the date string in the specified timezone
  const tzDateString = date.toLocaleString('en-US', { timeZone: timezone });
  const tzDate = new Date(tzDateString);

  // Calculate the offset
  const offset = date.getTime() - tzDate.getTime();

  // Apply the offset to get UTC
  const utcDate = new Date(date.getTime() - offset);
  return utcDate.toISOString();
}

/**
 * Get timezone abbreviation (e.g., 'EST', 'PST', 'GST')
 * Uses Intl.DateTimeFormat to get the localized timezone name
 */
export function getTimezoneAbbreviation(timezone: string, date: Date = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'short',
    });

    const parts = formatter.formatToParts(date);
    const timeZonePart = parts.find(part => part.type === 'timeZoneName');
    return timeZonePart?.value || timezone;
  } catch (_error) {
    return timezone;
  }
}

/**
 * Check if a timezone observes Daylight Saving Time (DST)
 * by comparing offset in January vs July
 */
export function observesDST(timezone: string): boolean {
  const jan = new Date(new Date().getFullYear(), 0, 1);
  const jul = new Date(new Date().getFullYear(), 6, 1);

  const janOffset = getTimezoneOffset(timezone, jan);
  const julOffset = getTimezoneOffset(timezone, jul);

  return janOffset !== julOffset;
}
