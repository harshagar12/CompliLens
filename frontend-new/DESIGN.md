# CompliLens Design System

> Audit-Dossier Aesthetic — A compliance officer's working document, not a SaaS dashboard.

## Color Tokens

| Token        | Hex       | CSS Variable        | Usage                              |
|--------------|-----------|---------------------|------------------------------------|
| Paper        | `#F6F5F1` | `--color-paper`     | Page background                    |
| Ink          | `#1B1B18` | `--color-ink`       | Primary text, headings             |
| Ink Light    | `#5C5C56` | `--color-ink-light` | Secondary text, captions           |
| Seal         | `#2B3A55` | `--color-seal`      | Navbar, buttons, deep chrome       |
| Stamp Green  | `#3F6B4C` | `--color-stamp-green` | PASS verdicts, confirmations     |
| Brick        | `#A23B2E` | `--color-brick`     | FAIL verdicts, violations          |
| Ochre        | `#B4791F` | `--color-ochre`     | NEEDS_REVIEW, warnings             |
| Hairline     | `#DEDBD2` | `--color-hairline`  | Borders, dividers, table rules     |
| Wash         | `#EDEAE3` | `--color-wash`      | Subtle panel backgrounds           |

## Typography

| Role      | Font            | Variable         | Weights  |
|-----------|-----------------|------------------|----------|
| Headings  | Fraunces        | `--font-heading` | 600      |
| Body      | Public Sans     | `--font-body`    | 400, 500 |
| Code/IDs  | IBM Plex Mono   | `--font-mono`    | 400, 500 |

## Layout Rules

1. **Ledger rows, not cards.** Components render as flat horizontal rows with `hairline` bottom borders. No rounded cards with shadows.
2. **Verdict as rubber stamp.** Rotated border box with serif text inside, animated on entrance. Not a filled badge.
3. **No ALL-CAPS labels.** Use sentence case for everything. "Product category" not "PRODUCT CATEGORY".
4. **No gradients, no glass, no glow.** Backgrounds are flat: `paper` or `wash`. Borders are `hairline`.
5. **Seal navbar is the only dark element.** Everything else is warm and light.
6. **Icons are sparse.** Use text labels instead of Material Symbols where possible. Keep icons only for truly semantic purposes (status dots, action buttons).
7. **Single footer.** License + DB status in one horizontal line. No multi-tier footer.

## Component Patterns

### Ledger Row
```
┌─────────────────────────────────────────────────────────────┐
│ [3px left border]  Label (Fraunces)  ·  Value (mono)  ·  →  │
├─────────────────────────────────────────────────────────────┤  ← hairline
```

### Verdict Stamp
```
  ┌─────────────┐
  │  Compliant   │  ← Fraunces, rotated −6°, border: 3px stamp-green
  └─────────────┘
```

### Form Controls
- `<select>`: hairline border, paper background, no icon prefix
- `<input>`: hairline border, paper background, ink text
- `<button primary>`: seal background, paper text, no gradient
- `<button secondary>`: hairline border, ink text, paper background
