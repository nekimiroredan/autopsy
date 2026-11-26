"use strict";

const icons = {
  brand: '<path d="M2 12h5l3-7 4 14 3-7h5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  scan: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 12h10"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  activity: '<path d="M2 13h5l3-8 4 14 3-6h5"/>',
  shield: '<path d="m12 3 8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6l8-3Z"/><path d="m9 12 2 2 4-4"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8v.1"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
};

let locale = document.documentElement.lang;
let messages = JSON.parse(document.querySelector("#messages").textContent);
const t = (key, values = {}) => (messages[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => values[name]);
const ht = (key, values) => esc(t(key, values));
const namespace = prefix => Object.fromEntries(Object.entries(messages)
  .filter(([key]) => key.startsWith(prefix))
  .map(([key, value]) => [key.slice(prefix.length), value]));
let pages = namespace("page.");
let labels = namespace("cause.");
const main = document.querySelector("main");
const currencies = {en: "USD", uz: "UZS", "uz-Cyrl": "UZS", ru: "RUB", tr: "TRY", kk: "KZT", zh: "CNY", es: "EUR", ar: "SAR"};
const currencyFormat = currency => new Intl.NumberFormat(locale, {style: "currency", currency, currencyDisplay: "code"});
let number, date, dateShort, displayMoney;
let rate = 1;
let rateRequest;
function setFormats() {
  number = new Intl.NumberFormat(locale, {maximumFractionDigits: 2});
  date = new Intl.DateTimeFormat(locale, {dateStyle: "medium", timeZone: "UTC"});
  dateShort = new Intl.DateTimeFormat(locale, {month: "short", day: "numeric", timeZone: "UTC"});
  rate = 1;
  displayMoney = currencyFormat("USD");
}
setFormats();
const dateText = value => date.format(new Date(value.slice(0, 10)));
const format = value => value == null ? "—" : number.format(value);
const money = value => value == null ? "—" : `<bdi data-usd="${esc(value)}">${esc(displayMoney.format(value * rate))}</bdi>`;
const pct = value => value == null ? "—" : new Intl.NumberFormat(locale, {style: "percent", maximumFractionDigits: 1}).format(value);
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[char]));
const icon = name => `<svg class="${name === "arrow" ? "icon-directional" : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || ""}</svg>`;
const chip = (name, accent = false) => `<span class="chip ${accent ? "accent" : ""}">${esc(name)}</span>`;
const button = (name, href, symbol, primary = false) => `<a class="btn ${primary ? "primary" : ""}" href="${esc(href)}">${icon(symbol)} ${esc(name)}</a>`;
const exportButtons = () => {
  const path = `/api/runs/${runId}/export?lang=${encodeURIComponent(locale)}`;
  return button(t("ui.csv"), path, "download") +
    button(t("ui.csvLocal"), path + "&headers=localized", "download");
};
const hero = (section, title, subtitle, actions = "") => `<div class="hero"><div>${section ? `<p class="eyebrow">${section}</p>` : ""}<h1>${title}</h1><p>${subtitle}</p></div><div class="actions">${actions}</div></div>`;
const panel = (title, subtitle, body, aside = "") => `<section class="panel"><div class="panel-head"><div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ""}</div>${aside}</div>${body}</section>`;
const stat = (name, value, detail) => `<div class="stat"><span class="label">${name}</span><strong>${value}</strong><small>${detail}</small></div>`;
const empty = content => `<div class="empty">${content}</div>`;
const cause = row => row.anchored ? row.hypotheses[0]?.cause : "opening_balance";
const rank = row => row.value_at_risk ?? Math.abs(row.gap);
const sortCases = rows => [...rows].sort((a, b) => (b.value_at_risk !== null) - (a.value_at_risk !== null) || rank(b) - rank(a) || a.id.localeCompare(b.id));
const caseHref = row => `#autopsy/${encodeURIComponent(row.id)}`;

let runId = "demo";
let run;
let trust;
let uploadFiles = {};
let inspection;
let renderInProgress = 0;
let toastTimeout;

async function api(path, options, language = locale) {
  const url = new URL(path, location.origin);
  url.searchParams.set("lang", language);
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || t("ui.the_request_failed"));
  return payload;
}

function post(path, data) {
  return api(path, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(data)});
}

function toast(message) {
  const node = document.querySelector("#toast");
  node.textContent = message;
  node.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => node.classList.remove("visible"), 3600);
}

