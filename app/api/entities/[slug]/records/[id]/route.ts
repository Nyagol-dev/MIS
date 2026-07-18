/**
 * app/api/entities/[slug]/records/[id]/route.ts
 *
 * GET    /api/entities/[slug]/records/[id] — Fetch a single entity record.
 * PUT    /api/entities/[slug]/records/[id] — Update an entity record.
 * DELETE /api/entities/[slug]/records/[id] — Hard-delete an entity record.
 *
 * AUTH: Tenant session required.
 *   GET    — requires 'read'   action grant on the entity type.
 *   PUT    — requires 'update' action grant on the entity type.
 *   DELETE — requires 'delete' action grant on the entity type.
 *
 * IDOR GUARD (Round 5 precedent)
 * ─────────────────────────────────────────────────────────────────────────────
 * The [slug] parameter is resolved to an entityTypeId via a query that
 * explicitly includes `tenant_id = session.tenantId`. A slug that belongs to
 * a different tenant returns 404 (not a 403), giving no information leakage.
 * The [id] record scoping is enforced inside the lib functions which include
 * `tenant_id = $N AND entity_type_id = $N AND id = $N` in all queries, with
 * RLS as the backing enforcement layer.
 *
 * SCHEMA VERSIONING — EDIT PATH (§5.4 append-and-retire)
 * ─────────────────────────────────────────────────────────────────────────────
 * On GET (for edit display) and PUT, field_definitions are loaded at the
 * record's PINNED schema_version — NOT at the entity type's current version.
 * This is enforced inside updateEntityRecord in the lib. The route handler
 * does NOT re-implement this — it delegates entirely to the lib.
 *
 * A record written at schema_version 3 must always be editable against the
 * field set that was valid at version 3, even if the entity type has since
 * been bumped to version 7. The immutable schema_version column on
 * entity_records is the anchor.
 *
 * STATUS CODES
 *   200 — GET / PUT success
 *   204 — DELETE success (no body)
 *   400 — Malformed request body
 *   401 — No valid session
 *   403 — Session lacks action grant on this entity type
 *   404 — Entity type slug or record not found in this tenant
 *   422 — Entity record validation error (field errors returned as array)
 *   500 — Unexpected server error
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";
import { withTenantContext } from "@/lib/db/withTenant";
import {
  getEntityRecord,
  updateEntityRecord,
  deleteEntityRecord,
  EntityValidationError,
} from "@/lib/entities/records";
import { ForbiddenError } from "@/lib/auth/permissions";

// ─── Route param type ─────────────────────────────────────────────────────────

type RecordParams = { params: Promise<{ slug: string; id: string }> };

// ─── Shared error handler ─────────────────────────────────────────────────────

function handleError(error: unknown): NextResponse {
  // EntityValidationError — field-level validation failure from the lib.
  if (error instanceof EntityValidationError) {
    return NextResponse.json(
      {
        error: "Entity record validation failed.",
        code: "ENTITY_VALIDATION_ERROR",
        fields: error.errors,
      },
      { status: 422 }
    );
  }

  // ForbiddenError — thrown by requireEntityAccess inside the lib functions.
  if (error instanceof ForbiddenError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: 403 }
    );
  }

  // Typed-error objects returned by lib functions (code / message shape).
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

// ─── Slug → entityTypeId resolution (with tenant IDOR guard) ─────────────────

/**
 * Resolves the entity type slug to an entityTypeId, explicitly scoping the
 * query to the session's tenantId.
 *
 * Defense-in-depth: the RLS context (set by withTenantContext via SET LOCAL
 * app.current_tenant_id) plus the explicit `tenant_id = $1` WHERE clause
 * together prevent cross-tenant IDOR. A slug belonging to a different tenant
 * returns null — indistinguishable from "not found".
 *
 * NOTE: is_active is NOT filtered here intentionally. On the edit path a
 * record that was written against a now-retired entity type should still be
 * readable/updatable at its pinned schema_version. The entity type's
 * is_active flag governs whether NEW records can be created, not whether
 * existing ones can be read or edited.
 */
