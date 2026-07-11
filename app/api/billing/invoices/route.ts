import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { withTenantContext } from '@/lib/db/withTenant';
import { requireBillingPermission } from '@/lib/auth/requireBillingPermission';
import { listInvoices, createInvoice } from '@/lib/billing/invoices';

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
      const subscriptionIdParam = request.nextUrl.searchParams.get('subscription_id');

      const filters: any = {};
      if (statusParam) filters.status = statusParam;
      if (customerIdParam) filters.billingCustomerId = customerIdParam;
      if (subscriptionIdParam) filters.subscriptionId = subscriptionIdParam;

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

      const result = await listInvoices(client, session.tenantId, filters, { limit, offset });
      if ('code' in result) return handleError(result);
      
      // Convert bigints to strings for JSON serialization
      if ('items' in result) {
        return NextResponse.json({
          ...result,
          items: result.items.map(item => ({
            ...item,
            subtotal_minor_units: String(item.subtotal_minor_units),
            tax_minor_units: String(item.tax_minor_units),
            total_minor_units: String(item.total_minor_units),
          }))
        }, { status: 200 });
      }

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

    // Convert unitAmountMinorUnits to BigInt
    if (body.lineItems && Array.isArray(body.lineItems)) {
      body.lineItems = body.lineItems.map((item: any) => ({
        ...item,
        unitAmountMinorUnits: BigInt(item.unitAmountMinorUnits)
      }));
    }

    return await withTenantContext(session.tenantId, async (client) => {
      const authErr = await requireBillingPermission(client, session, 'billing:create');
      if (authErr) return handleError(authErr);

      const invoice = await createInvoice(client, session.tenantId, body);
      if ('code' in invoice) return handleError(invoice);
      
      return NextResponse.json({
        ...invoice,
        subtotal_minor_units: String(invoice.subtotal_minor_units),
        tax_minor_units: String(invoice.tax_minor_units),
        total_minor_units: String(invoice.total_minor_units),
      }, { status: 201 });
    });
  } catch (error) {
    return handleError(error);
  }
}
