"""
Field Classification module for CompliLens.
Maps OCR tokens and spatial regions into the 6 mandatory LMPC declaration fields.

Key Enhancements for Real Packaging:
1. Multi-line MRP Adjacency: Automatically detects and merges 'inclusive of all taxes'
   printed below or beside the MRP price line.
2. Column-Aware Spatial Clustering: Prevents text from column 1 bleeding into column 2.
3. Ingredients & Nutrition Filter: Strictly prevents ingredients list text from being
   misidentified as the product common name.
"""
from __future__ import annotations
import re
from typing import Literal
import numpy as np

try:
    from models.schemas import ExtractedField, FieldName
except (ImportError, ValueError):
    from ..models.schemas import ExtractedField, FieldName

from .ocr import OcrToken


# Targeted regex patterns
NET_QTY_REGEX = re.compile(
    r"(?:net\s*(?:qty|quantity|weight|wt|volume|vol)?[\s:.]*)?([0-9]+(?:\.[0-9]+)?)\s*(kg|g|gm|gms|grams|ml|l|ltr|litres|liters|n|u|units?)\b",
    re.IGNORECASE,
)

MRP_PRICE_ONLY_REGEX = re.compile(
    r"(?:m\.?r\.?p\.?|max(?:imum)?\.?\s*retail\s*price|retail\s*price|price|rate|mrp|cost)\b[\s:.]*(?:rs\.?|₹|inr)?[\s:.]*([0-9]+(?:\.[0-9]{1,2})?)|(?:rs\.?|₹|inr)[\s:.]*([0-9]+(?:\.[0-9]{1,2})?)",
    re.IGNORECASE,
)

TAX_MENTION_REGEX = re.compile(
    r"(?:incl(?:usive)?\.?\s*of\s*all\s*taxes|incl\.?\s*taxes|\(incl\b|\btaxes\b)",
    re.IGNORECASE,
)

MFG_DATE_REGEX = re.compile(
    r"(?:(?:date|month(?:\s*(?:and|&)\s*year)?)\s*of\s*(?:packing|packaging|pkg|pkd|manufacture|mfg)|mfg(?:\s*date)?|pkd(?:\s*date)?|mfd|packed(?:\s*on)?|manufactured(?:\s*on)?|pkg(?:\s*date)?|date)[\s:.]*"
    r"([0-1]?[0-9][/\-.][0-9]{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,.\-]+[0-9]{2,4})",
    re.IGNORECASE,
)

PHONE_REGEX = re.compile(
    r"(?:(?:tel|phone|ph|call|toll\s*free|care|helpline|support|cell)[\s:.]*)?([0-9]{3,5}[-\s][0-9]{6,8}|1800[-\s]?[0-9]{3}[-\s]?[0-9]{3,4}|\+?91[-\s]?[6-9][0-9]{9})\b",
    re.IGNORECASE,
)
EMAIL_REGEX = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+")

ADDRESS_KEYWORDS = [
    "manufactured by", "mfg by", "mfd by", "packed by", "pkd by", "marketed by",
    "imported by", "factory:", "unit:", "plot no", "industrial area", "pvt ltd",
    "limited", "ltd.", "road", "street", "dist.", "state", "pin:", "pin code"
]

COMMON_NAME_KEYWORDS = [
    "biscuit", "biscuits", "digestive", "digestives", "cookies", "cookie",
    "chips", "namkeen", "snack", "snacks", "cracker", "crackers", "rusk", "rusks",
    "wafer", "wafers", "bread", "cake", "cakes", "bun", "atta", "flour", "wheat",
    "whole wheat", "oats", "oat", "rice", "dal", "pulses", "oil", "ghee", "butter",
    "milk", "tea", "coffee", "salt", "sugar", "sauce", "ketchup", "noodles",
    "pasta", "juice", "drink", "water", "beverage", "chocolate", "chana", "bhujia",
    "mixture", "spices", "masala"
]

NUTRITION_KEYWORDS = [
    "nutrition", "nutritional", "nutritionalinformation", "nutritionfacts",
    "approximate values", "approximate", "per 100g", "per 100 g", "per serve",
    "serving size", "servings", "energy", "protein", "carbohydrate", "carbohydrates",
    "total sugars", "sugars", "sugar", "total fat", "fat", "fats", "sodium",
    "cholesterol", "saturated fat", "trans fat", "dietary fiber", "kcal", "calories"
]

DISQUALIFIED_NAME_WORDS = [
    "nutrition", "nutritional", "nutritionalinformation", "nutritionfacts",
    "approximate", "approximate values", "per 100", "per serve", "energy",
    "protein", "carbohydrate", "carbohydrates", "total sugars", "total fat",
    "sodium", "cholesterol", "saturated fat", "trans fat", "dietary fiber",
    "manufactured", "marketed", "consumer care", "customer care", "helpline",
    "mrp", "net qty", "net quantity", "batch no", "mfg date", "expiry",
    "best before", "ingredients", "contains:", "allergen"
]

