import React from 'react';

export default function PharmacyPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Pharmacy & Dispensing</h1>
      <p className="text-slate-600 mb-6">Review prescriptions, dispense medication, and manage stock/controlled drugs.</p>
      <div className="bg-white dark:bg-slate-800 p-4 rounded shadow border border-slate-200 dark:border-slate-700">
        <h2 className="text-xl font-semibold mb-2">Dispense Queue</h2>
        <p className="text-sm text-slate-500">Pharmacy dispensing interface goes here...</p>
      </div>
    </div>
  );
}
