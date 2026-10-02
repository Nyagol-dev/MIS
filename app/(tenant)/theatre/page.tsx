import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Theatre Schedules | HMIS',
  description: 'Theatre & Procedures Management',
};

export default async function TheatrePage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Theatre Schedules</h1>
        <button className="bg-slate-900 text-white px-4 py-2 rounded-md font-medium text-sm hover:bg-slate-800">
          Schedule Case
        </button>
      </div>
      
      <div className="bg-white shadow rounded-lg border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <h3 className="font-medium text-slate-900">Upcoming Procedures</h3>
        </div>
        <div className="p-8 text-center text-slate-500">
          <p>No theatre cases scheduled.</p>
        </div>
      </div>
    </div>
  );
}
