"""
CompliLens — FastAPI Backend Service.
Provides REST endpoints matching PRD §6 for package upload, perception extraction,
human verification of extracted declarations, deterministic rule evaluation, and review queue triage.
"""
from __future__ import annotations
import os
import sys
import uuid
from pathlib import Path
from typing import Literal, Any

# Ensure backend directory is in sys.path
backend_dir = Path(__file__).parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
load_dotenv(backend_dir / ".env")

import yaml
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, status, Depends, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.orm import Session

from models.schemas import (
    Package,
    ExtractedField,
    Evaluation,
    PackageVerdict,
    ConfirmedFieldUpdate,
    ReviewerDecisionRequest,
    Rule,
    ProductListItem,
    ProductHistory,
    ManufacturerListItem,
    ManufacturerSummary,
)
from pipeline.pipeline import run_perception_pipeline
from pipeline.field_classification import clean_net_quantity_declaration, clean_manufacturer_address
from engine.evaluator import load_rules, evaluate_package
from storage import storage, UPLOADS_DIR, CROPS_DIR
from database.connection import init_db, get_db, SessionLocal


app = FastAPI(
    title="CompliLens API",
    description="Automated Legal Metrology Compliance and Inspection System for Packaged Commodities",
    version="1.0.0",
)


@app.on_event("startup")
def on_startup():
    try:
        init_db()
        with SessionLocal() as db:
            from database.repository import migrate_legacy_db_if_needed
            migrate_legacy_db_if_needed(db)
    except Exception as e:
        import logging
        logging.getLogger("complilens").warning(f"Startup DB init warning: {e}")

# CORS configuration for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static file directories for serving original images and cropped evidence snippets
app.mount("/static/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")
app.mount("/static/crops", StaticFiles(directory=str(CROPS_DIR)), name="crops")


def get_config() -> dict:
    cfg_path = Path(__file__).parent.parent / "config" / "thresholds.yaml"
    if cfg_path.exists():
        with open(cfg_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    return {}


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "CompliLens Backend", "version": "1.0.0"}


@app.get("/api/config")
def get_configuration():
    return get_config()


@app.get("/api/rules", response_model=list[Rule])
def list_active_rules():
    """Returns the current active rule set for transparency and audit trails (PRD §6)."""
    rules_dir = Path(__file__).parent / "engine" / "rules"
    return load_rules(rules_dir, scope=None)


@app.get("/api/packages")
def list_all_packages():
    """Lists all uploaded package inspection records."""
    return storage.list_packages()


@app.post("/api/packages", status_code=status.HTTP_201_CREATED)
async def upload_package(
    file: UploadFile = File(...),
    category: str = Form("packaged_food"),
):
    """
    POST /api/packages (PRD §6)
    Accepts multipart/form-data: image file, category (default 'packaged_food').
    Returns 201 { package_id: str }.
    """
    package_id = f"pkg_{uuid.uuid4().hex[:10]}"
    ext = Path(file.filename or "image.jpg").suffix or ".jpg"
    filename = f"{package_id}{ext}"
    dest_path = UPLOADS_DIR / filename

    content = await file.read()
    with open(dest_path, "wb") as f:
        f.write(content)

    storage.create_package(package_id=package_id, category=category, image_filename=filename)
    return {"package_id": package_id, "image_url": f"/static/uploads/{filename}"}


