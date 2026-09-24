# Multi-Revision Label Diff & Packaging Evolution Engine

## Problem Statement
The existing Label Diff tool requires packages to be uploaded and inspected individually beforehand, is restricted to comparing only two packages at a time, and only checks the 6 basic LMPC fields. 

In real-world packaging workflows, products evolve across multiple revisions (2 to 5 batches). Regulatory inspectors and brand compliance managers need to:
1. Upload multiple label images directly (2 to 5 labels).
2. Process them quickly with local **RapidOCR (CPU-based)**.
3. Choose whether to **opt into reviewing and editing extracted data** before evaluation (since mandatory review on 5 images can slow down diff workflows, but must remain available when accuracy is critical).
4. Run full **Legal Metrology (LMPC) compliance checks on every single label** and identify compliance regressions (e.g. was compliant in Rev 1, broke in Rev 2) vs remediations (fixed in Rev 3).
5. Detect and isolate **minute, non-statutory packaging changes over time**:
   - **Shrinkflation & Unit Economics**: Quantity reduction while MRP remains static or increases.
   - **Ingredients Formulation**: Substitution (e.g., sunflower oil ➔ palm oil), additions (preservatives/emulsifiers INS codes), percentage reductions.
   - **Allergen Warnings**: Introduction or removal of allergen warnings.
   - **Nutritional Facts**: Sodium, sugar, and calorie shifts.
   - **FSSAI & Regulatory Entities**: Factory relocation, license number changes, co-packer transitions.
   - **Marketing Claims & Barcodes**: Added or dropped claims ("100% Natural", "No Added Sugar"), EAN-13 barcode changes.

---

## User Review Required

> [!IMPORTANT]
> **Key Design Decisions**:
> 1. **Batch Upload Limit**: Capped at **2 to 5 images** per comparison session to maintain CPU responsiveness with RapidOCR and ensure side-by-side readability.
> 2. **Review Opt-In Gate**: Unlike single-package inspection where Phase 3 human review is mandatory before verdict generation, multi-label diff will provide an explicit checkbox: `[ ] Review & edit extracted declarations before running analysis`. If unchecked, it executes directly for instant results; if checked, it opens a multi-revision review grid.
> 3. **Non-LMPC Extractor Scope**: Uses regex and spatial proximity parsing on raw OCR tokens to isolate:
>    - Ingredients list & allergen warnings
>    - Nutritional facts table
>    - 14-digit FSSAI license numbers
>    - EAN-13 barcodes
>    - Marketing claims

---

## Proposed Changes

### Backend Architecture

#### [NEW] [`backend/pipeline/extended_extraction.py`](file:///d:/Programs/7th%20Sem%20Project/compli-lens/backend/pipeline/extended_extraction.py)
A specialized extractor for packaging attributes beyond standard LMPC declarations:
- `extract_ingredients(tokens)`: Identifies the ingredients block, splits by commas/semicolons, extracts percentages (e.g., `Oats (15%)`), and isolates allergen statements (`Contains Wheat...`).
- `extract_nutritional_facts(tokens)`: Extracts common nutrition table keys (Energy/kcal, Protein, Carbs, Sugars, Added Sugars, Sodium, Fat).
- `extract_fssai_licenses(tokens)`: Matches 14-digit FSSAI numbers (`\b1[0-9]{13}\b`).
- `extract_barcodes(tokens)`: Matches GS1 EAN-13 numbers (`\b890[0-9]{10}\b`).
- `extract_marketing_claims(tokens, common_name)`: Isolates banners and slogan callouts (e.g., "Wholesome Goodness", "No Artificial Colours", "Source of Energy").

#### [NEW] [`backend/pipeline/diff_engine.py`](file:///d:/Programs/7th%20Sem%20Project/compli-lens/backend/pipeline/diff_engine.py)
Multi-revision comparison algorithm:
- **Chronological Sequencing**: Sorts revisions by `mfg_month_year` parsed from declarations.
- **Statutory LMPC Diff**: Compares MRP, Net Qty, Address, Consumer Care, Month/Year across $R_1 \to R_2 \to \dots \to R_n$.
- **Shrinkflation Calculator**:
  $$\text{Unit Price} = \frac{\text{MRP}}{\text{Net Qty (g/ml)}} \times 100$$
  Flags stealth price jumps when unit price rises while packet price appears constant.
