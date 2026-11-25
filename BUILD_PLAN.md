# Autopsy - Step-by-Step Build Plan

**Product:** Given a warehouse movement log and physical counts, explain every stock discrepancy with ranked, replay-verified, calibrated hypotheses; recommend the cheapest physical check; surface hotspots; and abstain when the evidence is thin.

**How to use this document:** every step has a **Build**, an **Exit test**, and **Depends on / Unblocks**. An exit test is a gate. If it fails, fix the step before starting the next one. Contracts are locked in Step 0 and changed only by updating this document and regenerating fixtures.

**One-command truth:** nothing ships unless `python -m eval.run_all` regenerates the number that claims it.

---

## 0. Non-negotiables

1. **Contracts first.** Schemas, evidence JSON, and eval protocol are locked before engine code. The dashboard starts on fake JSON on day 2.
2. **Ledger-edit-or-die.** Every hypothesis is expressed as an explicit edit (or an explicit loss booking). Apply it, replay, and require the affected gap(s) to close. If it does not close, the hypothesis is dead.
3. **Generator and solver are adversarial.** The solver author never reads injector internals, ground-truth generation, or blind seeds. The generator/eval owner reports aggregate metrics only.
4. **Abstention is a product feature.** "I don't know" is a valid, visible output. Never force a top cause to fill a card.
5. **Every number is reproducible.** Accuracy, calibration, hotspot recovery, and timing all come from the eval harness or a checked-in CSV. No hand-typed metrics in the deck.
6. **Degrade by tier, never crash.** Tier 0 (counts + basic log), Tier 1 (+ worker, shift, doc numbers), Tier 2 (+ item master). Every feature declares its minimum tier and degrades gracefully.
7. **LLMs fail closed.** The narrator template and fuzzy column mapper work without an LLM. Any LLM output that fails validation falls back to the deterministic path.
8. **Synthetic-to-real is disclosed.** Synthetic results and partial public-data results are labeled as such in the UI and the deck.

---

## 1. Repo layout and stack

```
autopsy/
  schemas/
    models.py            # pydantic v2: Movement, Count, ItemMaster, Evidence, Hypothesis, Repair
    features.py          # feature -> minimum tier registry
    validate.py          # CLI: validate evidence JSON / dataset against schemas
  ingest/
    loaders.py           # CSV/XLSX, encoding fallback, delimiter sniff, sheet pick
    mapping.py           # fuzzy + alias + optional LLM column mapper
    preflight.py         # tier detection, drops, duplicates, negative stock, gaps
  generator/
    catalog.py           # item popularity from UCI Online Retail II (freq + order sizes)
    world.py             # locations, zones, workers, shifts, calendar
    sim.py               # daily movement simulation + periodic counts
    injectors/
      base.py            # injector protocol + ground-truth hook
      double_scan.py, missed_scan.py, qty_typo.py,
      unit_mismatch.py, item_swap.py, wrong_location.py,
      miscount.py, cutoff_timing.py, shrink_damage.py
    ground_truth.py      # builds per-window effects by replay-diffing clean vs dirty
    make.py              # CLI: seeds, difficulty, error count, output manifest
  engine/
    replay.py            # ledger, anchor, window, gap detection, edit application
    operators/
      base.py            # Candidate, Operator protocol, registry
      double_scan.py ... residual_shrink.py
    scoring.py           # priors, chance model, likelihood ratios, normalization
    assign.py            # ILP via PuLP/CBC, conflicts, abstention
    calibrate.py         # isotonic/Platt, ECE, reliability, threshold selection
    checks.py            # check catalog and cheapest-discriminator selection
    hotspots.py          # Beta-Binomial rates, BH, counterfactual value
    feedback.py          # append-only labels -> Beta counts
  narrator/
    templates.py         # deterministic autopsy text + Q&A answers
    llm.py               # optional paraphrase/QA adapter
    validator.py         # entity extraction + evidence-only validation
  app/
    Home.py
    pages/1_Upload.py, 2_Discrepancies.py, 3_Autopsy.py, 4_Hotspots.py, 5_Trust.py
    components.py        # tables, charts, badges
    data_source.py       # fixture JSON now, engine output later
  eval/
    run_all.py           # regenerate every number and chart
    metrics.py, baselines.py, ablations.py, report.py
    hotspots_eval.py, feedback_sim.py, mapping_eval.py, timing_summary.py
    blind/seeds.json     # owned by generator/eval lead; never read by engine author
    results/             # committed: results.json, RESULTS.md, PNGs
  data/                  # gitignored: gen/, pilot/, feedback.jsonl
  fixtures/              # committed: tier0.csv, tier1.csv, tier2.xlsx,
                         # messy_1..3.csv, evidence_fake.json, hallucination_corpus.jsonl
  docs/
    scoring.md           # locked formulas and heuristics
    pilot/outreach.md, pilot/data_request.md, pilot/log_template.md
  tests/
scripts/fetch_uci.py     # dataset download + checksum, not required at runtime
```

**Stack:** Python 3.11+, pydantic v2, pandas, numpy, scipy, scikit-learn, PuLP (CBC), Jinja2, Streamlit, pytest, openpyxl, rapidfuzz. Optional LLM SDK, decided on day 1; no LLM in the default or demo path. Pin versions in `requirements.txt`; record them in eval artifacts.

**Interfaces that keep the team parallel:**

