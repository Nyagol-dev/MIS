import React from 'react';
import { PatientContextType } from './context';

export interface WidgetDefinition {
  id: string;
  name: string;
  requiredPermission?: string;
  isRelevant: (context: PatientContextType, data?: unknown) => boolean;
  Component: React.FC<{ patientId: string; encounterId?: string }>;
}

// Stubs for missing modules
const LabResultsStub = () => <div className="p-4 bg-slate-50 border border-slate-200 rounded text-slate-500 text-sm">Laboratory Module not enabled.</div>;
const MARStub = () => <div className="p-4 bg-slate-50 border border-slate-200 rounded text-slate-500 text-sm">MAR / Prescriptions Module not enabled.</div>;
const OrdersStub = () => <div className="p-4 bg-slate-50 border border-slate-200 rounded text-slate-500 text-sm">Orders Module not enabled.</div>;
const BedWardStub = () => <div className="p-4 bg-slate-50 border border-slate-200 rounded text-slate-500 text-sm">Admissions Module not enabled.</div>;

export const WIDGET_REGISTRY: Record<string, WidgetDefinition> = {
  current_encounter: {
    id: 'current_encounter',
    name: 'Current Encounter',
    isRelevant: (ctx) => ctx === 'new_visit' || ctx === 'returning' || ctx === 'emergency' || ctx === 'ongoing_care',
    Component: ({ patientId }) => <div className="p-4 bg-white border border-slate-200 rounded shadow-sm">Current Encounter Details for {patientId}</div>
  },
  previous_visits: {
    id: 'previous_visits',
    name: 'Previous Visits',
    isRelevant: (ctx) => ctx !== 'new_visit' && ctx !== 'emergency',
    Component: ({ patientId }) => <div className="p-4 bg-white border border-slate-200 rounded shadow-sm">Previous Visits History</div>
  },
  lab_results: {
    id: 'lab_results',
    name: 'Recent Lab Results',
    isRelevant: (ctx) => ctx !== 'new_visit',
    Component: LabResultsStub
  },
  mar: {
    id: 'mar',
    name: 'Medication Administration',
    isRelevant: (ctx) => ctx === 'admitted',
    Component: MARStub
  },
  orders: {
    id: 'orders',
    name: 'Pending Orders',
    isRelevant: (ctx) => ctx !== 'new_visit',
    Component: OrdersStub
  },
  bed_ward: {
    id: 'bed_ward',
    name: 'Ward & Bed Details',
    isRelevant: (ctx) => ctx === 'admitted',
    Component: BedWardStub
  }
};

export function getWidgetsForContext(context: PatientContextType): WidgetDefinition[] {
  return Object.values(WIDGET_REGISTRY).filter(w => w.isRelevant(context));
}
