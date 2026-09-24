"""
Tests for CompliLens Multi-Revision Packaging Evolution & Diff Engine.
Verifies chronological sequencing, shrinkflation calculations, compliance drift,
FSSAI/barcode detection, and single-prompt semantic diff structure.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from pipeline.diff_engine import (
    parse_numeric_quantity,
    parse_numeric_price,
    parse_revision_date,
    compute_shrinkflation,
    extract_fssai_and_barcodes,
    compute_compliance_progression,
    compute_multi_revision_diff,
)
from pipeline.diff_llm import _local_heuristic_diff


def test_parse_numeric_quantity():
    val, unit = parse_numeric_quantity("Net Quantity: 250 g")
    assert val == 250.0
    assert unit == "g"

    val_kg, unit_kg = parse_numeric_quantity("1.5 kg")
    assert val_kg == 1500.0
    assert unit_kg == "g"

    val_ml, unit_ml = parse_numeric_quantity("500 ml")
    assert val_ml == 500.0
    assert unit_ml == "ml"


def test_parse_numeric_price():
    assert parse_numeric_price("MRP Rs. 55.00 incl. of all taxes") == 55.0
    assert parse_numeric_price("Price: Rs 40.00") == 40.0
    assert parse_numeric_price("₹120.50") == 120.5


def test_parse_revision_date_and_sorting():
    d1 = parse_revision_date("01/2025")
    d2 = parse_revision_date("06/2025")
    d3 = parse_revision_date("02/2026")

    assert d1 < d2 < d3

    unsorted = [
        {"fields": {"mfg_month_year": "06/2026"}},
        {"fields": {"mfg_month_year": "01/2025"}},
        {"fields": {"mfg_month_year": "12/2025"}},
    ]
    sorted_revs = sorted(unsorted, key=lambda r: parse_revision_date(r["fields"]["mfg_month_year"]))
    assert sorted_revs[0]["fields"]["mfg_month_year"] == "01/2025"
    assert sorted_revs[1]["fields"]["mfg_month_year"] == "12/2025"
    assert sorted_revs[2]["fields"]["mfg_month_year"] == "06/2026"


def test_shrinkflation_detection():
    # Rev 1: 200g @ Rs 50 -> Unit price = Rs 25 / 100g
    # Rev 2: 175g @ Rs 50 -> Unit price = Rs 28.57 / 100g (+14.3%)
    revisions = [
        {"fields": {"net_quantity": "Net Qty: 200 g", "mrp": "MRP Rs. 50.00"}},
        {"fields": {"net_quantity": "Net Qty: 175 g", "mrp": "MRP Rs. 50.00"}},
    ]
    shrink = compute_shrinkflation(revisions)
    assert shrink is not None
    assert shrink["is_shrinkflation"] is True
    assert shrink["old_net_quantity"] == "200 g"
    assert shrink["new_net_quantity"] == "175 g"
    assert shrink["unit_price_delta_pct"] > 14.0


def test_shrinkflation_quantity_only_fallback():
    revisions = [
        {"fields": {"net_quantity": "Net Qty: 200 g"}},
        {"fields": {"net_quantity": "Net Qty: 175 g"}},
    ]
    shrink = compute_shrinkflation(revisions)
    assert shrink is not None
    assert shrink["is_shrinkflation"] is True
    assert shrink["unit_price_delta_pct"] is None
    assert shrink["qty_delta_pct"] < 0


def test_fssai_and_barcodes_extraction():
    text = (
        "Manufactured by XYZ Ltd. FSSAI Lic.No. 10017022006789. "
        "Also packed at unit 12221023000456. Barcode: 8906123456789."
    )
    res = extract_fssai_and_barcodes(text)
    assert "10017022006789" in res["fssai_licenses"]
    assert "12221023000456" in res["fssai_licenses"]
    assert "8906123456789" in res["barcodes"]


def test_compliance_progression():
    # Rev 1 failed Rule 6(1)(e) (missing taxes)
    # Rev 2 passed Rule 6(1)(e) (taxes added) -> REMEDIATION
    # Rev 1 passed Rule 6(1)(a) (name), Rev 2 failed Rule 6(1)(a) -> REGRESSION
    rev1 = {
        "verdict": {
            "evaluations": [
                {"rule_id": "rule_6_1_e_mrp_taxes", "field_name": "mrp", "result": "FAIL"},
                {"rule_id": "rule_6_1_a_commodity", "field_name": "common_name", "result": "PASS"},
            ]
        }
    }
    rev2 = {
        "verdict": {
            "evaluations": [
                {"rule_id": "rule_6_1_e_mrp_taxes", "field_name": "mrp", "result": "PASS"},
                {"rule_id": "rule_6_1_a_commodity", "field_name": "common_name", "result": "FAIL"},
            ]
        }
    }

    prog = compute_compliance_progression([rev1, rev2])
    assert len(prog["remediations"]) == 1
    assert prog["remediations"][0]["rule_id"] == "rule_6_1_e_mrp_taxes"
    assert len(prog["regressions"]) == 1
    assert prog["regressions"][0]["rule_id"] == "rule_6_1_a_commodity"


def test_semantic_diff_heuristic_fallback():
    revs = [
        {
            "package_id": "pkg_1",
            "mfg_date": "01/2025",
            "full_text": "Ingredients: Wheat Flour, Sugar, Sunflower Oil. Contains Wheat. 100% Natural.",
        },
        {
            "package_id": "pkg_2",
            "mfg_date": "06/2026",
            "full_text": "Ingredients: Wheat Flour, Sugar, Palm Oil. Contains Wheat, Peanuts. No Artificial Colours.",
        },
    ]

    res = _local_heuristic_diff(revs)
    assert "ingredients_summary" in res
    assert "allergens_summary" in res
    # Detected palm oil substitution
    assert len(res["ingredients_summary"]["substitutions"]) > 0
    # Detected newly declared peanuts allergen
    assert "Peanuts" in res["allergens_summary"]["added"]
    assert res["allergens_summary"]["risk_level"] == "HIGH"
    # Detected marketing claims changes
    assert "No Artificial Colours" in res["marketing_claims_summary"]["added_claims"]
    assert "100% Natural" in res["marketing_claims_summary"]["dropped_claims"]


def test_compute_multi_revision_diff_end_to_end():
    revs = [
        {
            "package_id": "pkg_rev2",
            "image_url": "/static/uploads/rev2.jpg",
            "mfg_date": "08/2026",
            "fields": {
                "mrp": "MRP Rs. 60.00 incl. of all taxes",
                "net_quantity": "Net Qty: 180 g",
                "mfg_month_year": "08/2026",
            },
            "full_text": "FSSAI 10017022006789. Barcode: 8906123456789. Ingredients: Oats, Palm Oil.",
            "verdict": {"evaluations": []},
        },
        {
            "package_id": "pkg_rev1",
            "image_url": "/static/uploads/rev1.jpg",
            "mfg_date": "01/2025",
            "fields": {
                "mrp": "MRP Rs. 60.00 incl. of all taxes",
                "net_quantity": "Net Qty: 200 g",
                "mfg_month_year": "01/2025",
            },
            "full_text": "FSSAI 10017022006789. Barcode: 8906123456789. Ingredients: Oats, Sunflower Oil.",
            "verdict": {"evaluations": []},
        },
    ]

    diff = compute_multi_revision_diff(revs)
    assert diff["num_revisions"] == 2
    # Ensure chronological order: rev1 (01/2025) before rev2 (08/2026)
    assert diff["revisions"][0]["package_id"] == "pkg_rev1"
    assert diff["revisions"][1]["package_id"] == "pkg_rev2"
    # Shrinkflation detected (200g -> 180g at Rs 60)
    assert diff["shrinkflation"]["is_shrinkflation"] is True
    # FSSAI captured
    assert "10017022006789" in diff["revisions"][0]["fssai_licenses"]


def test_compute_lmpc_rules_matrix():
    from pipeline.diff_engine import compute_lmpc_rules_matrix
    revs = [
        {
            "package_id": "rev1",
            "verdict": {
                "evaluations": [
                    {
                        "rule_id": "LMPC-6.1.e",
                        "result": "FAIL",
                        "notes": "Missing 'inclusive of all taxes' declaration",
                        "extracted_value": "Rs. 60",
                    }
                ]
            },
            "fields": {"mrp": "Rs. 60"},
        },
        {
            "package_id": "rev2",
            "verdict": {
                "evaluations": [
                    {
                        "rule_id": "LMPC-6.1.e",
                        "result": "PASS",
                        "notes": "Passed: 'MRP Rs. 60.00 (inclusive of all taxes)'",
                        "extracted_value": "MRP Rs. 60.00 (inclusive of all taxes)",
                    }
                ]
            },
            "fields": {"mrp": "MRP Rs. 60.00 (inclusive of all taxes)"},
        },
    ]
    rules_meta = {
        "LMPC-6.1.e": {
            "rule_id": "LMPC-6.1.e",
            "description": "Retail sale price MRP inclusive of all taxes",
            "source_citation": "Rule 6(1)(e)",
            "required_field": "mrp",
        }
    }
    matrix = compute_lmpc_rules_matrix(revs, rules_meta)
    assert len(matrix) == 1
    rule_entry = matrix[0]
    assert rule_entry["rule_id"] == "LMPC-6.1.e"
    assert rule_entry["drift"] == "REMEDIATED"
    assert rule_entry["evaluations"][0]["result"] == "FAIL"
    assert "inclusive of all taxes" in rule_entry["evaluations"][0]["notes"]
    assert rule_entry["evaluations"][1]["result"] == "PASS"


def test_extract_non_statutory_from_text():
    from pipeline.diff_llm import extract_non_statutory_from_text
    sample_ocr = (
        "CRUNCHY NUT COOKIES 100% VEG Deliciously crunchy. "
        "INGREDIENTS: Refined Wheat Flour (Maida) (50%), Sugar, Edible Vegetable Oil (Palmolein), Almonds (10%). "
        "Contains: Wheat, Gluten, Milk. May contain traces of Peanuts. "
        "Nutritional Information Per 100g: Energy 480 kcal, Protein 6.5 g, Carbohydrate 68 g, Total Sugars 24 g, Sodium 220 mg. "
        "Zero Trans Fat. Goodness in Every Bite."
    )
    res = extract_non_statutory_from_text(sample_ocr)
    assert len(res["ingredients_list"]) >= 3
    assert any("Wheat" in i for i in res["ingredients_list"])
    assert "Wheat" in res["allergens"]
    assert "Gluten" in res["allergens"]
    assert res["nutrition_table"]["Energy"] == "480 kcal"
    assert "100% Veg" in res["marketing_claims"]
    assert "Zero Trans Fat" in res["marketing_claims"]


def test_compute_statutory_diffs():
    from pipeline.diff_engine import compute_statutory_diffs
    revs = [
        {
            "package_id": "rev1",
            "fields": {
                "mrp": "MRP Rs. 55.00 incl. of all taxes",
                "net_quantity": "Net Quantity: 250 g",
                "mfg_month_year": "03/2023",
                "common_name": "GOLDEN HARVEST OAT BISCUITS",
            }
        },
        {
            "package_id": "rev2",
            "fields": {
                "mrp": "MRP Rs. 60.00 (inclusive of all taxes)",
                "net_quantity": "Net Quantity: 200 g",
                "mfg_month_year": "08/2023",
                "common_name": "CRUNCHY NUT COOKIES",
            }
        },
    ]
    diffs = compute_statutory_diffs(revs)
    mrp_diff = next(d for d in diffs if d["field_name"] == "mrp")
    assert mrp_diff["changed"] is True
    assert mrp_diff["change_type"] == "INCREASE"
    assert "+₹5.00 (+9.1%)" in mrp_diff["delta_badge"]
    assert "increased by ₹5.00" in mrp_diff["summary"]

    qty_diff = next(d for d in diffs if d["field_name"] == "net_quantity")
    assert qty_diff["changed"] is True
    assert qty_diff["change_type"] == "DOWNSIZED"
    assert "-50 g (-20.0%)" in qty_diff["delta_badge"]
    assert "downsized by 50 g" in qty_diff["summary"]

    mfg_diff = next(d for d in diffs if d["field_name"] == "mfg_month_year")
    assert mfg_diff["changed"] is True
    assert mfg_diff["change_type"] == "ADVANCED"
    assert "+5 mo" in mfg_diff["delta_badge"]

    name_diff = next(d for d in diffs if d["field_name"] == "common_name")
    assert name_diff["changed"] is True
    assert name_diff["change_type"] == "CHANGED"
    assert "CRUNCHY NUT COOKIES" in name_diff["summary"]


def test_net_quantity_ignores_nutrition_weights():
    from pipeline.field_classification import classify_tokens_to_fields, OcrToken
    # Tokens from a nutritional facts column without explicit Net Qty indicator
    nutrition_tokens = [
        OcrToken(text="Nutritional Facts per 100g", bbox=[10, 10, 100, 15], confidence=0.95, ocr_source="rapidocr"),
        OcrToken(text="Protein", bbox=[10, 30, 40, 15], confidence=0.95, ocr_source="rapidocr"),
        OcrToken(text="7.2 g", bbox=[60, 30, 30, 15], confidence=0.95, ocr_source="rapidocr"),
        OcrToken(text="Total Fat", bbox=[10, 50, 45, 15], confidence=0.95, ocr_source="rapidocr"),
        OcrToken(text="16 g", bbox=[60, 50, 25, 15], confidence=0.95, ocr_source="rapidocr"),
    ]
    fields = classify_tokens_to_fields(nutrition_tokens)
    assert "net_quantity" not in fields

    # When explicit Net Quantity token is present
    net_tokens = nutrition_tokens + [
        OcrToken(text="Net Quantity:", bbox=[10, 100, 60, 15], confidence=0.95, ocr_source="rapidocr"),
        OcrToken(text="200 g", bbox=[75, 100, 30, 15], confidence=0.95, ocr_source="rapidocr"),
    ]
    fields_with_net = classify_tokens_to_fields(net_tokens)
    assert "net_quantity" in fields_with_net
    assert "200 g" in fields_with_net["net_quantity"].raw_value


def test_multi_revision_diff_with_percentage_changes():
    from pipeline.diff_engine import compute_multi_revision_diff
    revs = [
        {
            "package_id": "rev1",
            "fields": {"net_quantity": "Net Quantity: 200 g", "mrp": "MRP Rs. 50.00"},
            "non_statutory": {
                "ingredients_text": "Refined Wheat Flour (Maida) (40%), Rolled Oats (15%), Sugar",
                "ingredients_list": ["Refined Wheat Flour (Maida) (40%)", "Rolled Oats (15%)", "Sugar"],
            },
        },
        {
            "package_id": "rev2",
            "fields": {"net_quantity": "Net Quantity: 200 g", "mrp": "MRP Rs. 50.00"},
            "non_statutory": {
                "ingredients_text": "Maida (47%), Rolled Oats (8%), Sugar",
                "ingredients_list": ["Maida (47%)", "Rolled Oats (8%)", "Sugar"],
            },
        }
    ]
    result = compute_multi_revision_diff(revs, auto_sort_by_date=False)
    assert result["num_revisions"] == 2
    assert "ingredients_diff" in result


def test_clean_net_quantity_declaration_removes_filler():
    from pipeline.field_classification import clean_net_quantity_declaration
    assert clean_net_quantity_declaration("NUTRITIONAL FACTS Net Quantity: 250 g") == "Net Quantity: 250 g"
    assert clean_net_quantity_declaration("Approximate Values Per 100g Net Qty: 200 g") == "Net Qty: 200 g"
    assert clean_net_quantity_declaration("Batch A12 Net Weight: 500 ml") == "Net Weight: 500 ml"
    assert clean_net_quantity_declaration("Net Quanity: 250 g") == "250 g"
    assert clean_net_quantity_declaration("200 g") == "200 g"


def test_clean_manufacturer_address_removes_weights():
    from pipeline.field_classification import clean_manufacturer_address
    dirty_addr_1 = "Manufactured by:, ed by:, 18 g, NutriBite Foods Pvt. Ltd., 16 g, Plot 12, Phase Il, Hinjewadi, Pune 411057, India."
    cleaned_1 = clean_manufacturer_address(dirty_addr_1)
    assert "18 g" not in cleaned_1
    assert "16 g" not in cleaned_1
    assert ", ed by" not in cleaned_1
    assert "Manufactured by:" in cleaned_1
    assert "NutriBite Foods Pvt. Ltd." in cleaned_1
    assert "Pune 411057" in cleaned_1

    dirty_addr_2 = "Manufactured by:, 21 g, NutriBite Foods Pvt. Ltd.,, 19 g, Plot 12, Phase Il, Hinjewadi, Pune 411057, India."
    cleaned_2 = clean_manufacturer_address(dirty_addr_2)
    assert "21 g" not in cleaned_2
    assert "19 g" not in cleaned_2
    assert "NutriBite Foods Pvt. Ltd." in cleaned_2


def test_digestive_biscuit_common_name_extraction():
    from pipeline.field_classification import classify_tokens_to_fields, OcrToken
    tokens = [
        # Large nutritional header box that previously erroneously won
        OcrToken(
            text="NUTRITIONALINFORMATION (Approximate Values) Energy Protein Carbohydrate Total Sugars Total Fat Sodium",
            bbox=[598, 332, 227, 303],
            confidence=0.99,
            ocr_source="rapidocr",
        ),
        # Real product title tokens
        OcrToken(
            text="WHOLE WHEAT & OAT",
            bbox=[193, 170, 350, 38],
            confidence=0.98,
            ocr_source="rapidocr",
        ),
        OcrToken(
            text="DIGESTIVE BISCUITS",
            bbox=[193, 212, 445, 45],
            confidence=0.98,
            ocr_source="rapidocr",
        ),
    ]
    fields = classify_tokens_to_fields(tokens)
    assert "common_name" in fields
    assert "DIGESTIVE BISCUITS" in fields["common_name"].raw_value
    assert "NUTRITIONAL" not in fields["common_name"].raw_value
    assert "Energy" not in fields["common_name"].raw_value



