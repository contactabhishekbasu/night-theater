/* ============================================================================
   status.js — Live Pipeline "Mission Control" (spec 2026-07-17)
   Data contract: progress.json schema v2 today, v3 additive (workers.*.steps,
   session{}, review{}, resources{disk_free_gb,film_cache_mb}, queue.items[].
   {prospect,reasons}, deadletter_stats{}, stage_budgets{}, coverage.n_pre/…,
   film_stabilized) + status/kpi-history.json. Every v3-dependent element
   degrades to a labeled placeholder until the field appears.
   Perf: high-frequency regions keep stable DOM nodes and update text/attrs in
   place; all polling is skipped while document.hidden.
   ========================================================================== */
"use strict";

const API = "http://localhost:8323";
const $ = id => document.getElementById(id);

const KNOWN_VERDICTS = new Set(
  ["ACCURATE", "MARGINAL", "NOISY-CONSISTENT", "NON-DETECTION", "INACCURATE", "RUN-FAILED"]);
const VC_LABELS = [["ACCURATE", "accurate"], ["MARGINAL", "marginal"],
  ["NOISY-CONSISTENT", "noisy-consistent"], ["NON-DETECTION", "non-detection"],
  ["INACCURATE", "inaccurate"], ["RUN-FAILED", "run-failed"]];

const esc = s => String(s ?? "").replace(/[&<>"]/g,
  c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const relAge = ms => {                               // "12s ago" / "3m ago" / "1h ago"
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.round(s / 60) + "m ago";
  if (s < 172800) return Math.round(s / 3600) + "h ago";
  return (s / 86400).toFixed(1) + "d ago";
};
const fmtDur = s => {                                // seconds → "1h 23m" / "45m" / "12s"
  if (s == null || isNaN(s)) return "—";
  s = Math.max(0, Math.round(s));
  if (s < 60) return s + "s";
  if (s < 3600) return Math.round(s / 60) + "m";
  return Math.floor(s / 3600) + "h " + Math.round((s % 3600) / 60) + "m";
};
const fmtDurShort = s => {                           // "4m 12s" style for step chips
  if (s == null || isNaN(s)) return "—";
  s = Math.max(0, Math.round(s));
  if (s < 60) return s + "s";
  if (s < 3600) return Math.floor(s / 60) + "m " + (s % 60) + "s";
  return fmtDur(s);
};
function badge(v) {                                  // verdict → always colour + text label
  if (!v) return "";
  const dv = KNOWN_VERDICTS.has(v) ? ` data-verdict="${v}"` : "";
  return `<span class="badge-verdict sm"${dv}>${esc(v)}</span>`;
}
/* "YYMMDD" → "18 Feb 2026" (2000-relative; null when not a plausible date) */
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function nightToDate(n) {
  const s = String(n ?? "");
  if (!/^\d{6}$/.test(s)) return null;
  const mm = +s.slice(2, 4), dd = +s.slice(4, 6);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return dd + " " + MON[mm - 1] + " 20" + s.slice(0, 2);
}
/* per-card night label chip: "target · night · date" (+ optional verdict badge).
   Returns "" when neither target nor night is known (graceful on old telemetry). */
function nightChip(target, night, verdict) {
  const t = target != null && String(target) !== "" ? String(target) : null;
  const n = night != null && String(night) !== "" ? String(night) : null;
  if (!t && !n) return "";
  const date = nightToDate(n);
  const parts = [];
  if (t) parts.push(`<b>${esc(t)}</b>`);
  if (n) parts.push(`<span class="nc-night">${esc(n)}</span>`);
  if (date) parts.push(`<span class="nc-date">${esc(date)}</span>`);
  return `<span class="night-chip">${parts.join('<span class="nc-sep">·</span>')}` +
         (verdict ? " " + badge(verdict) : "") + `</span>`;
}
const tgl = id => $(id).classList.toggle("open");
window.tgl = tgl;                                    // used by inline .why handlers
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const TEL3 = label => `<span class="tel3">awaiting telemetry v3${label ? " — " + label : ""}</span>`;

/* one registry of chart renderers so theme toggles / resizes can redraw.
   A data signature skips re-creating a canvas when its data hasn't changed. */
const chartRenderers = new Map();                    // key -> fn()
const chartSigs = new Map();                         // key -> last data signature
function registerChart(key, fn, sig) {
  chartRenderers.set(key, fn);
  if (sig !== undefined && chartSigs.get(key) === sig) return;   // data unchanged
  chartSigs.set(key, sig);
  fn();
}
let resizeT = null;
addEventListener("resize", () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => chartRenderers.forEach(fn => fn()), 180);
});

/* ---------- theme toggle (manual [data-theme] wins; shared with Page 2) --- */
$("themeBtn").addEventListener("click", () => {
  const root = document.documentElement;
  const cur = root.getAttribute("data-theme")
    || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  try { localStorage.setItem("theater-theme", next); } catch (e) {}
  chartRenderers.forEach(fn => fn());                // uPlot colours are read at draw time
});

/* ---------- explain layer: all .explain blocks reveal together -------------
   Retained for snapshot mode (the static capture defaults explanations ON — see
   applySnapshot). The live "Explain this page" header button was removed; the
   per-explainer ⓘ / .why toggles remain the way to open a single explanation. */
function setExplain(on, persist) {
  document.documentElement.classList.toggle("explain-open", on);
  const b = $("explainBtn");
  if (b) b.setAttribute("aria-pressed", on ? "true" : "false");
  if (persist) { try { localStorage.setItem("theater-explain", on ? "1" : "0"); } catch (e) {} }
}

/* keyboard: Enter/Space toggles a focused ".why" explainer */
document.addEventListener("keydown", e => {
  if ((e.key === "Enter" || e.key === " ") && document.activeElement?.classList.contains("why")) {
    e.preventDefault();
    document.activeElement.click();
  }
});

/* ---------- snapshot detection (publisher stamps published_utc) ----------- */
let snapshot = false;
function applySnapshot(d) {
  if (!d || !d.published_utc || snapshot) return;
  snapshot = true;
  document.documentElement.setAttribute("data-snapshot", "1");
  const el = $("snapshot-date");
  if (el) el.textContent = String(d.published_utc).slice(0, 10);
  /* snapshot honesty: no controls, explain layer defaults ON (unless the
     visitor explicitly turned it off before) */
  $("controls-section").hidden = true;
  $("controls-offline-wrap").hidden = true;
  $("dl-controls").hidden = true;
  try { if (localStorage.getItem("theater-explain") !== "0") setExplain(true, false); }
  catch (e) { setExplain(true, false); }
}

/* ---------- command bar (zone 0) ------------------------------------------ */
function miniGauge(id, pct, valTxt, level, aria) {
  const g = $(id);
  g.classList.remove("warn", "crit");
  if (level) g.classList.add(level);
  g.querySelector(".t > i").style.width = Math.max(0, Math.min(100, pct)) + "%";
  g.querySelector(".mv").textContent = valTxt;
  g.setAttribute("aria-valuenow", Math.round(pct));
  g.setAttribute("aria-valuetext", aria);
}
let lastUpdatedMs = null;                            // for the 1-s age ticker
function renderCmdbar(d) {
  const upd = new Date(d.updated_utc);
  lastUpdatedMs = upd.getTime();
  const ageMs = Date.now() - lastUpdatedMs;
  $("cb-updated").textContent = upd.toLocaleTimeString();
  $("cb-age").textContent = " · " + relAge(ageMs);
  $("strategy").textContent = d.strategy || "";

  const h = d.health || {};
  const throttled = (h.throttled || 0) > 0 || h.breaker_open;

  /* health chip: LIVE (no reason text) / DEGRADED / STALE (+reason) / SNAPSHOT */
  let state = "live", txt = "LIVE", reason = "";
  if (snapshot) {
    state = "snapshot"; txt = "SNAPSHOT";
    reason = "captured " + String(d.published_utc).slice(0, 10);
  } else if (ageMs / 60000 > 6) {
    state = "stale"; txt = "STALE";
    reason = "no update for " + relAge(ageMs).replace(" ago", "");
  } else if (throttled || (h.hiccups || 0) > 0) {
    state = "degraded"; txt = "DEGRADED";
    reason = h.breaker_open ? "breaker open"
      : (h.throttled || 0) > 0 ? "archive throttled"
      : h.hiccups + " server hiccup" + (h.hiccups > 1 ? "s" : "");
  }
  const hb = $("cb-health");
  hb.dataset.state = state;
  hb.querySelector(".led").className =
    "led " + ({live: "ok", degraded: "warn", stale: "crit", snapshot: "idle"}[state]);
  $("cb-health-txt").textContent = txt;
  const hr = $("cb-health-reason");
  hr.hidden = state === "live";
  hr.textContent = reason;
  hb.setAttribute("aria-label", "pipeline health: " + txt + (reason ? " — " + reason : ""));

  /* tranche + headline KPIs */
  const summ = d.summary || {}, k = d.kpis || {};
  const done = d.done ?? summ.done ?? 0;
  const max = d.max_runs ?? summ.max_runs;
  $("cb-done").textContent = done;
  $("cb-max").textContent = "/" + (max ?? "—");
  $("cb-tranche-bar").style.width = max ? Math.min(100, 100 * done / max) + "%" : "0%";
  const nRed = summ.n_reducers ?? (d.workers
    ? Object.values(d.workers).filter(x => x.role === "reduce").length : 0);
  const hasA = d.workers ? Object.values(d.workers).some(x => x.role === "acquire") : true;
  $("cb-workers").textContent = (hasA ? "1A+" : "") + nRed;
  const tp = k.nights_per_hour ?? summ.throughput_per_hr;
  $("cb-tp").textContent = tp != null ? tp : "—";
  const eta = k.eta_hours ?? summ.eta_hr;
  $("cb-eta").textContent = eta != null ? eta + " h" : "—";

  /* review pending = runs needing a HUMAN decision (decision lane). Prefer the live queue
     count (decision_required); auto-filed practice/spot-check/archive runs are not pending. */
  const rv = d.review || {};
  const pending = reviewFallback.pending ?? rv.pending_n;
  $("cb-review").textContent = pending != null ? pending : "—";
  const oldest = (pending && pending > 0) ? (rv.oldest_age_s ?? reviewFallback.oldest_age_s) : null;
  $("cb-review-wrap").classList.toggle("is-warn", oldest != null && oldest > 48 * 3600);
  $("cb-review-wrap").title = pending ? (oldest != null ? "oldest pending " + fmtDur(oldest) : "")
                                      : "all auto-filed — none pending";

  /* gauges: mem / cpu / disk */
  const res = d.resources || {};
  const mem = d.memory_free_pct ?? res.mem_free_pct;
  if (mem != null)
    miniGauge("cb-mem", mem, mem + "%", mem < 12 ? "crit" : mem < 25 ? "warn" : "", mem + "% memory free");
  if (res.cpu_load != null) {
    $("cb-cpu").hidden = false;
    miniGauge("cb-cpu", res.cpu_load * 100, res.cpu_load.toFixed(2),
      res.cpu_load > 1.0 ? "crit" : res.cpu_load > 0.85 ? "warn" : "",
      "CPU load " + res.cpu_load + " per core");
  } else $("cb-cpu").hidden = true;
  const diskEl = $("cb-disk");
  if (res.disk_free_gb != null) {                    // v3 field
    const pct = Math.min(100, res.disk_free_gb / 5);   // 500 GB scale for the mini bar
    miniGauge("cb-disk", pct, Math.round(res.disk_free_gb) + "G",
      res.disk_free_gb < 20 ? "crit" : res.disk_free_gb < 60 ? "warn" : "",
      res.disk_free_gb + " GB disk free");
    diskEl.title = res.film_cache_mb != null
      ? "film cache " + Math.round(res.film_cache_mb) + " MB" : "";
  } else {                                           // labeled placeholder until v3
    diskEl.querySelector(".mv").textContent = "—";
    diskEl.querySelector(".t > i").style.width = "0%";
    diskEl.title = "disk telemetry — awaiting telemetry v3";
    diskEl.setAttribute("aria-valuetext", "disk free: awaiting telemetry v3");
  }

  /* stale / breaker banner (live mode only) */
  const tb = $("top-banner");
  if (!snapshot && h.breaker_open) {
    tb.hidden = false;
    $("top-banner-text").textContent =
      "Circuit breaker open — archive throttled; the acquirer is in a global cool-off. Good nights requeue, none are dropped.";
  } else if (!snapshot && ageMs / 60000 > 6) {
    tb.hidden = false;
    $("top-banner-text").textContent =
      "Loop stale — no update for " + relAge(ageMs).replace(" ago", "") +
      "; the loop may be stuck (orchestrator restarts it).";
  } else tb.hidden = true;
}
/* 1-s ticker keeps only the tiny "Xs ago" text fresh between polls */
setInterval(() => {
  if (document.hidden || lastUpdatedMs == null || snapshot) return;
  $("cb-age").textContent = " · " + relAge(Date.now() - lastUpdatedMs);
}, 1000);

