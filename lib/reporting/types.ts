export type ReportTemplateType =
  | 'count_by_field'
  | 'sum_by_field'
  | 'timeline'
  | 'field_distribution'
  | 'record_list';

export interface ReportDefinitionRow {
  tenant_id: string;
  id: string;
  name: string;
  description: string;
  entity_type_id: string;
  template_type: ReportTemplateType;
  parameters: Record<string, unknown>;
  is_active: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ReportCacheRow {
  tenant_id: string;
  id: string;
  report_definition_id: string;
  result: unknown;
  row_count: number;
  computed_at: Date;
  ttl_seconds: number;
  is_stale: boolean;
  computed_by: string | null;
}

export interface ResultShapeDescriptor {
  columns: { name: string; type: string }[];
}

export interface ReportQuery {
  sql: string;
  params: unknown[];
  resultShape: ResultShapeDescriptor;
}

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'contains';

export interface FilterCondition {
  field_key: string;
  operator: FilterOperator;
  value: unknown;
}

export interface ReportMetadata {
  report_definition_id: string;
  template_type: ReportTemplateType;
  entity_type_id: string;
  computed_at: string;
  from_cache: boolean;
  row_count: number;
  is_stale: boolean;
}

export interface ReportResult {
  data: Record<string, unknown>[];
  metadata: ReportMetadata;
}

export interface AdHocReportParams {
  entity_type_id: string;
  template_type: ReportTemplateType;
  parameters: Record<string, unknown>;
}

export interface CountByFieldParams {
  group_field: string;
  filters?: FilterCondition[];
}

export interface SumByFieldParams {
  sum_field: string;
  group_field?: string;
  filters?: FilterCondition[];
}

export interface TimelineParams {
  date_field: string;
  bucket: 'day' | 'week' | 'month' | 'quarter' | 'year';
  value_field?: string;
  filters?: FilterCondition[];
}

export interface FieldDistributionParams {
  target_field: string;
  filters?: FilterCondition[];
}

export interface RecordListParams {
  fields: string[];
  filters?: FilterCondition[];
  sort_field?: string;
  sort_dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}
