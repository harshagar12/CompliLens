from __future__ import annotations
import re
import json
import uuid
from pathlib import Path
from typing import Literal, Any

try:
    from models.schemas import (
        Package,
        ExtractedField,
        Rule,
        Evaluation,
        PackageVerdict,
        VerdictResult,
    )
    from engine.applicability import filter_applicable_rules
except (ImportError, ValueError):
    from ..models.schemas import (
        Package,
        ExtractedField,
        Rule,
        Evaluation,
        PackageVerdict,
        VerdictResult,
    )
    from .applicability import filter_applicable_rules


# Whitelisted compiled regexes for rule evaluation
MRP_REGEX = re.compile(
    r"(?:m\.?r\.?p\.?|max(?:imum)?\.?\s*retail\s*price|mrp)[\s:.]*(?:rs\.?|₹|inr)?\s*([0-9]+(?:\.[0-9]{1,2})?)",
    re.IGNORECASE,
)
MRP_TAX_INCLUSIVE_REGEX = re.compile(
    r"(?:incl(?:usive)?\.?\s*of\s*all\s*taxes|incl\.?\s*taxes)",
    re.IGNORECASE,
)
ADDRESS_PIN_REGEX = re.compile(r"\b[1-9][0-9]{5}\b")  # 6-digit Indian PIN code


def load_rules(
    rules_dir: Path | None = None,
    scope: Literal["mvp", "final_year_target", "advanced"] | None = "mvp",
) -> list[Rule]:
    """Loads and returns valid Rule JSON objects from the rules directory, filtered by scope."""
    if rules_dir is None:
        rules_dir = Path(__file__).parent / "rules"

    rules: list[Rule] = []
    for file_path in rules_dir.glob("*.json"):
        # Skip schema, exemptions, and schedule lookup tables
        if file_path.name in ["rule.schema.json", "exemptions.json", "first_schedule_table1.json", "second_schedule_food.json"]:
            continue
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            # Only load files that contain a rule_id
            if "rule_id" in data:
                rule = Rule(**data)
                if scope == "mvp" and rule.project_scope != "mvp":
                    continue
                rules.append(rule)

    rules.sort(key=lambda r: r.rule_id)
    return rules


def load_schedule_table(table_id: str, search_dirs: list[Path] | None = None) -> dict | None:
    """Finds and loads a schedule lookup table by table_id."""
    if search_dirs is None:
        search_dirs = [
            Path(__file__).parent.parent.parent / "data" / "schedules",
            Path(__file__).parent / "rules",
        ]

    for sdir in search_dirs:
        if not sdir.exists():
            continue
        for f in sdir.glob("*.json"):
            try:
                with open(f, "r", encoding="utf-8") as fp:
                    data = json.load(fp)
                    if data.get("table_id") == table_id:
                        return data
            except Exception:
                continue
    return None


