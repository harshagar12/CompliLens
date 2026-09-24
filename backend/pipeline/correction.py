"""
Correction-suggestion module for CompliLens (PRD §5.3).
Provides perception assistance by generating cleanup suggestions for noisy OCR text.

STRICT SAFEGUARD ENFORCED:
- Suggestions are strictly additive: sets `suggested_value` and `suggestion_source`.
- NEVER overwrites `raw_value`.
- NEVER sets `confirmed_value` (only human reviewer action in Phase 3 sets confirmed_value).
"""
from __future__ import annotations
import os
import json
import re

try:
    from models.schemas import ExtractedField
except (ImportError, ValueError):
    from ..models.schemas import ExtractedField


def heuristic_clean_text(field_name: str, raw_val: str) -> str | None:
    """
    Fast rule-based cleanups for common OCR artifact errors.
    Returns cleaned string if an obvious typo fix was applied, else None.
    """
    cleaned = raw_val.strip()

    if field_name == "mrp":
        # Fix common OCR letter-number confusion in MRP: e.g. 'Rs. 3O.0O' -> 'Rs. 30.00'
        fixed_o = re.sub(r"(?<=[0-9.])O(?=[0-9.\s]|$)", "0", cleaned)
        fixed_o = re.sub(r"(?<=[0-9])O(?=[\s.]|$)", "0", fixed_o)
        fixed_o = re.sub(r"(?<=[\s₹Rs.])O(?=[0-9])", "0", fixed_o)
        if fixed_o != cleaned:
            return fixed_o

    elif field_name == "net_quantity":
        # Fix e.g. 'l00g' or '1OOg' -> '100g'
        fixed_val = re.sub(r"\bl(?=\d)", "1", cleaned)
        fixed_val = re.sub(r"(?<=\d)O(?=\d|[a-zA-Z]|\b)", "0", fixed_val)
        if fixed_val != cleaned:
            return fixed_val

    elif field_name == "manufacturer_name_address":
        # Fix common spacing before commas or double commas
        fixed_punc = re.sub(r"\s+,", ",", cleaned)
        fixed_punc = re.sub(r",+", ",", fixed_punc)
        if fixed_punc != cleaned:
            return fixed_punc

    return None


def suggest_field_corrections(
    fields: dict[str, ExtractedField],
    api_key: str | None = None,
    model_name: str = "gemini-3.6-flash",
) -> dict[str, ExtractedField]:
    """
    Generates suggested values for extracted fields.
    Tries Gemini Flash if api_key is present, otherwise falls back to deterministic heuristic suggestions.
    Mutates/returns ExtractedField objects with suggested_value and suggestion_source populated.
    """
    gemini_key = api_key or os.environ.get("GEMINI_API_KEY")
    if gemini_key:
        gemini_key = gemini_key.strip()

    if gemini_key:
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=gemini_key)
            fields_payload = {name: f.raw_value for name, f in fields.items()}

            prompt = (
                "You are an OCR text normalization assistant for product packaging compliance. "
                "Below are extracted raw OCR texts for packaged food declaration fields. "
                "Suggest minor OCR error corrections (e.g. fix obvious character typos, broken words, or OCR noise). "
                "Do NOT invent missing mandatory information or alter prices/dates. "
                "If the text already looks correct, return the same text.\n\n"
                f"Fields: {json.dumps(fields_payload, indent=2)}\n\n"
                "Return a JSON object mapping field_name to your suggested_value string."
            )

            models_to_try = [model_name, "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"]
            response = None
            for m in models_to_try:
                try:
                    response = client.models.generate_content(
                        model=m,
                        contents=prompt,
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json",
                            temperature=0.0,
                        ),
                    )
                    if response and response.text:
                        break
                except Exception:
                    continue

            if not response or not response.text:
                raise RuntimeError("No response from Gemini correction models")

            raw_resp = response.text.strip()
            if raw_resp.startswith("```"):
                raw_resp = raw_resp.strip("`").replace("json\n", "", 1).strip()

            suggestions = json.loads(raw_resp)
            for fname, field in fields.items():
                if fname in suggestions:
                    sugg = str(suggestions[fname]).strip()
                    if sugg and sugg != field.raw_value:
                        field.suggested_value = sugg
                        field.suggestion_source = "gemini-flash"

            return fields

        except Exception as e:
            # Fall back to heuristic cleaning if API call fails or rate limited
            pass

    # Heuristic fallback
    for fname, field in fields.items():
        heuristic_sugg = heuristic_clean_text(fname, field.raw_value)
        if heuristic_sugg and heuristic_sugg != field.raw_value:
            field.suggested_value = heuristic_sugg
            field.suggestion_source = "heuristic"

    return fields
