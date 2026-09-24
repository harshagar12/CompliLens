"""
CompliLens — Single-Prompt LLM Semantic Diff Engine.
Analyzes minute, non-statutory packaging changes across 2 to 5 package revisions in a single API call:
- Ingredients formulation (additions, deletions, substitutions, percentage shifts)
- Allergen warnings (newly added or removed allergen declarations)
- Nutritional facts (significant shifts in calories, sugar, sodium, fat per 100g)
- Marketing claims (promotional buzzwords added or dropped)
Includes a deterministic heuristic fallback when Gemini API is unavailable or unconfigured.
"""
from __future__ import annotations
import os
import json
import re
from typing import Any
COMMON_ALLERGENS = [
    "Wheat", "Gluten", "Milk", "Dairy", "Soy", "Soya", "Peanuts", "Nuts", "Tree Nuts",
    "Almonds", "Cashews", "Walnuts", "Pistachios", "Sesame", "Egg", "Fish", "Crustacean",
    "Sulphite", "Mustard", "Celery", "Lupin", "Molluscs"
]

COMMON_CLAIMS = [
    "100% Veg", "100% Vegetarian", "100% Natural", "No Artificial Colours", "No Artificial Flavours",
    "No Added Preservatives", "Zero Trans Fat", "High Fibre", "Rich in Fibre", "Rich in Protein",
    "Source of Protein", "Source of Calcium", "Source of Energy", "Whole Grain", "Made with Whole Grains",
    "Goodness in Every Bite", "Naturally Nutty", "Deliciously Crunchy", "Baked Not Fried", "Zero Cholesterol",
    "Low Sodium", "No Added Sugar", "Gluten Free", "Organic"
]

CLAIM_REGEX_PATTERNS = [
    ("Rich in Fibre", r"\brich\s*in\s*fib(?:re|er)\b"),
    ("Made with Whole Grains", r"\bmade\s*with\s*(?:whole\s*)?grains?\b"),
    ("Source of Energy", r"\bsource\s*of\s*energy\b"),
    ("No Artificial Colours", r"\bno\s*artificial\s*col(?:ours?|ors?)\b"),
    ("No Artificial Flavours", r"\bno\s*artificial\s*flav(?:ours?|ors?)\b"),
    ("No Added Preservatives", r"\bno\s*added\s*preservatives?\b"),
    ("100% Vegetarian", r"\b100%\s*veg(?:etarian)?\b"),
    ("100% Natural", r"\b100%\s*natural\b"),
    ("Zero Trans Fat", r"\bzero\s*trans\s*fat\b"),
    ("High Fibre", r"\bhigh\s*fib(?:re|er)\b"),
    ("Rich in Protein", r"\brich\s*in\s*protein\b"),
    ("Source of Protein", r"\bsource\s*of\s*protein\b"),
    ("Gluten Free", r"\bgluten\s*free\b"),
    ("Whole Grain", r"\bwhole\s*grains?\b"),
]