```python
# schemas/models.py (shape, not final signatures)
class Movement(BaseModel):
    txn_id: str
    ts: datetime
    item: str
    location: str
    qty_delta: float
    event_type: str
    doc_no: str | None = None
    worker: str | None = None
    shift: str | None = None

class Count(BaseModel):
    count_id: str
    count_ts: datetime
    item: str
    location: str
    counted_qty: float

class Discrepancy(BaseModel):
    id: str
    item: str
    location: str
    prev_count_ts: datetime | None
    count_ts: datetime
    expected: float | None
    counted: float
    gap: float
    anchored: bool
    window_txn_ids: list[str]

class Candidate(BaseModel):
    cause: str
    repair: Repair
    affected: list[tuple[str, str]]
    search_space: int
    competing_matches: int

class Repair(BaseModel):
    ops: list[EditOp]
```

```python
# engine/replay.py
class Replayer:
    def detect(self) -> list[Discrepancy]: ...
    def apply(self, repair: Repair) -> "Replayer": ...
    def residual(self, keys: list[tuple[str, str]]) -> dict[tuple[str, str], float]: ...

# engine/operators/base.py
class Operator(Protocol):
    cause: str
    min_tier: int
    def generate(self, d: Discrepancy, window: Window, ctx: Context) -> list[Candidate]: ...
```

```python
# engine/scoring.py
def score(d: Discrepancy, candidates: list[Candidate], ctx: Context) -> list[Hypothesis]: ...

# engine/assign.py
def assign(discrepancies, candidates_by_d, ctx) -> dict[str, Candidate]: ...
def decide(assigned, calibrator, threshold, margin) -> list[EvidenceObject]: ...
```

**Cause enum (locked):**
`double_scan`, `missed_scan`, `qty_typo`, `unit_mismatch`, `item_swap`, `wrong_location`, `miscount`, `cutoff_timing`, `residual_shrink`, `opening_balance`.

---

## 2. Dependency graph

```
Step 0 contracts --+-> Step 1 ingest --> Step 11 mapping --> Step 13 upload
                   +-> Step 2 generator v0 --+-> Step 3 replay --+-> Step 5 operators
                   |                          |                   |        |
                   |                          +-> Step 4 gen v1 ---+        v
                   |                          +-> Step 10 hotspots      Step 6 scoring
                   |                                                         |
                   |                                                         v
                   |                                                  Step 7 assignment/abstain
                   |                                                         |
                   +-> Step 12 narrator (fake JSON first)                    +-> Step 8 calibration
                   +-> Step 13 dashboard (fake JSON day 2)                   +-> Step 9 checks
                                                                             +-> Step 14 eval harness
                                                                             +-> Step 15 feedback
Step 16 pilot runs W1-W5 in parallel. Step 17 timing is W5. Step 18 freeze/demo is W6.
```

**Critical path:** 0 -> 2 -> 3 -> 5 -> 6 -> 7 -> 8 -> 14 -> 18.

Do not start calibration, narrator polish, or dashboard beautification before the critical path gate at Step 7 passes.

---

## 3. Step 0 - Contracts and fake data (Days 1-2)

**Goal:** lock the data contracts, evidence JSON, and eval protocol so generator, engine, dashboard, and narrator can proceed independently.

**Build**
- [ ] `schemas/models.py`: Movement, Count, ItemMaster, Repair, EditOp, Hypothesis, EvidenceObject, PreflightReport, GroundTruthRecord. Pydantic v2, strict types, ISO-8601 datetimes.
- [ ] `schemas/features.py`: `FEATURES = {"doc_no": 1, "worker": 1, "shift": 1, "unit_cost": 2, "pack_size": 2, "similar_group": 2, "location_zone": 2}`. Tier 0 = the always-required fields.
- [ ] `schemas/validate.py`: validate a dataset bundle and an evidence JSON file. Generates `schemas/evidence.schema.json` from the model.
- [ ] `fixtures/evidence_fake.json`: at least 3 discrepancies covering one confident typo, one abstain/unanchored case, and one two-gap case (swap or wrong location).
- [ ] `fixtures/tier0.csv`, `tier1.csv`, `tier2.xlsx` stubs (filled in Step 1).
- [ ] `docs/scoring.md`: v1 formulas, fallback rules, and what will be calibrated later.
- [ ] `eval/protocol.md`: splits, difficulty definitions, metrics, report format, blind-access rule.
- [ ] `docs/pilot/outreach.md` + send the first outreach batch (see Appendix A). Start the pilot log now.

**Locked contract decisions**

| Decision | Locked value | Reason |
|---|---|---|
| Gap sign | `gap = counted - expected` | Matches the spec; negative = missing stock |
| Window | Half-open `(prev_count_ts, count_ts]` | Deterministic re-anchor; counts taken at end of instant |
| Repair shape | `{"ops": [atomic edits]}` | Swaps/locations are one edit touching two ledgers; cutoffs need compound edits. UI may flatten single-op repairs |
| Edit ops | `delete`, `insert`, `set_field`, `set_count`, `book_loss` | Covers all nine causes; `book_loss` is the only non-ledger op |
| Unanchored first count | `anchored=false`, abstain by default, cause reported as `opening_balance` only | No fabricated expected value |
| Value at risk | `abs(gap) * unit_cost` at Tier 2; `null` otherwise | No fake dollars |
| Risk ranking without value | Rank by `abs(gap)` and label "units" | Honest fallback |
| Abstention target | Precision-first; target selective precision 0.90, set from validation in Step 8 | A wrong diagnosis is worse than "I don't know" |
| Assignment | ILP via PuLP/CBC | Pair hypotheses plus "one txn blamed twice" constraints |
| Confidence | Normalized per discrepancy over causes; calibrated top-1 in Step 8 | One number, one meaning |
| LLM | Optional, always behind deterministic fallback | Demo must survive no network/no key |
| IDs | `D-` + stable hash of `(item, location, prev_ts, count_ts)` | Stable across reruns; sort order does not change IDs |

