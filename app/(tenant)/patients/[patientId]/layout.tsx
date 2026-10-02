import React from 'react';
import { notFound } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { withTenantContext } from '@/lib/db/withTenant';
import { PatientBanner } from '@/components/patients/PatientBanner';
import { writeAuditLog } from '@/lib/db/audit';

export default async function PatientLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ patientId: string }>;
}) {
  const session = await getSession();
  if (!session) return notFound();
  
  const { patientId } = await params;

  // Fetch patient data for the banner
  const patientData = await withTenantContext(session.tenantId, async (client) => {
    // 1. Fetch patient
    const pResult = await client.query(
      `SELECT id, first_name, last_name, dob, gender FROM patients WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [session.tenantId, patientId]
    );
    if (pResult.rowCount === 0) return null;
    const patient = pResult.rows[0];

    // 2. Fetch identifiers
    const iResult = await client.query(
      `SELECT identifier_type, identifier_value FROM patient_identifiers WHERE tenant_id = $1 AND patient_id = $2`,
      [session.tenantId, patientId]
    );
    const identifiers = iResult.rows.map(r => ({ type: r.identifier_type, value: r.identifier_value }));

    // 3. Fetch allergies
    const aResult = await client.query(
      `SELECT allergen, severity, status FROM allergies WHERE tenant_id = $1 AND patient_id = $2`,
      [session.tenantId, patientId]
    );
    
    // Write audit log for banner view
    await writeAuditLog(client, {
      tenantId: session.tenantId,
      actorId: session.userId,
      action: 'patient.banner.view',
      entityType: 'patient',
      entityId: patientId,
      oldState: null,
      newState: null
    });

    return {
      patient: {
        id: patient.id,
        firstName: patient.first_name,
        lastName: patient.last_name,
        dob: patient.dob,
        gender: patient.gender,
        identifiers
      },
      allergies: aResult.rows
    };
  });

  if (!patientData) {
    return notFound();
  }

  // TODO: Add alerts fetching (e.g. DNR, Fall Risk)
  const alerts: string[] = [];

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <PatientBanner 
        patient={patientData.patient} 
        allergies={patientData.allergies} 
        alerts={alerts}
      />
      <main className="flex-1 p-6">
        {children}
      </main>
    </div>
  );
}
