# Walkthrough - Reporting API Route Handlers

We have created the five required Next.js App Router Route Handlers. Each handler extracts the tenant session, checks permissions, delegates execution to core reporting functions, and returns standardized JSON responses.

---

## Changes

We created the following files:

### 1. [route.ts](file:///home/nickson/Projects/MIS/app/api/reports/route.ts)
- `GET`: Retrieve list of active report definitions (allows optional `entity_type_id` query param).
- `POST`: Create a new report definition.

### 2. [route.ts](file:///home/nickson/Projects/MIS/app/api/reports/[id]/route.ts)
- `GET`: Retrieve a single report definition (returns `404` if not found).
- `PUT`: Update an existing report definition.
- `DELETE`: Delete a report definition (returns `204 No Content` on success).

### 3. [route.ts](file:///home/nickson/Projects/MIS/app/api/reports/[id]/execute/route.ts)
- `POST`: Execute a saved report definition.

### 4. [route.ts](file:///home/nickson/Projects/MIS/app/api/reports/[id]/refresh/route.ts)
- `POST`: Force-refresh a cached report definition.

### 5. [route.ts](file:///home/nickson/Projects/MIS/app/api/reports/adhoc/route.ts)
- `POST`: Execute an ad-hoc report.

---

## Error Handling Pattern

Every handler uses a standardized try-catch mapping pattern to translate application exceptions into appropriate HTTP statuses:
- **Session verification failure**: `401 Unauthorized`
- **`NOT_FOUND` / `.status === 404`**: `404 Not Found`
- **`FORBIDDEN` / `.status === 403`**: `403 Forbidden`
- **`VALIDATION_ERROR` / `.status === 400`**: `400 Bad Request` with key details
- **Generic exceptions**: `500 Internal Server Error`

---

## Verification

We ran TypeScript compiler check `npx tsc --noEmit` which completed successfully with exit code 0, validating that all imports, type arguments, and dynamic route promise signatures (Next.js 16 requirements) compile cleanly.
