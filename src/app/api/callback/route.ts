import { InvalidAccessTokenError } from "@openauthjs/openauth/error";
import { client, setTokens } from "../../../lib/auth"
import { type NextRequest, NextResponse } from "next/server"

async function validate(code: string | null, url: URL): Promise<{ result: boolean, err?: InvalidAccessTokenError}> {
  const exchanged = await client.exchange(code!, `${url.origin}/api/callback`);
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
  if (result) return NextResponse.redirect(`${url.origin}/`);
  return NextResponse.json(result.err, { status: 400 });

}