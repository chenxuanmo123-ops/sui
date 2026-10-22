# Real-data evaluation set

This directory separates deterministic data/engine checks from live-model quality
checks. Passing the first does not establish that an LLM understands a domain.

## Current scope

| Case | Source | What it checks | Status |
| --- | --- | --- | --- |
| OWID energy, China 2015-2022 | Pinned upstream commit; fixture and provenance in `tests/fixtures/` | CSV parsing, annual trend arithmetic, source-row linkage, sample-scope caveat | Verified fixture; existing core tests |
| Apple SEC company facts, FY2021-2023 | SEC Company Facts API, selected only from the immutable FY2023 10-K accession | Financial fact grain, period vs point-in-time facts, exact arithmetic, duplicate filing contexts, no summing balance-sheet stocks over years | Generated and hash-pinned fixture; deterministic arithmetic tests pass |
| Stack Overflow question events, January 2024 | Stack Exchange API, all 61 results for a fixed tag/date query; sanitized selected-field snapshot excludes owner profiles | Import contract, event-date grouping, tag metadata, source linkage, and explicit non-population warning | Tag-filtered event series; not representative of all platform activity or user preference |

The SEC file is derived from an official public filing feed, not fabricated data.
The fixture retains source accession and period fields so each record can be
traced. Revenue gold values were cross-checked against the SEC-hosted Apple 2023
Form 10-K, consolidated statements of operations. The filing reports total net sales of $383,285m, $394,328m,
and $365,817m for FY2023, FY2022, and FY2021 respectively; the fixture stores
USD units. The retrieved source hash and exact scope are recorded in
`tests/fixtures/evaluation/financial/sec-2023-10k-revenue-verification.json`.
Revenue and net income are
period flows; assets and cash are point-in-time balances. They must not be treated
as interchangeable merely because they share the USD unit. A three-year sum of
annual revenue is not a quarterly run-rate, and adding year-end cash balances is
not a meaningful cash total.

The Stack Overflow source snapshot contains only selected API fields, not the
complete API response. It retains question links and per-item `content_license`;
these are license labels reported by the captured API, not a completed legal
review. The repository preserves source links; licensing and attribution suitability for redistribution of this
title-bearing fixture still needs a dedicated review before public release.

## Reproducibility

Run `node tests/evaluation/fetch-sec-fixture.mjs --update` only when intentionally
refreshing the SEC source snapshot. The script fetches SEC Company Facts, selects
facts reported in accession `0000320193-23-000106`, validates the exact expected
period count for all five metrics, and writes the normalized fixture, the raw
response snapshot, and provenance hashes. Without `--update`, an existing pinned
fixture is protected from overwrite.

Run `npm run test:evaluation` for the independent financial and platform-event evaluation suites. Run
`npm run test:core` separately for parser, SQLite, quality, and chart-engine checks.
The financial suite verifies deterministic source-row and arithmetic behavior; it
does not score a live model or prove that arbitrary financial data is classified
correctly.

For a captured model plan wrapper, run `npm run evaluate:plan -- --case=<case-id> --input=<plan.json> [--output=<report.json>]`.
The wrapper must contain the exact `datasetHash` returned with the model plan and
the `plan` object. The evaluator binds that hash to a pinned real-data fixture,
executes the existing SQLite engine, compares every expected point and source-row
ID, and emits a human-review rubric for grain, units, scope, flow/stock and
causality. It deliberately does not turn keywords or HTTP success into an AI
accuracy score. A report can reach `needs-human-review` only after automated
execution/calculation gates; it still requires human semantic review.

## Live-model capture and current result

Run `npm run evaluate:model -- --case=<case-id> --base-url=http://127.0.0.1:5174`
against the locally configured host to capture a real model response and evaluate
its plan. This makes a real model request; UI/API test doubles are never used as
model-quality scores.

The first captured `deepseek-flash` SEC case on October 17, 2026 failed the automated
gates: the plan used the nonexistent exact filter value `revenues` instead of
`revenue`. The cash task executed, but the whole run is still
`failed-automated-checks`. Evidence is in the ignored directory
`artifacts/model-evaluation/2026-10-17T15-16-00.024Z-e3902a4b/`.
Task isolation and local exact-filter warnings now have separate regression tests;
those tests do not change the recorded model failure into a pass.

## October 19, 2026 follow-up

A second real deepseek-flash planning call returned three tasks. Revenue used the
exact value revenue; revenue and cash SQL results and source-row IDs matched the
pinned gold. Evidence: artifacts/model-evaluation/2026-10-19T06-58-42.072Z-3982b983/.

The initial evaluator wrongly flagged the third task (row count by period) as
mixed financial amounts. The evaluator now exempts count/distinct from that check;
amount mixing remains rejected by regression tests. Original report.json remains
unchanged. report-count-aware.json re-evaluates the same captured response and
records needs-human-review, with execution/calculation gates passed.

The third task rationale still overclaims: a whole-table row count cannot prove
one record per metric per period. No semantic pass or general model accuracy is
claimed. The earlier October 17 failure remains a failure. Repair/review API and
browser regressions use explicit test doubles; live-model recovery and review
have not yet been evaluated.

## What is not yet evaluated

- Live-model classification and plan quality across vendors.
- Survey representativeness, weighting, nonresponse, and multi-select denominators.
- Representative platform-use records versus platform-wide users or preference. The Stack Overflow fixture is a tag-filtered event series for testing import and scope controls; it does not measure unique users, total platform traffic, or market preference.
- PDF table extraction accuracy.
- Any general claim that arbitrary uploaded data is classified correctly.

Those require separately sourced, licensed, versioned datasets and explicit gold
labels. Test doubles can test the application contract but are not model-quality
evidence.
