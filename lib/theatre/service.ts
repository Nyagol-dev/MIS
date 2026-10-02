import { PoolClient } from 'pg';
import { appPool } from '../db/pool';

export interface ScheduleTheatreCaseInput {
  tenantId: string;
  patientId: string;
  encounterId: string;
  procedureCode: string;
  procedureName: string;
  scheduledAt: Date;
  surgeonId: string;
  anaesthetistId?: string;
  notes?: string;
}

export async function scheduleTheatreCase(input: ScheduleTheatreCaseInput, client?: PoolClient): Promise<string> {
  const db = client || appPool;

  const result = await db.query(
    `INSERT INTO theatre_cases (tenant_id, patient_id, encounter_id, procedure_code, procedure_name, scheduled_at, surgeon_id, anaesthetist_id, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      input.tenantId, 
      input.patientId, 
      input.encounterId, 
      input.procedureCode, 
      input.procedureName, 
      input.scheduledAt, 
      input.surgeonId, 
      input.anaesthetistId || null, 
      input.notes || null
    ]
  );
  
  return result.rows[0].id;
}

export async function updateTheatreCaseStatus(tenantId: string, caseId: string, status: 'in_progress' | 'completed' | 'cancelled', notes?: string, client?: PoolClient): Promise<void> {
  const db = client || appPool;
  
  let query = `UPDATE theatre_cases SET status = $1`;
  const params: any[] = [status, tenantId, caseId];
  let pIdx = 4;
  
  if (notes) {
    query += `, notes = COALESCE(notes, '') || '\n' || $${pIdx}`;
    params.push(notes);
    pIdx++;
  }
  
  query += ` WHERE tenant_id = $2 AND id = $3`;
  
  await db.query(query, params);
}

export async function getTheatreCases(tenantId: string, client?: PoolClient) {
  const db = client || appPool;
  const result = await db.query(
    `SELECT tc.id, tc.patient_id, p.first_name, p.last_name, tc.procedure_name, tc.scheduled_at, tc.status
     FROM theatre_cases tc
     JOIN patients p ON tc.patient_id = p.id AND tc.tenant_id = p.tenant_id
     WHERE tc.tenant_id = $1
     ORDER BY tc.scheduled_at ASC`,
    [tenantId]
  );
  return result.rows;
}