@app.post("/api/packages/{package_id}/extract")
def extract_declarations(
    package_id: str,
    ocr_provider: str | None = None,
):
    """
    POST /api/packages/{package_id}/extract (PRD §6)
    Runs preprocessing + OCR + field classification + additive correction-suggestions.
    Does NOT run the rules engine yet (mandatory Phase 3 review required first).
    Returns 200 { fields: ExtractedField[] }.
    """
    pkg_record = storage.get_package(package_id)
    if not pkg_record:
        raise HTTPException(status_code=404, detail=f"Package {package_id} not found")

    image_filename = pkg_record["package"].get("image_filename")
    image_path = UPLOADS_DIR / image_filename

    if not image_path.exists():
        raise HTTPException(status_code=404, detail="Package image file missing on server")

    cfg = get_config()
    chosen_ocr = ocr_provider or cfg.get("ocr", {}).get("default_provider", "rapidocr")
    api_key = os.environ.get("GEMINI_API_KEY")

    try:
        fields_dict = run_perception_pipeline(
            image_path=image_path,
            ocr_provider_name=chosen_ocr,
            api_key=api_key,
            crops_dir=CROPS_DIR,
            package_id=package_id,
        )
    except Exception as exc:
        import traceback
        traceback.print_exc()
        if chosen_ocr != "rapidocr":
            # Ultimate safeguard: fall back to local OCR so user is never blocked
            fields_dict = run_perception_pipeline(
                image_path=image_path,
                ocr_provider_name="rapidocr",
                api_key=api_key,
                crops_dir=CROPS_DIR,
                package_id=package_id,
            )
        else:
            raise HTTPException(status_code=500, detail=f"Perception pipeline failed: {str(exc)}")

    # Clean filler text from net_quantity and stray weights from manufacturer_name_address
    if "net_quantity" in fields_dict and fields_dict["net_quantity"].raw_value:
        clean_qty = clean_net_quantity_declaration(fields_dict["net_quantity"].raw_value)
        fields_dict["net_quantity"].raw_value = clean_qty
        fields_dict["net_quantity"].confirmed_value = clean_qty

    if "manufacturer_name_address" in fields_dict and fields_dict["manufacturer_name_address"].raw_value:
        clean_addr = clean_manufacturer_address(fields_dict["manufacturer_name_address"].raw_value)
        fields_dict["manufacturer_name_address"].raw_value = clean_addr
        fields_dict["manufacturer_name_address"].confirmed_value = clean_addr

    storage.store_extracted_fields(package_id, fields_dict)

    # Also extract non-statutory sections (ingredients, allergens, nutrition, claims)
    non_statutory = {}
    try:
        from pipeline.ocr import LocalOcrProvider
        from pipeline.field_classification import order_tokens_by_layout
        from pipeline.diff_llm import extract_non_statutory_with_llm

        ocr_engine = LocalOcrProvider()
        tokens = ocr_engine.extract_text(image_path)
        ordered_tokens = order_tokens_by_layout(tokens)
        full_text = "\n".join(t.text for t in ordered_tokens)
        non_statutory = extract_non_statutory_with_llm(full_text)
        if package_id in storage.packages:
            storage.packages[package_id]["non_statutory"] = non_statutory
    except Exception as e:
        import logging
        logging.getLogger("complilens").warning(f"Non-statutory extraction warning: {e}")

    # Attach evidence crop urls for frontend review display
    field_list = []
    for fname, f in fields_dict.items():
        field_dump = f.model_dump()
        crop_path = CROPS_DIR / f"{package_id}_{fname}.jpg"
        if crop_path.exists():
            field_dump["evidence_crop_url"] = f"/static/crops/{package_id}_{fname}.jpg"
        field_list.append(field_dump)

    return {"fields": field_list, "non_statutory": non_statutory}


@app.patch("/api/packages/{package_id}/extracted-fields")
def confirm_extracted_fields(
    package_id: str,
    updates: list[ConfirmedFieldUpdate],
):
    """
    PATCH /api/packages/{package_id}/extracted-fields (PRD §6)
    Reviewer confirms/edits extracted fields (Phase 3 review).
    Sets confirmed_value and reviewer_action per field.
    Returns 200 { updated: True }.
    """
    pkg_record = storage.get_package(package_id)
    if not pkg_record:
        raise HTTPException(status_code=404, detail=f"Package {package_id} not found")

    updates_data = [u.model_dump() for u in updates]
    success = storage.update_confirmed_fields(package_id, updates_data)
    return {"updated": success}


