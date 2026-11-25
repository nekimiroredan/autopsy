# Evaluation protocol

Development seeds are 1000–1099 and validation uses 2000–2099. Each split runs an equal rotation of easy, medium and hard. The generator/evaluation owner keeps blind seeds separate until the model is frozen. Evaluation code calls the engine through its public interface and returns aggregate statistics. An application demo dataset does not qualify as evaluation data.

Easy uses isolated errors and healthy metadata. Medium combines isolated and overlapping errors with legitimate repeat picks. Hard adds an offsetting pair, cutoffs, count corrections, incomplete movement history and noisy worker and shift fields. Each injected edit is replayed in isolation and its signed effect is aligned to the observed count by count ID. Detection excludes first counts and zero net effects.

| Metric | Definition |
| --- | --- |
| Detection F1 | Harmonic mean of precision and recall on anchored window IDs with nonzero net gaps. |
| Top-1 and top-3 | Fraction of single-cause windows where the true type is in the first 1 or 3 ranked hypotheses. A missing diagnosis scores zero. |
| Cause-set recall | Mean fraction of ground-truth causes returned in the top three across multi-cause, nonzero windows. |
| Coverage | Fraction of adjudicable anchored discrepancies where the engine answers. |
| Selective accuracy | Fraction of answered single-cause windows whose selected top cause is correct. |
| ECE | Absolute bin mean confidence minus accuracy, weighted by support, over at most 15 equal-frequency bins. |
| Brier score | Mean squared error between top-1 confidence and its binary correctness. |
| Hotspot recovery | Fraction of planted location/worker slices called significant. Null false discoveries count significant slices in a null run. |
| Value-weighted recall | Value at risk across correctly attributed answered single-cause windows divided by total at-risk single-cause value. |

Reports include support by difficulty and cause, the weakest cause among those with support of at least 20, baseline and ablation deltas, and clear limitations. The raw CSV LLM baseline is skipped when unconfigured. Validation data alone may fit the calibrator and set an abstention threshold. Blind results are descriptive, including failures.
