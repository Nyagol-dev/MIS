import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth/session';
import { withTenantContext } from '@/lib/db/withTenant';
import { requireBillingPermission } from '@/lib/auth/requireBillingPermission';
import { getInvoice, finalizeInvoice, voidInvoice } from '@/lib/billing/invoices';

function handleError(error: any) {
  const code = error.code || error.name || error.status;
  const status =
    code === 'NOT_FOUND' || code === 404 ? 404 :
    code === 'FORBIDDEN' || code === 403 ? 403 :
    code === 'VALIDATION_ERROR' || code === 'INVALID_INVOICE_STATE' || code === 'CANNOT_VOID_PAID_INVOICE' || code === 400 ? 400 : 500;
  
  const body: Record<string, any> = { 
    error: error.message || 'An unexpected error occurred.',
  };

  if (error.currentStatus) body.currentStatus = error.currentStatus;
  if (error.requiredStatus) body.requiredStatus = error.requiredStatus;

  return NextResponse.json(body, { status });
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

      const result = await getInvoice(client, session.tenantId, (await props.params).id);
      if ('code' in result) return handleError(result);

      return NextResponse.json({
        invoice: {
          ...result.invoice,
          subtotal_minor_units: String(result.invoice.subtotal_minor_units),
          tax_minor_units: String(result.invoice.tax_minor_units),
          total_minor_units: String(result.invoice.total_minor_units),
        },
        lineItems: result.lineItems.map(item => ({
          ...item,
          unit_amount_minor_units: String(item.unit_amount_minor_units),
          total_minor_units: String(item.total_minor_units),
        }))
      }, { status: 200 });
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

      let invoice;
      if (body.action === 'finalize') {
        invoice = await finalizeInvoice(client, session.tenantId, (await props.params).id);
      } else if (body.action === 'void') {
        invoice = await voidInvoice(client, session.tenantId, (await props.params).id);
      } else {
        return NextResponse.json({ error: 'Invalid action. Must be finalize or void.' }, { status: 400 });
      }

      if ('code' in invoice) return handleError(invoice);

      return NextResponse.json({
        ...invoice,
        subtotal_minor_units: String(invoice.subtotal_minor_units),
        tax_minor_units: String(invoice.tax_minor_units),
        total_minor_units: String(invoice.total_minor_units),
      }, { status: 200 });
    });
  } catch (error) {
    return handleError(error);
  }
}
