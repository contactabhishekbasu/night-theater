/* Template rendering for the guided journey. Mirrors the contract pinned in
   tests/test_review_journey.py: {dotted.path} raw, {dotted.path|N} toFixed(N),
   anything missing/non-finite renders "not recorded". Never throws. */

export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const MISSING = "not recorded";

function num(v) {
  const f = parseFloat(v);
  return Number.isFinite(f) ? f : null;
}

export function buildContext(report) {
  const params = report.params || [];
  const row = (name) => params.find((p) => p && p.name === name) || {};
  const rprsFit = num(row("Rp/R*").fit);
  const rprsPub = num(row("Rp/R*").published);
  const periodPrior = String(row("Period").prior || "");
  const mP = periodPrior.match(/^\s*([0-9.]+)/);
  const seg = String(report.id || "").split("_").pop();
  const isNight = /^\d{6}$/.test(seg);
  return {
    ...report,
    params_period: mP ? mP[1].slice(0, 8) : null,
    computed: {
      rprs_fit: rprsFit,
      rprs_published: rprsPub,
      depth_fit_pct: rprsFit == null ? null : rprsFit * rprsFit * 100,
      depth_expected_pct: rprsPub == null ? null : rprsPub * rprsPub * 100,
      night_yymmdd: isNight ? seg : null,
      oc_png: String(report.target || "").replace(/\s+/g, "") + "_oc.png",
      midframe: isNight ? seg + ".jpg" : null,
    },
  };
}

function lookup(ctx, dotted) {
  let cur = ctx;
  for (const part of dotted.split(".")) {
    if (cur != null && typeof cur === "object" && part in cur) cur = cur[part];
    else return null;
  }
  return cur;
}

export function render(tpl, ctx) {
  // {path} raw · {path|N} toFixed(N) · {path|N|unit} toFixed(N)+unit, where the
  // unit only appears when the value exists — a missing formatted value renders
  // a bare "—" so prose never reads "not recordedσ".
  return String(tpl).replace(
    /\{([A-Za-z_][A-Za-z0-9_.]*)(?:\|(\d)(?:\|([^{}|]{1,8}))?)?\}/g,
    (_, path, digits, unit) => {
      const v = lookup(ctx, path);
      const missing = digits != null ? "—" : MISSING;
      if (v == null || v === "" || (typeof v === "object")) return missing;
      if (digits != null) {
        const f = num(v);
        return f == null ? missing : esc(f.toFixed(+digits) + (unit || ""));
      }
      return esc(v);
    });
}

export function resolveFigure(srcToken, ctx) {
  const m = String(srcToken).match(/^\{(FIG:([A-Za-z0-9_.]+)|MIDFRAME|OCPNG)\}$/);
  if (!m) return null;
  const encId = encodeURIComponent(ctx.id || "");
  if (m[2]) return { url: `./${encId}/${m[2]}`, ok: true };
  if (m[1] === "MIDFRAME") {
    const f = ctx.computed.midframe;
    return f ? { url: `../status/midframes/${f}`, ok: true } : null;
  }
  const oc = ctx.computed.oc_png;
  return oc ? { url: `../status/oc/${encodeURIComponent(oc)}`, ok: true } : null;
}
