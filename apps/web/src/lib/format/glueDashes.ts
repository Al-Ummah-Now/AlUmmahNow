/**
 * Keeps a dash on the line of the word before it: the space before an em or en dash ("Surah
 * Al-Kahf — full recitation", «سورة الكهف — تلاوة كاملة») becomes a no-break space, so a
 * wrapped title (`text-wrap: balance`) never starts a line with "—". The space after the dash
 * stays a normal break point, so the preferred break is right after the dash.
 */
export function glueDashes(text: string): string {
  return text.replace(/[ \t]+(?=[—–])/gu, ' ');
}