/* ---------- flow strip (zone 1) ------------------------------------------- */
function setStage(id, n, who, hot) {
  const el = $(id);
  el.querySelector(".n").textContent = n != null ? n : "—";
  el.querySelector(".who").textContent = who || "—";
  el.querySelector(".who").title = who || "";
  el.classList.toggle("hot", !!hot);
}
function renderFlow(d) {
  const q = d.queue || {};
  const dlTotal = d.deadletter_stats?.total
    ?? (Array.isArray(d.deadletter) ? d.deadletter.length : null);
  const nextT = q.items?.[0]?.target;
  setStage("st-queued", q.depth ?? d.schedule_remaining,
    (nextT ? "next: " + nextT : "") + (dlTotal ? ` · ${dlTotal} dead-lettered ↓` : ""), false);

  const ws = d.workers ? Object.values(d.workers) : [];
  const acq = ws.filter(w => w.role === "acquire" && ["plan", "probe", "walk", "fetch", "film"].includes(w.state));
  const red = ws.filter(w => w.role === "reduce" && !["idle", "retiring"].includes(w.state));
  const who = a => a.map(w => `${w.id} · ${w.target ?? "?"} ${w.night ?? ""}`).join(" · ");
  setStage("st-acq", acq.length, who(acq), acq.length > 0);
  setStage("st-red", red.length, who(red), red.length > 0);

  const scored = d.session?.scored?.length ?? d.kpis?.session_scored;
  setStage("st-scored", scored, "this session", false);

  const rv = d.review || {};
  const pending = reviewFallback.pending ?? rv.pending_n;
  const oldest = (pending && pending > 0) ? (rv.oldest_age_s ?? reviewFallback.oldest_age_s) : null;
  setStage("st-review", pending,
    pending ? (oldest != null ? "oldest " + fmtDur(oldest) + (oldest > 48 * 3600 ? " ⚠" : "") : "needs you")
            : "auto-filed — none pending", false);
  $("st-review").classList.toggle("gate", true);

  setStage("st-approved", reviewFallback.approved, "in queue", false);
}

/* ---------- worker lanes (zone 1) ------------------------------------------
   v3: workers.<id>.steps[] = ordered stepper {step,status,elapsed_s,budget_*,
   i,n,unit,metric,detail}. v2 fallback: one synthetic "now" step from the
   worker's state/progress (the schema-v1 legacyLane path is gone).
   Incremental: each lane's DOM is built once per (id + step-name signature)
   and mutated in place on every poll — no innerHTML per tick. */
const ACTIVE = new Set(["plan", "probe", "walk", "fetch", "film",
                        "inits", "align", "sample", "scoring", "score", "record"]);
const LED_MAP = {
  idle: "idle", retiring: "warn", scoring: "led-aqua", score: "led-aqua",
  plan: "active", probe: "active", walk: "active", fetch: "active", film: "active",
  inits: "active", align: "active", sample: "active", record: "active",
};
const STATE_VERB = {
  idle: "idle", retiring: "retiring", plan: "planning", probe: "probing",
  walk: "walking cadence", fetch: "downloading", film: "rendering film",
  inits: "preparing inits", align: "aligning frames", sample: "nested sampling",
  scoring: "scoring", score: "scoring", record: "recording dossier",
};
const laneRefs = new Map();                          // id -> {el, sig, refs}

function stepsOf(w) {
  if (Array.isArray(w.steps) && w.steps.length) return {steps: w.steps, v3: true};
  /* v2 fallback: synthesize a single-stage stepper from state + progress */
  const p = w.progress || {};
  return {v3: false, steps: [{
    step: w.state || "idle", status: "now",
    elapsed_s: null, i: null, n: null,
    metric: p.metric != null && p.metric !== "" ? String(p.metric) : null,
    detail: p.detail || STATE_VERB[w.state] || "",
    _pct: (typeof p.pct === "number" && !p.indet) ? p.pct : null,
    _indet: !!p.indet || typeof p.pct !== "number",
  }]};
}
function stepDom(s) {
  const el = document.createElement("div");
  el.className = "step";
  el.innerHTML = `<div class="sn"><span class="s-name"></span><span class="s-t"></span></div>
    <div class="sv"></div><div class="rail" hidden><i></i><span class="p90" hidden></span></div>`;
  return el;
}
function updateStep(el, s) {
  el.className = "step " + (s.status === "done" ? "done" : s.status === "now" ? "now" : "pend");
  el.querySelector(".s-name").textContent = s.step;
  const t = el.querySelector(".s-t");
  t.textContent = s.status === "done" ? "✓ " + fmtDurShort(s.elapsed_s)
    : s.status === "now" && s.elapsed_s != null ? fmtDurShort(s.elapsed_s) : "—";
  const sv = el.querySelector(".sv");
  let detail = s.detail || "";
  if (s.i != null && s.n != null) detail = `${s.i}/${s.n}${s.unit ? " " + s.unit : ""}` + (detail ? " · " + detail : "");
  else if (s.metric != null && s.metric !== "") detail = s.metric + (detail && detail !== s.metric ? " · " + detail : "");
  sv.textContent = detail || "—";
  sv.title = detail;
  const rail = el.querySelector(".rail");
  if (s.status !== "now") { rail.hidden = true; return; }
  rail.hidden = false;
  const over = s.budget_p90_s != null && s.elapsed_s != null && s.elapsed_s > s.budget_p90_s;
  let pct = null, p90pos = null;
  if (s._pct != null) pct = s._pct;
  else if (s.i != null && s.n) pct = s.i / s.n;
  else if (s.budget_p90_s != null && s.elapsed_s != null) {
    const span = Math.max(s.elapsed_s, s.budget_p90_s) * 1.15;
    pct = s.elapsed_s / span;
    p90pos = s.budget_p90_s / span;
  }
  rail.classList.toggle("indet", pct == null);
  rail.classList.toggle("over", over);
  rail.querySelector("i").style.width = pct != null ? Math.round(pct * 100) + "%" : "";
  const tick = rail.querySelector(".p90");
  tick.hidden = p90pos == null;
  if (p90pos != null) tick.style.left = Math.round(p90pos * 100) + "%";
}
function laneFootText(w, d, v3) {
  const bits = [];
  const sb = d.stage_budgets;
  if (sb) {
    const key = w.role === "acquire" ? "probe" : "sample";
    const b = sb[key];
    if (b) bits.push(`${key} budget: p50 ${fmtDurShort(b.p50_s)} · p90 ${fmtDurShort(b.p90_s)}`);
  } else if (w.role === "acquire" && d.kpis?.stage_medians_s) {
    const m = d.kpis.stage_medians_s;
    bits.push(["probe", "walk", "fetch"].filter(k => m[k])
      .map(k => `${k} med ${m[k]}s`).join(" · "));
  } else bits.push("budgets: awaiting telemetry v3");
  if (w.role === "acquire") {
    const h = d.health || {};
    bits.push("breaker " + (h.breaker_open ? "OPEN" : "closed") +
      (h.throttled ? ` · ${h.throttled} throttle` : " · 0 stalls"));
  } else {
    bits.push("RSS " + (w.rss_mb != null ? Math.round(w.rss_mb) + " MB" : "—"));
  }
  if (w.last_verdict) bits.push("last verdict: " + w.last_verdict);
  return bits.filter(Boolean);
}
function buildLane(w, nSteps) {
  const el = document.createElement("div");
  el.className = "lane";
  el.tabIndex = 0;
  el.setAttribute("role", "group");
  el.innerHTML = `<div class="lane-head">
      <span class="led idle" aria-hidden="true"></span>
      <span class="role-chip"></span><span class="id"></span>
      <span class="tgt"><span class="t-name"></span> <small class="t-sub"></small></span>
      <span class="meta"></span></div>
    <div class="steps"></div>
    <div class="lane-foot"></div>`;
  const stepsEl = el.querySelector(".steps");
  for (let i = 0; i < nSteps; i++) stepsEl.appendChild(stepDom());
  return el;
}
function updateLane(entry, w, d, info) {
  const {el} = entry;
  const beatAge = w.last_beat_utc ? Date.now() - Date.parse(w.last_beat_utc) : null;
  const stale = beatAge != null && beatAge > 120000 && ACTIVE.has(w.state);
  const led = stale ? "crit"
    : (d.health?.breaker_open && w.role === "acquire") ? "throttled"
    : (LED_MAP[w.state] || "idle");
  el.querySelector(".led").className = "led " + led;
  el.className = "lane " + (w.state === "idle" ? "is-idle" : w.state === "retiring" ? "is-retiring" : "");
  const chip = el.querySelector(".role-chip");
  chip.className = "role-chip " + (w.role === "acquire" ? "acquire" : "reduce");
  chip.textContent = w.role === "acquire" ? "acquire" : "reduce";
  /* primary label = stable lane slot ("R1 · W14" / "A · A1"); fall back to the
     raw worker id when workers[].lane is absent (old telemetry). */
  const lane = w.lane != null && String(w.lane) !== "" ? String(w.lane) : null;
  el.querySelector(".id").textContent = lane ? lane + " · " + w.id : w.id;
  el.querySelector(".t-name").textContent = w.target || (w.state === "idle" ? "idle — waiting for handoff" : "waiting");
  const sub = [];
  if (w.night) sub.push("night " + w.night);
  if (w.prospect != null) sub.push("prospect " + w.prospect);
  if (stale) sub.push("no heartbeat ⚠");
  el.querySelector(".t-sub").textContent = sub.join(" · ");
  const meta = [];
  if (w.uptime_s != null) meta.push("up " + fmtDur(w.uptime_s));
  if (beatAge != null) meta.push("beat " + relAge(beatAge).replace(" ago", ""));
  if (w.done_count != null) meta.push(w.done_count + " nights this session");
  el.querySelector(".meta").textContent = meta.join(" · ");
  const verb = STATE_VERB[w.state] || w.state || "idle";
  el.setAttribute("aria-label",
    `worker ${lane ? lane + " (" + w.id + ")" : w.id}: ${verb}${stale ? ", no heartbeat" : ""}` +
    (w.target ? ` on ${w.target}${w.night ? " " + w.night : ""}` : ""));

  const stepEls = el.querySelectorAll(".step");
  info.steps.forEach((s, i) => updateStep(stepEls[i], s));
  el.querySelector(".steps").hidden = w.state === "idle" && !info.v3;
  el.querySelector(".lane-foot").innerHTML =
    laneFootText(w, d, info.v3).map(t => `<span>${esc(t)}</span>`).join("");
}
function renderLanes(d) {
  const host = $("lanes");
  const ws = d.workers && typeof d.workers === "object" ? Object.values(d.workers) : [];
  ws.sort((a, b) => {                                // A first, then W1..Wn numeric
    const rank = x => x.role === "acquire" ? -1 : (parseInt(String(x.id).replace(/\D/g, "")) || 0);
    return rank(a) - rank(b);
  });
  const seen = new Set();
  for (const w of ws) {
    const info = stepsOf(w);
    const sig = (info.v3 ? "v3:" : "v2:") + info.steps.map(s => s.step).join(",");
    let entry = laneRefs.get(w.id);
    if (!entry || entry.sig !== sig) {
      const el = buildLane(w, info.steps.length);
      if (entry) entry.el.replaceWith(el); else host.appendChild(el);
      entry = {el, sig};
      laneRefs.set(w.id, entry);
    }
    updateLane(entry, w, d, info);
    seen.add(w.id);
    host.appendChild(entry.el);                      // cheap reorder, keeps refs
  }
  for (const [id, entry] of laneRefs) {
    if (!seen.has(id)) { entry.el.remove(); laneRefs.delete(id); }
  }
  const ph = $("lanes-empty");
  if (!ws.length && !ph) {
    const p = document.createElement("p");
    p.className = "detail"; p.id = "lanes-empty";
    p.textContent = "no worker telemetry — the loop has not registered workers yet";
    host.appendChild(p);
  } else if (ws.length && ph) ph.remove();
}

