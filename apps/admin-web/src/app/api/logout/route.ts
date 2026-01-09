import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const cookieStore = await cookies();

  cookieStore.delete('admin_session');
  cookieStore.delete('access_token');
  cookieStore.delete('refresh_token');

  const url = new URL('/', request.url);
  return NextResponse.redirect(url);
}
