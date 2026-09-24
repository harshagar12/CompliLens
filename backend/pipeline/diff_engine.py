"""
CompliLens — Multi-Revision Packaging Evolution & Diff Engine.
Coordinates full Legal Metrology (LMPC) audit comparisons, shrinkflation calculations,
FSSAI/barcode identity tracking, and semantic formulation diffs across 2 to 5 packaging revisions.
"""
from __future__ import annotations
import re
from typing import Any
from datetime import datetime

from pipeline.diff_llm import analyze_semantic_diff_single_prompt


def parse_numeric_quantity(qty_str: str | None) -> tuple[float | None, str | None]:
    """Extracts numeric weight/volume and canonical unit (g or ml) from Net Quantity string."""
    if not qty_str:
        return None, None
    m = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*(kg|g|gm|gms|l|ml|ltr|litres)", qty_str, re.IGNORECASE)
    if not m:
        return None, None
    val = float(m.group(1))
    unit = m.group(2).lower()

    if unit in ["kg", "l", "ltr", "litres"]:
        val = val * 1000.0
        canonical_unit = "g" if "g" in unit or "k" in unit else "ml"
    else:
        canonical_unit = "g" if "g" in unit else "ml"

    return val, canonical_unit


def parse_numeric_price(price_str: str | None) -> float | None:
    """Extracts numeric rupee price from MRP declaration."""
    if not price_str:
        return None
    m = re.search(r"(?:rs\.?|₹|inr)?\s*([0-9]+(?:\.[0-9]{1,2})?)", price_str, re.IGNORECASE)
    if m:
        return float(m.group(1))
    return None


def parse_revision_date(date_str: str | None) -> tuple[int, int]:
    """Parses MM/YYYY or YYYY from mfg/packing date string into (year, month) for chronological sorting."""
    if not date_str:
        return (9999, 99)
    # Match MM/YYYY
    m = re.search(r"\b(0?[1-9]|1[0-2])[\/\-](20[2-9][0-9])\b", date_str)
    if m:
        return (int(m.group(2)), int(m.group(1)))
    # Match YYYY
    m_year = re.search(r"\b(20[2-9][0-9])\b", date_str)
    if m_year:
        return (int(m_year.group(1)), 1)
    return (9999, 99)


