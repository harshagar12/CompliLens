"""
Storage and repository layer for CompliLens packages, fields, evaluations, and reviewer decisions.
Provides robust file/memory persistence for local development and inspection audits.
"""
from __future__ import annotations
import json
import os
from pathlib import Path
from datetime import datetime
from typing import Any

from models.schemas import (
    Package,
    ExtractedField,
    Evaluation,
    PackageVerdict,
    ReviewerDecisionRequest,
)


DATA_DIR = Path(__file__).parent.parent / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
CROPS_DIR = DATA_DIR / "crops"
DB_FILE = DATA_DIR / "complilens_db.json"


class StorageManager:
    def __init__(self):
        UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        CROPS_DIR.mkdir(parents=True, exist_ok=True)
        self.packages: dict[str, dict[str, Any]] = {}
        self.review_queue: dict[str, dict[str, Any]] = {}  # evaluation_id -> record
        self.reviewer_decisions: list[dict[str, Any]] = []
        self._load_from_disk()

    def _load_from_disk(self):
        if DB_FILE.exists():
            try:
                with open(DB_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.packages = data.get("packages", {})
                    self.review_queue = data.get("review_queue", {})
                    self.reviewer_decisions = data.get("reviewer_decisions", [])
            except Exception:
                pass

    def save_to_disk(self):
        try:
            with open(DB_FILE, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "packages": self.packages,
                        "review_queue": self.review_queue,
                        "reviewer_decisions": self.reviewer_decisions,
                    },
                    f,
                    indent=2,
                    default=str,
                )
        except Exception:
            pass

    def create_package(self, package_id: str, category: str, image_filename: str) -> Package:
        pkg = Package(
            package_id=package_id,
            category=category,
            image_filename=image_filename,
        )
        self.packages[package_id] = {
            "package": pkg.model_dump(),
            "fields": {},
            "verdict": None,
            "status": "UPLOADED",
            "created_at": datetime.utcnow().isoformat(),
        }
        self.save_to_disk()
        return pkg

    def get_package(self, package_id: str) -> dict[str, Any] | None:
        return self.packages.get(package_id)

    def list_packages(self) -> list[dict[str, Any]]:
        return [
            {
                "package_id": pid,
                "category": p["package"].get("category", "packaged_food"),
                "status": p.get("status", "UPLOADED"),
                "image_filename": p["package"].get("image_filename"),
                "overall_result": p["verdict"].get("overall_result") if p.get("verdict") else None,
                "created_at": p.get("created_at"),
            }
            for pid, p in self.packages.items()
        ]

    def store_extracted_fields(self, package_id: str, fields: dict[str, ExtractedField]):
        if package_id in self.packages:
            self.packages[package_id]["fields"] = {
                fname: f.model_dump() for fname, f in fields.items()
            }
            self.packages[package_id]["status"] = "EXTRACTED"
            self.save_to_disk()

    def update_confirmed_fields(self, package_id: str, updates: list[dict[str, Any]]) -> bool:
        if package_id not in self.packages:
            return False

        fields_dict = self.packages[package_id].get("fields", {})
        for update in updates:
            fname = update.get("field_name")
            if fname in fields_dict:
                fields_dict[fname]["confirmed_value"] = update.get("confirmed_value")
                fields_dict[fname]["reviewer_action"] = update.get("reviewer_action")

        self.packages[package_id]["fields"] = fields_dict
        self.packages[package_id]["status"] = "REVIEWED"
        self.save_to_disk()
        return True

    def store_verdict(self, package_id: str, verdict: PackageVerdict):
        if package_id in self.packages:
            self.packages[package_id]["verdict"] = verdict.model_dump()
            self.packages[package_id]["status"] = "EVALUATED"

            # Add any NEEDS_REVIEW items to the review queue
            for ev in verdict.evaluations:
                if ev.result == "NEEDS_REVIEW" and ev.evaluation_id:
                    self.review_queue[ev.evaluation_id] = {
                        "evaluation": ev.model_dump(),
                        "package_id": package_id,
                        "status": "PENDING_REVIEW",
                        "created_at": datetime.utcnow().isoformat(),
                    }

            self.save_to_disk()

    def get_review_queue(self) -> list[dict[str, Any]]:
        return [
            {
                "evaluation_id": eid,
                "package_id": item["package_id"],
                "status": item["status"],
                **item["evaluation"],
            }
            for eid, item in self.review_queue.items()
            if item.get("status") == "PENDING_REVIEW"
        ]

    def record_reviewer_decision(
        self, evaluation_id: str, req: ReviewerDecisionRequest
    ) -> bool:
        decision_record = {
            "evaluation_id": evaluation_id,
            "decision": req.decision,
            "note": req.note,
            "reviewer": req.reviewer,
            "decided_at": datetime.utcnow().isoformat(),
        }
        self.reviewer_decisions.append(decision_record)

        if evaluation_id in self.review_queue:
            pkg_id = self.review_queue[evaluation_id]["package_id"]
            self.review_queue[evaluation_id]["status"] = req.decision

            # Update evaluation result in package verdict if overridden
            pkg_record = self.packages.get(pkg_id)
            if pkg_record and pkg_record.get("verdict"):
                for ev in pkg_record["verdict"]["evaluations"]:
                    if ev.get("evaluation_id") == evaluation_id:
                        if req.decision == "OVERRIDE_PASS":
                            ev["result"] = "PASS"
                            ev["notes"] = f"Override to PASS by {req.reviewer}: {req.note or ''}"
                        elif req.decision == "OVERRIDE_FAIL":
                            ev["result"] = "FAIL"
                            ev["notes"] = f"Override to FAIL by {req.reviewer}: {req.note or ''}"
                        elif req.decision == "APPROVE":
                            ev["notes"] = f"Reviewed & Approved by {req.reviewer}: {req.note or ''}"

                # Recompute overall result
                evals = pkg_record["verdict"]["evaluations"]
                has_fail = any(e["result"] == "FAIL" for e in evals)
                has_nr = any(e["result"] == "NEEDS_REVIEW" for e in evals)
                pkg_record["verdict"]["overall_result"] = "FAIL" if has_fail else ("NEEDS_REVIEW" if has_nr else "PASS")

        self.save_to_disk()
        return True


storage = StorageManager()
