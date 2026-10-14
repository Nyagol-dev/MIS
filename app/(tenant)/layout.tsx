/**
 * app/(tenant)/layout.tsx
 *
 * Route-group layout for all tenant-authenticated pages:
 *   /dashboard, /users, /roles, /entities/*, /settings
 *
 * Responsibilities:
 * 1. Delegates session verification to SessionGuard (server component).
 *    SessionGuard reads the mis_session cookie, calls verifyAnySession(),
 *    and redirects to /login if:
 *      - The cookie is missing or the JWT is invalid/expired.
 *      - The session kind is not "tenant" (e.g. a platform admin cookie).
 * 2. Receives the verified session payload via render-prop from SessionGuard.
 * 3. Renders the sidebar + top bar shell, passing user info as props.
 * 4. Renders children (page content) in the main area.
 *
 * IMPORTANT: This layout NEVER re-verifies the session itself.
 * SessionGuard is the single point of truth for layout-level auth.
 */

import type { Metadata } from "next";
import SessionGuard from "@/components/layout/SessionGuard";
import TenantSidebar, {
  type NavItem,
} from "@/components/layout/TenantSidebar";
import TopBar from "@/components/layout/TopBar";
import { withTenantContext } from "@/lib/db/withTenant";
import { loadUserAuthz } from "@/lib/authz/check";
import { isModuleEnabled, type ModuleKey } from "@/lib/modules/check";

export const metadata: Metadata = {
  title: "HMIS — Hospital",
};

type HospitalNavItem = NavItem & { permission?: string; module?: ModuleKey };

// ─── Navigation items ─────────────────────────────────────────────────────────
// Icon paths are Heroicons outline SVG `d` attributes.