def compute_shrinkflation(
    revisions: list[dict[str, Any]]
) -> dict[str, Any] | None:
    """
    Computes Unit-Price Shift, Stealth Shrinkflation, and Pricing Evolution between earliest and newest revisions.
    Unit Price = (MRP / Net Qty) * 100 (Price per 100g or 100ml).
    """
    if len(revisions) < 2:
        return None

    r_first = revisions[0]
    r_last = revisions[-1]

    qty_1, u1 = parse_numeric_quantity(r_first.get("fields", {}).get("net_quantity"))
    qty_2, u2 = parse_numeric_quantity(r_last.get("fields", {}).get("net_quantity"))

    p1 = parse_numeric_price(r_first.get("fields", {}).get("mrp"))
    p2 = parse_numeric_price(r_last.get("fields", {}).get("mrp"))

    # If both price and quantity are fully parsed with matching units:
    if qty_1 and qty_2 and p1 and p2 and u1 == u2:
        unit_p1 = (p1 / qty_1) * 100.0
        unit_p2 = (p2 / qty_2) * 100.0

        unit_price_delta_pct = ((unit_p2 - unit_p1) / unit_p1) * 100.0
        qty_delta_pct = ((qty_2 - qty_1) / qty_1) * 100.0
        mrp_delta_pct = ((p2 - p1) / p1) * 100.0
        p_diff = p2 - p1
        q_diff = qty_2 - qty_1

        is_shrinkflation = (qty_2 < qty_1) and (p2 >= p1 * 0.95)

        if is_shrinkflation:
            category = "SHRINKFLATION"
            summary = f"Stealth Shrinkflation Detected: Net quantity dropped by {abs(qty_delta_pct):.1f}% ({abs(q_diff):g}{u1}), causing a {unit_price_delta_pct:+.1f}% unit-price hike per 100{u1}."
        elif p_diff > 0 and q_diff == 0:
            category = "PRICE_HIKE"
            summary = f"Retail Price Hike: Price increased by ₹{p_diff:.2f} (+{mrp_delta_pct:.1f}%) with packaging volume held constant at {qty_1:g}{u1}."
        elif p_diff < 0 and q_diff == 0:
            category = "PRICE_DROP"
            summary = f"Retail Price Drop: Price reduced by ₹{abs(p_diff):.2f} ({mrp_delta_pct:.1f}%) for {qty_1:g}{u1}."
        elif q_diff < 0 and p_diff < 0:
            category = "DOWNSIZED"
            summary = f"Downsized Package: Net quantity reduced by {abs(q_diff):g}{u1} ({qty_delta_pct:.1f}%) with a lower price of ₹{p2:.2f}."
        elif q_diff > 0:
            category = "VALUE_INCREASE"
            summary = f"Volume Increase: Net quantity increased by +{q_diff:g}{u1} (+{qty_delta_pct:.1f}%)."
        else:
            category = "STABLE"
            summary = f"Unit pricing and quantity remained constant across revisions at ₹{p1:.2f} for {qty_1:g}{u1}."

        return {
            "unit": f"per 100{u1}",
            "category": category,
            "old_net_quantity": f"{qty_1:g} {u1}",
            "new_net_quantity": f"{qty_2:g} {u2}",
            "old_mrp": f"₹{p1:.2f}",
            "new_mrp": f"₹{p2:.2f}",
            "mrp_diff": round(p_diff, 2),
            "qty_diff": round(q_diff, 2),
            "old_unit_price": round(unit_p1, 2),
            "new_unit_price": round(unit_p2, 2),
            "unit_price_delta_pct": round(unit_price_delta_pct, 1),
            "qty_delta_pct": round(qty_delta_pct, 1),
            "mrp_delta_pct": round(mrp_delta_pct, 1),
            "is_shrinkflation": is_shrinkflation,
            "summary": summary,
        }

    # Partial fallback: only price parsed
    if p1 and p2:
        p_diff = p2 - p1
        mrp_delta_pct = ((p2 - p1) / p1) * 100.0 if p1 else 0.0
        return {
            "unit": "per pack",
            "category": "PRICE_HIKE" if p_diff > 0 else ("PRICE_DROP" if p_diff < 0 else "STABLE"),
            "old_net_quantity": None,
            "new_net_quantity": None,
            "old_mrp": f"₹{p1:.2f}",
            "new_mrp": f"₹{p2:.2f}",
            "mrp_diff": round(p_diff, 2),
            "qty_diff": None,
            "old_unit_price": None,
            "new_unit_price": None,
            "unit_price_delta_pct": None,
            "qty_delta_pct": None,
            "mrp_delta_pct": round(mrp_delta_pct, 1),
            "is_shrinkflation": False,
            "summary": f"Retail price shifted from ₹{p1:.2f} to ₹{p2:.2f} ({mrp_delta_pct:+.1f}%).",
        }

    # Partial fallback: only quantity parsed
    if qty_1 and qty_2 and u1 == u2:
        q_diff = qty_2 - qty_1
        qty_delta_pct = ((qty_2 - qty_1) / qty_1) * 100.0 if qty_1 else 0.0
        return {
            "unit": f"{u1}",
            "category": "DOWNSIZED" if q_diff < 0 else ("INCREASE" if q_diff > 0 else "STABLE"),
            "old_net_quantity": f"{qty_1:g} {u1}",
            "new_net_quantity": f"{qty_2:g} {u2}",
            "old_mrp": None,
            "new_mrp": None,
            "mrp_diff": None,
            "qty_diff": round(q_diff, 2),
            "old_unit_price": None,
            "new_unit_price": None,
            "unit_price_delta_pct": None,
            "qty_delta_pct": round(qty_delta_pct, 1),
            "mrp_delta_pct": None,
            "is_shrinkflation": q_diff < 0,
            "summary": f"Net quantity changed from {qty_1:g}{u1} to {qty_2:g}{u2} ({qty_delta_pct:+.1f}%).",
        }

    return None