def evaluate_condition(
    rule: Rule,
    confirmed_value: str | None,
    package: Package,
    extra_context: dict[str, Any] | None = None,
) -> tuple[VerdictResult, str]:
    """
    Evaluates a rule's validation_condition against confirmed_value using the whitelisted condition DSL.
    Returns (result, note).
    """
    if extra_context is None:
        extra_context = {}

    cond = rule.validation_condition
    op = cond.get("op")

    # Check for rule-level exceptions first
    for exc in rule.exceptions:
        exc_cond = exc.condition
        if exc_cond.get("op") == "package_capacity_lte":
            max_cc = exc_cond.get("value_cc", 5)
            if package.package_capacity_cc is not None and package.package_capacity_cc <= max_cc:
                # E.g. Rule 10(1) proviso: Identifying mark sufficient for <= 5cc
                if confirmed_value and len(confirmed_value.strip()) >= 2:
                    return "PASS", f"Passed under exception: {exc.source} ({exc.modified_requirement})"

    if not confirmed_value or not confirmed_value.strip():
        return "FAIL", f"Required declaration '{rule.required_field}' is missing or empty"

    val = confirmed_value.strip()

    if op == "non_empty":
        if len(val) > 0:
            return "PASS", f"Declaration present: '{val[:60]}...'" if len(val) > 60 else f"Declaration present: '{val}'"
        return "FAIL", "Declaration is empty"

    elif op == "regex_match":
        pattern_name = cond.get("pattern", "")
        if pattern_name == "mrp_price_like":
            has_price = MRP_REGEX.search(val) is not None
            has_tax_mention = MRP_TAX_INCLUSIVE_REGEX.search(val) is not None
            if has_price and has_tax_mention:
                return "PASS", "Valid MRP declaration with 'inclusive of all taxes'"
            elif has_price and not has_tax_mention:
                # Rule 6(1)(e) requires 'inclusive of all taxes' or 'incl. of all taxes'
                # If price is present but taxes not explicitly declared, flag as FAIL per LMPC 6(1)(e)
                return "FAIL", "Price found but missing mandatory 'inclusive of all taxes' declaration"
            else:
                return "FAIL", "No valid MRP pattern (e.g. 'MRP Rs. XX incl. of all taxes') found"

        elif pattern_name == "address_like":
            has_pin = ADDRESS_PIN_REGEX.search(val) is not None
            has_sufficient_words = len(val.split()) >= 4
            if has_pin or has_sufficient_words:
                return "PASS", "Valid manufacturer address structure detected"
            return "NEEDS_REVIEW", "Address may be incomplete (no PIN code or street details detected)"

        else:
            custom_regex = cond.get("custom_regex")
            if custom_regex and re.search(custom_regex, val, re.IGNORECASE):
                return "PASS", f"Matches required pattern '{custom_regex}'"
            return "FAIL", f"Does not match pattern '{pattern_name or custom_regex}'"

    elif op == "in_range":
        table_id = cond.get("table")
        if table_id == "first_schedule_table_1":
            # Check maximum permissible error
            table_data = load_schedule_table(table_id)
            measured_qty = extra_context.get("measured_net_quantity")
            declared_qty = package.declared_net_quantity

            if declared_qty is None:
                # Extract number from val if possible
                num_match = re.search(r"([0-9]+(?:\.[0-9]+)?)", val)
                if num_match:
                    declared_qty = float(num_match.group(1))

            if measured_qty is None:
                return "NEEDS_REVIEW", "Rule requires physical measured net quantity comparison (First Schedule Table 1)"

            if declared_qty is not None and table_data:
                error_amount = abs(declared_qty - measured_qty)
                bands = table_data.get("bands", [])
                matched_band = None
                for band in bands:
                    b_min = band.get("min", 0)
                    b_max = band.get("max")
                    if b_max is None:
                        if declared_qty > b_min:
                            matched_band = band
                            break
                    elif b_min < declared_qty <= b_max:
                        matched_band = band
                        break

                if matched_band:
                    max_err_abs = matched_band.get("max_error_absolute")
                    max_err_pct = matched_band.get("max_error_percent")
                    allowed_error = max_err_abs if max_err_abs is not None else (declared_qty * max_err_pct / 100.0)

                    if error_amount <= allowed_error:
                        return "PASS", f"Measured error ({error_amount:.2f}) is within allowed MPE ({allowed_error:.2f})"
                    else:
                        return "FAIL", f"Measured error ({error_amount:.2f}) exceeds allowed MPE ({allowed_error:.2f})"

            return "NEEDS_REVIEW", "Unable to determine MPE band for declared quantity"

    elif op == "lookup_membership":
        table_id = cond.get("table", "second_schedule_food_subset")
        table_data = load_schedule_table(table_id)
        if table_data:
            commodities = table_data.get("commodities", [])
            commodity_name = extra_context.get("commodity_name")
            declared_qty = package.declared_net_quantity

            if not commodity_name or declared_qty is None:
                return "NEEDS_REVIEW", "Commodity name or quantity not provided to check Second Schedule standard pack sizes"

            for c in commodities:
                if c.get("name") == commodity_name:
                    std_quantities = c.get("standard_quantities", [])
                    if declared_qty in std_quantities:
                        return "PASS", f"Standard pack size ({declared_qty} {c.get('unit')}) compliant with Second Schedule"
                    else:
                        return "FAIL", f"Declared pack size ({declared_qty}) is not in Second Schedule standard sizes for {commodity_name}"

            return "NEEDS_REVIEW", f"Commodity '{commodity_name}' not listed in food subset of Second Schedule"

    return "NEEDS_REVIEW", f"Condition operator '{op}' could not be unambiguously verified"


def evaluate_package(
    package: Package,
    confirmed_fields: dict[str, ExtractedField],
    rules: list[Rule] | None = None,
    rules_dir: Path | None = None,
    extra_context: dict[str, Any] | None = None,
) -> PackageVerdict:
    """
    Evaluates a package against all applicable rules.
    Requirement: confirmed_fields must contain confirmed values (Phase 3).
    LLM is never used to produce a verdict.
    """
    if rules is None:
        rules = load_rules(rules_dir)

    applicability = filter_applicable_rules(package, rules, rules_dir)

    if applicability.status == "FULLY_EXEMPT":
        ex_eval = Evaluation(
            evaluation_id=str(uuid.uuid4()),
            field_name="all",
            rule_id=applicability.exemption_id or "LMPC-26",
            rule_version=1,
            result="PASS",
            extracted_value=None,
            confidence=1.0,
            evidence_crop_url="",
            notes=f"Exempt from Chapter II under {applicability.exemption_id}: {applicability.exemption_reason}",
        )
        return PackageVerdict(
            package_id=package.package_id,
            category=package.category,
            evaluations=[ex_eval],
            overall_result="PASS",
            exemption_applied=applicability.exemption_id,
        )

    evaluations: list[Evaluation] = []
    has_fail = False
    has_needs_review = False

    for rule in applicability.applicable_rules:
        field = confirmed_fields.get(rule.required_field)
        confirmed_value = (field.confirmed_value if field and field.confirmed_value else (field.raw_value if field else None))
        confidence = field.confidence if field else 0.0

        res, note = evaluate_condition(rule, confirmed_value, package, extra_context)

        if res == "FAIL":
            has_fail = True
        elif res == "NEEDS_REVIEW":
            has_needs_review = True

        evaluations.append(
            Evaluation(
                evaluation_id=str(uuid.uuid4()),
                field_name=rule.required_field,
                rule_id=rule.rule_id,
                rule_version=rule.version,
                result=res,
                extracted_value=confirmed_value,
                confidence=confidence,
                evidence_crop_url="",  # Can be populated by API router
                notes=note,
            )
        )

    overall: VerdictResult = "PASS"
    if has_fail:
        overall = "FAIL"
    elif has_needs_review:
        overall = "NEEDS_REVIEW"

    return PackageVerdict(
        package_id=package.package_id,
        category=package.category,
        evaluations=evaluations,
        overall_result=overall,
        exemption_applied=applicability.exemption_id if applicability.status != "APPLICABLE" else None,
    )
