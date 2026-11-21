/**
 * A formatted date-time whose time of day, AM/PM («ص/م») and zone never break across lines
 * ("4:05 PM EST", «٩:٠٧ ص غرينتش-٥»): the spaces after the last comma become no-break spaces.
 * The date before that comma may still wrap, so a narrow phone line breaks between date and time.
 */
export function keepTimeTogether(formatted: string): string {
  const cut = Math.max(formatted.lastIndexOf(','), formatted.lastIndexOf('،'));
  const head = cut >= 0 ? formatted.slice(0, cut + 1) : '';
  const tail = cut >= 0 ? formatted.slice(cut + 1) : formatted;
  // Keep one ordinary space right after the comma (the allowed break), join the rest
  const lead = tail.match(/^ */)?.[0] ?? '';
  return head + lead + tail.slice(lead.length).replace(/ /g, '\u00a0');
}