function table(headers, rows) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map(header => `<th scope="col">${header}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function caseTable(rows) {
  if (!rows.length) return empty(t("ui.no_cases_match_the_current_view"));
  return table([t("ui.case_id"), t("ui.item"), t("ui.location"), t("ui.gap"), t("ui.value_at_risk_units"), t("ui.leading_cause"), t("ui.confidence"), t("ui.status"), t("ui.suggested_check")],
    rows.map(row => {
      const h = row.hypotheses[0];
      return [
        `<a class="case-link" href="${caseHref(row)}"><bdi>${esc(row.id)}</bdi></a>`, `<bdi>${esc(row.item)}</bdi>`, `<bdi>${esc(row.location)}</bdi>`,
        `<span class="num">${row.anchored ? format(row.gap) : "—"}</span>`,
        `<span class="num">${row.value_at_risk !== null ? money(row.value_at_risk) : row.anchored ? t("ui.units", {v1: format(Math.abs(row.gap))}) : "—"}</span>`,
        esc(row.abstain && row.anchored ? "—" : labels[cause(row)] || "—"),
        row.calibrated && h ? pct(h.confidence) : "—",
        chip(row.abstain ? (row.anchored ? t("ui.abstained") : t("ui.unanchored")) : t("ui.diagnosed"), !row.abstain),
        row.display_check ? `<a title="${esc(row.display_check)}" class="case-link" href="${caseHref(row)}">${ht("ui.view_check")} ${icon("arrow")}</a>` : "—",
      ];
    }));
}

function lineChart(series, {max, percent = false, ideal = false, axisPercent = false, markPeak = false} = {}) {
  if (!series.length) return empty(t("ui.no_observations_to_plot"));
  const w = 460, h = 174, left = 34, right = 424, top = 12, bottom = 144;
  const upper = max || Math.max(4, Math.ceil(Math.max(...series.map(point => point.y)) / 4) * 4);
  const x = (point, index) => left + (right - left) * (point.x ?? (series.length === 1 ? .5 : index / (series.length - 1)));
  const y = point => bottom - (bottom - top) * point.y / upper;
  const points = series.map((point, index) => `${x(point, index)},${y(point)}`).join(" ");
  const grid = Array.from({length: 5}, (_, index) => {
    const value = upper * index / 4;
    return `<path class="grid" d="M${left} ${y({y: value})}H${right}"/><text x="${left - 8}" y="${y({y: value}) + 3}" direction="ltr" text-anchor="end">${percent ? pct(value) : format(value)}</text>`;
  }).join("");
  const peak = markPeak ? series.reduce((best, point) => point.y > best.y ? point : best) : null;
  const marks = series.map((point, index) => {
    const label = point.label ?? format(point.y);
    return `<circle class="chart-point${point === peak ? " chart-peak" : ""}" cx="${x(point, index)}" cy="${y(point)}" r="${point === peak ? 5 : 2.5}"><title>${esc(label)} · ${percent ? pct(point.y) : format(point.y)}</title></circle>`;
  }).join("");
  const ticks = axisPercent ? Array.from({length: 5}, (_, i) =>
    `<text x="${left + (right - left) * i / 4}" y="166" text-anchor="middle">${pct(i / 4)}</text>`).join("") : "";
  const captions = series.filter(point => point.tick).map(point => {
    const index = series.indexOf(point);
    return `<text x="${x(point, index)}" y="166" text-anchor="middle">${esc(point.tick)}</text>`;
  }).join("");
  return `<div class="chart"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${ht("ui.line_chart")}">
    ${grid}${ideal ? `<path d="M${left} ${bottom} ${right} ${top}" stroke="#888" stroke-dasharray="4 5"/>` : `<polygon class="chart-area" points="${x(series[0], 0)},${bottom} ${points} ${x(series.at(-1), series.length - 1)},${bottom}"/>`}
    <polyline points="${points}" class="chart-line" stroke-width="2" fill="none" stroke-linejoin="round"/>${marks}${captions}${ticks}</svg></div>`;
}

function trend(cases) {
  const dateKey = date => date.toISOString().slice(0, 10);
  const buckets = new Map();
  const day = 86400000;
  const dates = cases.map(row => row.window[1].slice(0, 10)).sort();
  if (!dates.length) return [];
  const start = new Date(dates[0]);
  const span = Math.round((new Date(dates.at(-1)) - start) / day) + 1;
  const interval = Math.max(1, Math.ceil(span / 30));
  for (let i = 0; i < span; i += interval) buckets.set(dateKey(new Date(+start + i * day)), 0);
  for (const row of cases) {
    const offset = Math.floor((new Date(row.window[1].slice(0, 10)) - start) / day / interval) * interval;
    const key = dateKey(new Date(+start + offset * day));
    buckets.set(key, buckets.get(key) + 1);
  }
  const every = Math.max(1, Math.ceil(buckets.size / 5));
  return [...buckets].map(([date, y], index) => ({y, label: dateText(date), tick: index % every === 0 ? dateShort.format(new Date(date)) : ""}));
}

function causeBars(cases) {
  const counts = {};
  for (const row of cases) {
    if (cause(row)) counts[cause(row)] = (counts[cause(row)] || 0) + 1;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return empty(t("ui.no_replay_verified_hypotheses_for_this_run"));
  return `<div class="bars">${entries.slice(0, 6).map(([key, count]) => `
    <div><div class="bar-title"><span>${esc(labels[key])}</span><strong>${format(count)}</strong></div>
    <div class="track"><i style="width:${count / entries[0][1] * 100}%"></i></div></div>`).join("")}</div>`;
}

function overview() {
  const anchored = run.cases.filter(row => row.anchored);
  const diagnosed = anchored.filter(row => !row.abstain).length;
  const priced = anchored.filter(row => row.value_at_risk !== null);
  const risk = priced.length ? money(priced.reduce((sum, row) => sum + row.value_at_risk, 0)) :
    t("ui.units", {v1: format(anchored.reduce((sum, row) => sum + Math.abs(row.gap), 0))});
  return hero("", t("ui.overview"), t("ui.investigate_stock_discrepancies_and_trace_each_diagnosis_back_to_the_ledger"),
    button(t("page.upload"), "#upload", "upload", true) +
    `<button type="button" class="btn" id="sample">${ht("ui.sample")}</button>`) +
    (runId === "demo" ? `<div class="banner">${icon("info")}<span><strong>${ht("ui.synthetic_demo_data")}</strong> ${ht("ui.explore_a_simulated_warehouse_before_uploading_your_own_files")}</span></div>` :
      run.source.startsWith("Partial") ? `<div class="banner">${icon("info")}<span><strong>${ht("ui.partial_adapted_public_data")}</strong> ${ht("ui.retail_orders_serve_as_picks_inventory_counts_and_locations_are_simulated")}</span></div>` : "") +
    `<div class="stats">${stat(t("page.discrepancies"), format(anchored.length), t("ui.movements_replayed", {v1: format(run.transactions)}))}
    ${stat(priced.length ? t("ui.value_at_risk") : t("ui.units_at_risk"), risk, priced.length ? t("ui.priced_discrepancies", {v1: format(priced.length)}) : t("ui.absolute_count_differences"))}
    ${stat(t("ui.diagnosed"), format(diagnosed), t("ui.of_anchored_discrepancies", {v1: anchored.length ? pct(diagnosed / anchored.length) : pct(0)}))}
    ${stat(t("ui.abstained"), format(run.cases.length - diagnosed), t("ui.without_an_opening_count", {v1: format(run.cases.length - anchored.length)}))}</div>
    <div class="split">${panel(t("ui.discrepancy_trend"), t("ui.anchored_discrepancies_by_count_date"), lineChart(trend(anchored), {markPeak: true}), chip(run.start && run.end ? `${dateText(run.start)} – ${dateText(run.end)}` : t("ui.no_period")))}
    ${panel(t("ui.leading_hypotheses"), t("ui.top_ranked_candidates_across_anchored_cases"), causeBars(anchored), chip(t("ui.tier", {v1: run.tier}), true))}</div>` +
    panel(t("ui.priority_discrepancies"), t("ui.ranked_by_value_at_risk_where_item_costs_are_available"),
      caseTable(sortCases(anchored).slice(0, 5)) + `<div class="actions panel-footer">${exportButtons()}</div>`,
      button(t("ui.view_all"), "#discrepancies", "arrow"));
}

function discrepancies() {
  const options = values => values.map(value => `<option value="${esc(value)}">${esc(labels[value] || value)}</option>`).join("");
  const locations = [...new Set(run.cases.map(row => row.location))].sort();
  const causes = [...new Set(run.cases.map(cause).filter(Boolean))].sort();
  return hero(t("ui.investigation"), t("page.discrepancies"), t("ui.filter_replay_results_and_open_a_case_to_inspect_its_evidence"),
    exportButtons()) +
    panel(t("ui.case_register"), t("ui.priced_cases_sort_by_value_other_cases_sort_by_absolute_units"), `
    <form id="filters" class="filter">
      <label>${ht("ui.search")}<input name="query" type="search" placeholder="${ht("ui.case_id_item_or_location")}"></label>
      <label>${ht("ui.location")}<select name="location"><option value="">${ht("ui.all_locations")}</option>${options(locations)}</select></label>
      <label>${ht("ui.cause")}<select name="cause"><option value="">${ht("ui.all_causes")}</option>${options(causes)}</select></label>
      <label>${ht("ui.status")}<select name="status"><option value="">${ht("ui.all_statuses")}</option><option value="diagnosed">${ht("ui.diagnosed")}</option><option value="abstain">${ht("ui.abstained")}</option><option value="opening">${ht("ui.unanchored")}</option></select></label>
      <label>${ht("ui.tier_label")}<select name="tier"><option value="">${ht("ui.all_tiers")}</option><option>0</option><option>1</option><option>2</option></select></label>
      <button type="reset" class="btn">${ht("ui.clear_filters")}</button>
    </form><div id="case-table">${caseTable(sortCases(run.cases))}</div>`, chip(t("ui.cases", {v1: format(run.cases.length)})));
}

function bindDiscrepancies() {
  const form = document.querySelector("#filters");
  const update = () => {
    const filters = Object.fromEntries(new FormData(form));
    const query = filters.query.trim().toLowerCase();
    const rows = run.cases.filter(row =>
      (!query || [row.id, row.item, row.location].some(value => value.toLowerCase().includes(query))) &&
      (!filters.location || filters.location === row.location) &&
      (!filters.cause || filters.cause === cause(row)) &&
      (!filters.tier || Number(filters.tier) === row.tier) &&
      (!filters.status || filters.status === (!row.anchored ? "opening" : row.abstain ? "abstain" : "diagnosed")));
    document.querySelector("#case-table").innerHTML = caseTable(sortCases(rows));
  };
  form.addEventListener("input", update);
  form.addEventListener("reset", () => requestAnimationFrame(update));
  form.addEventListener("submit", event => event.preventDefault());
}

function autopsy(caseId) {
  delete main.dataset.caseId;
  const row = run.cases.find(entry => entry.id === decodeURIComponent(caseId ?? "")) || (!caseId ? sortCases(run.cases).find(entry => entry.anchored) || run.cases[0] : null);
  if (!row) return hero(t("ui.investigation"), t("page.autopsy"), t("ui.inspect_one_physical_count_and_the_evidence_behind_its_diagnosis")) +
    panel(t("ui.case_unavailable"), "", empty(t("ui.open_a_case_from_the_discrepancy_register")), button(t("page.discrepancies"), "#discrepancies", "arrow"));
  main.dataset.caseId = row.id;
  const h = row.hypotheses[0];
  const hypotheses = row.hypotheses.map((hypothesis, index) => {
    return `<details ${index === 0 ? "open" : ""}><summary><strong>${esc(labels[hypothesis.cause])}</strong>
      ${row.calibrated && index === 0 ? chip(pct(hypothesis.confidence), true) : ""}</summary>
      <ul>${hypothesis.evidence.map(evidence => `<li>${esc(evidence)}</li>`).join("")}</ul>
      <p class="muted">${ht("ui.likelihood_ratio_ratio_matches_matching_opportunities_out_of_total", {ratio: format(hypothesis.likelihood_ratio), matches: format(hypothesis.competing_matches), total: format(hypothesis.search_space)})}</p>
      </details>`;
  }).join("");
  const check = row.display_check ? `<p>${esc(row.display_check)}</p>` : `<p class="muted">${ht("ui.a_physical_check_is_unavailable_for_this_case")}</p>`;
  const feedback = run.feedback && h && !row.abstain ? `<form id="feedback"><div class="actions">
    <button class="btn" type="submit" name="correct" value="true">${ht("ui.correct")}</button>
    <label><span class="muted">${ht("ui.actual_cause")}</span> <select name="label"><option value="not sure">${ht("ui.not_sure")}</option>${Object.entries(labels).filter(([key]) => key !== "opening_balance").map(([key, label]) => `<option value="${key}">${label}</option>`).join("")}</select></label>
    <button class="btn" type="submit" name="correct" value="false">${ht("ui.wrong")}</button></div></form>` : "";
  return hero(t("ui.investigation"), t("ui.autopsy_label", {v1: esc(row.id)}), `${esc(row.item)} / ${esc(row.location)} · ${row.window[0] ? dateText(row.window[0]) + " – " : t("ui.counted_label")}${dateText(row.window[1])}`,
    button(t("ui.discrepancy_register"), "#discrepancies", "arrow")) +
    `<div class="stats">${stat(t("ui.expected"), format(row.expected), t("ui.ledger_quantity"))}
      ${stat(t("ui.counted"), format(row.counted), t("ui.physical_quantity"))}
      ${stat(t("ui.gap"), row.anchored ? format(row.gap) : "—", t("ui.counted_minus_expected"))}
      ${stat(t("ui.value_at_risk"), money(row.value_at_risk), t("ui.tier", {v1: row.tier}))}</div>
    <div class="split">${panel(row.abstain ? t("ui.why_autopsy_abstained") : t("ui.case_summary"), "", `<div class="panel-body"><p>${esc(row.narrative)}</p>${row.limitations.length ? `<ul>${row.limitations.map(limit => `<li>${esc(limit)}</li>`).join("")}</ul>` : ""}</div>`,
      chip(row.abstain ? t("ui.abstained") : t("ui.diagnosed"), !row.abstain))}
    ${panel(t("ui.recommended_check"), "", `<div class="panel-body">${check}${feedback}</div>`)}</div>
    <div class="stack">${panel(t("ui.ranked_hypotheses"), t("ui.ledger_edits_that_close_the_affected_gaps_in_replay"), hypotheses ? `<div class="panel-body">${hypotheses}</div>` : empty(t("ui.no_hypotheses_available")))}
    ${row.anchored && h ? panel(t("ui.balance_and_ledger_diff"), "", `<div class="panel-body">
      <div class="filter"><label>${ht("ui.hypothesis")}<select id="replay-hypothesis">${row.hypotheses.map((entry, index) => `<option value="${index}">${esc(labels[entry.cause])}</option>`).join("")}</select></label>
      <label><input type="checkbox" id="replay-apply"> ${ht("ui.apply")}</label></div>
      <div id="replay-view" aria-live="polite"></div></div>`) : row.anchored ?
      `<section class="panel"><div class="panel-body">${gapWaterfall(row, row)}</div></section>` : ""}
    ${panel(t("ui.ask_about_the_evidence"), "", `<div class="panel-body"><form id="question" class="actions"><input name="question" aria-label="${ht("ui.question")}" required maxlength="400" placeholder="${ht("question.check")}"><button class="btn">${ht("ui.ask")}</button></form><div id="answer" role="status"></div></div>`)}</div>`;
}

function bindAutopsy() {
  const caseId = main.dataset.caseId && encodeURIComponent(main.dataset.caseId);
  if (!caseId) return;
  const base = `/api/runs/${runId}/cases/${caseId}`;
  bindReplay(base);
  document.querySelector("#feedback")?.addEventListener("submit", async event => {
    event.preventDefault();
    const controls = [...event.currentTarget.elements];
    const {correct, label} = Object.fromEntries(new FormData(event.currentTarget, event.submitter));
    controls.forEach(control => control.disabled = true);
    try {
      await post(base + "/feedback", {correct: correct === "true", label});
      toast(t("ui.feedback_recorded"));
    } catch (error) {
      controls.forEach(control => control.disabled = false);
      toast(error.message);
    }
  });
  document.querySelector("#question")?.addEventListener("submit", async event => {
    event.preventDefault();
    const question = new FormData(event.currentTarget).get("question");
    const answer = document.querySelector("#answer");
    answer.textContent = t("ui.checking_the_evidence");
    try {
      answer.textContent = (await post(base + "/question", {question})).answer;
    } catch (error) {
      answer.textContent = error.message;
    }
  });
}

function balanceChart({points, gap}, comparison) {
  const time = point => Date.parse(point.ts + "Z");
  const start = Math.min(time(points[0]), time(comparison.points[0]));
  const end = Math.max(time(points.at(-1)), time(comparison.points.at(-1)));
  const quantities = [...points, ...comparison.points].map(point => point.quantity);
  const min = quantities.reduce((low, value) => Math.min(low, value));
  const max = quantities.reduce((high, value) => Math.max(high, value));
  const coords = points.map(point => [
    16 + 558 * (time(point) - start) / (end - start || 1),
    130 - 110 * (point.quantity - min) / (max - min || 1),
  ]);
  const lastLedgerPoint = coords.at(-2);
  const physicalCount = coords.at(-1);
  const path = coords.slice(0, -1).map(([x, y], index) => index ? `H${x}V${y}` : `M${x} ${y}`).join("");
  return `<svg class="replay-chart" viewBox="0 0 590 150" role="img" aria-label="${ht("ui.running_ledger_balance_across_the_count_window")}">
    <path d="${path}" fill="none" stroke="currentColor" stroke-width="2"/>
    <path class="replay-gap" d="M${lastLedgerPoint.join(" ")}V${physicalCount[1]}" fill="none" stroke-width="3" stroke-dasharray="4 3"/>
    <circle class="replay-count" cx="${physicalCount[0]}" cy="${physicalCount[1]}" r="4"/>
    </svg><p>${ht("ui.expected_at_count_expected_physical_count_counted_gap_gap", {expected: format(points.at(-2).quantity), counted: format(points.at(-1).quantity), gap: format(gap)})}</p>`;
}

function gapWaterfall(before, after, label) {
  const total = Math.abs(before.gap);
  const residual = Math.abs(after.gap);
  const explained = total - residual;
  const scale = Math.max(total, residual) || 1;
  const bar = (name, amount, offset) => `<div><div class="bar-title"><span>${esc(name)}</span><strong>${format(amount)}</strong></div>
    <div class="track"><i style="margin-inline-start:${Math.max(offset, 0) / scale * 100}%;width:${Math.abs(amount) / scale * 100}%"></i></div></div>`;
  return `<h3>${ht("ui.gap_waterfall")}</h3><div class="bars">${bar(t("ui.total_gap_magnitude"), total, 0)}
    ${label ? bar(label, explained, Math.min(residual, total)) : ""}${bar(t("ui.unexplained_needs_recount"), residual, 0)}</div>`;
}

function ledgerDiff(edits) {
  const value = entry => typeof entry === "number" ? format(entry) : esc(entry);
  return `<ul class="ledger-diff">${edits.map(edit => {
    if (edit.txn) {
      const deleted = edit.op === "delete";
      return `<li class="${deleted ? "diff-delete" : "diff-insert"}"><strong>${deleted ? t("ui.delete") : t("ui.insert")}</strong>
        ${Object.entries(edit.txn).map(([field, entry]) => `<span>${esc(field)} ${value(entry)}</span>`).join(" ")}</li>`;
    }
    const id = esc(edit.txn_id ?? edit.count_id ?? edit.window_id);
    if (edit.op === "book_loss") return `<li>${id} · ${ht("ui.book_loss")} <mark>${format(edit.qty)}</mark></li>`;
    return `<li>${id} · ${esc(edit.field ?? "counted_qty")} <del class="diff-delete">${value(edit.from)}</del>
      <ins class="diff-insert">${value(edit.to)}</ins></li>`;
  }).join("")}</ul>`;
}

function bindReplay(base) {
  const hypothesis = document.querySelector("#replay-hypothesis");
  if (!hypothesis) return;
  const apply = document.querySelector("#replay-apply");
  const view = document.querySelector("#replay-view");
  let requestNumber = 0;
  let data;
  const draw = () => {
    if (!data) return;
    const [visible, other] = apply.checked ? [data.after, data.before] : [data.before, data.after];
    view.innerHTML = balanceChart(visible, other) +
      gapWaterfall(data.before, data.after, hypothesis.selectedOptions[0].textContent) + ledgerDiff(data.edits);
  };
  const load = async () => {
    const number = ++requestNumber;
    data = null;
    view.textContent = t("ui.loading_replay");
    apply.disabled = true;
    try {
      const response = await api(`${base}/replay/${hypothesis.value}`);
      if (number !== requestNumber) return;
      data = response;
      apply.disabled = false;
      draw();
    } catch (error) {
      if (number === requestNumber) view.textContent = error.message;
    }
  };
  hypothesis.addEventListener("change", load);
  apply.addEventListener("change", draw);
  load();
}

function experimentView() {
  return hero(t("ui.investigation"), t("page.experiment"), t("ui.choose_a_transaction_and_test_what_autopsy_reports_on_a_copy_of_this_run")) +
    panel(t("ui.error_experiment"), "", `<div id="experiment-body" class="panel-body" aria-live="polite">${ht("ui.loading_transactions")}</div>`);
}

async function bindExperiment() {
  const body = document.querySelector("#experiment-body");
  const base = `/api/runs/${runId}`;
  try {
    const transactions = await api(base + "/transactions");
    const rows = transactions.filter(row => row.qty_delta !== 0);
    if (!rows.length) {
      body.textContent = t("ui.this_run_has_no_transactions");
      return;
    }
    const locations = [...new Set(transactions.map(row => row.location))].sort();
    const kinds = locations.length > 1 ? ["double_scan", "qty_typo", "wrong_location"] : ["double_scan", "qty_typo"];
    body.innerHTML = `<form class="filter">
      <label>${ht("ui.transaction")}<select name="txn_id">${rows.map(row => `<option value="${esc(row.txn_id)}">${esc(row.txn_id)} · ${esc(row.item)} · ${esc(row.location)} · ${format(row.qty_delta)}</option>`).join("")}</select></label>
      <label>${ht("ui.error_type")}<select name="kind">${kinds.map(kind => `<option value="${kind}">${esc(labels[kind])}</option>`).join("")}</select></label>
      <label id="experiment-destination" hidden>${ht("ui.destination")}<select name="destination"></select></label>
      <button class="btn primary">${ht("ui.run_experiment")}</button>
      </form><div id="experiment-result" role="status"></div>`;
    const form = body.querySelector("form");
    const destination = body.querySelector("#experiment-destination");
    const result = body.querySelector("#experiment-result");
    const button = form.querySelector("button");
    const updateDestination = () => {
      const select = form.elements.destination;
      const current = select.value;
      const origin = rows[form.elements.txn_id.selectedIndex].location;
      select.replaceChildren(...locations.filter(location => location !== origin).map(location => new Option(location)));
      if (current && current !== origin) select.value = current;
      destination.hidden = form.elements.kind.value !== "wrong_location";
      select.disabled = destination.hidden;
    };
    form.addEventListener("change", event => {
      if (event.target !== form.elements.destination) updateDestination();
    });
    updateDestination();
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(form));
      button.disabled = true;
      result.textContent = t("ui.analyzing_the_altered_copy");
      try {
        const response = await post(base + "/experiment", payload);
        const status = !response.affected_windows ? t("ui.no_anchored_count_window_changed") :
          !response.detected ? t("ui.no_discrepancy_was_reported_in_the_affected_windows") :
          response.matched_cause ? t("ui.discrepancy_found_and_error_type_matched") : t("ui.discrepancy_found_the_selected_cause_did_not_match_the_error");
        result.innerHTML = `<p>${status}</p>${response.cases.map(row => `<p><strong>${esc(row.id)}</strong> · ${esc(row.narrative)}</p>`).join("")}`;
      } catch (error) {
        result.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
  } catch (error) {
    body.textContent = error.message;
  }
}

function multipart() {
  const payload = new FormData();
  for (const [kind, file] of Object.entries(uploadFiles)) if (file) payload.append(kind, file);
  return payload;
}

function reportView(report) {
  if (!report) return "";
  const rows = Object.keys(report.rows_read).map(kind =>
    [esc(kind), format(report.rows_read[kind]), format(report.rows_kept[kind]), format(report.rows_dropped[kind])]);
  const coverage = Object.entries(report.coverage).map(([key, value]) => [esc(key), pct(value)]);
  const drops = Object.entries(report.drops).map(([key, value]) => [esc(key), format(value)]);
  const unavailable = [
    ...(report.tier < 1 ? [t("ui.document_matching_and_worker_or_shift_analysis")] : []),
    ...(report.tier < 2 ? [t("ui.pack_size_checks_and_dollar_risk_estimates")] : []),
  ];
  return panel(t("ui.preflight_report"), t("ui.import_counts_data_quality_and_available_features"), table([t("ui.source"), t("ui.read"), t("ui.kept"), t("ui.dropped")], rows) +
    `<div class="panel-body">
      ${unavailable.length ? `<p class="muted">${ht("ui.unavailable_at_this_tier_features", {features: unavailable.join(" · ")})}</p>` : ""}
      ${report.warnings.length ? `<ul>${report.warnings.map(warning => `<li>${esc(warning)}</li>`).join("")}</ul>` : ""}
      <details><summary>${ht("ui.field_coverage")}</summary>${table([t("ui.field"), t("ui.coverage")], coverage)}</details>
      ${drops.length ? `<details open><summary>${ht("ui.dropped_rows_by_reason")}</summary>${table([t("ui.reason"), t("ui.rows")], drops)}</details>` : ""}
    </div>`, chip(t("ui.tier", {v1: report.tier}), true));
}

function mappingView(result) {
  const groups = {movement: t("ui.movement_log"), count: t("ui.physical_counts"), master: t("ui.item_master")};
  return panel(t("ui.confirm_field_mapping"), t("ui.review_the_suggested_matches_and_date_convention_before_replaying_the_ledger"),
    `<form class="panel-body stack" id="mapping-form">
      ${Object.entries(result).map(([kind, info]) => `<fieldset><legend>${groups[kind]}</legend>
        ${info.mapping_source === "cache" ? '<p class="muted">' + ht("ui.using_a_cached_mapping_for_this_file") + '</p>' : ""}
        <div class="fields">
        ${Object.entries(info.fields).map(([field, suggestion]) => `
          <label>${esc(field)} · ${suggestion.column == null ? t("ui.unmapped") : pct(suggestion.confidence)}
            <select name="${kind}:${field}" data-kind="${kind}">
              <option value="">${ht("ui.unmapped")}</option>
              ${info.columns.map(col => `<option value="${esc(col)}" ${suggestion.column === col ? "selected" : ""}>${esc(col)}</option>`).join("")}
            </select><small class="mapping-sample">${esc(info.samples?.[suggestion.column]?.join(" · "))}</small></label>`).join("")}
        </div></fieldset>`).join("")}
      <div class="filter" style="padding:0"><label>${ht("ui.ambiguous_date_order")}
        <select name="date_order"><option value="true">${ht("ui.day_month_year")}</option><option value="false">${ht("ui.month_day_year")}</option></select>
        </label><button type="submit" class="btn primary">${icon("activity")} ${ht("ui.confirm_analyze")}</button></div>
    </form>`);
}

function upload() {
  return hero(t("ui.data_workspace"), t("page.upload"), t("ui.import_your_warehouse_movements_and_physical_counts"),
    button(t("ui.open_demo"), "#overview", "grid")) +
    `<div class="stack">${panel(t("ui.warehouse_files"), t("ui.csv_tsv_or_xlsx_up_to_size_mb_per_upload", {size: format(32)}),
      `<form id="upload-form" class="panel-body"><div class="upload-zone" id="drop-zone">
        <span>${icon("upload")}</span><strong>${ht("ui.drop_a_movement_log_or_combined_workbook")}</strong>
        <label><span class="muted" id="movement-file">${esc(uploadFiles.movements?.name || t("ui.choose_a_movement_log"))}</span>
          <input type="file" name="movements" accept=".csv,.tsv,.xlsx,.xlsm,.txt" aria-label="${ht("ui.movement_log")}"></label>
      </div><div class="fields">
        <label>${ht("ui.physical_counts_if_separate")}<input type="file" name="counts" accept=".csv,.tsv,.xlsx,.xlsm,.txt"><small>${esc(uploadFiles.counts?.name)}</small></label>
        <label>${ht("ui.item_master_optional")}<input type="file" name="master" accept=".csv,.tsv,.xlsx,.xlsm,.txt"><small>${esc(uploadFiles.master?.name)}</small></label>
      </div><p id="upload-status" class="error" role="alert"></p><button class="btn primary" type="submit">${icon("scan")} ${ht("ui.inspect_columns")}</button></form>`)}
      <div id="mapping">${inspection ? mappingView(inspection) : ""}</div>
      <div id="report">${reportView(run?.report)}${run?.report ? `<p>${button(t("ui.open_discrepancies"), "#discrepancies", "arrow", true)}</p>` : ""}</div></div>`;
}

function bindUpload() {
  const form = document.querySelector("#upload-form");
  const status = document.querySelector("#upload-status");
  const drop = document.querySelector("#drop-zone");
  const setFile = (kind, file) => {
    uploadFiles[kind] = file;
    inspection = undefined;
    document.querySelector("#mapping").replaceChildren();
    status.textContent = "";
    if (kind === "movements") document.querySelector("#movement-file").textContent = file?.name || t("ui.choose_a_movement_log");
  };
  form.querySelectorAll("[type=file]").forEach(input => input.addEventListener("change", () => setFile(input.name, input.files[0])));
  drop.addEventListener("dragover", event => {event.preventDefault(); drop.dataset.drag = "";});
  drop.addEventListener("dragleave", () => delete drop.dataset.drag);
  drop.addEventListener("drop", event => {
    event.preventDefault();
    delete drop.dataset.drag;
    const file = event.dataTransfer.files[0];
    if (file) setFile("movements", file);
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    event.submitter.disabled = true;
    status.textContent = "";
    try {
      inspection = await api("/api/inspect", {method: "POST", body: multipart()});
      document.querySelector("#mapping").innerHTML = mappingView(inspection);
      if (!inspection.count) {
        status.textContent = t("ui.add_a_physical_count_file_before_analysis");
        document.querySelector("#mapping-form button[type=submit]").disabled = true;
      }
      bindMapping();
      document.querySelector("#mapping").scrollIntoView({behavior: "smooth", block: "nearest"});
    } catch (error) {
      status.textContent = error.message;
    } finally {
      event.submitter.disabled = false;
    }
  });
  if (inspection) bindMapping();
  document.querySelector(".hero a").addEventListener("click", async event => {
    event.preventDefault();
    try {
      const demo = await api("/api/runs/demo");
      runId = "demo";
      run = demo;
      sessionStorage.removeItem("autopsy-run");
      location.hash = "overview";
    } catch (error) {
      toast(error.message);
    }
  });
}

function bindMapping() {
  const form = document.querySelector("#mapping-form");
  if (!inspection.count) form.querySelector("button[type=submit]").disabled = true;
  const status = document.querySelector("#upload-status");
  form.querySelectorAll("select[data-kind]").forEach(select => select.addEventListener("change", () => {
    select.nextElementSibling.textContent = inspection[select.dataset.kind].samples?.[select.value]?.join(" · ") || "";
  }));
  form.addEventListener("submit", async event => {
    event.preventDefault();
    event.submitter.disabled = true;
    const previous = event.submitter.innerHTML;
    event.submitter.textContent = t("ui.replaying_ledger");
    const mapping = {};
    const payload = multipart();
    for (const [key, value] of new FormData(form)) {
      if (key === "date_order") {
        payload.append("day_first", value);
      } else if (key === "source") {
        payload.append(key, value);
      } else {
        const [kind, field] = key.split(":");
        (mapping[kind] ??= {})[field] = value || null;
      }
    }
    payload.append("mapping", JSON.stringify(mapping));
    try {
      const result = await api("/api/analyze", {method: "POST", body: payload});
      run = await api(`/api/runs/${result.run_id}`);
      runId = result.run_id;
      sessionStorage.setItem("autopsy-run", runId);
      updateSource();
      document.querySelector("#report").innerHTML = reportView(result.report) +
        `<p>${button(t("ui.open_discrepancies"), "#discrepancies", "arrow", true)}</p>`;
      document.querySelector("#report").scrollIntoView({behavior: "smooth", block: "start"});
      toast(t("ui.ledger_replay_complete"));
    } catch (error) {
      status.textContent = error.message;
      status.scrollIntoView({behavior: "smooth", block: "nearest"});
    } finally {
      event.submitter.disabled = false;
      event.submitter.innerHTML = previous;
    }
  });
}

function hotspotTable(rows) {
  if (!rows.length) return empty(t("ui.no_slices_meet_the_minimum_exposure_for_this_view"));
  return table([t("ui.slice"), t("ui.exposure"), t("ui.evidence_events"), t("ui.estimated_rate"), t("ui.confidence_interval", {confidence: pct(.95)}), t("ui.adjusted_q"), t("ui.status"), t("ui.estimated_excess"), t("ui.potential_value")],
    rows.map(row => [
      esc(row.slice), format(row.exposure), format(row.errors), pct(row.rate),
      `${pct(row.lower)} – ${pct(row.upper)}`, format(row.q),
      chip(row.significant ? t("ui.significant") : t("ui.monitor"), row.significant), format(row.excess),
      row.value == null ? t("ui.unavailable") : money(row.value),
    ]));
}

function hotspots() {
  const options = [...new Set(run.hotspots.map(row => row.dimension))].sort((a, b) => (b === "location") - (a === "location"));
  const tiles = run.shift_tiles ?? [];
  const shifts = [...new Set(tiles.map(row => row.shift))].sort();
  const locations = [...new Set(tiles.map(row => row.location))];
  const bySlice = new Map(tiles.map(row => [JSON.stringify([row.location, row.shift]), row]));
  const tileMap = locations.length ? table([t("ui.location"), ...shifts.map(esc)], locations.map(location => [
    esc(location), ...shifts.map(shift => {
      const row = bySlice.get(JSON.stringify([location, shift]));
      return row ? `<span class="rate-tile" style="--rate:${row.rate * 100}%">${pct(row.rate)}<small>${format(row.errors)} / ${format(row.exposure)}</small></span>` : "—";
    }),
  ])) : empty(t("ui.no_transactions_with_recorded_shifts"));
  return hero(t("ui.patterns"), t("page.hotspots"), t("ui.compare_estimated_error_rates_across_warehouse_operations")) +
    `<div class="stack">${panel(t("ui.estimated_error_rates"), t("ui.jeffreys_posterior_intervals_benjamini_hochberg_adjustment"),
      `<div class="filter">      <label>${ht("ui.group_by")}<select id="hotspot-group">${options.map(option => `<option value="${esc(option)}">${esc(t("dimension." + option))}</option>`).join("")}</select></label>
      <label>${ht("ui.significance")}<select id="hotspot-filter"><option value="all">${ht("ui.all_eligible_slices")}</option><option value="significant">${ht("ui.significant_only")}</option></select></label></div>
      <div id="hotspot-bars"></div><div id="hotspot-table"></div>`)}
    ${run.tier >= 1 ? panel(t("ui.location_by_shift"), t("ui.share_of_transactions_linked_to_diagnosed_evidence"), tileMap) : ""}
    ${panel(t("ui.counterfactual"), t("ui.estimated_excess_events_if_a_slice_matched_its_group_median"),
      `<div class="panel-body"><p>${ht("ui.excess_events_are_the_rate_above_the_median_multiplied_by_exposure_the_value_estimate_multiplies_that_excess_by_observed_average_value_at_risk_when_available")}</p><p class="muted">${ht("ui.rates_use_detected_evidence_events_and_may_underrepresent_errors_the_system_abstained_on_potential_value_is_an_estimate_under_the_stated_assumptions")}</p></div>`)}</div>`;
}

function bindHotspots() {
  const group = document.querySelector("#hotspot-group");
  const filter = document.querySelector("#hotspot-filter");
  const draw = () => {
    const rows = run.hotspots.filter(row => row.dimension === group.value && row.q != null && (filter.value === "all" || row.significant))
      .sort((a, b) => Number(b.significant) - Number(a.significant) || b.rate - a.rate);
    document.querySelector("#hotspot-table").innerHTML = hotspotTable(rows);
    document.querySelector("#hotspot-bars").innerHTML = rows.length ? `<div class="bars">${rows.slice(0, 6).map(row => `
      <div><div class="bar-title"><span>${esc(row.slice)}</span><strong>${pct(row.rate)} · ${pct(row.lower)}–${pct(row.upper)}</strong></div>
      <div class="track"><i style="width:${row.rate * 100}%"></i></div></div>`).join("")}</div>` : "";
  };
  group.addEventListener("change", draw);
  filter.addEventListener("change", draw);
  draw();
}

function trustView() {
  const title = hero(t("ui.evaluation"), t("page.trust"), t("ui.review_reproducible_synthetic_benchmarks_calibration_and_coverage"));
  const notice = `<div class="banner">${icon("info")}<span><strong>${ht("ui.synthetic_data")}</strong> ${ht("ui.detection_f1_is_by_construction_the_benchmark_counts_observable_gaps_created_by_the_generator_and_checks_whether_ledger_replay_flags_them_real_warehouse_performance_needs_field_validation")}</span></div>`;
  if (!trust) return title + notice + panel(t("ui.evaluation_unavailable"), "", empty(t("ui.generate_the_evaluation_artifacts_with_code_python_m_eval_run_all_code_then_refresh_this_page")));
  const metrics = trust.metrics ?? trust;
  const overall = metrics.summary?.overall ?? metrics.summary ?? {};
  const reliability = metrics.reliability?.blind ?? metrics.reliability ?? {};
  const bins = (reliability.bins ?? []).map(bin => ({x: bin.confidence, y: bin.accuracy, label: t("ui.predicted_n", {v1: pct(bin.confidence), v2: format(bin.count)})}));
  const coverage = (metrics.coverage_curve ?? []).filter(row => row.selective_accuracy != null || row.accuracy != null)
    .map(row => ({x: row.coverage, y: row.selective_accuracy ?? row.accuracy, label: t("ui.coverage_label", {v1: pct(row.coverage)})}));
  const byCause = Array.isArray(metrics.by_cause) ? metrics.by_cause : [];
  const gates = Object.entries(metrics.gates ?? {}).map(([key, gate]) =>
    [esc(key), format(gate.actual), format(gate.target), chip(gate.pass ? t("ui.passed") : t("ui.missed"), !gate.pass)]);
  const missed = trust.missed_gates;
  const thresholds = ["easy", "medium", "hard"].flatMap(difficulty =>
    (metrics.coverage_at_threshold_by_difficulty?.[difficulty] ?? []).map(row =>
      [esc(difficulty), pct(row.threshold), pct(row.coverage), pct(row.accuracy), format(row.support)]));
  const curve = trustCurve();
  const comparisons = (mapping = {}) => table([t("ui.variant"), t("ui.top_1"), t("ui.coverage"), "Δ Top 1", t("ui.status")],
    Object.entries(mapping).map(([key, row]) =>
      [esc(key.replaceAll("_", " ")), pct(row.top1), pct(row.coverage), pct(row.delta_top1), esc(row.status || t("ui.measured"))]));
  const measurements = (mapping, label) => {
    if (!mapping) return empty(t("ui.no_results_were_generated"));
    return table([label, t("ui.result")], Object.entries(mapping).map(([key, value]) =>
      [esc(key.replaceAll("_", " ")), typeof value === "object" && value !== null ?
        esc(Object.entries(value).map(([field, metric]) => `${field.replaceAll("_", " ")} ${typeof metric === "number" ? format(metric) : typeof metric === "object" ? JSON.stringify(metric) : metric}`).join(" · ")) :
        esc(value === null ? "—" : value)]));
  };
  return title + notice + `
    <div class="stats">${stat(t("ui.detection_f1"), pct(overall.detection_f1 ?? overall.detection?.f1), t("ui.discrepancy_detection"))}
      ${stat(t("ui.top_1_accuracy"), pct(overall.top1 ?? overall.top_1), t("ui.single_cause_windows"))}
      ${stat(t("ui.coverage"), pct(overall.coverage), t("ui.cases_with_a_selected_cause"))}
      ${stat(t("ui.blind_ece"), pct(reliability.ece), t("ui.expected_calibration_error"))}</div>
    <div class="split">${panel(t("ui.reliability"), t("ui.calibrated_probability_vs_observed_accuracy"), lineChart(bins, {max: 1, percent: true, ideal: true, axisPercent: true}))}
    ${panel(t("ui.coverage_vs_accuracy"), t("ui.selective_accuracy_as_more_cases_are_answered"), lineChart(coverage, {max: 1, percent: true, axisPercent: true}))}</div>
    <div class="stack">${panel(t("ui.trust_dial"), t("ui.choose_a_measured_point_from_the_stored_coverage_curve_tied_confidence_scores_may_share_a_threshold"),
      curve.length ? `<div class="panel-body"><label>${ht("ui.confidence_threshold")} <input id="trust-dial" type="range" min="0" max="${curve.length - 1}" value="0"></label>
      <output id="trust-point" for="trust-dial" aria-live="polite"></output></div>` : empty(t("ui.no_measured_coverage_curve")))}
    ${panel(t("ui.thresholds_by_difficulty"), t("ui.single_cause_windows_meeting_each_confidence_threshold"),
      thresholds.length ? table([t("ui.difficulty"), t("ui.confidence_threshold"), t("ui.coverage"), t("ui.selective_accuracy"), t("ui.support")], thresholds) : empty(t("ui.no_threshold_measurements_available")))}
    ${panel(t("ui.accuracy_by_cause"), t("ui.single_cause_windows_by_difficulty"),
      byCause.length ? table([t("ui.difficulty"), t("ui.cause"), t("ui.support"), t("ui.top_1"), t("ui.top_3")], byCause.map(row =>
        [esc(row.difficulty), esc(labels[row.cause] || row.cause), format(row.support), pct(row.top1 ?? row.top_1), pct(row.top3 ?? row.top_3)])) : measurements(metrics.by_cause, t("ui.cause")))}
    ${panel(t("ui.baselines"), "", comparisons(metrics.baselines))}
    ${panel(t("ui.ablations"), "", comparisons(metrics.ablations))}
    ${panel(t("ui.evaluation_gates"), "", gates.length ? table([t("ui.gate"), t("ui.observed"), t("ui.threshold"), t("ui.status")], gates) : empty(t("ui.no_gate_results")))}
    ${panel(t("ui.missed_gates_and_known_limitations"), t("ui.from_the_published_evaluation_report"),
      `<div class="panel-body">${missed?.length ? table([t("ui.missed_gate"), t("ui.observed"), t("ui.threshold")], missed.map(gate =>
        [esc(gate.name), esc(gate.measured), esc(gate.target)])) : missed ? `<p>${ht("ui.no_missed_gates_reported")}</p>` : ""}
        ${trust.limitations?.length ? trust.limitations.map(line => `<p>${esc(line)}</p>`).join("") : empty(t("ui.no_published_limitations_available"))}</div>`)}</div>`;
}

function trustCurve() {
  return ((trust?.metrics ?? trust)?.coverage_curve ?? []).filter(row => typeof row.threshold === "number")
    .slice().sort((a, b) => a.threshold - b.threshold);
}

function bindTrust() {
  const dial = document.querySelector("#trust-dial");
  if (!dial) return;
  const curve = trustCurve();
  const output = document.querySelector("#trust-point");
  const draw = () => {
    const row = curve[Number(dial.value)];
    output.textContent = t("ui.threshold_coverage_selective_accuracy", {v1: pct(row.threshold), v2: pct(row.coverage), v3: pct(row.selective_accuracy ?? row.accuracy)});
    dial.setAttribute("aria-valuetext", output.textContent);
  };
  dial.addEventListener("input", draw);
  draw();
}

function sourceLabel(source) {
  if (source === "Synthetic demo") return t("source.demo");
  if (source.startsWith("Partial")) return t("source.partial");
  return t("source.uploaded");
}

function updateSource() {
  document.querySelector("#sidebar-source").textContent = sourceLabel(run.source);
  document.querySelector("#sidebar-detail").textContent = t("ui.tier_movements", {v1: run.tier, v2: format(run.transactions)});
  document.querySelector("#header-source").innerHTML = `<span class="status-dot"></span> ${runId === "demo" ? t("ui.synthetic") : esc(sourceLabel(run.source))}`;
}

async function render() {
  const token = ++renderInProgress;
  const [path, caseId] = location.hash.slice(1).split("/");
  const page = Object.hasOwn(pages, path) ? path : "overview";
  document.title = t("ui.autopsy", {v1: pages[page]});
  document.querySelector("#breadcrumb").textContent = pages[page];
  for (const link of document.querySelectorAll("[data-page]")) {
    if (link.dataset.page === page) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  document.body.classList.remove("menu-open");
  try {
    if (page === "trust") {
      main.innerHTML = empty(ht("ui.loading"));
      trust = await api("/api/trust");
    }
    if (token !== renderInProgress) return;
    const renderer = {overview, discrepancies, autopsy, upload, hotspots, trust: trustView, experiment: experimentView}[page];
    main.innerHTML = renderer(caseId);
    const bind = {overview: bindSample, discrepancies: bindDiscrepancies, autopsy: bindAutopsy, upload: bindUpload, hotspots: bindHotspots, experiment: bindExperiment, trust: bindTrust}[page];
    if (bind) bind();
    window.scrollTo(0, 0);
  } catch (error) {
    if (token === renderInProgress) main.innerHTML = empty(esc(error.message));
  }
}

function bindSample() {
  const button = document.querySelector("#sample");
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = t("ui.loading_sample_data");
    try {
      const sample = await api("/api/runs/demo");
      run = sample;
      runId = "demo";
      sessionStorage.removeItem("autopsy-run");
      updateSource();
      await render();
    } catch (error) {
      button.disabled = false;
      button.textContent = t("ui.sample");
      toast(error.message);
    }
  });
}

document.querySelectorAll("[data-icon]").forEach(node => node.innerHTML = icon(node.dataset.icon));
document.querySelector("#menu").addEventListener("click", () => document.body.classList.toggle("menu-open"));
document.addEventListener("keydown", event => {
  if (event.key === "Escape") document.body.classList.remove("menu-open");
});

async function loadDisplayCurrency() {
  rateRequest?.abort();
  const request = new AbortController();
  rateRequest = request;
  const currency = currencies[locale] ?? "USD";
  const status = document.querySelector("#display-currency");
  status.textContent = "USD";
  if (currency === "USD") return;
  status.textContent = `USD → ${currency}…`;
  try {
    const response = await fetch(`https://api.frankfurter.dev/v2/rate/USD/${currency}`, {
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
    });
    if (!response.ok) throw new Error("Exchange rate unavailable");
    const quote = await response.json();
    if (request.signal.aborted) return;
    if (quote.base !== "USD" || quote.quote !== currency || !Number.isFinite(quote.rate) || quote.rate <= 0 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(quote.date)) throw new Error("Invalid exchange rate");
    const quoteDate = dateText(quote.date);
    rate = quote.rate;
    displayMoney = currencyFormat(currency);
    status.textContent = `${currency} · ${quoteDate}`;
    for (const element of main.querySelectorAll("[data-usd]")) {
      element.textContent = displayMoney.format(Number(element.dataset.usd) * rate);
    }
  } catch {
    if (!request.signal.aborted) status.textContent = "USD";
  }
}

