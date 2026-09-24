"""
OCR Provider interface and implementations for CompliLens.
Supports:
- LocalOcrProvider (RapidOCR / PaddleOCR ONNX on CPU with dual-pass dot-matrix enhancer)
- GeminiVisionOcrProvider (Gemini Flash Vision with specialized packaging prompt)
- GoogleCloudVisionOcrProvider (Google Cloud Vision API via REST / SDK)
"""
from __future__ import annotations
import os
import json
import base64
from abc import ABC, abstractmethod
from pathlib import Path
import urllib.request
import cv2
import numpy as np
from pydantic import BaseModel

from .preprocessing import enhance_dot_matrix_text


class OcrToken(BaseModel):
    text: str
    bbox: tuple[int, int, int, int]  # (x, y, w, h) in image pixels
    confidence: float  # 0.0 to 1.0
    ocr_source: str
    field_type: str | None = None
    column_index: int = 0


def compute_box_iou(box1: tuple[int, int, int, int], box2: tuple[int, int, int, int]) -> float:
    """Computes Intersection-over-Union (IoU) between two bounding boxes (x, y, w, h)."""
    x1, y1, w1, h1 = box1
    x2, y2, w2, h2 = box2

    xi1 = max(x1, x2)
    yi1 = max(y1, y2)
    xi2 = min(x1 + w1, x2 + w2)
    yi2 = min(y1 + h1, y2 + h2)

    inter_w = max(0, xi2 - xi1)
    inter_h = max(0, yi2 - yi1)
    inter_area = inter_w * inter_h

    area1 = w1 * h1
    area2 = w2 * h2
    union_area = area1 + area2 - inter_area

    if union_area <= 0:
        return 0.0
    return inter_area / union_area


class OcrProvider(ABC):
    """Abstract base class for OCR engines."""

    @property
    @abstractmethod
    def provider_name(self) -> str:
        pass

    @abstractmethod
    def extract_text(self, image_input: str | Path | np.ndarray) -> list[OcrToken]:
        pass


class LocalOcrProvider(OcrProvider):
    """
    Local CPU-based OCR provider using RapidOCR with dual-pass dot-matrix enhancement.
    Pass 1: Standard contrast-normalized image.
    Pass 2: Dot-matrix enhanced image to connect disconnected inkjet dots (for MRP/Date/Batch).
    """

    def __init__(self):
        try:
            from rapidocr_onnxruntime import RapidOCR
            self._engine = RapidOCR()
        except ImportError:
            self._engine = None

    @property
    def provider_name(self) -> str:
        return "rapidocr"

    def _run_single_pass(self, img: np.ndarray) -> list[OcrToken]:
        if self._engine is None:
            raise RuntimeError("rapidocr-onnxruntime is not installed.")

        ocr_result, _ = self._engine(img)
        tokens: list[OcrToken] = []

        if not ocr_result:
            return tokens

        for item in ocr_result:
            box, text, score = item
            if not text or not text.strip():
                continue

            pts = np.array(box, dtype=np.int32)
            x_min = int(np.min(pts[:, 0]))
            y_min = int(np.min(pts[:, 1]))
            x_max = int(np.max(pts[:, 0]))
            y_max = int(np.max(pts[:, 1]))
            w = max(1, x_max - x_min)
            h = max(1, y_max - y_min)

            tokens.append(
                OcrToken(
                    text=text.strip(),
                    bbox=(max(0, x_min), max(0, y_min), w, h),
                    confidence=float(score),
                    ocr_source=self.provider_name,
                )
            )
        return tokens

    def extract_text(self, image_input: str | Path | np.ndarray) -> list[OcrToken]:
        if isinstance(image_input, (str, Path)):
            img = cv2.imread(str(image_input))
            if img is None:
                raise FileNotFoundError(f"Image not found at {image_input}")
        else:
            img = image_input

        # Pass 1: Standard OCR
        primary_tokens = self._run_single_pass(img)

        # Pass 2: Dot-matrix enhanced pass (connects inkjet dots for MRP, Expiry, Batch)
        dot_enhanced_img = enhance_dot_matrix_text(img)
        dot_tokens = self._run_single_pass(dot_enhanced_img)

        # Merge non-redundant tokens from Pass 2 into primary tokens
        for d_tok in dot_tokens:
            is_redundant = False
            for p_tok in primary_tokens:
                if compute_box_iou(d_tok.bbox, p_tok.bbox) > 0.4:
                    is_redundant = True
                    break
            if not is_redundant:
                primary_tokens.append(d_tok)

        return primary_tokens