@app.post("/api/packages/{package_id}/evaluate", response_model=PackageVerdict)
def evaluate_compliance(package_id: str):
    """
    POST /api/packages/{package_id}/evaluate (PRD §6)
    Requires every extracted field to have a confirmed_value first (400 otherwise).
    Evaluates confirmed values against deterministic rules in backend/engine.
    Compliance verdict is NEVER produced by an LLM.
    Returns 200 PackageVerdict.
    """
    pkg_record = storage.get_package(package_id)
    if not pkg_record:
        raise HTTPException(status_code=404, detail=f"Package {package_id} not found")

    fields_dict = pkg_record.get("fields", {})
    if not fields_dict:
        raise HTTPException(
            status_code=400,
            detail="No extracted fields found. Please call /extract first.",
        )

    # Validate that every field has a confirmed_value (Phase 3 constraint)
    unconfirmed = [
        fname for fname, f in fields_dict.items() if not f.get("confirmed_value")
    ]
    if unconfirmed:
        raise HTTPException(
            status_code=400,
            detail=f"Mandatory Phase 3 review incomplete. The following fields require confirmed_value: {unconfirmed}",
        )

    # Convert to schema instances
    confirmed_fields = {
        fname: ExtractedField(**f) for fname, f in fields_dict.items()
    }

    pkg_data = pkg_record.get("package", {})
    package = Package(**pkg_data)

    rules_dir = Path(__file__).parent / "engine" / "rules"
    verdict = evaluate_package(package, confirmed_fields, rules_dir=rules_dir)

    # Attach evidence crop urls
    for ev in verdict.evaluations:
        crop_file = CROPS_DIR / f"{package_id}_{ev.field_name}.jpg"
        if crop_file.exists():
            ev.evidence_crop_url = f"/static/crops/{package_id}_{ev.field_name}.jpg"

    storage.store_verdict(package_id, verdict)
    try:
        with SessionLocal() as db:
            from database.repository import sync_package_from_storage
            sync_package_from_storage(db, package_id)
    except Exception as e:
        import logging
        logging.getLogger("complilens").warning(f"Failed to sync package {package_id} to DB: {e}")
    return verdict


@app.get("/api/packages/{package_id}")
def get_package_verdict(package_id: str):
    """
    GET /api/packages/{package_id} (PRD §6)
    Returns package metadata, fields, and verdict.
    """
    pkg_record = storage.get_package(package_id)
    if not pkg_record:
        raise HTTPException(status_code=404, detail=f"Package {package_id} not found")

    verdict_data = pkg_record.get("verdict")
    fields_data = pkg_record.get("fields", {})

    # Attach crop urls to fields
    enriched_fields = {}
    for fname, f in fields_data.items():
        f_copy = dict(f)
        crop_file = CROPS_DIR / f"{package_id}_{fname}.jpg"
        if crop_file.exists():
            f_copy["evidence_crop_url"] = f"/static/crops/{package_id}_{fname}.jpg"
        enriched_fields[fname] = f_copy

    return {
        "package_id": package_id,
        "category": pkg_record["package"].get("category", "packaged_food"),
        "image_url": f"/static/uploads/{pkg_record['package'].get('image_filename')}",
        "status": pkg_record.get("status"),
        "fields": enriched_fields,
        "verdict": verdict_data,
    }


@app.get("/api/review-queue")
def get_review_queue():
    """
    GET /api/review-queue (PRD §6)
    Returns all items with result == NEEDS_REVIEW across packages for inspector review.
    """
    return storage.get_review_queue()


@app.post("/api/review-queue/{evaluation_id}/decision")
def submit_reviewer_decision(
    evaluation_id: str,
    decision_req: ReviewerDecisionRequest,
):
    """
    POST /api/review-queue/{evaluation_id}/decision (PRD §6)
    Allows human reviewer/inspector to record a triage decision:
    APPROVE, OVERRIDE_PASS, or OVERRIDE_FAIL.
    """
    success = storage.record_reviewer_decision(evaluation_id, decision_req)
    if not success:
        raise HTTPException(status_code=404, detail=f"Evaluation {evaluation_id} not found in review queue")
    return {"updated": True, "decision": decision_req.decision}


# --- Enhanced Features (PRD §8.1 Multi-Revision Label Diff Tool) ---

class LabelDiffRequest(BaseModel):
    package_id_a: str
    package_id_b: str


class BatchEvaluateItem(BaseModel):
    package_id: str
    category: str = "packaged_food"
    fields: dict[str, Any]
    full_text: str = ""
    non_statutory: dict[str, Any] | None = None


class BatchEvaluateRequest(BaseModel):
    packages: list[BatchEvaluateItem]
    auto_sort_by_date: bool = False

