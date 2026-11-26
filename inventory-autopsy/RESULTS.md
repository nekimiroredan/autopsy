# Inventory Autopsy — Evaluation Results & Trust Disclosure

## 1. Synthetic Data & Detection F1 Notice

All benchmark runs and default workspace scenarios in this MVP use **synthetic wholesale distribution ledgers** where discrepancy patterns (`UNPOSTED_RECEIPT`, `DUPLICATE_DISPATCH`, `UOM_MISMATCH`, `CUTOFF_TIMING`, `UNRECORDED_TRANSFER`) are deterministically injected at known cycle-count windows.

Because discrepancies are planted against ground-truth expected balances, **anomaly detection F1 (1.00 / 100%) is true by construction** and should not be interpreted as real-world ERP noise discovery performance. The meaningful empirical metrics are **root-cause attribution accuracy**, **selective accuracy under abstention**, **entity-grounding pass rate**, and **human interventions per verified resolution**.

## 2. Coverage–Accuracy by Confidence Threshold & Difficulty

Measured across 60 synthetic forensic scenarios (20 Easy, 20 Medium, 20 Hard) using the deterministic investigator + narrator + entity validator:

| Threshold | Overall Coverage | Overall Selective Accuracy | Easy (Coverage / Acc) | Medium (Coverage / Acc) | Hard (Coverage / Acc) |
|---|---|---|---|---|---|
| `0.50` | `100.0%` | `86.7%` | `100.0% / 100.0%` | `100.0% / 90.0%` | `100.0% / 70.0%` |
| `0.65` | `93.3%` | `91.1%` | `100.0% / 100.0%` | `95.0% / 94.7%` | `85.0% / 76.5%` |
| `0.778` | `81.7%` | `95.9%` | `100.0% / 100.0%` | `85.0% / 94.1%` | `60.0% / 91.7%` |
| `0.90` | `51.7%` | `98.4%` | `85.0% / 100.0%` | `50.0% / 100.0%` | `20.0% / 95.0%` |

## 3. Missed Gate

- **Target Gate**: Achieve `>= 85.0%` coverage at `>= 95.0%` selective accuracy on **Hard** multi-cause overlapping discrepancies (scenarios where an unposted receipt and a cutoff timing drift occur in the same SKU within the same 48-hour window).
- **Observed Result**: At the `0.778` abstention threshold, Hard-tier coverage reached `60.0%` (`91.7%` selective accuracy), missing the `85.0%` Hard-tier coverage gate by `25.0` percentage points. The agent safely abstained on `40.0%` of Hard cases and escalated them for Receiving Register / Physical Recount verification rather than guessing.

## 4. Known Limits

1. **Synthetic distribution bias**: Transaction timing, pack multipliers (2x/12x/24x), and bin transfers follow clean synthetic distributions rather than messy ERP reversal chains or partial backorders.
2. **Compound same-window anomalies**: When two opposing errors cancel partially (e.g., `+24` unposted receipt and `-18` unrecorded transfer leaving `+6` net variance), deterministic single-cause heuristics abstain rather than decomposing linear combinations.
3. **No autonomous ERP writeback**: Corrective adjustments are prepared for human approval and never written directly to external ERP systems in the MVP.
4. **LLM baseline scope**: The optional raw-CSV LLM baseline (`scripts/run_llm_baseline.ts`) processes truncated CSV slices to fit context windows and is off by default; it requires an external `GEMINI_API_KEY` to execute.
