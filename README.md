# CompliLens (SIH26034)

**AI-Assisted Automated Legal Metrology Compliance and Inspection System**  
*Built for Legal Metrology (Packaged Commodities) Rules, 2011 (LMPC).*

CompliLens is a comprehensive AI-powered platform designed for compliance officers. It automates the extraction of statutory declarations from packaging artworks and verifies them against a deterministic LMPC rules engine.

---

## 1. Non-Negotiable Core Architecture

- **The compliance verdict is NEVER produced by an LLM.** LLMs/ML models are strictly restricted to OCR perception and reviewer-facing additive typo correction. Every `PASS`, `FAIL`, or `NEEDS_REVIEW` verdict originates exclusively from a deterministic rule evaluated by the rules engine in `backend/engine/`, citing exact `rule_id` and statutory clause.
- **Traceable Evidence Payloads**: Every evaluation produces the confirmed declaration value, confidence score, bounding box / image crop reference, and exact statutory citation.
- **Mandatory Human-in-the-Loop Review (Phase 3)**: Before rules are evaluated, a mandatory review screen requires the inspector to confirm or edit extracted declarations (`confirmed_value` vs `raw_value` vs `suggested_value`).
- **Gotenberg PDF Engine**: Robust, containerized PDF report generation for audit dossiers, avoiding browser print inconsistencies.

---

## 2. Directory Structure

```
compli-lens/
├── backend/                   # FastAPI Backend
│   ├── api/                   # FastAPI routers
│   ├── engine/                # Deterministic rules engine
│   │   ├── rules/             # Versioned rule JSON files & schemas
│   │   ├── applicability.py   # Rule exemption pre-checks & category filters
│   │   ├── evaluator.py       # Whitelisted condition DSL evaluator
│   │   └── list_rules.py      # Rule registry listing script
│   ├── evaluation/            # CER/WER, P/R/F1, and compliance accuracy harness
│   ├── models/                # Pydantic data models (schemas.py)
│   ├── pipeline/              # Perception pipeline (preprocessing, OCR, classification)
│   └── tests/                 # Full automated test suite (pytest)
├── frontend-new/              # Next.js (App Router) + TailwindCSS dashboard
│   ├── app/                   # App Router pages (landing, inspection)
│   ├── components/            # Review cards, evidence cards, triage queue, report modals
│   ├── public/                # Static assets (images, icons)
│   └── lib/                   # Typed API client
├── data/                      # Local JSON databases and image storage
│   ├── raw_images/            # Package label images
│   ├── schedules/             # Reference tables
│   ├── uploads/               # Uploaded package photos
│   └── crops/                 # Bounding box evidence crops
├── config/                    # System configurations
├── docker-compose.yml         # Full stack container configuration (Gotenberg included)
└── README.md
```

---

## 3. Quickstart: Running Locally (Walkthrough)

### Prerequisites
- Python 3.11+
- Node.js 18+ and npm
- Docker (optional, but required for PDF generation via Gotenberg)

### Step 1: Start the Backend
The backend runs on FastAPI and uses a local JSON file database.
```bash
cd compli-lens/backend

# Activate virtual environment
# Windows:
.venv\Scripts\activate
# Mac/Linux:
# source .venv/bin/activate

# Run FastAPI backend
python -m uvicorn main:app --reload --port 8000
```
Backend API interactive docs: `http://localhost:8000/docs`

### Step 2: Start the Frontend
The modern dashboard is located in `frontend-new`.
```bash
cd compli-lens/frontend-new
npm install
npm run dev
```
Open your browser and navigate to: `http://localhost:3000`

### Step 3: Run Gotenberg (Optional - for PDF reports)
If you want to generate downloadable Audit PDFs, run Gotenberg via Docker:
```bash
docker run --rm -p 3001:3000 gotenberg/gotenberg:8
```

---

## 4. Usage Walkthrough

1. **Landing Page**: Navigate to `http://localhost:3000`. You will see the landing page showcasing the CompliLens automated extraction system.
2. **Upload**: Click "Start Inspection". Upload an image of a packaged commodity (e.g., a biscuit wrapper or soap box) or use the sample image provided by clicking "Load Sample Label".
3. **Extraction Review**: The AI pipeline will extract the text, draw bounding boxes, and present a side-by-side review interface. **You must review and accept each extraction.** Click on any field to see the exact bounding box snippet on the original image.
4. **Evaluate**: Once all fields are confirmed, click "Run Statutory Evaluation". 
5. **Audit Report**: CompliLens evaluates the confirmed fields against the deterministic JSON rules engine. It will generate a final "Audit Dossier" showing which rules passed and failed.
6. **Download**: Click "Download PDF" (requires Gotenberg) to generate a permanent compliance record.

---

## 5. How to Add a New Rule (Without Touching Engine Code)

Every rule in CompliLens is a declarative, versioned JSON file residing in `backend/engine/rules/`. To add a new rule:

1. Create a new JSON file in `backend/engine/rules/` (e.g. `lmpc_6_1_f_dimensions.json`).
2. Adhere strictly to `rule.schema.json`:
```json
{
  "rule_id": "LMPC-6.1.f",
  "description": "Package declares dimensions of commodity where size is relevant",
  "source_citation": "Legal Metrology (Packaged Commodities) Rules, 2011, Rule 6(1)(f)",
  "applicable_category": ["packaged_food"],
  "excluded_category": [],
  "required_field": "dimensions",
  "validation_condition": { "op": "non_empty" },
  "severity": "FAIL"
}
```
3. Supported operators: `non_empty`, `regex_match`, `in_range`, `lookup_membership`.
4. The engine will instantly pick up the new JSON file and apply it to future inspections!

---

## 6. Running the Evaluation Harness & Test Suite

### Automated Unit & API Tests
```bash
cd compli-lens/backend
pytest tests -v
```

### Comprehensive Benchmark Evaluation Study
```bash
python evaluation/run_eval.py
```
Computes and reports:
- Character Error Rate (CER) and Word Error Rate (WER) against raw OCR.
- Per-field extraction Recall.
- Compliance Accuracy and safety-critical False-Compliance Rate.