async function resolveEntityTypeId(
  tenantId: string,
  slug: string
): Promise<string | null> {
  return withTenantContext(tenantId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id
         FROM entity_types
        WHERE tenant_id = $1
          AND slug      = $2`,
      [tenantId, slug]
    );
    return rows[0]?.id ?? null;
  });
}

// ─── GET /api/entities/[slug]/records/[id] ────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: RecordParams
): Promise<NextResponse> {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug, id } = await params;

    // ── IDOR: resolve slug → entityTypeId, scoped to this tenant ────────────
    const entityTypeId = await resolveEntityTypeId(session.tenantId, slug);
    if (!entityTypeId) {
      return NextResponse.json(
        { error: `Entity type '${slug}' not found.` },
        { status: 404 }
      );
    }

    // ── Fetch record — permission check (read) is inside getEntityRecord ──────
    // getEntityRecord calls requireEntityAccess(session, entityTypeId, 'read')
    // which throws ForbiddenError on denial.
    //
    // VERSIONING NOTE: this GET is used both for display and for pre-populating
    // an edit form. The returned record includes schema_version (the pinned
    // version at write time). The client must use this schema_version when
    // constructing the edit form — it should query
    // GET /api/entities/[slug]/fields?version=<schema_version> to get the
    // exact field set the record was written against (per §5.4).
    const record = await getEntityRecord(session, entityTypeId, id);
    if (!record) {
      return NextResponse.json(
        { error: `Entity record '${id}' not found.` },
        { status: 404 }
      );
    }

    return NextResponse.json(record, { status: 200 });
  } catch (error) {
    return handleError(error);
  }
}

// ─── PUT /api/entities/[slug]/records/[id] ────────────────────────────────────

export async function PUT(
  request: NextRequest,
  { params }: RecordParams
): Promise<NextResponse> {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug, id } = await params;

    // ── Parse and validate request body ─────────────────────────────────────
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body." },
        { status: 400 }
      );
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json(
        { error: "Request body must be a JSON object." },
        { status: 400 }
      );
    }

    const data = body as Record<string, unknown>;

    // ── IDOR: resolve slug → entityTypeId, scoped to this tenant ────────────
    const entityTypeId = await resolveEntityTypeId(session.tenantId, slug);
    if (!entityTypeId) {
      return NextResponse.json(
        { error: `Entity type '${slug}' not found.` },
        { status: 404 }
      );
    }

    // ── Update — field_definitions loaded at the record's PINNED ─────────────
    // schema_version (NOT current_version). This is the append-and-retire
    // contract (§5.4): a record is always editable against the version it was
    // written at. updateEntityRecord enforces this inside the lib.
    //
    // updateEntityRecord throws:
    //   • ForbiddenError        → HTTP 403 (caught by handleError)
    //   • EntityValidationError → HTTP 422 (caught by handleError)
    //   • Error('not found')    → HTTP 500 — converted below to 404
    let updated;
    try {
      updated = await updateEntityRecord(session, entityTypeId, id, data);
    } catch (error) {
      // updateEntityRecord throws a plain Error (not a typed error) when the
      // record is not found. Detect by message prefix and return 404.
      if (
        error instanceof Error &&
        error.message.includes("not found") &&
        !(error instanceof ForbiddenError) &&
        !(error instanceof EntityValidationError)
      ) {
        return NextResponse.json(
          { error: `Entity record '${id}' not found.` },
          { status: 404 }
        );
      }
      return handleError(error);
    }

    return NextResponse.json(updated, { status: 200 });
  } catch (error) {
    return handleError(error);
  }
}

// ─── DELETE /api/entities/[slug]/records/[id] ─────────────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: RecordParams
): Promise<NextResponse> {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug, id } = await params;

    // ── IDOR: resolve slug → entityTypeId, scoped to this tenant ────────────
    const entityTypeId = await resolveEntityTypeId(session.tenantId, slug);
    if (!entityTypeId) {
      return NextResponse.json(
        { error: `Entity type '${slug}' not found.` },
        { status: 404 }
      );
    }

    // ── Hard-delete — permission check (delete) is inside deleteEntityRecord ─
    // deleteEntityRecord throws:
    //   • ForbiddenError     → HTTP 403 (caught by handleError)
    //   • Error('not found') → HTTP 404 (detected below)
    try {
      await deleteEntityRecord(session, entityTypeId, id);
    } catch (error) {
      // deleteEntityRecord throws a plain Error (not a typed error) when the
      // record is not found. Detect by message prefix and return 404.
      if (
        error instanceof Error &&
        error.message.includes("not found") &&
        !(error instanceof ForbiddenError)
      ) {
        return NextResponse.json(
          { error: `Entity record '${id}' not found.` },
          { status: 404 }
        );
      }
      return handleError(error);
    }

    // 204 No Content — hard delete, no body.
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleError(error);
  }
}
