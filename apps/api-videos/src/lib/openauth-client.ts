import { createClient, Client } from "@al-ummah-now/openauth/client"

export async function getClient(env: any) {
  const client = createClient({
    clientID: env.ClientId,
    issuer: env.Issuer, 
  });
  
  return client;
}