const TENANT_NAV: HospitalNavItem[] = [
  // ── Core ──────────────────────────────────────────────────────────────────
  {
    label: "Dashboard",
    href: "/dashboard",
    group: "Hospital",
    iconPath:
      "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  },

  // ── Clinical ──────────────────────────────────────────────────────────────
  {
    label: "Patients",
    href: "/patients",
    group: "Clinical services",
    permission: "patient:read",
    module: "registration",
    iconPath:
      "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
  },
  {
    label: "Outpatient (OPD)",
    href: "/clinical/orders",
    group: "Clinical services",
    permission: "encounter:read",
    module: "opd",
    iconPath:
      "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
  },
  {
    label: "Laboratory",
    href: "/lab",
    group: "Clinical services",
    permission: "lab_result:read",
    module: "laboratory",
    iconPath:
      "M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z",
  },
  {
    label: "Pharmacy",
    href: "/pharmacy",
    group: "Clinical services",
    permission: "prescription:read",
    module: "pharmacy",
    iconPath:
      "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
  },
  {
    label: "Radiology",
    href: "/radiology",
    group: "Clinical services",
    permission: "imaging_order:read",
    module: "radiology",
    iconPath:
      "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
  },
  {
    label: "Inpatient (IPD)",
    href: "/inpatient",
    group: "Clinical services",
    permission: "admission:read",
    module: "ipd",
    iconPath:
      "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
  },
  {
    label: "Theatre",
    href: "/theatre",
    group: "Clinical services",
    permission: "theatre_case:read",
    module: "theatre",
    iconPath:
      "M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },

  // ── Finance ───────────────────────────────────────────────────────────────
  {
    label: "Billing",
    href: "/billing",
    group: "Finance & claims",
    permission: "invoice:read",
    module: "billing",
    iconPath:
      "M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z",
  },
  {
    label: "Claims",
    href: "/claims",
    group: "Finance & claims",
    permission: "claim:read",
    module: "claims",
    iconPath:
      "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  },

  // ── Administration ────────────────────────────────────────────────────────
  {
    label: "Health Records (HIM)",
    href: "/him",
    group: "Hospital administration",
    permission: "him:manage",
    module: "him",
    iconPath:
      "M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4",
  },
  {
    label: "Staff",
    href: "/users",
    group: "Hospital administration",
    permission: "staff:read",
    iconPath:
      "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
  },
  {
    label: "Roles & Permissions",
    href: "/roles",
    group: "Hospital administration",
    permission: "role:manage",
    iconPath:
      "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
  },
];

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function TenantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  async function loadShellIdentity(session: { tenantId: string; userId: string }) {
    return withTenantContext(session.tenantId, async (client) => {
      const result = await client.query<{ email: string; hospital_name: string }>(
        `SELECT u.email, o.name AS hospital_name
           FROM users u
           JOIN organizations o ON o.id = u.tenant_id
          WHERE u.tenant_id = $1 AND u.id = $2
          LIMIT 1`,
        [session.tenantId, session.userId],
      );
      const authz = await loadUserAuthz(client, { ...session, issuedAt: 0, sessionKind: "tenant" });
      const visibleNavItems = await Promise.all(TENANT_NAV.map(async (item) => {
        const allowed = !item.permission || authz.grants.get(item.permission) === "hospital";
        const enabled = !item.module || await isModuleEnabled(client, session.tenantId, item.module);
        return allowed && enabled ? item : null;
      }));
      return {
        ...(result.rows[0] ?? { email: "Hospital staff", hospital_name: "Hospital" }),
        navItems: visibleNavItems.filter((item): item is HospitalNavItem => item !== null),
      };
    });
  }

  return (
    <>
      <style>{`
        /* ── Tenant shell CSS tokens ─────────────────────────────────── */
        /* Sidebar values mirror --sidebar-* in globals.css              */
        :root {
          --sidebar-width:              15rem;
          --topbar-height:              3.5rem;

          /* Sidebar — institutional deep navy (dark regardless of page mode) */
          --sidebar-bg:                 #0d1f35;
          --sidebar-border:             rgba(255,255,255,0.07);
          --sidebar-fg:                 rgba(255,255,255,0.70);
          --sidebar-muted:              rgba(255,255,255,0.38);
          --sidebar-brand-fg:           #ffffff;
          --sidebar-active-fg:          #ffffff;
          --sidebar-active-bg:          rgba(255,255,255,0.12);
          --sidebar-hover:              rgba(255,255,255,0.07);
          --sidebar-logout-fg:          rgba(255,255,255,0.60);

          /* Top bar */
          --topbar-bg:                  rgba(255,255,255,0.92);
          --topbar-border:              #e2e8f0;
          --topbar-title-fg:            #0f172a;
          --topbar-breadcrumb-fg:       #64748b;
          --topbar-user-fg:             #475569;
          --topbar-muted:               #94a3b8;
          --topbar-avatar-bg:           #1e50a2;
          --topbar-avatar-fg:           #ffffff;
          --topbar-btn-bg:              transparent;
          --topbar-btn-border:          #cbd5e1;
          --topbar-btn-fg:              #475569;
          --topbar-btn-hover-bg:        #f1f5f9;
        }

        /* ── Shell layout ─────────────────────────────────────────────── */
        .tenant-shell {
          display: flex;
          min-height: 100dvh;
        }

        /* Push main content to the right of the fixed sidebar */
        .tenant-main {
          flex: 1;
          margin-left: var(--sidebar-width);
          display: flex;
          flex-direction: column;
          min-height: 100dvh;
          background: #f8fafc;
        }

        /* Scrollable page content below the sticky top bar */
        .tenant-content {
          flex: 1;
          padding: 2rem 2.5rem;
          overflow-y: auto;
        }

        @media (max-width: 768px) {
          #tenant-sidebar { display: none !important; }
          .tenant-main { margin-left: 0 !important; }
          .tenant-content {
            padding: 1.25rem 1rem 6rem !important;
          }
        }
      `}</style>

      {/*
        SessionGuard verifies the tenant session.
        - requiredKind="tenant" → only tenant JWTs pass.
        - redirectTo="/login"   → unauthenticated or wrong-kind visitors
                                  go to the tenant login page.
        The render-prop pattern passes the narrowed session payload to
        children without React context (Server Components can't consume
        context without a client boundary).
      */}
      <SessionGuard requiredKind="tenant" redirectTo="/login">
        {async (session) => {
          const identity = await loadShellIdentity(session);
          return (
          <div className="tenant-shell">
            {/* Fixed sidebar */}
            <TenantSidebar
              navItems={identity.navItems}
              userEmail={identity.email}
              tenantName={identity.hospital_name}
            />

            {/* Right side: top bar + page content */}
            <div className="tenant-main">
              <TopBar
                pageTitle="Hospital"
                userDisplayName={identity.email}
                logoutRedirectTo="/login"
              />

              <main id="tenant-main-content" className="tenant-content">
                {children}
              </main>
            </div>
          </div>
          );
        }}
      </SessionGuard>
    </>
  );
}