/* ---------- night playback (zone 2) ----------------------------------------
   No full preload: an Image cache streams ±10 frames around the playhead and
   evicts beyond ±20. Playback pauses when the card is off-viewport
   (IntersectionObserver) or the tab is hidden; prefers-reduced-motion means
   no autoplay. Stabilized|Raw toggle only if the manifest says stabilized. */
const film = {
  path: null, manifest: null, idx: 0, playing: false, timer: null,
  variant: "stab", rawMode: null,                    // "files" (raw/*.jpg) | "transform" (offsets)
  cache: new Map(),                                  // decoded Image window (±10, evict >±20)
  blobs: new Map(), blobPending: new Set(),          // compressed bytes, fetched once per frame
  visible: true, wasPlaying: false,
  lcPts: null, lcFrames: null,
};
const CACHE_AHEAD = 10, CACHE_KEEP = 20;
/* the builder may ship BOTH jpeg sets (raw/f0000.jpg) or a single stabilized
   set + per-frame dx/dy in the manifest; in the latter case the Raw view is
   reprojected client-side (translate by the measured drift — no refetch). */
const fileVariant = () => (film.variant === "raw" && film.rawMode === "files") ? "raw/" : "";
function frameSrc(i) {
  return `${film.path}${fileVariant()}f${String(i).padStart(4, "0")}.jpg`;
}
/* Each frame goes over the network AT MOST ONCE per film+variant: the ~20 KB
   compressed blob is kept for the session (a whole film is ~1–2 MB — this is
   not a decoded-frame preload). The DECODED Image cache stays windowed:
   ±10 around the playhead, evicted beyond ±20, so decode memory is bounded. */
async function fetchBlob(j) {
  const key = fileVariant() + j;
  if (film.blobs.has(key) || film.blobPending.has(key)) return;
  film.blobPending.add(key);
  const myPath = film.path;
  try {
    const r = await fetch(frameSrc(j));
    if (r.ok && film.path === myPath)
      film.blobs.set(key, URL.createObjectURL(await r.blob()));
  } catch (e) {}
  film.blobPending.delete(key);
}
const frameURL = j => film.blobs.get(fileVariant() + j) || frameSrc(j);
function clearFilmBytes() {
  for (const u of film.blobs.values()) URL.revokeObjectURL(u);
  film.blobs.clear(); film.blobPending.clear(); film.cache.clear();
}
function ensureCache() {
  if (!film.manifest) return;
  const N = film.manifest.frames.length, c = film.cache;
  const vk = fileVariant() || "stab/";               // cache keyed by the FILE set
  for (let o = -CACHE_AHEAD; o <= CACHE_AHEAD; o++) {
    const j = ((film.idx + o) % N + N) % N;
    fetchBlob(j);
    const k = vk + j;
    if (!c.has(k) && film.blobs.has(fileVariant() + j)) {
      const im = new Image(); im.src = frameURL(j); c.set(k, im);   // decode-ahead
    }
  }
  for (const k of c.keys()) {
    const j = +k.split("/")[1];
    let dist = Math.abs(j - film.idx);
    dist = Math.min(dist, N - dist);
    if (!k.startsWith(vk) || dist > CACHE_KEEP) c.delete(k);
  }
}
function showFrame(i) {
  if (!film.manifest) return;
  const N = film.manifest.frames.length;
  film.idx = ((i % N) + N) % N;
  const f = film.manifest.frames[film.idx];
  const img = $("film-frame");
  img.src = frameURL(film.idx);
  img.hidden = false;
  /* raw view from a single stabilized set: reproject the measured drift */
  if (film.variant === "raw" && film.rawMode === "transform" && (f.dx || f.dy)) {
    const scale = img.clientWidth && img.naturalWidth ? img.clientWidth / img.naturalWidth : 1;
    img.style.transform = `translate(${(f.dx * scale).toFixed(1)}px, ${(f.dy * scale).toFixed(1)}px)`;
  } else img.style.transform = "";
  $("scrub").value = film.idx;
  /* fixed two-row meta grid (frame/time/drift · ratio/mode) so the card never
     resizes as values change length; full value also lives in each cell's title */
  const modeTxt = film.manifest.stabilized
    ? (film.variant === "stab" ? "stabilized" : "raw drift") : "—";
  const ratioTxt = f.flux_ratio != null ? "target/comp " + f.flux_ratio : "—";
  const cell = (label, value) =>
    `<span class="fm-cell"><span class="fm-l">${esc(label)}</span>` +
    `<span class="fm-v" title="${esc(value)}">${esc(value)}</span></span>`;
  $("film-meta").innerHTML =
    cell("frame", `${film.idx + 1}/${N}`) +
    cell("time", `${f.t} UT`) +
    cell("drift", `dx ${f.dx} dy ${f.dy} px`) +
    cell("ratio", ratioTxt) +
    cell("mode", modeTxt);
  ensureCache();
  updatePreviewLC();
}
/* quick-look curve: full polyline built once; only the progress line mutates */
function buildPreviewLC() {
  const fr = film.manifest.frames.filter(f => f.flux_ratio);
  const svg = $("preview-lc");
  if (fr.length < 3) { svg.replaceChildren(); film.lcPts = null; return; }
  const vals = fr.map(f => f.flux_ratio);
  const lo = Math.min(...vals), hi = Math.max(...vals), rng = Math.max(hi - lo, 1e-9);
  const w = 400, h = 80, N = film.manifest.frames.length;
  film.lcFrames = fr.map(f => film.manifest.frames.indexOf(f));
  film.lcPts = fr.map((f, k) =>
    `${(film.lcFrames[k] / (N - 1)) * w},${(h - 10 - ((f.flux_ratio - lo) / rng) * (h - 22)).toFixed(1)}`);
  const NS = "http://www.w3.org/2000/svg";
  const base = document.createElementNS(NS, "polyline");
  base.setAttribute("points", film.lcPts.join(" "));
  base.setAttribute("fill", "none"); base.setAttribute("stroke", "var(--grid)");
  base.setAttribute("stroke-width", "1.4");
  const prog = document.createElementNS(NS, "polyline");
  prog.id = "lc-progress";
  prog.setAttribute("fill", "none"); prog.setAttribute("stroke", "var(--aqua)");
  prog.setAttribute("stroke-width", "2");
  const label = document.createElementNS(NS, "text");
  label.setAttribute("x", "2"); label.setAttribute("y", "12");
  label.setAttribute("fill", "var(--muted)"); label.setAttribute("font-size", "9");
  label.textContent = "quick-look target/comp ratio";
  svg.replaceChildren(base, prog, label);
}
function updatePreviewLC() {
  if (!film.lcPts) return;
  const upto = film.lcPts.filter((_, k) => film.lcFrames[k] <= film.idx);
  $("lc-progress")?.setAttribute("points", upto.length > 1 ? upto.join(" ") : "");
}
function play(on) {
  film.playing = on;
  $("play").textContent = on ? "⏸" : "▶";
  $("play").setAttribute("aria-label", on ? "Pause playback" : "Play playback");
  clearInterval(film.timer);
  film.timer = null;
  if (on) {
    const fps = +$("speed").value;
    film.timer = setInterval(() => {
      if (document.hidden || !film.visible) return;  // paused off-screen / hidden tab
      showFrame(film.idx + 1);
    }, 1000 / fps);
  }
}
async function loadFilm(path) {
  if (film.path === path) return;
  clearFilmBytes();                                  // free the previous night's bytes
  film.path = path; film.idx = 0; film.variant = "stab";
  film.lcPts = null;
  clearInterval(film.timer); film.playing = false;
  try { film.manifest = await (await fetch(path + "manifest.json?" + Date.now())).json(); }
  catch (e) {                                          // film unreachable (public snapshot)
    film.manifest = null;
    showMidframe(nightOf(lastProgress));
    return;
  }
  const N = film.manifest.frames.length;
  $("scrub").max = N - 1;
  $("theater-controls").hidden = false;
  $("preview-note").textContent = film.manifest.note || "";
  /* Stabilized|Raw toggle only when the film ships a stabilized variant
     (manifest.stabilized; progress.film_stabilized accepted as a v3 hint
     when the manifest predates the flag) */
  const hasStab = film.manifest.stabilized === true ||
    (film.manifest.stabilized == null && lastProgress?.film_stabilized === true);
  $("film-variant").hidden = !hasStab;
  if (!hasStab) film.variant = "stab";               // single set on disk, default names
  else {
    /* builder's choice: raw/*.jpg second set (manifest must say so) or a single
       stabilized set + per-frame offsets (default — reprojected, no refetch) */
    film.rawMode = (film.manifest.raw_files === true ||
      (Array.isArray(film.manifest.variants) && film.manifest.variants.includes("raw")))
      ? "files" : "transform";
  }
  setVariantUI();
  buildPreviewLC();
  showFrame(0);
  if (!reduceMotion()) play(true);                   // respect prefers-reduced-motion
}
/* ---------- public-snapshot fallback: ONE mid frame -------------------------
   status/film/ never publishes (publish_site.py excludes it and strips
   progress.film), so on the static snapshot there is no film to play. Instead of
   an empty stage, show the single mid-transit JPEG scripts/midframes.py extracts
   per night (status/midframes/<night>.jpg) — a picture of the night, never a
   measurement. Private behaviour is untouched: this runs only when there is no
   film, and both handlers bail the moment a real manifest is loaded. */
function nightOf(d) {
  const RN = (d && d.reduced_night) || null;
  const sc = (RN && RN.science_card) || (d && d.science_card) || {};
  return (RN && RN.night) || sc.night || (d && d.film_night) || null;
}
const MIDFRAME_NOTE = "mid-transit frame — one representative frame from this " +
  "night; the frame-by-frame film stays on the private dashboard";
function showMidframe(night) {
  const img = $("film-frame");
  if (!img || night == null || night === "") return;
  const src = "./midframes/" + encodeURIComponent(String(night)) + ".jpg";
  if (img.dataset.mid === src) return;                 // already showing this night
  img.dataset.mid = src;
  img.alt = "mid-transit frame from night " + night;
  img.style.transform = "";
  img.onload = () => {
    if (film.manifest) return;                         // a real film took over — leave it alone
    img.hidden = false;
    $("preview-note").textContent = MIDFRAME_NOTE;
  };
  img.onerror = () => {                                // no mid frame for this night
    if (film.manifest) return;
    img.hidden = true;
    $("preview-note").textContent = "";
  };
  img.src = src;
  $("theater-controls").hidden = true;                 // nothing to scrub — a still
}
function setVariantUI() {
  $("film-variant").querySelectorAll("button").forEach(b => {
    const on = b.dataset.v === film.variant;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
}
$("film-variant").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b || b.dataset.v === film.variant) return;
  film.variant = b.dataset.v;
  setVariantUI();
  ensureCache();                                     // warm the new variant window
  showFrame(film.idx);                               // no full-film refetch
});
$("play").onclick = () => play(!film.playing);
$("scrub").oninput = e => { play(false); showFrame(+e.target.value); };
$("speed").onchange = () => film.playing && play(true);
new IntersectionObserver(entries => {
  const vis = entries[0].isIntersecting;
  if (!vis && film.playing) { film.wasPlaying = true; play(false); }
  else if (vis && film.wasPlaying && !reduceMotion()) { film.wasPlaying = false; play(true); }
  film.visible = vis;
}, {threshold: 0.05}).observe($("film-card"));
document.addEventListener("visibilitychange", () => {
  if (document.hidden && film.playing) { film.wasPlaying = true; play(false); }
  else if (!document.hidden && film.wasPlaying && !reduceMotion()) { film.wasPlaying = false; play(true); }
  if (!document.hidden) refresh();                   // catch up immediately on return
});

