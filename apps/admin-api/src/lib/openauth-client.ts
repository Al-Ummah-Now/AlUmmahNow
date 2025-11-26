import { createClient } from "@openauthjs/openauth/client"

export async function getClient(env: any) {
  const client = createClient({
    clientID: env.ClientId,
    issuer: env.Issuer,
  });

  return client;
}
