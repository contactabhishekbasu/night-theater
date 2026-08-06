/* Guided review journey — step engine.
   Data sources (relative, served from http://localhost:8321/review/):
     ./index.json            — flat array, ~1020 rows, the full archive
     ./examples.json         — {note, k, examples[]} the 20 curated worked examples
     ./<id>/report.json      — per-dossier measurements (interp.js turns this into ctx)
   Narration copy and figure/stat templates live in narration.js; template
   rendering and figure-URL resolution live in interp.js. This file only
   wires the two together into a step-by-step walkthrough. */
import { STEPS } from "./narration.js?v=20260730a";
import { buildContext, render, resolveFigure, esc } from "./interp.js?v=20260730a";
import { renderDecision } from "./decision.js?v=20260730a";

const state = { rows: [], examples: [], report: null, ctx: null,
                dossierId: null, stepIdx: 0 };

/* ---------- boot ---------- */
async function boot() {
  const r = await fetch("./index.json");
  if (!r.ok) throw new Error("http " + r.status);
  const rows = await r.json();
  state.rows = Array.isArray(rows) ? rows : [];

  // examples.json is best-effort: absent/invalid just means the "Start here"
  // group doesn't render. It must never take the whole page down with it.
  let examplesDoc = null;
  try {
    const re = await fetch("./examples.json");
    examplesDoc = re.ok ? await re.json() : null;
  } catch (e) { examplesDoc = null; }
  state.examples = (examplesDoc && Array.isArray(examplesDoc.examples)) ? examplesDoc.examples : [];

  renderRail();
  const [hashId, hashStep] = parseHash();
  const defaultId = (state.examples[0] && state.examples[0].id) || (state.rows[0] && state.rows[0].id) || null;
  const entryId = hashId || defaultId;
  if (!entryId) {
    document.getElementById("progress").innerHTML = "";
    document.getElementById("stepCounter").textContent = "";
    document.getElementById("step").innerHTML =
      "<div class=\"banner crit\">Failed to load the review index.</div>";
    return;
  }
  await selectDossier(entryId, hashId ? stepIndexOf(hashStep) : 0);
}

/* ---------- hash <-> [dossierId, stepId] ---------- */
function parseHash() {
  const raw = (location.hash || "").slice(1);
  if (!raw) return [null, null];
  const i = raw.indexOf("/");
  let id, step;
  try {
    if (i < 0) {
      // legacy slash-less link (#<id>): land on the first step rather than
      // breaking silently.
      id = decodeURIComponent(raw);
      step = STEPS[0].id;
    } else {
      id = decodeURIComponent(raw.slice(0, i));
      step = decodeURIComponent(raw.slice(i + 1));
    }
  } catch (e) { return [null, null]; }
  const known = state.rows.some((r) => r.id === id) || state.examples.some((r) => r.id === id);
  return known ? [id, step] : [null, null];
}
function stepIndexOf(stepId) {
  const i = STEPS.findIndex((s) => s.id === stepId);
  return i >= 0 ? i : 0;
}
function updateHash(id, stepId) {
  const target = "#" + encodeURIComponent(id) + "/" + stepId;
  if (location.hash !== target) location.hash = target;
}
function indexRowFor(id) {
  return state.rows.find((r) => r.id === id) || state.examples.find((r) => r.id === id) || null;
}

/* ---------- rail ----------
   e.reason describes the verdict in prose — showing it before a decision
   spoils the step-8 reveal. Only show it once the visitor has actually
   decided that dossier (recorded in the sandbox's own localStorage history);
   undecided rows never render it. */
