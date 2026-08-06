/* Course content for the guided review journey. Data only — no logic.
   The block between NARRATION-JSON-START/END is parsed by
   tests/test_review_journey.py; keep it strict JSON (double quotes,
   no trailing commas, no comments inside). */
export const STEPS =
/* NARRATION-JSON-START */
[
  {
    "id": "briefing",
    "title": "The mission",
    "teach": "You are looking at one night of data for {target}, a giant planet that crosses the face of its star every {params_period} days. When it crosses, the star dims by about {computed.depth_expected_pct|1}% — that dip is what the telescope hunted for.",
    "why": "Published transit predictions go stale: tiny period errors compound over years until nobody knows when the transit starts. Small telescopes re-measuring known planets keep the clocks fresh for missions like JWST and Ariel — observing time is too expensive to waste waiting on a late transit.",
    "worry": "Nothing yet — but keep the expected dip size ({computed.depth_expected_pct|1}%) in mind. Everything that follows is the pipeline arguing that it did, or did not, see exactly that.",
    "figures": [],
    "stats": [
      {"label": "Target", "tpl": "{target}"},
      {"label": "Night", "tpl": "{night}"},
      {"label": "Expected dip", "tpl": "{computed.depth_expected_pct|1|%}"},
      {"label": "Published Rp/R*", "tpl": "{computed.rprs_published|3}"}
    ]
  },
  {
    "id": "night",
    "title": "The night",
    "teach": "The telescope — {observation.telescope} — took {observation.frames} pictures, one every {observation.cadence_s} seconds, each a {observation.exposure_s}-second exposure. This is the session's middle frame — the raw material every number downstream is squeezed from.",
    "why": "More frames before, during, and after the transit means the fit can separate the dip from the night's slow drifts (airmass range {observation.airmass_range}: the star's light crosses more atmosphere near the horizon and dims for reasons that have nothing to do with the planet).",
    "worry": "Too few frames, or frames only during the dip with no flat baseline around it — then the fit has nothing to anchor the star's normal brightness against.",
    "figures": [
      {"src": "{MIDFRAME}", "caption": "The middle frame of the session, straight from the telescope. The target star is one of the brighter points near center.", "optional": true}
    ],
    "stats": [
      {"label": "Frames", "tpl": "{observation.frames}"},
      {"label": "Exposure", "tpl": "{observation.exposure_s|0| s}"},
      {"label": "Cadence", "tpl": "{observation.cadence_s|0| s}"},
      {"label": "Airmass", "tpl": "{observation.airmass_range}"}
    ]
  },
  {
    "id": "photometry",
    "title": "From pixels to brightness",
    "teach": "The pipeline measures the target star's light inside a small aperture ({observation.aperture} px) and compares it against {observation.comps} nearby comparison stars measured the same way. The field chart shows who is who; the postage stamps show the target and one comparison star up close.",
    "why": "Clouds, haze and airmass dim every star in the field together. Dividing the target by steady neighbors cancels what the sky does and keeps what the planet does — that division is the whole trick of differential photometry.",
    "worry": "A comparison star that is itself variable, or sits near the frame edge, quietly poisons every measurement. Blended neighbors inside the aperture do the same.",
    "figures": [
      {"src": "{FIG:fig04_fov.png}", "caption": "Field of view: target and comparison stars marked.", "optional": false},
      {"src": "{FIG:fig05_obs_target.png}", "caption": "The target star, stacked over the night.", "optional": true},
      {"src": "{FIG:fig06_obs_comp.png}", "caption": "A comparison star, same treatment.", "optional": true}
    ],
    "stats": [
      {"label": "Comparison stars", "tpl": "{observation.comps}"},
      {"label": "Aperture", "tpl": "{observation.aperture} px"},
      {"label": "Annulus", "tpl": "{observation.annulus} px"},
      {"label": "Filter", "tpl": "{observation.filter}"}
    ]
  },
  {
    "id": "lightcurve",
    "title": "The light curve",
    "teach": "Every frame becomes one grey dot: the star's relative brightness through the night. Blue points are the same data binned for legibility; the red line is the transit model the fitter believes. The dip is the planet: this fit measures it at {computed.depth_fit_pct|1}% deep, against {computed.depth_expected_pct|1}% expected.",
    "why": "This single plot is the measurement. Everything else in this walkthrough is an argument about whether this curve can be trusted.",
    "worry": "Scatter ({metrics.scatter_pct|2}% here) rivaling the dip depth; a 'dip' that is one stray cloud; brightness sliding all night in one direction. Depth measured at {metrics.depth_snr|1}× the noise is the headline number — below about 3 it stops being a detection at all.",
    "figures": [
      {"src": "{FIG:fig01_lightcurve.png}", "caption": "Relative flux vs time, with the fitted transit model and residuals below.", "optional": false}
    ],
    "stats": [
      {"label": "Fitted dip", "tpl": "{computed.depth_fit_pct|1|%}"},
      {"label": "Expected dip", "tpl": "{computed.depth_expected_pct|1|%}"},
      {"label": "Scatter", "tpl": "{metrics.scatter_pct|2|%}"},
      {"label": "Depth SNR", "tpl": "{metrics.depth_snr|1}"}
    ]
  },
  {
    "id": "fit",
    "title": "Can the fit be trusted?",
    "teach": "Honest noise shrinks as you average it: bin N points and the scatter should fall like 1/√N. This plot bins the residuals at growing sizes and checks that they actually do. The red-noise factor β says how far reality deviates from that ideal — β = {metrics.beta_rednoise|2} for this night.",
    "why": "Clouds, focus drift and flickering skies produce noise that is correlated in time — it refuses to average away, and it can fake or bury a transit while looking innocent in the raw curve.",
    "worry": "β well above 1 (rule of thumb: above ~2) means the error bars are lying — the fit is more uncertain than it claims, and every downstream sigma is optimistic.",
    "figures": [
      {"src": "{FIG:fig03_rms_vs_bin.png}", "caption": "Residual RMS vs bin size; the dashed line is the 1/√N expectation for honest noise.", "optional": false}
    ],
    "stats": [
      {"label": "Red-noise β", "tpl": "{metrics.beta_rednoise|2}"},
      {"label": "Scatter", "tpl": "{metrics.scatter_pct|2|%}"},
      {"label": "χ² rescale", "tpl": "{metrics.chi2_rescale|2}"}
    ],
    "advanced": {
      "summary": "Advanced: the corner plot",
      "figure": {"src": "{FIG:fig02_corner.png}", "caption": "Every pair of fitted parameters plotted against each other. Round, single-peaked blobs mean the fitter converged on one self-consistent answer; banana shapes and multiple islands mean parameters are entangled or the answer is ambiguous.", "optional": true}
    }
  },
  {
    "id": "score",
    "title": "Scoring against publication",
    "teach": "Three checks, each in sigma — the answer's distance from the published value, measured in units of its own claimed uncertainty. Planet size: {metrics.rprs_z|2|σ}. Transit duration: {metrics.dur_z|2|σ}. Mid-transit time: {metrics.oc_sigma|2|σ} ({metrics.oc_minutes|1| min} from the predicted clock). The pipeline's rule: all three within 2σ earns ACCURATE.",
    "why": "A z-score is the fairest yardstick we have: 1σ disagreements happen all the time by chance; 3σ ones rarely. Scoring against peer-reviewed values — never against the pipeline's own opinion of itself — is what makes the verdict mean something.",
    "worry": "One check far outside 2σ while the others sit pretty: that pattern usually means a specific failure (wrong comparison star, partial transit, bad clock) rather than a bad night overall. And remember β from the last step — inflated confidence shrinks these sigmas artificially.",
    "figures": [],
    "stats": [
      {"label": "Depth z", "tpl": "{metrics.rprs_z|2|σ}"},
      {"label": "Duration z", "tpl": "{metrics.dur_z|2|σ}"},
      {"label": "Mid-time", "tpl": "{metrics.oc_sigma|2|σ}"},
      {"label": "Clock offset", "tpl": "{metrics.oc_minutes|1| min}"}
    ]
  },
  {
    "id": "clock",
    "title": "The clock",
    "teach": "This night's mid-transit time becomes one point on the target's observed-minus-calculated diagram: every known timing measurement — space telescopes, professional observatories, citizen scientists — against the published prediction. A flat line at zero means the clock still runs true.",
    "why": "Single nights are weather; the timing series is climate. Orbital decay, unseen companion planets, and simple stale ephemerides all announce themselves here first, years before any single night could prove them.",
    "worry": "A point far off the trend is usually the night's problem, not the planet's. A slow curve bending away from zero across years — that is when it gets interesting, and when humans start writing papers.",
    "figures": [
      {"src": "{OCPNG}", "caption": "All known mid-transit times for this target, observed minus calculated. Tonight is one of these points.", "optional": true}
    ],
    "stats": [
      {"label": "Tonight's offset", "tpl": "{metrics.oc_minutes|1| min}"},
      {"label": "Significance", "tpl": "{metrics.oc_sigma|2|σ}"}
    ]
  },
  {
    "id": "decision",
    "title": "Your decision",
    "teach": "You have seen everything the pipeline saw: the raw night, the photometry, the curve, the noise diagnostics, the scores, the clock. Now make the call a reviewing scientist makes: approve it as science-grade, reject it, or flag it for expert eyes.",
    "why": "In this pipeline no measurement reaches a science database without a human choosing to send it. Models rank and recommend; verdicts compare to publication; a person decides. You are practicing the exact judgment the operator exercises on every dossier.",
    "worry": "Being swayed by one pretty plot — or one ugly one. Good reviewers weigh the whole chain; the checklist below is the recap.",
    "figures": [],
    "stats": [
      {"label": "Pipeline verdict (revealed after you decide)", "tpl": "hidden"}
    ]
  }
]
/* NARRATION-JSON-END */
;
