import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Inpatient Ward | HMIS',
  description: 'Inpatient Ward Management',
};

export default async function InpatientPage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Inpatient Ward Dashboard</h1>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Placeholder cards for wards, beds, admissions */}
        <div className="bg-white p-4 shadow rounded-lg border border-slate-200">
          <h2 className="text-lg font-medium">Active Admissions</h2>
          <p className="text-3xl font-bold mt-2">0</p>
        </div>
        <div className="bg-white p-4 shadow rounded-lg border border-slate-200">
          <h2 className="text-lg font-medium">Available Beds</h2>
          <p className="text-3xl font-bold mt-2">0</p>
        </div>
        <div className="bg-white p-4 shadow rounded-lg border border-slate-200">
          <h2 className="text-lg font-medium">Pending Discharges</h2>
          <p className="text-3xl font-bold mt-2">0</p>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <h3 className="font-medium text-slate-900">Recent Admissions</h3>
        </div>
        <div className="p-8 text-center text-slate-500">
          <p>No admissions found.</p>
        </div>
      </div>
    </div>
  );
}
