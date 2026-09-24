from __future__ import annotations
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from models.schemas import Package, ExtractedField
from engine.evaluator import load_rules, evaluate_package, evaluate_condition


RULES_DIR = Path(__file__).parent.parent / "engine" / "rules"


@pytest.fixture
def mvp_rules():
    return load_rules(RULES_DIR, scope="mvp")


@pytest.fixture
def all_rules():
    return load_rules(RULES_DIR, scope=None)


def make_field(field_name: str, value: str, confidence: float = 0.95) -> ExtractedField:
    return ExtractedField(
        field_name=field_name,
        raw_value=value,
        confirmed_value=value,
        reviewer_action="accepted_raw",
        confidence=confidence,
        bounding_box=(10, 10, 200, 50),
        ocr_source="test_ocr",
    )


def test_evaluator_all_pass(mvp_rules):
    pkg = Package(
        package_id="pkg_perfect_label",
        category="packaged_food",
        declared_net_quantity=100.0,
        declared_net_quantity_unit="g",
    )

    fields = {
        "manufacturer_name_address": make_field("manufacturer_name_address", "Manufactured by Tasty Bites Foods Pvt Ltd, Plot 45, Okhla Phase 3, New Delhi 110020"),
        "common_name": make_field("common_name", "Chocolate Cream Biscuits"),
        "net_quantity": make_field("net_quantity", "Net Qty: 100 g"),
        "mrp": make_field("mrp", "MRP Rs. 30.00 incl. of all taxes"),
        "consumer_care": make_field("consumer_care", "For customer feedback: customercare@tastybites.com, Tel: 1800-111-2222"),
    }

    verdict = evaluate_package(pkg, fields, mvp_rules, RULES_DIR)
    assert verdict.overall_result == "PASS"
    for ev in verdict.evaluations:
        assert ev.result == "PASS"


def test_evaluator_missing_field_fails(mvp_rules):
    pkg = Package(
        package_id="pkg_missing_mrp",
        category="packaged_food",
        declared_net_quantity=100.0,
        declared_net_quantity_unit="g",
    )

    fields = {
        "manufacturer_name_address": make_field("manufacturer_name_address", "Manufactured by Tasty Bites Foods Pvt Ltd, New Delhi 110020"),
        "common_name": make_field("common_name", "Biscuits"),
        "net_quantity": make_field("net_quantity", "100g"),
        # MRP missing intentionally
        "consumer_care": make_field("consumer_care", "customercare@tastybites.com, 1800-111-2222"),
    }

    verdict = evaluate_package(pkg, fields, mvp_rules, RULES_DIR)
    assert verdict.overall_result == "FAIL"
    mrp_eval = next(e for e in verdict.evaluations if e.rule_id == "LMPC-6.1.e")
    assert mrp_eval.result == "FAIL"


def test_evaluator_mrp_without_taxes_fails(mvp_rules):
    pkg = Package(package_id="pkg_mrp_no_tax", category="packaged_food")
    mrp_rule = next(r for r in mvp_rules if r.rule_id == "LMPC-6.1.e")

    # Has price, but no 'inclusive of all taxes'
    res, note = evaluate_condition(mrp_rule, "MRP Rs. 45.00", pkg)
    assert res == "FAIL"
    assert "inclusive of all taxes" in note

    # Valid with taxes
    res_pass, _ = evaluate_condition(mrp_rule, "Max. Retail Price ₹ 45.00 (inclusive of all taxes)", pkg)
    assert res_pass == "PASS"


def test_evaluator_address_ambiguous_needs_review(mvp_rules):
    pkg = Package(package_id="pkg_sparse_address", category="packaged_food")
    addr_rule = next(r for r in mvp_rules if r.rule_id == "LMPC-6.1.a")

    # Short address with no PIN or details
    res, note = evaluate_condition(addr_rule, "Mfg Mumbai", pkg)
    assert res == "NEEDS_REVIEW"


def test_evaluator_small_package_exception(mvp_rules):
    # Package capacity <= 5 cc (e.g. small chewing gum or candy)
    pkg = Package(
        package_id="pkg_small_candy",
        category="packaged_food",
        package_capacity_cc=4.0,
    )
    addr_rule = next(r for r in mvp_rules if r.rule_id == "LMPC-6.1.a")

    # Identifying mark sufficient under Rule 10(1) first proviso
    res, note = evaluate_condition(addr_rule, "TB", pkg)
    assert res == "PASS"
    assert "Rule 10(1)" in note


def test_first_schedule_tolerance_evaluation(all_rules):
    pkg = Package(
        package_id="pkg_tolerance_test",
        category="packaged_food",
        declared_net_quantity=100.0,
    )
    tolerance_rule = next(r for r in all_rules if r.rule_id == "LMPC-6.1.c-tolerance")

    # Without measured quantity in extra_context -> NEEDS_REVIEW
    res_no_data, _ = evaluate_condition(tolerance_rule, "100g", pkg, extra_context={})
    assert res_no_data == "NEEDS_REVIEW"

    # For 100g, First Schedule Table 1 allows 4.5% = 4.5g MPE.
    # Measured = 98.0g (diff = 2.0g <= 4.5g) -> PASS
    res_pass, _ = evaluate_condition(tolerance_rule, "100g", pkg, extra_context={"measured_net_quantity": 98.0})
    assert res_pass == "PASS"

    # Measured = 92.0g (diff = 8.0g > 4.5g) -> FAIL
    res_fail, _ = evaluate_condition(tolerance_rule, "100g", pkg, extra_context={"measured_net_quantity": 92.0})
    assert res_fail == "FAIL"
