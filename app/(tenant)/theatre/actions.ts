'use server';

import { getSession } from '@/lib/auth/session';
import { updateTheatreCaseStatus } from '@/lib/theatre/service';
import { withTenantContext } from '@/lib/db/withTenant';
import { writeAuditLog } from '@/lib/db/audit';
import { revalidatePath } from 'next/cache';

export async function handleTheatreStatusUpdate(caseId: string, status: 'in_progress' | 'completed' | 'cancelled', notes?: string) {
  const session = await getSession();
  if (!session) throw new Error('Unauthorized');

  await withTenantContext(session.tenantId, async (client) => {
    await updateTheatreCaseStatus(session.tenantId, caseId, status, notes, client);

    await writeAuditLog(client, {
      tenantId: session.tenantId,
      actorId: session.userId,
      action: 'theatre_case.updated',
      entityType: 'theatre_case',
      entityId: caseId,
      oldState: null,
      newState: { status, notes },
    });
  });

  revalidatePath('/theatre');
}
