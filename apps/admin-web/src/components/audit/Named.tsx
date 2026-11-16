/**
 * A person or an item by name (issue #745), with its id one hover away (title) and selectable
 * (MonoId). A user nothing is known about reads "Unknown user", its id in a copyable detail (CopyId,
 * a client component). No hooks here: used by server pages and by client components alike.
 */
import Link from '@/components/AppLink';
import { MonoId } from '@/components/content/parts';
import { CopyId } from './CopyId';
import { EmailText } from '@/components/EmailText';
import type { ItemView, PersonView } from './audit-model';

const nameLink = 'inline-block min-h-6 text-link hover:underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded';

export function PersonName({ person, showEmail = true, showId = false, testId }: { person: PersonView; showEmail?: boolean; showId?: boolean; testId?: string }) {
  if (person.system) {
    return (
      <span className="text-fg-muted" data-testid={testId} data-user-id={person.id} title={person.id}>
        {person.label}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5 min-w-0" data-testid={testId} data-user-id={person.id}>
      {person.href ? (
        <Link href={person.href} className={`${nameLink} ${person.labelIsEmail ? '' : 'break-words'}`} title={person.labelIsEmail ? person.label : person.id} dir={person.labelIsEmail ? 'ltr' : 'auto'}>
          {person.labelIsEmail ? <EmailText email={person.label} /> : person.label}
        </Link>
      ) : person.labelIsEmail ? (
        <EmailText email={person.label} />
      ) : (
        <span dir="auto">{person.label}</span>
      )}
      {person.unknown && <CopyId id={person.id} />}
      {showEmail && person.email && (
        <EmailText email={person.email} className="text-fg-muted text-xs" />
      )}
      {showId && !person.unknown && <MonoId value={person.id} />}
    </span>
  );
}

export function ItemName({ item, showId = false, testId }: { item: ItemView; showId?: boolean; testId?: string }) {
  const named = item.label !== item.id;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5 min-w-0" data-testid={testId} data-item-kind={item.kind} data-item-id={item.id}>
      {item.href ? (
        <Link href={item.href} className={`${nameLink} break-words`} title={item.id} dir={named ? 'auto' : 'ltr'}>
          {named ? item.label : <MonoId value={item.id} />}
        </Link>
      ) : named ? (
        <span dir="auto" title={item.id}>
          {item.label}
        </span>
      ) : (
        <MonoId value={item.id} />
      )}
      {item.unknown && <CopyId id={item.id} />}
      {showId && named && !item.unknown && <MonoId value={item.id} />}
    </span>
  );
}