**Evidence JSON v1 (valid example):**

```json
{
  "id": "D-7f3a91",
  "item": "SKU123",
  "location": "B-12",
  "window": ["2025-03-01T00:00:00", "2025-03-14T23:59:59"],
  "tier": 2,
  "anchored": true,
  "expected": 140,
  "counted": 40,
  "gap": -100,
  "value_at_risk": 1240.0,
  "abstain": false,
  "hypotheses": [
    {
      "cause": "qty_typo",
      "confidence": 0.71,
      "repair": {
        "ops": [
          {"op": "set_field", "txn_id": "T-8812", "field": "qty_delta", "from": 10, "to": 110}
        ]
      },
      "likelihood_ratio": 38.2,
      "search_space": 41,
      "competing_matches": 1,
      "evidence": [
        "Receive T-8812 logged 10; the gap is +100",
        "This worker had 2 prior confirmed qty_typo labels"
      ]
    },
    {
      "cause": "missed_scan",
      "confidence": 0.12,
      "repair": {
        "ops": [
          {"op": "insert", "txn": {"ts": "2025-03-12T14:03:00", "item": "SKU123", "location": "B-12", "qty_delta": -100, "event_type": "pick"}}
        ]
      },
      "likelihood_ratio": 1.0,
      "search_space": 42,
      "competing_matches": 42,
      "evidence": ["No doc-number sequence gap near the window"]
    }
  ],
  "check_id": "recount_pallet",
  "suggested_check": "Count cases on pallet B-12; if 11 cases not 1, typo confirmed",
  "limitations": []
}
```

**Eval protocol locked here**
- **Splits:** dev seeds `1000-1099`; validation `2000-2099`; blind sets owned by generator/eval lead with seeds stored only in `eval/blind/seeds.json`. Engine author sees aggregate metrics, never blind rows.
- **Difficulty:**
  - easy: one injected error per window, all Tier 2 fields clean.
  - medium: one or two errors per window, occasional missing optional fields, some offsetting effects.
  - hard: two or more errors per window including offsetting pairs, wrong counts, cutoff-timing issues, shrink/damage, noisy worker/shift fields, thin history.
- **Metrics:** detection F1 on window keys; top-1 and top-3 cause accuracy on single-cause windows; cause-set recall on multi-cause windows; coverage and selective accuracy; ECE and Brier; hotspot recovery and null false discoveries; value-weighted recall. Define each formula in `eval/protocol.md` before coding.
- **Report format:** per-cause x per-difficulty table, support counts, weakest cause named, baseline deltas, ablation deltas.
- **Ground truth format:** one row per injected edit plus per-window effects generated by replay-diff (not hand-written). Every detected discrepancy must map to at least one injected error, and the signed sum of per-error effects must equal the observed gap for non-timestamp edits.

**Exit test**
```bash
pytest tests/test_contracts.py
python -m schemas.validate fixtures/evidence_fake.json
```
Passes: round-trip serialization, `from`/`to` JSON fields, unanchored case validates, pair repair validates, schema file generated, dashboard teammate can render fake JSON.

**Depends on:** nothing. **Unblocks:** everything.

---
## 4. Step 1 - Ingest and preflight (Week 1)

**Goal:** load messy files, detect the honest tier, and report every drop/warning.

**Build**
- [ ] `ingest/loaders.py`: CSV/Excel; utf-8 then latin-1; delimiter sniff; sheet selection; date parsing with explicit ambiguity handling (ISO first, then day-first, report ambiguous); numeric coercion with per-column failure counts.
- [ ] `ingest/preflight.py` returning a pydantic `PreflightReport`:
  - detected tier and per-feature coverage percentages
  - rows read / kept / dropped with reasons
  - duplicate `txn_id`, duplicate `doc_no`, missing `doc_no` rate
  - counts for items with no movements, movements for unknown items/locations
  - negative running balance per item/location
  - timestamp gaps above a configured threshold per location
  - ambiguous dates, non-numeric quantities, unparseable event types
- [ ] `python -m ingest.preflight <file>` prints the report as text and `--json` for the UI.
- [ ] Tier qualification rules: Tier 1 requires worker, shift, and doc_no columns present with at least 80% populated; Tier 2 requires an item-master file joined at at least 95% coverage. Partial fields are reported as feature availability, not silently upgraded.
- [ ] Fixtures: `tier0.csv` (basic log + counts), `tier1.csv` (+ worker/shift/doc_no), `tier2.xlsx` (+ master sheet). Add one intentionally bad file for the drop/reason path.

**Exit test**
```bash
pytest tests/test_ingest.py
python -m ingest.preflight fixtures/tier0.csv
python -m ingest.preflight fixtures/tier1.csv
python -m ingest.preflight fixtures/tier2.xlsx
```
Each file loads; each preflight matches its golden snapshot; dropped rows are counted, never silently ignored.

