/* Step 8: the visitor's sandbox decision. Never POSTs anywhere — the real
   review gate lives in expert.html and requires the local control API. */
import { esc } from "./interp.js?v=20260730a";

const MATCH = {
  approve: ["ACCURATE", "NOISY-CONSISTENT"],
  reject: ["INACCURATE", "NON-DETECTION"],
  flag: ["MARGINAL"],
};
const CHIPS = {
  approve: ["Clean dip, scores in range", "Noise behaves honestly", "Timing on the clock"],
  reject: ["Scatter rivals the dip", "Dip not convincing", "Timing far off", "Scores outside 2σ"],
  flag: ["Something odd — needs an expert", "One score off, rest fine", "Coverage looks thin"],
};

const KEY = "review-journey-history";
function history() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; }
  catch (e) { return []; }
}
function remember(entry) {
  try {
    const h = history().filter((e) => e.id !== entry.id);
    h.push(entry);
    localStorage.setItem(KEY, JSON.stringify(h));
  } catch (e) { /* private mode: tally degrades, journey works */ }
}

export function renderDecision(mount, ctx, indexRow) {
  const checklist = (ctx.checklist || []).map((c) =>
    `<tr><td>${esc(c.label)}</td><td class="mono">${esc(c.value == null ? "—" : c.value)}${esc(c.unit || "")}</td>` +
    `<td>${esc(c.note || "")}</td></tr>`).join("");
  mount.innerHTML = `
    <div class="table-wrap"><div class="table-title">What you saw — the recap</div>
      <table class="data-table"><thead><tr><th>Check</th><th>Value</th><th>Note</th></tr></thead>
      <tbody>${checklist}</tbody></table></div>
    <div class="j-choice">
      <h3>Your call</h3>
      <div class="j-choice-btns">
        <button class="btn btn--approve" data-choice="approve">Approve</button>
        <button class="btn btn--redo" data-choice="flag">Flag for an expert</button>
        <button class="btn btn--reject" data-choice="reject">Reject</button>
      </div>
      <div class="j-chips" id="chips" hidden></div>
      <button class="btn" id="commitBtn" hidden>Lock it in</button>
    </div>
    <div id="reveal" hidden></div>`;
  let choice = null, chip = null;
  const chipsEl = mount.querySelector("#chips");
  const commitBtn = mount.querySelector("#commitBtn");
  mount.querySelectorAll("[data-choice]").forEach((b) => b.addEventListener("click", () => {
    choice = b.dataset.choice; chip = null;
    mount.querySelectorAll("[data-choice]").forEach((x) => x.classList.toggle("sel", x === b));
    chipsEl.hidden = false;
    chipsEl.innerHTML = CHIPS[choice].map((c, i) =>
      `<button class="icon-btn chip" data-chip="${i}">${esc(c)}</button>`).join("");
    chipsEl.querySelectorAll(".chip").forEach((cb) => cb.addEventListener("click", () => {
      chip = CHIPS[choice][+cb.dataset.chip];
      chipsEl.querySelectorAll(".chip").forEach((x) => x.classList.toggle("sel", x === cb));
      commitBtn.hidden = false;
    }));
    commitBtn.hidden = true;
  }));
  commitBtn.addEventListener("click", () => reveal(mount, ctx, choice, chip));
}

function reveal(mount, ctx, choice, chip) {
  const verdict = ctx.verdict || "UNKNOWN";
  const matched = (MATCH[choice] || []).includes(verdict);
  remember({ id: ctx.id, choice, matched, ts: Date.now() });
  const h = history();
  const n = h.length, m = h.filter((e) => e.matched).length;
  const operatorLine = ctx.decision_required
    ? "This dossier is in the operator's live queue — a human ruling is still pending. You saw it first."
    : `Pipeline disposition: ${esc(ctx.disposition || "recorded")}`;
  const el = mount.querySelector("#reveal");
  el.hidden = false;
  el.innerHTML = `
    <div class="recommend ${matched ? "good" : "warn"}">
      <span class="rec-tag">${matched ? "You matched the pipeline" : "You and the pipeline disagree"}</span>
      <div class="rec-line">You said <b>${esc(choice)}</b> (“${esc(chip)}”). The pipeline's verdict:
        <span class="badge-verdict sm" data-verdict="${esc(verdict)}">${esc(verdict)}</span>.
        ${esc(ctx.recommend_line || "")}</div>
      <div class="rec-line">${operatorLine}</div>
      <div class="rec-line">Matching guide: approve ↔ ACCURATE / NOISY-CONSISTENT · reject ↔ INACCURATE / NON-DETECTION · flag ↔ MARGINAL.
        Disagreeing with the pipeline is allowed — that is why humans hold the gate.</div>
      <div class="rec-line mono">${n} night${n === 1 ? "" : "s"} reviewed · ${m} matched</div>
    </div>`;
  mount.querySelectorAll(".j-choice-btns .btn, .chip, #commitBtn")
       .forEach((b) => { b.disabled = true; });
  // let the journey engine react (rail ✓ refresh, next-night continuation)
  mount.dispatchEvent(new CustomEvent("journey:decided",
                                      { bubbles: true, detail: { id: ctx.id } }));
  el.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
