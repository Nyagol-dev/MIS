import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { withTenantContext } from '@/lib/db/withTenant';
import { requireBillingPermission } from '@/lib/auth/requireBillingPermission';
import { getSubscription, transitionSubscriptionStatus, cancelSubscription } from '@/lib/billing/subscriptions';

function handleError(error: any) {
  const code = error.code || error.name || error.status;
  const status =
    code === 'NOT_FOUND' || code === 404 ? 404 :
    code === 'FORBIDDEN' || code === 403 ? 403 :
    code === 'VALIDATION_ERROR' || code === 'INVALID_STATE_TRANSITION' || code === 400 ? 400 : 500;
  return NextResponse.json({ error: error.message || 'An unexpected error occurred.', fromStatus: error.fromStatus, toStatus: error.toStatus }, { status });
}

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    return await withTenantContext(session.tenantId, async (client) => {
      const authErr = await requireBillingPermission(client, session, 'billing:read');
      if (authErr) return handleError(authErr);

      const subscription = await getSubscription(client, session.tenantId, (await props.params).id);
      if ('code' in subscription) return handleError(subscription);
      return NextResponse.json(subscription, { status: 200 });
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();

    return await withTenantContext(session.tenantId, async (client) => {
      const authErr = await requireBillingPermission(client, session, 'billing:update');
      if (authErr) return handleError(authErr);

      const subscription = await transitionSubscriptionStatus(client, session.tenantId, (await props.params).id, body.status, body.reason);
      if ('code' in subscription) return handleError(subscription);
      return NextResponse.json(subscription, { status: 200 });
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));

    return await withTenantContext(session.tenantId, async (client) => {
      const authErr = await requireBillingPermission(client, session, 'billing:delete');
      if (authErr) return handleError(authErr);

      const subscription = await cancelSubscription(client, session.tenantId, (await props.params).id, body?.reason);
      if ('code' in subscription) return handleError(subscription);
      return NextResponse.json(subscription, { status: 200 });
    });
  } catch (error) {
    return handleError(error);
  }
}
