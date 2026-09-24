from __future__ import annotations
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import io
import pytest
from PIL import Image, ImageDraw
from fastapi.testclient import TestClient

from main import app


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


@pytest.fixture(scope="module")
def sample_image_bytes():
    img = Image.new("RGB", (600, 400), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.text((20, 20), "CREAM CRUNCH BISCUITS", fill=(0, 0, 0))
    draw.text((20, 60), "Net Quantity: 100 g", fill=(0, 0, 0))
    draw.text((20, 100), "MRP Rs. 35.00 incl. of all taxes", fill=(0, 0, 0))
    draw.text((20, 140), "Manufactured by: Tasty Foods Pvt Ltd, Delhi 110020", fill=(0, 0, 0))
    draw.text((20, 180), "Consumer Care: care@tastyfoods.com, 1800-111-2222", fill=(0, 0, 0))

    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def test_api_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_api_rules(client):
    res = client.get("/api/rules")
    assert res.status_code == 200
    rules = res.json()
    assert len(rules) >= 5
    rule_ids = [r["rule_id"] for r in rules]
    assert "LMPC-6.1.a" in rule_ids
    assert "LMPC-6.1.e" in rule_ids


def test_package_lifecycle_end_to_end(client, sample_image_bytes):
    # 1. Upload package
    upload_res = client.post(
        "/api/packages",
        files={"file": ("biscuit.jpg", sample_image_bytes, "image/jpeg")},
        data={"category": "packaged_food"},
    )
    assert upload_res.status_code == 201
    pkg_id = upload_res.json()["package_id"]
    assert pkg_id.startswith("pkg_")

    # 2. Extract fields
    extract_res = client.post(f"/api/packages/{pkg_id}/extract", params={"ocr_provider": "rapidocr"})
    assert extract_res.status_code == 200
    fields = extract_res.json()["fields"]
    assert len(fields) > 0

    # 3. Try to evaluate BEFORE human confirmation (Must be blocked with HTTP 400 per Phase 3)
    early_eval_res = client.post(f"/api/packages/{pkg_id}/evaluate")
    assert early_eval_res.status_code == 400
    assert "Mandatory Phase 3 review incomplete" in early_eval_res.json()["detail"]

    # 4. Human confirms the fields (Phase 3 Review Screen action)
    confirm_payload = [
        {
            "field_name": f["field_name"],
            "confirmed_value": f["suggested_value"] if f.get("suggested_value") else f["raw_value"],
            "reviewer_action": "accepted_suggestion" if f.get("suggested_value") else "accepted_raw",
        }
        for f in fields
    ]
    patch_res = client.patch(f"/api/packages/{pkg_id}/extracted-fields", json=confirm_payload)
    assert patch_res.status_code == 200
    assert patch_res.json()["updated"] is True

    # 5. Evaluate compliance (Phase 4 Evaluator)
    eval_res = client.post(f"/api/packages/{pkg_id}/evaluate")
    assert eval_res.status_code == 200
    verdict = eval_res.json()
    assert verdict["package_id"] == pkg_id
    assert verdict["overall_result"] in ["PASS", "FAIL", "NEEDS_REVIEW"]
    assert len(verdict["evaluations"]) > 0

    # 6. Retrieve verdict via GET /api/packages/{package_id}
    get_res = client.get(f"/api/packages/{pkg_id}")
    assert get_res.status_code == 200
    pkg_details = get_res.json()
    assert pkg_details["package_id"] == pkg_id
    assert pkg_details["verdict"] is not None


def test_review_queue_and_decision(client):
    # Review queue listing
    res = client.get("/api/review-queue")
    assert res.status_code == 200
    assert isinstance(res.json(), list)


def test_label_diff_api(client, sample_image_bytes):
    # Upload two packages
    u1 = client.post("/api/packages", files={"file": ("v1.jpg", sample_image_bytes, "image/jpeg")})
    u2 = client.post("/api/packages", files={"file": ("v2.jpg", sample_image_bytes, "image/jpeg")})
    p1 = u1.json()["package_id"]
    p2 = u2.json()["package_id"]

    client.post(f"/api/packages/{p1}/extract")
    client.post(f"/api/packages/{p2}/extract")

    diff_res = client.post("/api/label-diff", json={"package_id_a": p1, "package_id_b": p2})
    assert diff_res.status_code == 200
    diff_data = diff_res.json()
    assert diff_data["package_id_a"] == p1
    assert diff_data["package_id_b"] == p2
    assert "field_diffs" in diff_data
    assert "summary" in diff_data