/* ---------- transit coverage (bespoke SVG, zone 2) ------------------------- */
function covLine(x1, y1, x2, y2, stroke, sw) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw || 1}"/>`;
}
function renderCoverage(d) {
  const c = d.reduced_night?.coverage || d.coverage;   // reduced-night bundle first, legacy fallback
  if (!c?.frames) return;
  const w = 400, bandY = 30, bandH = 22;
  const nPre = c.n_pre ?? c.frames.filter(f => f < c.ingress).length;
  const nIn  = c.n_in  ?? c.frames.filter(f => f >= c.ingress && f <= c.egress).length;
  const nPost= c.n_post?? c.frames.filter(f => f > c.egress).length;
  const utc = s => { const m = String(s || "").match(/(\d{1,2}:\d{2})/); return m ? m[1] : null; };  // "hh:mm" from "06:01" or ISO
  const tIn = utc(c.ingress_utc), tMid = utc(c.mid_utc), tEg = utc(c.egress_utc);
  let svg = `<rect x="0" y="${bandY}" width="${w}" height="${bandH}" fill="var(--grid)" rx="3"/>
    <rect x="${(c.ingress * w).toFixed(1)}" y="${bandY}" width="${Math.max((c.egress - c.ingress) * w, 1).toFixed(1)}"
     height="${bandH}" fill="var(--blue)" opacity="0.28"/>` +
    covLine(c.ingress * w, bandY - 6, c.ingress * w, bandY + bandH + 6, "var(--blue)") +
    covLine(c.egress * w, bandY - 6, c.egress * w, bandY + bandH + 6, "var(--blue)") +
    covLine(c.mid * w, bandY - 10, c.mid * w, bandY + bandH + 6, "var(--blue)", 1.6);
  const anchor = f => f < 0.12 ? "start" : f > 0.88 ? "end" : "middle";
  svg += `<text x="${c.ingress * w}" y="16" fill="var(--blue)" font-size="8.5" text-anchor="${anchor(c.ingress)}">ingress${tIn ? " " + tIn : ""}</text>
    <text x="${c.mid * w}" y="8" fill="var(--blue)" font-size="8.5" text-anchor="${anchor(c.mid)}">predicted mid${tMid ? " " + tMid + " UT" : ""}</text>
    <text x="${c.egress * w}" y="16" fill="var(--blue)" font-size="8.5" text-anchor="${anchor(c.egress)}">egress${tEg ? " " + tEg : ""}</text>`;
  /* frame ticks: aqua inside the predicted band, muted outside */
  let inTicks = "", outTicks = "";
  c.frames.forEach(f => {
    const x = (f * w).toFixed(1);
    const t = `<line x1="${x}" y1="${bandY + 3}" x2="${x}" y2="${bandY + bandH - 3}"/>`;
    if (f >= c.ingress && f <= c.egress) inTicks += t; else outTicks += t;
  });
  svg += `<g stroke="var(--aqua)" stroke-width="1.4">${inTicks}</g>
          <g stroke="var(--muted)" stroke-width="1.4">${outTicks}</g>`;
  /* UT axis from the *_utc fields — plain "hh:mm" same-night times, so anchor on
     minutes-of-day: phase 0 sits ingress·span before the ingress time. */
  const hm2min = s => { const m = String(s || "").match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
  const inMin = hm2min(c.ingress_utc);
  const t0min = (inMin != null && c.span_hours) ? inMin - c.ingress * c.span_hours * 60 : null;
  const fmtMin = m => { const x = ((Math.round(m) % 1440) + 1440) % 1440;
    return String(Math.floor(x / 60)).padStart(2, "0") + ":" + String(x % 60).padStart(2, "0"); };
  if (t0min != null && c.dawn_utc) {                 // dawn marker (v3 dawn_utc)
    const dMin = hm2min(c.dawn_utc);
    let df = dMin != null ? (dMin - t0min) / (c.span_hours * 60) : null;
    if (df != null && df < -0.02) df += 1440 / (c.span_hours * 60);   // wrap past midnight
    if (df != null && df >= 0 && df <= 1.02) {
      const dx = Math.min(df, 1) * w;
      svg += covLine(dx, bandY - 6, dx, bandY + bandH + 6, "var(--warn)", 1.4) +
        `<text x="${dx}" y="${bandY + bandH + 16}" fill="var(--warn-txt)" font-size="8.5"
          text-anchor="${anchor(df)}">dawn ${utc(c.dawn_utc)}</text>`;
    }
  }
  svg += covLine(0, 62, w, 62, "var(--grid)");
  let axis = "";
  if (t0min != null) {
    for (let qi = 0; qi <= 4; qi++) {
      const x = qi * w / 4;
      axis += `<text x="${x}" y="74" text-anchor="${qi === 0 ? "start" : qi === 4 ? "end" : "middle"}">${fmtMin(t0min + (qi / 4) * c.span_hours * 60)}</text>`;
    }
    axis += `<text x="${w}" y="86" text-anchor="end">UT</text>`;
  } else {
    for (let qi = 0; qi <= 4; qi++)
      axis += `<text x="${qi * w / 4}" y="74" text-anchor="${qi === 0 ? "start" : qi === 4 ? "end" : "middle"}">${(qi / 4 * (c.span_hours || 0)).toFixed(1)}h</text>`;
    axis += `<text x="${w}" y="86" text-anchor="end">UT axis — awaiting telemetry v3</text>`;
  }
  svg += `<g fill="var(--muted)" font-size="8.5">${axis}</g>`;
  /* before / during / after coverage verdict line */
  const seg = (n, lab) => n > 2 ? [`${lab} ${n} ✓`, "var(--aqua-txt)"] : [`${lab} ${n} — thin ⚠`, "var(--warn-txt)"];
  const [preT, preC] = seg(nPre, "before"), [inT, inC] = seg(nIn, "during"), [postT, postC] = seg(nPost, "after");
  svg += `<g font-size="9.5">
    <text x="0" y="96" fill="${preC}">${preT}</text>
    <text x="118" y="96" fill="${inC}">${inT}</text>
    <text x="236" y="96" fill="${postC}">${postT}</text>
    <text x="${w}" y="96" fill="var(--sec)" text-anchor="end">${c.frames.length} frames · ${c.span_hours} h</text></g>`;
  $("coverage").innerHTML = svg;                     // static-template SVG, numeric data only
  $("coverage-note").textContent =
    `${c.frames.length} frames over ${c.span_hours} h · before ${nPre} · during ${nIn} · after ${nPost}` +
    (c.n_pre == null ? " (counts derived client-side until telemetry v3)" : "");
}

/* ---------- frame quality (uPlot, zone 2) ---------------------------------- */
const SAT_ADU = 4095;
/* per-frame health ribbon — one cell per frame, from EXOTIC's own per-frame ledger
   (reduced_night.frame_health). "used" = the frame EXOTIC kept in the final light curve;
   "saturated" is judged on the TARGET's raw aperture peak vs the sensor ceiling, NOT the
   whole-frame max (a bright field star or hot pixel would falsely rail every frame). The
   ribbon is present only for a reduced night — during acquisition target health is
   unknowable, so it stays hidden rather than guessing. */
const REASON_LABEL = {align: "align failed", fits: "corrupt FITS", lowflux: "target fit failed",
  offframe: "target off-frame", skybg: "sky-bg failed", comp: "comp-star bad", clipped: "outlier-clipped"};
function renderFrameHealth(fh) {
  const el = $("frame-health");
  if (!el) return;
  const F = fh && fh.frames;
  if (!F || F.length < 3) { el.innerHTML = ""; return; }   // live/legacy night → hide, don't lie
  const C = fh.ceiling || SAT_ADU;
  const used = fh.n_used != null ? fh.n_used : F.filter(f => f.used).length;
  const total = fh.n_total != null ? fh.n_total : F.length;
  const isSat = f => f.peak != null && f.peak >= C;
  const sat = F.filter(f => f.used && isSat(f)).length;            // kept a saturated frame
  const clipped = F.filter(f => f.reason === "clipped").length;
  const rejected = F.filter(f => !f.used && f.reason !== "clipped").length;
  const cellCls = f => !f.used ? (f.reason === "clipped" ? "clip" : "rej")
    : isSat(f) ? "sat" : (f.peak != null && f.peak >= 0.9 * C) ? "near" : "ok";
  const cells = F.map(f => {
    const pk = f.peak != null ? ` · target peak ${f.peak} ADU` : "";
    const st = f.used ? "used" : (REASON_LABEL[f.reason] || "rejected");
    return `<i class="fh-cell ${cellCls(f)}" title="${esc(f.t)} · ${st}${pk}"></i>`;
  }).join("");
  const bits = [];
  if (clipped) bits.push(`${clipped} outlier-clipped`);
  if (rejected) bits.push(`<span class="fh-warn">${rejected} rejected</span>`);
  if (sat) bits.push(`<span class="fh-warn">${sat} target-saturated</span>`);
  el.innerHTML =
    `<div class="fh-head">Frame health — <b>${used}/${total}</b> used for photometry` +
    `${bits.length ? " · " + bits.join(" · ") : ""}</div>` +
    `<div class="fh-strip" role="img" aria-label="${used} of ${total} frames used, ${sat} target-saturated, ${clipped} outlier-clipped">${cells}</div>` +
    `<div class="fh-legend"><span><i class="fh-cell ok"></i>used</span>` +
    `<span><i class="fh-cell clip"></i>outlier-clipped</span>` +
    `<span><i class="fh-cell rej"></i>rejected</span>` +
    `<span><i class="fh-cell sat"></i>target-saturated (&ge; ${C} ADU)</span></div>`;
}
function renderQuality(d) {
  const q = d.reduced_night?.quality_strip || d.quality_strip;   // reduced-night bundle first
  const el = $("quality-chart");
  renderFrameHealth(d.reduced_night?.frame_health);  // EXOTIC per-frame ledger (reduced night only)
  const qSig = q && q.length ? q.length + ":" + q[q.length - 1].t : "none";
  registerChart("quality", () => {
    el.replaceChildren();
    if (!q || q.length < 3) {
      el.innerHTML = `<span class="tel3">no frame-quality telemetry for this night yet</span>`;
      return;
    }
    const xs = q.map((_, i) => i);
    const sky = q.map(p => p.sky), peak = q.map(p => p.peak);
    const mono = cssVar("--font-data").split(",")[0] || "monospace";
    /* two y-scales: sky (~350 ADU) and peak (~4095) crush each other on one linear
       axis — the sky series rendered as a flat line ("missing data" report) */
    const skyLo = Math.min(...sky), skyHi = Math.max(...sky), pad = Math.max(4, (skyHi - skyLo) * 0.15);
    const u = new uPlot({
      width: el.clientWidth || 380, height: 150,
      cursor: {show: false}, legend: {show: false}, pxAlign: false,
      scales: {x: {time: false},
               sky: {range: [skyLo - pad, skyHi + pad]},
               peak: {range: [0, SAT_ADU * 1.12]}},
      axes: [
        {show: false},
        {scale: "sky", stroke: cssVar("--muted"), grid: {stroke: cssVar("--grid"), width: 1},
         ticks: {show: false}, size: 44, font: "10px " + mono},
      ],
      series: [
        {},
        {scale: "sky", stroke: cssVar("--aqua"), width: 1.8, points: {show: false}},
        {scale: "peak", stroke: cssVar("--muted"), width: 1.2, dash: [3, 4], points: {show: false}},
      ],
      hooks: {draw: [u => {                          // saturation-ceiling annotation
        const ctx = u.ctx, yPix = u.valToPos(SAT_ADU, "peak", true);
        ctx.save();
        ctx.strokeStyle = cssVar("--crit"); ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(u.bbox.left, yPix); ctx.lineTo(u.bbox.left + u.bbox.width, yPix);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = cssVar("--crit-txt");
        ctx.font = (10 * devicePixelRatio) + "px " + mono;
        ctx.textAlign = "right";
        ctx.fillText("sensor max " + SAT_ADU + " ADU", u.bbox.left + u.bbox.width - 4, yPix - 5 * devicePixelRatio);
        ctx.restore();
      }]},
    }, [xs, sky, peak], el);
  }, qSig);
  if (!q || q.length < 3) { $("quality-legend").innerHTML = ""; return; }
  const lo = Math.min(...q.map(p => p.sky)), hi = Math.max(...q.map(p => p.sky));
  const pk = Math.max(...q.map(p => p.peak));
  const cov = d.reduced_night?.coverage || d.coverage;
  const dawn = cov?.dawn_utc ? ` · dawn limit ${String(cov.dawn_utc).slice(11, 16)} UT` : "";
  $("quality-legend").innerHTML =
    `<span><i style="background:var(--aqua)"></i>sky ${Math.round(lo)}→${Math.round(hi)} ADU</span>` +
    `<span><i style="background:var(--muted)"></i>whole-frame peak ADU (acquisition) · max ${pk}${pk >= SAT_ADU ? " — a pixel at ceiling" : ""}</span>` +
    (dawn ? `<span style="color:var(--warn-txt)">${esc(dawn.slice(3))}</span>` : "");
}

/* ---------- control channel (zone 3 — live only) ----------------------------
   GET /api/control on load + after each progress poll; POST partial dicts.
   Every button is two-step (armed confirm, 5 s timeout). The whole section is
   hidden on snapshot, or replaced by a "controls offline" note when the GET
   fails (review_server down / control API not yet deployed). */
const ctl = {available: false, state: {}, seq: null};
let armedBtn = null, armTimer = null;
function disarm() {
  clearTimeout(armTimer); armTimer = null;
  if (armedBtn) {
    armedBtn.classList.remove("armed");
    if (armedBtn.dataset.label) armedBtn.textContent = armedBtn.dataset.label;
    armedBtn = null;
  }
}
function armThen(btn, fn, confirmTxt) {
  if (armedBtn === btn) { disarm(); fn(); return; }
  disarm();
  armedBtn = btn;
  btn.dataset.label = btn.textContent;
  btn.classList.add("armed");
  btn.textContent = confirmTxt || "Confirm?";
  armTimer = setTimeout(disarm, 5000);
}
function ctlStateMsg(msg, isErr) {
  const el = $("ctl-state");
  el.textContent = msg;
  el.style.color = isErr ? "var(--crit-txt)" : "";
}
async function postControl(patch, okMsg) {
  try {
    const res = await fetch(API + "/api/control", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify(patch)});
    if (!res.ok) throw new Error("http " + res.status);
    ctlStateMsg((okMsg || "Command recorded") +
      " — audit-logged as a human action; the loop applies it at the next safe boundary.");
    await controlSync();
  } catch (e) {
    ctlStateMsg("Could not send command: " + e.message, true);
  }
}
async function controlSync() {
  if (snapshot) { $("controls-section").hidden = true; $("controls-offline-wrap").hidden = true; $("dl-controls").hidden = true; return; }
  try {
    const res = await fetch(API + "/api/control", {cache: "no-store"});
    if (!res.ok) throw new Error("http " + res.status);
    const j = await res.json();
    ctl.available = true;
    ctl.state = j.control || j;
    ctl.seq = j.seq ?? ctl.state.seq ?? null;
    $("controls-section").hidden = false;
    $("controls-offline-wrap").hidden = true;
    $("dl-controls").hidden = false;
    reflectControls();
  } catch (e) {
    ctl.available = false;
    $("controls-section").hidden = true;
    $("dl-controls").hidden = true;
    $("controls-offline-wrap").hidden = false;
  }
}
function reflectControls() {
  const s = ctl.state || {};
  const pauseBtn = $("ctl-pause");
  if (pauseBtn !== armedBtn)
    pauseBtn.textContent = s.pause_acquire ? "▶ Resume acquiring" : "⏸ Pause acquiring";
  $("ctl-scale").querySelectorAll("button").forEach(b => {
    const on = (s.worker_override == null && b.dataset.v === "auto") ||
               (s.worker_override != null && String(s.worker_override) === b.dataset.v);
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const applied = lastProgress?.control_applied_seq;
  const chip = $("ctl-pending");
  if (ctl.seq != null && applied != null && ctl.seq > applied) {
    chip.hidden = false;
    chip.className = "state-chip throttled";
    chip.textContent = `seq ${ctl.seq} pending — applies between nights`;
  } else if (ctl.seq != null && applied != null) {
    chip.hidden = false;
    chip.className = "state-chip ok";
    chip.textContent = "all commands applied";
  } else chip.hidden = true;
}
$("ctl-pause").addEventListener("click", e => {
  const to = !ctl.state.pause_acquire;
  armThen(e.currentTarget, () => postControl({pause_acquire: to},
    to ? "Pause queued — the acquirer idles after this night; reducers drain."
       : "Resume queued."), to ? "Confirm pause?" : "Confirm resume?");
});
$("ctl-scale").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  const v = b.dataset.v === "auto" ? null : +b.dataset.v;
  armThen(b, () => postControl({worker_override: v},
    v == null ? "Worker scale back to the governor (Auto)."
              : `Worker scale pinned to ${v} — wins over the governor until Auto.`));
});
$("ctl-breaker").addEventListener("click", e =>
  armThen(e.currentTarget, () => postControl({reset_breaker: true}, "Breaker reset queued.")));
