# Backyard Meridian — automated citizen science, human judgment

**Live site: https://contactabhishekbasu.github.io/night-theater/**

Four pages: **[Case study](https://contactabhishekbasu.github.io/night-theater/)**
(the story) · **[Workflow](https://contactabhishekbasu.github.io/night-theater/status/)**
(what the pipeline is doing) · **[Review](https://contactabhishekbasu.github.io/night-theater/review/)**
(the human decision queue) · **[Evaluation](https://contactabhishekbasu.github.io/night-theater/eval/)**
(how well the models really perform, with honest numbers).

## What it is

A small home setup — a Seestar S50 telescope and a Mac mini in Berlin — that
turns public telescope archives and its own night captures into real, checkable
astronomy measurements. Software does all the repetitive work: finding data,
downloading, reducing, measuring, bookkeeping. A human makes every scientific
call — nothing is submitted to a science database without a person approving it.

## How it makes an impact

Exoplanet clocks drift. A planet's published transit times slowly go stale, and
the big telescopes can't re-check thousands of them. Networks like NASA
Exoplanet Watch and ExoClock depend on small telescopes re-measuring known
transits so the predictions stay fresh. This project contributes exactly that:
reduced transit measurements, timing residuals, and — when a planet's clock
looks genuinely odd (a decaying orbit, unexplained wobble) — a flag for human
follow-up. Every measurement carries provenance back to the raw frames that
produced it.

## The product problem

One person cannot reduce thousands of archive nights by hand, and full
automation cannot be trusted with scientific judgment. The design answer:
**automate the reduction, never the judgment.** The pipeline runs unattended
for days — probing archives, reducing nights, scoring results — and
concentrates the few decisions that matter (approve a result, promote a model,
submit a measurement) into a small human review queue.

## Methodology

Every night of data is judged the same way: reduce the raw frames, fit the
transit, and compare the fit to **published values** — planet-to-star radius
ratio, transit duration, and mid-time against the catalog ephemeris. A night is
**ACCURATE** when all three land within 2 sigma of publication, with honest
error inflation for correlated noise. That comparison — never a model's
opinion — is the verdict. Models only order queues and flag things for
attention.

## Pipeline

1. **Find** — two independent "oracles" (the AAVSO observation database and the
   DIY Planet Search community index) say which archive nights contain a transit.
2. **Probe** — a cheap check confirms frames really exist before spending time.
3. **Fetch & reduce** — frames are downloaded and reduced with EXOTIC, the NASA
   Exoplanet Watch tool.
4. **Score** — the fit is compared to published values and gets a verdict.
5. **Record** — every run writes a tamper-evident record: inputs, code version,
   outputs, and a hash-chained audit log.
6. **Repeat** — a supervisor keeps the loop running unattended, models retrain
   daily, ephemerides re-fit weekly. A human works the review queue.

## Validation

- **Against publication:** every verdict is a comparison to peer-reviewed
  values, never self-grading.
- **Against independent methods:** fits are cross-checked with a second,
  different fitter; timing series merge TESS space-telescope data, literature
  measurements, and community observations.
- **Against known physics:** the ephemeris watch reproduces WASP-12 b's known
  orbital decay at high significance — a built-in sanity anchor. If that ever
  disappears, the pipeline is wrong, not the planet.
- **Reproducibly:** fixed seeds, frozen dataset hashes, and append-only history
  files mean any number on the dashboard can be regenerated.

## The models

Two models, one rule: **neither is ever the judge.**

- **Grader** (post-reduction): estimates whether a finished reduction is
  science-grade, to order the human review queue. Type: gradient-boosted
  trees, retrained daily as a *watchdog* — simple transparent rules remain the
  authoritative grader until a model earns promotion.
- **Probing model** (pre-observation): estimates whether a night is worth
  attempting at all, in two stages — "will frames exist?" (an empirical rate
  table) × "will the fit be accurate?" (a regularized logistic regression).
  It runs **shadow-only**: predictions are logged, nothing is steered.

**Features** are strictly pre-outcome for each use: the grader sees light-curve
quality (scatter, depth signal-to-noise, red noise, coverage); the probing
model sees only what is knowable before observing (geometry, moon, season,
target history). Anything derived from the answer is banned as leakage.

**MLOps:** every training cycle is versioned, hashed, and logged with its
dataset fingerprint. Training never promotes. Promotion and demotion are human
acts recorded in an audit log — the previous champion was demoted when its
advantage failed to reproduce, and the transparent rules took back authority.

**Evaluation** is pre-registered and deliberately hard on the models: grouped
cross-validation (whole targets held out), confidence intervals from resampling
whole targets, and a paired promotion gate — a model becomes promotable only
when its improvement over the rules baseline clears zero across three
consecutive growing-data cycles, and then only with a human sign-off. Current
honest state: the probing model's improvement does not yet clear the gate.
The [Evaluation page](https://contactabhishekbasu.github.io/night-theater/eval/)
shows all of it.

## Review (under development)

The [Review page](https://contactabhishekbasu.github.io/night-theater/review/)
is the human side of the system: a queue of reduced nights with light curves,
quality checklists, and a representative frame from each night. Twenty worked
examples — chosen to show the range of outcomes, not the best ones — give a
cross-section of what the pipeline produces. Verdicts and model scores order
the queue; a person approves, rejects, or flags each result, and approved
results move to the (also human-gated) submission pipeline. Still evolving:
richer triage lanes and ephemeris-watch flags feeding the queue.

---

This site is a static snapshot, refreshed by automation from a private source
pipeline; methods are documented in the per-run dossiers and the Evaluation
page. Everything here is reproducible from the recorded provenance.