class GeminiVisionOcrProvider(OcrProvider):
    """
    Hosted OCR provider using Google Gemini Flash vision model.
    Configured with detailed layout & dot-matrix prompt instructions.
    """

    def __init__(self, api_key: str | None = None, model_name: str = "gemini-3.6-flash"):
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY")
        self.model_name = model_name
        self._client = None

    @property
    def provider_name(self) -> str:
        return "gemini-vision"

    def extract_text(self, image_input: str | Path | np.ndarray) -> list[OcrToken]:
        key = self.api_key or os.environ.get("GEMINI_API_KEY")
        if not key or not key.strip():
            raise ValueError("GEMINI_API_KEY is not set. Please add GEMINI_API_KEY to compli-lens/backend/.env")
        key = key.strip()

        from google import genai
        from google.genai import types

        client = genai.Client(api_key=key)

        if isinstance(image_input, (str, Path)):
            img_path = Path(image_input)
            with open(img_path, "rb") as f:
                img_bytes = f.read()
            img = cv2.imread(str(img_path))
            h, w = img.shape[:2] if img is not None else (1000, 1000)
        else:
            h, w = image_input.shape[:2]
            success, buffer = cv2.imencode(".jpg", image_input)
            if not success:
                raise ValueError("Could not encode image array to JPG bytes")
            img_bytes = buffer.tobytes()

        prompt = (
            "You are an expert OCR and Legal Metrology inspection engine for Indian packaged food labels.\n"
            "Extract all printed text blocks with their precise bounding boxes, layout columns, and field categories.\n\n"
            "STRICT COLUMN SEPARATION RULES:\n"
            "- Packaged food labels are strictly partitioned into vertical columns or panels (e.g. Column 0: Ingredients/Nutrition table; Column 1: Declarations MRP/Date/Address/Consumer Care; Column 2: Brand/Barcode).\n"
            "- NEVER read across columns horizontally. Read each vertical column strictly from top to bottom before moving to the next column.\n"
            "- Assign a zero-indexed 'column_index' (0, 1, 2...) indicating which vertical column each text block belongs to.\n\n"
            "CRITICAL LMPC DECLARATIONS EXTRACTION:\n"
            "1. 'net_quantity': Explicit net weight / quantity declaration (e.g. 'Net Quantity: 200 g', 'Net Wt: 100g', '500 ml'). This must NEVER be omitted.\n"
            "2. 'mrp': Maximum Retail Price including all taxes (e.g. 'MRP Rs. 60.00 (inclusive of all taxes)'). If '(inclusive of all taxes)' is on the line below the price, include both in the mrp block.\n"
            "3. 'mfg_date': Month and year of manufacture or packaging (e.g. 'Mfg Date: 08/2026', 'PKD: 10/24'). Decipher dotted / inkjet dot-matrix fonts carefully.\n"
            "4. 'consumer_care': Customer service phone / email / helpline / address.\n"
            "5. 'manufacturer': Full manufacturer or packer name and postal address with PIN code. Do NOT include slogans, barcodes, or disposal icons into the address.\n"
            "6. 'common_name': The generic commodity name (e.g. 'Crunchy Nut Cookies', 'Biscuits', 'Wheat Flour', 'Namkeen').\n"
            "7. 'ingredients': Ingredients, allergen advice, or nutrition tables.\n"
            "8. 'other': Any other packaging text, storage instructions, slogans, or barcodes.\n\n"
            "Return a JSON array of objects. Each object must have:\n"
            "- 'text': string containing the text\n"
            "- 'box_2d': [ymin, xmin, ymax, xmax] normalized from 0 to 1000\n"
            "- 'column_index': integer (0 for first/left column, 1 for next column, etc.)\n"
            "- 'field_type': one of ['net_quantity', 'mrp', 'mfg_date', 'consumer_care', 'manufacturer', 'common_name', 'ingredients', 'nutrition', 'other']\n"
            "- 'confidence': float (0.0 to 1.0)\n\n"
            "Return ONLY the valid JSON array."
        )

        models_to_try = [self.model_name, "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"]
        candidate_models = []
        for m in models_to_try:
            if m and m not in candidate_models:
                candidate_models.append(m)

        response = None
        last_error = None

        for model_candidate in candidate_models:
            for attempt in range(2):
                try:
                    response = client.models.generate_content(
                        model=model_candidate,
                        contents=[
                            types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"),
                            prompt,
                        ],
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json",
                            temperature=0.0,
                        ),
                    )
                    if response and response.text:
                        break
                except Exception as err:
                    last_error = err
                    import time
                    time.sleep(0.8)
            if response and response.text:
                break

        if not response or not response.text:
            # High demand (503) or rate limit (429) hit across all candidates:
            # Fall back seamlessly to Local RapidOCR with dot-matrix preprocessor so inspection never halts!
            print(f"[WARN] Gemini Vision API unavailable ({last_error}). Seamlessly falling back to Local RapidOCR engine.")
            local_fallback = LocalOcrProvider()
            fallback_tokens = local_fallback.extract_text(image_input)
            for t in fallback_tokens:
                t.ocr_source = "rapidocr (gemini-fallback)"
            return fallback_tokens

        raw_json = response.text.strip()
        if raw_json.startswith("```"):
            raw_json = raw_json.strip("`").replace("json\n", "", 1).strip()

        try:
            parsed = json.loads(raw_json)
        except Exception:
            local_fallback = LocalOcrProvider()
            return local_fallback.extract_text(image_input)

        tokens: list[OcrToken] = []
        items = parsed if isinstance(parsed, list) else parsed.get("regions", parsed.get("tokens", []))

        for item in items:
            txt = item.get("text", "").strip()
            if not txt:
                continue

            b = item.get("box_2d", [0, 0, 1000, 1000])
            if len(b) == 4:
                ymin, xmin, ymax, xmax = b
                px_x = int((xmin / 1000.0) * w)
                px_y = int((ymin / 1000.0) * h)
                px_w = max(1, int(((xmax - xmin) / 1000.0) * w))
                px_h = max(1, int(((ymax - ymin) / 1000.0) * h))
            else:
                px_x, px_y, px_w, px_h = (0, 0, w, h)

            conf = float(item.get("confidence", 0.95))
            f_type = item.get("field_type")
            col_idx = int(item.get("column_index", 0))

            tokens.append(
                OcrToken(
                    text=txt,
                    bbox=(px_x, px_y, px_w, px_h),
                    confidence=min(1.0, max(0.0, conf)),
                    ocr_source=self.provider_name,
                    field_type=f_type,
                    column_index=col_idx,
                )
            )

        return tokens