$("ctl-dlretry").addEventListener("click", e =>
  armThen(e.currentTarget, () => postControl({deadletter_retry_shift: true},
    "±1-day sweep queued — rate-limited, breaker-aware; hits requeue, misses stay dead.")));
/* target/night mini-form for requeue / prioritize / restore */
let formMode = null;
function openCtlForm(mode, label, needNight) {
  formMode = mode;
  $("ctl-form").hidden = false;
  $("ctl-form-label").textContent = label;
  $("ctl-form-night").hidden = !needNight;
  $("ctl-form-night").required = needNight;
  $("ctl-form-target").focus();
}
$("ctl-requeue").addEventListener("click", () => openCtlForm("requeue", "requeue night:", true));
$("ctl-prio").addEventListener("click", () => openCtlForm("prioritize", "prioritize target:", false));
$("ctl-restore").addEventListener("click", () => {
  if ($("controls-section").hidden) return;
  openCtlForm("restore", "restore dead-lettered night:", true);
  $("controls-section").scrollIntoView({behavior: reduceMotion() ? "auto" : "smooth", block: "center"});
});
$("ctl-form-cancel").addEventListener("click", () => { $("ctl-form").hidden = true; disarm(); });
$("ctl-form").addEventListener("submit", e => {
  e.preventDefault();
  const target = $("ctl-form-target").value.trim();
  const night = $("ctl-form-night").value.trim();
  if (!target || ($("ctl-form-night").required && !night)) return;
  const patch = formMode === "prioritize" ? {prioritize: [target]}
    : {[formMode]: [{target, night}]};
  armThen($("ctl-form-apply"), () => {
    postControl(patch, `${formMode} ${target}${night ? " " + night : ""} queued.`);
    $("ctl-form").hidden = true;
    $("ctl-form-target").value = ""; $("ctl-form-night").value = "";
  }, "Confirm " + formMode + "?");
});

/* ---------- KPI cards ×6 with sparklines (zone 4) ---------------------------
   Sparklines + delta-vs-24h come from status/kpi-history.json (fetched every
   60 s, ring buffer 24 h). Until that file exists every chart slot renders the
   labeled v3 placeholder; current values still bind from progress.json. */
let kpiHist = null;                                  // [{t, nights_per_hr, …}]
function histSeries(fn) {
  if (!kpiHist || !kpiHist.length) return null;
  const xs = [], ys = [];
  for (const p of kpiHist) {
    const t = typeof p.t === "number" ? p.t * (p.t < 1e12 ? 1000 : 1) : Date.parse(p.t);
    const v = fn(p);
    if (!isNaN(t) && v != null && !isNaN(v)) { xs.push(t / 1000); ys.push(v); }
  }
  return xs.length >= 2 ? {xs, ys} : null;
}
function deltaCaption(ser, fmt, goodWhenUp) {
  const latest = ser.ys[ser.ys.length - 1];
  const tLatest = ser.xs[ser.xs.length - 1];
  let base = ser.ys[0];
  for (let i = 0; i < ser.xs.length; i++)            // point closest to 24 h before latest
    if (tLatest - ser.xs[i] <= 24 * 3600) { base = ser.ys[i]; break; }
  const diff = latest - base;
  if (Math.abs(diff) < 1e-9) return {txt: "flat vs 24 h ago", cls: ""};
  const up = diff > 0;
  const good = goodWhenUp === null ? null : (up === goodWhenUp);
  return {
    txt: `${up ? "▲" : "▼"} ${fmt(Math.abs(diff))} vs 24 h ago`,
    cls: good == null ? "" : good ? "up" : "down",
  };
}
function kpiCard(id, value, unit, caption, capCls, ser, colorVar, warn) {
  const card = $(id);
  card.classList.toggle("is-warn", !!warn);
  card.querySelector(".v").innerHTML = `${esc(value)}${unit ? `<small>${esc(unit)}</small>` : ""}`;
  const dEl = card.querySelector(".d");
  dEl.textContent = caption || "—";
  dEl.title = caption || "";
  dEl.className = "d " + (capCls || "");
  const chart = card.querySelector(".chart");
  const sig = ser ? ser.xs.length + ":" + ser.xs[ser.xs.length - 1] + ":" + ser.ys[ser.ys.length - 1] : "ph";
  registerChart(id, () => {
    chart.replaceChildren();
    if (!ser) { chart.innerHTML = `<span class="tel3">trend builds as nights log</span>`; return; }
    const col = cssVar(colorVar || "--aqua");
    new uPlot({
      width: chart.clientWidth || 150, height: 34,
      cursor: {show: false}, legend: {show: false}, pxAlign: false,
      scales: {x: {time: false}},
      axes: [{show: false}, {show: false}],
      series: [{}, {stroke: col, width: 1.6, fill: col + "22", points: {show: false}}],
    }, [ser.xs, ser.ys], chart);
  }, sig);
}
function renderKpis(d) {
  const k = d.kpis || {}, h = d.health || {}, med = k.stage_medians_s || {};
  const rv = d.review || {};

  const tpSer = histSeries(p => p.nights_per_hr);
  const tp = k.nights_per_hour ?? d.summary?.throughput_per_hr;
  const tpDelta = tpSer ? deltaCaption(tpSer, v => v.toFixed(1) + "/hr", true) : null;
  kpiCard("kpi-tp", tp ?? "—", "/hr", tpDelta?.txt, tpDelta?.cls, tpSer, "--aqua");

  const ySer = histSeries(p => p.scored_total > 0 ? 100 * p.science_grade_total / p.scored_total : null);
  const sess = d.session;
  let yieldTxt = "—", yieldCap = null;
  if (sess?.science_grade_n != null && sess?.scored?.length)
    { yieldTxt = Math.round(100 * sess.science_grade_n / sess.scored.length); yieldCap = `${sess.science_grade_n} of ${sess.scored.length} scored`; }
  else if (ySer) { yieldTxt = Math.round(ySer.ys[ySer.ys.length - 1]); yieldCap = "science-grade share of scored"; }
  const yDelta = ySer ? deltaCaption(ySer, v => v.toFixed(0) + " pt", true) : null;
  kpiCard("kpi-yield", yieldTxt, yieldTxt === "—" ? "" : "%",
    yieldCap ? yieldCap + (yDelta ? " · " + yDelta.txt : "") : (yDelta?.txt ?? "awaiting telemetry v3 — session"),
    yDelta?.cls, ySer, "--aqua");

  /* probe→score latency: v3 stage budgets (full night) → fallback to v2 acquire medians */
  const sb = d.stage_budgets || {};
  const sbStages = Object.keys(sb).filter(s => sb[s]?.p50_s != null);
  const latSer = histSeries(p => p.night_latency_s != null ? p.night_latency_s / 60 : null);
  const latDelta = latSer ? deltaCaption(latSer, v => v.toFixed(1) + " min", true) : null;
  if (sbStages.length) {
    const total = sbStages.reduce((a, s) => a + sb[s].p50_s, 0);
    kpiCard("kpi-lat", (total / 60).toFixed(1), "min",
      "median stages: " + sbStages.map(s => `${s} ${Math.round(sb[s].p50_s)}s`).join(" · ") +
      (latDelta ? " · " + latDelta.txt : ""),
      latDelta?.cls, latSer, "--blue");
  } else {
    const latParts = ["probe", "walk", "fetch"].filter(s => med[s]);
    const latSum = latParts.reduce((a, s) => a + med[s], 0);
    kpiCard("kpi-lat", latParts.length ? (latSum / 60).toFixed(1) : "—", latParts.length ? "min" : "",
      latParts.length ? "acquire stages: " + latParts.map(s => `${s} ${med[s]}s`).join(" · ")
                      : "awaiting telemetry v3 — stage medians",
      "", latSer, "--blue");
  }

  const qSer = histSeries(p => p.queue_depth);
  const qDelta = qSer ? deltaCaption(qSer, v => Math.round(v) + "", false) : null;
  kpiCard("kpi-queue", d.queue?.depth ?? d.schedule_remaining ?? "—", "",
    (k.eta_hours != null ? `ETA ${k.eta_hours} h at this rate` : "") + (qDelta ? " · " + qDelta.txt : ""),
    qDelta?.cls, qSer, "--blue");

  /* probe breakdown — this slot used to be Review SLA, which is always 0 in practice
     mode (nothing needs a human). Shows the acquisition-probe budget + circuit-breaker
     health + how much probe budget was spent on nights that dead-ended (no frames). */
  const probeSer = histSeries(p => p.probe_p50_s != null ? p.probe_p50_s / 60 : null);
  const sbP = sb.probe, sbW = sb.walk, dls = d.deadletter_stats || {};
  const probingNow = d.summary?.by_state?.probe || 0;
  const brkOpen = !!h.breaker_open;
  if (sbP && sbP.p50_s != null) {
    const parts = [`p90 ${(sbP.p90_s / 60).toFixed(1)}m`];
    if (sbW && sbW.p50_s != null) parts.push(`walk ${(sbW.p50_s / 60).toFixed(1)}m`);
    parts.push(`breaker ${brkOpen ? "OPEN" : "closed"}`);
    if (probingNow) parts.push(`${probingNow} probing`);
    if (dls.probe_cost_s_est) parts.push(`≈${(dls.probe_cost_s_est / 3600).toFixed(0)} h on dead-ends`);
    kpiCard("kpi-probe", (sbP.p50_s / 60).toFixed(1), "min", parts.join(" · "),
      brkOpen ? "down" : "", probeSer, "--aqua", brkOpen);
  } else {
    kpiCard("kpi-probe", "—", "",
      brkOpen ? "circuit breaker OPEN — archive throttled" : "awaiting probe telemetry",
      brkOpen ? "down" : "", probeSer, "--aqua", brkOpen);
  }

  const errSer = histSeries(p => (p.err_hiccups || 0) + (p.err_inits || 0) + (p.err_run || 0));
  const errN = (h.hiccups || 0) + (h.inits_failed || 0) + (h.run_failed || 0);
  const errDelta = errSer ? deltaCaption(errSer, v => Math.round(v) + "", false) : null;
  kpiCard("kpi-err", errN, "",
    `${h.hiccups || 0} hiccup · ${h.inits_failed || 0} inits · ${h.run_failed || 0} run-failed` +
    (errDelta ? " · " + errDelta.txt : ""),
    errDelta?.cls, errSer, "--aqua", errN > 4);
}
async function kpiHistRefresh() {
  if (document.hidden) return;
  try {
    const res = await fetch("kpi-history.json?" + Date.now(), {cache: "no-store"});
    kpiHist = res.ok ? await res.json() : null;
  } catch (e) { kpiHist = null; }
  if (lastProgress) renderKpis(lastProgress);
}

