import { NextRequest, NextResponse } from 'next/server';
import { processPendingEvents } from '@/lib/events/processor';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const secretHeader = request.headers.get('x-cron-secret');
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret || secretHeader !== expectedSecret) {
    return NextResponse.json(
      { error: 'Invalid or missing CRON secret.' },
      { status: 401 }
    );
  }

  const summary = await processPendingEvents();
  return NextResponse.json({ ok: true, ...summary });
}
