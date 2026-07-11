import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { withTenantContext } from '@/lib/db/withTenant';
import { requireBillingPermission } from '@/lib/auth/requireBillingPermission';
import { getBillingCustomer, updateBillingCustomer, deactivateBillingCustomer } from '@/lib/billing/customers';

function handleError(error: any) {
  const code = error.code || error.name || error.status;
  const status =
    code === 'NOT_FOUND' || code === 404 ? 404 :
    code === 'FORBIDDEN' || code === 403 ? 403 :
    code === 'VALIDATION_ERROR' || code === 400 ? 400 : 500;
  return NextResponse.json({ error: error.message || 'An unexpected error occurred.' }, { status });
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    return await withTenantContext(session.tenantId, async (client) => {
      const authErr = await requireBillingPermission(client, session, 'billing:read');
      if (authErr) return handleError(authErr);

      const customer = await getBillingCustomer(client, session.tenantId, params.id);
      if ('code' in customer) return handleError(customer);
      return NextResponse.json(customer, { status: 200 });
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();

    return await withTenantContext(session.tenantId, async (client) => {
      const authErr = await requireBillingPermission(client, session, 'billing:update');
      if (authErr) return handleError(authErr);

      const customer = await updateBillingCustomer(client, session.tenantId, params.id, body);
      if ('code' in customer) return handleError(customer);
      return NextResponse.json(customer, { status: 200 });
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    return await withTenantContext(session.tenantId, async (client) => {
      const authErr = await requireBillingPermission(client, session, 'billing:delete');
      if (authErr) return handleError(authErr);

      const customer = await deactivateBillingCustomer(client, session.tenantId, params.id);
      if ('code' in customer) return handleError(customer);
      return NextResponse.json(customer, { status: 200 });
    });
  } catch (error) {
    return handleError(error);
  }
}