def extract_non_statutory_from_text(full_text: str) -> dict[str, Any]:
    """
    Extracts ingredients, allergens, nutritional facts, and marketing claims
    from raw OCR text using regex and domain heuristics.
    """
    cleaned_text = re.sub(r"\s+", " ", full_text or "").strip()
    lower_text = cleaned_text.lower()

    # 1. Ingredients extraction
    ingredients_text = ""
    ingredients_list: list[str] = []

    # Match ingredients block until a major section boundary
    ing_match = re.search(
        r"(?:ingredients|ingr[eé]dients|ingrediente)\s*[:\-\.]?\s*(.*?)(?=(?:ALLERGEN\s*(?:INFORMATION|ADVICE|DECLARATION)?|CONTAINS\s*:|MANUFACTURED\s*BY|MFD\.?\s*BY|PACKED\s*BY|MARKETED\s*BY|NUTRITION(?:AL)?\s*(?:INFORMATION|FACTS)?|STORAGE|STORE\s*IN|FOR\s*(?:FEEDBACK|CONSUMER)|CONSUMER\s*CARE|FSSAI\s*LIC|\Z))",
        cleaned_text,
        re.IGNORECASE
    )
    if ing_match and len(ing_match.group(1).strip()) > 5:
        raw_ing = ing_match.group(1).strip()
    else:
        # Fallback: capture until allergen or manufacturer or consumer care
        m_alt = re.search(r"(?:ingredients|ingrediente)\s*[:\-\.]?\s*(.*?)(?=(?:allergen|manufactured\s*and\s*packed|consumer\s*care|\Z))", cleaned_text, re.IGNORECASE)
        raw_ing = m_alt.group(1).strip() if m_alt else ""

    if raw_ing:
        # Strip partial "Ingredients" prefix fragments from OCR token splits (e.g. "nts:", "ents:", "dients:")
        raw_ing = re.sub(r'^(?:[a-zA-Z0-9]*ients|[a-zA-Z0-9]*nts|[a-zA-Z0-9]*ents)\s*[:\-\.]*\s*', '', raw_ing, flags=re.IGNORECASE).strip()
        # Clean out interspersed noise words from adjacent columns
        cleaned_ing = re.sub(r'\bNet\s*Quantity\s*[:\.]?\s*[0-9\.]+\s*(?:g|gm|kg|ml|l)\b', '', raw_ing, flags=re.IGNORECASE)
        cleaned_ing = re.sub(r'\bMRP\s*(?:Rs\.?|₹|\?)?\s*[0-9\.]+\b', '', cleaned_ing, flags=re.IGNORECASE)
        cleaned_ing = re.sub(r'\b(?:Nutritional\s*Information|per\s*100\s*g|Serving\s*size)\b', '', cleaned_ing, flags=re.IGNORECASE)
        
        # Aggressively strip standalone nutrient values (e.g., '480kcal', '7g', '15mg') that got orphaned during layout merge
        cleaned_ing = re.sub(r'\b[0-9]+(?:\.[0-9]+)?\s*(?:kcal|g|mg|mcg|cal|kj)\b', '', cleaned_ing, flags=re.IGNORECASE)
        # Also strip nutrient names just in case they survived
        cleaned_ing = re.sub(r'\b(?:Energy|Protein|Carbohydrate[s]?|Total\s*Fat|Saturated\s*Fat|Trans\s*Fat|Total\s*Sugars?|Dietary\s*Fibr?e?|Sodium)\b\s*[:\.]?', '', cleaned_ing, flags=re.IGNORECASE)
        
        cleaned_ing = re.sub(r'\b(?:incl\.?|inclusive)\s*of\s*all\s*taxes\b', '', cleaned_ing, flags=re.IGNORECASE)
        cleaned_ing = re.sub(r'\bMfg(?:\s*Date)?\s*[:\.]?\s*[0-9\/\-]+\b', '', cleaned_ing, flags=re.IGNORECASE)
        cleaned_ing = re.sub(r'\bBatch(?:\s*No\.?)?\s*[:\.]?\s*[A-Z0-9\-]+\b', '', cleaned_ing, flags=re.IGNORECASE)
        cleaned_ing = cleaned_ing.replace('（', '(').replace('）', ')')
        cleaned_ing = re.sub(r'\s+', ' ', cleaned_ing).strip(' :,-.')

        if len(cleaned_ing) > 4:
            ingredients_text = cleaned_ing
            parts = re.split(r"[,;]\s*(?![^()]*\))", cleaned_ing)
            final_parts = []
            for p in parts:
                subparts = re.split(r"\.\s+(?![^()]*\))", p)
                for sp in subparts:
                    clean_p = sp.strip(" .;-")
                    if clean_p and len(clean_p) > 1 and not clean_p.lower().startswith("nutritional"):
                        final_parts.append(clean_p)
            ingredients_list = final_parts

    # 2. Allergens extraction
    allergens: list[str] = []
    allergen_match = re.search(
        r"(?:allergen\s*(?:information|advice|declaration)?|contains)\s*[:\-\.]?\s*(.*?)(?=(?:mfg|m\.?r\.?p|batch|pkg|net\s*qty|customer|consumer|lic|fssai|nutrition|\.|\Z))",
        cleaned_text,
        re.IGNORECASE
    )
    if allergen_match:
        all_block = allergen_match.group(1).lower()
        for a in COMMON_ALLERGENS:
            if a.lower() in all_block and a not in allergens:
                allergens.append(a)

    if not allergens:
        for a in COMMON_ALLERGENS:
            if re.search(r"\b" + re.escape(a.lower()) + r"\b", lower_text) and a not in allergens:
                allergens.append(a)

    # 3. Nutritional table extraction — Bidirectional to handle unpredictable OCR column reading order
    nutrition_table: dict[str, str] = {}

    # Isolate nutrition block if present to avoid false matches elsewhere
    nut_block_m = re.search(
        r"(?:nutritional\s*(?:information|facts)|per\s*100\s*g)(.*?)(?=(?:manufactured|packed|consumer\s*care|mfg|ingredients|\Z))",
        full_text, re.IGNORECASE | re.DOTALL
    )
    nut_block_text = nut_block_m.group(1) if nut_block_m else full_text

    nutrient_targets = [
        ("Energy", r"(?:energy|calories|caloric\s*value)", r"(?:kcal|cal|kj)"),
        ("Protein", r"(?:protein)", r"(?:g|gm)"),
        ("Carbohydrate", r"(?:carbohydrate[s]?|carbs)", r"(?:g|gm)"),
        ("Total Sugars", r"(?:total\s*sugars?|sugars?)", r"(?:g|gm)"),
        ("Added Sugars", r"(?:added\s*sugars?)", r"(?:g|gm)"),
        ("Total Fat", r"(?:total\s*fat|fat)", r"(?:g|gm)"),
        ("Saturated Fat", r"(?:saturated\s*fat[s]?|sat\s*fat)", r"(?:g|gm)"),
        ("Trans Fat", r"(?:trans\s*fat[s]?)", r"(?:g|gm)"),
        ("Dietary Fibre", r"(?:dietary\s*fib(?:re|er)|fib(?:re|er))", r"(?:g|gm)"),
        ("Sodium", r"(?:sodium|salt)", r"(?:mg|g)"),
        ("Cholesterol", r"(?:cholesterol)", r"(?:mg)"),
    ]

    for nutrient_name, name_pat, unit_pat in nutrient_targets:
        # Try finding value AFTER the nutrient name
        pat_forward = name_pat + r"[^a-zA-Z0-9]{0,20}?([0-9]+(?:\.[0-9]+)?\s*" + unit_pat + r"?)"
        # Try finding value BEFORE the nutrient name
        pat_backward = r"([0-9]+(?:\.[0-9]+)?\s*" + unit_pat + r"?)[^a-zA-Z0-9]{0,20}?" + name_pat

        m = re.search(pat_forward, nut_block_text, re.IGNORECASE)
        if not m:
            m = re.search(pat_backward, nut_block_text, re.IGNORECASE)

        if m:
            val = m.group(1).strip()
            if nutrient_name == "Energy" and not any(u in val.lower() for u in ["kcal", "cal", "kj"]):
                val += " kcal"
            elif nutrient_name in ["Sodium", "Cholesterol"] and not any(u in val.lower() for u in ["mg", "g"]):
                val += " mg"
            elif nutrient_name not in ["Energy", "Sodium", "Cholesterol"] and not any(u in val.lower() for u in ["g", "gm"]):
                val += " g"
            nutrition_table[nutrient_name] = val

    # 4. Marketing claims extraction
    claims: list[str] = []
    for c_name, pat in CLAIM_REGEX_PATTERNS:
        if re.search(pat, cleaned_text, re.IGNORECASE):
            if c_name not in claims:
                claims.append(c_name)

    for claim in COMMON_CLAIMS:
        if claim not in claims and re.search(r"\b" + re.escape(claim.lower()) + r"\b", lower_text):
            claims.append(claim)

    return {
        "ingredients_text": ingredients_text,
        "ingredients_list": ingredients_list,
        "allergens": allergens,
        "nutrition_table": nutrition_table,
        "marketing_claims": claims,
    }


