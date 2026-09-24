from __future__ import annotations
import json
from pathlib import Path
import jsonschema
import pytest


RULES_DIR = Path(__file__).parent.parent / "engine" / "rules"
SCHEMA_PATH = RULES_DIR / "rule.schema.json"


@pytest.fixture
def rule_schema():
    assert SCHEMA_PATH.exists(), f"Schema file not found at {SCHEMA_PATH}"
    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def test_rule_schema_is_valid(rule_schema):
    """Ensure the JSON schema itself is valid Draft-07 schema."""
    jsonschema.Draft7Validator.check_schema(rule_schema)


def test_all_rules_validate_against_schema(rule_schema):
    """Validate every rule file in rules/ against rule.schema.json."""
    rule_files = list(RULES_DIR.glob("lmpc_*.json"))
    assert len(rule_files) > 0, "No rule JSON files found to validate"

    for rule_file in rule_files:
        with open(rule_file, "r", encoding="utf-8") as f:
            rule_data = json.load(f)
        try:
            jsonschema.validate(instance=rule_data, schema=rule_schema)
        except jsonschema.ValidationError as e:
            pytest.fail(f"Rule file {rule_file.name} failed schema validation: {e.message}")
