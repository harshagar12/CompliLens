"""
Database Repository layer for CompliLens.
Implements:
1. Automatic Migration from legacy complilens_db.json.
2. Product Identity Resolution (§8.3) via normalized fuzzy matching.
3. Product History Engine (§8.2) tracking chronological lineage, fail trends, and regressions.
4. Manufacturer-Level Dashboard Engine (§8.5) tracking compliance scores and violation Pareto statistics.
"""
from __future__ import annotations
import re
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session
from sqlalchemy import desc

from .models import (
    ManufacturerModel,
    ProductModel,
    PackageModel,
    ExtractedFieldModel,
    EvaluationModel,
    PackageVerdictModel,
    ReviewQueueModel,
)

logger = logging.getLogger("complilens.repository")
DATA_DIR = Path(__file__).parent.parent.parent / "data"
LEGACY_DB_FILE = DATA_DIR / "complilens_db.json"

RULE_DESCRIPTIONS = {
    "LMPC-6.1.a": ("Name and complete address of manufacturer/packer", "Rule 6(1)(a)"),
    "LMPC-6.1.b": ("Generic or common name of commodity", "Rule 6(1)(b)"),
    "LMPC-6.1.c": ("Net quantity in standard metric units", "Rule 6(1)(c)"),
    "LMPC-6.1.d": ("Month and year of manufacture or packing", "Rule 6(1)(d)"),
    "LMPC-6.1.e": ("Retail sale price (MRP) inclusive of all taxes", "Rule 6(1)(e)"),
    "LMPC-6.2": ("Consumer redressal name, address, telephone, email", "Rule 6(2)"),
    "LMPC-7.1": ("Principal display panel area & font size rules", "Rule 7(1)"),
    "LMPC-9.1": ("Declarations on multi-piece/combination commodities", "Rule 9(1)"),
}


def normalize_string_key(text: str) -> str:
    """Normalizes text for canonical identity key generation (strip punctuation, lower, hyphenate)."""
    if not text:
        return "unknown"
    cleaned = re.sub(r"[^\w\s]", " ", text.lower())
    cleaned = re.sub(r"\s+", "-", cleaned).strip("-")
    return cleaned[:100] or "unknown"


def extract_manufacturer_canonical_name(addr_text: str) -> str:
    """Extracts the primary business name from an address line."""
    if not addr_text:
        return "Unknown Manufacturer"
    # Remove prefix like Manufactured by:
    cleaned = re.sub(r"^(?:manufactured|packed|marketed|mfd|mfg|pkd)\s*by\s*[:.\-]?\s*", "", addr_text, flags=re.IGNORECASE)
    parts = [p.strip() for p in cleaned.split(",") if p.strip()]
    if parts:
        # First part usually has company name e.g. "NutriBite Foods Pvt. Ltd."
        return parts[0]
    return cleaned[:60].strip()


