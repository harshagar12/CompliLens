# Rule corpus conventions

## Adding a new rule
1. Copy the shape of an existing rule file (e.g. `lmpc_6_1_b_common_name.json`) as a template.
2. Validate against `rule.schema.json` before committing.
3. `validation_condition.op` must be one of the operators already listed in `rule.schema.json`'s enum.
   Don't invent a new op unless nothing existing can express the check -- see the agent PRD, §1.
4. Set `verification_status: "needs_legal_review"` and add a `review_note` for any rule where the
   source text is ambiguous, cross-references another Act, or you're not fully certain of the reading.
   Don't silently resolve ambiguity by picking whichever interpretation is convenient.
5. Set `project_scope` (`mvp` / `final_year_target` / `advanced`) to match where the feature lives in
   the PRD, so the engine and any UI can filter by scope during development.
6. Add the rule to `docs/rule_coverage_checklist.md`.

## Applicability vs. rules
Exemptions and category-routing provisions (Rule 26, Explanation III, the Rule 6(1)(d) food proviso)
are **not** rules with a PASS/FAIL outcome -- they decide whether a rule applies at all. They live in
`exemptions.json` and in each rule's own `excluded_category`/`applicable_category` fields, and are
consumed by `applicability.py` before any rule in this folder runs. See agent PRD §5.2.

## Files in this folder
- `rule.schema.json` -- JSON Schema every rule record must validate against.
- `lmpc_6_1_*.json`, `lmpc_6_2_*.json` -- individual Rule 6 declaration checks.
- `exemptions.json` -- Rule 26 applicability pre-checks.
- Lookup tables referenced by `validation_condition.table` (e.g. `first_schedule_table_1`) live in
  `/data/schedules/`, not here -- rules reference them by `table_id`, they don't embed the data.

## Known open items
See each rule's own `review_note` for specifics. The one with real MVP-scope implications:
`lmpc_6_1_a_manufacturer_address.json` has an unresolved ambiguity over whether food packages are
exempt from the LMPC address requirement itself (Explanation III) -- read that note before assuming
this rule's `source_citation` is final.