function decidedIds() {
  try {
    const h = JSON.parse(localStorage.getItem("review-journey-history")) || [];
    return new Set(h.map((e) => e.id));
  } catch (e) { return new Set(); }
}
function exampleRowHTML(e, decided, i) {
  const sel = e.id === state.dossierId ? " sel" : "";
  const done = decided.has(e.id);
  const why = (e.reason && done) ? `<span class="ex-why">${esc(e.reason)}</span>` : "";
  const mark = done
    ? `<span class="ex-n done" title="You decided this night">✓</span>`
    : `<span class="ex-n">${String(i + 1).padStart(2, "0")}</span>`;
  return `<div class="queue-row ex${sel}" data-id="${esc(e.id)}" role="button" tabindex="0"
        aria-label="${esc("Open worked example " + (e.target || "") + " " + (e.night || ""))}">
      <span class="qt">${mark}${esc(e.target || "")}</span>
      <span class="qn">${esc(e.night || "")}</span>
      ${why}
    </div>`;
}
function queueRowHTML(r) {
  const sel = r.id === state.dossierId ? " sel" : "";
  const rno = r.run_no ? `<span class="qn">${esc(r.run_no)}</span>` : "";
  return `<div class="queue-row${sel}" data-id="${esc(r.id)}" role="button" tabindex="0"
        aria-label="${esc("Open " + (r.target || "") + " " + (r.night || ""))}">
      <span class="qt">${esc(r.target || "")}</span>${rno}
      <span class="qn">${esc(r.night || "")}</span>
    </div>`;
}
function renderRail() {
  const decided = decidedIds();
  document.getElementById("examples").innerHTML =
    state.examples.map((e, i) => exampleRowHTML(e, decided, i)).join("");
  document.getElementById("queue").innerHTML = state.rows.map(queueRowHTML).join("");
  document.getElementById("queueCount").textContent =
    state.rows.length === 1 ? "1 in archive" : `${state.rows.length} in archive`;
}
document.getElementById("rail").addEventListener("click", (e) => {
  const row = e.target.closest(".queue-row");
  if (row && row.dataset.id) { selectDossier(row.dataset.id, 0); closeRailMobile(); }
});
document.getElementById("rail").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const row = e.target.closest(".queue-row");
  if (row && row.dataset.id) { e.preventDefault(); selectDossier(row.dataset.id, 0); closeRailMobile(); }
});

/* ---------- dossier load ----------
   Rail rows/hashchange can fire selectDossier() again before an in-flight
   report.json resolves (rapid clicking). A generation counter makes any
   stale response a no-op instead of letting it overwrite state/DOM after a
   newer selection has already landed. */
let dossierGen = 0;
async function selectDossier(id, stepIdx) {
  if (!id) return;
  const gen = ++dossierGen;
  let report = null;
  try {
    const r = await fetch(`./${encodeURIComponent(id)}/report.json`);
    if (!r.ok) throw new Error("http " + r.status);
    report = await r.json();
  } catch (e) {
    report = null;
  }
  if (gen !== dossierGen) return;   // superseded by a newer selectDossier() call
  state.dossierId = id;
  window.__journeyState = { dossierId: id, stepIdx: 0 };

  if (!report) {
    state.report = null; state.ctx = null; state.stepIdx = 0;
    renderRail();
    document.getElementById("progress").innerHTML = "";
    document.getElementById("stepCounter").textContent = "";
    document.getElementById("step").innerHTML =
      "<div class=\"banner crit\">This dossier's data failed to load</div>";
    updateHash(id, STEPS[0].id);
    return;
  }

  report.id = id;                      // report.json may lack id
  state.report = report;
  state.ctx = buildContext(report);
  state.stepIdx = Math.max(0, Math.min(STEPS.length - 1, stepIdx || 0));
  renderRail();
  updateHash(id, STEPS[state.stepIdx].id);
  renderStep();
}