DIFF_PROMPT_TEMPLATE = """You are a senior food regulatory scientist and packaging auditor inspecting packaging changes over time across product revisions.
Below are the extracted OCR texts from {num_revisions} revisions of the same product, ordered chronologically (Revision 1 is oldest/baseline, Revision {num_revisions} is newest).

{revisions_text}

Perform a rigorous comparative audit across these revisions.
CRITICAL SEMANTIC MATCHING RULES:
1. SYNONYMOUS INGREDIENTS: Recognize equivalent ingredient names across revisions as the SAME ingredient.
   - "Maida" vs "Refined Wheat Flour (Maida)" vs "Refined Wheat Flour" are the SAME ingredient.
   - "Atta" vs "Whole Wheat Flour (Atta)" vs "Whole Wheat Flour" are the SAME ingredient.
   - "Edible Vegetable Oil (Sunflower Oil)" vs "Sunflower Oil" are the SAME ingredient.
   - Do NOT mark these synonymous wordings as substitutions or added/removed!
2. PERCENTAGE SHIFTS: When an ingredient percentage changes (e.g. Rolled Oats: 15% -> 8%, or Atta: 55% -> 52%):
   - Record it under "percentage_changes".
   - Do NOT record it under "added" or "removed"!
3. COMPOUND ADDITIVES: Split compound additives like "Raising Agents (INS 500(i), INS 503(ii))" into individual components ["Raising Agent (INS 500(i))", "Raising Agent (INS 503(ii))"] and match each individually across revisions.
4. SUBSTITUTIONS: Only record true recipe replacements (e.g. Sunflower Oil replaced by Palm Oil, Sugar replaced by Honey).

Return ONLY valid JSON matching this exact structure:
{{
  "revisions_extracted": [
    {{
      "revision_index": 1,
      "ingredients_text": "Full ingredients clause text as printed on Revision 1 label",
      "ingredients_list": ["list", "of", "each", "parsed", "ingredient", "with", "percentages"],
      "allergens": ["list", "of", "declared", "allergens"],
      "nutrition_table": {{
        "Energy": "480 kcal",
        "Protein": "6.5 g",
        "Carbohydrate": "68 g",
        "Total Sugars": "24 g",
        "Added Sugars": "20 g",
        "Total Fat": "18 g",
        "Saturated Fat": "8 g",
        "Trans Fat": "0 g",
        "Cholesterol": "0 mg",
        "Sodium": "210 mg"
      }},
      "marketing_claims": ["list", "of", "promotional", "slogans", "and", "claims"]
    }}
  ],
  "ingredients_summary": {{
    "added": ["list of ingredients genuinely introduced in later revisions"],
    "removed": ["list of ingredients dropped in later revisions"],
    "substitutions": [
      {{
        "old_ingredient": "e.g. Sunflower Oil",
        "new_ingredient": "e.g. Palm Oil",
        "detail": "Replaced sunflower oil with palm oil"
      }}
    ],
    "percentage_changes": [
      {{
        "ingredient": "e.g. Rolled Oats",
        "change": "e.g. 15% -> 8%",
        "detail": "Reduced percentage of oats from 15% to 8%"
      }}
    ],
    "notes": "Concise summary of recipe formulation shifts"
  }},
  "allergens_summary": {{
    "added": ["list of allergens newly declared in later revisions"],
    "removed": ["list of allergens dropped in later revisions"],
    "risk_level": "HIGH",
    "risk_explanation": "Explain any critical health risks from newly introduced allergens"
  }},
  "nutritional_summary": {{
    "significant_changes": [
      "e.g. Added sugars increased from 12g to 18g per 100g (+50%)",
      "e.g. Sodium reduced from 350mg to 280mg per 100g (-20%)"
    ],
    "health_direction": "NEUTRAL"
  }},
  "marketing_claims_summary": {{
    "added_claims": ["claims introduced in newer revisions, e.g. 'Crunchy Nutty Bite'"],
    "dropped_claims": ["claims removed in newer revisions, e.g. 'Rich in Fibre'"]
  }}
}}
Return ONLY the raw JSON object, without markdown formatting or backticks.
"""


