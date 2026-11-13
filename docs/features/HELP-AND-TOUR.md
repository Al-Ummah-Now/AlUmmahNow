# Help and the identity tour

Status: built 2026-11-13, owner-approved design (review artifact "Videos Help Guide"). Wiki: AlUmmahNowWiki `guides/help-and-tour.md`.

The videos site explains itself in two ways:

- **Help** at `/[locale]/help`: seven topic pages in English and Arabic, with annotated pictures and three short clips.
- **The identity tour**: five steps over the real header and account menu. They show that you act either as yourself or as a channel, and how to switch.

## Where things are

| What | Where |
|---|---|
| Text (en/ar), topic, picture and clip ids | `packages/shared-types/src/i18n-help.ts` (`t.help`) |
| Pages | `apps/web/src/app/[locale]/help/` and `apps/web/src/components/help/` |
| Styles | `apps/web/src/theme/help.css` (theme tokens only) |
| Tour | `apps/web/src/components/help/IdentityTour.tsx`, mounted once in the app shell |
| "Seen" flag on the account | `GET/PUT /api/profile/onboarding` (`apps/api-videos/src/lib/onboarding.ts`) |
| Pictures and clips | `apps/web/public/help/` and `public/help/clips/`, made by `apps/web/e2e/help-capture/capture.help.ts` |
| Picture workflow | `.github/workflows/help-pictures.yml` |
| Tests | jest: `src/lib/help`, `src/components/help`; E2E: `apps/web/e2e/76-help-tour.spec.ts` (local web suite) |

## Entry points

- Account menu: **Help** (`nav-menu-help`), after Settings.
- Side menu, "More" group: **Help**.
- Empty states and channel messages: `HelpLink` (subscriptions empty and feed empty, the upload page's "Channel required", Studio without a channel).
- www links to `/[locale]/help` from its footer (AlUmmahNowUI).

## Writing Help text

- A topic has sections, and a section has blocks: `p`, `steps`, `list`, `tip`, `table`, `figure`, `clip` and `tour` (the "Show me" button). Inline text may use `**bold**` and `[link](/path)`. The path is under the page's locale.
- English and Arabic must have the same shape: the same sections, pictures and list lengths. The jest test fails otherwise.
- Use the words shown on screen in each language. Use «مرئي / مرئيات» for video, and «المقاطع القصيرة» for Shorts. Keep the tone of a general content-sharing site.
- An admin can correct a sentence without a deploy through the translation store (`help.*` keys in `overrides`).

## The tour

- **Shown once per account.** The tour is offered when the account's `identityTour` is below `IDENTITY_TOUR_VERSION` (`apps/web/src/lib/help/content.ts`). Finishing it, skipping it or choosing "Not now" stores that version on the account. The stored value only grows. To show a bigger change once more, raise the version.
- **Never in the way.** The tour is not offered on watch, Shorts, Studio, upload, live, embed or sign-in pages, or while a modal dialog is open.
- **Automated browsers.** A browser with `navigator.webdriver` set is never offered the tour. The tour's own spec opts in with `localStorage.setItem('aun-tour-e2e', 'on')`.
- **Opening the menu.** Each step opens the account menu on the view it explains, through `requestAccountMenu` (`apps/web/src/lib/navigation/account-menu-events.ts`). The comment boxes' "Switch" link uses the same function.
- **Accessibility.** The tour card is a non-modal dialog. Its heading takes focus at each step. It has Back, Next and Skip buttons, and Escape skips. A polite live region announces "Step n of N". The highlighted control is described by the step text, and focus returns to the account button at the end. In Arabic the card sits on the mirrored side. On phones it docks to the bottom of the screen. With reduced motion there are no transitions.
- **The upload step.** It is left out when the header has no Upload button (an account without a creator tier).

## Pictures and clips

`capture.help.ts` signs up its own creator on the local stack and makes the content it photographs: two channels, a video, a comment and a post. Every name in that data is generic and fixed. The script then photographs every picture in en/ar × desktop/phone × light/dark, with numbered markers on the controls the text explains (Arabic digits in Arabic). It records the clips on desktop. Everything it made is deleted at the end.

- **On a PR** that changes the text, the script or the workflow, `help-pictures.yml` uploads the `help-pictures` artifact. Commit its contents to `apps/web/public/help`.
- **On every release tag, and by hand,** the workflow opens "chore(help): refresh Help pictures" when anything changed. The workflow's token starts no checks, so push an empty commit to that PR before merging it.
- **Locally,** with the stack running and ffmpeg and Google Chrome installed: `cd apps/web && E2E_ENV=local pnpm exec playwright test -c playwright.help.config.ts`.
- **A jest test** fails when a picture or clip named in the text has no file.