- **Formulation Diff**: Set diff on ingredients (added, removed, percentage changed).
- **Allergen Alert**: Detects newly added or removed allergen declarations.
- **Compliance Progression Matrix**: Compares rule evaluation results across revisions to mark:
  - 🟢 **REMEDIATED**: Rule failed in $R_i$, passed in $R_{i+1}$.
  - 🔴 **REGRESSION**: Rule passed in $R_i$, failed in $R_{i+1}$.
  - ⚪ **PERSISTENT_FAIL**: Failed in both.
  - 🟢 **PERSISTENT_PASS**: Passed in both.

#### [MODIFY] [`backend/main.py`](file:///d:/Programs/7th%20Sem%20Project/compli-lens/backend/main.py)
Add dedicated multi-revision diff endpoints:
- `POST /api/label-diff/batch-extract`:
  - Accepts multipart form: `files: list[UploadFile]` (2 to 5 images), `ocr_provider="rapidocr"`.
  - Runs perception pipeline + extended extraction for each file.
  - Saves packages in storage under session IDs.
  - Returns raw/suggested fields for all revisions.
- `POST /api/label-diff/batch-evaluate`:
  - Accepts confirmed/raw field payloads for all revisions in the batch.
  - Evaluates every package through `evaluate_package()`.
  - Runs `diff_engine.py` to produce chronological diffs, shrinkflation metrics, and regression matrix.
  - Returns unified `MultiRevisionDiffResponse`.

---

### Frontend Architecture

#### [MODIFY] [`frontend/components/LabelDiffView.tsx`](file:///d:/Programs/7th%20Sem%20Project/compli-lens/frontend/components/LabelDiffView.tsx)
Completely revamp the Label Diff tab:
1. **Multi-File Dropzone**:
   - Upload 2 to 5 images directly via drag-and-drop or file picker.
   - Visual thumbnails with remove buttons and batch counter indicator.
   - Checkbox: `[ ] Review & edit extracted declarations before running compliance & diff analysis`.
   - Action: `[ Analyze Revisions (RapidOCR) ]`.
2. **Review Modal / Grid (when opt-in selected)**:
   - Revision tabs ($R_1, R_2, \dots$) allowing inspectors to edit `confirmed_value` before running evaluation.
3. **Multi-Revision Dashboard**:
   - **Chronological Revision Timeline**: Visual banner showing $R_1 \to R_2 \to R_3$ with dates, images, and Overall Compliance Badges (**PASS / FAIL / NEEDS_REVIEW**).
   - **Executive Insights Card**:
     - Shrinkflation Radar (e.g. "+14.3% stealth unit price increase").
     - Compliance Regressions & Remediations count.
     - Critical changes summary.
   - **Tabbed Granular Diff Matrix**:
     - **Tab 1: Statutory LMPC Fields**: MRP, Net Quantity, Manufacturer, Consumer Care, Month/Year with compliance verdict per revision.
     - **Tab 2: Ingredients & Allergens**: Side-by-side ingredient breakdown, highlighted added/removed ingredients, allergen warnings.
     - **Tab 3: Nutritional Facts & Claims**: Energy/sugar/sodium deltas, marketing claims shifts, FSSAI license numbers, barcodes.
4. **Side-by-Side Synchronized Image Viewer**:
   - Displays all uploaded revisions with zoom and field highlight overlays.

---

## Verification Plan

### Automated Tests
1. Unit tests in `backend/tests/test_diff_engine.py`:
   - Test chronological sequencing of 3 revisions with different dates.
   - Test shrinkflation calculation (e.g., 200g @ ₹40 ➔ 180g @ ₹40 = +11.1% price increase).
   - Test ingredient addition/removal detection.
   - Test regression matrix (detecting when Rule 6(1)(e) passes in Rev 1 but fails in Rev 2).
2. API integration test:
   - Test `POST /api/label-diff/batch-extract` with 3 sample images (`Oat Biscuit`, `Roasted Channa`, `Nut Cookie`).
   - Test `POST /api/label-diff/batch-evaluate` and check output schema.

### Manual Verification
1. Open `http://localhost:3000` -> **Label Diff** tab.
2. Upload 3 test packaging labels (`Nut Cookie`, `Oat Biscuit`, `Roasted Channa`).
3. Verify RapidOCR extraction finishes smoothly without CPU hanging.
4. Verify chronological timeline displays each revision's LMPC compliance badge.
5. Verify ingredient, allergen, shrinkflation, and statutory diff tabs show clear color-coded differences.