/* ---------- per-card night chips (zone 2 band) -----------------------------
   Labels each card with the night IT shows so the async-rendered playback (a
   PAST completed night) is never mistaken for the current night on the other
   cards. Film chip ← film_target/film_night/film_verdict; when film_night ≠ the
   live `night` a quiet note names what is reducing now. Coverage + science share
   the displayed current-night identity (science_card). All fields optional:
   absent → no chip / no note (old telemetry degrades cleanly). */
function renderNightChips(d) {
  const RN = d.reduced_night || null;
  const sc = (RN && RN.science_card) || d.science_card || {};
  const fm = (RN && RN.film_meta) ||
    {film_target: d.film_target, film_night: d.film_night, film_verdict: d.film_verdict};
  // playback, coverage and science now show the SAME last-reduced night → one identity,
  // stamped on all three cards (the science card wins; film_meta is the fallback).
  const tgt = sc.target ?? fm.film_target;
  const night = sc.night ?? fm.film_night;
  const vd = sc.verdict ?? fm.film_verdict;
  const fEl = $("film-chip"), covEl = $("cov-chip"), sciEl = $("sci-chip");
  if (fEl) fEl.innerHTML = nightChip(tgt, night, vd);
  if (covEl) covEl.innerHTML = nightChip(tgt, night, null);
  if (sciEl) sciEl.innerHTML = nightChip(tgt, night, vd);
  const fNote = $("film-note"); if (fNote) { fNote.textContent = ""; fNote.hidden = true; }
}

/* ---------- band status: "last reduced night" + graceful "next incoming" ------
   One calm line above the three night cards: what reduced night you're looking at,
   when it scored, and — when the pipeline is already working a newer night — a quiet
   "Next · reducing …" pill so the swap is expected, not surprising. On an actual night
   change the line pulses once. Poll cadence is 5 s, so a finished night surfaces here
   well inside the 30 s target. */
let prevReducedNight = null;
const STAGE_PHRASE = {probe: "probing archive", walk: "walking cadence", fetch: "downloading frames",
  film: "rendering film", reduce: "fitting the light curve", align: "aligning frames",
  sample: "nested sampling", paused: "paused"};
function agoText(iso) {
  const t = Date.parse(iso);
  if (isNaN(t)) return null;
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 90) return "just now";
  if (s < 5400) return Math.round(s / 60) + " min ago";
  if (s < 172800) return Math.round(s / 3600) + " h ago";
  return Math.round(s / 86400) + " d ago";
}
function renderBandStatus(d) {
  const el = $("band-status");
  if (!el) return;
  const RN = d.reduced_night || null;
  const sc = (RN && RN.science_card) || d.science_card || {};
  const rNight = (RN && RN.night) || sc.night || null;
  const rTgt = (RN && RN.target) || sc.target || null;
  if (!rNight) { el.hidden = true; return; }
  const lNight = d.night != null && String(d.night) !== "" ? String(d.night) : null;
  const lTgt = d.target != null && String(d.target) !== "" ? String(d.target) : null;
  const scored = (RN && RN.scored_utc) ? agoText(RN.scored_utc) : null;
  let html = `Showing the <b>last reduced night</b> · ${esc(rTgt || "")} ${esc(rNight)}` +
    (scored ? ` · scored ${esc(scored)}` : "");
  if (lNight && lNight !== String(rNight)) {           // a newer night is already in flight
    const phase = STAGE_PHRASE[d.stage] || null;
    html += ` <span class="next-pill" title="the panels above update here automatically when this night finishes">` +
      `↻ Next · reducing ${esc(lTgt || "")} ${esc(lNight)}${phase ? " · " + esc(phase) : ""}</span>`;
  }
  el.innerHTML = html;
  el.hidden = false;
  if (prevReducedNight && String(rNight) !== String(prevReducedNight)) {   // night just swapped
    el.classList.remove("just-updated"); void el.offsetWidth; el.classList.add("just-updated");
  }
  prevReducedNight = String(rNight);
}

/* fit-vs-catalogue σ-deviation gauges — how far each measurement sits from the
   published value (0σ = catalogue, ±3σ scale, colour by |σ|). O−C is skipped for
   non-detections, where a fitted mid-time is noise and its σ is meaningless. */
function catalogPanel(sc) {
  const q = v => (v == null || v === "") ? "?" : esc(v);
  const cls = a => a < 1.5 ? "ok" : a < 2 ? "aqua" : a < 3 ? "warn" : "crit";
  const gauge = (label, z, detail) => {
    const n = Number(z);
    if (z == null || isNaN(n)) return "";
    const a = Math.abs(n), left = (50 + Math.max(-3, Math.min(3, n)) / 3 * 50).toFixed(1);
    return `<div class="cat-row">
        <span class="cat-label">${esc(label)}</span>
        <span class="cat-track"><i class="cat-zero"></i><b class="cat-dot ${cls(a)}" style="left:${left}%"></b></span>
        <span class="cat-val ${cls(a)}">${n > 0 ? "+" : ""}${esc(n.toFixed(2))}σ</span>
      </div><div class="cat-detail">${detail}</div>`;
  };
  const rows = [
    gauge("Rp/R★", sc.rprs_z, `${q(sc.rprs_fit)} ± ${q(sc.rprs_err)} vs ${q(sc.rprs_pub)} published`),
    gauge("Duration", sc.dur_z, `${q(sc.dur_fit_min)} vs ${q(sc.dur_pub_min)} min published`),
  ];
  if (sc.verdict !== "NON-DETECTION" && sc.oc_sigma != null && Math.abs(Number(sc.oc_sigma)) < 50)
    rows.push(gauge("Mid-time O−C", sc.oc_sigma, `${q(sc.oc_minutes)} min from schedule`));
  const body = rows.filter(Boolean).join("");
  return body ? `<div class="cat-panel"><div class="cat-h">Fit vs catalogue · σ deviation (0 = published)</div>${body}</div>` : "";
}

/* ---------- science card (zone 5, binding kept incl. record_id link) ------- */
function renderScience(d) {
  const RN = d.reduced_night || null;
  const sc = (RN && RN.science_card) || d.science_card;   // reduced-night bundle first
  if (!sc) return;
  const scId = sc.record_id || sc.id || sc.record || null;
  const scLink = $("sci-review-link");
  if (scLink) scLink.href = "../review/" + (scId ? "#" + encodeURIComponent(scId) : "");
  // identity (target · night · verdict) is shown once, in the sci-chip above — no duplicate header here.
  const q = v => (v == null || v === "") ? "?" : esc(v);   // graceful "?" until the loop emits the new fields
  $("science").innerHTML = `
    <table class="kv sci-kv">
      <tr><td>depth: fit vs expected</td><td>${esc(sc.fit_depth_pct)}% vs ${esc(sc.expected_depth_pct)}%</td></tr>
      <tr><td>depth SNR</td><td>${q(sc.depth_snr)}</td></tr>
      <tr><td>Rp/R★: fit vs published</td><td>${q(sc.rprs_fit)} ± ${q(sc.rprs_err)} vs ${q(sc.rprs_pub)} · ${esc(sc.rprs_z)}σ</td></tr>
      <tr><td>duration: fit vs published</td><td>${q(sc.dur_fit_min)} vs ${q(sc.dur_pub_min)} min · ${esc(sc.dur_z)}σ</td></tr>
      <tr><td>mid-time O−C</td><td>${esc(sc.oc_minutes)} min${(sc.oc_sigma != null && sc.verdict !== "NON-DETECTION" && Math.abs(Number(sc.oc_sigma)) < 50) ? " · " + esc(sc.oc_sigma) + "σ" : ""}</td></tr>
      <tr><td>scatter · β · χ²</td><td>${esc(sc.scatter_pct)}% · ${esc(sc.beta)} · ${esc(sc.chi2_rescale)}</td></tr>
      <tr><td>runtime · peak RSS</td><td>${esc(sc.runtime_s)}s · ${esc(sc.max_rss_mb ?? "?")} MB</td></tr>
    </table>`;
  $("sci-catalog").innerHTML = catalogPanel(sc);
  const rs = (RN && RN.reasons) || d.verdict_reasons || [];
  const mv = (RN && RN.model_view) || d.model_view;
  $("reasons").innerHTML =
    `<h2 class="section-title" style="margin-top:var(--sp-3)">Why this verdict</h2><ul class="reason-list">` +
    (rs.length ? rs.map(x => `<li>${esc(x)}</li>`).join("") : "<li>all quality gates passed</li>") + "</ul>" +
    (mv && mv.p_good != null
      ? `<p class="detail">model: p(good) = <b>${esc(mv.p_good)}</b>
         (${esc(mv.verdict)}; trained on ${esc(mv.n_train)} runs,
         AUC ${esc(mv.cv_auc)}) — advisory only</p>`
      : `<p class="detail">model: not yet authoritative — transparent rules decide</p>`);
}