def _local_heuristic_diff(revisions_data: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Fast, reliable local fallback when LLM API is unavailable.
    Performs deterministic extraction and set diffs on raw OCR text.
    """
    revisions_extracted = []
    for idx, rev in enumerate(revisions_data, start=1):
        user_ns = rev.get("non_statutory") or {}
        # If user reviewed or provided non-statutory data, preserve user edits!
        if user_ns and (
            user_ns.get("ingredients_text")
            or user_ns.get("ingredients_list")
            or user_ns.get("allergens")
            or user_ns.get("nutrition_table")
            or user_ns.get("marketing_claims")
        ):
            ing_list = user_ns.get("ingredients_list") or []
            if not ing_list and user_ns.get("ingredients_text"):
                ing_list = [p.strip() for p in re.split(r"[,;]\s*(?![^()]*\))", user_ns["ingredients_text"]) if p.strip()]
            revisions_extracted.append({
                "revision_index": idx,
                "package_id": rev.get("package_id"),
                "ingredients_text": user_ns.get("ingredients_text", ""),
                "ingredients_list": ing_list,
                "allergens": user_ns.get("allergens") or [],
                "nutrition_table": user_ns.get("nutrition_table") or {},
                "marketing_claims": user_ns.get("marketing_claims") or [],
            })
        else:
            full_text = rev.get("full_text", "")
            extracted = extract_non_statutory_from_text(full_text)
            revisions_extracted.append({
                "revision_index": idx,
                "package_id": rev.get("package_id"),
                "ingredients_text": extracted["ingredients_text"],
                "ingredients_list": extracted["ingredients_list"],
                "allergens": extracted["allergens"],
                "nutrition_table": extracted["nutrition_table"],
                "marketing_claims": extracted["marketing_claims"],
            })

    if len(revisions_data) < 2:
        return {
            "revisions_extracted": revisions_extracted,
            "ingredients_summary": {"added": [], "removed": [], "substitutions": [], "percentage_changes": [], "notes": "Insufficient revisions to compare."},
            "allergens_summary": {"added": [], "removed": [], "risk_level": "NONE", "risk_explanation": "No variance."},
            "nutritional_summary": {"significant_changes": [], "health_direction": "NEUTRAL"},
            "marketing_claims_summary": {"added_claims": [], "dropped_claims": []},
        }

    # Compare first (oldest) and last (newest)
    first_ext = revisions_extracted[0]
    last_ext = revisions_extracted[-1]

    # Allergens diff
    first_all = set(a.lower() for a in first_ext["allergens"])
    last_all = set(a.lower() for a in last_ext["allergens"])

    added_allergens = [a.title() for a in last_ext["allergens"] if a.lower() not in first_all]
    removed_allergens = [a.title() for a in first_ext["allergens"] if a.lower() not in last_all]
    risk_level = "HIGH" if added_allergens else ("MEDIUM" if removed_allergens else "NONE")
    risk_exp = (
        f"Critical allergen alert: {', '.join(added_allergens)} newly declared in recent revision."
        if added_allergens
        else "No newly introduced allergens detected across packaging revisions."
    )

    # Ingredients diff & substitutions
    first_ing = set(i.lower() for i in first_ext["ingredients_list"])
    last_ing = set(i.lower() for i in last_ext["ingredients_list"])

    added_ingredients = [i for i in last_ext["ingredients_list"] if i.lower() not in first_ing]
    removed_ingredients = [i for i in first_ext["ingredients_list"] if i.lower() not in last_ing]

    substitutions = []
    # Check common substitutions
    rev_first_raw = (revisions_data[0].get("non_statutory", {}).get("ingredients_text") or revisions_data[0].get("full_text", "")).lower()
    rev_last_raw = (revisions_data[-1].get("non_statutory", {}).get("ingredients_text") or revisions_data[-1].get("full_text", "")).lower()

    if "palm oil" in rev_last_raw and "palm oil" not in rev_first_raw:
        substitutions.append({
            "old_ingredient": "Vegetable Oil / Sunflower Oil",
            "new_ingredient": "Palm Oil",
            "detail": "Transitioned recipe to Palm Oil in newer packaging batch"
        })
    if "atta" in rev_last_raw and "maida" in rev_first_raw and "atta" not in rev_first_raw:
        substitutions.append({
            "old_ingredient": "Refined Wheat Flour (Maida)",
            "new_ingredient": "Whole Wheat Flour (Atta)",
            "detail": "Substituted refined flour with whole wheat"
        })

    # Nutritional changes
    nut_changes = []
    first_nut = first_ext["nutrition_table"]
    last_nut = last_ext["nutrition_table"]
    for key in set(first_nut.keys()).union(last_nut.keys()):
        v1 = first_nut.get(key)
        v2 = last_nut.get(key)
        if v1 and v2 and v1 != v2:
            nut_changes.append(f"{key} changed from {v1} to {v2}")

    # Marketing claims diff
    first_claims = set(c.lower() for c in first_ext["marketing_claims"])
    last_claims = set(c.lower() for c in last_ext["marketing_claims"])
    added_claims = [c for c in last_ext["marketing_claims"] if c.lower() not in first_claims]
    dropped_claims = [c for c in first_ext["marketing_claims"] if c.lower() not in last_claims]

    return {
        "revisions_extracted": revisions_extracted,
        "ingredients_summary": {
            "added": added_ingredients[:10] if added_ingredients else [s["new_ingredient"] for s in substitutions],
            "removed": removed_ingredients[:10],
            "substitutions": substitutions,
            "percentage_changes": [],
            "notes": "Detected recipe formulation shifts and ingredient updates between packaging batches.",
        },
        "allergens_summary": {
            "added": added_allergens,
            "removed": removed_allergens,
            "risk_level": risk_level,
            "risk_explanation": risk_exp,
        },
        "nutritional_summary": {
            "significant_changes": nut_changes if nut_changes else ["Nutritional table format varied across packaging revisions."],
            "health_direction": "NEUTRAL",
        },
        "marketing_claims_summary": {
            "added_claims": added_claims,
            "dropped_claims": dropped_claims,
        },
    }


def analyze_semantic_diff_single_prompt(
    revisions_data: list[dict[str, Any]]
) -> dict[str, Any]:
    """
    Executes a SINGLE structured prompt against Gemini LLM to compare
    ingredients, allergens, nutritional tables, and claims across all revisions.
    Falls back gracefully to local heuristic diff if API is unavailable.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return _local_heuristic_diff(revisions_data)

    # Format revisions text block
    rev_blocks = []
    for i, rev in enumerate(revisions_data, start=1):
        date_str = rev.get("mfg_date") or "Unknown Date"
        full_text = rev.get("full_text", "").strip()
        user_ns = rev.get("non_statutory") or {}
        confirmed_lines = []
        if user_ns.get("ingredients_text"):
            confirmed_lines.append(f"Confirmed Ingredients: {user_ns['ingredients_text']}")
        if user_ns.get("allergens"):
            confirmed_lines.append(f"Confirmed Allergens: {', '.join(user_ns['allergens'])}")
        if user_ns.get("nutrition_table"):
            nut_str = ", ".join(f"{k}: {v}" for k, v in user_ns["nutrition_table"].items())
            confirmed_lines.append(f"Confirmed Nutrition: {nut_str}")
        if user_ns.get("marketing_claims"):
            confirmed_lines.append(f"Confirmed Claims: {', '.join(user_ns['marketing_claims'])}")

        conf_prefix = ("\n".join(confirmed_lines) + "\n") if confirmed_lines else ""
        rev_blocks.append(f"--- REVISION {i} (Mfg/Packing Date: {date_str}, ID: {rev.get('package_id')}) ---\n{conf_prefix}OCR Text:\n{full_text}\n")

    prompt = DIFF_PROMPT_TEMPLATE.format(
        num_revisions=len(revisions_data),
        revisions_text="\n".join(rev_blocks)
    )

    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=api_key)

        response = None
        for model_id in ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"]:
            try:
                response = client.models.generate_content(
                    model=model_id,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        temperature=0.0,
                    ),
                )
                if response and response.text:
                    break
            except Exception as e:
                continue

        if response and response.text:
            text = response.text.strip()
            if text.startswith("```"):
                text = re.sub(r"^```(?:json)?\s*", "", text)
                text = re.sub(r"\s*```$", "", text)
            data = json.loads(text)

            # Ensure revisions_extracted is populated; if missing or empty, merge local
            if "revisions_extracted" not in data or not data["revisions_extracted"]:
                local_fallback = _local_heuristic_diff(revisions_data)
                data["revisions_extracted"] = local_fallback["revisions_extracted"]
            else:
                # Guarantee each item has package_id and respects user-confirmed non-statutory data
                for idx, item in enumerate(data["revisions_extracted"]):
                    if idx < len(revisions_data):
                        r = revisions_data[idx]
                        item["package_id"] = r.get("package_id")
                        user_ns = r.get("non_statutory") or {}
                        if user_ns.get("ingredients_text"):
                            item["ingredients_text"] = user_ns["ingredients_text"]
                        if user_ns.get("ingredients_list"):
                            item["ingredients_list"] = user_ns["ingredients_list"]
                        if user_ns.get("allergens"):
                            item["allergens"] = user_ns["allergens"]
                        if user_ns.get("nutrition_table"):
                            item["nutrition_table"] = user_ns["nutrition_table"]
                        if user_ns.get("marketing_claims"):
                            item["marketing_claims"] = user_ns["marketing_claims"]

            return data
    except Exception as e:
        print(f"[WARN] LLM single-prompt semantic diff failed ({e}). Using local heuristic diff fallback.")

    return _local_heuristic_diff(revisions_data)


