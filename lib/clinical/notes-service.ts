import { PoolClient } from 'pg';
import { appPool } from '../db/pool';

export interface CreateClinicalNoteInput {
  tenantId: string;
  encounterId: string;
  patientId: string;
  authorId: string;
  noteType: string;
  content: string; // JSON string for structured templates
  parentNoteId?: string;
}

export async function createClinicalNote(input: CreateClinicalNoteInput, client?: PoolClient): Promise<string> {
  const db = client || appPool;

  const result = await db.query(
    `INSERT INTO clinical_notes (tenant_id, encounter_id, patient_id, author_id, note_type, content, parent_note_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      input.tenantId, 
      input.encounterId, 
      input.patientId, 
      input.authorId, 
      input.noteType, 
      input.content, 
      input.parentNoteId || null
    ]
  );
  
  return result.rows[0].id;
}

export async function lockClinicalNote(tenantId: string, noteId: string, client?: PoolClient): Promise<void> {
  const db = client || appPool;

  await db.query(
    `UPDATE clinical_notes SET is_locked = TRUE, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, noteId]
  );
}

export async function getEncounterNotes(tenantId: string, encounterId: string): Promise<unknown[]> {
  const result = await appPool.query(
    `SELECT n.id, n.note_type, n.content, n.is_locked, n.parent_note_id, n.created_at, u.display_name as author_name
     FROM clinical_notes n
     JOIN users u ON n.author_id = u.id AND n.tenant_id = u.tenant_id
     WHERE n.tenant_id = $1 AND n.encounter_id = $2
     ORDER BY n.created_at ASC`,
    [tenantId, encounterId]
  );
  return result.rows;
}