/* ---------- session results: O−C strip + mix + training feed (zone 5) ------ */
const OC_CAP_MIN = 13;
function renderSession(d) {
  const s = d.session;
  const strip = $("oc-strip");
  if (!s || !Array.isArray(s.scored) || !s.scored.length) {
    $("sess-count").textContent = "";
    strip.innerHTML = TEL3("per-night O−C strip");
    $("oc-axis").textContent = "";
    $("mixbar").hidden = true;
    $("mix-legend").innerHTML = TEL3("verdict mix");
    $("sess-stats").innerHTML = "";
    $("train-body").innerHTML = TEL3("session labels");
    return;
  }
  $("sess-count").textContent =
    `— ${s.scored.length} nights scored · every bar = one night · click → dossier`;
  strip.innerHTML = s.scored.map(n => {
    const oc = Math.abs(n.oc_min ?? 0);
    const hpct = Math.max(5, Math.min(oc, OC_CAP_MIN) / OC_CAP_MIN * 100);
    const v = KNOWN_VERDICTS.has(n.verdict) ? n.verdict : "NON-DETECTION";
    const lab = `${n.target ?? "?"} night ${n.night ?? "?"}: ${n.verdict ?? "?"}, O−C ${n.oc_min ?? "?"} min`;
    return `<a class="oc-bar vc-${v}" style="height:${hpct.toFixed(0)}%"
      href="../review/#${encodeURIComponent(n.record_id || "")}"
      title="${esc(lab)}" aria-label="${esc(lab)}"></a>`;
  }).join("");
  $("oc-axis").innerHTML =
    `<span>bar height = |O−C| (capped ${OC_CAP_MIN} min) · colour = verdict (see legend below)</span>`;
  const mix = s.verdict_mix || {};
  const total = Object.values(mix).reduce((a, b) => a + b, 0);
  if (total > 0) {
    $("mixbar").hidden = false;
    $("mixbar").innerHTML = VC_LABELS.filter(([k]) => mix[k])
      .map(([k]) => `<i class="vc-${k}" style="width:${(100 * mix[k] / total).toFixed(1)}%" title="${esc(k)} ${mix[k]}"></i>`).join("");
    $("mix-legend").innerHTML = VC_LABELS.filter(([k]) => mix[k])
      .map(([k, lab]) => `<span><i class="vc-${k}"></i>${lab} ${mix[k]}</span>`).join("");
  } else { $("mixbar").hidden = true; $("mix-legend").innerHTML = ""; }
  const sgOK = s.science_grade_n != null;
  const flagged = mix["INACCURATE"] || 0;
  const ocs = s.scored.map(n => Math.abs(n.oc_min ?? 0)).filter(v => v > 0).sort((a, b) => a - b);
  const medOC = ocs.length ? ocs[Math.floor(ocs.length / 2)].toFixed(1) : null;
  $("sess-stats").innerHTML =
    (sgOK ? `<tr><td>science-grade (accurate + marginal)</td><td>${s.science_grade_n} / ${s.scored.length} · ${Math.round(100 * s.science_grade_n / s.scored.length)}%</td></tr>` : "") +
    (medOC ? `<tr><td>median |O−C| of scored nights</td><td>${medOC} min</td></tr>` : "") +
    `<tr><td>flagged for review (INACCURATE)</td><td>${flagged} → queue</td></tr>`;
  const m = d.model || {};
  if (s.labels_added != null) {
    const toRetrain = Math.min(100, 100 * s.labels_added / 60);
    $("train-body").innerHTML = `<div style="font-size:12px">+${s.labels_added} labels this session
      (<b>+${s.positives_added ?? 0} positives</b>)${m.n_train ? ` · corpus n=${m.n_train}` : ""}
      <span class="bar blue" style="display:block;max-width:300px;margin-top:5px"><i style="width:${toRetrain.toFixed(0)}%"></i></span>
      <span style="font:10.5px var(--font-data);color:var(--muted)">retrain ${m.cycles != null ? "#" + (m.cycles + 1) : ""} auto-triggers at +60 new labels — ${s.labels_added}/60 · eval page updates itself</span></div>`;
  } else $("train-body").innerHTML = TEL3("session labels");
}

/* ---------- Sessions panel: past vs current loop runs ----------------------
   Renders status/sessions.json (own poll, 60 s). One row per loop run, newest
   first, current highlighted: completed/attempted nights, median nights/hr,
   dead-letters, and a verdict-mix mini-bar. Honest empty state before the file
   exists; unknown verdict keys (e.g. INITS-FAILED) fall back to a neutral swatch. */
const SESSION_ROWS = 10;
function sessMixBar(mix) {
  const entries = Object.entries(mix || {}).filter(([, n]) => n > 0);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  if (!total) return `<span class="sess-nomix" title="no scored nights">—</span>`;
  return `<span class="mixbar sess-mix" aria-hidden="true">` + entries.map(([k, n]) => {
    const cls = KNOWN_VERDICTS.has(k) ? "vc-" + k : "vc-other";
    return `<i class="${cls}" style="width:${(100 * n / total).toFixed(1)}%" title="${esc(k)} ${n}"></i>`;
  }).join("") + `</span>`;
}
function renderSessions(arr) {
  const host = $("sessions-body");
  if (!host) return;
  if (!Array.isArray(arr) || !arr.length) {
    host.innerHTML = `<p class="detail sessions-empty">no session history yet — the loop writes one row per run to ` +
      `<span class="mono">sessions.json</span> at each tranche boundary</p>`;
    return;
  }
  const rows = arr.slice(-SESSION_ROWS).reverse();   // newest first, current on top
  host.innerHTML = rows.map(s => {
    const cur = !!s.current;
    const att = s.nights_attempted ?? 0, comp = s.nights_completed ?? 0;
    const rate = s.nights_per_hr_median != null && !isNaN(+s.nights_per_hr_median)
      ? (+s.nights_per_hr_median).toFixed(1) + "/hr" : "—";
    const dl = s.deadletters != null ? s.deadletters : 0;
    const bf = s.backfilled ? ` <span class="sess-bf" title="reconstructed from historical logs">~est</span>` : "";
    const live = cur ? ` <span class="sess-live">live</span>` : "";
    const led = cur ? `<span class="led ok" aria-hidden="true"></span>` : "";
    return `<div class="sess-row${cur ? " is-current" : ""}">` +
      `<span class="sess-name">${led}<b>${esc(s.session ?? "?")}</b>${live}${bf}</span>` +
      `<span class="sess-nights" title="nights completed / attempted"><b>${esc(comp)}</b>/${esc(att)}<span class="sess-u"> nights</span></span>` +
      `<span class="sess-rate" title="median completion rate">${esc(rate)}</span>` +
      `<span class="sess-dl" title="dead-lettered nights">${esc(dl)}<span class="sess-u"> dl</span></span>` +
      sessMixBar(s.verdict_mix) + `</div>`;
  }).join("");
}
let sessionsData = null;
async function sessionsRefresh() {
  // bail only once we already HAVE data (mirrors refresh()): the FIRST call must render
  // even in a hidden/background tab, else the panel is stuck on "loading session history…"
  // until the 60 s tick fires with the tab foregrounded.
  if (document.hidden && sessionsData) return;
  try {
    const res = await fetch("sessions.json?" + Date.now(), {cache: "no-store"});
    sessionsData = res.ok ? await res.json() : null;
  } catch (e) { sessionsData = null; }
  renderSessions(sessionsData);
}

/* ---------- dead-letter panel (zone 6) -------------------------------------
   Uses deadletter_stats (v3); until then derives the same numbers from the
   v2 deadletter list (labeled). probe_cost falls back to total × probe median. */
function renderDeadletter(d) {
  const host = $("dl-body");
  let st = d.deadletter_stats, derived = false;
  if (!st && Array.isArray(d.deadletter) && d.deadletter.length) {
    derived = true;
    const by_day = {}, by_target = {};
    for (const x of d.deadletter) {
      const day = String(x.utc || "").slice(0, 10);
      if (day) by_day[day] = (by_day[day] || 0) + 1;
      if (x.target) by_target[x.target] = (by_target[x.target] || 0) + 1;
    }
    st = {total: d.deadletter.length, tried_total: d.tried_total, by_day, by_target,
          probe_cost_s_est: d.kpis?.stage_medians_s?.probe
            ? d.deadletter.length * d.kpis.stage_medians_s.probe : null};
  }
  if (!st || !st.total) { host.innerHTML = `<span class="tel3">no dead-lettered nights — nothing skipped yet</span>`; return; }
  const pct = st.tried_total ? Math.round(100 * st.total / st.tried_total) : null;
  const days = Object.entries(st.by_day || {}).sort((a, b) => a[0] < b[0] ? -1 : 1).slice(-3);
  const maxDay = Math.max(...days.map(x => x[1]), 1);
  const targets = Object.entries(st.by_target || {}).sort((a, b) => b[1] - a[1]);
  const topT = targets.slice(0, 6).map(([t, n]) => `${esc(t)} ${n}`).join(" · ") +
    (targets.length > 6 ? ` · ${targets.length - 6} more` : "");
  const reasons = Array.isArray(d.deadletter)
    ? [...new Set(d.deadletter.map(x => x.reason || "barren"))] : [];
  const edgeN = (d.events || []).filter(e => /date edge/.test(e.msg || "")).length;
  const today = new Date().toISOString().slice(0, 10);
  host.innerHTML = `
    <div style="display:flex;gap:var(--sp-5);align-items:baseline;flex-wrap:wrap">
      <span class="dl-big">${st.total}</span>
      <span class="dl-sub">${pct != null ? pct + "% of " + st.tried_total + " probed nights" : "share of probed — awaiting telemetry v3"}
        ${st.probe_cost_s_est ? ` · ≈${(st.probe_cost_s_est / 3600).toFixed(1)} h of probe budget${derived ? " (est.)" : ""}` : ""}</span>
    </div>
    <div class="dl-days" aria-label="dead-lettered nights per day, last 3 days">
      ${days.map(([day, n]) => `<span class="db${day === today ? "" : " old"}"
         style="height:${Math.max(6, Math.round(34 * n / maxDay))}px" title="${esc(day)}: ${n}"></span>`).join("")}
      <span class="dlab">per day: ${days.map(([day, n]) =>
        day === today ? `<b style="color:var(--warn-txt)">${n} today</b>` : String(n)).join(" · ")}</span>
    </div>
    <p class="dl-line">${topT}</p>
    <p class="dl-copy">${reasons.length === 1
      ? `One reason, ${st.total} times: <b>“${esc(reasons[0])}.”</b>`
      : reasons.length ? `Reasons: ${reasons.map(esc).join(" · ")}` : ""}
      ${edgeN ? ` Correlates with the <span style="color:var(--warn-txt)">${edgeN} “oracle said observed but no frames (date edge?)”</span>
      warnings in the log — the schedule may point at nights whose frames live under the <b>adjacent calendar date</b>.` : ""}</p>`;
}

/* ---------- backlog panel (zone 6) ----------------------------------------- */
function renderBacklog(d) {
  const items = d.queue?.items;
  $("backlog").innerHTML = Array.isArray(items) && items.length
    ? items.slice(0, 8).map((it, i) => `<div class="bk-item">#${i + 1} ${esc(it.target || "?")}
        <span class="bk-night">${esc(it.night || "")}</span>${it.prospect != null
          ? ` <span class="bk-night">· p(good) ${esc(it.prospect)}</span>` : ""}
        <span class="bk-why">${Array.isArray(it.reasons) && it.reasons.length
          ? esc(it.reasons.join(" · "))
          : "ranking reasons — awaiting telemetry v3"}</span></div>`).join("")
    : `<div class="bk-item">schedule exhausted</div>`;
  $("backlog-depth").textContent = d.queue?.depth != null ? "· " + d.queue.depth + " queued" : "";
  const rpt = d.remaining_per_target;
  if (!rpt) return;
  const entries = Object.entries(rpt).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map(([, n]) => n), 1);
  $("targets").innerHTML = entries.map(([t, n]) =>
    `<div class="bar-row"><span class="name">${esc(t)}</span>
     <span class="bar"><i style="width:${(100 * n / max).toFixed(1)}%"></i></span>
     <span class="n">${n}</span></div>`).join("");
}

