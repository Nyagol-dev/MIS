import { PoolClient } from 'pg';
import { getPool } from '../db/pool';

export interface CreatePatientInput {
  tenantId: string;
  firstName: string;
  lastName: string;
  dob: string;
  gender: string;
  createdBy: string;
  phone?: string;
  address?: string;
  nextOfKinName?: string;
  nextOfKinPhone?: string;
  identifiers: { type: string; value: string }[];
}

export interface PatientRecord {
  id: string;
  tenant_id: string;
  first_name: string;
  last_name: string;
  dob: string;
  gender: string;
}

export async function createPatient(input: CreatePatientInput, client?: PoolClient): Promise<string> {
  const pool = getPool();
  const db = client || pool;

  const result = await db.query(
    `INSERT INTO patients (tenant_id, first_name, last_name, dob, gender, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [input.tenantId, input.firstName, input.lastName, input.dob, input.gender, input.createdBy]
  );
  
  const patientId = result.rows[0].id;

  if (input.phone || input.address || input.nextOfKinName || input.nextOfKinPhone) {
    await db.query(
      `INSERT INTO patient_contacts (tenant_id, patient_id, phone, address, next_of_kin_name, next_of_kin_phone)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.tenantId, patientId, input.phone, input.address, input.nextOfKinName, input.nextOfKinPhone]
    );
  }

  if (input.identifiers && input.identifiers.length > 0) {
    for (const id of input.identifiers) {
      await db.query(
        `INSERT INTO patient_identifiers (tenant_id, patient_id, identifier_type, identifier_value)
         VALUES ($1, $2, $3, $4)`,
        [input.tenantId, patientId, id.type, id.value]
      );
    }
  }

  return patientId;
}

export async function findPotentialDuplicates(tenantId: string, firstName: string, lastName: string, dob: string, phone?: string): Promise<PatientRecord[]> {
  const pool = getPool();
  // Basic exact match for now; normally you'd use pg_trgm for fuzzy matching
  const result = await pool.query(
    `SELECT p.id, p.tenant_id, p.first_name, p.last_name, p.dob, p.gender
     FROM patients p
     LEFT JOIN patient_contacts c ON p.id = c.patient_id AND p.tenant_id = c.tenant_id
     WHERE p.tenant_id = $1
       AND (
         (p.first_name ILIKE $2 AND p.last_name ILIKE $3 AND p.dob = $4)
         OR (c.phone = $5 AND $5 IS NOT NULL)
       )
       AND p.deleted_at IS NULL
     LIMIT 5`,
    [tenantId, firstName, lastName, dob, phone || null]
  );
  
  return result.rows;
}