CONSUMER_CARE_KEYWORDS = [
    "consumer care", "customer care", "customer support", "consumer support",
    "support:", "customer service", "consumer service", "helpline", "toll free",
    "toll-free", "feedback", "complaints", "queries", "query", "contact us",
    "reach us", "write to us", "care cell", "care executive", "call us", "support"
]

INGREDIENTS_KEYWORDS = [
    "ingredients", "ingredient:", "ingredients:", "contains:", "ingrédients",
    "allergens", "allergen:", "nutritional information", "nutrition facts",
    "per 100g", "per serve", "energy (kcal)", "carbohydrates", "dietary fiber"
]

ADDRESS_STOP_KEYWORDS = [
    "consumer care", "customer care", "customer support", "consumer support",
    "support:", "helpline", "mrp", "price:", "net qty", "net weight",
    "net quantity", "batch", "mfg date", "manufacturing date", "date of packing", "pkd date", "best before",
    "expiry", "ingredients", "nutritional", "nutrition", "store in", "keep in", "keep away", "scan for",
    "good food", "clean city", "city clean", "fssai", "lic no", "lic. no", "recycle",
    "green dot", "vegetarian", "non-vegetarian", "barcode"
]


def merge_bounding_boxes(boxes: list[tuple[int, int, int, int]]) -> tuple[int, int, int, int]:
    """Computes the union enclosing bounding box for a list of (x, y, w, h) boxes."""
    if not boxes:
        return (0, 0, 100, 50)
    x1 = min(b[0] for b in boxes)
    y1 = min(b[1] for b in boxes)
    x2 = max(b[0] + b[2] for b in boxes)
    y2 = max(b[1] + b[3] for b in boxes)
    return (x1, y1, max(1, x2 - x1), max(1, y2 - y1))


def clean_net_quantity_declaration(text: str) -> str:
    """
    Strips preceding filler words (e.g. nutrition headers, batch info)
    and extracts strictly the net quantity declaration statement.
    Example: 'NUTRITIONAL INFORMATION Net Quantity: 250 g' -> 'Net Quantity: 250 g'
    """
    if not text:
        return text
    # 1. Look for explicit Net / Qty prefix followed by number and unit
    m_full = re.search(
        r"((?:net\s*(?:qty|quantity|weight|wt|volume|vol)?|qty|quantity|weight|wt)\s*[:.\-]?\s*[0-9]+(?:\.[0-9]+)?\s*(?:kg|g|gm|gms|grams|ml|l|ltr|litres|liters|n|u|units?)\b)",
        text,
        re.IGNORECASE,
    )
    if m_full:
        return m_full.group(1).strip()

    # 2. Look for number and unit if no prefix
    m_num = NET_QTY_REGEX.search(text)
    if m_num:
        idx_match = m_num.start()
        prefix_part = text[:idx_match]
        m_prefix = re.search(r"\b(net\s*(?:qty|quantity|weight|wt|volume|vol)?|qty|quantity|weight|wt)\s*[:.\-]?\s*$", prefix_part, re.IGNORECASE)
        if m_prefix:
            start_pos = prefix_part.rfind(m_prefix.group(1))
            return text[start_pos:m_num.end()].strip()
        return m_num.group(0).strip()

    return text.strip()