BatchEvaluateRequest.model_rebuild()


@app.post("/api/label-diff")
def compare_package_labels(req: LabelDiffRequest):
    """
    POST /api/label-diff (Legacy 2-package diff)
    """
    pkg_a = storage.get_package(req.package_id_a)
    pkg_b = storage.get_package(req.package_id_b)

    if not pkg_a or not pkg_b:
        raise HTTPException(status_code=404, detail="One or both package IDs not found")

    fields_a = pkg_a.get("fields", {})
    fields_b = pkg_b.get("fields", {})

    all_field_names = sorted(list(set(fields_a.keys()).union(fields_b.keys())))
    diffs = []
    legally_significant_changes = []

    for fname in all_field_names:
        val_a = fields_a.get(fname, {}).get("confirmed_value") or fields_a.get(fname, {}).get("raw_value")
        val_b = fields_b.get(fname, {}).get("confirmed_value") or fields_b.get(fname, {}).get("raw_value")

        norm_a = " ".join(val_a.split()).lower() if val_a else ""
        norm_b = " ".join(val_b.split()).lower() if val_b else ""

        changed = norm_a != norm_b
        significance = "COSMETIC"

        if changed:
            if fname in ["mrp", "net_quantity", "manufacturer_name_address"]:
                significance = "LEGALLY_SIGNIFICANT"
                legally_significant_changes.append(f"{fname}: '{val_a}' -> '{val_b}'")
            else:
                significance = "COSMETIC"

        diffs.append({
            "field_name": fname,
            "value_a": val_a,
            "value_b": val_b,
            "changed": changed,
            "significance": significance if changed else "NONE",
            "crop_url_a": f"/static/crops/{req.package_id_a}_{fname}.jpg",
            "crop_url_b": f"/static/crops/{req.package_id_b}_{fname}.jpg",
        })

    summary = (
        f"Found {len(legally_significant_changes)} legally significant changes: {'; '.join(legally_significant_changes)}"
        if legally_significant_changes
        else "No legally significant differences detected between the two label revisions."
    )

    return {
        "package_id_a": req.package_id_a,
        "package_id_b": req.package_id_b,
        "image_url_a": f"/static/uploads/{pkg_a['package'].get('image_filename')}",
        "image_url_b": f"/static/uploads/{pkg_b['package'].get('image_filename')}",
        "field_diffs": diffs,
        "summary": summary,
    }


