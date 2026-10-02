import { PoolClient } from 'pg';
import { appPool } from '../db/pool';

export interface CreateInvoiceInput {
  tenantId: string;
  patientId: string;
  encounterId?: string;
  createdBy: string;
}

export interface AddInvoiceLineInput {
  tenantId: string;
  invoiceId: string;
  serviceId: string;
  description: string;
  quantity: number;
  unitPriceMinorUnits: number;
}

export async function createInvoice(input: CreateInvoiceInput, client?: PoolClient): Promise<string> {
  const db = client || appPool;
  const invoiceNumber = `INV-${Date.now()}`; // simplified sequence
  
  const result = await db.query(`
      INSERT INTO invoices (tenant_id, patient_id, encounter_id, invoice_number)
      VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.tenantId, input.patientId, input.encounterId, invoiceNumber]);
  return result.rows[0].id;
}

export async function addInvoiceLine(input: AddInvoiceLineInput, client?: PoolClient): Promise<string> {
  const db = client || appPool;
  const total = input.quantity * input.unitPriceMinorUnits;

  const result = await db.query(`
      INSERT INTO invoice_lines (tenant_id, invoice_id, service_id, description, quantity, unit_price_minor_units, total_minor_units)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [input.tenantId, input.invoiceId, input.serviceId, input.description, input.quantity, input.unitPriceMinorUnits, total]);
  
  // Update invoice totals
  await db.query(`
      UPDATE invoices 
      SET subtotal_minor_units = subtotal_minor_units + $1,
          total_minor_units = total_minor_units + $1,
          updated_at = now()
      WHERE tenant_id = $2 AND id = $3`,
      [total, input.tenantId, input.invoiceId]);

  return result.rows[0].id;
}

export async function getInvoices(tenantId: string, client?: PoolClient) {
  const db = client || appPool;
  const result = await db.query(`
      SELECT i.id, i.invoice_number, i.status, i.total_minor_units, i.created_at, p.first_name, p.last_name
      FROM invoices i
      JOIN patients p ON i.patient_id = p.id AND i.tenant_id = p.tenant_id
      WHERE i.tenant_id = $1
      ORDER BY i.created_at DESC`,
      [tenantId]);
  return result.rows;
}

export async function applyWaiver(tenantId: string, invoiceId: string, amount: number, reason: string, approvedBy: string, client?: PoolClient) {
  const db = client || appPool;
  await db.query(`
      INSERT INTO waivers (tenant_id, invoice_id, amount_minor_units, reason, approved_by)
      VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, invoiceId, amount, reason, approvedBy]);
  
  await db.query(`
      UPDATE invoices 
      SET total_minor_units = GREATEST(0, total_minor_units - $1),
          updated_at = now()
      WHERE tenant_id = $2 AND id = $3`,
      [amount, tenantId, invoiceId]);
}

export async function recordPayment(tenantId: string, invoiceId: string, patientId: string, amount: number, provider: string, providerPaymentId: string, client?: PoolClient) {
  const db = client || appPool;
  const result = await db.query(`
      INSERT INTO payments (tenant_id, invoice_id, patient_id, provider_slug, provider_payment_id, amount_minor_units, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'succeeded') RETURNING id`,
      [tenantId, invoiceId, patientId, provider, providerPaymentId, amount]);
  
  // Calculate if fully paid (very simplified logic)
  await db.query(`
      UPDATE invoices SET status = 'paid', updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, invoiceId]);

  return result.rows[0].id;
}
