import React from 'react';

export default function LabPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Laboratory (LIS)</h1>
      <p className="text-slate-600 mb-6">Manage lab samples, enter results, and verify reports.</p>
      <div className="bg-white dark:bg-slate-800 p-4 rounded shadow border border-slate-200 dark:border-slate-700">
        <h2 className="text-xl font-semibold mb-2">Pending Samples</h2>
        <p className="text-sm text-slate-500">Lab processing interface goes here...</p>
      </div>
    </div>
  );
}
