# Offline demo

1. Start `python -m app.Home` and open the dashboard. Use the synthetic demo for engine-generated results.
2. In Upload data, choose `fixtures/messy_3.xlsx`, inspect columns, confirm date order, and replay. Review the tier, warnings and dropped rows.
3. Open Discrepancies and inspect a case. Expand a proposed repair, look at its source transaction, and follow the recommended check.
4. Filter to an unanchored result and show why the first count needs a prior count.
5. Open the synthetic demo again from Upload data. Open Hotspots and review the estimated rates, intervals, and assumptions used for the counterfactual.
6. Open Trust & evaluation for the latest run's accuracy, calibration and coverage, including missed benchmark gates.

## Where it breaks

- Offsetting errors can cancel and create a zero gap.
- Missing movements can be indistinguishable from residual shrink without independent evidence.
- The first count needs an earlier anchor.
- A recount can confirm a wrong count. Changing a count can alter the following replay window.
- Two causes affecting one transaction can be indistinguishable.
- Missing item master data limits pack-size checks and value estimates.
- Day-only timestamps cannot support precise cutoff checks.
- The optional narrator validation checks literal entities. Semantic mistakes can preserve the same entities.
- Synthetic accuracy is measured on generated warehouses. Partial retail data still uses simulated warehouse counts.

With Playwright and its Chromium support installed, run `python -m scripts.rehearse_demo` against the running local app. Each rehearsal opens a clean browser context. The fifth writes a backup recording under `data/demo/`.

## Offline mapping and reset

Upload `demo/messy_movements.csv` and `demo/messy_counts.csv` to try column inspection. When `OPENAI_API_KEY` is set, the optional mapper sends headers and cell types and stores validated mappings in `demo/mapping_cache.json`. A matching file reuses the cached result. Set `AUTOPSY_LLM_MAPPING=0` to skip API requests. Cache misses use deterministic mapping.

Run `python -m engine.reset_demo` to back up the local feedback logs to `demo/feedback_backup.json` and clear the labels used to adjust priors. Existing analysis runs keep their original results. Replay a new upload to use the initial priors.
