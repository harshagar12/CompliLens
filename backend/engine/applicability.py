from __future__ import annotations
import json
from pathlib import Path
from typing import Literal
from pydantic import BaseModel, Field

try:
    from models.schemas import Package, Rule
except (ImportError, ValueError):
    from ..models.schemas import Package, Rule


class ApplicabilityResult(BaseModel):
    status: Literal["APPLICABLE", "FULLY_EXEMPT", "PARTIALLY_EXEMPT"]
    exemption_id: str | None = None
    exemption_reason: str | None = None
    allowed_required_fields: list[str] | None = None
    applicable_rules: list[Rule] = Field(default_factory=list)
    out_of_scope_rules: list[Rule] = Field(default_factory=list)


def check_rule_26_exemptions(package: Package, exemptions_data: dict) -> tuple[str, str | None, str | None, list[str] | None]:
    """
    Evaluates Rule 26 exemptions in order:
    Returns (status, exemption_id, reason, still_required_fields)
    """
    category = package.category
    qty = package.declared_net_quantity

    for ex in exemptions_data.get("exemptions", []):
        cond = ex.get("condition", {})
        op = cond.get("op")

        if op == "package_net_quantity_lte" and qty is not None:
            threshold = cond.get("value_g_or_ml", 10)
            if qty <= threshold:
                return "FULLY_EXEMPT", ex.get("id"), ex.get("description"), None

        elif op == "package_net_quantity_between" and qty is not None:
            min_val = cond.get("min", 10)
            max_val = cond.get("max", 20)
            if min_val < qty <= max_val:
                return "PARTIALLY_EXEMPT", ex.get("id"), ex.get("description"), ex.get("still_required_fields", ["mrp", "net_quantity"])

        elif op == "category_in":
            categories = cond.get("categories", [])
            if category in categories:
                return "FULLY_EXEMPT", ex.get("id"), ex.get("description"), None

        elif op == "and":
            all_match = True
            for sub_cond in cond.get("conditions", []):
                sub_op = sub_cond.get("op")
                if sub_op == "category_in":
                    if category not in sub_cond.get("categories", []):
                        all_match = False
                        break
                elif sub_op == "package_weight_gt":
                    thresh = sub_cond.get("value_kg", 50)
                    # if qty declared in kg or grams
                    weight_in_kg = qty / 1000.0 if package.declared_net_quantity_unit in ["g", "ml"] else qty
                    if qty is None or weight_in_kg <= thresh:
                        all_match = False
                        break
            if all_match:
                return "FULLY_EXEMPT", ex.get("id"), ex.get("description"), None

    return "APPLICABLE", None, None, None


def filter_applicable_rules(package: Package, rules: list[Rule], rules_dir: Path | None = None) -> ApplicabilityResult:
    """
    Given a package and rule corpus, returns the applicable and out-of-scope rules
    after applying Rule 26 exemptions and category routing.
    """
    if rules_dir is None:
        rules_dir = Path(__file__).parent / "rules"

    exemptions_path = rules_dir / "exemptions.json"
    exemptions_data = {}
    if exemptions_path.exists():
        with open(exemptions_path, "r", encoding="utf-8") as f:
            exemptions_data = json.load(f)

    status, exemption_id, reason, still_required = check_rule_26_exemptions(package, exemptions_data)

    if status == "FULLY_EXEMPT":
        return ApplicabilityResult(
            status="FULLY_EXEMPT",
            exemption_id=exemption_id,
            exemption_reason=reason,
            allowed_required_fields=[],
            applicable_rules=[],
            out_of_scope_rules=rules,
        )

    applicable: list[Rule] = []
    out_of_scope: list[Rule] = []

    for rule in rules:
        # Check category inclusion / exclusion
        if rule.excluded_category and package.category in rule.excluded_category:
            out_of_scope.append(rule)
            continue

        if rule.applicable_category and package.category not in rule.applicable_category:
            out_of_scope.append(rule)
            continue

        # If partially exempt (e.g. 10g-20g), only still_required fields apply
        if status == "PARTIALLY_EXEMPT" and still_required:
            if rule.required_field not in still_required:
                out_of_scope.append(rule)
                continue

        applicable.append(rule)

    return ApplicabilityResult(
        status=status,
        exemption_id=exemption_id,
        exemption_reason=reason,
        allowed_required_fields=still_required,
        applicable_rules=applicable,
        out_of_scope_rules=out_of_scope,
    )