def resolve_product_identity(
    db: Session,
    fields: dict[str, Any],
    barcode: str | None = None
) -> tuple[ProductModel, ManufacturerModel]:
    """
    PRD §8.3: Product Identity Resolution.
    Uses normalized confirmed_value of manufacturer_name_address, common_name, and net_quantity.
    Auto-links to existing ProductModel if match is found or creates canonical entities.
    """
    # 1. Barcode high-confidence check (§8.3 criterion 3)
    if barcode:
        existing_by_barcode = db.query(ProductModel).filter(ProductModel.barcode == barcode).first()
        if existing_by_barcode:
            mfg = db.query(ManufacturerModel).filter(ManufacturerModel.manufacturer_key == existing_by_barcode.manufacturer_key).first()
            return existing_by_barcode, mfg

    # 2. Extract normalized text attributes
    def get_val(fname: str) -> str:
        f = fields.get(fname, {})
        if isinstance(f, dict):
            return f.get("confirmed_value") or f.get("raw_value") or ""
        return getattr(f, "confirmed_value", None) or getattr(f, "raw_value", None) or ""

    addr_text = get_val("manufacturer_name_address")
    name_text = get_val("common_name") or "Generic Packaged Product"
    qty_text = get_val("net_quantity") or ""

    mfg_display_name = extract_manufacturer_canonical_name(addr_text)
    mfg_key = normalize_string_key(mfg_display_name)
    if not mfg_key or mfg_key == "unknown":
        mfg_key = "unspecified-manufacturer"
        mfg_display_name = "Unspecified Manufacturer"

    # Ensure ManufacturerModel exists
    mfg = db.query(ManufacturerModel).filter(ManufacturerModel.manufacturer_key == mfg_key).first()
    if not mfg:
        mfg = ManufacturerModel(
            manufacturer_key=mfg_key,
            raw_name_address=addr_text or mfg_display_name,
            normalized_name=mfg_display_name,
        )
        db.add(mfg)
        db.flush()

    # Form canonical product key
    norm_prod_name = normalize_string_key(name_text)
    norm_qty = normalize_string_key(qty_text) if qty_text else ""

    # Check if this manufacturer already has a product with this common name
    existing_by_name = db.query(ProductModel).filter(
        ProductModel.manufacturer_key == mfg_key,
        ProductModel.normalized_name == norm_prod_name
    ).first()

    # If incoming quantity is missing/empty (e.g. non-compliant label) and an existing product exists, link to it (PRD §8.3)
    if not norm_qty and existing_by_name:
        if barcode and not existing_by_name.barcode:
            existing_by_name.barcode = barcode
            db.flush()
        return existing_by_name, mfg

    prod_key = f"{mfg_key}_{norm_prod_name}"
    if norm_qty:
        prod_key += f"_{norm_qty}"
    prod_key = prod_key[:180]

    product = db.query(ProductModel).filter(ProductModel.product_key == prod_key).first()
    if not product:
        if existing_by_name and not existing_by_name.net_quantity:
            product = existing_by_name
            product.net_quantity = qty_text
            db.flush()
        else:
            product = ProductModel(
                product_key=prod_key,
                manufacturer_key=mfg_key,
                common_name=name_text,
                normalized_name=norm_prod_name,
                net_quantity=qty_text,
                category="packaged_food",
                barcode=barcode,
            )
            db.add(product)
            db.flush()
    else:
        if barcode and not product.barcode:
            product.barcode = barcode
            db.flush()

    return product, mfg


