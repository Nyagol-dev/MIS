/**
 * lib/reporting/query-builder.ts
 *
 * Transforms a ReportDefinitionRow (template_type + parameters) into a
 * fully parameterised ReportQuery.  This file is the SQL generation core.
 *
 * ─── Security model (blueprint §6) ──────────────────────────────────────────
 *
 * Every tenant-supplied value that touches SQL is handled as follows:
 *
 *   field_key    → validated via validateReportFieldKeys (allowlist), then
 *                  placed as a $N bind parameter in the ->> operator.
 *                  PostgreSQL accepts a text bind param as the JSONB key name.
 *                  No string interpolation.
 *
 *   filter value → always a $N bind parameter. Never interpolated.
 *
 *   sort_field   → validated via validateReportFieldKeys, then $N bind param.
 *
 *   sort_dir     → validated against ['asc','desc'] allowlist. The validated
 *                  value is mapped to the CONSTANT string 'ASC' or 'DESC'
 *                  which is appended to SQL. The user-supplied string is NOT
 *                  appended, even after validation.
 *
 *   template_type → validated against ReportTemplateType before any builder
 *                   is called. Unknown value throws before SQL generation.
 *
 *   bucket       → validated against ['day','week','month','quarter','year'].
 *                  Passed as $N bind param to date_trunc().
 *
 *   filter op    → validated against FilterOperator union. Maps to a hardcoded
 *                  SQL operator constant. Not interpolated from user input.
 *
 * ─── Cross-version coercion (blueprint §2 Q1 corrected) ─────────────────────
 *
 * For any field_key that appears in aggregation or WHERE clauses, we use a
 * LATERAL JOIN to find the correct field_definitions row for each record's
 * pinned schema_version:
 *
 *   LEFT JOIN LATERAL (
 *     SELECT id, default_value, field_type
 *       FROM field_definitions fd
 *      WHERE fd.entity_type_id = $entity_type_id
 *        AND fd.field_key       = $field_key
 *        AND fd.schema_version <= er.schema_version
 *      ORDER BY fd.schema_version DESC
 *      LIMIT 1
 *   ) fd_match ON TRUE
 *
 * Then extract:
 *   CASE
 *     WHEN fd_match.id IS NOT NULL THEN (er.data->>$field_key)::<SQL_TYPE>
 *     ELSE NULL
 *   END
 *
 * Records where the field did not exist at their pinned schema_version produce
 * NULL (not an error).  Retired fields (retired_at IS NOT NULL) do NOT prevent
 * extraction — a record written before retirement still carries the field data.
 */

import type { PoolClient } from 'pg';
import {
  validateReportFieldKeys,
  resolveFieldForReport,
  getFieldSqlType,
} from './field-resolver';
import type {
  ReportDefinitionRow,
  ReportQuery,
  FilterCondition,
  FilterOperator,
  CountByFieldParams,
  SumByFieldParams,
  TimelineParams,
  FieldDistributionParams,
  RecordListParams,
  ReportTemplateType,
} from './types';

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class ValidationError extends Error {
  /** Machine-readable error code so callers can branch on error category. */
  readonly code: 'UNKNOWN_FIELD_KEYS' | 'INVALID_TEMPLATE_TYPE' | 'INVALID_PARAMETER';
  readonly detail: unknown;

  constructor(
    code: ValidationError['code'],
    message: string,
    detail?: unknown
  ) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.detail = detail;
  }
}

export class QueryBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryBuildError';
  }
}

// ---------------------------------------------------------------------------
// Constants / allowlists
// ---------------------------------------------------------------------------

const VALID_TEMPLATE_TYPES = new Set<ReportTemplateType>([
  'count_by_field',
  'sum_by_field',
  'timeline',
  'field_distribution',
  'record_list',
]);

const VALID_BUCKETS = new Set(['day', 'week', 'month', 'quarter', 'year']);

const VALID_SORT_DIRS = new Set(['asc', 'desc']);

/**
 * Maps a validated FilterOperator to a hardcoded SQL fragment.
 * NEVER derive SQL from user input — only these constants reach the query.
 *
 * The 'in' operator is handled specially (= ANY($N::text[])) — see
 * buildFilterClauses for the implementation details.
 *
 * Blueprint §6 S9.
 */
