from __future__ import annotations
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from pipeline.preprocessing import preprocess_image, detect_skew_angle
from pipeline.ocr import LocalOcrProvider, GeminiVisionOcrProvider, OcrToken
from pipeline.field_classification import classify_tokens_to_fields
from pipeline.correction import suggest_field_corrections
from models.schemas import ExtractedField


@pytest.fixture(scope="session")
def sample_package_image() -> Path:
    """Creates a synthetic test label image containing standard LMPC declarations."""
    img_dir = Path(__file__).parent / "test_data"
    img_dir.mkdir(parents=True, exist_ok=True)
    img_path = img_dir / "biscuit_label.jpg"

    # 800x600 image with light background
    w, h = 800, 600
    img = Image.new("RGB", (w, h), color=(245, 245, 240))
    draw = ImageDraw.Draw(img)

    # Use default font or basic shapes
    # Draw declarations clearly
    draw.rectangle([20, 20, 780, 580], outline=(100, 100, 100), width=3)
    
    # Title / Common name
    draw.text((50, 50), "CREAM CRUNCH BISCUITS", fill=(20, 20, 20))
    
    # Net Quantity
    draw.text((50, 120), "Net Quantity: 100 g", fill=(10, 10, 10))
    
    # MRP
    draw.text((50, 180), "MRP Rs. 35.00 incl. of all taxes", fill=(10, 10, 10))
    
    # Mfg Date
    draw.text((50, 240), "Mfg Date: 05/2026", fill=(10, 10, 10))
    
    # Manufacturer Address
    draw.text((50, 300), "Manufactured by: Tasty Crunch Foods Pvt Ltd", fill=(10, 10, 10))
    draw.text((50, 330), "Plot 12, Industrial Area, Phase 2, New Delhi 110020", fill=(10, 10, 10))
    
    # Consumer Care
    draw.text((50, 420), "Consumer Care: customercare@tastycrunch.com", fill=(10, 10, 10))
    draw.text((50, 450), "Toll Free Helpline: 1800-222-3333", fill=(10, 10, 10))

    img.save(img_path, "JPEG")
    return img_path


def test_preprocessing(sample_package_image):
    processed, meta = preprocess_image(sample_package_image, deskew=True, denoise=True, contrast=True)
    assert isinstance(processed, np.ndarray)
    assert processed.shape[0] > 0 and processed.shape[1] > 0
    assert "skew_angle_deg" in meta
    assert "original_shape" in meta


def test_local_ocr_provider(sample_package_image):
    ocr = LocalOcrProvider()
    tokens = ocr.extract_text(sample_package_image)

    assert len(tokens) > 0, "RapidOCR should extract text tokens from sample image"
    
    # Verify non-null bounding boxes and valid confidence scores
    for token in tokens:
        assert isinstance(token.text, str) and len(token.text) > 0
        assert len(token.bbox) == 4
        assert token.bbox[2] > 0 and token.bbox[3] > 0  # positive width and height
        assert 0.0 <= token.confidence <= 1.0
        assert token.ocr_source == "rapidocr"

    # Verify key tokens were recognized
    full_text = " ".join(t.text for t in tokens).lower()
    assert "biscuit" in full_text or "crunch" in full_text or "net" in full_text


def test_field_classification_on_sample(sample_package_image):
    ocr = LocalOcrProvider()
    tokens = ocr.extract_text(sample_package_image)
    fields = classify_tokens_to_fields(tokens)

    assert len(fields) > 0, "Should classify at least some target fields"

    # Check that classified fields have non-null bounding boxes and valid raw values
    for fname, f in fields.items():
        assert f.field_name == fname
        assert len(f.raw_value.strip()) > 0
        assert len(f.bounding_box) == 4
        assert f.bounding_box[2] > 0 and f.bounding_box[3] > 0
        assert 0.0 <= f.confidence <= 1.0
        assert f.confirmed_value is None  # Must NOT be pre-confirmed


def test_correction_suggestion_safeguards():
    # Test strict non-overwriting safeguard
    fields = {
        "mrp": ExtractedField(
            field_name="mrp",
            raw_value="MRP Rs. 3O.0O incl. of all taxes",
            confidence=0.85,
            bounding_box=(50, 180, 200, 30),
            ocr_source="test_ocr",
        ),
        "net_quantity": ExtractedField(
            field_name="net_quantity",
            raw_value="l00g",
            confidence=0.88,
            bounding_box=(50, 120, 100, 30),
            ocr_source="test_ocr",
        ),
    }

    corrected = suggest_field_corrections(fields)

    # 1. raw_value MUST NOT be overwritten
    assert corrected["mrp"].raw_value == "MRP Rs. 3O.0O incl. of all taxes"
    assert corrected["net_quantity"].raw_value == "l00g"

    # 2. confirmed_value MUST remain None
    assert corrected["mrp"].confirmed_value is None
    assert corrected["net_quantity"].confirmed_value is None

    # 3. suggested_value is populated additively
    assert corrected["mrp"].suggested_value is not None
    assert "0" in corrected["mrp"].suggested_value
    assert corrected["mrp"].suggestion_source in ["heuristic", "gemini-flash"]


def test_end_to_end_perception_pipeline(sample_package_image):
    from pipeline.pipeline import run_perception_pipeline

    crops_dir = Path(__file__).parent / "test_data" / "crops"
    fields = run_perception_pipeline(
        image_path=sample_package_image,
        ocr_provider_name="rapidocr",
        crops_dir=crops_dir,
        package_id="pkg_test_001",
    )

    assert len(fields) > 0
    # Check that crops were generated
    crop_files = list(crops_dir.glob("*.jpg"))
    assert len(crop_files) > 0
    for f in crop_files:
        assert f.stat().st_size > 0


def test_multiline_mrp_merging():
    """Verifies that '(Incl. of all taxes)' on the line below MRP is merged."""
    tokens = [
        OcrToken(text="MRP Rs. 45.00", bbox=(100, 200, 120, 20), confidence=0.92, ocr_source="test"),
        OcrToken(text="(Incl. of all taxes)", bbox=(100, 225, 130, 18), confidence=0.90, ocr_source="test"),
    ]
    fields = classify_tokens_to_fields(tokens)
    assert "mrp" in fields
    assert "45.00" in fields["mrp"].raw_value
    assert "taxes" in fields["mrp"].raw_value.lower()
    # Bounding box should span both lines
    assert fields["mrp"].bounding_box[3] >= 35


def test_common_name_ingredients_blacklist():
    """Verifies that ingredients (flour, sugar, oil) are never misclassified as the common name."""
    tokens = [
        # Prominent product title
        OcrToken(text="BUTTER DELIGHT COOKIES", bbox=(100, 40, 250, 40), confidence=0.95, ocr_source="test"),
        # Ingredients block in column 1
        OcrToken(text="INGREDIENTS: Refined Wheat Flour (Maida), Sugar, Edible Vegetable Oil, Milk Solids", bbox=(100, 120, 300, 30), confidence=0.92, ocr_source="test"),
    ]
    fields = classify_tokens_to_fields(tokens)
    assert "common_name" in fields
    assert "COOKIES" in fields["common_name"].raw_value
    assert "Flour" not in fields["common_name"].raw_value
    assert "Sugar" not in fields["common_name"].raw_value
