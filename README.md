# Autopsy

**Explain every stock discrepancy — with evidence, not guesses.**

Autopsy takes a warehouse movement log and physical counts, and answers the question every inventory controller asks: *why doesn't the system match the shelf?* For each discrepancy it produces ranked, replay-verified hypotheses (typo, missed scan, double scan, wrong location, shrink, and more), recommends the cheapest physical check that would confirm or refute the top cause, surface error hotspots, and — when the evidence is thin — says **"I don't know."**

No new hardware. No WMS migration. Just the exports you already have.

---

## Why this exists

Inventory write-offs are usually blamed on "shrink" because finding the real cause means manually replaying weeks of transactions. Most of those discrepancies have mundane, fixable causes: a quantity typo, a pack-size mismatch, a scan that was missed or duplicated, a transaction booked to the wrong bin. Distinguishing them today is slow, inconsistent, and rarely documented.

Autopsy automates the replay. Every conclusion is backed by an explicit ledger edit that makes the gap disappear when replayed — and a confidence score that is calibrated against reality.

---

## How it works

```
messy CSV/XLSX
      │
      ▼
  Ingest + preflight ──► tier detection, drops, warnings, column auto-mapping
      │
      ▼
  Replay engine ───────► expected vs counted, gap per (item, location, window)
      │
      ▼
  Repair operators ────► candidate ledger edits, one per cause, verified by replay
      │
      ▼
  Scoring ─────────────► prior × likelihood ratio with a chance model
      │
      ▼
  Global assignment ───► ILP selects one coherent repair set; abstains when unsure
      │
      ├──► Cheapest-check recommender
      ├──► Hotspot analysis
      └──► Narrator + dashboard
```

### The core loop: ledger-edit-or-die

Every hypothesis is expressed as an **explicit edit** to the movement ledger or a count — a deleted duplicate, an inserted missed scan, a corrected quantity, a swapped item or location, a booked loss. The engine applies the edit, replays the affected window, and requires the gap to close within `1e-6`. If the edit does not close the gap, the hypothesis is dead. There are no vibes-based diagnoses.

Candidates also carry a **search space** and **competing matches** count, so a hypothesis that would only be true in one of 50 possible slots is scored as weak evidence — not as a confident answer.

### Abstention is a feature

When confidence is low or the top two causes are too close, Autopsy abstains and explains why. A wrong diagnosis sends someone chasing the wrong process; "not enough evidence, here is the cheapest check that would settle it" does not. Calibration happens on validation data only, with a target selective precision of 0.90 chosen to maximize answered coverage.

### Honest degradation by tier

Every feature declares the minimum data tier it needs, and the product degrades gracefully instead of crashing:

| Tier | Data available | What unlocks |
|---|---|---|
| **Tier 0** | Counts + basic movement log | Replay, duplicates, missed scans, typos, miscounts, shrink |
| **Tier 1** | + worker, shift, doc numbers | Doc-sequence evidence, worker/shift priors and hotspots |
| **Tier 2** | + item master (cost, pack size, group, zone) | Unit-mismatch repair, value at risk in dollars, richer pair matching |

Missing fields are reported as feature unavailability — never silently upgraded or filled with invented values. Without an item master, value at risk is blank and ranking falls back to units, clearly labeled.

---

## Example: what an answer looks like

```json
{
  "id": "D-7f3a91",
  "item": "SKU123",
  "location": "B-12",
  "expected": 140,
  "counted": 40,
  "gap": -100,
  "abstain": false,
  "hypotheses": [
    {
      "cause": "qty_typo",
      "confidence": 0.71,
      "repair": {
        "ops": [
          {"op": "set_field", "txn_id": "T-8812", "field": "qty_delta", "from": 110, "to": 10}
        ]
      },
      "evidence": [
        "Receive T-8812 logged 110; setting it to 10 closes the -100 gap exactly",
        "This worker had 2 prior confirmed qty_typo labels"
      ]
    }
  ],
  "suggested_check": "Pull the receiving doc for T-8812; if it shows 10, not 110, the extra digit is confirmed"
}
```

Every number in that object is traceable to the input data or the replay, and every suggested check states the decision rule it tests.

---

