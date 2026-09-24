"""
Image preprocessing module for CompliLens.
Applies deskewing, denoising, and contrast normalization to enhance OCR readability.
"""
from __future__ import annotations
from pathlib import Path
import cv2
import numpy as np


def normalize_contrast(image: np.ndarray) -> np.ndarray:
    """
    Applies CLAHE (Contrast Limited Adaptive Histogram Equalization)
    to enhance text contrast against varied packaging backgrounds.
    """
    if len(image.shape) == 2:  # Grayscale
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        return clahe.apply(image)

    # Color image: convert to LAB, apply CLAHE to L channel, convert back to BGR
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_clahe = clahe.apply(l)
    lab_clahe = cv2.merge((l_clahe, a, b))
    return cv2.cvtColor(lab_clahe, cv2.COLOR_LAB2BGR)


def denoise_image(image: np.ndarray) -> np.ndarray:
    """
    Denoises the image using bilateral filtering to reduce noise while preserving sharp text edges.
    """
    if len(image.shape) == 2:
        return cv2.bilateralFilter(image, d=7, sigmaColor=50, sigmaSpace=50)
    return cv2.bilateralFilter(image, d=7, sigmaColor=50, sigmaSpace=50)


def enhance_dot_matrix_text(image: np.ndarray) -> np.ndarray:
    """
    Connects disconnected pinhead dots in dot-matrix / continuous inkjet (CIJ) printed text
    (commonly used on Indian packaging for MRP, Batch No, and Mfg Date stamps).
    Dark ink dots on light packaging are thickened and bridged using morphological
    dilation on inverted grayscale followed by adaptive contrast normalization.
    """
    if len(image.shape) == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image.copy()

    # Determine whether text is primarily dark on light or light on dark
    mean_val = float(np.mean(gray))
    is_dark_ink = mean_val > 110  # light background with dark ink

    if is_dark_ink:
        # Invert so dark ink dots become bright structures
        binary_domain = cv2.bitwise_not(gray)
    else:
        binary_domain = gray.copy()

    # Dynamic kernel size based on resolution:
    # 5x5 for standard images, 7x7 for high-res phone camera shots (>1800px)
    max_dim = max(gray.shape[:2])
    k_size = 7 if max_dim > 1800 else (5 if max_dim > 900 else 3)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k_size, k_size))

    # Dilate the ink structures to bridge dot gaps
    dilated = cv2.dilate(binary_domain, kernel, iterations=1)

    # Slight Gaussian blur to smoothly blend connected pinhead dots
    blended = cv2.GaussianBlur(dilated, (3, 3), 0)

    if is_dark_ink:
        # Re-invert back to standard dark-text-on-light-background
        reconstructed = cv2.bitwise_not(blended)
    else:
        reconstructed = blended

    # Apply CLAHE to boost edge contrast of the joined text strokes
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    enhanced = clahe.apply(reconstructed)

    if len(image.shape) == 3:
        return cv2.cvtColor(enhanced, cv2.COLOR_GRAY2BGR)
    return enhanced


def detect_skew_angle(image: np.ndarray) -> float:
    """
    Detects skew angle in degrees using Hough lines transform.
    Returns angle in degrees (negative = counter-clockwise, positive = clockwise).
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image.copy()
    
    # Invert and threshold
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    thresh = cv2.adaptiveThreshold(
        blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 11, 2
    )

    # Edge detection
    edges = cv2.Canny(thresh, 50, 150, apertureSize=3)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=100, minLineLength=80, maxLineGap=10)

    if lines is None:
        return 0.0

    angles = []
    for line in lines:
        coords = line.flatten()
        if len(coords) < 4:
            continue
        x1, y1, x2, y2 = int(coords[0]), int(coords[1]), int(coords[2]), int(coords[3])
        if x2 == x1:
            continue
        angle = np.degrees(np.arctan2(y2 - y1, x2 - x1))
        # We only care about slight horizontal skews (within -30 to +30 degrees)
        if -30 <= angle <= 30:
            angles.append(angle)

    if not angles:
        return 0.0

    # Median angle is resilient against outliers
    return float(np.median(angles))


def rotate_image(image: np.ndarray, angle: float) -> np.ndarray:
    """Rotates the image by the specified angle around its center, with white background."""
    if abs(angle) < 0.5:
        return image

    h, w = image.shape[:2]
    center = (w // 2, h // 2)
    rot_mat = cv2.getRotationMatrix2D(center, angle, 1.0)
    
    # Calculate new bounding dimensions to avoid clipping
    cos = np.abs(rot_mat[0, 0])
    sin = np.abs(rot_mat[0, 1])
    new_w = int((h * sin) + (w * cos))
    new_h = int((h * cos) + (w * sin))

    rot_mat[0, 2] += (new_w / 2) - center[0]
    rot_mat[1, 2] += (new_h / 2) - center[1]

    # White border fill
    border_color = (255, 255, 255) if len(image.shape) == 3 else 255
    return cv2.warpAffine(image, rot_mat, (new_w, new_h), borderMode=cv2.BORDER_CONSTANT, borderValue=border_color)


def preprocess_image(
    image_input: str | Path | np.ndarray,
    output_path: str | Path | None = None,
    deskew: bool = True,
    denoise: bool = True,
    contrast: bool = True,
) -> tuple[np.ndarray, dict]:
    """
    Main preprocessing pipeline function.
    Applies deskewing, denoising, and contrast normalization.
    Returns (preprocessed_image_bgr, metadata_dict).
    """
    if isinstance(image_input, (str, Path)):
        img = cv2.imread(str(image_input))
        if img is None:
            raise FileNotFoundError(f"Failed to load image from: {image_input}")
    else:
        img = image_input.copy()

    metadata = {"skew_angle_deg": 0.0, "original_shape": img.shape}

    if deskew:
        angle = detect_skew_angle(img)
        metadata["skew_angle_deg"] = angle
        if abs(angle) >= 0.5:
            img = rotate_image(img, angle)

    if denoise:
        img = denoise_image(img)

    if contrast:
        img = normalize_contrast(img)

    metadata["final_shape"] = img.shape

    if output_path is not None:
        out_p = Path(output_path)
        out_p.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(out_p), img)

    return img, metadata