def extract_fssai_and_barcodes(full_text: str) -> dict[str, list[str]]:
    """Extracts 14-digit FSSAI licenses and EAN-13 barcodes from text."""
    fssai = re.findall(r"\b1[0-9]{13}\b", full_text)
    barcodes = re.findall(r"\b(?:890|906)[0-9]{9,10}\b", full_text)
    return {
        "fssai_licenses": sorted(list(set(fssai))),
        "barcodes": sorted(list(set(barcodes))),
    }


def compute_compliance_progression(
    revisions: list[dict[str, Any]]
) -> dict[str, Any]:
    """
    Analyzes rule evaluation verdicts across revisions to track
    remediations, regressions, and persistent violations.
    """
    if len(revisions) < 2:
        return {"remediations": [], "regressions": [], "persistent_fails": [], "overall_drift": "STABLE"}

    r_first_evals = {e["rule_id"]: e for e in revisions[0].get("verdict", {}).get("evaluations", [])}
    r_last_evals = {e["rule_id"]: e for e in revisions[-1].get("verdict", {}).get("evaluations", [])}

    all_rule_ids = sorted(list(set(r_first_evals.keys()).union(r_last_evals.keys())))

    remediations = []
    regressions = []
    persistent_fails = []

    for rid in all_rule_ids:
        res1 = r_first_evals.get(rid, {}).get("result", "PASS")
        res2 = r_last_evals.get(rid, {}).get("result", "PASS")

        if res1 in ["FAIL", "NEEDS_REVIEW"] and res2 == "PASS":
            remediations.append({
                "rule_id": rid,
                "field_name": r_last_evals.get(rid, {}).get("field_name", ""),
                "description": f"Rule {rid} violation in earlier revision was successfully resolved in newest revision."
            })
        elif res1 == "PASS" and res2 in ["FAIL", "NEEDS_REVIEW"]:
            regressions.append({
                "rule_id": rid,
                "field_name": r_last_evals.get(rid, {}).get("field_name", ""),
                "description": f"Compliance Regression: Rule {rid} passed in earlier revision but violated in newest revision."
            })
        elif res1 in ["FAIL", "NEEDS_REVIEW"] and res2 in ["FAIL", "NEEDS_REVIEW"]:
            persistent_fails.append({
                "rule_id": rid,
                "field_name": r_last_evals.get(rid, {}).get("field_name", ""),
                "description": f"Persistent Non-Compliance: Rule {rid} continues to fail across revisions."
            })

    overall_drift = (
        "REGRESSED" if regressions
        else ("IMPROVED" if remediations
        else ("NON_COMPLIANT" if persistent_fails else "COMPLIANT"))
    )

    return {
        "remediations": remediations,
        "regressions": regressions,
        "persistent_fails": persistent_fails,
        "overall_drift": overall_drift,
    }


