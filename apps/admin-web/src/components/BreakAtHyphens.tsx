/**
 * A resource name that wraps only after a "-" (al-ummah-now-<wbr>production), never mid-word, with
 * the full name as its title. Used by Operations' resources and Costs' drivers.
 */
export function BreakAtHyphens({ name }: { name: string }) {
  const parts = name.split('-');
  return (
    <span title={name}>
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && (
            <>
              -<wbr />
            </>
          )}
        </span>
      ))}
    </span>
  );
}