## Design principles

1. **Contracts first.** Schemas, evidence JSON, and the eval protocol are locked before engine code, so ingest, dashboard, and narrator can be built in parallel.
2. **The generator and solver are adversarial.** The solver author never sees injector internals, ground-truth generation, or blind seeds. The generator/eval owner reports aggregate metrics only.
3. **Abstention is a product feature.** "I don't know" is a valid, visible output.
4. **Every number is reproducible.** Accuracy, calibration, hotspot recovery, and timing come from the eval harness — no hand-typed metrics.
5. **LLMs fail closed.** The narrator template and fuzzy column mapper work without an LLM; any LLM output that fails entity validation falls back to the deterministic path.
6. **Synthetic-to-real is disclosed.** Synthetic and partial public-data results are labeled as such in the UI and the deck.

---

## Repository layout (planned)

```
autopsy/
  schemas/       pydantic contracts, feature tiers, validation CLI
  ingest/        loaders, column auto-mapping, preflight reports
  generator/     synthetic warehouse, error injectors, ground truth
  engine/        replay, repair operators, scoring, assignment,
                 calibration, checks, hotspots, feedback
  narrator/      deterministic autopsy text, optional LLM + validator
  app/           Streamlit dashboard (Upload, Discrepancies, Autopsy,
                 Hotspots, Trust)
  eval/          one-command eval harness, metrics, baselines, ablations
  fixtures/      committed tier + messy + fake-evidence fixtures
  tests/         pytest suite
  docs/          scoring formulas, eval protocol, pilot materials
```

**Stack:** Python 3.11+, pydantic v2, pandas, numpy, scipy, scikit-learn, PuLP/CBC, Streamlit, pytest, openpyxl, rapidfuzz. No LLM on the default or demo path.

---

## Getting started (once the build lands)

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# validate the contracts
pytest tests/test_contracts.py
python -m schemas.validate fixtures/evidence_fake.json

# inspect a dataset before trusting it
python -m ingest.preflight fixtures/tier1.csv

# generate a synthetic warehouse and detect discrepancies
python -m generator.make --seed 1001 --days 30 --errors 6 --out data/gen/demo
python -m engine.replay --dataset data/gen/demo --out data/gen/demo/gaps.json

# reproduce every metric and chart
python -m eval.run_all
```

The dashboard is built fake-JSON-first and never blocked on engine progress:

```bash
streamlit run app/Home.py
```

> **Status:** this repository currently contains the [build plan](BUILD_PLAN.md). The layout and commands above describe the target implementation; nothing is shipped yet.

---

## Evaluation and trust

Nothing ships unless `python -m eval.run_all` regenerates the number that claims it. The harness reports, per cause and per difficulty:

- detection F1 on window keys, top-1/top-3 cause accuracy, cause-set recall on multi-cause windows
- coverage vs. selective accuracy (the abstention curve)
- expected calibration error (ECE) and Brier score, with reliability diagrams
- hotspot recovery and null false-discovery checks
- value-weighted recall, plus baselines (rule-based, prior-only, raw-CSV-to-LLM) and ablations (uniform chance model, greedy assignment, no calibration, no doc evidence)
- the **weakest cause**, named, including when its support is too thin to claim anything

Datasets are split into dev, validation, and blind sets, with blind seeds owned by the generator/eval lead and never read by the solver author. Two consecutive runs from a clean data directory must produce identical metrics.

### Where it breaks

Autopsy is explicit about its limits: offsetting errors can cancel to a zero gap; unlogged movements look like shrink; a first count with no anchor cannot be attributed; bad counts are only confirmable by recounting; day-only timestamps disable cutoff-timing analysis; and the LLM validator catches invented entities, not semantic errors that introduce no new entities. These limits are part of the product, not footnotes.

---

## Documentation

- [BUILD_PLAN.md](BUILD_PLAN.md) — the step-by-step build plan: contracts, gates, dependency graph, team split, and cut order
- `docs/scoring.md` — locked scoring formulas and heuristics
- `eval/protocol.md` — locked evaluation protocol, splits, difficulty definitions, metrics
- `docs/pilot/` — outreach, data request, and pilot log templates

## License

Not yet specified.
