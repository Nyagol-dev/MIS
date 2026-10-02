'use client';

import React from 'react';

export interface PatientBannerProps {
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    dob: string;
    gender: string;
    identifiers?: { type: string; value: string }[];
  };
  allergies?: { allergen: string; severity: string; status: string }[];
  alerts?: string[];
  department?: string;
  encounterStatus?: string;
}

export function PatientBanner({ patient, allergies = [], alerts = [], department, encounterStatus }: PatientBannerProps) {
  // Calculate age
  const birthDate = new Date(patient.dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  const primaryId = patient.identifiers?.find(i => i.type === 'national_id')?.value || 
                    patient.identifiers?.[0]?.value || 
                    'No ID';

  const activeAllergies = allergies.filter(a => a.status === 'active');

  return (
    <div className="bg-slate-50 border-b border-slate-200 px-6 py-3 shadow-sm flex flex-col md:flex-row md:items-center justify-between sticky top-0 z-40">
      <div className="flex items-center gap-4">
        {/* Avatar Placeholder */}
        <div className="h-12 w-12 rounded-full bg-slate-300 flex items-center justify-center text-slate-600 font-bold text-xl">
          {patient.firstName.charAt(0)}{patient.lastName.charAt(0)}
        </div>
        
        {/* Core Demographics */}
        <div>
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            {patient.firstName} {patient.lastName}
            <span className="text-sm font-normal text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">
              {patient.gender.charAt(0).toUpperCase()} • {age}y
            </span>
          </h1>
          <div className="text-sm text-slate-600 flex gap-3 mt-1">
            <span><strong>ID:</strong> {primaryId}</span>
            <span><strong>DOB:</strong> {birthDate.toLocaleDateString()}</span>
            <span className="text-slate-400">|</span>
            <span className="font-mono text-xs mt-0.5 text-slate-500">{patient.id.slice(0, 8)}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 md:mt-0 flex flex-col md:items-end gap-2">
        {/* Clinical Alerts and Allergies */}
        <div className="flex flex-wrap gap-2">
          {activeAllergies.length > 0 ? (
            <div className="bg-red-50 border border-red-200 text-red-700 px-2 py-1 rounded text-xs font-semibold flex items-center shadow-sm">
              <span className="mr-1">⚠️ ALLERGIES:</span>
              {activeAllergies.map(a => a.allergen).join(', ')}
            </div>
          ) : (
            <div className="bg-green-50 border border-green-200 text-green-700 px-2 py-1 rounded text-xs font-medium">
              No Known Allergies
            </div>
          )}
          
          {alerts.map((alert, idx) => (
            <div key={idx} className="bg-amber-50 border border-amber-200 text-amber-800 px-2 py-1 rounded text-xs font-semibold shadow-sm">
              {alert}
            </div>
          ))}
        </div>

        {/* Context Information */}
        <div className="text-xs font-medium text-slate-500 flex gap-2">
          {department && <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-100">{department}</span>}
          {encounterStatus && <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200 uppercase tracking-wide">{encounterStatus}</span>}
        </div>
      </div>
    </div>
  );
}