def clean_manufacturer_address(text: str) -> str:
    """
    Cleans unwanted isolated weights (e.g. 16 g, 18 g, 21 g), nutritional bleed,
    and duplicate prefixes from the manufacturer address declaration.
    """
    if not text:
        return text
    # Remove isolated weight tokens like ", 16 g", ", 18 g", "21 g,", "16g"
    cleaned = re.sub(r"(?:^|,\s*|\b)[0-9]+(?:\.[0-9]+)?\s*(?:g|gm|gms|kg|mg|ml|kcal)\b\s*,?", " ", text, flags=re.IGNORECASE)
    # Remove broken duplicate standalone prefixes like ", ed by:," or ", ed by:"
    cleaned = re.sub(r"(?:,\s*|\s+)ed\s*by\s*[:.\-]?\s*,?", " ", cleaned, flags=re.IGNORECASE)
    # Normalize manufacturer prefix colon followed by comma e.g. "Manufactured by:," -> "Manufactured by:"
    cleaned = re.sub(r"\b(Manufactured\s*by|Mfg\s*by|Mfd\s*by|Packed\s*by|Pkd\s*by)\s*[:.\-]?\s*,", r"\1: ", cleaned, flags=re.IGNORECASE)
    # Deduplicate consecutive commas or whitespace
    cleaned = re.sub(r",\s*,+", ", ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    
    # Remove duplicate company names/phrases separated by comma
    parts = [p.strip() for p in cleaned.split(',')]
    seen = set()
    deduped = []
    for p in parts:
        p_lower = p.lower()
        if p_lower not in seen and len(p) > 2:
            seen.add(p_lower)
            deduped.append(p)
        elif len(p) <= 2:
            deduped.append(p)
    cleaned = ", ".join(deduped)

    cleaned = cleaned.strip(" ,.-")
    return cleaned


def cluster_tokens_by_columns(tokens: list[OcrToken]) -> list[list[OcrToken]]:
    """
    Separates tokens into distinct vertical columns to prevent text from
    column 1 bleeding into column 2.
    """
    if len(tokens) <= 2:
        return [tokens]

    # Priority 1: Use explicit column_index if populated by Gemini Vision
    distinct_cols = set(t.column_index for t in tokens if t.column_index is not None)
    if len(distinct_cols) > 1:
        col_groups: dict[int, list[OcrToken]] = {}
        for t in tokens:
            col_groups.setdefault(t.column_index, []).append(t)
        result = []
        for c_idx in sorted(col_groups.keys()):
            # Sort top to bottom
            col_tokens = sorted(col_groups[c_idx], key=lambda x: (x.bbox[1], x.bbox[0]))
            result.append(col_tokens)
        return result

    # Priority 2: Gutter/whitespace gap detection
    # Find natural vertical gap between columns rather than hardcoding 50%
    xs = [t.bbox[0] for t in tokens]
    min_x = min(xs)
    max_x = max(t.bbox[0] + t.bbox[2] for t in tokens)
    total_w = max_x - min_x
    if total_w < 200:
        return [sorted(tokens, key=lambda t: (t.bbox[1], t.bbox[0]))]

    # Search for a gap between 25% and 75% of total width
    token_spans = [(t.bbox[0], t.bbox[0] + t.bbox[2]) for t in tokens]
    candidate_dividers = []
    step = 20
    for split_x in range(int(min_x + total_w * 0.25), int(min_x + total_w * 0.75), step):
        # Count tokens intersecting split_x
        intersects = sum(1 for (x1, x2) in token_spans if x1 <= split_x <= x2)
        candidate_dividers.append((intersects, split_x))

    if candidate_dividers:
        # Choose divider with minimal intersections (best whitespace gutter)
        candidate_dividers.sort(key=lambda item: (item[0], abs(item[1] - (min_x + total_w * 0.5))))
        best_intersects, best_split = candidate_dividers[0]

        if best_intersects <= len(tokens) * 0.25:  # Valid column separation
            col_left = [t for t in tokens if (t.bbox[0] + t.bbox[2] / 2.0) < best_split]
            col_right = [t for t in tokens if (t.bbox[0] + t.bbox[2] / 2.0) >= best_split]
            if len(col_left) >= 2 and len(col_right) >= 2:
                col_left.sort(key=lambda t: (t.bbox[1], t.bbox[0]))
                col_right.sort(key=lambda t: (t.bbox[1], t.bbox[0]))
                return [col_left, col_right]

    # Single column: sort top-to-bottom
    sorted_tokens = sorted(tokens, key=lambda t: (t.bbox[1], t.bbox[0]))
    return [sorted_tokens]


def find_spatially_adjacent_tokens(
    target_token: OcrToken,
    all_tokens: list[OcrToken],
    max_vertical_gap: float = 40.0,
    max_horizontal_gap: float = 50.0,
) -> list[OcrToken]:
    """
    Finds tokens located directly below or directly beside target_token.
    Used for connecting multi-line MRP ("MRP Rs. 40" -> line below: "(Incl. of all taxes)").
    """
    tx, ty, tw, th = target_token.bbox
    target_bottom = ty + th
    target_right = tx + tw

    adjacent = []
    for t in all_tokens:
        if t == target_token:
            continue
        sx, sy, sw, sh = t.bbox

        # 1. Directly below: y is within max_vertical_gap, and x overlaps target x-range
        # Allow slight vertical overlap (-15px) due to OCR bounding-box line ascender/descender margins
        is_below = (-15.0 <= (sy - target_bottom) <= max_vertical_gap and sy > ty + 10) and (
            max(tx, sx) < min(target_right, sx + sw) or abs(tx - sx) < 70
        )

        # 2. Directly beside to the right on the same line
        is_beside = (abs(ty - sy) <= (th * 0.7)) and (0 <= (sx - target_right) <= max_horizontal_gap)

        if is_below or is_beside:
            adjacent.append(t)

    return adjacent


def is_ingredients_token(token: OcrToken) -> bool:
    """Checks if a token belongs to an ingredients, allergen, or nutrition list."""
    if token.field_type in ["ingredients", "nutrition"]:
        return True
    t_lower = token.text.lower()
    if any(kw in t_lower for kw in INGREDIENTS_KEYWORDS):
        return True
    if any(kw in t_lower for kw in NUTRITION_KEYWORDS):
        return True
    if re.search(r"\b(?:nutrition(?:al)?|calories|kcal|carbs?|protein|sodium|cholesterol)\b", t_lower):
        return True
    if re.search(r"\b[0-9]{1,2}%\b", token.text) or re.search(r"\bINS\s*[0-9]{3}\b", token.text, re.IGNORECASE):
        return True
    if re.search(r"^[0-9]+(?:\.[0-9]+)?\s*(?:kcal|cal|kj|mg|mcg)\b", t_lower):
        return True
    return False


def order_tokens_by_layout(tokens: list[OcrToken]) -> list[OcrToken]:
    """
    Orders OCR tokens according to logical packaging layout:
    - Left packaging panel: Brand header first, bottom promotional claims grouped by column badges.
    - Right packaging panel:
        1. Top declarations zone (MRP, Net Quantity).
        2. Middle tables zone (detects column gutter between Ingredients and Nutrition).
        3. Bottom declarations zone (Manufacturer name/address, Mfg date, Consumer care, Barcode).
    """
    if not tokens:
        return []

    xs = [t.bbox[0] for t in tokens]
    min_x, max_x = min(xs), max(t.bbox[0] + t.bbox[2] for t in tokens)
    mid_x = min_x + (max_x - min_x) * 0.55

    left_tokens = [t for t in tokens if (t.bbox[0] + t.bbox[2] / 2.0) < mid_x]
    right_tokens = [t for t in tokens if (t.bbox[0] + t.bbox[2] / 2.0) >= mid_x]

    ordered: list[OcrToken] = []

    # 1. Left packaging panel (Front): Brand & bottom claim badges
    if left_tokens:
        ys = [t.bbox[1] for t in left_tokens]
        min_y, max_y = min(ys), max(t.bbox[1] + t.bbox[3] for t in left_tokens)
        claims_y = min_y + (max_y - min_y) * 0.65
        main_front = [t for t in left_tokens if t.bbox[1] < claims_y]
        claim_tokens = [t for t in left_tokens if t.bbox[1] >= claims_y]

        ordered.extend(sorted(main_front, key=lambda t: (t.bbox[1], t.bbox[0])))

        # Group bottom claim badges by column (e.g. Rich in Fibre, Made with Whole Grains)
        sorted_claims = sorted(claim_tokens, key=lambda t: t.bbox[0])
        claim_cols: list[list[OcrToken]] = []
        for t in sorted_claims:
            if not claim_cols or abs(t.bbox[0] - claim_cols[-1][-1].bbox[0]) > 40:
                claim_cols.append([t])
            else:
                claim_cols[-1].append(t)
        for col in claim_cols:
            col.sort(key=lambda t: t.bbox[1])
            ordered.extend(col)

    # 2. Right packaging panel: Adaptive column splitting
    if right_tokens:
        # Check for vertical gutter for the entire right panel
        r_xs = [(t.bbox[0], t.bbox[0] + t.bbox[2]) for t in right_tokens]
        r_min_x, r_max_x = min(x[0] for x in r_xs), max(x[1] for x in r_xs)
        r_w = r_max_x - r_min_x

        best_gutter = None
        min_cuts = 999
        if r_w > 150:
            for gx in range(int(r_min_x + r_w * 0.35), int(r_min_x + r_w * 0.65), 10):
                cuts = sum(1 for (x1, x2) in r_xs if x1 <= gx <= x2)
                if cuts < min_cuts:
                    min_cuts = cuts
                    best_gutter = gx

        if best_gutter and min_cuts <= 2:
            r_left = [t for t in right_tokens if (t.bbox[0] + t.bbox[2] / 2.0) < best_gutter]
            r_right = [t for t in right_tokens if (t.bbox[0] + t.bbox[2] / 2.0) >= best_gutter]
            ordered.extend(sorted(r_left, key=lambda t: (t.bbox[1], t.bbox[0])))
            ordered.extend(sorted(r_right, key=lambda t: (t.bbox[1], t.bbox[0])))
        else:
            ordered.extend(sorted(right_tokens, key=lambda t: (t.bbox[1], t.bbox[0])))

    return ordered if ordered else sorted(tokens, key=lambda t: (t.bbox[1], t.bbox[0]))


def classify_tokens_to_fields(
    tokens: list[OcrToken],
    image_shape: tuple[int, int] | None = None,
) -> dict[str, ExtractedField]:
    """
    Classifies raw OCR tokens into the 6 canonical LMPC declaration fields.
    Returns a dict mapping field_name to ExtractedField.
    """
    if not tokens:
        return {}

    ocr_source = tokens[0].ocr_source if tokens else "local"
    classified_fields: dict[str, ExtractedField] = {}

    # Separate tokens by columns to prevent cross-column bleed
    columns = cluster_tokens_by_columns(tokens)
    ordered_tokens = [t for col in columns for t in col]

    # Blacklist tokens that strictly belong to ingredients/nutrition sections
    ingredient_token_set: set[tuple[str, tuple[int, int, int, int]]] = set()
    for col in columns:
        in_ingredients_mode = False
        for t in col:
            t_lower = t.text.lower()
            # Net quantity, MRP, MFG, Address, Consumer care are NEVER ingredients
            if any(k in t_lower for k in ["net", "qty", "weight", "mrp", "mfg", "pkd", "care@"]):
                in_ingredients_mode = False
                continue
            if any(kw in t_lower for kw in INGREDIENTS_KEYWORDS) or t.field_type in ["ingredients", "nutrition"]:
                in_ingredients_mode = True
            elif in_ingredients_mode:
                # If short, new declaration heading encountered, exit ingredients block
                if any(kw in t_lower for kw in ADDRESS_KEYWORDS + CONSUMER_CARE_KEYWORDS) or "mrp" in t_lower:
                    in_ingredients_mode = False
            if in_ingredients_mode:
                ingredient_token_set.add((t.text, t.bbox))

    # =========================================================================
    # 1. MRP Extraction (with multi-line 'inclusive of all taxes' merging)
    # =========================================================================
    # Check 1: Explicit field_type from Gemini Vision
    gemini_mrp = [t for t in ordered_tokens if t.field_type == "mrp"]
    if gemini_mrp:
        mrp_text = " ".join(t.text for t in gemini_mrp).strip()
        classified_fields["mrp"] = ExtractedField(
            field_name="mrp",
            raw_value=mrp_text,
            confidence=float(np.mean([t.confidence for t in gemini_mrp])),
            bounding_box=merge_bounding_boxes([t.bbox for t in gemini_mrp]),
            ocr_source=ocr_source,
        )
    else:
        mrp_candidate_token = None
        adj_price_token = None
        for token in ordered_tokens:
            if MRP_PRICE_ONLY_REGEX.search(token.text):
                mrp_candidate_token = token
                break

        # Fallback: Look for "MRP" label token and link adjacent price number (even if ? or split)
        if not mrp_candidate_token:
            for token in ordered_tokens:
                if re.search(r"\b(?:m\.?r\.?p\.?|max(?:imum)?\.?\s*retail\s*price|retail\s*price|price)\b", token.text, re.IGNORECASE):
                    tx, ty, tw, th = token.bbox
                    for t in ordered_tokens:
                        if t == token:
                            continue
                        sx, sy, sw, sh = t.bbox
                        is_same_line = abs(ty - sy) <= max(th, sh) * 0.9 and (0 <= sx - (tx + tw) <= 250 or abs(sx - (tx + tw)) <= 250)
                        is_line_below = 0 <= sy - (ty + th) <= 80 and abs(sx - tx) <= 200
                        if is_same_line or is_line_below:
                            if re.search(r"(?:rs\.?|₹|inr|[?₹Fz/]|\?)?\s*[0-9]+(?:\.[0-9]{1,2})?", t.text, re.IGNORECASE):
                                mrp_candidate_token = token
                                norm_text = t.text
                                norm_text = re.sub(r"^(?:\?|\?)", "₹", norm_text)
                                t.text = norm_text
                                adj_price_token = t
                                break
                    if mrp_candidate_token:
                        break

        if mrp_candidate_token:
            has_taxes = TAX_MENTION_REGEX.search(mrp_candidate_token.text) is not None
            merged_tokens = [mrp_candidate_token]
            if adj_price_token and adj_price_token not in merged_tokens:
                merged_tokens.append(adj_price_token)
                if TAX_MENTION_REGEX.search(adj_price_token.text):
                    has_taxes = True

            if not has_taxes:
                adj_tokens = find_spatially_adjacent_tokens(mrp_candidate_token, ordered_tokens, max_vertical_gap=55.0)
                for adj in adj_tokens:
                    if TAX_MENTION_REGEX.search(adj.text) or "taxes" in adj.text.lower():
                        merged_tokens.append(adj)
                        break

            merged_tokens.sort(key=lambda t: (t.bbox[1], t.bbox[0]))
            mrp_text = " ".join(t.text for t in merged_tokens).strip()
            # If mrp_text still has raw '?' right before number like '?60', normalize to '₹60'
            mrp_text = re.sub(r"(?:\?|\\u20b9|\?)\s*([0-9]+)", r"₹\1", mrp_text)
            # Reorder if price ended up preceding MRP label (e.g. "₹60 MRP: (Inclusive..." -> "MRP: ₹60 (Inclusive...")
            mrp_text = re.sub(r"(₹\s*[0-9]+(?:\.[0-9]+)?)\s*(m\.?r\.?p\.?:?)", r"\2 \1", mrp_text, flags=re.IGNORECASE)
            mrp_bbox = merge_bounding_boxes([t.bbox for t in merged_tokens])
            mrp_conf = float(np.mean([t.confidence for t in merged_tokens]))

            classified_fields["mrp"] = ExtractedField(
                field_name="mrp",
                raw_value=mrp_text,
                confidence=mrp_conf,
                bounding_box=mrp_bbox,
                ocr_source=ocr_source,
            )

    # =========================================================================
    # 2. Net Quantity Extraction
    # =========================================================================
    # Check 1: Explicit field_type from Gemini Vision
    gemini_qty = [t for t in ordered_tokens if t.field_type == "net_quantity"]
    if gemini_qty:
        qty_text = " ".join(t.text for t in gemini_qty).strip()
        classified_fields["net_quantity"] = ExtractedField(
            field_name="net_quantity",
            raw_value=qty_text,
            confidence=float(np.mean([t.confidence for t in gemini_qty])),
            bounding_box=merge_bounding_boxes([t.bbox for t in gemini_qty]),
            ocr_source=ocr_source,
        )

    # Check 2: Explicit Net Qty tokens (containing "net", "wt", "weight", "qty")
    if "net_quantity" not in classified_fields:
        for token in ordered_tokens:
            t_lower = token.text.lower()
            if any(k in t_lower for k in ["net", "weight", "wt.", "wt", "qty", "quantity"]):
                # Look for number and unit in this token or neighbor tokens on the same horizontal line
                line_tokens = [
                    t for t in ordered_tokens
                    if abs(t.bbox[1] - token.bbox[1]) < 25 and not any(n in t.text.lower() for n in ["protein", "fat", "sugar", "sodium", "carb", "per 100", "serve"])
                ]
                line_tokens.sort(key=lambda t: t.bbox[0])
                line_text = " ".join(t.text for t in line_tokens).strip()

                match = NET_QTY_REGEX.search(line_text)
                if match:
                    qty_bbox = merge_bounding_boxes([t.bbox for t in line_tokens])
                    clean_val = clean_net_quantity_declaration(line_text)
                    classified_fields["net_quantity"] = ExtractedField(
                        field_name="net_quantity",
                        raw_value=clean_val,
                        confidence=float(np.mean([t.confidence for t in line_tokens])),
                        bounding_box=qty_bbox,
                        ocr_source=ocr_source,
                    )
                    break

    # Check 3: Strictly guarded fallback (requiring explicit net/qty/weight presence on line)
    if "net_quantity" not in classified_fields:
        for token in ordered_tokens:
            if (token.text, token.bbox) in ingredient_token_set:
                continue
            t_lower = token.text.lower()
            if any(n in t_lower for n in ["per 100", "serve", "serving", "protein", "energy", "sugar", "fat", "sodium", "carb", "daily", "total", "added", "saturated"]):
                continue

            # Check if this token or an adjacent token on the line explicitly has net/qty indicator
            line_tokens = [
                other for other in ordered_tokens
                if abs(other.bbox[1] - token.bbox[1]) < 25
                and not any(n in other.text.lower() for n in ["protein", "energy", "sugar", "fat", "sodium", "carb", "daily", "per 100"])
            ]
            line_tokens.sort(key=lambda t: t.bbox[0])
            line_text = " ".join(t.text for t in line_tokens).strip()
            line_lower = line_text.lower()

            if any(k in line_lower for k in ["net", "qty", "quantity", "weight", "wt"]) and NET_QTY_REGEX.search(line_text):
                qty_bbox = merge_bounding_boxes([t.bbox for t in line_tokens])
                clean_val = clean_net_quantity_declaration(line_text)
                classified_fields["net_quantity"] = ExtractedField(
                    field_name="net_quantity",
                    raw_value=clean_val,
                    confidence=float(np.mean([t.confidence for t in line_tokens])),
                    bounding_box=qty_bbox,
                    ocr_source=ocr_source,
                )
                break

    # =========================================================================
    # 3. Manufacturing / Packaging Date Extraction
    # =========================================================================
    gemini_mfg = [t for t in ordered_tokens if t.field_type == "mfg_date"]
    if gemini_mfg:
        mfg_text = " ".join(t.text for t in gemini_mfg).strip()
        classified_fields["mfg_month_year"] = ExtractedField(
            field_name="mfg_month_year",
            raw_value=mfg_text,
            confidence=float(np.mean([t.confidence for t in gemini_mfg])),
            bounding_box=merge_bounding_boxes([t.bbox for t in gemini_mfg]),
            ocr_source=ocr_source,
        )
    else:
        for token in ordered_tokens:
            match = MFG_DATE_REGEX.search(token.text)
            if match:
                classified_fields["mfg_month_year"] = ExtractedField(
                    field_name="mfg_month_year",
                    raw_value=token.text.strip(),
                    confidence=token.confidence,
                    bounding_box=token.bbox,
                    ocr_source=ocr_source,
                )
                break

    # =========================================================================
    # 4. Consumer Care Extraction
    # =========================================================================
    gemini_care = [t for t in ordered_tokens if t.field_type == "consumer_care"]
    if gemini_care:
        care_text = " ".join(t.text for t in gemini_care).strip()
        classified_fields["consumer_care"] = ExtractedField(
            field_name="consumer_care",
            raw_value=care_text,
            confidence=float(np.mean([t.confidence for t in gemini_care])),
            bounding_box=merge_bounding_boxes([t.bbox for t in gemini_care]),
            ocr_source=ocr_source,
        )
    else:
        care_tokens = []
        for token in ordered_tokens:
            t_lower = token.text.lower()
            if any(kw in t_lower for kw in CONSUMER_CARE_KEYWORDS):
                if token not in care_tokens:
                    care_tokens.append(token)
                # Check spatially adjacent line below or beside for phone number / email
                for adj in find_spatially_adjacent_tokens(token, ordered_tokens, max_vertical_gap=45.0):
                    if PHONE_REGEX.search(adj.text) or EMAIL_REGEX.search(adj.text):
                        if adj not in care_tokens:
                            care_tokens.append(adj)
                            break
            elif EMAIL_REGEX.search(token.text) and token not in care_tokens:
                care_tokens.append(token)
            elif PHONE_REGEX.search(token.text) and token not in care_tokens:
                # Disregard EAN-13 barcodes without phone keyword context
                if not re.search(r"\b(?:890|906)[0-9]{9,10}\b", token.text):
                    care_tokens.append(token)

        if care_tokens:
            care_tokens.sort(key=lambda t: (t.bbox[1], t.bbox[0]))
            care_text = " ".join(t.text for t in care_tokens).strip()
            classified_fields["consumer_care"] = ExtractedField(
                field_name="consumer_care",
                raw_value=care_text,
                confidence=float(np.mean([t.confidence for t in care_tokens])),
                bounding_box=merge_bounding_boxes([t.bbox for t in care_tokens]),
                ocr_source=ocr_source,
            )

    # =========================================================================
    # 5. Manufacturer Name & Address (Column-bounded, No Slogan Bleed)
    # =========================================================================
    gemini_addr = [t for t in ordered_tokens if t.field_type == "manufacturer"]
    if gemini_addr:
        addr_text = " ".join(t.text for t in gemini_addr).strip()
        classified_fields["manufacturer_name_address"] = ExtractedField(
            field_name="manufacturer_name_address",
            raw_value=addr_text,
            confidence=float(np.mean([t.confidence for t in gemini_addr])),
            bounding_box=merge_bounding_boxes([t.bbox for t in gemini_addr]),
            ocr_source=ocr_source,
        )
    else:
        addr_tokens = []
        in_address_block = False
        hit_pincode = False
        pincode_regex = re.compile(r"(?:^|[^0-9])([1-9][0-9]{5})(?:[^0-9]|$)")
        for col in columns:
            in_address_block = False
            hit_pincode = False
            for token in col:
                t_lower = token.text.lower()
                # If we encounter stop keywords, stop collecting
                if any(kw in t_lower for kw in ADDRESS_STOP_KEYWORDS):
                    in_address_block = False
                    continue

                # Ignore barcode tokens (e.g. 12-13 digits like 8906123456789) without interrupting address block
                if re.search(r"\b(?:890|906)[0-9]{9,10}\b", token.text) or re.search(r"^[0-9]{12,14}$", token.text):
                    continue

                # Disqualify isolated weights or nutrient measurements
                if re.search(r"^\s*[0-9]+(?:\.[0-9]+)?\s*(?:g|gm|gms|kg|mg|ml|l|kcal)\b", token.text.strip(), re.IGNORECASE):
                    continue
                if any(nw in t_lower for nw in ["protein", "carbohydrate", "energy", "sodium", "fat", "sugar"]):
                    continue

                if any(kw in t_lower for kw in ADDRESS_KEYWORDS):
                    addr_tokens.append(token)
                    in_address_block = True
                    if pincode_regex.search(token.text):
                        hit_pincode = True
                        in_address_block = False
                elif in_address_block and not hit_pincode:
                    # If this token is far away horizontally from the address block column, skip it without aborting
                    if addr_tokens and abs(token.bbox[0] - addr_tokens[0].bbox[0]) > 180:
                        continue

                    # Once a 6-digit pin code is hit, that marks the end of the postal address
                    if pincode_regex.search(token.text):
                        addr_tokens.append(token)
                        hit_pincode = True
                        in_address_block = False
                    elif any(char in token.text for char in [",", "-", "/", "."]) or len(token.text.split()) >= 2:
                        addr_tokens.append(token)
                    else:
                        in_address_block = False

        if addr_tokens:
            raw_addr = ", ".join(t.text for t in addr_tokens).strip()
            addr_text = clean_manufacturer_address(raw_addr)
            classified_fields["manufacturer_name_address"] = ExtractedField(
                field_name="manufacturer_name_address",
                raw_value=addr_text,
                confidence=float(np.mean([t.confidence for t in addr_tokens])),
                bounding_box=merge_bounding_boxes([t.bbox for t in addr_tokens]),
                ocr_source=ocr_source,
            )

    # =========================================================================
    # 6. Common / Generic Name Extraction (Strict Ingredients Exclusion)
    # =========================================================================
    gemini_name = [t for t in ordered_tokens if t.field_type == "common_name"]
    if gemini_name:
        name_text = " ".join(t.text for t in gemini_name).strip()
        classified_fields["common_name"] = ExtractedField(
            field_name="common_name",
            raw_value=name_text,
            confidence=float(np.mean([t.confidence for t in gemini_name])),
            bounding_box=merge_bounding_boxes([t.bbox for t in gemini_name]),
            ocr_source=ocr_source,
        )
    else:
        for token in ordered_tokens:
            match = re.search(r"(?:name\s*of\s*(?:the\s*)?commodity|generic\s*name|product\s*name)[\s:.]*(.+)", token.text, re.IGNORECASE)
            if match and len(match.group(1).strip()) > 2:
                classified_fields["common_name"] = ExtractedField(
                    field_name="common_name",
                    raw_value=match.group(1).strip(),
                    confidence=token.confidence,
                    bounding_box=token.bbox,
                    ocr_source=ocr_source,
                )
                break

    if "common_name" not in classified_fields:
        already_used = []
        if "manufacturer_name_address" in classified_fields:
            already_used.append(classified_fields["manufacturer_name_address"].raw_value)
        if "consumer_care" in classified_fields:
            already_used.append(classified_fields["consumer_care"].raw_value)

        def is_slogan_token(t: OcrToken) -> bool:
            t_low = t.text.lower()
            has_commodity_noun = any(kw in t_low for kw in COMMON_NAME_KEYWORDS)
            if has_commodity_noun:
                if any(phrase in t_low for phrase in ["loaded with", "baked to", "made with", "goodness of", "perfect for", "rich in", "in every"]):
                    return True
                if len(t.text.split()) > 5:
                    return True
                return False
            slogan_keywords = [
                "veg", "100%", "organic", "goodness", "perfect blend", "in every",
                "every bite", "bite", "bites", "delicious", "crunchy", "crispy",
                "tasty", "freshness", "wholesome", "healthy", "secret", "original",
                "taste", "improved", "new", "flavour", "flavor", "natural"
            ]
            return any(sw in t_low for sw in slogan_keywords)

        candidate_tokens = [
            t for t in ordered_tokens
            if not is_ingredients_token(t)
            and (t.text, t.bbox) not in ingredient_token_set
            and not any(dw in t.text.lower() for dw in DISQUALIFIED_NAME_WORDS)
            and len(t.text.strip()) >= 3
            and not re.search(r"^[0-9\W]+$", t.text)
            and not any(t.text in used for used in already_used)
            and not is_slogan_token(t)
            and not (t.bbox[3] > 100 and len(t.text.split()) > 4)
        ]

        if candidate_tokens:
            def score_candidate(cand: OcrToken) -> float:
                score = min(float(cand.bbox[3]), 80.0) * 2.0  # Cap height weight so massive paragraph boxes don't win
                cand_lower = cand.text.lower()
                if any(kw in cand_lower for kw in COMMON_NAME_KEYWORDS):
                    score += 200.0
                if image_shape and cand.bbox[1] > (image_shape[0] * 0.7):
                    score -= 50.0
                return score

            best_token = max(candidate_tokens, key=score_candidate)

            # Build multi-line title using vertical line chaining from best_token
            title_tokens = [best_token]
            # Check above
            curr = best_token
            while True:
                above_cands = [
                    t for t in candidate_tokens
                    if t not in title_tokens
                    and t.bbox[1] < curr.bbox[1]
                    and (curr.bbox[1] - (t.bbox[1] + t.bbox[3])) <= 50.0
                    and abs(t.bbox[0] - curr.bbox[0]) <= 120.0
                    and t.bbox[3] >= 12
                ]
                if above_cands:
                    closest_above = max(above_cands, key=lambda t: t.bbox[1])
                    title_tokens.append(closest_above)
                    curr = closest_above
                else:
                    break

            # Check below
            curr = best_token
            while True:
                below_cands = [
                    t for t in candidate_tokens
                    if t not in title_tokens
                    and t.bbox[1] > curr.bbox[1]
                    and (t.bbox[1] - (curr.bbox[1] + curr.bbox[3])) <= 50.0
                    and abs(t.bbox[0] - curr.bbox[0]) <= 120.0
                    and t.bbox[3] >= 12
                ]
                if below_cands:
                    closest_below = min(below_cands, key=lambda t: t.bbox[1])
                    title_tokens.append(closest_below)
                    curr = closest_below
                else:
                    break

            title_tokens.sort(key=lambda t: t.bbox[1])
            combined_name = " ".join(t.text for t in title_tokens).strip()
            
            # Strip known trailing claims that OCR might have merged into the title token
            combined_name = re.sub(r'(?i)\b(?:high\s*fibre|no\s*artificial\s*colours|source\s*of\s*energy|whole\s*grain|made\s*with|100%\s*veg).*$', '', combined_name).strip(' ,.-"\'')

            classified_fields["common_name"] = ExtractedField(
                field_name="common_name",
                raw_value=combined_name,
                confidence=best_token.confidence,
                bounding_box=merge_bounding_boxes([t.bbox for t in title_tokens]),
                ocr_source=ocr_source,
            )

    return classified_fields
