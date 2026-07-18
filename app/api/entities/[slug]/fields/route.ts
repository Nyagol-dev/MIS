/**
 * app/api/entities/[slug]/fields/route.ts
 *
 * GET  /api/entities/[slug]/fields  — List field_definitions for an entity type.
 * POST /api/entities/[slug]/fields  — Create (append) a new field_definition.
 *
 * AUTH: Tenant session required. Both operations require the `user:manage`
 * permission (requireTenantAdmin).
 *
 * APPEND-AND-RETIRE INVARIANT (POST)
 * ─────────────────────────────────────────────────────────────────────────────
 * field_definitions rows are NEVER mutated in place. Creating a field:
 *   1. Bumps entity_types.current_version.
 *   2. Inserts a new field_definitions row at that new version.
 * Retiring a field is a separate operation (not on this route). See the
 * canonical_postgres_schema §5.4 for the full lifecycle.
 *
 * GET — VERSION FILTER
 * ─────────────────────────────────────────────────────────────────────────────
 * Without ?version=: returns active fields at the type's current_version.
 * With ?version=<n>: returns fields active at that historical schema version.
 * Add ?include_retired=true to include fields with retired_at set.
 *
 * STATUS CODES
 *   200 — GET success
 *   201 — POST success (field definition created)
 *   400 — Validation error
 *   401 — No valid session
 *   403 — Missing user:manage permission
 *   404 — Entity type slug not found
 *   409 — field_key already exists for this entity type
 *   500 — Unexpected server error
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";
import { withTenantContext } from "@/lib/db/withTenant";
import { requireTenantAdmin } from "@/lib/auth/requireTenantAdmin";
import {
  listFieldDefinitions,
  createFieldDefinition,
} from "@/lib/entities/types";

// ─── Shared error handler ─────────────────────────────────────────────────────

function handleError(error: unknown): NextResponse {
  if (typeof error === "object" && error !== null && "code" in error) {
    const typed = error as { code: string; message: string };
    const status =
      typed.code === "NOT_FOUND"
        ? 404
        : typed.code === "CONFLICT"
        ? 409
        : typed.code === "VALIDATION_ERROR"
        ? 400
        : typed.code === "FORBIDDEN" ||
          typed.code === "ForbiddenError" ||
          typed.code === "FORBIDDEN_SYSTEM_ROLE"
        ? 403
        : 500;

    return NextResponse.json({ error: typed.message }, { status });
  }

  const message =
    error instanceof Error ? error.message : "An unexpected error occurred.";
  return NextResponse.json({ error: message }, { status: 500 });
}

// ─── Route param type ─────────────────────────────────────────────────────────

type SlugParams = { params: Promise<{ slug: string }> };

// ─── GET /api/entities/[slug]/fields ─────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: SlugParams
): Promise<NextResponse> {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const searchParams = request.nextUrl.searchParams;

    // Parse optional ?version= query param.
    const versionParam = searchParams.get("version");
    let version: number | undefined;
    if (versionParam !== null) {
      version = parseInt(versionParam, 10);
      if (Number.isNaN(version) || version < 1) {
        return NextResponse.json(
          { error: "'version' must be a positive integer." },
          { status: 400 }
        );
      }
    }

    // Parse pagination params.
    const limitParam = searchParams.get("limit");
    const offsetParam = searchParams.get("offset");
    const includeRetiredParam = searchParams.get("include_retired");

    let limit: number | undefined;
    let offset: number | undefined;

    if (limitParam !== null) {
      limit = parseInt(limitParam, 10);
      if (Number.isNaN(limit) || limit < 1) {
        return NextResponse.json(
          { error: "'limit' must be a positive integer." },
          { status: 400 }
        );
      }
    }
    if (offsetParam !== null) {
      offset = parseInt(offsetParam, 10);
      if (Number.isNaN(offset) || offset < 0) {
        return NextResponse.json(
          { error: "'offset' must be a non-negative integer." },
          { status: 400 }
        );
      }
    }

    const includeRetired = includeRetiredParam === "true";

    return await withTenantContext(session.tenantId, async (client) => {
      const authErr = await requireTenantAdmin(client, session);
      if (authErr) return handleError(authErr);

      const result = await listFieldDefinitions(client, session.tenantId, slug, {
        version,
        includeRetired,
        limit,
        offset,
      });

      if ("code" in result) {
        return handleError(result);
      }

      return NextResponse.json(result, { status: 200 });
    });
  } catch (error) {
    return handleError(error);
  }
}

// ─── POST /api/entities/[slug]/fields ────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: SlugParams
): Promise<NextResponse> {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    if (typeof body !== "object" || body === null) {
      return NextResponse.json(
        { error: "Request body must be a JSON object." },
        { status: 400 }
      );
    }

    const raw = body as Record<string, unknown>;

    // Required fields: field_key, display_name, field_type.
    if (typeof raw.field_key !== "string") {
      return NextResponse.json(
        { error: "Field 'field_key' is required and must be a string." },
        { status: 400 }
      );
    }
    if (typeof raw.display_name !== "string") {
      return NextResponse.json(
        { error: "Field 'display_name' is required and must be a string." },
        { status: 400 }
      );
    }
    if (typeof raw.field_type !== "string") {
      return NextResponse.json(
        { error: "Field 'field_type' is required and must be a string." },
        { status: 400 }
      );
    }

    // Optional typed fields.
    if (raw.is_required !== undefined && typeof raw.is_required !== "boolean") {
      return NextResponse.json(
        { error: "Field 'is_required' must be a boolean." },
        { status: 400 }
      );
    }
    if (raw.is_indexed !== undefined && typeof raw.is_indexed !== "boolean") {
      return NextResponse.json(
        { error: "Field 'is_indexed' must be a boolean." },
        { status: 400 }
      );
    }
    if (raw.sort_order !== undefined && typeof raw.sort_order !== "number") {
      return NextResponse.json(
        { error: "Field 'sort_order' must be a number." },
        { status: 400 }
      );
    }
    if (
      raw.constraints !== undefined &&
      (typeof raw.constraints !== "object" || raw.constraints === null || Array.isArray(raw.constraints))
    ) {
      return NextResponse.json(
        { error: "Field 'constraints' must be a JSON object." },
        { status: 400 }
      );
    }

    return await withTenantContext(session.tenantId, async (client) => {
      const authErr = await requireTenantAdmin(client, session);
      if (authErr) return handleError(authErr);

      const result = await createFieldDefinition(
        client,
        session.tenantId,
        slug,
        {
          field_key: raw.field_key as string,
          display_name: raw.display_name as string,
          field_type: raw.field_type as string,
          is_required: raw.is_required as boolean | undefined,
          is_indexed: raw.is_indexed as boolean | undefined,
          sort_order: raw.sort_order as number | undefined,
          default_value: raw.default_value,
          constraints:
            raw.constraints !== undefined
              ? (raw.constraints as Record<string, unknown>)
              : undefined,
        },
        session.userId
      );

      if ("code" in result) {
        return handleError(result);
      }

      return NextResponse.json(result, { status: 201 });
    });
  } catch (error) {
    return handleError(error);
  }
}
