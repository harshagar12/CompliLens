export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface ExtractedField {
  field_name: string;
  raw_value: string;
  suggested_value?: string | null;
  suggestion_source?: string | null;
  confirmed_value?: string | null;
  reviewer_action?: "accepted_raw" | "accepted_suggestion" | "manual_edit" | null;
  confidence: number;
  bounding_box: [number, number, number, number];
  ocr_source: string;
  evidence_crop_url?: string;
}

export interface Evaluation {
  evaluation_id?: string;
  field_name: string;
  rule_id: string;
  rule_version: number;
  result: "PASS" | "FAIL" | "NEEDS_REVIEW";
  extracted_value?: string | null;
  confidence: number;
  evidence_crop_url: string;
  notes?: string | null;
}

export interface PackageVerdict {
  package_id: string;
  category: string;
  evaluations: Evaluation[];
  overall_result: "PASS" | "FAIL" | "NEEDS_REVIEW";
  exemption_applied?: string | null;
  evaluated_at: string;
}

export interface Rule {
  rule_id: string;
  description: string;
  source_citation: string;
  applicable_category: string[];
  excluded_category: string[];
  required_field: string;
  severity: "FAIL" | "WARN" | "NEEDS_REVIEW";
  version: number;
  verification_status: string;
  project_scope: string;
}

export async function uploadPackage(file: File, category: string = "packaged_food") {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("category", category);

  const res = await fetch(`${API_BASE_URL}/api/packages`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(err.detail || "Failed to upload package");
  }
  return res.json();
}

// =============================================================================
// PRD §8.2 & §8.5 Product History & Manufacturer Dashboards API
// =============================================================================

export interface ProductListItem {
  product_key: string;
  common_name: string;
  manufacturer_name: string;
  manufacturer_key: string;
  net_quantity?: string | null;
  total_inspections: number;
  latest_verdict: "PASS" | "FAIL" | "NEEDS_REVIEW";
  fail_rate: number;
  trend: "IMPROVING" | "DEGRADING" | "STABLE" | "INSUFFICIENT_DATA";
  has_active_regression: boolean;
  last_tested_at?: string | null;
}

export interface ProductHistoryEntry {
  package_id: string;
  tested_at: string;
  overall_result: "PASS" | "FAIL" | "NEEDS_REVIEW";
  fail_count: number;
  changed_fields_since_last: string[];
  is_regression: boolean;
  regression_details: string[];
  mfg_date?: string | null;
  mrp?: string | null;
  net_quantity?: string | null;
  image_url: string;
}

export interface ProductHistory {
  product_key: string;
  product_name: string;
  manufacturer_name: string;
  manufacturer_key: string;
  net_quantity?: string | null;
  entries: ProductHistoryEntry[];
  trend: "IMPROVING" | "DEGRADING" | "STABLE" | "INSUFFICIENT_DATA";
  total_inspections: number;
  fail_rate: number;
  has_active_regression: boolean;
}

export interface StatutoryViolationItem {
  rule_id: string;
  description: string;
  citation: string;
  fail_count: number;
  percentage: number;
}

export interface ManufacturerListItem {
  manufacturer_key: string;
  manufacturer_name: string;
  product_count: number;
  total_inspections: number;
  fail_rate: number;
  compliance_score: number;
  risk_level: "LOW" | "MEDIUM" | "HIGH";
  active_regressions_count: number;
}

export interface ManufacturerSummary {
  manufacturer_key: string;
  manufacturer_name: string;
  raw_name_address?: string | null;
  product_count: number;
  total_inspections: number;
  fail_rate: number;
  compliance_score: number;
  risk_level: "LOW" | "MEDIUM" | "HIGH";
  products_with_active_regression: string[];
  statutory_violations_breakdown: StatutoryViolationItem[];
  products: ProductListItem[];
}

export async function listProducts(search?: string): Promise<ProductListItem[]> {
  const url = search ? `${API_BASE_URL}/api/products?search=${encodeURIComponent(search)}` : `${API_BASE_URL}/api/products`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Failed to list products");
  }
  return res.json();
}

