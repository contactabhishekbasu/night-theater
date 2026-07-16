# Quality-Model Evaluation Protocol v2 (frozen)

This is the evaluation contract the retraining orchestrator waits on. It is frozen:
once a cycle is logged under v2, the splits, metrics, baselines and gates below are
what "the numbers" mean. Changing any of them is a new protocol version (v3), a
schema bump, and a cycle-history discontinuity note in `docs/MODEL.md`.

Implemented in `scripts/ml_features.py` (`_load_table`, `grouped_random_auc`,
`bootstrap_auc_brier_ci`, `reliability_curve`, `_log_training_cycle`). Every claim
here is exercised by `tests/test_ml_eval.py`.

The question the model answers: **is this photometric reduction usable for
submission?** Positive = `ACCURATE`/`MARGINAL`/human-`approved`; negative =
`INACCURATE`/`NON-DETECTION`/`RUN-FAILED`/human-`rejected`/`NOISY-CONSISTENT`
(consistent-with-published but too noisy to submit is still a reject). The model
only sharpens the RECOMMEND line in a dossier. It never approves anything.

## 1. Splits

Two cross-validations are run every cycle and both AUCs are logged. Both use
**pooled out-of-fold (OOF) probabilities** — a single AUC computed over the
concatenated held-out predictions — not the mean of per-fold AUCs. Pooling is
required because grouped folds routinely produce a single-class test fold (some
targets are entirely negative), which makes a per-fold `roc_auc` undefined.

- **Random** — `StratifiedKFold(5)`, `shuffle=True`, `random_state=42`.
  `cv_auc_random`. Folds re-split down to `min(5, n_pos, n_neg)` if a class is small.
- **Grouped** — `GroupKFold(k)`, `k = min(5, n_unique_targets)`, groups = the
  `target` column. `cv_auc_grouped`. **This is the headline number.**
- `cv_auc_gap = cv_auc_random − cv_auc_grouped` is the **target-leakage estimate**:
  how much apparent skill comes from having seen the same target on both sides of the
  split. A large gap means the model is memorising per-target quirks (a given star's
  crowding, its typical airmass track) rather than learning transferable quality.

`cv_auc_mean ± cv_auc_std` (per-fold stratified) are still logged for continuity with
cycles 1–3, but they are not the headline.

### Why group on target

The pipeline observes the same handful of targets many times (MicroObservatory
archive nights per star). Nights of one target share instrument, field crowding,
comparison-star set and observing geometry. A random split leaks all of that: the
model can key on "this looks like a HAT-P-32 night" instead of "this reduction is
clean." Real deployment is always a *new* night, often a *new* target (and, from P4,
a new instrument). Grouped CV is the closest offline estimate of that. When the
positive count and target diversity allow it, group on `(target, instrument)` — for
now instrument is single-valued (MicroObservatory), so `target` is the grouping key.

## 2. Metrics logged every cycle → `data/results/model-metrics.csv`

Canonical header: `CANONICAL_METRIC_COLS` in `ml_features.py`.

**Dataset version & health**
- `schema_version` (currently 2), `n_train`, `n_pos`, `positive_rate`
- `n_rows_dropped_nan` — labeled rows dropped because *every* feature was NaN
  (nothing to impute from). All other NaNs are median-imputed in-pipeline, not dropped.
- `dataset_sha256` — SHA-256 over a canonical serialization of the exact
  (features, label, group, run_id) rows used. Two cycles with the same hash trained on
  the same data; a changed hash proves the training set moved.

**Discrimination** — `cv_auc_random`, `cv_auc_grouped` (headline), `cv_auc_gap`,
and the bootstrap CI `auc_grouped_ci_lo/hi`.

**Calibration** — `brier` (+ `brier_ci_lo/hi`), and `ece` computed on a **3-bin**
equal-width reliability curve (`ece_bins=3`). Three bins, not ten: at n<100 a 10-bin
curve is mostly empty and its ECE is noise. `ece_note` records the bin count and that
this is **not comparable to the 10-bin ECE of cycles 1–3**. The full reliability
curve (bin edges, predicted mean, observed frequency, count per bin) is written to
`data/results/calibration/<cycle_utc>.json`.

**Uncertainty** — 95% CIs on grouped AUC and Brier from a **stratified bootstrap**,
1000 resamples, resampling within each class so both classes are present in every
replicate (AUC always defined) and the class balance is preserved.