/* ---------- quality model panel (zone 7) ------------------------------------ */
function gateRow(ok, name, valTxt, detail, barPct, barBlue) {
  return `<div class="gate-row">
    <span class="g-line"><span class="led ${ok == null ? "idle" : ok ? "ok" : "warn"}" aria-hidden="true"></span>
      <b>${esc(name)}</b> <span>${esc(valTxt)}</span> <span class="g-detail">${esc(detail)}</span></span>
    ${barPct != null ? `<span class="bar${barBlue ? " blue" : ""}"><i style="width:${Math.min(100, barPct).toFixed(0)}%"></i></span>` : ""}
  </div>`;
}
function renderModel(d) {
  const m = d.model;
  if (!m) { $("model-gates").innerHTML = `<span class="tel3">no model telemetry yet</span>`; return; }
  const gp = m.gate_positives, ge = m.gate_ece;
  const auc = Array.isArray(m.auc_history) ? m.auc_history : [];
  const last3 = auc.slice(-3);
  const stable = last3.length === 3 ? (Math.max(...last3) - Math.min(...last3)) <= 0.03 : null;
  let html = "";
  if (gp) html += gateRow(gp.now >= gp.target, "Evidence",
    `${gp.now} positive labels`, `/ ≥${gp.target} required`, 100 * gp.now / gp.target, false);
  if (ge) html += gateRow(ge.now <= ge.target, "Calibration",
    `ECE ${ge.now}`, `/ <${ge.target} · “80% sure” right ~80% of the time`,
    100 * (ge.target / Math.max(ge.now, 1e-6)) * (ge.now <= ge.target ? 1 : 0.45), true);
  html += stable == null
    ? gateRow(null, "Stability", "needs 3 training cycles", auc.length + " so far", null)
    : gateRow(stable, "Stability",
        stable ? "AUC steady over last 3 cycles" : "AUC still moving",
        `spread ${(Math.max(...last3) - Math.min(...last3)).toFixed(3)} (≤0.030 to pass)`, null);
  html += `<div class="g-detail" style="font-size:10.5px;color:var(--muted);margin-top:6px">
    cycle ${m.cycles ?? "—"} · AUC ${m.auc ?? "—"} · Brier ${m.brier ?? "—"} · n=${m.n_train ?? "—"}</div>`;
  $("model-gates").innerHTML = html;
  const allOk = gp && ge && stable === true && gp.now >= gp.target && ge.now <= ge.target;
  const chipEl = $("model-chip");
  chipEl.hidden = !allOk;
  if (allOk) chipEl.textContent = "health checks pass — rules stay authoritative; the promotion gate lives on the Evaluation page";
  $("model-live").textContent = m.live_accuracy_100 != null
    ? m.live_accuracy_100 + "%" : "coming online";

  const el = $("model-chart");
  registerChart("model", () => {
    el.replaceChildren();
    if (auc.length < 2) { el.innerHTML = `<span class="tel3">AUC history builds as cycles complete</span>`; return; }
    const cycles = auc.map((_, i) => i + 1);
    const ece = Array.isArray(m.ece_history) ? m.ece_history.slice(0, auc.length) : [];
    const mono = cssVar("--font-data").split(",")[0] || "monospace";
    const axisCfg = c => ({stroke: cssVar("--muted"), grid: {stroke: cssVar("--grid"), width: 1},
                           ticks: {show: false}, font: "10px " + mono, ...c});
    new uPlot({
      width: el.clientWidth || 380, height: 150,
      cursor: {show: false}, legend: {show: false}, pxAlign: false,
      scales: {x: {time: false},
               auc: {range: [Math.min(...auc) - 0.03, Math.min(1, Math.max(...auc) + 0.02)]},
               ece: {range: [0, Math.max(0.12, ...ece) * 1.25]}},
      axes: [axisCfg({}),
             axisCfg({scale: "auc", size: 42}),
             axisCfg({scale: "ece", side: 1, size: 42, grid: {show: false}})],
      series: [{},
        {scale: "auc", stroke: cssVar("--blue"), width: 1.8,
         points: {show: true, size: 5, fill: cssVar("--blue")}},
        {scale: "ece", stroke: cssVar("--warn"), width: 1.2, dash: [4, 3], points: {show: false}}],
    }, [cycles, auc, ece.length === auc.length ? ece : auc.map(() => null)], el);
  }, auc.length + ":" + auc[auc.length - 1]);
  $("model-note").textContent =
    `challenger AUC (blue, grouped CV) · ECE (dashed, right axis) — champion baseline + CI band arrive with telemetry v3 · advisory only: it drafts recommendations, humans decide`;
}

/* ---------- event log (zone 8): incremental rows + filters + search --------- */
const logState = {keys: [], sev: "all", lane: null, q: "", laneSig: "", init: false};
const laneOf = msg => {
  const m = /^\[([A-Za-z]+\d*)\]/.exec(msg || "");
  return m ? (m[1] === "acquire" ? "A" : m[1]) : null;
};
function logRow(e) {
  const div = document.createElement("div");
  const dt = new Date(e.t);
  const ok = !isNaN(dt.getTime());
  div.className = e.level || "info";
  div.dataset.lvl = e.level || "info";
  const lane = laneOf(e.msg);
  if (lane) div.dataset.lane = lane;
  if (ok) div.dataset.ts = dt.getTime();
  const t = document.createElement("span");
  t.className = "t";
  t.textContent = ok ? dt.toLocaleTimeString() : e.t;
  const m = document.createElement("span");
  m.textContent = " " + (e.msg || "");
  const age = document.createElement("span");
  age.className = "age";
  div.append(t, m, age);
  return div;
}
function applyLogFilters() {
  const host = $("log");
  const q = logState.q.toLowerCase();
  for (const row of host.children) {
    const sevHit = logState.sev === "all" || row.dataset.lvl === logState.sev;
    const laneHit = !logState.lane || row.dataset.lane === logState.lane;
    const qHit = !q || row.textContent.toLowerCase().includes(q);
    row.hidden = !(sevHit && laneHit && qHit);
  }
}
function renderLog(d) {
  if (!Array.isArray(d.events)) return;
  const host = $("log");
  if (!logState.init) { host.textContent = ""; logState.init = true; }
  const entries = d.events.slice(-200).reverse();      // newest first
  const keyOf = e => e.t + "|" + e.msg;
  const desired = entries.map(keyOf);
  const oldFirst = logState.keys[0];
  const k = oldFirst ? desired.indexOf(oldFirst) : -1;
  if (k === -1 && logState.keys.length) host.textContent = "";
  if (!host.childElementCount) {
    const frag = document.createDocumentFragment();
    entries.forEach(e => frag.appendChild(logRow(e)));
    host.appendChild(frag);
  } else if (k > 0) {
    const frag = document.createDocumentFragment();
    entries.slice(0, k).forEach(e => frag.appendChild(logRow(e)));
    host.insertBefore(frag, host.firstChild);
  }
  while (host.childElementCount > desired.length) host.lastElementChild.remove();
  logState.keys = desired;
  /* ages + severity counts (text updates only) */
  const now = Date.now();
  let nWarn = 0, nErr = 0;
  for (const row of host.children) {
    if (row.dataset.ts) row.querySelector(".age").textContent = " " + relAge(now - +row.dataset.ts);
    if (row.dataset.lvl === "warn") nWarn++;
    else if (row.dataset.lvl === "error") nErr++;
  }
  $("lc-all").textContent = host.childElementCount;
  $("lc-warn").textContent = nWarn;
  $("lc-err").textContent = nErr;
  /* lane chips, rebuilt only when the set of lanes changes */
  const lanes = [...new Set(entries.map(e => laneOf(e.msg)).filter(Boolean))].sort();
  const sig = lanes.join(",");
  if (sig !== logState.laneSig) {
    logState.laneSig = sig;
    const holder = $("log-lanes");
    holder.replaceChildren(...lanes.map(l => {
      const b = document.createElement("button");
      b.className = "fchip" + (logState.lane === l ? " on" : "");
      b.dataset.lane = l;
      b.setAttribute("aria-pressed", logState.lane === l ? "true" : "false");
      b.textContent = l;
      return b;
    }));
  }
  applyLogFilters();
}
document.querySelector(".log-head").addEventListener("click", e => {
  const b = e.target.closest(".fchip");
  if (!b) return;
  if (b.dataset.sev) {
    logState.sev = b.dataset.sev;
    document.querySelectorAll(".log-head .fchip[data-sev]").forEach(x => {
      const on = x.dataset.sev === logState.sev;
      x.classList.toggle("on", on);
      x.setAttribute("aria-pressed", on ? "true" : "false");
    });
  } else if (b.dataset.lane) {
    logState.lane = logState.lane === b.dataset.lane ? null : b.dataset.lane;
    document.querySelectorAll("#log-lanes .fchip").forEach(x => {
      const on = x.dataset.lane === logState.lane;
      x.classList.toggle("on", on);
      x.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
  applyLogFilters();
});
let searchT = null;
$("log-search").addEventListener("input", e => {
  clearTimeout(searchT);
  searchT = setTimeout(() => { logState.q = e.target.value.trim(); applyLogFilters(); }, 150);
});

/* review lives on its own page — no queue section here. This slim stats-only poll
   feeds the flow strip's Approved node + pre-v3 fallbacks for pending/oldest. */
const reviewFallback = {pending: null, oldest_age_s: null, approved: null};
async function reviewStats() {
  if (document.hidden || snapshot) return;
  try {
    const rows = await (await fetch(API + "/api/queue")).json();
    // pending = runs that need a HUMAN decision (decision lane), not every auto-filed run
    reviewFallback.pending = rows.filter(r => r.decision_required).length;
    reviewFallback.approved = rows.filter(r => r.review?.status === "approved").length;
  } catch (e) { reviewFallback.pending = reviewFallback.approved = null; }
}

/* ---------- main poll -------------------------------------------------------- */
let lastProgress = null;
let ctlNextTry = 0;                                   // backoff while /api/control is absent
async function refresh() {
  if (document.hidden && lastProgress) return;        // skip all work when hidden
  let d;
  try { d = await (await fetch("progress.json?" + Date.now())).json(); }
  catch (e) { return; }
  lastProgress = d;
  applySnapshot(d);
  renderCmdbar(d);
  renderFlow(d);
  renderLanes(d);
  const RN = d.reduced_night || null;                  // coherent last-reduced-night bundle
  const filmPath = (RN && RN.film) || d.film;          // playback follows the reduced night
  if (filmPath) loadFilm(filmPath);
  else showMidframe(nightOf(d));                       // snapshot: still frame instead of film
  const lcRef = (RN && RN.lightcurve) || d.lightcurve;
  if (lcRef) {
    const lc = $("lightcurve");
    if (lc.getAttribute("src") !== lcRef) lc.src = lcRef;   // only on change
    lc.hidden = false;
  }
  renderCoverage(d);
  renderQuality(d);
  renderKpis(d);
  renderNightChips(d);
  renderBandStatus(d);
  renderScience(d);
  renderSession(d);
  renderDeadletter(d);
  renderBacklog(d);
  renderModel(d);
  renderLog(d);
  /* control channel: sync after each refresh while available; 5-min backoff
     retries while the endpoint is missing (avoids console noise) */
  if (!snapshot && (ctl.available || Date.now() >= ctlNextTry)) {
    await controlSync();
    if (!ctl.available) ctlNextTry = Date.now() + 300000;
  }
  if (snapshot) stopPolling();                        // a static capture never changes
}
let pollTimers = [];
function stopPolling() { pollTimers.forEach(clearInterval); pollTimers = []; }

refresh();
kpiHistRefresh();
reviewStats();
sessionsRefresh();
pollTimers.push(
  setInterval(refresh, 5000),
  setInterval(kpiHistRefresh, 60000),
  setInterval(reviewStats, 60000),
  setInterval(sessionsRefresh, 60000),
);
