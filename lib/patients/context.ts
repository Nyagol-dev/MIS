import { PoolClient } from 'pg';
import { getPool } from '../db/pool';

export type PatientContextType = 'admitted' | 'emergency' | 'discharged_recent' | 'ongoing_care' | 'returning' | 'new_visit';

export interface PatientContext {
  type: PatientContextType;
  reasons: string[];
}

export async function getPatientContext(tenantId: string, patientId: string, client?: PoolClient): Promise<PatientContext> {
  const pool = getPool();
  const db = client || pool;

  const reasons: string[] = [];

  // Check encounters for emergency, admission, etc.
  const encountersResult = await db.query(
    `SELECT id, status, encounter_type, started_at, ended_at 
     FROM encounters 
     WHERE tenant_id = $1 AND patient_id = $2 
     ORDER BY started_at DESC`,
    [tenantId, patientId]
  );
  
  const encounters = encountersResult.rows;

  if (encounters.length === 0) {
    return { type: 'new_visit', reasons: ['no_previous_encounters'] };
  }

  const activeEncounter = encounters.find(e => e.status !== 'discharged' && e.status !== 'cancelled');

  // 1. admitted
  if (activeEncounter && activeEncounter.encounter_type === 'inpatient') {
    reasons.push('active_admission');
    return { type: 'admitted', reasons };
  }

  // 2. emergency
  if (activeEncounter && activeEncounter.encounter_type === 'emergency') {
    reasons.push('active_emergency');
    return { type: 'emergency', reasons };
  }

  // 3. discharged_recent (last 14 days)
  const recentDischarge = encounters.find(e => e.status === 'discharged' && e.ended_at && (new Date().getTime() - new Date(e.ended_at).getTime()) < 14 * 24 * 60 * 60 * 1000);
  if (recentDischarge && !activeEncounter) {
    reasons.push('recent_discharge');
    return { type: 'discharged_recent', reasons };
  }

  // 4. ongoing_care (chronic conditions)
  const diagnosesResult = await db.query(
    `SELECT id FROM diagnoses WHERE tenant_id = $1 AND patient_id = $2 AND status = 'confirmed'`,
    [tenantId, patientId]
  );
  if (diagnosesResult.rowCount && diagnosesResult.rowCount > 0) { // simplified chronic check
    reasons.push('active_chronic_problem');
    return { type: 'ongoing_care', reasons };
  }

  // 5. returning
  if (encounters.length > 1 || (!activeEncounter && encounters.length === 1)) {
    reasons.push('previous_encounters_found');
    return { type: 'returning', reasons };
  }

  return { type: 'new_visit', reasons: ['first_active_encounter'] };
}