export async function getProductHistory(productKey: string): Promise<ProductHistory> {
  const res = await fetch(`${API_BASE_URL}/api/products/${encodeURIComponent(productKey)}/history`);
  if (!res.ok) {
    throw new Error(`Failed to get history for product ${productKey}`);
  }
  return res.json();
}

export async function listManufacturers(search?: string): Promise<ManufacturerListItem[]> {
  const url = search ? `${API_BASE_URL}/api/manufacturers?search=${encodeURIComponent(search)}` : `${API_BASE_URL}/api/manufacturers`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Failed to list manufacturers");
  }
  return res.json();
}

export async function getManufacturerSummary(manufacturerKey: string): Promise<ManufacturerSummary> {
  const res = await fetch(`${API_BASE_URL}/api/manufacturers/${encodeURIComponent(manufacturerKey)}/summary`);
  if (!res.ok) {
    throw new Error(`Failed to get summary for manufacturer ${manufacturerKey}`);
  }
  return res.json();
}

export async function extractFields(packageId: string, ocrProvider: string = "rapidocr") {
  const res = await fetch(`${API_BASE_URL}/api/packages/${packageId}/extract?ocr_provider=${ocrProvider}`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Extraction failed" }));
    throw new Error(err.detail || "Failed to extract fields");
  }
  return res.json();
}

export async function confirmFields(
  packageId: string,
  updates: Array<{ field_name: string; confirmed_value: string; reviewer_action: string }>
) {
  const res = await fetch(`${API_BASE_URL}/api/packages/${packageId}/extracted-fields`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Confirmation failed" }));
    throw new Error(err.detail || "Failed to confirm fields");
  }
  return res.json();
}

export async function evaluatePackage(packageId: string): Promise<PackageVerdict> {
  const res = await fetch(`${API_BASE_URL}/api/packages/${packageId}/evaluate`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Evaluation failed" }));
    throw new Error(err.detail || "Failed to evaluate package");
  }
  return res.json();
}

export async function getPackageDetails(packageId: string) {
  const res = await fetch(`${API_BASE_URL}/api/packages/${packageId}`);
  if (!res.ok) {
    throw new Error("Failed to get package details");
  }
  return res.json();
}

export async function listPackages() {
  const res = await fetch(`${API_BASE_URL}/api/packages`);
  if (!res.ok) {
    throw new Error("Failed to list packages");
  }
  return res.json();
}

export async function getReviewQueue() {
  const res = await fetch(`${API_BASE_URL}/api/review-queue`);
  if (!res.ok) {
    throw new Error("Failed to fetch review queue");
  }
  return res.json();
}

export async function submitReviewDecision(
  evaluationId: string,
  decision: { decision: "APPROVE" | "OVERRIDE_PASS" | "OVERRIDE_FAIL"; note?: string; reviewer: string }
) {
  const res = await fetch(`${API_BASE_URL}/api/review-queue/${evaluationId}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(decision),
  });
  if (!res.ok) {
    throw new Error("Failed to submit review decision");
  }
  return res.json();
}

export async function listRules(): Promise<Rule[]> {
  const res = await fetch(`${API_BASE_URL}/api/rules`);
  if (!res.ok) {
    throw new Error("Failed to fetch rules");
  }
  return res.json();
}

export async function compareLabels(packageIdA: string, packageIdB: string) {
  const res = await fetch(`${API_BASE_URL}/api/label-diff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ package_id_a: packageIdA, package_id_b: packageIdB }),
  });
  if (!res.ok) {
    throw new Error("Failed to run label diff");
  }
  return res.json();
}

export async function batchExtractLabels(files: File[]) {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));

  const res = await fetch(`${API_BASE_URL}/api/label-diff/batch-extract`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Batch extraction failed" }));
    throw new Error(err.detail || "Failed to extract package labels");
  }
  return res.json();
}

export async function batchEvaluateLabels(
  packages: Array<{
    package_id: string;
    category?: string;
    fields: Record<string, any>;
    full_text?: string;
    non_statutory?: Record<string, any>;
  }>,
  autoSortByDate: boolean = false
) {
  const res = await fetch(`${API_BASE_URL}/api/label-diff/batch-evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ packages, auto_sort_by_date: autoSortByDate }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Batch evaluation failed" }));
    throw new Error(err.detail || "Failed to evaluate package revisions");
  }
  return res.json();
}

