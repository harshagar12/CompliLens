# Rule coverage checklist

Scope: LMPC 2011, packaged food category, MVP + Final-Year Target only (Advanced/FSSAI items
tracked here as explicitly deferred, not silently missing).

| Source clause | Rule ID(s) | Status | Note |
|---|---|---|---|
| Rule 6(1)(a) | `LMPC-6.1.a` | Encoded | `verification_status: needs_legal_review` -- see its `review_note` |
| Rule 6(1)(a) Explanation I | -- | Not encoded | Liability attribution (who's the presumed manufacturer), not a checkable label field |
| Rule 6(1)(a) Explanation II | -- | Not encoded | Liability attribution (brand owner as marketer), not a checkable label field |
| Rule 6(1)(a) Explanation III | Caveat on `LMPC-6.1.a` | Encoded as note | Ambiguous scope -- see review_note on that rule |
| Rule 6(1)(b) | `LMPC-6.1.b` | Encoded | |
| Rule 6(1)(c) | `LMPC-6.1.c` | Encoded | Presence check |
| Rule 6(1)(c) + First Schedule Table I | `LMPC-6.1.c-tolerance` | Encoded | `project_scope: final_year_target`; needs measured quantity, not just OCR text |
| Rule 6(1)(d) | `LMPC-6.1.d` | Encoded, excluded for `packaged_food` | Explicit food carve-out in the clause's own proviso; deferred to FSSAI/Advanced |
| Rule 6(1)(e) | `LMPC-6.1.e` | Encoded | Not excluded for food |
| Rule 6(1)(f) | -- | Deferred | Dimension declarations; conditional relevance, low priority for packaged food |
| Rule 6(1)(g) + provisos (A)(B)(C) | -- | Deferred | Catch-all + bidi/LPG/90-day-shelf-life provisos; low MVP priority |
| Rule 6(2) | `LMPC-6.2` | Encoded | |
| Rule 7 (principal display panel sizing) | -- | Deferred | Physical layout/font-height measurement, not reliably extractable from a photo |
| Rule 8, Rule 9 (declaration placement/manner) | -- | Deferred | Manufacturing-process/print-quality rules, not consumer-facing compliance content |
| Rule 10(1) proviso (\u22645cc packages) | Folded into `LMPC-6.1.a.exceptions` | Encoded | |
| Rule 18(3) (revised price on tax change) | -- | Deferred | Relevant conceptually to the Label Diff tool; not yet a formal rule |
| Rule 26 (exemptions a-d) | `exemptions.json` | Encoded | Applicability pre-check, not a compliance rule |
| First Schedule, Table I | `first_schedule_table1.json` | Encoded | `final_year_target` |
| First Schedule, Table II (length/area/number) | -- | Deferred | Not typical for packaged food; add if a food item needs it |
| Second Schedule (food commodities) | `second_schedule_food.json` | Encoded, food subset only | Non-food commodities in the source table intentionally excluded |
| Rule 5 non-standard-size declaration proviso | -- | Deferred | Needs a rule that fires when quantity is present but not in the Second Schedule list |
| Rules 27-30 (manufacturer/packer registration) | -- | Out of scope | Registration process, not a label-compliance check |

## How to use this
- Encoded + `needs_legal_review` rows are usable now but should be double-checked before your final
  submission -- they're not guesses, but the source text itself is ambiguous or cross-references
  another Act.
- Deferred rows are honest gaps, not oversights -- cite this table directly if asked "what does your
  system NOT check yet."
