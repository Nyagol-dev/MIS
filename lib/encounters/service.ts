import { PoolClient } from 'pg';
import { appPool } from '../db/pool';

export interface CreateEncounterInput {
  tenantId: string;
  patientId: string;
  departmentId: string;
  encounterType?: string;
  status?: string;
  createdBy: string;
}

export interface CreateTriageInput {
  tenantId: string;
  encounterId: string;
  temperature?: number;
  bloodPressure?: string;
  heartRate?: number;
  respiratoryRate?: number;
  oxygenSaturation?: number;
  notes?: string;
  createdBy: string;
}

export async function createEncounter(input: CreateEncounterInput, client?: PoolClient): Promise<string> {
  const db = client || appPool;

  const result = await db.query(
    `INSERT INTO encounters (tenant_id, patient_id, department_id, encounter_type, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      input.tenantId, 
      input.patientId, 
      input.departmentId, 
      input.encounterType || 'outpatient', 
      input.status || 'planned', 
      input.createdBy
    ]
  );
  
  return result.rows[0].id;
}

export async function updateEncounterStatus(tenantId: string, encounterId: string, status: string, client?: PoolClient): Promise<void> {
  const db = client || appPool;

  await db.query(
    `UPDATE encounters SET status = $1 WHERE tenant_id = $2 AND id = $3`,
    [status, tenantId, encounterId]
  );
}

export async function createTriageRecord(input: CreateTriageInput, client?: PoolClient): Promise<string> {
  const db = client || appPool;

  const result = await db.query(
    `INSERT INTO triage_records (tenant_id, encounter_id, temperature, blood_pressure, heart_rate, respiratory_rate, oxygen_saturation, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      input.tenantId, 
      input.encounterId, 
      input.temperature, 
      input.bloodPressure, 
      input.heartRate, 
      input.respiratoryRate, 
      input.oxygenSaturation, 
      input.notes, 
      input.createdBy
    ]
  );
  
  return result.rows[0].id;
}
