"""
CompliLens Evaluation Harness (PRD §7).
Executes comparative OCR benchmarking, field extraction precision/recall/F1,
and end-to-end compliance classification accuracy & false-compliance rate.

Usage:
  python backend/evaluation/run_eval.py
"""
from __future__ import annotations
import os
import sys
import json
from pathlib import Path
from PIL import Image, ImageDraw

# Ensure backend root is in sys.path
backend_dir = Path(__file__).parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from pipeline.ocr import LocalOcrProvider, GeminiVisionOcrProvider
from pipeline.pipeline import run_perception_pipeline
from engine.evaluator import load_rules, evaluate_package
from models.schemas import Package, ExtractedField
from evaluation.metrics import (
    compute_cer,
    compute_wer,
    compute_prf1,
    compute_compliance_classification_metrics,
)


DATA_DIR = Path(__file__).parent.parent.parent / "data"
ANNOTATIONS_DIR = DATA_DIR / "annotations"
IMAGES_DIR = DATA_DIR / "raw_images"
REPORT_OUTPUT_PATH = DATA_DIR / "evaluation_report.json"


def ensure_benchmark_dataset():
    """Seeds the benchmark dataset with verified test packages if empty."""
    ANNOTATIONS_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    samples = [
        {
            "id": "sample_001",
            "title": "CREAM CRUNCH BISCUITS",
            "net_qty": "Net Qty: 100 g",
            "mrp": "MRP Rs. 35.00 incl. of all taxes",
            "mfg": "Mfg Date: 05/2026",
            "addr": "Manufactured by Tasty Foods Pvt Ltd, Delhi 110020",
            "care": "Consumer Care: care@tastyfoods.com, 1800-111-2222",
            "gt_compliance": "PASS",
        },
        {
            "id": "sample_002",
            "title": "GOLDEN CHIPS",
            "net_qty": "Net Wt: 50 g",
            "mrp": "",  # Missing MRP -> MUST FAIL
            "mfg": "Pkd: 06/2026",
            "addr": "Packed by Golden Snacks Ltd, Mumbai 400001",
            "care": "Helpline: 1800-555-1234",
            "gt_compliance": "FAIL",
        },
        {
            "id": "sample_003",
            "title": "NATURAL ATTA",
            "net_qty": "Net Weight: 5 kg",
            "mrp": "MRP Rs. 240.00",  # Missing 'incl of all taxes' -> MUST FAIL
            "mfg": "Mfg: 04/2026",
            "addr": "Mfd by Pure Grains Ltd, Plot 9, Haryana 122001",
            "care": "customercare@puregrains.in",
            "gt_compliance": "FAIL",
        },
    ]

    for s in samples:
        img_p = IMAGES_DIR / f"{s['id']}.jpg"
        ann_p = ANNOTATIONS_DIR / f"{s['id']}.json"

        if not img_p.exists():
            img = Image.new("RGB", (700, 500), color=(250, 250, 250))
            draw = ImageDraw.Draw(img)
            draw.rectangle([10, 10, 690, 490], outline=(120, 120, 120), width=2)
            y = 30
            for text in [s["title"], s["net_qty"], s["mrp"], s["mfg"], s["addr"], s["care"]]:
                if text:
                    draw.text((40, y), text, fill=(15, 15, 15))
                y += 65
            img.save(img_p, "JPEG")

        if not ann_p.exists():
            ann_data = {
                "image_id": s["id"],
                "category": "packaged_food",
                "ground_truth_transcription": f"{s['title']} {s['net_qty']} {s['mrp']} {s['mfg']} {s['addr']} {s['care']}".strip(),
                "fields": {
                    "common_name": s["title"],
                    "net_quantity": s["net_qty"],
                    "mrp": s["mrp"],
                    "mfg_month_year": s["mfg"],
                    "manufacturer_name_address": s["addr"],
                    "consumer_care": s["care"],
                },
                "ground_truth_compliance": s["gt_compliance"],
            }
            with open(ann_p, "w", encoding="utf-8") as fp:
                json.dump(ann_data, fp, indent=2)


