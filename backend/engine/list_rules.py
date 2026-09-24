"""
Prints a human-readable table of all loaded rules with their source citations,
verification status, and severity per Phase 1 Acceptance Criteria.
"""
from __future__ import annotations
import json
from pathlib import Path
from .evaluator import load_rules


def main():
    rules_dir = Path(__file__).parent / "rules"
    rules = load_rules(rules_dir)

    print("=" * 105)
    print(f"{'Rule ID':<22} | {'Ver':<3} | {'Scope':<15} | {'Required Field':<26} | {'Status':<15} | {'Source'}")
    print("=" * 105)

    for r in rules:
        scope = r.project_scope
        status = r.verification_status
        req_field = r.required_field
        print(f"{r.rule_id:<22} | {r.version:<3} | {scope:<15} | {req_field:<26} | {status:<15} | {r.source_citation[:45]}...")

    print("=" * 105)
    print(f"Total Rules Loaded: {len(rules)}")

    exemptions_path = rules_dir / "exemptions.json"
    if exemptions_path.exists():
        with open(exemptions_path, "r", encoding="utf-8") as fp:
            ex_data = json.load(fp)
            print(f"\nExemption Set: {ex_data.get('exemption_set')} ({ex_data.get('source_citation')})")
            for ex in ex_data.get("exemptions", []):
                print(f"  - [{ex.get('id')}]: {ex.get('description')} -> {ex.get('effect')}")


if __name__ == "__main__":
    main()
