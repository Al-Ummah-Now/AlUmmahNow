/**
 * Text direction in the emails' value rows (layout.ts `facts`). The layout's value cell is dir="auto", which
 * is right for one value (a name, a number, a sentence). A value made of several parts (a list, before and
 * after, a name with its address) says its direction itself, through `emailRow`.
 */
type EmailLocale = 'en' | 'ar';

/** A value with its own direction (FSI…PDI), so what is inside never reorders what is around it. */
export const isolate = (text: string) => `\u2068${text}\u2069`;
/** A phrase in the email's direction (RLI or LRI…PDI), whatever is around it: a list, or a whole row. */
export const inDirection = (locale: EmailLocale, text: string) => `${locale === 'ar' ? '\u2067' : '\u2066'}${text}\u2069`;
/**
 * A row in the email's direction, in every client. dir="auto" reads the first letter outside an isolate: the
 * unseen mark (RLM, LRM) is that letter. A client that drops dir and style still has the isolate, which needs
 * neither.
 */
export const emailRow = (locale: EmailLocale, text: string) => `${locale === 'ar' ? '\u200f' : '\u200e'}${inDirection(locale, text)}`;
