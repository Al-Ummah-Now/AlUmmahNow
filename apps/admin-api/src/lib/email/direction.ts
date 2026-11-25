/**
 * Text direction in the emails' value rows (layout.ts `facts`). The layout's value cell is dir="auto", which
 * is right for one value (a name, a number, a sentence). A value made of several parts (a list, before and
 * after, a name with its address) says its direction itself, through `emailRow`.
 */
type EmailLocale = 'en' | 'ar';

import { isolateText } from '@al-ummah/shared-types';

export { isolateText as isolate, stripBidiControls } from '@al-ummah/shared-types';

/** An address: always left to right, whatever its first letter (LRI…PDI in place of FSI…PDI). */
export const isolateLtr = (text: string) => `\u2066${isolateText(text).slice(1)}`;

/** A phrase in the email's direction (RLI or LRI…PDI), whatever is around it: a list, or a whole row. Its values are isolated (`isolate`). */
export const inDirection = (locale: EmailLocale, text: string) => `${locale === 'ar' ? '\u2067' : '\u2066'}${text}\u2069`;
/**
 * A row in the email's direction, in every client. dir="auto" reads the first letter outside an isolate: the
 * unseen mark (RLM, LRM) is that letter. A client that drops dir and style still has the isolate, which needs
 * neither.
 */
export const emailRow = (locale: EmailLocale, text: string) => `${locale === 'ar' ? '\u200f' : '\u200e'}${inDirection(locale, text)}`;