**Depends on:** Step 0. **Unblocks:** Step 11, Step 13 upload page.

---

## 5. Step 2 - Generator v0 (Week 1)

**Goal:** a synthetic warehouse whose clean data replays perfectly and whose dirty data has complete ground truth.

**Build**
- [ ] `generator/catalog.py`: load UCI Online Retail II SKU frequencies and order-size distributions only. `scripts/fetch_uci.py` downloads with checksum; committed data is not required. Offline fallback: seeded Zipf popularity and log-normal order sizes. Synthesize all item names, costs, pack sizes, and groups.
- [ ] `generator/world.py`: locations across zones, workers, shifts, calendar, per-item reorder points.
- [ ] `generator/sim.py`: daily receives, picks, moves (paired out/in), returns; never allow negative physical stock; replenishment triggers; periodic cycle counts per location at varying intervals; opening balance movements so early counts can be anchored when intended.
- [ ] `generator/injectors/`: double scan, missed scan, qty typo, unit mismatch, item swap, wrong location. Each logs `(cause, target_id, edit, injected_at_step)`.
- [ ] `generator/ground_truth.py`: for every injected edit, build the clean-vs-single-error replay diff and record per-window signed effects. This handles offsetting errors and count-anchor propagation. For timestamp edits, allow at most one per window and document the interaction limit.
- [ ] `generator/make.py`: `--seed --days --errors --difficulty --out`; writes movements, counts, optional master, ground truth, and a manifest with dataset hash and package versions.
- [ ] Invariants asserted at generation: unique IDs, no negative stock, every movement references a known item/location, every count references a known item/location, no duplicate count timestamps.

**Exit test**
```bash
python -m generator.make --seed 1001 --days 30 --errors 0 --out data/gen/v0_clean
python -m generator.make --seed 1002 --days 30 --errors 6 --out data/gen/v0_dirty
python -m eval.smoke_replay --dataset data/gen/v0_clean
```
Clean dataset replays with every gap exactly zero (coordinate with Step 3). Dirty dataset has a ground-truth file where each injected error maps to a window and the signed effects reconcile to the observed gaps.

**Depends on:** Step 0. **Unblocks:** Step 3, Step 4, Step 10, Step 14.

---

## 6. Step 3 - Replay and discrepancy detection (Week 1)

**Goal:** the only source of truth for "what is missing."

**Build**
- [ ] `engine/replay.py`:
  - running ledger per `(item, location)` sorted by timestamp
  - anchor = most recent count strictly before the current count
  - expected = anchor `counted_qty` + sum of `qty_delta` in `(prev_count_ts, count_ts]`
  - gap = counted - expected
  - stable discrepancy IDs; include all window transaction IDs
  - first count with no anchor: `anchored=false`, flag `opening_balance`; do not invent an expected value
  - counts with duplicate timestamps: deterministic tie-break, preflight warning
  - movements at exactly `count_ts` are included; generator must not place a count and a movement at the same instant ambiguously
- [ ] `Replayer.apply(repair)`: immutable copy, apply `delete`/`insert`/`set_field`/`set_count`/`book_loss`, re-anchor affected windows, return new state. `residual(keys)` returns post-edit gaps.
- [ ] CLI: `python -m engine.replay --dataset <path> --out data/gen/<name>/gaps.json`.
- [ ] Tests with handcrafted ledgers: clean, one missed receive, one typo, two counts, unanchored opening, duplicate count timestamps.

**Exit test**
```bash
pytest tests/test_replay.py
python -m eval.smoke_replay --dataset data/gen/v0_dirty --expect-ground-truth
```
Every detected gap equals the ground-truth net effect for its window; no discrepancy lacks a ground-truth mapping; no ground-truth-affected window is missed.

**Depends on:** Steps 0, 2. **Unblocks:** Steps 5, 10.

---

## 7. Step 4 - Generator v1, hard mode (Week 1-2)

**Goal:** an adversarial dataset that defeats trivial rules and exposes real ambiguity.

**Build**
- [ ] Multiple errors per window, including deliberately offsetting pairs.
- [ ] Legitimate duplicate-looking picks (same item, location, quantity, close times) that must not be auto-deleted.
- [ ] Wrong counts (edit the count record), cutoff-timing issues (count timestamp shifted across nearby movements), theft/shrink and damage as unlogged outflows, noisy worker and shift fields (missing, swapped, late-entry).
- [ ] Three difficulty tiers with manifest labels; blind seeds file owned by generator/eval lead.
- [ ] Naive-solver check: a rule-based baseline (duplicate -> double scan; else miscount) must score poorly on hard, proving the set is not trivially soluble.
- [ ] Ground-truth reconciliation on every generated dataset: (a) each error maps to a window, (b) signed effects sum to the observed gap for non-timestamp edits, (c) offsetting errors are logged individually.
- [ ] Dataset manifest: seed, difficulty, error count by cause, row counts, hashes, generator version, package versions.

**Exit test**
```bash
python -m generator.make --difficulty hard --seed 4101 --out data/gen/hard_dev
python -m eval.baselines --dataset data/gen/hard_dev --baseline naive --assert-max-top1 0.40
python -m eval.reconcile --dataset data/gen/hard_dev
```
Naive top-1 is below the trivial threshold; reconciliation reports zero unexplained windows and zero unexplained net gap.

**Depends on:** Steps 2, 3. **Unblocks:** Steps 5-8, 10, 14.

