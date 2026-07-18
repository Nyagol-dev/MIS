/**
 * components/layout/TopBar.tsx
 *
 * Presentational top bar shared by both the tenant and platform shells.
 * Displays the current page title, optional breadcrumbs, and a right-side
 * user info area with a logout button.
 *
 * Marked 'use client' so the logout button can call useRouter.
 * All data is passed as props — no data fetching here.
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface TopBarProps {
  /** Displayed as the page heading on the left side. */
  pageTitle: string;
  /** Optional breadcrumb trail rendered before pageTitle. */
  breadcrumbs?: BreadcrumbItem[];
  /** Display name / email of the logged-in user. */
  userDisplayName: string;
  /**
   * Where to redirect after logout. Defaults to "/login".
   * Pass "/platform/login" for the platform admin shell.
   */
  logoutRedirectTo?: string;
}

// ─── Icon helpers ─────────────────────────────────────────────────────────────

function ChevronIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ width: "0.875rem", height: "0.875rem", flexShrink: 0 }}
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * TopBar — sticky header rendered at the top of the main content area.
 *
 * Sits to the right of the fixed-position sidebar via `marginLeft` on the
 * containing shell layout. The sidebar width is read from the
 * `--sidebar-width` CSS custom property set by the layout's CSS.
 */
export default function TopBar({
  pageTitle,
  breadcrumbs = [],
  userDisplayName,
  logoutRedirectTo = "/login",
}: TopBarProps) {
  const [loggingOut, setLoggingOut] = useState(false);
  const router = useRouter();

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push(logoutRedirectTo);
    }
  }

  return (
    <header
      id="app-top-bar"
      role="banner"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 30,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "1rem",
        padding: "0 1.5rem",
        height: "var(--topbar-height, 3.5rem)",
        background: "var(--topbar-bg)",
        borderBottom: "1px solid var(--topbar-border)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      {/* Left: breadcrumbs + page title */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.375rem",
          minWidth: 0,
        }}
      >
        {breadcrumbs.map((crumb, idx) => (
          <span
            key={idx}
            style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}
          >
            {crumb.href ? (
              <a
                href={crumb.href}
                style={{
                  fontSize: "0.875rem",
                  color: "var(--topbar-breadcrumb-fg)",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLAnchorElement).style.textDecoration =
                    "underline";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLAnchorElement).style.textDecoration =
                    "none";
                }}
              >
                {crumb.label}
              </a>
            ) : (
              <span
                style={{
                  fontSize: "0.875rem",
                  color: "var(--topbar-breadcrumb-fg)",
                  whiteSpace: "nowrap",
                }}
              >
                {crumb.label}
              </span>
            )}
            <ChevronIcon />
          </span>
        ))}

        <h1
          style={{
            margin: 0,
            fontSize: "0.9375rem",
            fontWeight: 600,
            color: "var(--topbar-title-fg)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {pageTitle}
        </h1>
      </div>

      {/* Right: user display name + logout */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          flexShrink: 0,
        }}
      >
        {/* User avatar / name */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          {/* Initials avatar */}
          <div
            aria-hidden="true"
            style={{
              width: "2rem",
              height: "2rem",
              borderRadius: "50%",
              background: "var(--topbar-avatar-bg)",
              color: "var(--topbar-avatar-fg)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.6875rem",
              fontWeight: 700,
              flexShrink: 0,
              userSelect: "none",
            }}
          >
            {userDisplayName
              .trim()
              .split(/[\s@]+/)
              .slice(0, 2)
              .map((s) => s[0]?.toUpperCase() ?? "")
              .join("")}
          </div>

          <span
            style={{
              fontSize: "0.875rem",
              color: "var(--topbar-user-fg)",
              maxWidth: "12rem",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={userDisplayName}
          >
            {userDisplayName}
          </span>
        </div>

        {/* Divider */}
        <div
          aria-hidden="true"
          style={{
            width: "1px",
            height: "1.25rem",
            background: "var(--topbar-border)",
          }}
        />

        {/* Logout button */}
        <button
          id="top-bar-logout"
          onClick={handleLogout}
          disabled={loggingOut}
          aria-label="Log out"
          style={{
            padding: "0.375rem 0.75rem",
            borderRadius: "0.375rem",
            border: "1px solid var(--topbar-btn-border)",
            background: "var(--topbar-btn-bg)",
            color: loggingOut
              ? "var(--topbar-muted)"
              : "var(--topbar-btn-fg)",
            fontSize: "0.8125rem",
            fontWeight: 500,
            cursor: loggingOut ? "not-allowed" : "pointer",
            transition: "background 0.15s, border-color 0.15s",
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => {
            if (!loggingOut)
              (e.currentTarget as HTMLButtonElement).style.background =
                "var(--topbar-btn-hover-bg)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "var(--topbar-btn-bg)";
          }}
        >
          {loggingOut ? "…" : "Log out"}
        </button>
      </div>
    </header>
  );
}
