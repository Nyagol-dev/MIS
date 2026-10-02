'use server';

import { getSession } from '@/lib/auth/session';
import { assignBed, dischargePatient, addNursingNote, recordMarEntry } from '@/lib/inpatient/service';
import { withTenantContext } from '@/lib/db/withTenant';
import { writeAuditLog } from '@/lib/db/audit';
import { revalidatePath } from 'next/cache';

export async function handleBedAssignment(admissionId: string, bedId: string) {
  const session = await getSession();
  if (!session) throw new Error('Unauthorized');

  await withTenantContext(session.tenantId, async (client) => {
    await assignBed({
      tenantId: session.tenantId,
      admissionId,
      bedId,
      assignedBy: session.userId,
    }, client);

    await writeAuditLog(client, {
      tenantId: session.tenantId,
      actorId: session.userId,
      action: 'bed.assigned',
      entityType: 'admission',
      entityId: admissionId,
      oldState: null,
      newState: { bedId },
    });
  });

  revalidatePath('/inpatient');
}

export async function handleNursingNote(admissionId: string, noteText: string) {
  const session = await getSession();
  if (!session) throw new Error('Unauthorized');

  await withTenantContext(session.tenantId, async (client) => {
    const id = await addNursingNote(session.tenantId, admissionId, session.userId, noteText, client);

    await writeAuditLog(client, {
      tenantId: session.tenantId,
      actorId: session.userId,
      action: 'nursing_note.created',
      entityType: 'nursing_note',
      entityId: id,
      oldState: null,
      newState: { admissionId },
    });
  });

  revalidatePath('/inpatient');
}

export async function handleMarEntry(admissionId: string, drugCode: string, dose: string, route: string, notes?: string) {
  const session = await getSession();
  if (!session) throw new Error('Unauthorized');

  await withTenantContext(session.tenantId, async (client) => {
    const id = await recordMarEntry({
      tenantId: session.tenantId,
      admissionId,
      drugCode,
      dose,
      route,
      administeredBy: session.userId,
      notes,
    }, client);

    await writeAuditLog(client, {
      tenantId: session.tenantId,
      actorId: session.userId,
      action: 'mar.administered',
      entityType: 'mar_entry',
      entityId: id,
      oldState: null,
      newState: { admissionId, drugCode, dose, route },
    });
  });

  revalidatePath('/inpatient');
}