**Blind rule:** the hard blind set is generated by G, stored outside the engine author's working paths, and only aggregate results are reported. No seed in `eval/blind/seeds.json` may appear in engine code, notebooks, or commit messages.

---

## 8. Step 5 - Repair operators (Week 2-3)

**Goal:** one operator per cause, each producing ledger edits that are verified by replay.

**Order:** double scan -> missed scan -> qty typo -> unit mismatch -> item swap -> wrong location -> miscount -> cutoff timing -> residual shrink.

**Shared rules**
- Each operator implements `generate(d, window, ctx) -> list[Candidate]`.
- Every candidate applies a concrete edit and is verified by `Replayer.apply(repair).residual(affected_keys) == 0` within `1e-6`; `book_loss` is allowed to cover the residual by definition.
- Each candidate records `search_space` (number of independent opportunities examined) and `competing_matches` (opportunities that would zero the gap). These feed the chance model; do not fake them.
- Cap candidates per cause per discrepancy (start at 50) ranked by exactness and time proximity; log truncation counts. A cap that hides the true repair is a generator-vs-solver bug, not a scoring problem.
- Pair causes edit one transaction and must close both affected gaps: item swap (`set_field(item)`), wrong location (`set_field(location)`).

**Operators**

| Operator | Candidate generation | Verification | Tier |
|---|---|---|---|
| double_scan | Duplicate signatures: same item/location/qty within 10 minutes, or same doc_no with same item/qty; delete the later/duplicate txn | Gap closes | 0 (doc_no evidence at 1) |
| missed_scan | Insert a txn of size `-gap` at each plausible slot (before count, after each txn); weak by construction | Gap closes; `competing_matches = slots` | 0 |
| qty_typo | Per txn: adjacent digit swap, transposition, inserted/deleted digit, extra zero, decimal shift (10x/100x), sign flip where plausible | Edited qty closes gap exactly | 0 |
| unit_mismatch | For txns with pack_size: qty x pack_size and qty / pack_size | Gap closes | 2 |
| item_swap | Opposite-sign txn with matching magnitude at same location, nearby time, same similar_group when available | Both item gaps close | 2 for similar_group, 1 otherwise |
| wrong_location | Matching txn at another location, same item, nearby time | Both location gaps close | 0-1 |
| miscount | Set the count to expected | Always closes by construction; fallback, low prior | 0 |
| cutoff_timing | Shift the count timestamp across the nearest boundary txn (both directions), re-anchor, replay | Gap closes after re-anchoring | 1 (needs time resolution) |
| residual_shrink | Book `gap` as unexplained loss | Covers residual by definition; lowest prior | 0 |

**Implementation notes**
- Typo variants must include digit insertion, not only zero append: `10 -> 110` is a real candidate pattern from the spec.
- Missed-scan `search_space` is the number of insertion slots; since every slot with `-gap` closes the gap, its LR is ~1. This is intentional; it needs prior or doc-sequence evidence.
- `miscount` and `residual_shrink` always verify, so their LR is capped at 1 and their priors stay low. A fallback cause can never become the top answer purely by construction.
- Cutoff operator is unavailable when count timestamps have day-only resolution; report `limitations` instead of guessing.
- Search must be bounded by the window plus a small pre-window for boundary effects; never scan the whole dataset per discrepancy.

**Exit test**
```bash
pytest tests/operators/
```
Each operator has handcrafted positive cases, negative cases (no candidate when the gap cannot be closed), pair cases for swap/location, and a test that a fallback operator is capped. Every candidate's verification is a real replay, not a shortcut.

**Depends on:** Steps 0, 3. **Unblocks:** Steps 6-9.

---
## 9. Step 6 - Scoring (Week 2-3)

**Goal:** rank causes by prior x evidence strength, with a chance model that punishes "many things could fit."

**Build**
- [ ] `engine/scoring.py`:
  - `prior(cause, context)` from global frequencies with Dirichlet shrinkage down the hierarchy: global -> event type -> location (T1) -> worker/shift (T1/T2). Start strength `alpha=10`; tune on validation only.
  - chance model: `LR = search_space / competing_matches`, capped at 50. Fallback causes (`miscount`, `residual_shrink`) use `LR = 1`.
  - combined score: `score = prior * LR`; normalize per discrepancy to get confidence.
  - doc-number evidence at Tier 1: duplicate doc_no for same item/qty multiplies double-scan LR by 3; a numeric sequence gap near the window multiplies missed-scan LR by 2; missing doc_no on a candidate downweights it. All multipliers are heuristics v1, documented, and ablated later.
- [ ] `docs/scoring.md`: formulas, cap, fallback rules, shrinkage, doc heuristics, and planned calibration.
- [ ] Evidence bullets generated from the actual candidate: txn ID, logged value, gap, worker history if available, doc-number fact. No generic filler.
- [ ] Cause aggregation: keep the best candidate per cause for confidence, but retain all candidates for assignment.

**Why the chance model matters**
- 12 receives in the window, 1 of which can be edited to close the gap -> strong evidence.
- 1 receive, 50 possible insertion slots for a missed scan -> weak evidence.
- Always-verifying fallbacks get no free confidence.

**Exit test**
```bash
python -m eval.run --dataset easy_blind --compare prior_only
```
Generator/eval lead reports aggregate top-1: scoring beats prior-only by at least 10 absolute points on the easy blind set. If not, fix the chance model or priors; do not weaken the blind set.

