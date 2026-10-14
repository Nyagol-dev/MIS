import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { withTenantContext } from "@/lib/db/withTenant";
import { writeAuditLog } from "@/lib/db/audit";
import { loadUserAuthz } from "@/lib/authz/check";
import { isModuleEnabled, type ModuleKey } from "@/lib/modules/check";

export const metadata = { title: "Hospital overview | HMIS" };

type DashboardData = {
  hospitalName: string;
  facilityId: string | null;
  kephLevel: number | null;
  patientsToday: number | null;
  openEncounters: number | null;
  pendingOrders: number | null;
  currentAdmissions: number | null;
  departments: number | null;
};

const workflows = [
  { key: "patients", title: "Patient registry", description: "Find a patient or register a new arrival.", href: "/patients", permission: "patient:read", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" },
  { key: "opd", title: "Outpatient care", description: "Review encounters, triage and clinical orders.", href: "/clinical/orders", permission: "encounter:read", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
  { key: "laboratory", title: "Laboratory", description: "Accession samples and verify results.", href: "/lab", permission: "lab_result:read", icon: "M8 4h8l-1 1v5.17a2 2 0 00.59 1.42l5 5A2 2 0 0119.17 20H4.83a2 2 0 01-1.42-3.41l5-5A2 2 0 009 10.17V5L8 4z" },
  { key: "pharmacy", title: "Pharmacy", description: "Dispense prescriptions and review stock.", href: "/pharmacy", permission: "prescription:read", icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2" },
  { key: "radiology", title: "Radiology", description: "Review imaging requests and reports.", href: "/radiology", permission: "imaging_order:read", icon: "M4 16l4.6-4.6a2 2 0 012.8 0L16 16m-2-2l1.6-1.6a2 2 0 012.8 0L20 14M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { key: "inpatient", title: "Inpatient care", description: "Coordinate admissions, beds and ward care.", href: "/inpatient", permission: "admission:read", icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" },
  { key: "theatre", title: "Theatre", description: "Review the operating theatre schedule.", href: "/theatre", permission: "theatre_case:read", icon: "M12 3v18m-9-9h18" },
  { key: "billing", title: "Billing", description: "Manage patient invoices and payments.", href: "/billing", permission: "invoice:read", icon: "M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6zm7-5a2 2 0 11-4 0 2 2 0 014 0z" },
  { key: "claims", title: "SHA & insurance claims", description: "Track eligibility and claim submissions.", href: "/claims", permission: "claim:read", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.6a1 1 0 01.7.3l5.4 5.4a1 1 0 01.3.7V19a2 2 0 01-2 2z" },
  { key: "him", title: "Health records", description: "Work coding, amendments and information requests.", href: "/him", permission: "him:manage", icon: "M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" },
];

const workflowModules: Record<string, ModuleKey> = {
  patients: "registration", opd: "opd", laboratory: "laboratory", pharmacy: "pharmacy",
  radiology: "radiology", inpatient: "ipd", theatre: "theatre", billing: "billing",
  claims: "claims", him: "him",
};

async function getDashboardData(tenantId: string, userId: string): Promise<{ data: DashboardData; visibleWorkflows: typeof workflows }> {
  return withTenantContext(tenantId, async (client) => {
    const session = { tenantId, userId, issuedAt: 0, sessionKind: "tenant" as const };
    const authz = await loadUserAuthz(client, session);
    // These worklists currently load hospital-wide datasets, so only expose
    // them to hospital-scoped grants until department-filtered worklists land.
    const visibleWorkflows = workflows.filter((item) => authz.grants.get(item.permission) === "hospital");
    const canReadPatients = authz.grants.get("patient:read") === "hospital";
    const canReadEncounters = authz.grants.get("encounter:read") === "hospital";
    const canReadOrders = authz.grants.get("order:read") === "hospital";
    const canReadAdmissions = authz.grants.get("admission:read") === "hospital";
    const canReadDepartments = authz.grants.get("department:read") === "hospital";

    const [hospitalResult, countsResult] = await Promise.all([
      client.query<{ name: string; facility_id: string | null; keph_level: number | null }>(
        `SELECT o.name, hs.facility_id, hs.keph_level
           FROM organizations o
           LEFT JOIN hospital_settings hs ON hs.tenant_id = o.id
          WHERE o.id = $1`, [tenantId]),
      client.query<{ patients_today: string | null; open_encounters: string | null; pending_orders: string | null; current_admissions: string | null; departments: string | null }>(
        `SELECT
          CASE WHEN $2 THEN (SELECT count(*) FROM patients p WHERE p.tenant_id = $1 AND p.deleted_at IS NULL AND p.created_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Nairobi') AT TIME ZONE 'Africa/Nairobi') ELSE NULL END AS patients_today,
          CASE WHEN $3 THEN (SELECT count(*) FROM encounters e WHERE e.tenant_id = $1 AND e.status IN ('planned','arrived','triaged','in_progress')) ELSE NULL END AS open_encounters,
          CASE WHEN $4 THEN (SELECT count(*) FROM orders o WHERE o.tenant_id = $1 AND o.status IN ('requested','in_progress')) ELSE NULL END AS pending_orders,
          CASE WHEN $5 THEN (SELECT count(*) FROM admissions a WHERE a.tenant_id = $1 AND a.status IN ('admitted','transferred')) ELSE NULL END AS current_admissions,
          CASE WHEN $6 THEN (SELECT count(*) FROM departments d WHERE d.tenant_id = $1 AND d.is_active = TRUE) ELSE NULL END AS departments`,
        [tenantId, canReadPatients, canReadEncounters, canReadOrders, canReadAdmissions, canReadDepartments]),
    ]);

    await writeAuditLog(client, {
      tenantId, actorId: userId, action: "dashboard.view", entityType: "hospital_dashboard", entityId: null,
      oldState: null, newState: null, context: { aggregateOnly: true },
    });

    const hospital = hospitalResult.rows[0];
    const counts = countsResult.rows[0];
    return {
      data: {
        hospitalName: hospital?.name ?? "Hospital",
        facilityId: hospital?.facility_id ?? null,
        kephLevel: hospital?.keph_level ?? null,
        patientsToday: counts?.patients_today === null ? null : Number(counts?.patients_today ?? 0),
        openEncounters: counts?.open_encounters === null ? null : Number(counts?.open_encounters ?? 0),
        pendingOrders: counts?.pending_orders === null ? null : Number(counts?.pending_orders ?? 0),
        currentAdmissions: counts?.current_admissions === null ? null : Number(counts?.current_admissions ?? 0),
        departments: counts?.departments === null ? null : Number(counts?.departments ?? 0),
      },
      visibleWorkflows: (await Promise.all(visibleWorkflows.map(async (item) => ({ item, enabled: await isModuleEnabled(client, tenantId, workflowModules[item.key]) })))).filter(({ enabled }) => enabled).map(({ item }) => item),
    };
  });
}

export default async function HospitalDashboard() {
  const session = await getSession();
  if (!session) redirect("/login");
  const { data, visibleWorkflows } = await getDashboardData(session.tenantId, session.userId);
  const today = new Intl.DateTimeFormat("en-KE", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Nairobi" }).format(new Date());

  return <div className="mx-auto max-w-7xl space-y-8">
    <section className="overflow-hidden rounded-2xl bg-[#102b45] text-white shadow-sm">
      <div className="flex flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Hospital operations · {today}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{data.hospitalName}</h1>
          <p className="mt-2 text-sm text-slate-300">Daily operations overview</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5">Africa/Nairobi · EAT</span>
          {data.kephLevel && <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5">KEPH Level {data.kephLevel}</span>}
          {data.facilityId && <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5">MFL {data.facilityId}</span>}
        </div>
      </div>
      <div className="grid grid-cols-2 border-t border-white/10 md:grid-cols-4">
        <div className="p-5 sm:px-8"><p className="text-2xl font-semibold">{data.patientsToday === null ? "—" : data.patientsToday.toLocaleString("en-KE")}</p><p className="mt-1 text-xs text-slate-300">New registrations today</p></div>
        <div className="border-l border-white/10 p-5 sm:px-8"><p className="text-2xl font-semibold">{data.openEncounters === null ? "—" : data.openEncounters.toLocaleString("en-KE")}</p><p className="mt-1 text-xs text-slate-300">Open encounters</p></div>
        <div className="border-t border-white/10 p-5 sm:border-l sm:border-t-0 sm:px-8"><p className="text-2xl font-semibold">{data.pendingOrders === null ? "—" : data.pendingOrders.toLocaleString("en-KE")}</p><p className="mt-1 text-xs text-slate-300">Pending clinical orders</p></div>
        <div className="border-l border-t border-white/10 p-5 sm:px-8 md:border-t-0"><p className="text-2xl font-semibold">{data.currentAdmissions === null ? "—" : data.currentAdmissions.toLocaleString("en-KE")}</p><p className="mt-1 text-xs text-slate-300">Current admissions</p></div>
      </div>
    </section>

    <section aria-labelledby="workflows-heading">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-700 dark:text-brand-300">Care and services</p><h2 id="workflows-heading" className="mt-1 text-xl font-semibold text-slate-950 dark:text-white">Hospital departments</h2></div>
        {data.departments !== null && <span className="text-sm text-slate-500">{data.departments} active departments</span>}
      </div>
      {visibleWorkflows.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visibleWorkflows.map((item) => <Link key={item.key} href={item.href} className="group flex min-h-32 gap-4 rounded-xl border border-slate-200 bg-white p-5 transition hover:border-brand-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-800 dark:bg-slate-900">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-50 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true"><path d={item.icon}/></svg></span>
          <span><span className="block font-semibold text-slate-900 group-hover:text-brand-800 dark:text-white">{item.title}</span><span className="mt-1 block text-sm leading-5 text-slate-600 dark:text-slate-400">{item.description}</span></span>
        </Link>)}
      </div> : <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">No department areas are available for your current role. Contact your hospital administrator if you need access.</div>}
    </section>

    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 sm:flex-row sm:items-center sm:justify-between">
      <span>Counts reflect records visible to your role. Patient details are available inside authorised clinical workflows.</span>
      <span className="shrink-0 text-xs font-medium text-slate-500">For access changes, contact your hospital administrator.</span>
    </div>
  </div>;
}
