/**
 * components/layout/TenantSidebar.tsx
 *
 * Presentational sidebar navigation for the tenant-authenticated shell.
 * This is a SERVER component (no 'use client') — it receives all data
 * as props and renders static HTML. The logout button is the only
 * interactive element; it lives in a small 'use client' sub-component
 * so the sidebar itself stays a server component.
 *
 * Props
 * ─────
 * navItems   — List of navigation links to render.
 * userEmail  — Displayed in the sidebar footer.
 * tenantName — Displayed as the workspace name at the top.
 */

"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NavItem {
  label: string;
  href: string;
  /** Optional Heroicons-compatible SVG path `d` attribute, or full SVG string. */
  iconPath?: string;
}

export interface TenantSidebarProps {
  navItems: NavItem[];
  userEmail: string;
  tenantName: string;
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function Icon({ path, className }: { path: string; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      style={{ width: "1.1rem", height: "1.1rem", flexShrink: 0 }}
    >
      <path d={path} />
    </svg>
  );
}

// Default nav icon (square/generic) when none provided.
const DEFAULT_ICON = "M4 6h16M4 12h16M4 18h16";

// Logout icon
const LOGOUT_ICON =
  "M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1";

// ─── Logout button (client island) ───────────────────────────────────────────

function LogoutButton({ userEmail }: { userEmail: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleLogout() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      // Always redirect even if the request fails — the cookie will be
      // cleared server-side; stale client state should not block the user.
      router.push("/login");
    }
  }

  return (
    <div style={{ borderTop: "1px solid var(--sidebar-border)" }}>
      {/* User info */}
      <div
        style={{
          padding: "0.75rem 1.25rem",
          fontSize: "0.75rem",
          color: "var(--sidebar-muted)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={userEmail}
      >
        {userEmail}
      </div>

      {/* Logout */}
      <button
        id="tenant-sidebar-logout"
        onClick={handleLogout}
        disabled={loading}
        aria-label="Log out"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.625rem",
          width: "100%",
          padding: "0.625rem 1.25rem",
          background: "none",
          border: "none",
          color: loading ? "var(--sidebar-muted)" : "var(--sidebar-logout-fg)",
          fontSize: "0.8125rem",
          fontWeight: 500,
          cursor: loading ? "not-allowed" : "pointer",
          transition: "background 0.15s, color 0.15s",
          textAlign: "left",
        }}
        onMouseEnter={(e) => {
          if (!loading)
            (e.currentTarget as HTMLButtonElement).style.background =
              "var(--sidebar-hover)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "none";
        }}
      >
        <Icon path={LOGOUT_ICON} />
        {loading ? "Logging out…" : "Log out"}
      </button>
    </div>
  );
}

// ─── Sidebar nav link ─────────────────────────────────────────────────────────

function NavLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  // Active if exact match or child route.
  const isActive =
    pathname === item.href || pathname.startsWith(item.href + "/");

  return (
    <a
      href={item.href}
      aria-current={isActive ? "page" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.625rem",
        padding: "0.5625rem 1.25rem",
        borderRadius: "0.375rem",
        marginInline: "0.5rem",
        fontSize: "0.875rem",
        fontWeight: isActive ? 600 : 400,
        color: isActive ? "var(--sidebar-active-fg)" : "var(--sidebar-fg)",
        background: isActive ? "var(--sidebar-active-bg)" : "transparent",
        textDecoration: "none",
        transition: "background 0.15s, color 0.15s",
      }}
      onMouseEnter={(e) => {
        if (!isActive)
          (e.currentTarget as HTMLAnchorElement).style.background =
            "var(--sidebar-hover)";
      }}
      onMouseLeave={(e) => {
        if (!isActive)
          (e.currentTarget as HTMLAnchorElement).style.background =
            "transparent";
      }}
    >
      <Icon path={item.iconPath ?? DEFAULT_ICON} />
      {item.label}
    </a>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * TenantSidebar — fixed-position left navigation for the tenant shell.
 *
 * Marked 'use client' at the top of this file so that `usePathname`
 * works for active-link highlighting and the logout button can call
 * `useRouter`. All data is passed as props — no data fetching here.
 */
export default function TenantSidebar({
  navItems,
  userEmail,
  tenantName,
}: TenantSidebarProps) {
  return (
    <aside
      id="tenant-sidebar"
      aria-label="Tenant navigation"
      style={{
        position: "fixed",
        insetBlock: 0,
        left: 0,
        width: "var(--sidebar-width, 15rem)",
        display: "flex",
        flexDirection: "column",
        background: "var(--sidebar-bg)",
        borderRight: "1px solid var(--sidebar-border)",
        zIndex: 40,
      }}
    >
      {/* Brand / workspace name */}
      <div
        style={{
          padding: "1.25rem 1.5rem 1rem",
          borderBottom: "1px solid var(--sidebar-border)",
        }}
      >
        <div
          style={{
            fontSize: "0.6875rem",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--sidebar-muted)",
            marginBottom: "0.25rem",
          }}
        >
          Workspace
        </div>
        <div
          style={{
            fontSize: "0.9375rem",
            fontWeight: 700,
            color: "var(--sidebar-brand-fg)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={tenantName}
        >
          {tenantName}
        </div>
      </div>

      {/* Navigation links */}
      <nav
        aria-label="Main navigation"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "0.75rem 0",
          display: "flex",
          flexDirection: "column",
          gap: "0.125rem",
        }}
      >
        {navItems.map((item) => (
          <NavLink key={item.href} item={item} />
        ))}
      </nav>

      {/* Footer: user info + logout */}
      <LogoutButton userEmail={userEmail} />
    </aside>
  );
}
