"""
Unit and Integration tests for CompliLens Relational Database,
PRD §8.2 Product History Dashboard, and PRD §8.5 Manufacturer-Level Dashboard.
"""
import sys
from pathlib import Path

backend_dir = Path(__file__).parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

import pytest
from datetime import datetime, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database.connection import Base
from database.models import ManufacturerModel, ProductModel, PackageModel, ExtractedFieldModel, EvaluationModel, PackageVerdictModel
from database.repository import (
    resolve_product_identity,
    sync_package_to_database,
    list_all_products,
    get_product_history,
    list_all_manufacturers,
    get_manufacturer_summary,
)
from main import app


@pytest.fixture(scope="module")
def test_db():
    """In-memory SQLite database for testing isolation."""
    test_engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=test_engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    db = TestingSessionLocal()
    yield db
    db.close()


def test_product_identity_resolution(test_db):
    """PRD §8.3: Tests canonical entity resolution and barcode matching."""
    fields_1 = {
        "manufacturer_name_address": {"confirmed_value": "Manufactured by: Britannia Industries Ltd., Bangalore 560001"},
        "common_name": {"confirmed_value": "NutriChoice Digestive Biscuits"},
        "net_quantity": {"confirmed_value": "100 g"},
    }
    prod_1, mfg_1 = resolve_product_identity(test_db, fields_1, barcode="8901063012345")
    assert prod_1 is not None
    assert mfg_1 is not None
    assert "britannia" in mfg_1.manufacturer_key.lower()
    assert "nutrichoice" in prod_1.product_key.lower()

    # Re-running with same barcode should resolve to the exact same product entity
    fields_2 = {
        "manufacturer_name_address": {"confirmed_value": "Britannia Industries Bangalore"},
        "common_name": {"confirmed_value": "Digestive Biscuits"},
        "net_quantity": {"confirmed_value": "100 g"},
    }
    prod_2, mfg_2 = resolve_product_identity(test_db, fields_2, barcode="8901063012345")
    assert prod_2.product_key == prod_1.product_key
    assert mfg_2.manufacturer_key == mfg_1.manufacturer_key


def test_package_sync_and_history_regression_tracking(test_db):
    """PRD §8.2: Tests history timeline, fail counts, and prominent regression detection."""
    base_time = datetime(2026, 1, 1, 10, 0, 0)
    
    # Inspection 1 (Batch 1): Passing all rules
    fields_rev1 = {
        "manufacturer_name_address": {"confirmed_value": "Parle Products Pvt. Ltd., Mumbai"},
        "common_name": {"confirmed_value": "Hide & Seek Choco Chip Cookies"},
        "net_quantity": {"confirmed_value": "120 g"},
        "mrp": {"confirmed_value": "Rs. 30.00"},
        "mfg_month_year": {"confirmed_value": "01/2026"},
    }
    verdict_rev1 = {
        "overall_result": "PASS",
        "evaluations": [
            {"rule_id": "LMPC-6.1.a", "field_name": "manufacturer_name_address", "result": "PASS", "confidence": 0.99},
            {"rule_id": "LMPC-6.1.b", "field_name": "common_name", "result": "PASS", "confidence": 0.99},
            {"rule_id": "LMPC-6.1.c", "field_name": "net_quantity", "result": "PASS", "confidence": 0.99},
            {"rule_id": "LMPC-6.1.d", "field_name": "mfg_month_year", "result": "PASS", "confidence": 0.99},
            {"rule_id": "LMPC-6.1.e", "field_name": "mrp", "result": "PASS", "confidence": 0.99},
        ]
    }
    sync_package_to_database(
        test_db,
        package_id="pkg_parle_rev1",
        category="packaged_food",
        image_filename="pkg_parle_rev1.jpg",
        fields=fields_rev1,
        verdict=verdict_rev1,
        created_at_dt=base_time
    )

    # Inspection 2 (Batch 2): Regression! Net quantity is missing/regressed to FAIL
    fields_rev2 = {
        "manufacturer_name_address": {"confirmed_value": "Parle Products Pvt. Ltd., Mumbai"},
        "common_name": {"confirmed_value": "Hide & Seek Choco Chip Cookies"},
        "net_quantity": {"confirmed_value": ""},  # Dropped net quantity
        "mrp": {"confirmed_value": "Rs. 35.00"},
        "mfg_month_year": {"confirmed_value": "02/2026"},
    }
    verdict_rev2 = {
        "overall_result": "FAIL",
        "evaluations": [
            {"rule_id": "LMPC-6.1.a", "field_name": "manufacturer_name_address", "result": "PASS", "confidence": 0.99},
            {"rule_id": "LMPC-6.1.b", "field_name": "common_name", "result": "PASS", "confidence": 0.99},
            {"rule_id": "LMPC-6.1.c", "field_name": "net_quantity", "result": "FAIL", "confidence": 0.99},
            {"rule_id": "LMPC-6.1.d", "field_name": "mfg_month_year", "result": "PASS", "confidence": 0.99},
            {"rule_id": "LMPC-6.1.e", "field_name": "mrp", "result": "PASS", "confidence": 0.99},
        ]
    }
    sync_package_to_database(
        test_db,
        package_id="pkg_parle_rev2",
        category="packaged_food",
        image_filename="pkg_parle_rev2.jpg",
        fields=fields_rev2,
        verdict=verdict_rev2,
        created_at_dt=base_time + timedelta(days=30)
    )

    # Find the product key
    products = list_all_products(test_db)
    parle_prods = [p for p in products if "hide" in p["common_name"].lower()]
    assert len(parle_prods) >= 1
    parle_key = parle_prods[0]["product_key"]
    assert parle_prods[0]["has_active_regression"] is True

    # Check detailed history
    hist = get_product_history(test_db, parle_key)
    assert hist is not None
    assert hist["total_inspections"] == 2
    assert hist["has_active_regression"] is True
    assert len(hist["entries"]) == 2
    assert hist["entries"][0]["overall_result"] == "PASS"
    assert hist["entries"][1]["overall_result"] == "FAIL"
    assert hist["entries"][1]["is_regression"] is True
    assert any("LMPC-6.1.c" in r for r in hist["entries"][1]["regression_details"])
    assert len(hist["entries"][1]["failing_rules"]) >= 1
    assert hist["entries"][1]["failing_rules"][0]["rule_id"] == "LMPC-6.1.c"
    assert hist["entries"][1]["failing_rules"][0]["notes"] != ""


