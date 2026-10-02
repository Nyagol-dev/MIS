import React from 'react';

export default function OrdersPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Clinical Orders (CPOE)</h1>
      <p className="text-slate-600 mb-6">Create and manage patient orders for lab, radiology, and pharmacy.</p>
      <div className="bg-white dark:bg-slate-800 p-4 rounded shadow border border-slate-200 dark:border-slate-700">
        <h2 className="text-xl font-semibold mb-2">Recent Orders</h2>
        <p className="text-sm text-slate-500">Order management interface goes here...</p>
      </div>
    </div>
  );
}