def extract_non_statutory_with_llm(full_text: str) -> dict[str, Any]:
    """
    Extracts complete ingredients clause, individual ingredients (with expanded additives),
    allergens, nutrition facts, marketing claims, and explicit net_quantity using Gemini LLM.
    Falls back gracefully to local heuristic extraction if LLM is unreachable.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key or not full_text or len(full_text.strip()) < 15:
        return extract_non_statutory_from_text(full_text)

    prompt = f"""You are an expert food packaging perception model.
Analyze the following OCR text extracted from an Indian packaged food label:

--- OCR TEXT ---
{full_text}
--- END OCR TEXT ---

Extract these declarations into valid JSON:
1. "net_quantity": The concise, exact net product weight/volume statement ONLY (e.g. "Net Quantity: 200 g", "Net Qty: 250 g", "500 ml"). CRITICAL: Strip any preceding headers or text (do NOT include words like "NUTRITIONAL FACTS" or "Information" before the net quantity).
2. "common_name": The exact product/commodity title (e.g. "WHOLE WHEAT & OAT DIGESTIVE BISCUITS", "DIGESTIVE BISCUITS", "GOLD CRUNCH DIGESTIVE COOKIES"). Never return nutritional table text as common name.
3. "manufacturer_name_address": The clean manufacturer name and postal address (e.g. "NutriBite Foods Pvt. Ltd., Plot 12, Phase II, Hinjewadi, Pune 411057, India"). CRITICAL: Strip any stray weight numbers like "16 g", "18 g", "21 g" or nutritional table values that might appear near the address.
4. "ingredients_text": Complete verbatim ingredients clause text.
5. "ingredients_list": Array of individual parsed ingredients. Expand compound additives (e.g. "Raising Agents (INS 500(i), INS 503(ii))" -> ["Raising Agent (INS 500(i))", "Raising Agent (INS 503(ii))"]). Preserve percentages if present.
6. "allergens": Array of all declared allergens (e.g. ["Wheat", "Oats", "Tree Nuts (Almonds)", "Milk"]).
7. "nutrition_table": Dictionary of nutrients per 100g (e.g. {{"Energy": "480 kcal", "Protein": "7.5 g", "Carbohydrate": "68 g", "Total Sugars": "20 g", "Total Fat": "18 g", "Sodium": "320 mg"}}).
8. "marketing_claims": Array of all promotional slogans or claims (e.g. ["100% Vegetarian", "Rich in Fibre", "No Added Preservatives", "Crunchy Nutty Bite"]).