**Depends on:** Steps 4, 5. **Unblocks:** Step 7.

---

## 10. Step 7 - Global assignment and abstention (Week 3)

**Goal:** select one coherent set of repairs so one transaction is not blamed twice, and abstain when the evidence is insufficient.

**Build**
- [ ] `engine/assign.py` ILP with PuLP/CBC:
  - binary `x[c]` per candidate
  - each gap explained at most once: `sum(x[c] for c explaining g) <= 1`
  - each transaction/count edited at most once: `sum(x[c] for c using t) <= 1`
  - pair candidates touch two gaps and two ledgers through one edit; they consume both gaps but one transaction
  - objective: maximize `sum(log(max(score[c], 1e-6)) * x[c])` (minimum-surprise selection)
  - every gap has a `miscount` fallback candidate, so the ILP is always feasible
- [ ] Post-selection diagnostics: global replay of all selected edits; flag `cascades=true` if a count correction changes a later window, and include it in `limitations`. Optionally run a second assignment round; cap at two rounds.
- [ ] Abstention rules: abstain if calibrated top confidence `< threshold` or top-2 margin `< delta`. Before calibration, use provisional values and expose them in config.
- [ ] Coverage-accuracy curve: sweep threshold, compute answered coverage and selective top-1; write curve data for eval and the Trust page.

**Exit test**
```bash
python -m eval.run --dataset hard_blind --abstain
python -m eval.curves --dataset hard_blind
```
The curve is monotone overall (allow local noise), and selective accuracy at 50% coverage beats full-coverage accuracy by at least 10 points. If abstention does not help, the confidence scores are not meaningful yet; fix Step 6 before proceeding.

**Depends on:** Steps 5, 6. **Unblocks:** Steps 8, 9, 14.

---

## 11. Step 8 - Calibration (Week 4)

**Goal:** when the tool says 80%, it is right about 80% of the time, and the abstention threshold is chosen from calibrated scores.

**Build**
- [ ] `engine/calibrate.py`:
  - fit on the validation split only; never blind
  - isotonic regression when validation top-1 samples >= 500; Platt scaling otherwise
  - 5-fold cross-fit to produce out-of-fold scores for honest calibration evaluation on validation
  - clip calibrated probabilities to `[0.01, 0.99]`
  - select threshold at target selective precision 0.90 (maximize coverage subject to precision); fall back to best F1 if unreachable and disclose
  - save calibrator artifact + metadata: fit split, sample count, git sha, package versions, seed range
- [ ] Reliability diagram (15 equal-frequency bins), ECE, Brier score; sample count per bin.
- [ ] Apply calibration to live evidence JSON; confidence values in the UI come only from the calibrator.

**Exit test**
```bash
python -m eval.calibration --dataset blind
```
Validation ECE <= 0.05; blind ECE <= 0.08; reliability plot committed; threshold artifact loads in the dashboard. If blind ECE fails, report it and fix; do not tune on blind.

**Depends on:** Step 7. **Unblocks:** Steps 9, 13 Trust page, 14.

---

## 12. Step 9 - Cheapest-check recommender (Week 4)

**Goal:** for ambiguous discrepancies, recommend the lowest-effort physical check that best separates the top hypotheses.

**Build**
- [ ] `engine/checks.py` + `engine/checks.yaml`:
  - checks: `recount_location`, `recount_pallet`, `pull_pick_slip`, `pull_receiving_doc`, `scan_audit`, `check_transfer_docs`, `verify_pack_size`, `check_count_sheet`
  - each check declares `effort` (1-3), applicable hypothesis sets, and an instruction template
  - generic fallback: `recount_location`, applicable to any non-abstained discrepancy
- [ ] Selection heuristic: for the top-2 (or top-k) hypotheses, choose the applicable check maximizing `4*p*(1-p) / effort`, where `p` is the top hypothesis probability; this approximates the most even split per unit effort. Tie-break by lower effort, then by higher coverage of remaining ambiguity.
- [ ] Output `check_id` and a concrete `suggested_check` string with item/location and the decision rule (e.g., "if the recount matches the system, the gap is a ledger cause; if it matches the physical pallet, the count is wrong").
- [ ] Abstained discrepancies may return a data-quality check or `null`; non-abstained discrepancies must always return a check.
- [ ] Tier awareness: without doc numbers, do not recommend a document pull; fall back to a physical check.

**Exit test**
```bash
pytest tests/test_checks.py
python -m eval.checks --dataset hard_blind
```
Every non-abstained evidence object has a non-empty `suggested_check`; on fixtures the chosen check separates the top two; an equal-gain cheaper check is preferred.

**Depends on:** Steps 7, 8. **Unblocks:** Steps 12, 13 autopsy page.

---

## 13. Step 10 - Hotspots (Week 4)

**Goal:** error rate per transaction, with uncertainty, multiple-comparison control, and a defensible counterfactual.

**Build**
- [ ] `engine/hotspots.py`:
  - slices: worker, shift, location, event_type; exposure = transaction count (and value moved at Tier 2)
  - rate = confirmed/high-confidence errors / exposure; Beta posterior with Jeffreys prior; 95% credible intervals
  - Benjamini-Hochberg across all tested slices; require minimum exposure (start 30) and effect ratio >= 1.5
  - worker IDs anonymized by default with HMAC-SHA256(salt, worker_id)[:8] -> `W-3f9a`; raw IDs never leave the local mapping
  - counterfactual: `excess = max(0, rate_slice - median_rate_family) * exposure_slice`; value = excess x average value at risk (unit cost at Tier 2; median observed proxy if available; otherwise report count only with an explicit "value unavailable")