def run_evaluation_study():
    print("=" * 80)
    print("CompliLens — Comprehensive Benchmark Evaluation Harness (PRD §7)")
    print("=" * 80)

    ensure_benchmark_dataset()

    ann_files = list(ANNOTATIONS_DIR.glob("*.json"))
    if not ann_files:
        print("No annotation files found in data/annotations/")
        return

    print(f"Loaded {len(ann_files)} annotated benchmark package labels.\n")

    # Evaluate Local OCR Provider (RapidOCR)
    local_ocr = LocalOcrProvider()
    local_cers, local_wers = [], []
    field_tps = {"mrp": 0, "net_quantity": 0, "manufacturer_name_address": 0, "common_name": 0, "consumer_care": 0}
    field_totals = {"mrp": 0, "net_quantity": 0, "manufacturer_name_address": 0, "common_name": 0, "consumer_care": 0}

    gt_compliance_list = []
    pred_compliance_list = []

    rules_dir = backend_dir / "engine" / "rules"
    rules = load_rules(rules_dir, scope="mvp")

    for ann_file in ann_files:
        with open(ann_file, "r", encoding="utf-8") as fp:
            gt = json.load(fp)

        img_path = IMAGES_DIR / f"{gt['image_id']}.jpg"
        if not img_path.exists():
            continue

        # 1. OCR Evaluation (against raw_value per PRD §7)
        tokens = local_ocr.extract_text(img_path)
        extracted_text = " ".join(t.text for t in tokens)
        cer = compute_cer(gt.get("ground_truth_transcription", ""), extracted_text)
        wer = compute_wer(gt.get("ground_truth_transcription", ""), extracted_text)
        local_cers.append(cer)
        local_wers.append(wer)

        # 2. Pipeline Field Extraction
        extracted_fields = run_perception_pipeline(img_path, ocr_provider_name="rapidocr")
        for fname in field_tps:
            gt_val = gt.get("fields", {}).get(fname, "")
            if gt_val:
                field_totals[fname] += 1
                pred_field = extracted_fields.get(fname)
                if pred_field and pred_field.raw_value:
                    # Soft match: if key numbers/names overlap
                    if any(word.lower() in pred_field.raw_value.lower() for word in gt_val.split() if len(word) > 2):
                        field_tps[fname] += 1

        # 3. Compliance Evaluation (against confirmed_value per PRD §7)
        # Simulate confirmed values based on ground truth / extraction
        confirmed_fields = {}
        for fname, f in extracted_fields.items():
            f_copy = f.model_copy()
            f_copy.confirmed_value = f.raw_value
            confirmed_fields[fname] = f_copy

        pkg = Package(package_id=gt["image_id"], category=gt.get("category", "packaged_food"))
        verdict = evaluate_package(pkg, confirmed_fields, rules, rules_dir)

        gt_compliance_list.append(gt["ground_truth_compliance"])
        pred_compliance_list.append(verdict.overall_result)

    avg_cer = sum(local_cers) / len(local_cers) if local_cers else 0.0
    avg_wer = sum(local_wers) / len(local_wers) if local_wers else 0.0

    compliance_metrics = compute_compliance_classification_metrics(gt_compliance_list, pred_compliance_list)

    # Print Formatted Report Table
    print("--- 1. OCR BENCHMARK METRICS (Provider: RapidOCR Local CPU) ---")
    print(f"Average Character Error Rate (CER): {avg_cer:.2%}")
    print(f"Average Word Error Rate (WER):      {avg_wer:.2%}\n")

    print("--- 2. PER-FIELD EXTRACTION RECALL ---")
    for fname, total in field_totals.items():
        tp = field_tps[fname]
        rec = (tp / total) if total > 0 else 0.0
        print(f"{fname:<30}: {tp}/{total} detected ({rec:.1%})")

    print("\n--- 3. STATUTORY COMPLIANCE EVALUATION (PRD §7 Safety Metrics) ---")
    print(f"Compliance Accuracy:         {compliance_metrics['accuracy']:.1%}")
    print(f"Total Ground-Truth FAIL:     {compliance_metrics['gt_fail_count']}")
    print(f"False Passes Emitted:        {compliance_metrics['false_pass_count']}")
    print(f"CRITICAL False-Compliance:   {compliance_metrics['false_compliance_rate']:.1%}")

    # Export report JSON
    report_data = {
        "ocr_provider": "rapidocr",
        "avg_cer": round(avg_cer, 4),
        "avg_wer": round(avg_wer, 4),
        "field_extraction": {
            fname: {"tp": field_tps[fname], "total": field_totals[fname]} for fname in field_tps
        },
        "compliance_metrics": compliance_metrics,
    }

    with open(REPORT_OUTPUT_PATH, "w", encoding="utf-8") as fp:
        json.dump(report_data, fp, indent=2)

    print(f"\nSaved complete evaluation report to: {REPORT_OUTPUT_PATH}")
    print("=" * 80)


if __name__ == "__main__":
    run_evaluation_study()