def compute_lmpc_rules_matrix(
    revisions: list[dict[str, Any]],
    rules_metadata: dict[str, dict[str, Any]] | None = None
) -> list[dict[str, Any]]:
    """
    Builds a granular rule-by-rule compliance matrix across all packaging revisions.
    Reveals the exact statutory condition, why each revision passed or failed (with evaluator notes),
    and whether compliance remediated or regressed over time.
    """
    if not revisions:
        return []

    rules_meta = rules_metadata or {}

    # Collect all unique rule IDs evaluated across all revisions
    all_rule_ids = []
    for r in revisions:
        evals = r.get("verdict", {}).get("evaluations", [])
        for ev in evals:
            rid = ev.get("rule_id")
            if rid and rid not in all_rule_ids:
                all_rule_ids.append(rid)

    all_rule_ids.sort()

    matrix = []
    for rid in all_rule_ids:
        meta = rules_meta.get(rid, {})
        rule_desc = meta.get("description", f"Statutory requirement for Rule {rid}")
        citation = meta.get("source_citation", f"Legal Metrology (Packaged Commodities) Rules, 2011 - Rule {rid}")
        required_field = meta.get("required_field", "")

        per_rev_evals = []
        for idx, r in enumerate(revisions):
            evals = {e.get("rule_id"): e for e in r.get("verdict", {}).get("evaluations", [])}
            ev = evals.get(rid)
            if ev:
                per_rev_evals.append({
                    "revision_index": idx,
                    "package_id": r.get("package_id"),
                    "result": ev.get("result", "PASS"),
                    "notes": ev.get("notes") or ("Passed: Condition satisfied." if ev.get("result") == "PASS" else "Condition not satisfied."),
                    "extracted_value": ev.get("extracted_value") or r.get("fields", {}).get(required_field, ""),
                })
            else:
                per_rev_evals.append({
                    "revision_index": idx,
                    "package_id": r.get("package_id"),
                    "result": "N/A",
                    "notes": "Rule not evaluated for this revision.",
                    "extracted_value": "",
                })

        # Calculate drift between first and last revision
        first_res = per_rev_evals[0]["result"]
        last_res = per_rev_evals[-1]["result"]

        if first_res in ["FAIL", "NEEDS_REVIEW"] and last_res == "PASS":
            drift = "REMEDIATED"
        elif first_res == "PASS" and last_res in ["FAIL", "NEEDS_REVIEW"]:
            drift = "REGRESSED"
        elif first_res in ["FAIL", "NEEDS_REVIEW"] and last_res in ["FAIL", "NEEDS_REVIEW"]:
            drift = "PERSISTENT_FAIL"
        else:
            drift = "STABLE_PASS"

        # Tag distinct status category on each evaluation so regressions are not labeled as generic fails
        for ev in per_rev_evals:
            if drift == "REGRESSED" and ev["result"] in ["FAIL", "NEEDS_REVIEW"]:
                ev["status_category"] = "REGRESSION"
                ev["display_result"] = "REGRESSED"
            elif drift == "REMEDIATED" and ev["result"] == "PASS":
                ev["status_category"] = "REMEDIATION"
                ev["display_result"] = "REMEDIATED"
            elif drift == "PERSISTENT_FAIL" and ev["result"] in ["FAIL", "NEEDS_REVIEW"]:
                ev["status_category"] = "PERSISTENT_FAIL"
                ev["display_result"] = "PERSISTENT FAIL"
            elif ev["result"] == "PASS":
                ev["status_category"] = "PASS"
                ev["display_result"] = "PASS"
            else:
                ev["status_category"] = ev["result"]
                ev["display_result"] = ev["result"]

        matrix.append({
            "rule_id": rid,
            "description": rule_desc,
            "citation": citation,
            "required_field": required_field,
            "evaluations": per_rev_evals,
            "drift": drift,
        })

    return matrix


def compute_multi_revision_diff(
    revisions: list[dict[str, Any]],
    auto_sort_by_date: bool = True,
    rules_metadata: dict[str, dict[str, Any]] | None = None
) -> dict[str, Any]:
    """
    Main entrypoint for multi-revision packaging diff.
    Supports user-specified custom ordering or chronological auto-sorting, computes shrinkflation,
    LMPC statutory diff, granular LMPC rule compliance matrix, FSSAI/barcode shifts,
    and calls single-prompt LLM semantic diff for formulation, allergens, and nutrition.
    """
    # 1. Ordering: Chronological sorting by mfg_month_year if requested, else preserve user order
    if auto_sort_by_date:
        ordered_revisions = sorted(
            revisions,
            key=lambda r: parse_revision_date(r.get("fields", {}).get("mfg_month_year"))
        )
    else:
        ordered_revisions = list(revisions)

    # 2. Extract FSSAI & Barcodes for each revision
    for r in ordered_revisions:
        full_text = r.get("full_text", "")
        ident = extract_fssai_and_barcodes(full_text)
        r["fssai_licenses"] = ident["fssai_licenses"]
        r["barcodes"] = ident["barcodes"]

    # 3. Deterministic Shrinkflation
    shrinkflation_data = compute_shrinkflation(ordered_revisions)

    # 4. Compliance Progression & Granular Rule Matrix
    compliance_progression = compute_compliance_progression(ordered_revisions)
    lmpc_rules_matrix = compute_lmpc_rules_matrix(ordered_revisions, rules_metadata)