- [ ] `python -m engine.hotspots --evidence ... --out hotspots.json`; output feeds the dashboard and eval.
- [ ] Document selection bias: in real use, "errors" are confirmed/high-confidence diagnoses, not all true errors.

**Exit test**
```bash
python -m eval.hotspots --dataset hard_dev --planted
python -m eval.hotspots --dataset null_dev --expect-zero
```
Planted worker/location hotspots are recovered at q < 0.05 with effect ratio >= 1.5; the null dataset produces zero discoveries across the full slice family; no raw worker IDs appear in output.

**Depends on:** Steps 3, 4, 7. **Unblocks:** Step 13 hotspots page, 14.

---
## 14. Step 11 - Column auto-mapping (Week 4)

**Goal:** turn renamed, malformed, mixed-format files into canonical schemas with a confirm screen, not hand edits.

**Build**
- [ ] `ingest/mapping.py`:
  - canonical fields: `txn_id`, `ts`, `item`, `location`, `qty_delta` or `qty_in`/`qty_out`, `event_type`, `doc_no`, `worker`, `shift`; counts: `count_id`, `count_ts`, `item`, `location`, `counted_qty`
  - fuzzy matching with rapidfuzz + alias dictionary (`SKU`, `Bin`, `Qty`, `Txn Date`, `Ref`, `GRN`, `receipt`, `inbound`, `pick`, `issue`, `outbound`, etc.)
  - optional LLM proposal with headers + a few masked sample rows; mask worker values and sensitive IDs; JSON-only output; deterministic temperature; cache by file hash
  - confidence per field; auto-accept >= 0.90, confirm 0.60-0.90, unmapped < 0.60
  - sign convention detector: separate in/out columns -> `qty_delta = in - out`; positive-only quantities with outbound event types -> negate; validate with the non-negative stock check
  - date parser with per-column format detection; ambiguous day/month flagged for confirmation
- [ ] `app/pages/1_Upload.py` confirm screen: pre-filled mapping, per-field confidence, sample values, editable dropdowns, confirm required before ingest.
- [ ] Fixtures with deliberately messy naming: `messy_1.csv` (renamed headers, ISO dates), `messy_2.csv` (separate in/out, DD/MM/YYYY), `messy_3.xlsx` (event aliases, mixed formats, missing doc numbers). Golden mapping files committed.
- [ ] `python -m eval.mapping --fixtures fixtures/messy_1.csv fixtures/messy_2.csv fixtures/messy_3.xlsx` for regression.

**Exit test**
```bash
pytest tests/test_mapping.py
python -m eval.mapping
```
All three messy files map to canonical schemas with zero hand edits (a confirm click is allowed); sign conventions and date parsing match golden output; LLM disabled still passes.

**Depends on:** Steps 0, 1. **Unblocks:** Step 13 upload page, Step 16 pilot run.

---

## 15. Step 12 - Narrator (Week 5)

**Goal:** a trustworthy autopsy story, with an LLM only as an optional paraphrase and a hard validator around it.

**Build**
- [ ] `narrator/templates.py`: deterministic text from evidence JSON. Sections: window, expected vs counted vs gap, value at risk (or "value unavailable"), ranked causes with evidence bullets, suggested check, abstain explanation, limitations. This is the default and always works.
- [ ] `narrator/llm.py`: optional paraphrase and Q&A adapter; prompts receive only the evidence JSON; cache by hash; no network in demo mode.
- [ ] `narrator/validator.py`:
  - extract numbers, currency, percentages, dates, SKUs, transaction/count IDs, locations, worker IDs, check IDs
  - normalize formatting (commas, `$`, `%`, date styles, rounding of confidence)
  - every entity must exist in the evidence JSON or a locked derived-value allowlist (e.g., `value_at_risk`, absolute gap, rounded confidence)
  - any mismatch -> fall back to the deterministic template and log the failure
  - sentence-level rejection is not enough; if one sentence fails, the whole LLM narrative is rejected
- [ ] `narrator/qa.py`: answer only from evidence fields; explicit `NOT_IN_EVIDENCE` response for out-of-scope questions; template fallback for common questions.
- [ ] `fixtures/hallucination_corpus.jsonl`: at least 30 deliberately wrong outputs covering wrong SKU, txn ID, count, date, location, dollar amount, percentage, digit transposition, invented worker, invented doc number, plausible-but-unsupported causal claim.
- [ ] Tests: 100% of hallucination corpus caught; every non-abstained evidence object renders; abstain renders an honest explanation; Q&A out-of-scope test set returns "not in the evidence."

**Known limitation:** the validator catches entity-level hallucination, not semantic errors that introduce no new entities. State this on the "where it breaks" slide; keep the template as the default for high-stakes display.

**Exit test**
```bash
pytest tests/test_narrator.py
```
Hallucination corpus caught 100%; template path works with the LLM disabled; evidence-only Q&A answers in-scope questions and refuses out-of-scope ones.

**Depends on:** Steps 0, 6, 9. **Unblocks:** Step 13 autopsy page.

---

## 16. Step 13 - Dashboard (Weeks 2-5, incremental)