class GoogleCloudVisionOcrProvider(OcrProvider):
    """
    Hosted OCR provider using Google Cloud Vision API (DOCUMENT_TEXT_DETECTION).
    Supports either GOOGLE_VISION_API_KEY (direct Cloud Vision REST) or standard GCP credentials.
    """

    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or os.environ.get("GOOGLE_VISION_API_KEY")

    @property
    def provider_name(self) -> str:
        return "google-cloud-vision"

    def extract_text(self, image_input: str | Path | np.ndarray) -> list[OcrToken]:
        key = self.api_key or os.environ.get("GOOGLE_VISION_API_KEY")
        if not key:
            raise ValueError("GOOGLE_VISION_API_KEY is not set in backend/.env")

        if isinstance(image_input, (str, Path)):
            with open(image_input, "rb") as f:
                img_bytes = f.read()
        else:
            success, buffer = cv2.imencode(".jpg", image_input)
            if not success:
                raise ValueError("Could not encode image array to JPG bytes")
            img_bytes = buffer.tobytes()

        b64_content = base64.b64encode(img_bytes).decode("utf-8")

        url = f"https://vision.googleapis.com/v1/images:annotate?key={key}"
        payload = {
            "requests": [
                {
                    "image": {"content": b64_content},
                    "features": [{"type": "DOCUMENT_TEXT_DETECTION"}],
                }
            ]
        }

        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )

        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        tokens: list[OcrToken] = []
        resps = data.get("responses", [])
        if not resps:
            return tokens

        annotations = resps[0].get("textAnnotations", [])
        # First annotation is full page text, subsequent are individual detected text blocks
        for ann in annotations[1:]:
            txt = ann.get("description", "").strip()
            if not txt:
                continue

            vertices = ann.get("boundingPoly", {}).get("vertices", [])
            if len(vertices) >= 4:
                xs = [v.get("x", 0) for v in vertices]
                ys = [v.get("y", 0) for v in vertices]
                x_min, x_max = min(xs), max(xs)
                y_min, y_max = min(ys), max(ys)
                bbox = (x_min, y_min, max(1, x_max - x_min), max(1, y_max - y_min))
            else:
                bbox = (0, 0, 100, 30)

            tokens.append(
                OcrToken(
                    text=txt,
                    bbox=bbox,
                    confidence=0.95,
                    ocr_source=self.provider_name,
                )
            )

        return tokens


def get_ocr_provider(provider_type: str = "rapidocr", api_key: str | None = None) -> OcrProvider:
    """Factory helper to instantiate an OcrProvider by name."""
    p_lower = provider_type.lower()
    if p_lower in ["rapidocr", "paddleocr", "local"]:
        return LocalOcrProvider()
    elif p_lower in ["gemini", "gemini-vision", "gemini_flash"]:
        return GeminiVisionOcrProvider(api_key=api_key)
    elif p_lower in ["google-cloud-vision", "google_vision", "gcp_vision"]:
        return GoogleCloudVisionOcrProvider(api_key=api_key)
    else:
        raise ValueError(f"Unknown OCR provider type: {provider_type}. Expected 'rapidocr', 'gemini-vision', or 'google-cloud-vision'.")
