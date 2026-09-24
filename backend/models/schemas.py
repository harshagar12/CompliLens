from __future__ import annotations
from datetime import date, datetime
from typing import Literal, Any
from pydantic import BaseModel, Field


FieldName = Literal[
    "manufacturer_name_address",
    "common_name",
    "net_quantity",
    "mrp",
    "mfg_month_year",
    "consumer_care"
]

ReviewerAction = Literal["accepted_raw", "accepted_suggestion", "manual_edit"]
Severity = Literal["FAIL", "WARN", "NEEDS_REVIEW"]
VerdictResult = Literal["PASS", "FAIL", "NEEDS_REVIEW"]


class ExtractedField(BaseModel):
    field_name: FieldName
    raw_value: str
    suggested_value: str | None = None
    suggestion_source: str | None = None
    confirmed_value: str | None = None
    reviewer_action: ReviewerAction | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    bounding_box: tuple[int, int, int, int]  # x, y, w, h in source image pixels
    ocr_source: str  # e.g., "paddleocr", "gemini-vision", "doctr"


class RuleCondition(BaseModel):
    op: str
    pattern: str | None = None
    table: str | None = None
    value_cc: float | None = None
    value_g_or_ml: float | None = None
    min: float | None = None
    max: float | None = None
    unit: str | None = None
    categories: list[str] | None = None
    conditions: list[dict[str, Any]] | None = None


class RuleException(BaseModel):
    condition: dict[str, Any]
    modified_requirement: str
    source: str


class Rule(BaseModel):
    rule_id: str
    description: str
    source_citation: str
    applicable_category: list[str] = Field(default_factory=list)
    excluded_category: list[str] = Field(default_factory=list)
    required_field: str
    validation_condition: dict[str, Any]
    severity: Severity = "FAIL"
    exceptions: list[RuleException] = Field(default_factory=list)
    effective_date: str | date
    version: int = 1
    verification_status: Literal["confirmed", "needs_legal_review"] = "confirmed"
    review_note: str | None = None
    project_scope: Literal["mvp", "final_year_target", "advanced"] = "mvp"
    implementation_note: str | None = None


class Evaluation(BaseModel):
    evaluation_id: str | None = None
    field_name: str
    rule_id: str
    rule_version: int
    result: VerdictResult
    extracted_value: str | None = None
    confidence: float
    evidence_crop_url: str = ""
    notes: str | None = None


class Package(BaseModel):
    package_id: str
    category: str = "packaged_food"
    declared_net_quantity: float | None = None  # in g or ml
    declared_net_quantity_unit: str | None = None  # "g", "ml", "kg", "l"
    package_capacity_cc: float | None = None
    image_filename: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PackageVerdict(BaseModel):
    package_id: str
    category: str
    evaluations: list[Evaluation]
    overall_result: VerdictResult
    exemption_applied: str | None = None
    evaluated_at: datetime = Field(default_factory=datetime.utcnow)


class ConfirmedFieldUpdate(BaseModel):
    field_name: FieldName
    confirmed_value: str
    reviewer_action: ReviewerAction


class ReviewerDecisionRequest(BaseModel):
    decision: Literal["APPROVE", "OVERRIDE_PASS", "OVERRIDE_FAIL"]
    note: str | None = None
    reviewer: str


# --- PRD §8.2 & §8.3 Product History Schemas ---

class FailedRuleDetail(BaseModel):
    rule_id: str
    field_name: str
    result: str
    description: str = ""
    citation: str = ""
    notes: str = ""
    extracted_value: str | None = None


class ProductHistoryEntry(BaseModel):
    package_id: str
    tested_at: str
    overall_result: Literal["PASS", "FAIL", "NEEDS_REVIEW"]
    fail_count: int
    failing_rules: list[FailedRuleDetail] = Field(default_factory=list)
    changed_fields_since_last: list[str] = Field(default_factory=list)
    is_regression: bool = False
    regression_details: list[str] = Field(default_factory=list)
    mfg_date: str | None = None
    mrp: str | None = None
    net_quantity: str | None = None
    image_url: str | None = None


class ProductHistory(BaseModel):
    product_key: str
    product_name: str
    manufacturer_name: str
    manufacturer_key: str
    net_quantity: str | None = None
    entries: list[ProductHistoryEntry] = Field(default_factory=list)
    trend: Literal["IMPROVING", "DEGRADING", "STABLE", "INSUFFICIENT_DATA"]
    total_inspections: int
    fail_rate: float
    has_active_regression: bool = False


class ProductListItem(BaseModel):
    product_key: str
    common_name: str
    manufacturer_name: str
    manufacturer_key: str
    net_quantity: str | None = None
    total_inspections: int
    latest_verdict: str
    latest_failing_rules: list[FailedRuleDetail] = Field(default_factory=list)
    fail_rate: float
    trend: str
    has_active_regression: bool = False
    last_tested_at: str | None = None


# --- PRD §8.5 Manufacturer-Level Dashboard Schemas ---

class StatutoryViolationItem(BaseModel):
    rule_id: str
    description: str
    citation: str = ""
    fail_count: int
    percentage: float


class ManufacturerSummary(BaseModel):
    manufacturer_key: str
    manufacturer_name: str
    raw_name_address: str
    product_count: int
    total_inspections: int
    current_compliance_score: float
    current_fail_rate: float
    current_risk_level: Literal["LOW", "MEDIUM", "HIGH"]
    historical_compliance_score: float
    fail_rate: float
    compliance_score: float
    risk_level: Literal["LOW", "MEDIUM", "HIGH"]
    remediation_status: Literal["REMEDIATED", "REGRESSED", "EXEMPLARY", "NON_COMPLIANT"]
    products_with_active_regression: list[str] = Field(default_factory=list)
    current_statutory_violations: list[StatutoryViolationItem] = Field(default_factory=list)
    historical_statutory_violations: list[StatutoryViolationItem] = Field(default_factory=list)
    statutory_violations_breakdown: list[StatutoryViolationItem] = Field(default_factory=list)
    products: list[ProductListItem] = Field(default_factory=list)


class ManufacturerListItem(BaseModel):
    manufacturer_key: str
    manufacturer_name: str
    product_count: int
    total_inspections: int
    current_compliance_score: float
    historical_compliance_score: float
    fail_rate: float
    compliance_score: float
    risk_level: Literal["LOW", "MEDIUM", "HIGH"]
    current_risk_level: Literal["LOW", "MEDIUM", "HIGH"]
    active_regressions_count: int
    remediation_status: Literal["REMEDIATED", "REGRESSED", "EXEMPLARY", "NON_COMPLIANT"]

