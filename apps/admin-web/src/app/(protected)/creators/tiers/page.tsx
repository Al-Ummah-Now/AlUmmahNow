import { permanentRedirect } from 'next/navigation';

/** The tier limits moved to their own nav item, /tiers (a #tier-… anchor is kept by the browser). */
export default function OldCreatorTiersPage() {
  permanentRedirect('/tiers');
}
