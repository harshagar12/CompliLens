from __future__ import annotations
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from models.schemas import Package, Rule
from engine.applicability import filter_applicable_rules
from engine.evaluator import load_rules


RULES_DIR = Path(__file__).parent.parent / "engine" / "rules"


@pytest.fixture
def loaded_rules():
    return load_rules(RULES_DIR)


def test_rule_26_a_full_exemption_under_10g(loaded_rules):
    pkg = Package(
        package_id="pkg_under_10g",
        category="packaged_food",
        declared_net_quantity=8.0,
        declared_net_quantity_unit="g",
    )
    res = filter_applicable_rules(pkg, loaded_rules, RULES_DIR)
    assert res.status == "FULLY_EXEMPT"
    assert res.exemption_id == "LMPC-26.a"
    assert len(res.applicable_rules) == 0


def test_rule_26_a_proviso_partial_exemption_10_to_20g(loaded_rules):
    pkg = Package(
        package_id="pkg_15g",
        category="packaged_food",
        declared_net_quantity=15.0,
        declared_net_quantity_unit="g",
    )
    res = filter_applicable_rules(pkg, loaded_rules, RULES_DIR)
    assert res.status == "PARTIALLY_EXEMPT"
    assert res.exemption_id == "LMPC-26.a-proviso"
    # Only mrp and net_quantity should remain applicable
    req_fields = {r.required_field for r in res.applicable_rules}
    assert req_fields.issubset({"mrp", "net_quantity"})


def test_rule_26_b_restaurant_fast_food(loaded_rules):
    pkg = Package(
        package_id="pkg_fast_food",
        category="restaurant_fast_food",
        declared_net_quantity=250.0,
    )
    res = filter_applicable_rules(pkg, loaded_rules, RULES_DIR)
    assert res.status == "FULLY_EXEMPT"
    assert res.exemption_id == "LMPC-26.b"


def test_standard_packaged_food_applicability(loaded_rules):
    pkg = Package(
        package_id="pkg_biscuit_100g",
        category="packaged_food",
        declared_net_quantity=100.0,
        declared_net_quantity_unit="g",
    )
    res = filter_applicable_rules(pkg, loaded_rules, RULES_DIR)
    assert res.status == "APPLICABLE"
    rule_ids = {r.rule_id for r in res.applicable_rules}
    # LMPC-6.1.a (manufacturer address), LMPC-6.1.b (common name), LMPC-6.1.c (net qty), LMPC-6.1.e (mrp), LMPC-6.2 (consumer care)
    assert "LMPC-6.1.a" in rule_ids
    assert "LMPC-6.1.b" in rule_ids
    assert "LMPC-6.1.c" in rule_ids
    assert "LMPC-6.1.e" in rule_ids
    assert "LMPC-6.2" in rule_ids
    # Rule 6(1)(d) (mfg date) is explicitly excluded for food per clause proviso
    assert "LMPC-6.1.d" not in rule_ids