**Baselines** (§3) — `baseline_majority_auc`, `baseline_scatter_auc`,
`baseline_best_feature` (+ `_auc`), `baseline_rules_auc`.

**Decision behaviour at working thresholds** (from grouped OOF probabilities;
asymmetric by design — reject liberally, pass rarely): `reject_rate`,
`reject_precision` (of runs flagged p<0.35, fraction truly bad),
`screen_pass_rate` (p>0.90). Thresholds: `REJECT_THRESH=0.35`, `SCREEN_THRESH=0.90`.

**Per-feature imputed fraction** — logged to the per-cycle calibration JSON
(`imputed_fraction`), so a feature quietly going all-NaN (a broken emitter) is visible.

## 3. Baselines — the model must beat these to earn its place

Logged every cycle so "AUC 0.88" is never read in a vacuum:

- **Majority class** — constant predictor, AUC = 0.5 by definition. The discrimination floor.
- **Best single feature (by CV)** — each feature used raw as the score, best
  orientation; the highest AUC and its feature name are logged. If the model does not
  clear the best single feature, it is adding cost without adding skill.
- **`scatter_pct` threshold** — the single most interpretable quality cut, logged by
  name every cycle for continuity even when it is not the best feature.
- **Incumbent rules** — `rule_score()` mapped to a ranker (score = −number-of-reasons).
  **Asymmetry, stated up front:** the rule scorer legitimately consults `dur_z` (an
  excluded column) because it is the deterministic incumbent we are trying to beat,
  not a leakage-free learner. So `baseline_rules_auc` can look strong for a reason the
  model is forbidden to use. Read it as "the bar the rules already clear," not as an
  apples-to-apples model comparison. Until the model beats the rules on **grouped**
  AUC without the excluded columns, the rules stay authoritative in dossiers.

## 4. Leakage policy

**Excluded from features (`EXCLUDED_COLS`): `rprs_z`, `dur_z`, `oc_minutes`,
`oc_sigma`.** The benchmark verdict — the training label — is computed *directly*
from these in `scripts/mo_benchmark.py` (`ACCURATE` iff `rprs_z≤2 ∧ dur_z≤2 ∧
oc_sigma≤2`, and so on). Feeding them back in would let the model predict the label
from its own definition: trivially high AUC, zero real skill. This is direct label
leakage and is the first thing to check if an AUC looks too good.

`cv_auc_gap` guards the subtler kind — features that are innocuous per row but encode
target identity. Keep the gap small; investigate any cycle where it widens.

Coverage note: `coverage_frac` is derived only from our own observed orbital phase and
our own transit model in the light-curve artifact (see `_coverage_from_lightcurve`),
never from published values, so it is a legitimate non-leaky observational feature even
though it correlates with the partial-coverage trap that `dur_z` also flags.

## 5. When retraining is allowed

A v2 cycle may be logged only when **both** hold:

1. **≥ 25 positives** in the trainable set (`n_pos ≥ 25`). Below that, calibration is
   mush and grouped AUC swings wildly; rules stay authoritative and the model is not
   retrained.
2. **All baselines logged** — majority, best-single-feature, `scatter_pct`, and rules
   AUC all present in the cycle row. A cycle without its baselines is not interpretable
   and does not count.

Hard refusals in `train()` before any model is touched:
- **Schema drift** — any `FEATURE_COLS` entry missing from `run-features.csv` →
  `SchemaError`, refuse (rebuild first). Mirrors the benchmark.csv drift lesson.
- **< 30 labeled rows** → refuse, rules only.
- **< 5 in either class** → refuse (cannot calibrate honestly).

The P4-trust gate (before the model's RECOMMEND carries weight on real Seestar data,
still never as an approval gate) is stricter and lives in `docs/MODEL.md`: ECE < 0.10,
≥ 25 positives, and stable grouped AUC across ≥ 3 consecutive cycles.

## 6. Reproducibility

Fixed seeds throughout (`random_state=42`, bootstrap `seed=42`). `dataset_sha256`
pins the exact rows. The per-cycle JSON plus the metrics row let any cycle be
reconstructed and compared. Each cycle is also appended to the hash-chained audit log
(`actor="model"`, `action="training-cycle"`).
