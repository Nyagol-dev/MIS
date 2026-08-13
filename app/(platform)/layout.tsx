/**
 * app/(platform)/layout.tsx
 *
 * Route-group layout for all platform-admin pages:
 *   /platform/dashboard, /platform/tenants, /platform/admins
 *
 * Responsibilities:
 * 1. Delegates session verification to SessionGuard.
 *    SessionGuard reads the mis_session cookie, calls verifyAnySession(),
 *    and redirects to /platform/login if:
 *      - The cookie is missing or the JWT is invalid/expired.
 *      - The session kind is not "platform_admin" (e.g. a tenant cookie).
 * 2. Receives the verified PlatformAdminSessionPayload via render-prop.
 * 3. Renders the PlatformSidebar + TopBar shell with admin info as props.
 * 4. Renders children (page content) in the main area.
 *
 * IMPORTANT: This layout NEVER re-verifies the session itself.
 * SessionGuard is the single point of truth for layout-level auth.
 */

import type { Metadata } from "next";
import SessionGuard from "@/components/layout/SessionGuard";
import PlatformSidebar, {
  type NavItem,
} from "@/components/layout/PlatformSidebar";
import TopBar from "@/components/layout/TopBar";

export const metadata: Metadata = {
  title: "MIS — Platform Admin",
};

// ─── Navigation items ─────────────────────────────────────────────────────────

const PLATFORM_NAV: NavItem[] = [
  {
    label: "Dashboard",
    href: "/platform/dashboard",
    iconPath:
      "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  },
  {
    label: "Tenants",
    href: "/platform/tenants",
    iconPath:
      "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
  },
  {
    label: "Admins",
    href: "/platform/admins",
    iconPath:
      "M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  },
];

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <style>{`
        /* ── Platform shell CSS tokens ────────────────────────────────── */
        /* Platform sidebar is deeper charcoal-navy than tenant sidebar,   */
        /* making the two admin contexts immediately visually distinct.     */
        :root {
          --sidebar-width:                   15rem;
          --topbar-height:                   3.5rem;

          /* Platform sidebar — deeper charcoal-navy (admin context) */
          --platform-sidebar-bg:             #060d18;
          --platform-sidebar-border:         rgba(255,255,255,0.07);
          --platform-sidebar-fg:             rgba(255,255,255,0.65);
          --platform-sidebar-muted:          rgba(255,255,255,0.35);
          --platform-sidebar-brand-fg:       #ffffff;
          --platform-sidebar-active-fg:      #ffffff;
          --platform-sidebar-active-bg:      rgba(255,255,255,0.12);
          --platform-sidebar-hover:          rgba(255,255,255,0.06);
          --platform-sidebar-logout-fg:      rgba(255,255,255,0.60);

          /* Platform admin badge — warm amber distinguishes admin context */
          --platform-badge-bg:               rgba(245,158,11,0.18);
          --platform-badge-fg:               #fcd34d;

          /* Top bar */
          --topbar-bg:                       rgba(255,255,255,0.92);
          --topbar-border:                   #e2e8f0;
          --topbar-title-fg:                 #0f172a;
          --topbar-breadcrumb-fg:            #64748b;
          --topbar-user-fg:                  #475569;
          --topbar-muted:                    #94a3b8;
          --topbar-avatar-bg:                #1e50a2;
          --topbar-avatar-fg:                #ffffff;
          --topbar-btn-bg:                   transparent;
          --topbar-btn-border:               #cbd5e1;
          --topbar-btn-fg:                   #475569;
          --topbar-btn-hover-bg:             #f1f5f9;
        }

        /* ── Shell layout ─────────────────────────────────────────────── */
        .platform-shell {
          display: flex;
          min-height: 100dvh;
        }

        .platform-main {
          flex: 1;
          margin-left: var(--sidebar-width);
          display: flex;
          flex-direction: column;
          min-height: 100dvh;
          background: #f8fafc;
        }

        .platform-content {
          flex: 1;
          padding: 2rem 2.5rem;
          overflow-y: auto;
        }

        @media (max-width: 768px) {
          .platform-content {
            padding: 1.25rem 1rem;
          }
        }
      `}</style>

      {/*
        SessionGuard verifies the platform_admin session.
        - requiredKind="platform_admin" → only platform_admin JWTs pass.
        - redirectTo="/platform/login"  → unauthenticated or wrong-kind
                                          visitors go to the platform login.
      */}
      <SessionGuard requiredKind="platform_admin" redirectTo="/platform/login">
        {(session) => (
          <div className="platform-shell">
            {/* Fixed sidebar */}
            <PlatformSidebar
              navItems={PLATFORM_NAV}
              adminEmail={session.platformAdminId}
            />

            {/* Right side: top bar + page content */}
            <div className="platform-main">
              <TopBar
                pageTitle="Platform Admin"
                userDisplayName={session.platformAdminId}
                logoutRedirectTo="/platform/login"
              />

              <main id="platform-main-content" className="platform-content">
                {children}
              </main>
            </div>
          </div>
        )}
      </SessionGuard>
    </>
  );
}