@app.post("/api/label-diff/batch-extract")
async def batch_extract_labels(files: list[UploadFile] = File(...)):
    """
    POST /api/label-diff/batch-extract
    Accepts 2 to 5 package label images. Runs RapidOCR perception pipeline
    on each and returns extracted statutory declarations, non-statutory sections, and raw text.
    """
    if len(files) < 2 or len(files) > 5:
        raise HTTPException(
            status_code=400,
            detail=f"Multi-label diff requires between 2 and 5 images. Received {len(files)} files."
        )

    results = []
    from pipeline.ocr import LocalOcrProvider
    from pipeline.diff_llm import extract_non_statutory_with_llm
    ocr_local = LocalOcrProvider()

    for file in files:
        pkg_id = f"pkg_{uuid.uuid4().hex[:10]}"
        ext = Path(file.filename or "label.jpg").suffix or ".jpg"
        save_filename = f"{pkg_id}{ext}"
        dest_path = UPLOADS_DIR / save_filename

        content = await file.read()
        with open(dest_path, "wb") as f:
            f.write(content)

        pkg = storage.create_package(
            package_id=pkg_id,
            category="packaged_food",
            image_filename=save_filename,
        )

        # Run perception pipeline with CPU RapidOCR
        fields = run_perception_pipeline(
            image_path=dest_path,
            ocr_provider_name="rapidocr",
            crops_dir=CROPS_DIR,
            package_id=pkg_id,
        )

        # Reconstruct full OCR text from local tokens using layout-based ordering
        local_tokens = ocr_local.extract_text(dest_path)
        from pipeline.field_classification import order_tokens_by_layout
        ordered_layout_tokens = order_tokens_by_layout(local_tokens)
        full_text = "\n".join(t.text for t in ordered_layout_tokens)

        # Extract non-statutory sections with Gemini LLM (with regex fallback)
        non_statutory = extract_non_statutory_with_llm(full_text)

        # 1. Sanitize & enrich common_name if perception grabbed nutrition table or header
        llm_common_name = non_statutory.get("common_name")
        curr_name = fields.get("common_name")
        curr_name_val = curr_name.raw_value if curr_name else ""
        is_bad_name = (
            not curr_name_val
            or any(w in curr_name_val.lower() for w in ["nutrition", "approximate", "energy", "protein", "carbohydrate", "total sugars", "total fat", "sodium", "per 100", "serve"])
            or len(curr_name_val.split()) > 8
        )
        if (is_bad_name or not curr_name) and llm_common_name and len(llm_common_name.strip()) > 2:
            fields["common_name"] = ExtractedField(
                field_name="common_name",
                raw_value=llm_common_name.strip(),
                confirmed_value=llm_common_name.strip(),
                confidence=0.98,
                bounding_box=curr_name.bounding_box if curr_name else (0, 0, 100, 100),
                ocr_source="gemini_llm_verified",
            )

        # 2. Clean net_quantity (strip preceding nutritional headers or filler text)
        if "net_quantity" in fields and fields["net_quantity"].raw_value:
            cleaned_qty = clean_net_quantity_declaration(fields["net_quantity"].raw_value)
            fields["net_quantity"].raw_value = cleaned_qty
            fields["net_quantity"].confirmed_value = cleaned_qty

        llm_net_qty = non_statutory.get("net_quantity")
        if llm_net_qty:
            clean_llm_qty = clean_net_quantity_declaration(llm_net_qty)
            curr_qty = fields.get("net_quantity")
            is_bad_qty = (
                not curr_qty
                or any(n in curr_qty.raw_value.lower() for n in ["protein", "fat", "sugar", "sodium", "carb", "energy", "per 100", "nutrition", "approximate"])
                or len(curr_qty.raw_value) > 35
                or not any(k in curr_qty.raw_value.lower() for k in ["net", "qty", "weight", "wt", "g", "gm", "ml", "kg"])
            )
            if is_bad_qty and clean_llm_qty:
                fields["net_quantity"] = ExtractedField(
                    field_name="net_quantity",
                    raw_value=clean_llm_qty,
                    confirmed_value=clean_llm_qty,
                    confidence=0.95,
                    bounding_box=curr_qty.bounding_box if curr_qty else (0, 0, 100, 100),
                    ocr_source="gemini_llm_verified",
                )

        # 3. Clean manufacturer address (strip isolated weights like 16g, 18g, 21g, and duplicate prefixes)
        if "manufacturer_name_address" in fields and fields["manufacturer_name_address"].raw_value:
            cleaned_addr = clean_manufacturer_address(fields["manufacturer_name_address"].raw_value)
            fields["manufacturer_name_address"].raw_value = cleaned_addr
            fields["manufacturer_name_address"].confirmed_value = cleaned_addr

        llm_addr = non_statutory.get("manufacturer_name_address")
        if llm_addr and len(llm_addr.strip()) > 10:
            curr_addr = fields.get("manufacturer_name_address")
            if not curr_addr or any(w in curr_addr.raw_value.lower() for w in ["nutrition", "protein", "energy"]):
                fields["manufacturer_name_address"] = ExtractedField(
                    field_name="manufacturer_name_address",
                    raw_value=clean_manufacturer_address(llm_addr.strip()),
                    confirmed_value=clean_manufacturer_address(llm_addr.strip()),
                    confidence=0.95,
                    bounding_box=curr_addr.bounding_box if curr_addr else (0, 0, 100, 100),
                    ocr_source="gemini_llm_verified",
                )

        storage.store_extracted_fields(pkg_id, fields)

        enriched_fields = {}
        for fname, f_obj in fields.items():
            f_dict = f_obj.model_dump()
            crop_file = CROPS_DIR / f"{pkg_id}_{fname}.jpg"
            if crop_file.exists():
                f_dict["evidence_crop_url"] = f"/static/crops/{pkg_id}_{fname}.jpg"
            enriched_fields[fname] = f_dict

        results.append({
            "package_id": pkg_id,
            "filename": file.filename,
            "image_url": f"/static/uploads/{save_filename}",
            "fields": enriched_fields,
            "full_text": full_text,
            "extracted_non_statutory": non_statutory,
        })

    return {"count": len(results), "packages": results}


