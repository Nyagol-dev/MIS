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

export const metadata: Metadata = {
  title: "MIS — Workspace",
};

// ─── Navigation items ─────────────────────────────────────────────────────────
// Icon paths are Heroicons outline SVG `d` attributes.

const TENANT_NAV: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    iconPath:
      "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  },
  {
    label: "Users",
    href: "/users",
    iconPath:
      "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
  },
  {
    label: "Roles",
    href: "/roles",
    iconPath:
      "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
  },
  {
    label: "Entities",
    href: "/entities",
    iconPath:
      "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4",
  },
  {
    label: "Settings",
    href: "/settings",
    iconPath:
      "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  },
];

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function TenantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
          .tenant-content {
            padding: 1.25rem 1rem;
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
        {(session) => (
          <div className="tenant-shell">
            {/* Fixed sidebar */}
            <TenantSidebar
              navItems={TENANT_NAV}
              userEmail={session.userId}   /* pages can override with a DB-resolved name */
              tenantName={session.tenantId}
            />

            {/* Right side: top bar + page content */}
            <div className="tenant-main">
              <TopBar
                pageTitle="Workspace"
                userDisplayName={session.userId}
                logoutRedirectTo="/login"
              />

              <main id="tenant-main-content" className="tenant-content">
                {children}
              </main>
            </div>
          </div>
        )}
      </SessionGuard>
    </>
  );
}
