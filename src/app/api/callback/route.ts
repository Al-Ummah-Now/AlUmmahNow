import { InvalidAccessTokenError } from "@openauthjs/openauth/error";
import { createClient } from "@openauthjs/openauth/client"
import { setTokens } from "../../../lib/auth"
import { type NextRequest, NextResponse } from "next/server"

async function validate(code: string | null, url: URL): Promise<{ result: boolean, err?: InvalidAccessTokenError}> {
  console.log("code", code)
  console.log("url", url)

   const client = createClient({
    clientID: process.env.ClientId,
    issuer: process.env.Issuer, // url to the OpenAuth server
  });
  
  const exchanged = await client.exchange(code!, `${url.origin}/api/callback`);
  console.log("exchanged", exchanged)
  if (exchanged.err == false) {
    await setTokens(exchanged.tokens.access, exchanged.tokens.refresh);
    return { result: true };
  }
  return { result: false, err: exchanged.err };
}

export async function GET(req: NextRequest) {
  
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  var result = await validate(code, url);
  console.log("result", result)
  console.log("redirect", `${url.origin}/`)
  if (result.result === true) return NextResponse.redirect(`${url.origin}/`);
  return NextResponse.json(result.err, { status: 400 });

}