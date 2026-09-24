"""
End-to-end Perception Pipeline runner for CompliLens.
Orchestrates:
Image -> Preprocessing -> OCR Token Extraction -> Field Classification -> Additive Suggestions -> Evidence Crop Generation.
"""
from __future__ import annotations
import uuid
from pathlib import Path
import cv2
import numpy as np

try:
    from models.schemas import ExtractedField
except (ImportError, ValueError):
    from ..models.schemas import ExtractedField

from .preprocessing import preprocess_image
from .ocr import get_ocr_provider, OcrProvider
from .field_classification import classify_tokens_to_fields
from .correction import suggest_field_corrections


def crop_evidence_box(
    image: np.ndarray,
    bbox: tuple[int, int, int, int],
    padding: int = 10,
) -> np.ndarray:
    """Extracts a cropped sub-image corresponding to an extracted declaration bounding box with padding."""
    h, w = image.shape[:2]
    bx, by, bw, bh = bbox

    x1 = max(0, bx - padding)
    y1 = max(0, by - padding)
    x2 = min(w, bx + bw + padding)
    y2 = min(h, by + bh + padding)

    crop = image[y1:y2, x1:x2]
    if crop.size == 0:
        return image.copy()
    return crop


def run_perception_pipeline(
    image_path: str | Path,
    ocr_provider_name: str = "rapidocr",
    api_key: str | None = None,
    crops_dir: str | Path | None = None,
    package_id: str | None = None,
) -> dict[str, ExtractedField]:
    """
    Executes the complete Phase 2 perception pipeline:
    1. Preprocesses image (deskew, denoise, CLAHE contrast).
    2. Runs selected OCR provider (Local RapidOCR or Gemini Vision).
    3. Classifies tokens into the 6 target fields.
    4. Computes additive suggestions without overwriting raw values.
    5. Optionally saves cropped evidence snippets to crops_dir.
    """
    img_path = Path(image_path)
    if not img_path.exists():
        raise FileNotFoundError(f"Image not found at {img_path}")

    # 1. Preprocess
    preprocessed_img, meta = preprocess_image(img_path)

    # 2. OCR Token Extraction
    ocr_engine: OcrProvider = get_ocr_provider(ocr_provider_name, api_key=api_key)
    tokens = ocr_engine.extract_text(preprocessed_img)

    # 3. Field Classification
    fields_dict = classify_tokens_to_fields(tokens, image_shape=preprocessed_img.shape[:2])

    # 4. Additive Suggestions
    fields_dict = suggest_field_corrections(fields_dict, api_key=api_key)

    # 5. Generate Evidence Crops
    if crops_dir is not None:
        crops_p = Path(crops_dir)
        crops_p.mkdir(parents=True, exist_ok=True)
        pkg_prefix = f"{package_id}_" if package_id else ""

        for fname, field in fields_dict.items():
            crop = crop_evidence_box(preprocessed_img, field.bounding_box)
            crop_filename = f"{pkg_prefix}{fname}.jpg"
            crop_filepath = crops_p / crop_filename
            cv2.imwrite(str(crop_filepath), crop)

    return fields_dict