def compute_statutory_diffs(ordered_revisions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Computes precise delta metrics, change types, and human-readable summaries
    for each statutory field across all packaging revisions.
    """
    if not ordered_revisions:
        return []

    statutory_fields = [
        "mrp", "net_quantity", "mfg_month_year",
        "common_name", "manufacturer_name_address", "consumer_care"
    ]

    results = []

    for f in statutory_fields:
        raw_values = [r.get("fields", {}).get(f) for r in ordered_revisions]
        norm_values = [" ".join(str(v).split()).lower() if v else "" for v in raw_values]
        has_changed = len(set(norm_values)) > 1

        v_first = raw_values[0] or ""
        v_last = raw_values[-1] or ""

        change_type = "UNCHANGED"
        delta_badge = "Identical"
        summary = "No changes detected across revisions."
        step_deltas = [None]

        if f == "mrp":
            prices = [parse_numeric_price(v) for v in raw_values]
            p_first = prices[0]
            p_last = prices[-1]

            if p_first and p_last:
                p_diff = round(p_last - p_first, 2)
                p_pct = round(((p_last - p_first) / p_first) * 100.0, 1) if p_first else 0.0

                if p_diff > 0:
                    change_type = "INCREASE"
                    delta_badge = f"+₹{p_diff:.2f} (+{p_pct}%)"
                    summary = f"Retail price increased by ₹{p_diff:.2f} (+{p_pct}%) from ₹{p_first:.2f} to ₹{p_last:.2f}."
                elif p_diff < 0:
                    change_type = "DECREASE"
                    delta_badge = f"-₹{abs(p_diff):.2f} ({p_pct}%)"
                    summary = f"Retail price decreased by ₹{abs(p_diff):.2f} ({p_pct}%) from ₹{p_first:.2f} to ₹{p_last:.2f}."
                else:
                    change_type = "UNCHANGED"
                    delta_badge = "Identical"
                    summary = f"Retail price constant at ₹{p_first:.2f}."
            elif has_changed:
                change_type = "MODIFIED"
                delta_badge = "Price Changed"
                summary = f"Retail price declaration shifted from '{v_first or 'N/A'}' to '{v_last or 'N/A'}'."
            else:
                change_type = "UNCHANGED"
                delta_badge = "Identical"
                summary = "Retail price remained unchanged across revisions."

            for i in range(1, len(prices)):
                prev = prices[i - 1]
                curr = prices[i]
                if prev and curr:
                    diff = round(curr - prev, 2)
                    pct = round(((curr - prev) / prev) * 100.0, 1) if prev else 0.0
                    step_deltas.append(f"+₹{diff:.2f} (+{pct}%)" if diff > 0 else (f"-₹{abs(diff):.2f} ({pct}%)" if diff < 0 else "Unchanged"))
                elif norm_values[i] != norm_values[i - 1]:
                    step_deltas.append("Modified")
                else:
                    step_deltas.append("Unchanged")

        elif f == "net_quantity":
            qtys = [parse_numeric_quantity(v) for v in raw_values]
            q_first, u_first = qtys[0]
            q_last, u_last = qtys[-1]

            if q_first and q_last and u_first == u_last:
                q_diff = round(q_last - q_first, 2)
                q_pct = round(((q_last - q_first) / q_first) * 100.0, 1) if q_first else 0.0

                if q_diff < 0:
                    change_type = "DOWNSIZED"
                    delta_badge = f"-{abs(q_diff):g} {u_first} ({q_pct}%)"
                    summary = f"Net quantity downsized by {abs(q_diff):g} {u_first} ({q_pct}%) from {q_first:g} {u_first} to {q_last:g} {u_last}."
                elif q_diff > 0:
                    change_type = "INCREASE"
                    delta_badge = f"+{q_diff:g} {u_first} (+{q_pct}%)"
                    summary = f"Net quantity increased by +{q_diff:g} {u_first} (+{q_pct}%) from {q_first:g} {u_first} to {q_last:g} {u_last}."
                else:
                    change_type = "UNCHANGED"
                    delta_badge = "Identical"
                    summary = f"Net quantity constant at {q_first:g} {u_first}."
            elif has_changed:
                change_type = "MODIFIED"
                delta_badge = "Qty Changed"
                summary = f"Net quantity declaration changed from '{v_first or 'N/A'}' to '{v_last or 'N/A'}'."
            else:
                change_type = "UNCHANGED"
                delta_badge = "Identical"
                summary = "Net quantity remained unchanged across revisions."

            for i in range(1, len(qtys)):
                prev_q, prev_u = qtys[i - 1]
                curr_q, curr_u = qtys[i]
                if prev_q and curr_q and prev_u == curr_u:
                    diff = round(curr_q - prev_q, 2)
                    pct = round(((curr_q - prev_q) / prev_q) * 100.0, 1) if prev_q else 0.0
                    step_deltas.append(f"+{diff:g} {curr_u} (+{pct}%)" if diff > 0 else (f"-{abs(diff):g} {curr_u} ({pct}%)" if diff < 0 else "Unchanged"))
                elif norm_values[i] != norm_values[i - 1]:
                    step_deltas.append("Modified")
                else:
                    step_deltas.append("Unchanged")

        elif f == "mfg_month_year":
            dates = [parse_revision_date(v) for v in raw_values]
            (y1, m1) = dates[0]
            (y2, m2) = dates[-1]

            if y1 != 9999 and y2 != 9999:
                m_diff = (y2 - y1) * 12 + (m2 - m1)
                if m_diff > 0:
                    change_type = "ADVANCED"
                    delta_badge = f"+{m_diff} mo"
                    summary = f"Packaging date advanced by {m_diff} month(s) from {v_first} to {v_last}."
                elif m_diff < 0:
                    change_type = "PRECEDED"
                    delta_badge = f"{m_diff} mo"
                    summary = f"Packaging date preceded by {abs(m_diff)} month(s) ({v_first} to {v_last})."
                else:
                    change_type = "UNCHANGED"
                    delta_badge = "Identical"
                    summary = f"Packaging date remained identical ({v_first})."
            elif has_changed:
                change_type = "MODIFIED"
                delta_badge = "Date Changed"
                summary = f"Packaging date shifted from '{v_first or 'N/A'}' to '{v_last or 'N/A'}'."
            else:
                change_type = "UNCHANGED"
                delta_badge = "Identical"
                summary = "Packaging date unchanged across revisions."

            for i in range(1, len(dates)):
                (py, pm) = dates[i - 1]
                (cy, cm) = dates[i]
                if py != 9999 and cy != 9999:
                    diff = (cy - py) * 12 + (cm - pm)
                    step_deltas.append(f"+{diff} mo" if diff > 0 else (f"{diff} mo" if diff < 0 else "Unchanged"))
                elif norm_values[i] != norm_values[i - 1]:
                    step_deltas.append("Modified")
                else:
                    step_deltas.append("Unchanged")

        elif f == "common_name":
            if has_changed:
                change_type = "CHANGED"
                delta_badge = "Product Renamed"
                summary = f"Product declaration renamed from '{v_first}' to '{v_last}'."
            else:
                change_type = "UNCHANGED"
                delta_badge = "Identical"
                summary = f"Commodity declaration consistent as '{v_first}'."

            for i in range(1, len(raw_values)):
                step_deltas.append("Renamed" if norm_values[i] != norm_values[i - 1] else "Unchanged")

        elif f == "manufacturer_name_address":
            if has_changed:
                change_type = "CHANGED"
                delta_badge = "Facility Updated"
                summary = "Manufacturing location or business entity address updated between revisions."
            else:
                change_type = "UNCHANGED"
                delta_badge = "Identical"
                summary = "Manufacturer identity and premises remained unchanged."

            for i in range(1, len(raw_values)):
                step_deltas.append("Updated" if norm_values[i] != norm_values[i - 1] else "Unchanged")

        elif f == "consumer_care":
            if has_changed:
                change_type = "CHANGED"
                delta_badge = "Contact Updated"
                summary = "Consumer support helpline or email grievance channel updated between revisions."
            else:
                change_type = "UNCHANGED"
                delta_badge = "Identical"
                summary = "Consumer care contact details remain identical."

            for i in range(1, len(raw_values)):
                step_deltas.append("Updated" if norm_values[i] != norm_values[i - 1] else "Unchanged")

        results.append({
            "field_name": f,
            "values": raw_values,
            "changed": has_changed,
            "change_type": change_type,
            "delta_badge": delta_badge,
            "summary": summary,
            "step_deltas": step_deltas,
            "first_value": v_first,
            "last_value": v_last,
        })

    return results


def compute_multi_revision_diff(
    revisions: list[dict[str, Any]],
    auto_sort_by_date: bool = True,
    rules_metadata: dict[str, dict[str, Any]] | None = None
) -> dict[str, Any]:
    """
    Main entrypoint for multi-revision packaging diff.
    Supports user-specified custom ordering or chronological auto-sorting, computes shrinkflation,
    LMPC statutory diff with rich deltas, granular LMPC rule compliance matrix, FSSAI/barcode shifts,
    and calls single-prompt LLM semantic diff for formulation, allergens, and nutrition.
    """
    # 1. Ordering: Chronological sorting by mfg_month_year if requested, else preserve user order
    if auto_sort_by_date:
        ordered_revisions = sorted(
            revisions,
            key=lambda r: parse_revision_date(r.get("fields", {}).get("mfg_month_year"))
        )
    else:
        ordered_revisions = list(revisions)

    # 2. Extract FSSAI & Barcodes for each revision
    for r in ordered_revisions:
        full_text = r.get("full_text", "")
        ident = extract_fssai_and_barcodes(full_text)
        r["fssai_licenses"] = ident["fssai_licenses"]
        r["barcodes"] = ident["barcodes"]

    # 3. Deterministic Shrinkflation
    shrinkflation_data = compute_shrinkflation(ordered_revisions)

    # 4. Compliance Progression & Granular Rule Matrix
    compliance_progression = compute_compliance_progression(ordered_revisions)
    lmpc_rules_matrix = compute_lmpc_rules_matrix(ordered_revisions, rules_metadata)

    # 5. Statutory LMPC Diff across all revisions with precise deltas & price/volume shifts
    statutory_diffs = compute_statutory_diffs(ordered_revisions)

    # 6. Call Single-Prompt LLM for Semantic Changes (Ingredients, Allergens, Nutrition, Claims)
    semantic_diff = analyze_semantic_diff_single_prompt(ordered_revisions)
    revisions_extracted = semantic_diff.get("revisions_extracted", [])

    # Attach extracted non-statutory data to each revision, prioritizing user-reviewed values!
    for idx, r in enumerate(ordered_revisions):
        user_ns = r.get("non_statutory") or {}
        if user_ns and (
            user_ns.get("ingredients_text")
            or user_ns.get("ingredients_list")
            or user_ns.get("allergens")
            or user_ns.get("nutrition_table")
            or user_ns.get("marketing_claims")
        ):
            ing_list = user_ns.get("ingredients_list") or []
            if not ing_list and user_ns.get("ingredients_text"):
                ing_list = [p.strip() for p in re.split(r"[,;]\s*(?![^()]*\))", user_ns["ingredients_text"]) if p.strip()]
            r["extracted_non_statutory"] = {
                "ingredients_text": user_ns.get("ingredients_text", ""),
                "ingredients_list": ing_list,
                "allergens": user_ns.get("allergens") or [],
                "nutrition_table": user_ns.get("nutrition_table") or {},
                "marketing_claims": user_ns.get("marketing_claims") or [],
            }
        else:
            ext = None
            if idx < len(revisions_extracted):
                ext = revisions_extracted[idx]
            elif revisions_extracted:
                for item in revisions_extracted:
                    if item.get("package_id") == r.get("package_id"):
                        ext = item
                        break
            r["extracted_non_statutory"] = ext or {
                "ingredients_text": "",
                "ingredients_list": [],
                "allergens": [],
                "nutrition_table": {},
                "marketing_claims": [],
            }

    # 7. Compute high-level key shifts summary
    key_shifts = []
    mrp_diff = next((d for d in statutory_diffs if d["field_name"] == "mrp"), None)
    qty_diff = next((d for d in statutory_diffs if d["field_name"] == "net_quantity"), None)
    date_diff = next((d for d in statutory_diffs if d["field_name"] == "mfg_month_year"), None)
    name_diff = next((d for d in statutory_diffs if d["field_name"] == "common_name"), None)

    if mrp_diff and mrp_diff["changed"]:
        key_shifts.append(mrp_diff["summary"])
    if qty_diff and qty_diff["changed"]:
        key_shifts.append(qty_diff["summary"])
    if date_diff and date_diff["changed"]:
        key_shifts.append(date_diff["summary"])
    if name_diff and name_diff["changed"]:
        key_shifts.append(name_diff["summary"])
    if shrinkflation_data and shrinkflation_data.get("is_shrinkflation"):
        up_pct = shrinkflation_data.get("unit_price_delta_pct")
        if up_pct is not None:
            key_shifts.append(f"Stealth Shrinkflation: Unit price inflated by {up_pct:+.1f}%.")
        elif shrinkflation_data.get("qty_delta_pct") is not None:
            key_shifts.append(f"Downsized Package: Quantity reduced by {abs(shrinkflation_data['qty_delta_pct']):.1f}%.")
        else:
            key_shifts.append(shrinkflation_data.get("summary") or "Stealth Shrinkflation / Downsizing detected.")

    allergens_summary = semantic_diff.get("allergens_summary", {})
    if allergens_summary.get("added"):
        key_shifts.append(f"Allergen Risk: Added new declared allergen(s): {', '.join(allergens_summary['added'])}.")

    ingredients_summary = semantic_diff.get("ingredients_summary", {})
    if ingredients_summary.get("percentage_changes"):
        for pc in ingredients_summary["percentage_changes"][:2]:
            key_shifts.append(f"Recipe Ratio Shift: {pc.get('ingredient')} ({pc.get('change')}) - {pc.get('detail')}")
    if ingredients_summary.get("substitutions"):
        for sub in ingredients_summary["substitutions"][:2]:
            key_shifts.append(f"Formulation: Replaced '{sub.get('old_ingredient')}' with '{sub.get('new_ingredient')}'.")

    return {
        "num_revisions": len(ordered_revisions),
        "revisions": ordered_revisions,
        "shrinkflation": shrinkflation_data,
        "compliance_progression": compliance_progression,
        "lmpc_rules_matrix": lmpc_rules_matrix,
        "statutory_diffs": statutory_diffs,
        "revisions_extracted": revisions_extracted,
        "ingredients_diff": ingredients_summary,
        "allergens_diff": allergens_summary,
        "nutritional_diff": semantic_diff.get("nutritional_summary", {}),
        "marketing_claims_diff": semantic_diff.get("marketing_claims_summary", {}),
        "packaging_evolution_summary": {
            "has_price_change": bool(mrp_diff and mrp_diff["changed"]),
            "has_quantity_change": bool(qty_diff and qty_diff["changed"]),
            "key_shifts": key_shifts,
        },
    }
