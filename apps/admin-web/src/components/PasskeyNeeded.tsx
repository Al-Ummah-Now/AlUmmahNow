import { primaryButtonClass, secondaryButtonClass, linkClass } from './ui';

export interface PasskeyNeededProps {
  title: string;
  body: string;
  why: string;
  /** "Signed in as …" */
  email: string;
  /** Auth's add-a-passkey page; null when the issuer is not configured. */
  setupUrl: string | null;
  /** This app's sign-in with prompt=login. */
  signInPath: string;
  /** Back to the page (step-up only; null when the admin is blocked). */
  backPath: string | null;
  labels: { add: string; signIn: string; back: string; logout: string };
}

/**
 * The "Passkey needed" card (app/passkey-needed/page.tsx). Plain links and a
 * sign-out form: no browser prompts, works without JavaScript. Colours are the
 * site theme's tokens, so Light/Dark and RTL follow the page.
 */
export function PasskeyNeeded({ title, body, why, email, setupUrl, signInPath, backPath, labels }: PasskeyNeededProps) {
  return (
    <div className="max-w-md w-full space-y-6 text-center" data-testid="passkey-needed">
      <div>
        <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-surface-2 border border-border">
          <svg className="h-6 w-6 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
            />
          </svg>
        </div>
        <h1 className="mt-6 text-3xl font-extrabold text-fg">{title}</h1>
        <p className="mt-3 text-sm text-fg">{body}</p>
        <p className="mt-2 text-sm text-fg-muted">{why}</p>
      </div>

      <p className="text-sm text-fg-muted">{email}</p>

      <div className="flex flex-col gap-3">
        {setupUrl && (
          <a href={setupUrl} className={`${primaryButtonClass} py-2`} data-testid="passkey-add">
            {labels.add}
          </a>
        )}
        <a href={signInPath} className={`${secondaryButtonClass} py-2`} data-testid="passkey-sign-in">
          {labels.signIn}
        </a>
        {backPath && (
          <a href={backPath} className={`${linkClass} text-sm`} data-testid="passkey-back">
            {labels.back}
          </a>
        )}
        <form action="/api/logout" method="POST">
          <button type="submit" className={`${linkClass} text-sm`}>
            {labels.logout}
          </button>
        </form>
      </div>
    </div>
  );
}