const OPERATOR_SQL: Record<FilterOperator, string> = {
  eq:       '=',
  neq:      '!=',
  gt:       '>',
  gte:      '>=',
  lt:       '<',
  lte:      '<=',
  in:       'IN',       // placeholder; handled specially below
  contains: '@>',
};

// ---------------------------------------------------------------------------
// Helper: param counter
// ---------------------------------------------------------------------------

/**
 * Mutable counter for generating sequential $N placeholders.
 * Start at 1 unless an offset is provided (for filter clauses appended
 * to an existing param list).
 */
function makeParamCounter(start = 1) {
  let n = start;
  return {
    next(): number {
      return n++;
    },
    current(): number {
      return n - 1;
    },
    value(): number {
      return n;
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: LATERAL JOIN fragment for cross-version coercion
// ---------------------------------------------------------------------------

/**
 * Generates the LATERAL JOIN SQL and associated params for extracting a
 * single field_key value from er.data with cross-version coercion.
 *
 * Returns:
 *   lateralSql  — the LEFT JOIN LATERAL (...) fd_match_<alias> ON TRUE clause
 *   extractExpr — the CASE ... END expression that yields the cast value
 *   params      — the two bind params consumed (entityTypeId, fieldKey)
 *   aliasName   — the lateral alias used, so the caller can reference it
 *
 * Parameters:
 *   entityTypeParamIdx — $N already in the query pointing to entity_type_id
 *   fieldKeyParamIdx   — new $N for the field_key bind value
 *   sqlType            — Postgres cast target from getFieldSqlType()
 *   dataParamIdx       — $N for data->>$N (usually same as fieldKeyParamIdx,
 *                        but must be separately listed in params)
 *   lateralAlias       — unique alias for this lateral subquery
 */
interface LateralFragment {
  lateralSql: string;
  extractExpr: string;
}

function buildLateralFragment(
  entityTypeParamIdx: number,
  fieldKeyParamIdx: number,
  dataExtractParamIdx: number,
  sqlType: string,
  lateralAlias: string
): LateralFragment {
  const lateralSql = `
  LEFT JOIN LATERAL (
    SELECT id, default_value, field_type
      FROM field_definitions fd
     WHERE fd.entity_type_id = $${entityTypeParamIdx}
       AND fd.field_key       = $${fieldKeyParamIdx}
       AND fd.schema_version <= er.schema_version
     ORDER BY fd.schema_version DESC
     LIMIT 1
  ) ${lateralAlias} ON TRUE`;

  const extractExpr = `
  CASE
    WHEN ${lateralAlias}.id IS NOT NULL
      THEN (er.data->>$${dataExtractParamIdx})::${sqlType}
    ELSE NULL
  END`;

  return { lateralSql, extractExpr };
}

// ---------------------------------------------------------------------------
// buildFilterClauses (exported for testing; called by each builder)
// ---------------------------------------------------------------------------

export interface FilterClauseResult {
  sql: string;
  params: unknown[];
}

/**
 * Converts an array of FilterCondition into a SQL WHERE fragment with $N
 * bind parameters, starting numbering at startParamIndex.
 *
 * Returns:
 *   sql    — zero or more AND-joined conditions (empty string when no filters)
 *   params — the bind values consumed, in order
 *
 * Security (blueprint §6 S2, S9):
 *   - Filter values → $N bind params. Never interpolated.
 *   - Operators     → mapped to hardcoded SQL constants. Never interpolated.
 *   - field_keys    → must already be validated by the caller before this
 *                     function is invoked. They are placed as $N bind params
 *                     in the ->> operator (data->>$N).
 *
 * The 'in' operator uses = ANY($N::text[]) instead of IN ($values) because
 * node-postgres cannot bind a JS array as multiple positional params in an
 * IN list. Passing the array as a single $N with ::text[] cast works
 * correctly and avoids injection (blueprint §6 / implementation req #3).
 *
 * NOTE: This function does NOT perform field_key validation itself — the
 * caller (buildReportQuery / individual builders) must have already called
 * validateReportFieldKeys and must pass only valid field_keys here.
 * The field_key is still placed as a bind param (not interpolated) for
 * defence-in-depth.
 */
export function buildFilterClauses(
  filters: FilterCondition[],
  startParamIndex: number
): FilterClauseResult {
  if (filters.length === 0) {
    return { sql: '', params: [] };
  }

  const parts: string[] = [];
  const params: unknown[] = [];
  let idx = startParamIndex;

  for (const filter of filters) {
    const fieldKeyIdx = idx++;
    params.push(filter.field_key); // field_key as bind param for ->>

    if (filter.operator === 'in') {
      // = ANY($N::text[])  — node-postgres sends a JS array as a Postgres array.
      const valueIdx = idx++;
      // Ensure the value is an array; coerce to string array for safety.
      const valueArray = Array.isArray(filter.value)
        ? filter.value
        : [filter.value];
      params.push(valueArray);
      parts.push(
        `(er.data->>$${fieldKeyIdx}) = ANY($${valueIdx}::text[])`
      );
    } else if (filter.operator === 'contains') {
      // JSONB @> operator — for sub-document containment.
      // Value must be a valid JSONB expression.
      const valueIdx = idx++;
      params.push(
        typeof filter.value === 'string'
          ? filter.value
          : JSON.stringify(filter.value)
      );
      parts.push(`er.data @> $${valueIdx}::jsonb`);
    } else {
      // eq, neq, gt, gte, lt, lte — all use text extraction and comparison.
      // The SQL operator comes from the hardcoded OPERATOR_SQL map.
      const sqlOp = OPERATOR_SQL[filter.operator]; // hardcoded constant
      const valueIdx = idx++;
      params.push(filter.value);
      parts.push(
        `(er.data->>$${fieldKeyIdx}) ${sqlOp} $${valueIdx}`
      );
    }
  }

  return {
    sql: parts.map((p) => `AND ${p}`).join('\n      '),
    params,
  };
}

// ---------------------------------------------------------------------------
// Internal builders
// ---------------------------------------------------------------------------

/**
 * count_by_field
 *
 * SELECT
 *   CASE WHEN fd_match.id IS NOT NULL THEN (er.data->>$group_field)::TEXT ELSE NULL END AS group_key,
 *   COUNT(*) AS count
 * FROM entity_records er
 * LEFT JOIN LATERAL (...) fd_match ON TRUE
 * WHERE er.tenant_id = current_tenant_id()
 *   AND er.entity_type_id = $entity_type_id
 *   [AND filters...]
 * GROUP BY group_key
 * ORDER BY count DESC
 *
 * Blueprint §4.1 — includes cross-version LATERAL JOIN.
 */
async function buildCountByField(
  client: PoolClient,
  entityTypeId: string,
  params: CountByFieldParams
): Promise<ReportQuery> {
  const fieldKey = params.group_field;
  const filters = params.filters ?? [];

  // Resolve the field type for the correct SQL cast.
  const resolved = await resolveFieldForReport(client, entityTypeId, fieldKey);
  if (!resolved.exists) {
    throw new ValidationError(
      'UNKNOWN_FIELD_KEYS',
      `Field key "${fieldKey}" does not exist for this entity type.`,
      { invalid: [fieldKey] }
    );
  }
  const sqlType = getFieldSqlType(resolved.field_type);

  // Build param list:
  //   $1 = entityTypeId  (WHERE entity_type_id)
  //   $2 = entityTypeId  (LATERAL JOIN entity_type_id)
  //   $3 = fieldKey      (LATERAL JOIN field_key)
  //   $4 = fieldKey      (data->>$4 in SELECT + GROUP BY)
  //   $5+ = filter params
  const queryParams: unknown[] = [
    entityTypeId, // $1 — base WHERE
    entityTypeId, // $2 — LATERAL entity_type_id
    fieldKey,     // $3 — LATERAL field_key
    fieldKey,     // $4 — data->> extraction
  ];

  const { lateralSql, extractExpr } = buildLateralFragment(
    2, // entityTypeParamIdx
    3, // fieldKeyParamIdx
    4, // dataExtractParamIdx
    sqlType,
    'fd_match'
  );

  const filterClauseStartIdx = queryParams.length + 1; // = 5
  const { sql: filterSql, params: filterParams } = buildFilterClauses(
    filters,
    filterClauseStartIdx
  );
  queryParams.push(...filterParams);

  const sql = `
SELECT
  ${extractExpr.trim()} AS group_key,
  COUNT(*) AS count
FROM entity_records er
${lateralSql.trim()}
WHERE er.tenant_id = current_tenant_id()
  AND er.entity_type_id = $1
  ${filterSql}
GROUP BY group_key
ORDER BY count DESC
`.trim();

  return {
    sql,
    params: queryParams,
    resultShape: {
      columns: [
        { name: 'group_key', type: sqlType },
        { name: 'count', type: 'BIGINT' },
      ],
    },
  };
}

// ---------------------------------------------------------------------------

/**
 * sum_by_field
 *
 * SUM of a NUMERIC field, optionally grouped by a second field.
 *
 * When group_field is supplied:
 *   SELECT <group_expr> AS group_key, SUM(<sum_expr>) AS total
 *   FROM entity_records er
 *   LEFT JOIN LATERAL (...fd_match for sum_field...) ON TRUE
 *   LEFT JOIN LATERAL (...fd_match_group for group_field...) ON TRUE
 *   WHERE ...
 *   GROUP BY group_key ORDER BY total DESC
 *
 * When group_field is absent:
 *   SELECT SUM(<sum_expr>) AS total
 *   FROM entity_records er
 *   LEFT JOIN LATERAL (...) ON TRUE
 *   WHERE ...
 */
async function buildSumByField(
  client: PoolClient,
  entityTypeId: string,
  params: SumByFieldParams
): Promise<ReportQuery> {
  const sumField = params.sum_field;
  const groupField = params.group_field ?? null;
  const filters = params.filters ?? [];

  // Resolve sum field type — must be numeric.
  const resolvedSum = await resolveFieldForReport(client, entityTypeId, sumField);
  if (!resolvedSum.exists) {
    throw new ValidationError(
      'UNKNOWN_FIELD_KEYS',
      `Sum field "${sumField}" does not exist for this entity type.`,
      { invalid: [sumField] }
    );
  }
  const sumSqlType = getFieldSqlType(resolvedSum.field_type); // e.g. NUMERIC

  // Params:
  //   $1 = entityTypeId (WHERE)
  //   $2 = entityTypeId (LATERAL for sum field)
  //   $3 = sumField (LATERAL key)
  //   $4 = sumField (data->>)
  const queryParams: unknown[] = [
    entityTypeId, // $1
    entityTypeId, // $2 LATERAL sum
    sumField,     // $3
    sumField,     // $4
  ];

  const { lateralSql: sumLateral, extractExpr: sumExtract } = buildLateralFragment(
    2, 3, 4, sumSqlType, 'fd_sum'
  );

  let groupLateral = '';
  let groupExtract = '';
  let groupSelectClause = '';
  let groupByClause = '';

  if (groupField !== null) {
    const resolvedGroup = await resolveFieldForReport(client, entityTypeId, groupField);
    if (!resolvedGroup.exists) {
      throw new ValidationError(
        'UNKNOWN_FIELD_KEYS',
        `Group field "${groupField}" does not exist for this entity type.`,
        { invalid: [groupField] }
      );
    }
    const groupSqlType = getFieldSqlType(resolvedGroup.field_type);

    // $5 = entityTypeId (LATERAL for group field)
    // $6 = groupField (LATERAL key)
    // $7 = groupField (data->>)
    queryParams.push(entityTypeId, groupField, groupField); // $5, $6, $7

    const groupFrag = buildLateralFragment(5, 6, 7, groupSqlType, 'fd_group');
    groupLateral = groupFrag.lateralSql;
    groupExtract = groupFrag.extractExpr;

    groupSelectClause = `  ${groupExtract.trim()} AS group_key,`;
    groupByClause = 'GROUP BY group_key\n  ORDER BY total DESC';
  }

  const filterClauseStartIdx = queryParams.length + 1;
  const { sql: filterSql, params: filterParams } = buildFilterClauses(
    filters,
    filterClauseStartIdx
  );
  queryParams.push(...filterParams);

  const sql = `
SELECT
  ${groupSelectClause}
  SUM(${sumExtract.trim()}) AS total
FROM entity_records er
${sumLateral.trim()}
${groupLateral.trim()}
WHERE er.tenant_id = current_tenant_id()
  AND er.entity_type_id = $1
  ${filterSql}
${groupByClause}
`.trim();

  const columns = groupField !== null
    ? [
        { name: 'group_key', type: 'TEXT' },
        { name: 'total', type: sumSqlType },
      ]
    : [{ name: 'total', type: sumSqlType }];

  return { sql, params: queryParams, resultShape: { columns } };
}

// ---------------------------------------------------------------------------

/**
 * timeline
 *
 * SELECT date_trunc($bucket, <date_extract>) AS bucket,
 *        COUNT(*)                             AS count,
 *        [SUM(<value_extract>)                AS total]   -- if value_field
 * FROM entity_records er
 * LEFT JOIN LATERAL (...date_field...) ON TRUE
 * [LEFT JOIN LATERAL (...value_field...) ON TRUE]
 * WHERE ...
 * GROUP BY bucket
 * ORDER BY bucket ASC
 *
 * Blueprint §6 S7: bucket is validated against allowlist and passed as a
 * bind param to date_trunc() — never interpolated.
 */
async function buildTimeline(
  client: PoolClient,
  entityTypeId: string,
  params: TimelineParams
): Promise<ReportQuery> {
  const dateField  = params.date_field;
  const bucket     = params.bucket;
  const valueField = params.value_field ?? null;
  const filters    = params.filters ?? [];

  // Validate bucket against allowlist (blueprint §6 S7).
  if (!VALID_BUCKETS.has(bucket)) {
    throw new ValidationError(
      'INVALID_PARAMETER',
      `Invalid bucket "${bucket}". Must be one of: day, week, month, quarter, year.`
    );
  }

  // Resolve date field type.
  const resolvedDate = await resolveFieldForReport(client, entityTypeId, dateField);
  if (!resolvedDate.exists) {
    throw new ValidationError(
      'UNKNOWN_FIELD_KEYS',
      `Date field "${dateField}" does not exist for this entity type.`,
      { invalid: [dateField] }
    );
  }
  const dateSqlType = getFieldSqlType(resolvedDate.field_type); // typically TIMESTAMPTZ or DATE

  // $1 = entityTypeId (WHERE)
  // $2 = bucket (date_trunc)
  // $3 = entityTypeId (LATERAL date)
  // $4 = dateField (LATERAL key)
  // $5 = dateField (data->>)
  const queryParams: unknown[] = [
    entityTypeId, // $1
    bucket,       // $2
    entityTypeId, // $3
    dateField,    // $4
    dateField,    // $5
  ];

  const { lateralSql: dateLateral, extractExpr: dateExtract } = buildLateralFragment(
    3, 4, 5, dateSqlType, 'fd_date'
  );

  let valueLateral = '';
  let valueSelectClause = '';
  let resolvedValueType = 'NUMERIC';

  if (valueField !== null) {
    const resolvedValue = await resolveFieldForReport(client, entityTypeId, valueField);
    if (!resolvedValue.exists) {
      throw new ValidationError(
        'UNKNOWN_FIELD_KEYS',
        `Value field "${valueField}" does not exist for this entity type.`,
        { invalid: [valueField] }
      );
    }
    resolvedValueType = getFieldSqlType(resolvedValue.field_type);

    // $6 = entityTypeId (LATERAL value)
    // $7 = valueField (LATERAL key)
    // $8 = valueField (data->>)
    queryParams.push(entityTypeId, valueField, valueField); // $6, $7, $8

    const valueFrag = buildLateralFragment(6, 7, 8, resolvedValueType, 'fd_value');
    valueLateral = valueFrag.lateralSql;
    valueSelectClause = `  SUM(${valueFrag.extractExpr.trim()}) AS total,`;
  }

  const filterClauseStartIdx = queryParams.length + 1;
  const { sql: filterSql, params: filterParams } = buildFilterClauses(
    filters,
    filterClauseStartIdx
  );
  queryParams.push(...filterParams);

  const sql = `
SELECT
  date_trunc($2, ${dateExtract.trim()}) AS bucket,
  COUNT(*) AS count,
  ${valueSelectClause}
FROM entity_records er
${dateLateral.trim()}
${valueLateral.trim()}
WHERE er.tenant_id = current_tenant_id()
  AND er.entity_type_id = $1
  ${filterSql}
GROUP BY bucket
ORDER BY bucket ASC
`.trim();

  const columns = [
    { name: 'bucket', type: 'TIMESTAMPTZ' },
    { name: 'count', type: 'BIGINT' },
    ...(valueField !== null ? [{ name: 'total', type: resolvedValueType }] : []),
  ];

  return { sql, params: queryParams, resultShape: { columns } };
}

// ---------------------------------------------------------------------------

/**
 * field_distribution
 *
 * SELECT <extract_expr> AS value, COUNT(*) AS count
 * FROM entity_records er
 * LEFT JOIN LATERAL (...) fd_match ON TRUE
 * WHERE ...
 * GROUP BY value
 * ORDER BY count DESC
 */
async function buildFieldDistribution(
  client: PoolClient,
  entityTypeId: string,
  params: FieldDistributionParams
): Promise<ReportQuery> {
  const targetField = params.target_field;
  const filters = params.filters ?? [];

  const resolved = await resolveFieldForReport(client, entityTypeId, targetField);
  if (!resolved.exists) {
    throw new ValidationError(
      'UNKNOWN_FIELD_KEYS',
      `Target field "${targetField}" does not exist for this entity type.`,
      { invalid: [targetField] }
    );
  }
  const sqlType = getFieldSqlType(resolved.field_type);

  // $1 = entityTypeId (WHERE)
  // $2 = entityTypeId (LATERAL)
  // $3 = targetField  (LATERAL key)
  // $4 = targetField  (data->>)
  const queryParams: unknown[] = [
    entityTypeId,
    entityTypeId,
    targetField,
    targetField,
  ];

  const { lateralSql, extractExpr } = buildLateralFragment(2, 3, 4, sqlType, 'fd_match');

  const filterClauseStartIdx = queryParams.length + 1;
  const { sql: filterSql, params: filterParams } = buildFilterClauses(
    filters,
    filterClauseStartIdx
  );
  queryParams.push(...filterParams);

  const sql = `
SELECT
  ${extractExpr.trim()} AS value,
  COUNT(*) AS count
FROM entity_records er
${lateralSql.trim()}
WHERE er.tenant_id = current_tenant_id()
  AND er.entity_type_id = $1
  ${filterSql}
GROUP BY value
ORDER BY count DESC
`.trim();

  return {
    sql,
    params: queryParams,
    resultShape: {
      columns: [
        { name: 'value', type: sqlType },
        { name: 'count', type: 'BIGINT' },
      ],
    },
  };
}

// ---------------------------------------------------------------------------

/**
 * record_list
 *
 * SELECT
 *   er.id,
 *   er.created_at,
 *   er.schema_version,
 *   <field1_extract> AS field1,
 *   <field2_extract> AS field2,
 *   ...
 * FROM entity_records er
 * LEFT JOIN LATERAL (...fd_match for field1...) ON TRUE
 * LEFT JOIN LATERAL (...fd_match for field2...) ON TRUE
 * WHERE er.tenant_id = current_tenant_id()
 *   AND er.entity_type_id = $1
 *   [AND filters...]
 * ORDER BY <sort_expr> ASC/DESC    -- sort_dir is a hardcoded constant
 * LIMIT $N OFFSET $M
 *
 * Security (blueprint §6 S6, S8):
 *   sort_field → validated via validateReportFieldKeys, passed as $N bind param.
 *   sort_dir   → validated against ['asc','desc'] allowlist. The CONSTANT
 *                string 'ASC' or 'DESC' is appended — not the user input.
 */
async function buildRecordList(
  client: PoolClient,
  entityTypeId: string,
  params: RecordListParams
): Promise<ReportQuery> {
  const fields    = params.fields;
  const filters   = params.filters ?? [];
  const sortField = params.sort_field ?? null;
  const rawSortDir = params.sort_dir ?? 'asc';
  const limit     = params.limit  ?? 50;
  const offset    = params.offset ?? 0;

  // Validate sort_dir against allowlist (blueprint §6 S8).
  if (!VALID_SORT_DIRS.has(rawSortDir)) {
    throw new ValidationError(
      'INVALID_PARAMETER',
      `Invalid sort_dir "${rawSortDir}". Must be 'asc' or 'desc'.`
    );
  }
  // Map validated input to hardcoded SQL constant — never append user string.
  const SORT_DIR_CONSTANT = rawSortDir === 'desc' ? 'DESC' : 'ASC';

  if (fields.length === 0) {
    throw new ValidationError(
      'INVALID_PARAMETER',
      'record_list requires at least one field in params.fields.'
    );
  }

  // $1 = entityTypeId (WHERE)
  const queryParams: unknown[] = [entityTypeId];

  const laterals: string[] = [];
  const fieldSelects: string[] = [];
  const resultColumns: { name: string; type: string }[] = [
    { name: 'id', type: 'UUID' },
    { name: 'created_at', type: 'TIMESTAMPTZ' },
    { name: 'schema_version', type: 'INTEGER' },
  ];

  // For each requested field, build a LATERAL JOIN + CASE extract.
  for (let i = 0; i < fields.length; i++) {
    const fk = fields[i];
    const resolved = await resolveFieldForReport(client, entityTypeId, fk);
    if (!resolved.exists) {
      throw new ValidationError(
        'UNKNOWN_FIELD_KEYS',
        `Field "${fk}" does not exist for this entity type.`,
        { invalid: [fk] }
      );
    }
    const sqlType = getFieldSqlType(resolved.field_type);
    const alias = `fd_f${i}`;

    // Three params per field: entityTypeId, fieldKey (LATERAL), fieldKey (data->>)
    const entityTypeParamIdx = queryParams.length + 1;
    const fieldKeyParamIdx   = queryParams.length + 2;
    const dataExtractIdx     = queryParams.length + 3;
    queryParams.push(entityTypeId, fk, fk);

    const { lateralSql, extractExpr } = buildLateralFragment(
      entityTypeParamIdx,
      fieldKeyParamIdx,
      dataExtractIdx,
      sqlType,
      alias
    );

    laterals.push(lateralSql.trim());
    // Use a safe alias derived from the array index, not from the field_key string.
    // The field_key appears only as a bind param.
    fieldSelects.push(`  ${extractExpr.trim()} AS field_${i}`);
    resultColumns.push({ name: `field_${i}`, type: sqlType });
  }

  // Filters
  const filterClauseStartIdx = queryParams.length + 1;
  const { sql: filterSql, params: filterParams } = buildFilterClauses(
    filters,
    filterClauseStartIdx
  );
  queryParams.push(...filterParams);

  // Sort expression
  let orderClause: string;

  if (sortField !== null) {
    // sort_field already validated by validateReportFieldKeys in buildReportQuery.
    // Resolve its type for the correct cast.
    const resolvedSort = await resolveFieldForReport(client, entityTypeId, sortField);
    if (!resolvedSort.exists) {
      throw new ValidationError(
        'UNKNOWN_FIELD_KEYS',
        `Sort field "${sortField}" does not exist for this entity type.`,
        { invalid: [sortField] }
      );
    }
    const sortSqlType = getFieldSqlType(resolvedSort.field_type);
    const alias = 'fd_sort';

    const entityTypeParamIdx = queryParams.length + 1;
    const fieldKeyParamIdx   = queryParams.length + 2;
    const dataExtractIdx     = queryParams.length + 3;
    queryParams.push(entityTypeId, sortField, sortField);

    const { lateralSql: sortLateral, extractExpr: sortExtract } = buildLateralFragment(
      entityTypeParamIdx,
      fieldKeyParamIdx,
      dataExtractIdx,
      sortSqlType,
      alias
    );

    laterals.push(sortLateral.trim());
    // SORT_DIR_CONSTANT is 'ASC' or 'DESC' — a hardcoded string, not user input.
    orderClause = `ORDER BY ${sortExtract.trim()} ${SORT_DIR_CONSTANT} NULLS LAST`;
  } else {
    orderClause = `ORDER BY er.created_at ${SORT_DIR_CONSTANT}`;
  }

  // Limit / offset as bind params.
  const limitIdx  = queryParams.length + 1;
  const offsetIdx = queryParams.length + 2;
  queryParams.push(limit, offset);

  const sql = `
SELECT
  er.id,
  er.created_at,
  er.schema_version,
${fieldSelects.join(',\n')}
FROM entity_records er
${laterals.join('\n')}
WHERE er.tenant_id = current_tenant_id()
  AND er.entity_type_id = $1
  ${filterSql}
${orderClause}
LIMIT $${limitIdx}
OFFSET $${offsetIdx}
`.trim();

  return { sql, params: queryParams, resultShape: { columns: resultColumns } };
}

// ---------------------------------------------------------------------------
// Public: buildReportQuery
// ---------------------------------------------------------------------------

/**
 * Dispatcher: reads definition.template_type, validates all field_keys
 * referenced in parameters, then calls the appropriate builder.
 *
 * THROWS ValidationError (code: 'INVALID_TEMPLATE_TYPE') for unknown template types.
 * THROWS ValidationError (code: 'UNKNOWN_FIELD_KEYS') if any referenced field_key
 *        is not found in field_definitions for the target entity type.
 *
 * These typed errors allow the executor to return HTTP 400 (validation failure)
 * rather than HTTP 500 (query failure).
 *
 * The function receives an already-open PoolClient with tenant context set.
 * It does NOT call withTenantContext.
 */
export async function buildReportQuery(
  client: PoolClient,
  definition: ReportDefinitionRow
): Promise<ReportQuery> {
  const { template_type, entity_type_id, parameters } = definition;

  // ── 1. Validate template_type against the hardcoded set ──────────────────
  if (!VALID_TEMPLATE_TYPES.has(template_type)) {
    throw new ValidationError(
      'INVALID_TEMPLATE_TYPE',
      `Unknown template_type "${template_type}". ` +
        `Valid types: ${[...VALID_TEMPLATE_TYPES].join(', ')}.`
    );
  }

  // ── 2. Extract all field_keys referenced in parameters ───────────────────
  //    We collect them here so a single validateReportFieldKeys call covers
  //    all keys, providing one clear error listing all unknowns at once.
  const referencedFieldKeys = extractReferencedFieldKeys(template_type, parameters);

  if (referencedFieldKeys.length > 0) {
    const { invalid } = await validateReportFieldKeys(
      client,
      entity_type_id,
      referencedFieldKeys
    );

    if (invalid.length > 0) {
      throw new ValidationError(
        'UNKNOWN_FIELD_KEYS',
        `Report references unknown field key(s) for entity type "${entity_type_id}": ` +
          invalid.map((k) => `"${k}"`).join(', ') +
          '. Ensure all field_keys exist in field_definitions before saving a report.',
        { invalid }
      );
    }
  }

  // ── 3. Dispatch to the appropriate builder ────────────────────────────────
  switch (template_type) {
    case 'count_by_field':
      return buildCountByField(
        client,
        entity_type_id,
        parameters as unknown as CountByFieldParams
      );

    case 'sum_by_field':
      return buildSumByField(
        client,
        entity_type_id,
        parameters as unknown as SumByFieldParams
      );

    case 'timeline':
      return buildTimeline(
        client,
        entity_type_id,
        parameters as unknown as TimelineParams
      );

    case 'field_distribution':
      return buildFieldDistribution(
        client,
        entity_type_id,
        parameters as unknown as FieldDistributionParams
      );

    case 'record_list':
      return buildRecordList(
        client,
        entity_type_id,
        parameters as unknown as RecordListParams
      );

    default: {
      // TypeScript exhaustiveness guard — should never reach here because
      // VALID_TEMPLATE_TYPES check above already threw for unknown values.
      const _exhaustive: never = template_type;
      throw new QueryBuildError(
        `Unhandled template_type: ${_exhaustive}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: extract all field_keys referenced in parameters
// ---------------------------------------------------------------------------

/**
 * Extracts every field_key string referenced in a template's parameters JSONB
 * so that they can be batch-validated before SQL generation.
 *
 * This function is the single place that knows which parameter keys carry
 * field_key values for each template type.  It must be updated whenever a
 * new template type is added.
 */
function extractReferencedFieldKeys(
  templateType: ReportTemplateType,
  parameters: Record<string, unknown>
): string[] {
  const keys: string[] = [];

  const addIfString = (v: unknown) => {
    if (typeof v === 'string' && v.length > 0) keys.push(v);
  };

  const addFiltersKeys = (filters: unknown) => {
    if (!Array.isArray(filters)) return;
    for (const f of filters) {
      if (f && typeof f === 'object' && 'field_key' in f) {
        addIfString((f as FilterCondition).field_key);
      }
    }
  };

  switch (templateType) {
    case 'count_by_field':
      addIfString(parameters.group_field);
      addFiltersKeys(parameters.filters);
      break;

    case 'sum_by_field':
      addIfString(parameters.sum_field);
      addIfString(parameters.group_field);
      addFiltersKeys(parameters.filters);
      break;

    case 'timeline':
      addIfString(parameters.date_field);
      addIfString(parameters.value_field);
      addFiltersKeys(parameters.filters);
      break;

    case 'field_distribution':
      addIfString(parameters.target_field);
      addFiltersKeys(parameters.filters);
      break;

    case 'record_list': {
      const fields = parameters.fields;
      if (Array.isArray(fields)) fields.forEach(addIfString);
      addIfString(parameters.sort_field);
      addFiltersKeys(parameters.filters);
      break;
    }
  }

  return [...new Set(keys)]; // de-duplicate
}