def sync_package_to_database(
    db: Session,
    package_id: str,
    category: str,
    image_filename: str,
    fields: dict[str, Any] | None = None,
    verdict: dict[str, Any] | None = None,
    status: str = "EVALUATED",
    created_at_dt: datetime | None = None
) -> PackageModel:
    """Persists a complete package inspection bundle into relational database."""
    pkg = db.query(PackageModel).filter(PackageModel.package_id == package_id).first()
    if not pkg:
        pkg = PackageModel(
            package_id=package_id,
            category=category or "packaged_food",
            image_filename=image_filename or f"{package_id}.jpg",
            status=status,
            created_at=created_at_dt or datetime.utcnow(),
        )
        db.add(pkg)
        db.flush()
    else:
        pkg.status = status
        if image_filename:
            pkg.image_filename = image_filename

    # Resolve product and manufacturer identity
    if fields:
        prod, _ = resolve_product_identity(db, fields)
        pkg.product_key = prod.product_key

        # Upsert Extracted Fields
        for fname, f_data in fields.items():
            if isinstance(f_data, dict):
                raw = f_data.get("raw_value", "")
                sugg = f_data.get("suggested_value")
                sugg_src = f_data.get("suggestion_source")
                conf_val = f_data.get("confirmed_value")
                rev_act = f_data.get("reviewer_action")
                conf = f_data.get("confidence", 1.0)
                bbox = f_data.get("bounding_box", [0, 0, 100, 50])
                ocr_src = f_data.get("ocr_source", "local")
            else:
                raw = getattr(f_data, "raw_value", "")
                sugg = getattr(f_data, "suggested_value", None)
                sugg_src = getattr(f_data, "suggestion_source", None)
                conf_val = getattr(f_data, "confirmed_value", None)
                rev_act = getattr(f_data, "reviewer_action", None)
                conf = getattr(f_data, "confidence", 1.0)
                bbox = getattr(f_data, "bounding_box", [0, 0, 100, 50])
                ocr_src = getattr(f_data, "ocr_source", "local")

            bx, by, bw, bh = (bbox[0], bbox[1], bbox[2], bbox[3]) if len(bbox) >= 4 else (0, 0, 100, 50)

            field_rec = db.query(ExtractedFieldModel).filter(
                ExtractedFieldModel.package_id == package_id,
                ExtractedFieldModel.field_name == fname
            ).first()

            if not field_rec:
                field_rec = ExtractedFieldModel(
                    package_id=package_id,
                    field_name=fname,
                    raw_value=raw,
                    suggested_value=sugg,
                    suggestion_source=sugg_src,
                    confirmed_value=conf_val,
                    reviewer_action=rev_act,
                    confidence=conf,
                    bbox_x=bx,
                    bbox_y=by,
                    bbox_w=bw,
                    bbox_h=bh,
                    ocr_source=ocr_src,
                )
                db.add(field_rec)
            else:
                field_rec.raw_value = raw
                field_rec.suggested_value = sugg
                field_rec.confirmed_value = conf_val
                field_rec.reviewer_action = rev_act

    # Upsert Verdict & Evaluations
    if verdict:
        ov_res = verdict.get("overall_result") if isinstance(verdict, dict) else getattr(verdict, "overall_result", "PASS")
        verd_rec = db.query(PackageVerdictModel).filter(PackageVerdictModel.package_id == package_id).first()
        if not verd_rec:
            verd_rec = PackageVerdictModel(
                package_id=package_id,
                overall_result=ov_res,
                category=category or "packaged_food",
                evaluated_at=datetime.utcnow(),
            )
            db.add(verd_rec)
        else:
            verd_rec.overall_result = ov_res

        evals = verdict.get("evaluations", []) if isinstance(verdict, dict) else getattr(verdict, "evaluations", [])
        for ev in evals:
            eid = ev.get("evaluation_id") if isinstance(ev, dict) else getattr(ev, "evaluation_id", None)
            fn = ev.get("field_name") if isinstance(ev, dict) else getattr(ev, "field_name", "")
            rid = ev.get("rule_id") if isinstance(ev, dict) else getattr(ev, "rule_id", "")
            rv = ev.get("rule_version", 1) if isinstance(ev, dict) else getattr(ev, "rule_version", 1)
            res = ev.get("result") if isinstance(ev, dict) else getattr(ev, "result", "PASS")
            ext_val = ev.get("extracted_value") if isinstance(ev, dict) else getattr(ev, "extracted_value", "")
            conf = ev.get("confidence", 1.0) if isinstance(ev, dict) else getattr(ev, "confidence", 1.0)
            notes = ev.get("notes") or "" if isinstance(ev, dict) else getattr(ev, "notes", "") or ""
            crop_url = ev.get("evidence_crop_url", "") if isinstance(ev, dict) else getattr(ev, "evidence_crop_url", "")

            if not eid:
                eid = f"{package_id}_{rid}"

            ev_rec = db.query(EvaluationModel).filter(
                EvaluationModel.package_id == package_id,
                EvaluationModel.rule_id == rid
            ).first()

            if not ev_rec:
                ev_rec = EvaluationModel(
                    package_id=package_id,
                    evaluation_id=eid,
                    field_name=fn,
                    rule_id=rid,
                    rule_version=rv,
                    result=res,
                    extracted_value=ext_val,
                    confidence=conf,
                    evidence_crop_url=crop_url,
                    notes=notes,
                )
                db.add(ev_rec)
            else:
                ev_rec.result = res
                ev_rec.extracted_value = ext_val
                ev_rec.notes = notes

            # If NEEDS_REVIEW, add to ReviewQueueModel
            if res == "NEEDS_REVIEW":
                rq = db.query(ReviewQueueModel).filter(ReviewQueueModel.evaluation_id == eid).first()
                if not rq:
                    rq = ReviewQueueModel(
                        evaluation_id=eid,
                        package_id=package_id,
                        status="PENDING_REVIEW",
                    )
                    db.add(rq)

    db.commit()
    db.refresh(pkg)
    return pkg


