/**
 * admin-web's side of the native apps' domain association files. worker.ts is identical in web and
 * admin-web (a test keeps them equal); the videos site serves apple-app-site-association and
 * assetlinks.json there (web's src/lib/well-known/app-association.ts, NAT-REL). The admin host lists
 * no app links, so here it never answers and the request goes on to Next.
 */
export async function appAssociationResponse(_request: Request, _env: { ADMIN_API_URL?: string }): Promise<Response | null> {
  return null;
}
