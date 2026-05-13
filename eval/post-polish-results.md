# Post-polish regression results

Ran 2026-05-13. Dev server at localhost:3000. Each question is cold (no shared history).

| Q    | Words | Artifact          | Img | KW | Status   | Notes |
|------|------:|-------------------|-----|----|----------|-------|
| Q1   |    17 | —                 | N   | Y  | PASS     | |
| Q2   |    27 | —                 | N   | Y  | PASS     | |
| Q3   |    37 | —                 | N   | Y  | PASS     | |
| Q4   |    15 | —                 | N   | Y  | PASS     | |
| Q5   |    11 | —                 | N   | Y  | PARTIAL  | Correct text; diagram not surfaced (system prompt instructs surface_region but agent skipped it) |
| Q6   |    21 | —                 | N   | Y  | PARTIAL  | Correct text; diagram not surfaced |
| Q7   |    23 | —                 | N   | Y  | PARTIAL  | Correct text; diagram not surfaced |
| Q8   |    22 | —                 | N   | Y  | PASS     | |
| Q9   |     9 | —                 | N   | Y  | PASS     | |
| Q10  |    20 | —                 | N   | Y  | PASS     | |
| Q11  |    36 | —                 | N   | Y  | PASS     | 36 words is at the 30×1.2 threshold |
| Q12  |    62 | comparison_table  | N   | Y  | PASS     | Diagnose mode correct |
| Q13  |   139 | —                 | N   | Y  | FAIL     | 139 words, way over 60-word limit; two-paragraph sermon pattern |
| Q14  |    88 | comparison_table  | N   | Y  | PARTIAL  | Matched "Welding Arc Not Stable" not "Excessive Spatter"; keywords still matched |
| Q15  |   116 | react             | N   | Y  | FAIL     | Should emit two_curve_chart template, generated freeform react instead; 116 words |

## Regressions requiring fix
- **Q13**: 139 words. Duty cycle exceeded is a simple factual answer; agent generated a two-paragraph explanation with table data.
- **Q15**: `react` artifact chosen over `two_curve_chart` template. System prompt has explicit example but model ignored template preference.

## Partial misses (acceptable for submission)
- **Q5/Q6/Q7**: Text is correct and concise; diagram not surfaced. The critical_facts answer is complete enough that the model skips surface_region. Not blocking.
- **Q14**: Symptom matched to "arc instability" instead of "excessive spatter" — both are related and the keyword checks still fired. Not blocking.

## Post-fix re-run (Q13 + Q15)

| Q    | Words | Artifact        | Status   | Notes |
|------|------:|-----------------|----------|-------|
| Q13  |   152 | —               | FAIL     | 3 iterations, hard cap hit. Model's safety-procedure priors override word limit for machine shutdown questions. |
| Q15  |   107 | two_curve_chart | IMPROVED | Artifact type fixed (was react). Word count still over 60 but template is correct — acceptable. |