def sync_package_from_storage(db: Session, package_id: str) -> PackageModel | None:
    """Helper to fetch a package from storage and sync it to the relational database."""
    from storage import storage
    pkg_record = storage.get_package(package_id)
    if not pkg_record:
        return None
    pkg_info = pkg_record.get("package", {})
    created_at_str = pkg_record.get("created_at") or pkg_info.get("created_at")
    dt = None
    if created_at_str:
        try:
            dt = datetime.fromisoformat(created_at_str.replace("Z", ""))
        except Exception:
            dt = datetime.utcnow()
    return sync_package_to_database(
        db=db,
        package_id=package_id,
        category=pkg_info.get("category", "packaged_food"),
        image_filename=pkg_info.get("image_filename") or f"{package_id}.png",
        fields=pkg_record.get("fields", {}),
        verdict=pkg_record.get("verdict"),
        status=pkg_record.get("status", "EVALUATED"),
        created_at_dt=dt or datetime.utcnow(),
    )


def migrate_legacy_db_if_needed(db: Session):
    """Imports legacy JSON records from complilens_db.json on startup."""
    if not LEGACY_DB_FILE.exists():
        return

    try:
        with open(LEGACY_DB_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

        packages = data.get("packages", {})
        if not packages:
            return

        existing_count = db.query(PackageModel).count()
        if existing_count >= len(packages):
            return  # Already migrated

        logger.info(f"Migrating {len(packages)} legacy packages into relational database...")
        for pkg_id, p_data in packages.items():
            pkg_info = p_data.get("package", {})
            created_at_str = p_data.get("created_at") or pkg_info.get("created_at")
            dt = None
            if created_at_str:
                try:
                    dt = datetime.fromisoformat(created_at_str.replace("Z", ""))
                except Exception:
                    dt = datetime.utcnow()

            sync_package_to_database(
                db=db,
                package_id=pkg_id,
                category=pkg_info.get("category", "packaged_food"),
                image_filename=pkg_info.get("image_filename") or f"{pkg_id}.png",
                fields=p_data.get("fields", {}),
                verdict=p_data.get("verdict"),
                status=p_data.get("status", "EVALUATED"),
                created_at_dt=dt or datetime.utcnow(),
            )

        # Migrate reviewer decisions if any
        decisions = data.get("reviewer_decisions", [])
        for dec in decisions:
            eid = dec.get("evaluation_id")
            if eid:
                rq = db.query(ReviewQueueModel).filter(ReviewQueueModel.evaluation_id == eid).first()
                if rq:
                    rq.status = dec.get("decision", "APPROVE")
                    rq.decision = dec.get("decision")
                    rq.reviewer = dec.get("reviewer")
                    rq.note = dec.get("note")
                    db.commit()

        logger.info("Legacy database migration completed successfully.")
    except Exception as e:
        logger.error(f"Error migrating legacy database: {e}", exc_info=True)


# =============================================================================
# PRD §8.2 History Dashboard Engine
# =============================================================================

def list_all_products(db: Session) -> list[dict[str, Any]]:
    """Returns summarized list of all tracked products for product directory."""
    migrate_legacy_db_if_needed(db)
    products = db.query(ProductModel).all()
    results = []

    for prod in products:
        pkgs = db.query(PackageModel).filter(PackageModel.product_key == prod.product_key).order_by(PackageModel.created_at.desc()).all()
        total_inspections = len(pkgs)
        if total_inspections == 0:
            continue

        fail_count = 0
        latest_verdict = "PASS"
        last_tested_at = None

        for idx, p in enumerate(pkgs):
            if idx == 0:
                last_tested_at = p.created_at.isoformat()
                if p.verdict:
                    latest_verdict = p.verdict.overall_result
            if p.verdict and p.verdict.overall_result in ["FAIL", "NEEDS_REVIEW"]:
                fail_count += 1

        fail_rate = round(fail_count / total_inspections, 3)
        mfg = prod.manufacturer

        # Check for active regression: did latest inspection fail something that previously passed?
        has_active_regression = False
        if len(pkgs) >= 2:
            latest_evals = {e.rule_id: e.result for e in pkgs[0].evaluations}
            older_evals = {e.rule_id: e.result for e in pkgs[1].evaluations}
            for rid, res in latest_evals.items():
                if res == "FAIL" and older_evals.get(rid) == "PASS":
                    has_active_regression = True
                    break

        # Compute trend
        if total_inspections < 2:
            trend = "INSUFFICIENT_DATA"
        elif has_active_regression or latest_verdict == "FAIL":
            trend = "DEGRADING" if fail_rate > 0.3 else "STABLE"
        elif latest_verdict == "PASS" and fail_rate > 0:
            trend = "IMPROVING"
        else:
            trend = "STABLE"

        # Collect latest failing rules for the product's active revision
        latest_failing_rules = []
        if pkgs and pkgs[0].evaluations:
            for ev in pkgs[0].evaluations:
                if ev.result in ["FAIL", "NEEDS_REVIEW"]:
                    meta = RULE_DESCRIPTIONS.get(ev.rule_id, (f"Statutory requirement {ev.rule_id}", ev.rule_id))
                    latest_failing_rules.append({
                        "rule_id": ev.rule_id,
                        "field_name": ev.field_name,
                        "result": ev.result,
                        "description": meta[0],
                        "citation": meta[1],
                        "notes": ev.notes or f"Required declaration '{ev.field_name}' non-compliant or missing",
                        "extracted_value": ev.extracted_value or ""
                    })

        results.append({
            "product_key": prod.product_key,
            "common_name": prod.common_name,
            "manufacturer_name": mfg.normalized_name if mfg else "Unknown Manufacturer",
            "manufacturer_key": prod.manufacturer_key,
            "net_quantity": prod.net_quantity,
            "total_inspections": total_inspections,
            "latest_verdict": latest_verdict,
            "latest_failing_rules": latest_failing_rules,
            "fail_rate": fail_rate,
            "trend": trend,
            "has_active_regression": has_active_regression,
            "last_tested_at": last_tested_at,
        })

    results.sort(key=lambda x: (x["has_active_regression"], x["fail_rate"]), reverse=True)
    return results


def get_product_history(db: Session, product_key: str) -> dict[str, Any] | None:
    """
    PRD §8.2: Product History (per product, over time).
    Retrieves chronological timeline, fail counts, failing rules details,
    changed declarations, regression alerts, and trend classification.
    """
    migrate_legacy_db_if_needed(db)
    prod = db.query(ProductModel).filter(ProductModel.product_key == product_key).first()
    if not prod:
        return None

    mfg = prod.manufacturer
    # Chronological order (oldest to newest)
    packages = db.query(PackageModel).filter(PackageModel.product_key == product_key).order_by(PackageModel.created_at.asc()).all()

    entries = []
    fail_counts = []
    prev_fields: dict[str, str] = {}
    prev_evals: dict[str, str] = {}
    has_active_regression = False

    for idx, pkg in enumerate(packages):
        field_dict = {f.field_name: (f.confirmed_value or f.raw_value or "") for f in pkg.fields}
        eval_dict = {e.rule_id: e.result for e in pkg.evaluations}

        # Calculate fails on this inspection
        inspection_fails = sum(1 for res in eval_dict.values() if res == "FAIL")
        fail_counts.append(inspection_fails)

        # Collect failing rules details with rule citation and notes
        failing_rules = []
        for ev in pkg.evaluations:
            if ev.result in ["FAIL", "NEEDS_REVIEW"]:
                meta = RULE_DESCRIPTIONS.get(ev.rule_id, (f"Statutory requirement {ev.rule_id}", ev.rule_id))
                failing_rules.append({
                    "rule_id": ev.rule_id,
                    "field_name": ev.field_name,
                    "result": ev.result,
                    "description": meta[0],
                    "citation": meta[1],
                    "notes": ev.notes or f"Required declaration '{ev.field_name}' non-compliant or missing",
                    "extracted_value": ev.extracted_value or field_dict.get(ev.field_name, "")
                })

        # Calculate changed fields since last inspection
        changed_fields = []
        if idx > 0:
            for fname, val in field_dict.items():
                prev_val = prev_fields.get(fname, "")
                if prev_val and val and prev_val.strip().lower() != val.strip().lower():
                    changed_fields.append(fname)

        # Check for statutory regression: rule passed previously, now fails!
        is_regression = False
        reg_details = []
        if idx > 0:
            for rid, res in eval_dict.items():
                if res in ["FAIL", "NEEDS_REVIEW"] and prev_evals.get(rid) == "PASS":
                    is_regression = True
                    meta = RULE_DESCRIPTIONS.get(rid, (f"Requirement {rid}", rid))
                    reg_details.append(f"Rule {rid} ({meta[1]}) regressed from PASS to {res}")

        if is_regression and idx == len(packages) - 1:
            has_active_regression = True

        mrp_val = field_dict.get("mrp")
        qty_val = field_dict.get("net_quantity")
        mfg_val = field_dict.get("mfg_month_year")

        entries.append({
            "package_id": pkg.package_id,
            "tested_at": pkg.created_at.isoformat(),
            "overall_result": pkg.verdict.overall_result if pkg.verdict else "PASS",
            "fail_count": inspection_fails,
            "failing_rules": failing_rules,
            "changed_fields_since_last": changed_fields,
            "is_regression": is_regression,
            "regression_details": reg_details,
            "mfg_date": mfg_val,
            "mrp": mrp_val,
            "net_quantity": qty_val,
            "image_url": f"/static/uploads/{pkg.image_filename}",
        })

        prev_fields = field_dict
        prev_evals = eval_dict

    # Compute trend slope across entries
    if len(entries) < 2:
        trend = "INSUFFICIENT_DATA"
    else:
        first_fails = fail_counts[0]
        last_fails = fail_counts[-1]
        if last_fails < first_fails:
            trend = "IMPROVING"
        elif last_fails > first_fails:
            trend = "DEGRADING"
        elif any(e["is_regression"] for e in entries[-2:]):
            trend = "DEGRADING"
        else:
            trend = "STABLE"

    total_inspections = len(entries)
    total_fails = sum(1 for e in entries if e["overall_result"] in ["FAIL", "NEEDS_REVIEW"])
    fail_rate = round(total_fails / total_inspections, 3) if total_inspections else 0.0

    return {
        "product_key": prod.product_key,
        "product_name": prod.common_name,
        "manufacturer_name": mfg.normalized_name if mfg else "Unknown Manufacturer",
        "manufacturer_key": prod.manufacturer_key,
        "net_quantity": prod.net_quantity,
        "entries": entries,
        "trend": trend,
        "total_inspections": total_inspections,
        "fail_rate": fail_rate,
        "has_active_regression": has_active_regression,
    }


# =============================================================================
# PRD §8.5 Manufacturer-Level Dashboard Engine
# =============================================================================

def list_all_manufacturers(db: Session) -> list[dict[str, Any]]:
    """
    Returns compliance portfolio directory of all manufacturers,
    computing both current active packaging compliance and all-time track record.
    """
    migrate_legacy_db_if_needed(db)
    manufacturers = db.query(ManufacturerModel).all()
    results = []

    for mfg in manufacturers:
        prods = mfg.products
        if not prods:
            continue
        prod_keys = [p.product_key for p in prods]

        # Fetch all packages across products
        packages = db.query(PackageModel).filter(PackageModel.product_key.in_(prod_keys)).all() if prod_keys else []
        total_inspections = len(packages)
        if total_inspections == 0:
            continue

        # Historical / All-Time Compliance Score
        fail_inspections = sum(1 for p in packages if p.verdict and p.verdict.overall_result in ["FAIL", "NEEDS_REVIEW"])
        historical_fail_rate = round(fail_inspections / total_inspections, 3)
        historical_compliance_score = round(max(0.0, (1.0 - historical_fail_rate) * 100.0), 1)

        # Active / Current Status (Latest revision per product)
        current_product_fails = 0
        reg_count = 0
        for p in prods:
            hist = get_product_history(db, p.product_key)
            if hist and hist.get("entries"):
                latest_entry = hist["entries"][-1]
                if latest_entry["overall_result"] in ["FAIL", "NEEDS_REVIEW"]:
                    current_product_fails += 1
                if hist.get("has_active_regression"):
                    reg_count += 1

        current_fail_rate = round(current_product_fails / len(prods), 3) if prods else 0.0
        current_compliance_score = round(max(0.0, (1.0 - current_fail_rate) * 100.0), 1)

        # Current Risk Level (Active on shelves right now)
        if current_fail_rate >= 0.35 or reg_count > 0:
            current_risk_level = "HIGH"
        elif current_fail_rate > 0:
            current_risk_level = "MEDIUM"
        else:
            current_risk_level = "LOW"

        # Historical Risk Level
        if historical_fail_rate >= 0.35 or reg_count > 0:
            risk_level = "HIGH"
        elif historical_fail_rate >= 0.15:
            risk_level = "MEDIUM"
        else:
            risk_level = "LOW"

        # Remediation Trajectory Status
        if current_compliance_score == 100.0 and historical_compliance_score == 100.0:
            remediation_status = "EXEMPLARY"
        elif current_compliance_score == 100.0 and historical_compliance_score < 100.0:
            remediation_status = "REMEDIATED"
        elif reg_count > 0:
            remediation_status = "REGRESSED"
        else:
            remediation_status = "NON_COMPLIANT"

        results.append({
            "manufacturer_key": mfg.manufacturer_key,
            "manufacturer_name": mfg.normalized_name,
            "product_count": len(prods),
            "total_inspections": total_inspections,
            "current_compliance_score": current_compliance_score,
            "historical_compliance_score": historical_compliance_score,
            "fail_rate": historical_fail_rate,
            "compliance_score": current_compliance_score,
            "risk_level": risk_level,
            "current_risk_level": current_risk_level,
            "active_regressions_count": reg_count,
            "remediation_status": remediation_status,
        })

    results.sort(key=lambda m: (m["current_risk_level"] == "HIGH", m["active_regressions_count"], -m["current_compliance_score"]), reverse=True)
    return results


def get_manufacturer_summary(db: Session, manufacturer_key: str) -> dict[str, Any] | None:
    """
    PRD §8.5: Manufacturer-Level Dashboard.
    Surfaces both Current Active Packaging compliance (what is on shelves now)
    and All-Time Historical track record, along with dual Pareto violation breakdowns.
    """
    migrate_legacy_db_if_needed(db)
    mfg = db.query(ManufacturerModel).filter(ManufacturerModel.manufacturer_key == manufacturer_key).first()
    if not mfg:
        return None

    prods = mfg.products
    prod_keys = [p.product_key for p in prods]
    packages = db.query(PackageModel).filter(PackageModel.product_key.in_(prod_keys)).all() if prod_keys else []

    total_inspections = len(packages)
    fail_inspections = sum(1 for p in packages if p.verdict and p.verdict.overall_result in ["FAIL", "NEEDS_REVIEW"])
    historical_fail_rate = round(fail_inspections / total_inspections, 3) if total_inspections else 0.0
    historical_compliance_score = round(max(0.0, (1.0 - historical_fail_rate) * 100.0), 1)

    products_with_active_regression = []
    product_list = []
    current_product_fails = 0
    current_rule_fails: dict[str, int] = {}
    historical_rule_fails: dict[str, int] = {}

    for p in prods:
        hist = get_product_history(db, p.product_key)
        if hist and hist.get("entries"):
            latest_entry = hist["entries"][-1]
            if latest_entry["overall_result"] in ["FAIL", "NEEDS_REVIEW"]:
                current_product_fails += 1
            if hist.get("has_active_regression"):
                products_with_active_regression.append(p.product_key)

            # Record current failing rules on latest active revision
            for rf in latest_entry.get("failing_rules", []):
                rid = rf["rule_id"]
                current_rule_fails[rid] = current_rule_fails.get(rid, 0) + 1

            product_list.append({
                "product_key": p.product_key,
                "common_name": p.common_name,
                "manufacturer_name": mfg.normalized_name,
                "manufacturer_key": mfg.manufacturer_key,
                "net_quantity": p.net_quantity,
                "total_inspections": hist["total_inspections"],
                "latest_verdict": latest_entry["overall_result"],
                "latest_failing_rules": latest_entry.get("failing_rules", []),
                "fail_rate": hist["fail_rate"],
                "trend": hist["trend"],
                "has_active_regression": hist["has_active_regression"],
                "last_tested_at": latest_entry["tested_at"],
            })

    current_fail_rate = round(current_product_fails / len(prods), 3) if prods else 0.0
    current_compliance_score = round(max(0.0, (1.0 - current_fail_rate) * 100.0), 1)

    # Current vs Historical Risk
    if current_fail_rate >= 0.35 or products_with_active_regression:
        current_risk_level = "HIGH"
    elif current_fail_rate > 0:
        current_risk_level = "MEDIUM"
    else:
        current_risk_level = "LOW"

    if historical_fail_rate >= 0.35 or products_with_active_regression:
        risk_level = "HIGH"
    elif historical_fail_rate >= 0.15:
        risk_level = "MEDIUM"
    else:
        risk_level = "LOW"

    # Remediation Trajectory
    if current_compliance_score == 100.0 and historical_compliance_score == 100.0:
        remediation_status = "EXEMPLARY"
    elif current_compliance_score == 100.0 and historical_compliance_score < 100.0:
        remediation_status = "REMEDIATED"
    elif products_with_active_regression:
        remediation_status = "REGRESSED"
    else:
        remediation_status = "NON_COMPLIANT"

    # Historical rule fails across ALL packages
    total_historical_violations = 0
    for pkg in packages:
        for ev in pkg.evaluations:
            if ev.result in ["FAIL", "NEEDS_REVIEW"]:
                historical_rule_fails[ev.rule_id] = historical_rule_fails.get(ev.rule_id, 0) + 1
                total_historical_violations += 1

    def build_pareto(fail_dict: dict[str, int], total_count: int) -> list[dict[str, Any]]:
        breakdown = []
        for rid, count in sorted(fail_dict.items(), key=lambda item: item[1], reverse=True):
            meta = RULE_DESCRIPTIONS.get(rid, (f"Statutory requirement {rid}", rid))
            pct = round((count / total_count) * 100.0, 1) if total_count else 0.0
            breakdown.append({
                "rule_id": rid,
                "description": meta[0],
                "citation": meta[1],
                "fail_count": count,
                "percentage": pct,
            })
        return breakdown

    total_current_violations = sum(current_rule_fails.values())
    current_breakdown = build_pareto(current_rule_fails, total_current_violations)
    historical_breakdown = build_pareto(historical_rule_fails, total_historical_violations)

    return {
        "manufacturer_key": mfg.manufacturer_key,
        "manufacturer_name": mfg.normalized_name,
        "raw_name_address": mfg.raw_name_address,
        "product_count": len(prods),
        "total_inspections": total_inspections,
        "current_compliance_score": current_compliance_score,
        "current_fail_rate": current_fail_rate,
        "current_risk_level": current_risk_level,
        "historical_compliance_score": historical_compliance_score,
        "fail_rate": historical_fail_rate,
        "compliance_score": current_compliance_score,
        "risk_level": risk_level,
        "remediation_status": remediation_status,
        "products_with_active_regression": products_with_active_regression,
        "current_statutory_violations": current_breakdown,
        "historical_statutory_violations": historical_breakdown,
        "statutory_violations_breakdown": current_breakdown if current_breakdown else historical_breakdown,
        "products": product_list,
    }
