/**
 * Help text with code spans (wiki AUN-ADMIN-HELP): `1.4.0` in backticks is a literal value the admin
 * types, shown as code, left to right, exactly as written (Arabic text around it stays ٠–٩).
 */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/`([^`]+)`/);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} dir="ltr" className="rounded bg-surface-2 px-1 font-mono text-[0.92em]">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** Plain text for search and labels: backticks dropped. */
export function plainText(text: string): string {
  return text.replace(/`([^`]+)`/g, '$1');
}
