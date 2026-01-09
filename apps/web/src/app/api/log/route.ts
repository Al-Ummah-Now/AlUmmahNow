import { NextRequest, NextResponse } from 'next/server';
import { appendFile } from 'fs/promises';
import { join } from 'path';

const LOG_FILE = join(process.cwd(), 'logs', 'app.log');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { timestamp, level, message, data } = body;

    // Format log entry
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}${
      data ? ' ' + JSON.stringify(data, null, 2) : ''
    }\n`;

    // Append to log file
    await appendFile(LOG_FILE, logEntry, 'utf8');

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to write log:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
