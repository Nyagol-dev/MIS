import { PoolClient } from 'pg';
import { appPool } from '../db/pool';

export interface AdmitPatientInput {
  tenantId: string;
  patientId: string;
  encounterId: string;
  admittedBy: string;
}

export interface BedAssignmentInput {
  tenantId: string;
  admissionId: string;
  bedId: string;
  assignedBy: string;
}

export interface AddMarEntryInput {
  tenantId: string;
  admissionId: string;
  drugCode: string;
  dose: string;
  route: string;
  administeredBy: string;
  notes?: string;
}

export async function admitPatient(input: AdmitPatientInput, client?: PoolClient): Promise<string> {
  const db = client || appPool;

  const result = await db.query(
    `INSERT INTO admissions (tenant_id, patient_id, encounter_id, admitted_by)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.tenantId, input.patientId, input.encounterId, input.admittedBy]
  );
  
  return result.rows[0].id;
}

export async function dischargePatient(tenantId: string, admissionId: string, dischargedBy: string, reason: string, client?: PoolClient): Promise<void> {
  const db = client || appPool;
  
  await db.query(
    `UPDATE admissions 
     SET status = 'discharged', discharged_at = now(), discharged_by = $1, discharge_reason = $2
     WHERE tenant_id = $3 AND id = $4`,
    [dischargedBy, reason, tenantId, admissionId]
  );
  
  // Release any currently assigned bed
  await db.query(
    `UPDATE bed_assignments 
     SET released_at = now(), released_by = $1
     WHERE tenant_id = $2 AND admission_id = $3 AND released_at IS NULL`,
    [dischargedBy, tenantId, admissionId]
  );
  
  // Optionally update bed status to 'cleaning'
  // But requires complex JOIN or fetching bed_id first.
}

export async function assignBed(input: BedAssignmentInput, client?: PoolClient): Promise<string> {
  const db = client || appPool;
  
  // 1. Release previous bed if any
  await db.query(
    `UPDATE bed_assignments 
     SET released_at = now(), released_by = $1
     WHERE tenant_id = $2 AND admission_id = $3 AND released_at IS NULL`,
    [input.assignedBy, input.tenantId, input.admissionId]
  );
  
  // 2. Assign new bed
  const result = await db.query(
    `INSERT INTO bed_assignments (tenant_id, admission_id, bed_id, assigned_by)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.tenantId, input.admissionId, input.bedId, input.assignedBy]
  );
  
  // 3. Mark bed as occupied
  await db.query(
    `UPDATE beds SET status = 'occupied' WHERE tenant_id = $1 AND id = $2`,
    [input.tenantId, input.bedId]
  );
  
  return result.rows[0].id;
}

export async function recordMarEntry(input: AddMarEntryInput, client?: PoolClient): Promise<string> {
  const db = client || appPool;

  const result = await db.query(
    `INSERT INTO mar_entries (tenant_id, admission_id, drug_code, dose, route, administered_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [input.tenantId, input.admissionId, input.drugCode, input.dose, input.route, input.administeredBy, input.notes]
  );
  
  return result.rows[0].id;
}

export async function addNursingNote(tenantId: string, admissionId: string, authorId: string, noteText: string, client?: PoolClient): Promise<string> {
  const db = client || appPool;
  const result = await db.query(
    `INSERT INTO nursing_notes (tenant_id, admission_id, author_id, note_text)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, admissionId, authorId, noteText]
  );
  return result.rows[0].id;
}

export async function getWardsAndBeds(tenantId: string, client?: PoolClient) {
  const db = client || appPool;
  const result = await db.query(
    `SELECT w.id as ward_id, w.name as ward_name, b.id as bed_id, b.bed_number, b.status 
     FROM wards w 
     LEFT JOIN beds b ON w.id = b.ward_id AND w.tenant_id = b.tenant_id 
     WHERE w.tenant_id = $1
     ORDER BY w.name, b.bed_number`,
    [tenantId]
  );
  return result.rows;
}

export async function getAdmissions(tenantId: string, client?: PoolClient) {
  const db = client || appPool;
  const result = await db.query(
    `SELECT a.id, a.patient_id, p.first_name, p.last_name, a.admitted_at, a.status, ba.bed_id, b.bed_number, w.name as ward_name
     FROM admissions a
     JOIN patients p ON a.patient_id = p.id AND a.tenant_id = p.tenant_id
     LEFT JOIN bed_assignments ba ON a.id = ba.admission_id AND a.tenant_id = ba.tenant_id AND ba.released_at IS NULL
     LEFT JOIN beds b ON ba.bed_id = b.id AND ba.tenant_id = b.tenant_id
     LEFT JOIN wards w ON b.ward_id = w.id AND b.tenant_id = w.tenant_id
     WHERE a.tenant_id = $1 AND a.status = 'admitted'
     ORDER BY a.admitted_at DESC`,
    [tenantId]
  );
  return result.rows;
}