@app.post("/api/label-diff/batch-evaluate")
def batch_evaluate_labels(req: BatchEvaluateRequest):
    """
    POST /api/label-diff/batch-evaluate
    Runs LMPC compliance evaluation across all revisions and executes
    deterministic shrinkflation, FSSAI/barcode identity tracking, granular LMPC
    rules matrix, and single-prompt LLM semantic diff for formulation, allergens, and claims.
    """
    if len(req.packages) < 2 or len(req.packages) > 5:
        raise HTTPException(
            status_code=400,
            detail=f"Multi-label diff requires between 2 and 5 revisions. Received {len(req.packages)}."
        )

    rules = load_rules(Path(__file__).parent / "engine" / "rules")
    rules_metadata = {
        r.rule_id: {
            "rule_id": r.rule_id,
            "description": r.description,
            "source_citation": r.source_citation,
            "required_field": r.required_field,
            "severity": r.severity,
        }
        for r in rules
    }

    revisions_data = []

    for item in req.packages:
        pkg_record = storage.get_package(item.package_id)
        if not pkg_record:
            continue

        pkg = Package(**pkg_record["package"])
        field_objs = {}
        simple_fields = {}

        for fname, fval in item.fields.items():
            if isinstance(fval, dict):
                val = (fval.get("confirmed_value") or fval.get("raw_value") or "").strip()
                simple_fields[fname] = val
                field_objs[fname] = ExtractedField(
                    field_name=fname,
                    raw_value=fval.get("raw_value", val) or val,
                    confirmed_value=val if val else None,
                    confidence=float(fval.get("confidence", 0.95)),
                    bounding_box=tuple(fval.get("bounding_box", (0, 0, 100, 100))),
                    ocr_source=fval.get("ocr_source", "rapidocr"),
                )
            else:
                val = str(fval).strip()
                simple_fields[fname] = val
                field_objs[fname] = ExtractedField(
                    field_name=fname,
                    raw_value=val,
                    confirmed_value=val if val else None,
                    confidence=0.95,
                    bounding_box=(0, 0, 100, 100),
                    ocr_source="rapidocr",
                )

        verdict = evaluate_package(pkg, field_objs, rules)
        storage.store_verdict(item.package_id, verdict)
        try:
            with SessionLocal() as db:
                from database.repository import sync_package_from_storage
                sync_package_from_storage(db, item.package_id)
        except Exception:
            pass

        # Incorporate confirmed non-statutory data if provided
        revisions_data.append({
            "package_id": item.package_id,
            "image_url": f"/static/uploads/{pkg_record['package'].get('image_filename')}",
            "mfg_date": simple_fields.get("mfg_month_year"),
            "fields": simple_fields,
            "field_details": {
                fname: {
                    "bounding_box": list(fobj.bounding_box) if fobj.bounding_box else [0, 0, 0, 0],
                    "raw_value": fobj.raw_value,
                    "confidence": fobj.confidence,
                }
                for fname, fobj in field_objs.items()
            },
            "full_text": item.full_text,
            "non_statutory": item.non_statutory,
            "verdict": verdict.model_dump(),
        })

    from pipeline.diff_engine import compute_multi_revision_diff
    diff_result = compute_multi_revision_diff(
        revisions_data,
        auto_sort_by_date=req.auto_sort_by_date,
        rules_metadata=rules_metadata,
    )

    return diff_result


# =============================================================================
# PRD §8.2 & §8.5 Product History & Manufacturer Dashboard Endpoints
# =============================================================================

@app.get("/api/products", response_model=list[ProductListItem])
def list_products(search: str | None = None, db: Session = Depends(get_db)):
    """PRD §8.2: Product directory listing with compliance trends and regression flags."""
    from database.repository import list_all_products
    products = list_all_products(db)
    if search:
        s = search.strip().lower()
        products = [
            p for p in products
            if s in p["common_name"].lower() or s in p["manufacturer_name"].lower() or s in p["product_key"].lower()
        ]
    return products


