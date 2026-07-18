/**
 * components/layout/PlatformSidebar.tsx
 *
 * Presentational sidebar navigation for the platform-admin shell.
 * Mirrors TenantSidebar in structure but uses platform-specific
 * colour tokens and redirects to /platform/login on logout.
 *
 * Marked 'use client' so that usePathname and useRouter work.
 * All data is passed as props — no data fetching here.
 */

"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NavItem {
  label: string;
  href: string;
  iconPath?: string;
}

export interface PlatformSidebarProps {
  navItems: NavItem[];
  adminEmail: string;
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
      aria-hidden="true"
      className={className}
      style={{ width: "1.1rem", height: "1.1rem", flexShrink: 0 }}
    >
      <path d={path} />
    </svg>
  );
}

const DEFAULT_ICON = "M4 6h16M4 12h16M4 18h16";
const LOGOUT_ICON =
  "M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1";
const SHIELD_ICON =
  "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z";

// ─── Logout button ────────────────────────────────────────────────────────────

function LogoutButton({ adminEmail }: { adminEmail: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleLogout() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/platform/login");
    }
  }

  return (
    <div style={{ borderTop: "1px solid var(--platform-sidebar-border)" }}>
      <div
        style={{
          padding: "0.75rem 1.25rem",
          fontSize: "0.75rem",
          color: "var(--platform-sidebar-muted)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={adminEmail}
      >
        {adminEmail}
      </div>

      <button
        id="platform-sidebar-logout"
        onClick={handleLogout}
        disabled={loading}
        aria-label="Log out of platform admin"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.625rem",
          width: "100%",
          padding: "0.625rem 1.25rem",
          background: "none",
          border: "none",
          color: loading
            ? "var(--platform-sidebar-muted)"
            : "var(--platform-sidebar-logout-fg)",
          fontSize: "0.8125rem",
          fontWeight: 500,
          cursor: loading ? "not-allowed" : "pointer",
          transition: "background 0.15s, color 0.15s",
          textAlign: "left",
        }}
        onMouseEnter={(e) => {
          if (!loading)
            (e.currentTarget as HTMLButtonElement).style.background =
              "var(--platform-sidebar-hover)";
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

// ─── Nav link ─────────────────────────────────────────────────────────────────

function NavLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
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
        color: isActive
          ? "var(--platform-sidebar-active-fg)"
          : "var(--platform-sidebar-fg)",
        background: isActive
          ? "var(--platform-sidebar-active-bg)"
          : "transparent",
        textDecoration: "none",
        transition: "background 0.15s, color 0.15s",
      }}
      onMouseEnter={(e) => {
        if (!isActive)
          (e.currentTarget as HTMLAnchorElement).style.background =
            "var(--platform-sidebar-hover)";
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
 * PlatformSidebar — fixed-position left navigation for the platform-admin shell.
 *
 * Visual cue: platform sidebar carries a "Platform Admin" badge and uses the
 * `--platform-sidebar-*` tokens (distinct from `--sidebar-*` used by the
 * tenant shell) so the two areas are immediately visually distinguishable.
 */
export default function PlatformSidebar({
  navItems,
  adminEmail,
}: PlatformSidebarProps) {
  return (
    <aside
      id="platform-sidebar"
      aria-label="Platform admin navigation"
      style={{
        position: "fixed",
        insetBlock: 0,
        left: 0,
        width: "var(--sidebar-width, 15rem)",
        display: "flex",
        flexDirection: "column",
        background: "var(--platform-sidebar-bg)",
        borderRight: "1px solid var(--platform-sidebar-border)",
        zIndex: 40,
      }}
    >
      {/* Brand / platform label */}
      <div
        style={{
          padding: "1.25rem 1.5rem 1rem",
          borderBottom: "1px solid var(--platform-sidebar-border)",
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
        }}
      >
        {/* Product name */}
        <div
          style={{
            fontSize: "0.9375rem",
            fontWeight: 700,
            color: "var(--platform-sidebar-brand-fg)",
          }}
        >
          MIS Platform
        </div>

        {/* Admin badge */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.25rem",
            padding: "0.2rem 0.5rem",
            borderRadius: "9999px",
            background: "var(--platform-badge-bg)",
            color: "var(--platform-badge-fg)",
            fontSize: "0.6875rem",
            fontWeight: 600,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            width: "fit-content",
          }}
        >
          <Icon path={SHIELD_ICON} />
          Platform Admin
        </span>
      </div>

      {/* Navigation links */}
      <nav
        aria-label="Platform navigation"
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

      {/* Footer */}
      <LogoutButton adminEmail={adminEmail} />
    </aside>
  );
}
