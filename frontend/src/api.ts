import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
  withCredentials: true,
  xsrfCookieName: "csrftoken",
  xsrfHeaderName: "X-CSRFToken",
});

export default api;

export interface Organization { id: string; name: string; slug: string; }
export interface User {
  id: number; username: string; email: string;
  organization: Organization | null; role: string | null;
}
export interface DataSource {
  id: string; source_type: "SAP" | "UTILITY" | "TRAVEL";
  name: string; description: string; is_active: boolean; created_at: string;
}
export interface ValidationIssue {
  id: string; severity: "error" | "warning" | "info";
  code: string; message: string; source_row_number: number | null;
}
export interface IngestionBatch {
  id: string; data_source: string; data_source_name: string; source_type: string;
  uploaded_by_username: string | null; original_filename: string; uploaded_at: string;
  status: string; row_count: number; accepted_count: number;
  rejected_count: number; warning_count: number; processing_log: string;
  issues: ValidationIssue[];
}
export interface ActivityRecord {
  id: string; scope: number; scope_display: string; category: string;
  category_display: string; period_start: string; period_end: string;
  facility_name: string; facility_code: string; country_code: string;
  raw_quantity: string; raw_unit: string;
  normalized_quantity: string; normalized_unit: string;
  co2e_kg: string | null; co2e_factor: string | null;
  co2e_factor_unit: string; co2e_factor_source: string;
  status: "pending_review" | "approved" | "rejected" | "flagged_suspicious";
  status_display: string; reviewed_by_username: string | null;
  reviewed_at: string | null; review_notes: string;
  supplier_vendor: string; description: string;
  batch: string; batch_filename: string; source_type: string;
  is_edited: boolean; created_at: string; issue_count: number;
  source_row?: Record<string, string>;
  extra_data?: Record<string, unknown>;
  issues?: ValidationIssue[];
  audit_log?: AuditLogEntry[];
  source_row_number?: number;
}
export interface AuditLogEntry {
  id: string; action: string; performed_by_username: string | null;
  performed_at: string; old_values: Record<string, unknown>;
  new_values: Record<string, unknown>; notes: string;
}
export interface DashboardStats {
  total_records: number; pending_review: number;
  approved: number; rejected: number; flagged: number;
  total_co2e_kg: number; approved_co2e_kg: number;
  scope_breakdown: Record<string, number>;
  scope_co2e: Record<string, number>;
  source_breakdown: Record<string, number>;
  source_co2e: Record<string, number>;
  recent_batches: IngestionBatch[];
}
export interface PaginatedResponse<T> {
  count: number; next: string | null; previous: string | null; results: T[];
}
