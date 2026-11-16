/**
 * An email address as text: always left to right and isolated from the
 * surrounding language (an Arabic page keeps it whole and in order), and it
 * only breaks at its natural joints, after "@" and before each ".", never in
 * the middle of a word. The full address is the tooltip. No hooks: server and
 * client components alike.
 */
/** The address split into the pieces a line may break between ("name@", "example", ".org"). */
export function emailParts(email: string): string[] {
  const at = email.lastIndexOf('@');
  const local = at >= 0 ? email.slice(0, at + 1) : '';
  const domain = at >= 0 ? email.slice(at + 1) : email;
  const domainParts = domain.split(/(?=\.)/);
  return [...(local ? [local] : []), ...domainParts].filter(Boolean);
}

export function EmailText({ email, className = '', testId }: { email: string; className?: string; testId?: string }) {
  return (
    <bdi dir="ltr" title={email} className={`[overflow-wrap:normal] [word-break:normal] ${className}`} data-testid={testId}>
      {emailParts(email).flatMap((part, i) => (i > 0 ? [<wbr key={i} />, part] : [part]))}
    </bdi>
  );
}