@app.get("/api/products/{product_key}/history", response_model=ProductHistory)
def get_product_history_endpoint(product_key: str, db: Session = Depends(get_db)):
    """PRD §8.2: Product inspection history, chronological trajectory, regression events."""
    from database.repository import get_product_history
    history = get_product_history(db, product_key)
    if not history:
        raise HTTPException(status_code=404, detail=f"Product with key '{product_key}' not found")
    return history


@app.get("/api/manufacturers", response_model=list[ManufacturerListItem])
def list_manufacturers(search: str | None = None, db: Session = Depends(get_db)):
    """PRD §8.5: Manufacturer fleet compliance directory and risk tiering."""
    from database.repository import list_all_manufacturers
    manufacturers = list_all_manufacturers(db)
    if search:
        s = search.strip().lower()
        manufacturers = [
            m for m in manufacturers
            if s in m["manufacturer_name"].lower() or s in m["manufacturer_key"].lower()
        ]
    return manufacturers


@app.get("/api/manufacturers/{manufacturer_key}/summary", response_model=ManufacturerSummary)
def get_manufacturer_summary_endpoint(manufacturer_key: str, db: Session = Depends(get_db)):
    """PRD §8.5: Manufacturer portfolio summary, compliance scores, violation Pareto analysis."""
    from database.repository import get_manufacturer_summary
    summary = get_manufacturer_summary(db, manufacturer_key)
    if not summary:
        raise HTTPException(status_code=404, detail=f"Manufacturer with key '{manufacturer_key}' not found")
    return summary


# -----------------------------------------------------------------------------
# Gotenberg PDF Generation Proxy Endpoint
# -----------------------------------------------------------------------------
class ReportPdfRequest(BaseModel):
    html: str
    filename: str | None = "compliance_report.pdf"


def convert_html_with_gotenberg(html_content: str, gotenberg_base_url: str) -> bytes | None:
    import urllib.request
    import urllib.error
    
    boundary = f"----CompliLensBoundary{uuid.uuid4().hex}"
    body = bytearray()
    
    # Multipart file: index.html
    body.extend(f"--{boundary}\r\n".encode("utf-8"))
    body.extend(b'Content-Disposition: form-data; name="files"; filename="index.html"\r\n')
    body.extend(b'Content-Type: text/html; charset=utf-8\r\n\r\n')
    body.extend(html_content.encode("utf-8"))
    body.extend(b"\r\n")
    
    # Chromium conversion options for Gotenberg 8
    options = {
        "paperWidth": "8.27",
        "paperHeight": "11.7",
        "marginTop": "0.3",
        "marginBottom": "0.3",
        "marginLeft": "0.3",
        "marginRight": "0.3",
        "preferCssPageSize": "true",
        "printBackground": "true",
    }
    for k, v in options.items():
        body.extend(f"--{boundary}\r\n".encode("utf-8"))
        body.extend(f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode("utf-8"))
        body.extend(f"{v}\r\n".encode("utf-8"))
        
    body.extend(f"--{boundary}--\r\n".encode("utf-8"))
    
    url = f"{gotenberg_base_url.rstrip('/')}/forms/chromium/convert/html"
    req = urllib.request.Request(
        url,
        data=bytes(body),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            if resp.status == 200:
                return resp.read()
    except Exception:
        return None
    return None


@app.post("/api/report/pdf")
def generate_pdf_report(payload: ReportPdfRequest):
    """Converts HTML report to PDF using Gotenberg service if available, or signals fallback."""
    candidate_urls = [
        os.getenv("GOTENBERG_URL"),
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://gotenberg:3000",
    ]
    pdf_bytes = None
    for base_url in candidate_urls:
        if not base_url:
            continue
        try:
            pdf_bytes = convert_html_with_gotenberg(payload.html, base_url)
            if pdf_bytes:
                break
        except Exception:
            continue

    if pdf_bytes:
        filename = payload.filename or "compliance_report.pdf"
        if not filename.endswith(".pdf"):
            filename += ".pdf"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Gotenberg PDF rendering service is not reachable. Use browser print fallback."
    )