/* ---------- step navigation ---------- */
function go(idx) {
  if (!state.dossierId) return;
  const clamped = Math.max(0, Math.min(STEPS.length - 1, idx));
  if (clamped === state.stepIdx) return;   // no-op: don't wipe in-progress step-8 state
  state.stepIdx = clamped;
  updateHash(state.dossierId, STEPS[state.stepIdx].id);
  renderStep();
}
document.getElementById("prevBtn").addEventListener("click", () => go(state.stepIdx - 1));
document.getElementById("nextBtn").addEventListener("click", () => go(state.stepIdx + 1));
document.getElementById("progress").addEventListener("click", (e) => {
  const btn = e.target.closest(".j-dot");
  if (btn) go(+btn.dataset.idx);
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const tag = (e.target && e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea") return;
  const lb = document.getElementById("lightbox");
  if (lb.open) return;
  if (e.key === "ArrowLeft") go(state.stepIdx - 1);
  else go(state.stepIdx + 1);
});

/* ---------- figures ---------- */
function figureHTML(fig, ctx) {
  const cap = esc(fig.caption || "");
  const resolved = resolveFigure(fig.src, ctx);
  if (!resolved) {
    return `<figure class="j-fig"><div class="missing">Not produced for this night.</div><figcaption>${cap}</figcaption></figure>`;
  }
  return `<figure class="j-fig"><img loading="lazy" src="${esc(resolved.url)}" alt="${cap}"><figcaption>${cap}</figcaption></figure>`;
}
function wireFigures(mount) {
  mount.querySelectorAll(".j-fig img").forEach((img) => {
    img.addEventListener("error", () => {
      const fig = img.closest(".j-fig");
      const cap = fig.querySelector("figcaption").innerHTML;
      fig.innerHTML = `<div class="missing">Not produced for this night.</div><figcaption>${cap}</figcaption>`;
    }, { once: true });
    img.addEventListener("click", () => openLightbox(img.currentSrc || img.src, img.alt));
  });
}
function openLightbox(url, cap) {
  document.getElementById("lbImg").src = url;
  document.getElementById("lbCap").textContent = cap;
  document.getElementById("lightbox").showModal();
}
document.getElementById("lbClose").addEventListener("click", () => document.getElementById("lightbox").close());

/* ---------- score-step gauges ----------
   Three checks plotted as bars against a fixed 0-4sigma scale; the pipeline's
   own ACCURATE threshold (2sigma) is marked as a tick, and any bar past it
   turns from "good" to "warn" colour. */
function gaugesHTML(ctx) {
  const GAUGES = [["Planet size", "rprs_z"], ["Duration", "dur_z"], ["Mid-time", "oc_sigma"]];
  const m = (ctx && ctx.metrics) || {};
  const rows = GAUGES.map(([label, key]) => {
    const f = parseFloat(m[key]);
    const z = Number.isFinite(f) ? Math.abs(f) : null;
    if (z == null) {
      return `<div class="jg">
          <div class="jg-label"><span class="jg-name">${esc(label)}</span><span class="jg-val muted">not recorded this night</span></div>
          <div class="jg-bar empty"></div>
        </div>`;
    }
    const pct = (Math.min(z, 4) / 4) * 100;
    const over = z > 2;
    const valueHTML = render(`{metrics.${key}|2|σ}`, ctx);
    return `<div class="jg">
        <div class="jg-label"><span class="jg-name">${esc(label)}</span><span class="jg-val${over ? " over" : ""}">${valueHTML}</span></div>
        <div class="jg-bar">
          <div class="jg-fill${over ? " over" : ""}" style="width:${pct}%"></div>
          <div class="jg-thresh" style="left:50%"></div>
        </div>
      </div>`;
  }).join("");
  return `<div class="j-gauges">${rows}
      <div class="jg-scale"><span>0</span><span class="jg-scale-mid">2σ — the pipeline's line</span><span>4σ+</span></div>
      <p class="jg-note">All three inside 2σ is what the pipeline calls ACCURATE. The pipeline recommends; it never decides.</p>
    </div>`;
}

/* ---------- render the active step ---------- */
function renderStep() {
  const step = STEPS[state.stepIdx];
  const ctx = state.ctx;
  window.__journeyState = { dossierId: state.dossierId, stepIdx: state.stepIdx };

  document.getElementById("progress").innerHTML = STEPS.map((s, i) => {
    const cls = "j-dot" + (i < state.stepIdx ? " done" : "");
    const cur = i === state.stepIdx ? ' aria-current="step"' : "";
    return `<button type="button" class="${cls}" data-idx="${i}"${cur}>${esc(s.title)}</button>`;
  }).join("");
  document.getElementById("stepCounter").textContent = `Step ${state.stepIdx + 1} of ${STEPS.length}`;

  // nav affordances: Back dead at the start, Next dead at the decision, and the
  // step before the decision announces what's coming instead of a generic "Next".
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  prevBtn.disabled = state.stepIdx === 0;
  nextBtn.disabled = state.stepIdx === STEPS.length - 1;
  nextBtn.textContent = state.stepIdx === STEPS.length - 2 ? "Make your decision →" : "Next →";

  const mount = document.getElementById("step");

  if (!ctx) {
    mount.innerHTML = "<div class=\"banner crit\">This dossier's data failed to load</div>";
    return;
  }

  if (step.id === "decision") {
    mount.innerHTML = "";
    renderDecision(mount, ctx, indexRowFor(state.dossierId));
    return;
  }

  const parts = [`<h2>${esc(step.title)}</h2>`];
  parts.push(`<div class="j-teach">`);
  parts.push(`<h3>What you're looking at</h3><p>${render(step.teach, ctx)}</p>`);
  parts.push(`<h3>Why it matters</h3><p>${render(step.why, ctx)}</p>`);
  parts.push(`<div class="j-worry"><h3>What would worry a scientist</h3><p>${render(step.worry, ctx)}</p></div>`);
  parts.push(`</div>`);

  for (const fig of step.figures) parts.push(figureHTML(fig, ctx));

  if (step.id === "score") parts.push(gaugesHTML(ctx));

  const tiles = step.stats
    .filter((st) => st.tpl !== "hidden")
    .map((st) => `<div class="stat-tile"><div class="l">${esc(st.label)}</div><div class="v">${render(st.tpl, ctx)}</div></div>`)
    .join("");
  if (tiles) parts.push(`<div class="stat-row">${tiles}</div>`);

  if (step.advanced) {
    parts.push(`<details class="measurements"><summary>${esc(step.advanced.summary)}</summary>${figureHTML(step.advanced.figure, ctx)}</details>`);
  }

  mount.innerHTML = parts.join("");
  wireFigures(mount);
}

/* ---------- after the reveal: keep the visitor moving ----------
   decision.js announces a committed decision; refresh the rail (the ✓ and the
   now-unspoilable reason line) and offer the next undecided curated night. */
document.getElementById("step").addEventListener("journey:decided", () => {
  renderRail();
  const decided = decidedIds();
  const next = state.examples.find((e) => e.id !== state.dossierId && !decided.has(e.id));
  const reveal = document.querySelector("#step #reveal");
  if (!reveal || reveal.querySelector(".j-continue")) return;
  const cta = document.createElement("div");
  cta.className = "j-continue";
  if (next) {
    cta.innerHTML = `<button type="button" class="btn j-continue-btn">Review the next night: ${esc(next.target || "")} ${esc(next.night || "")} →</button>`;
    cta.querySelector("button").addEventListener("click", () => {
      selectDossier(next.id, 0);
      document.getElementById("main").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  } else {
    cta.innerHTML = `<p class="jg-note">You have reviewed every worked example — the full archive in the rail is yours now.</p>`;
  }
  reveal.appendChild(cta);
});

/* ---------- deep links ---------- */
window.addEventListener("hashchange", () => {
  const [id, stepId] = parseHash();
  if (!id) return;
  if (id !== state.dossierId) selectDossier(id, stepIndexOf(stepId));
  else go(stepIndexOf(stepId));
});

/* ---------- header chrome (theme + mobile rail toggle) ----------
   Carried over from expert.html so the header copied verbatim into
   index.html stays functional; unrelated to the step engine itself. */
document.getElementById("themeBtn").addEventListener("click", () => {
  const root = document.documentElement;
  const cur = root.getAttribute("data-theme")
    || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  try { localStorage.setItem("theater-theme", next); } catch (e) {}
});
document.getElementById("railToggle").addEventListener("click", () => {
  document.getElementById("rail").classList.toggle("open");
});
function closeRailMobile() {
  if (matchMedia("(max-width: 820px)").matches)
    document.getElementById("rail").classList.remove("open");
}

/* ---------- static-snapshot detection ----------
   Same source and contract as expert.html's detectSnapshot(): the weekly
   publisher stamps progress.json with published_utc; a live local checkout
   has no such key. Read-only here — no gate to hide on this page, just the
   header badge + ribbon that theater.css keys off html[data-snapshot]. */
(function detectSnapshot() {
  fetch("../status/progress.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d || !d.published_utc) return;
      document.documentElement.setAttribute("data-snapshot", "1");
      const el = document.getElementById("snapshot-date");
      if (el) el.textContent = String(d.published_utc).slice(0, 10);
    })
    .catch(() => {});
})();

boot().catch((e) => {
  document.getElementById("step").innerHTML = '<div class="banner crit">Failed to load the review index.</div>';
});
