import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { withTenantContext } from '@/lib/db/withTenant';
import { requireBillingPermission } from '@/lib/auth/requireBillingPermission';
import { listSubscriptions, createSubscription } from '@/lib/billing/subscriptions';

function handleError(error: any) {
  const code = error.code || error.name || error.status;
  const status =
    code === 'NOT_FOUND' || code === 404
      ? 404
      : code === 'FORBIDDEN' || code === 403
      ? 403
      : code === 'VALIDATION_ERROR' || code === 400
      ? 400
      : 500;

  const body: Record<string, any> = { error: error.message || 'An unexpected error occurred.' };
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    return await withTenantContext(session.tenantId, async (client) => {
      const authErr = await requireBillingPermission(client, session, 'billing:read');
      if (authErr) return handleError(authErr);

      const statusParam = request.nextUrl.searchParams.get('status') as any;
      const customerIdParam = request.nextUrl.searchParams.get('billing_customer_id');
      const planIdParam = request.nextUrl.searchParams.get('plan_id');

      const filters: any = {};
      if (statusParam) filters.status = statusParam;
      if (customerIdParam) filters.billingCustomerId = customerIdParam;
      if (planIdParam) filters.planId = planIdParam;

      const limitParam = request.nextUrl.searchParams.get('limit');
      const offsetParam = request.nextUrl.searchParams.get('offset');
      let limit: number | undefined;
      let offset: number | undefined;

      if (limitParam !== null) {
        limit = parseInt(limitParam, 10);
        if (Number.isNaN(limit)) return NextResponse.json({ error: 'limit must be an integer' }, { status: 400 });
      }
      if (offsetParam !== null) {
        offset = parseInt(offsetParam, 10);
        if (Number.isNaN(offset)) return NextResponse.json({ error: 'offset must be an integer' }, { status: 400 });
      }

      const result = await listSubscriptions(client, session.tenantId, filters, { limit, offset });
      if ('code' in result) return handleError(result);
      return NextResponse.json(result, { status: 200 });
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();

    return await withTenantContext(session.tenantId, async (client) => {
      const authErr = await requireBillingPermission(client, session, 'billing:create');
      if (authErr) return handleError(authErr);

      const subscription = await createSubscription(client, session.tenantId, body);
      if ('code' in subscription) return handleError(subscription);
      return NextResponse.json(subscription, { status: 201 });
    });
  } catch (error) {
    return handleError(error);
  }
}
