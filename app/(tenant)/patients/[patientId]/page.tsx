import React, { Suspense } from 'react';
import { getSession } from '@/lib/auth/session';
import { notFound } from 'next/navigation';
import { withTenantContext } from '@/lib/db/withTenant';
import { getPatientContext } from '@/lib/patients/context';
import { getWidgetsForContext } from '@/lib/patients/widgets';
import { writeAuditLog } from '@/lib/db/audit';

export default async function PatientDashboardPage({
  params,
}: {
  params: Promise<{ patientId: string }>;
}) {
  const session = await getSession();
  if (!session) return notFound();
  
  const { patientId } = await params;

  const contextData = await withTenantContext(session.tenantId, async (client) => {
    // Write dashboard read audit event
    await writeAuditLog(client, {
      tenantId: session.tenantId,
      actorId: session.userId,
      action: 'dashboard.view',
      entityType: 'patient',
      entityId: patientId,
      oldState: null,
      newState: null
    });

    return await getPatientContext(session.tenantId, patientId, client);
  });

  const widgets = getWidgetsForContext(contextData.type);

  // In a real app, we'd check permissions per widget here, e.g.:
  // const permittedWidgets = widgets.filter(w => !w.requiredPermission || userHasPermission(session, w.requiredPermission));
  const permittedWidgets = widgets;

  return (
    <div className="space-y-6">
      <div className="bg-white p-4 rounded shadow-sm border border-slate-200">
        <h2 className="text-lg font-semibold text-slate-800">Diagnostic Context</h2>
        <p className="text-sm text-slate-600 mt-1">
          Layout mode: <span className="font-mono bg-slate-100 px-1 py-0.5 rounded text-blue-700">{contextData.type}</span>
        </p>
        <p className="text-sm text-slate-600">
          Triggers: {contextData.reasons.join(', ')}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {permittedWidgets.map(widget => (
          <div key={widget.id} className={widget.id === 'current_encounter' || widget.id === 'previous_visits' ? 'col-span-full' : ''}>
            <Suspense fallback={<div className="h-32 bg-slate-100 animate-pulse rounded border border-slate-200" />}>
              <widget.Component patientId={patientId} />
            </Suspense>
          </div>
        ))}
        {permittedWidgets.length === 0 && (
          <div className="col-span-full p-8 text-center bg-white border border-slate-200 rounded text-slate-500">
            No widgets available or permitted for this context.
          </div>
        )}
      </div>
    </div>
  );
}