def test_manufacturer_dashboard_and_pareto(test_db):
    """PRD §8.5: Tests manufacturer risk tiering, compliance score, and Pareto violation breakdown."""
    manufacturers = list_all_manufacturers(test_db)
    assert len(manufacturers) >= 1
    parle_mfg = next((m for m in manufacturers if "parle" in m["manufacturer_name"].lower()), None)
    assert parle_mfg is not None
    assert parle_mfg["risk_level"] in ["MEDIUM", "HIGH"]
    assert parle_mfg["active_regressions_count"] >= 1
    assert "current_compliance_score" in parle_mfg
    assert "historical_compliance_score" in parle_mfg

    summary = get_manufacturer_summary(test_db, parle_mfg["manufacturer_key"])
    assert summary is not None
    assert summary["compliance_score"] < 100.0
    assert summary["current_compliance_score"] < 100.0
    assert "current_statutory_violations" in summary
    assert "historical_statutory_violations" in summary
    assert len(summary["statutory_violations_breakdown"]) >= 1
    top_viol = summary["statutory_violations_breakdown"][0]
    assert top_viol["rule_id"] == "LMPC-6.1.c"
    assert top_viol["fail_count"] >= 1


def test_fastapi_endpoints():
    """Validates FastAPI HTTP endpoints for products and manufacturers."""
    client = TestClient(app)
    
    res_prods = client.get("/api/products")
    assert res_prods.status_code == 200
    prods = res_prods.json()
    assert isinstance(prods, list)

    if prods:
        first_key = prods[0]["product_key"]
        res_hist = client.get(f"/api/products/{first_key}/history")
        assert res_hist.status_code == 200
        hist = res_hist.json()
        assert hist["product_key"] == first_key
        assert "entries" in hist
        assert "trend" in hist

    res_mfgs = client.get("/api/manufacturers")
    assert res_mfgs.status_code == 200
    mfgs = res_mfgs.json()
    assert isinstance(mfgs, list)

    if mfgs:
        first_mfg_key = mfgs[0]["manufacturer_key"]
        res_sum = client.get(f"/api/manufacturers/{first_mfg_key}/summary")
        assert res_sum.status_code == 200
        sum_data = res_sum.json()
        assert sum_data["manufacturer_key"] == first_mfg_key
        assert "statutory_violations_breakdown" in sum_data
        assert "risk_level" in sum_data


if __name__ == "__main__":
    from database.connection import Base
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    print("Running database and history test suite directly...")
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSession()

    print("Testing product identity resolution...")
    test_product_identity_resolution(db)
    print("[PASS] Product identity resolution passed.")

    print("Testing package sync and history regression tracking...")
    test_package_sync_and_history_regression_tracking(db)
    print("[PASS] Package sync and history regression tracking passed.")

    print("Testing manufacturer dashboard and Pareto violation breakdown...")
    test_manufacturer_dashboard_and_pareto(db)
    print("[PASS] Manufacturer dashboard and Pareto breakdown passed.")

    print("Testing FastAPI endpoints...")
    test_fastapi_endpoints()
    print("[PASS] FastAPI endpoints passed.")

    print("\nALL DATABASE & HISTORY TESTS PASSED SUCCESSFULLY!")
