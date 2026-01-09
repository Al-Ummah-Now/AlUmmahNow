/**
 * Template Variable Processor
 * Processes template variables like {{date}}, {{episode}}, etc.
 */

/**
 * Variable processor function type
 */
type VariableProcessor = (value?: string) => string;

/**
 * Hijri date helper (simplified - can be enhanced with proper library)
 */
function getHijriDate(): string {
  // This is a simplified implementation
  // In production, use a proper Hijri calendar library
  const now = new Date();
  const hijriYear = Math.floor((now.getFullYear() - 622) * 1.030684);
  return `${hijriYear}`;
}

/**
 * Available template variables
 */
export const TEMPLATE_VARIABLES: Record<string, VariableProcessor> = {
  // Date/Time variables
  'date': () => new Date().toLocaleDateString('en-US'),
  'date_iso': () => new Date().toISOString().split('T')[0],
  'date_ar': () => new Date().toLocaleDateString('ar-SA'),
  'time': () => new Date().toLocaleTimeString('en-US'),
  'time_24': () => new Date().toLocaleTimeString('en-US', { hour12: false }),
  'day': () => new Date().toLocaleDateString('en-US', { weekday: 'long' }),
  'day_ar': () => new Date().toLocaleDateString('ar-SA', { weekday: 'long' }),
  'day_short': () => new Date().toLocaleDateString('en-US', { weekday: 'short' }),
  'month': () => new Date().toLocaleDateString('en-US', { month: 'long' }),
  'month_ar': () => new Date().toLocaleDateString('ar-SA', { month: 'long' }),
  'month_short': () => new Date().toLocaleDateString('en-US', { month: 'short' }),
  'month_number': () => String(new Date().getMonth() + 1).padStart(2, '0'),
  'year': () => String(new Date().getFullYear()),
  'year_short': () => String(new Date().getFullYear()).slice(-2),
  'hijri_date': () => getHijriDate(),
  'hijri_year': () => getHijriDate(),

  // User input variables (use provided value or placeholder)
  'episode': (value?: string) => value || '[Episode]',
  'surah': (value?: string) => value || '[Surah]',
  'topic': (value?: string) => value || '[Topic]',
  'speaker': (value?: string) => value || '[Speaker]',
  'series': (value?: string) => value || '[Series]',
  'number': (value?: string) => value || '[Number]',
  'title': (value?: string) => value || '[Title]',
  'part': (value?: string) => value || '[Part]',
  'chapter': (value?: string) => value || '[Chapter]',
  'season': (value?: string) => value || '[Season]',
};

/**
 * Process template variables in text
 * Replaces {{variable}} with actual values
 *
 * @param text - Template text with variables
 * @param userValues - User-provided values for variables (optional)
 * @returns Processed text with variables replaced
 */
export function processTemplateVariables(
  text: string,
  userValues?: Record<string, string>
): string {
  if (!text) return '';

  return text.replace(/\{\{(\w+)\}\}/g, (match, variableName) => {
    const processor = TEMPLATE_VARIABLES[variableName];

    if (!processor) {
      // Variable not recognized, return as-is
      return match;
    }

    // Use user-provided value if available
    const userValue = userValues?.[variableName];
    return processor(userValue);
  });
}

/**
 * Extract variable names from template text
 * Returns list of all {{variable}} found in text
 *
 * @param text - Template text
 * @returns Array of variable names
 */
export function extractTemplateVariables(text: string): string[] {
  if (!text) return [];

  const matches = text.matchAll(/\{\{(\w+)\}\}/g);
  const variables = Array.from(matches, match => match[1]);

  // Return unique variable names
  return Array.from(new Set(variables));
}

/**
 * Validate template variables
 * Checks if all variables in text are recognized
 *
 * @param text - Template text
 * @returns Object with validation result and unknown variables
 */
export function validateTemplateVariables(text: string): {
  isValid: boolean;
  unknownVariables: string[];
} {
  const variables = extractTemplateVariables(text);
  const unknownVariables = variables.filter(
    variable => !TEMPLATE_VARIABLES[variable]
  );

  return {
    isValid: unknownVariables.length === 0,
    unknownVariables,
  };
}

/**
 * Get list of available variables with descriptions
 * Useful for UI documentation
 */
export function getAvailableVariables(): Array<{
  name: string;
  description: string;
  category: string;
}> {
  return [
    // Date/Time
    { name: 'date', description: 'Current date (MM/DD/YYYY)', category: 'Date & Time' },
    { name: 'date_iso', description: 'ISO date (YYYY-MM-DD)', category: 'Date & Time' },
    { name: 'date_ar', description: 'Arabic date format', category: 'Date & Time' },
    { name: 'time', description: 'Current time (12-hour)', category: 'Date & Time' },
    { name: 'time_24', description: 'Current time (24-hour)', category: 'Date & Time' },
    { name: 'day', description: 'Day of week (Monday, Tuesday...)', category: 'Date & Time' },
    { name: 'day_ar', description: 'Day of week in Arabic', category: 'Date & Time' },
    { name: 'day_short', description: 'Day of week (Mon, Tue...)', category: 'Date & Time' },
    { name: 'month', description: 'Month name (January, February...)', category: 'Date & Time' },
    { name: 'month_ar', description: 'Month name in Arabic', category: 'Date & Time' },
    { name: 'month_short', description: 'Month name (Jan, Feb...)', category: 'Date & Time' },
    { name: 'month_number', description: 'Month number (01-12)', category: 'Date & Time' },
    { name: 'year', description: 'Full year (2025)', category: 'Date & Time' },
    { name: 'year_short', description: 'Short year (25)', category: 'Date & Time' },
    { name: 'hijri_date', description: 'Hijri year', category: 'Date & Time' },
    { name: 'hijri_year', description: 'Hijri year', category: 'Date & Time' },

    // User Input
    { name: 'episode', description: 'Episode number', category: 'Content' },
    { name: 'surah', description: 'Surah name', category: 'Content' },
    { name: 'topic', description: 'Topic or subject', category: 'Content' },
    { name: 'speaker', description: 'Speaker name', category: 'Content' },
    { name: 'series', description: 'Series name', category: 'Content' },
    { name: 'number', description: 'Generic number', category: 'Content' },
    { name: 'title', description: 'Custom title', category: 'Content' },
    { name: 'part', description: 'Part number', category: 'Content' },
    { name: 'chapter', description: 'Chapter name or number', category: 'Content' },
    { name: 'season', description: 'Season number', category: 'Content' },
  ];
}
