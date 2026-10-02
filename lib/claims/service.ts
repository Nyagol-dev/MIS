import { PoolClient } from 'pg';
import { appPool } from '../db/pool';

export interface CreateCoverageInput {
  tenantId: string;
  patientId: string;
  payerName: string;
  memberNumber: string;
}

export async function createCoverage(input: CreateCoverageInput, client?: PoolClient): Promise<string> {
  const db = client || appPool;
  const result = await db.query(`
      INSERT INTO coverages (tenant_id, patient_id, payer_name, member_number)
      VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.tenantId, input.patientId, input.payerName, input.memberNumber]);
  return result.rows[0].id;
}

export async function submitClaim(tenantId: string, patientId: string, encounterId: string, coverageId: string, totalMinorUnits: number, lines: any[], client?: PoolClient): Promise<string> {
  const db = client || appPool;
  const claimNumber = `CLM-${Date.now()}`;

  const claimResult = await db.query(`
      INSERT INTO claims (tenant_id, patient_id, encounter_id, coverage_id, claim_number, status, total_minor_units, submitted_at)
      VALUES ($1, $2, $3, $4, $5, 'submitted', $6, now()) RETURNING id`,
      [tenantId, patientId, encounterId, coverageId, claimNumber, totalMinorUnits]);
  const claimId = claimResult.rows[0].id;

  for (const line of lines) {
    await db.query(`
        INSERT INTO claim_lines (tenant_id, claim_id, service_id, amount_minor_units)
        VALUES ($1, $2, $3, $4)`,
        [tenantId, claimId, line.serviceId, line.amountMinorUnits]);
  }

  return claimId;
}

export async function getClaims(tenantId: string, client?: PoolClient) {
  const db = client || appPool;
  const result = await db.query(`
      SELECT c.id, c.claim_number, c.status, c.total_minor_units, c.submitted_at, p.first_name, p.last_name, cov.payer_name
      FROM claims c
      JOIN patients p ON c.patient_id = p.id AND c.tenant_id = p.tenant_id
      JOIN coverages cov ON c.coverage_id = cov.id AND c.tenant_id = cov.tenant_id
      WHERE c.tenant_id = $1
      ORDER BY c.created_at DESC`,
      [tenantId]);
  return result.rows;
}