Return ONLY valid JSON matching this schema:
{{
  "net_quantity": "",
  "common_name": "",
  "manufacturer_name_address": "",
  "ingredients_text": "",
  "ingredients_list": [],
  "allergens": [],
  "nutrition_table": {{}},
  "marketing_claims": []
}}
"""
    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=api_key)

        local_data = extract_non_statutory_from_text(full_text)
        for model_id in ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-2.5-flash"]:
            try:
                response = client.models.generate_content(
                    model=model_id,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        temperature=0.0
                    )
                )
                if response and response.text:
                    parsed = json.loads(response.text)
                    if parsed:
                        # Hybrid enrichment: ensure local extractions backfill any missed fields
                        if not parsed.get("ingredients_text") and local_data.get("ingredients_text"):
                            parsed["ingredients_text"] = local_data["ingredients_text"]
                        if not parsed.get("ingredients_list") and local_data.get("ingredients_list"):
                            parsed["ingredients_list"] = local_data["ingredients_list"]
                        if not parsed.get("nutrition_table") and local_data.get("nutrition_table"):
                            parsed["nutrition_table"] = local_data["nutrition_table"]
                        if not parsed.get("allergens") and local_data.get("allergens"):
                            parsed["allergens"] = local_data["allergens"]

                        existing_claims = set(c.lower() for c in (parsed.get("marketing_claims") or []))
                        for lc in local_data.get("marketing_claims", []):
                            if lc.lower() not in existing_claims:
                                parsed.setdefault("marketing_claims", []).append(lc)

                        return parsed
            except Exception:
                continue
    except Exception as e:
        print(f"[WARN] extract_non_statutory_with_llm failed ({e}). Using regex parser fallback.")

    return extract_non_statutory_from_text(full_text)
