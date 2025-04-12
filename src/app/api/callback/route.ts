import { client, setTokens } from "../../auth"
import { type NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const exchanged = await client.exchange(code!, `${url.origin}/api/auth`)
  if (exchanged.err) return NextResponse.json(exchanged.err, { status: 400 });
  else if (exchanged.err == false) {
    await setTokens(exchanged.tokens.access, exchanged.tokens.refresh)
    console.log(`${url.origin}`);
    return NextResponse.redirect(`${url.origin}/`)
  }
}