**Goal:** a five-minute demo that shows the product, the proof, and the honesty.

**Start:** week 2 against `fixtures/evidence_fake.json`. Wire to real engine output in week 4 via `app/data_source.py`. Never block the dashboard on engine progress.

**Pages**
- **Upload:** drop file, preflight report, mapping confirm, tier badge, unavailable features.
- **Discrepancies:** table sorted by value at risk (units fallback clearly labeled), confidence, abstain flag, top cause, suggested check. Filters by location, cause, tier, abstain.
- **Autopsy:** story, ranked causes with evidence, repair detail, suggested check, correct/wrong buttons, "why I don't know" panel for abstain.
- **Hotspots:** rate charts with credible intervals, BH-significant slices, anonymized workers, counterfactual savings with assumptions shown.
- **Trust:** calibration/reliability chart, accuracy by error type, coverage-accuracy curve, baseline/ablation summary, "run `python -m eval.run_all`" status.

**Build**
- [ ] `app/data_source.py` interface: `load_evidence(run_id)`, `load_hotspots(run_id)`, `load_trust()`, `submit_feedback(discrepancy_id, cause, correct)`.
- [ ] `app/components.py`: confidence badge, abstain badge, value/units formatting, evidence bullet list, reliability and coverage charts from eval artifacts.
- [ ] Demo mode: pre-generated dataset + evidence, offline, no LLM required; a "synthetic data" banner.
- [ ] Feedback buttons write append-only labels through `engine/feedback.py`; buttons disabled if feedback loop is cut.
- [ ] Error states: missing item master, unanchored first count, zero non-abstained discrepancies, eval artifacts absent.

**Exit test**
Manual timed run: upload messy file -> confirm mapping -> discrepancies -> one autopsy -> suggested check -> one abstain case -> hotspot counterfactual -> Trust page, under 5 minutes, no manual intervention, no network.

**Depends on:** Steps 0 (start), 1/11 (upload), 7/8/9 (real data), 10 (hotspots), 14 (trust). **Unblocks:** Step 18 demo.

---

## 17. Step 14 - Evaluation harness (Weeks 3-5)

**Goal:** one command regenerates every number and chart on the results slide, including the ugly ones.

**Build**
- [ ] `python -m eval.run_all` pipeline:
  1. read seeds/manifests; generate missing datasets (dev, validation, blind easy/medium/hard)
  2. run replay + engine on each split
  3. compute detection, attribution, calibration, coverage, hotspot, and value-weighted metrics
  4. run baselines and ablations
  5. write `eval/results/<run_id>/results.json`, `RESULTS.md`, PNG charts, and `slide_numbers.md`
  6. update `eval/results/latest` pointer
- [ ] Determinism: fixed seeds, deterministic tie-breaks, no wall-clock in metrics; artifacts include git sha and package versions. Two consecutive runs must produce identical metrics.
- [ ] Metrics: top-1/top-3 per cause per difficulty (support counts), cause-set recall for multi-cause windows, detection F1, ECE/Brier, coverage-selective accuracy, hotspot recovery/null false discoveries, value-weighted recall.
- [ ] Baselines: flag-only, prior-only, raw-CSV-to-LLM (30 windows, cost-capped, cached; if no API key, report "skipped" explicitly, never fabricate).
- [ ] Ablations: uniform chance model; greedy assignment instead of ILP; no calibration; no doc-number evidence; no abstention (report only).
- [ ] Per-type table names the weakest cause with support >= 20; if all supports are thin, say so.
- [ ] `RESULTS.md` includes what the evaluation does not prove: synthetic-to-real gap, pilot limitations, partial public data.

**Exit test**
```bash
python -m eval.run_all
python -m eval.run_all
diff eval/results/latest/metrics.json eval/results/previous/metrics.json
```
Two runs from a clean data directory reproduce identical metrics; all slide numbers and charts exist; the weakest cause is named; runtime under 10 minutes on a laptop.

**Depends on:** Steps 2-10. **Unblocks:** Step 18, Step 15 reporting.

---

## 18. Step 15 - Feedback loop (Week 5)

**Goal:** learn from correct/wrong clicks without letting noisy labels poison the priors.

**Build**
- [ ] `engine/feedback.py`: append-only `data/feedback.jsonl` events (`discrepancy_id`, displayed cause, label cause or "not sure", context bucket, timestamp); counts recomputed from the log on load for auditability.
- [ ] Update rule: chosen label increments the Beta/Dirichlet count for that cause in its context bucket; blend with the global prior with strength `K` (start 10); cap influence per slice; no update on "not sure."
- [ ] Wire dashboard buttons: "Correct" confirms displayed cause; "Wrong" requires choosing the actual cause or "not sure."
- [ ] `eval/feedback_sim.py`: fixed evaluation set; 5 rounds x 20 labels sampled from validation; labels 80% reliable (20% flipped to a random other cause); plot accuracy per round across 5 simulation seeds.
- [ ] Report honest outcome: if the gain is small, write why (strong prior, sparse context buckets, label noise).

**Exit test**
```bash
python -m eval.feedback_sim
```
A chart and table exist. Success target: round-5 accuracy exceeds round-1 in at least 3 of 5 simulation seeds. If not, the write-up explicitly says the gain was small and why; do not hide it.

**Depends on:** Steps 7, 8, 13. **Cuttable:** yes, third in the cut order.

---
<!-- APPEND -->