async function start() {
  languageSelect.disabled = true;
  loadDisplayCurrency();
  try {
    const recent = sessionStorage.getItem("autopsy-run");
    if (recent) {
      try {
        run = await api(`/api/runs/${recent}`);
        runId = recent;
      } catch {
        sessionStorage.removeItem("autopsy-run");
      }
    }
    if (!run) run = await api("/api/runs/demo");
    updateSource();
    window.addEventListener("hashchange", render);
    await render();
  } catch (error) {
    main.innerHTML = empty(esc(error.message));
  } finally {
    languageSelect.disabled = false;
  }
}
const languageSelect = document.querySelector("#language");
languageSelect.addEventListener("change", async () => {
  const language = languageSelect.value;
  const selectedRunId = runId;
  languageSelect.disabled = true;
  try {
    const url = new URL(location.href);
    url.searchParams.set("lang", language);
    const [response, localizedRun] = await Promise.all([
      fetch(url), api(`/api/runs/${selectedRunId}`, undefined, language),
    ]);
    if (!response.ok) throw new Error(t("ui.the_request_failed"));
    const shell = new DOMParser().parseFromString(await response.text(), "text/html");
    if (selectedRunId !== runId) throw new Error(t("ui.the_request_failed"));

    locale = shell.documentElement.lang;
    document.documentElement.lang = locale;
    document.documentElement.dir = shell.documentElement.dir;
    messages = JSON.parse(shell.querySelector("#messages").textContent);
    pages = namespace("page.");
    labels = namespace("cause.");
    setFormats();
    run = localizedRun;
    for (const selector of [".skip", ".sidebar", ".breadcrumb > span:first-of-type"]) {
      const replacement = shell.querySelector(selector);
      document.querySelector(selector).replaceWith(replacement);
      replacement.querySelectorAll("[data-icon]").forEach(node => node.innerHTML = icon(node.dataset.icon));
    }
    for (const selector of ["#menu", "#language"]) {
      document.querySelector(selector).setAttribute("aria-label", shell.querySelector(selector).getAttribute("aria-label"));
    }
    url.hash = location.hash;
    history.replaceState(null, "", url);
    updateSource();
    loadDisplayCurrency();
    await render();
  } catch (error) {
    languageSelect.value = locale;
    toast(error.message);
  } finally {
    languageSelect.disabled = false;
  }
});
start();
