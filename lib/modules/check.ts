/**
 * lib/modules/check.ts
 *
 * MODULE FLAG ENFORCEMENT (§8)
 * ─────────────────────────────────────────────────────────────────────────────
 * Enforces per-hospital module flags server-side. Routes that belong to a
 * disabled module return 404/403. Security-critical controls (audit, MFA,
 * encryption, retention) are never toggleable.
 *
 * Module keys correspond to hospital_modules.module_key rows.
 */

import type { PoolClient } from 'pg';

/**
 * All known module keys and their metadata.
 */
export const MODULE_DEFINITIONS = {
  registration: { name: 'Patient Registration', toggleable: true, defaultEnabled: true },
  appointments: { name: 'Appointments & Queue', toggleable: true, defaultEnabled: true },
  opd: { name: 'Outpatient (OPD)', toggleable: true, defaultEnabled: true },
  orders: { name: 'Clinical Orders (CPOE)', toggleable: true, defaultEnabled: false },
  laboratory: { name: 'Laboratory (LIS)', toggleable: true, defaultEnabled: false },
  radiology: { name: 'Radiology', toggleable: true, defaultEnabled: false },
  pharmacy: { name: 'Pharmacy & Dispensing', toggleable: true, defaultEnabled: false },
  ipd: { name: 'Inpatient (IPD)', toggleable: true, defaultEnabled: false },
  theatre: { name: 'Theatre & Procedures', toggleable: true, defaultEnabled: false },
  maternity: { name: 'Maternity / MCH', toggleable: true, defaultEnabled: false },
  billing: { name: 'Billing & Revenue', toggleable: true, defaultEnabled: true },
  claims: { name: 'Insurance & SHA Claims', toggleable: true, defaultEnabled: false },
  referrals: { name: 'Referrals', toggleable: true, defaultEnabled: false },
  inventory: { name: 'Inventory & Store', toggleable: true, defaultEnabled: false },
  hr: { name: 'HR & Rostering', toggleable: true, defaultEnabled: false },
  him: { name: 'Health Records (HIM)', toggleable: true, defaultEnabled: false },
  reporting: { name: 'Reporting', toggleable: true, defaultEnabled: true },
  notifications: { name: 'Notifications', toggleable: true, defaultEnabled: false },
  integrations: { name: 'Registry & HIE Integration', toggleable: true, defaultEnabled: false },
  // Non-toggleable security controls
  audit: { name: 'Audit & Compliance', toggleable: false, defaultEnabled: true },
  mfa: { name: 'Multi-Factor Authentication', toggleable: false, defaultEnabled: true },
  encryption: { name: 'Field Encryption', toggleable: false, defaultEnabled: true },
} as const;

export type ModuleKey = keyof typeof MODULE_DEFINITIONS;

/**
 * Maps API route prefixes to module keys for middleware enforcement.
 */
export const ROUTE_MODULE_MAP: Record<string, ModuleKey> = {
  '/api/laboratory': 'laboratory',
  '/api/lab': 'laboratory',
  '/api/radiology': 'radiology',
  '/api/pharmacy': 'pharmacy',
  '/api/ipd': 'ipd',
  '/api/admissions': 'ipd',
  '/api/beds': 'ipd',
  '/api/theatre': 'theatre',
  '/api/maternity': 'maternity',
  '/api/claims': 'claims',
  '/api/insurance': 'claims',
  '/api/referrals': 'referrals',
  '/api/inventory': 'inventory',
  '/api/store': 'inventory',
  '/api/hr': 'hr',
  '/api/roster': 'hr',
  '/api/him': 'him',
  '/api/integrations': 'integrations',
  '/api/notifications': 'notifications',
};

/**
 * Checks if a module is enabled for the given tenant.
 * Must be called inside a withTenantContext transaction.
 *
 * @param client    - Tenant-scoped PoolClient
 * @param tenantId  - The tenant UUID
 * @param moduleKey - The module to check
 * @returns true if enabled, false if disabled
 */
export async function isModuleEnabled(
  client: PoolClient,
  tenantId: string,
  moduleKey: ModuleKey,
): Promise<boolean> {
  const definition = MODULE_DEFINITIONS[moduleKey];

  // Non-toggleable modules are always enabled
  if (!definition.toggleable) return true;

  const result = await client.query<{ enabled: boolean }>(
    `SELECT enabled FROM hospital_modules
      WHERE tenant_id = $1 AND module_key = $2`,
    [tenantId, moduleKey],
  );

  if (result.rows.length === 0) {
    // No row → use default
    return definition.defaultEnabled;
  }

  return result.rows[0].enabled;
}

/**
 * Throws an error if the module is not enabled.
 * Used by route handlers to enforce module flags.
 */
export async function requireModule(
  client: PoolClient,
  tenantId: string,
  moduleKey: ModuleKey,
): Promise<void> {
  const enabled = await isModuleEnabled(client, tenantId, moduleKey);
  if (!enabled) {
    const error = new Error(`Module '${moduleKey}' is not enabled.`);
    (error as Error & { status: number }).status = 404;
    throw error;
  }
}

/**
 * Returns the module key for a given API route path, or null if
 * the route is not module-gated.
 */
export function getModuleForRoute(pathname: string): ModuleKey | null {
  for (const [prefix, moduleKey] of Object.entries(ROUTE_MODULE_MAP)) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) {
      return moduleKey;
    }
  }
  return null;
}
