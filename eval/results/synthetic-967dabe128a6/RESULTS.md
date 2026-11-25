# Autopsy evaluation

All warehouse runs here use synthetic data. Hotspot checks use fixed labeled exposure controls.
The numbers describe these benchmark distributions. A field pilot and timed human study require independent evidence.

- Anchored detection F1: 100.0%
- Top-1 accuracy: 69.0%
- Top-3 accuracy: 95.3%
- Aggregate coverage: 5.9%
- Selective accuracy: 96.4%
- Multi-cause recall: 24.6%
- Value-weighted recall: 3.1%
- ECE: 2.7% blind and 4.3% on cross-fit validation
- Brier score: 0.2053
- Weakest supported cause: miscount
- Threshold: 0.778 (precision_target)

## Per-difficulty and cause

| Difficulty | Cause | Support | Top-1 | Top-3 |
| --- | --- | ---: | ---: | ---: |
| easy | double_scan | 45 | 100.0% | 100.0% |
| easy | item_swap | 98 | 86.7% | 100.0% |
| easy | missed_scan | 43 | 74.4% | 100.0% |
| easy | qty_typo | 45 | 91.1% | 100.0% |
| easy | unit_mismatch | 42 | 78.6% | 100.0% |
| easy | wrong_location | 92 | 92.4% | 100.0% |
| hard | cutoff_timing | 46 | 60.9% | 100.0% |
| hard | double_scan | 8 | 100.0% | 100.0% |
| hard | item_swap | 34 | 67.6% | 76.5% |
| hard | miscount | 33 | 0.0% | 97.0% |
| hard | missed_scan | 9 | 33.3% | 100.0% |
| hard | qty_typo | 13 | 92.3% | 100.0% |
| hard | residual_shrink | 13 | 0.0% | 76.9% |
| hard | unit_mismatch | 14 | 78.6% | 100.0% |
| hard | wrong_location | 34 | 58.8% | 70.6% |
| medium | cutoff_timing | 60 | 60.0% | 100.0% |
| medium | double_scan | 17 | 94.1% | 100.0% |
| medium | item_swap | 50 | 76.0% | 88.0% |
| medium | miscount | 49 | 0.0% | 98.0% |
| medium | missed_scan | 20 | 90.0% | 100.0% |
| medium | qty_typo | 20 | 85.0% | 100.0% |
| medium | residual_shrink | 22 | 0.0% | 81.8% |
| medium | unit_mismatch | 18 | 94.4% | 100.0% |
| medium | wrong_location | 46 | 71.7% | 82.6% |

## Baselines

| Variant | Top-1 | Top-1 delta | Coverage | Selective accuracy |
| --- | ---: | ---: | ---: | ---: |
| prior_only | 9.0% | -60.0% | 100.0% | 9.0% |
| flag_only | 0.0% | -69.0% | 0.0% | Unavailable |
| naive | 14.1% | -54.9% | 100.0% | 14.1% |
| raw_csv_llm | Optional, run separately with python -m eval.raw_csv_llm | Unavailable | Unavailable | Unavailable |

## Ablations

| Variant | Top-1 | Top-1 delta | Coverage | Selective accuracy |
| --- | ---: | ---: | ---: | ---: |
| uniform_chance | 17.6% | -51.4% | 0.0% | Unavailable |
| greedy_assignment | 69.0% | 0.0% | 5.9% | 96.4% |
| no_doc_number | 72.0% | 3.0% | 9.5% | 87.5% |
| no_calibration | 69.0% | 0.0% | 69.6% | 70.5% |
| no_abstention | 69.0% | 0.0% | 100.0% | 69.0% |

## Gates

| Gate | Result | Measured | Target |
| --- | --- | ---: | ---: |
| easy improvement over prior only | Pass | 75.6% | 10.0% |
| hard improvement at half coverage | Missed | -1.5% | 10.0% |
| validation ECE | Pass | 4.3% | 5.0% |
| blind ECE | Pass | 2.7% | 8.0% |
| null hotspot discovery | Pass | 0 | 0 |
| planted hotspot recovery | Pass | 100.0% | 100.0% |

## Limitations

A synthetic prior can differ from a warehouse’s actual error distribution. A retail order profile supplies only popularity and order sizes; synthesized ledger observations do not provide real incident labels.
Unlogged movements and losses can be observationally indistinguishable. Offsetting errors can cancel. Time resolution and missing item master fields constrain the repair search.
Planted hotspot recovery was 100.0%; null control discoveries were 0.

## Feedback simulation

Round-five accuracy improved in 3 of 5 simulations.
Five independent noise schedules. Capped prior updates and noisy labels can limit gains on the fixed holdout.
