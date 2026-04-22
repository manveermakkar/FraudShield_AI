/**
 * FraudShield AI — Dashboard JavaScript
 * Updated: Refresh fix, alerts (checkbox, priority, snooze), about comparison chart
 */
"use strict";

let G = {
  modelData: null,
  charts: {},
  alerts: [],
  txPool: [],
  feedSize: 12,
  riskThreshold: 50,
  priorityFilter: 0,
  chartOpacity: 0.8,
  autoRefreshTimer: null,
  autoRefreshSeconds: 0,
  snoozeTimer: null,
  snoozeEndTime: null,
  snoozeInterval: null,
};

const $ = id => document.getElementById(id);
const fmt = n => n?.toLocaleString() ?? "—";

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll(".nav-item").forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    btn.classList.add("active");
    const el = $(`tab-${tab}`);
    if (el) el.classList.add("active");
    const titles = { overview:"System Overview", models:"Model Analytics", predict:"Live Predict", transactions:"Transactions", alerts:"Active Alerts", about:"About This Project" };
    $("topbarTitle").textContent = titles[tab] || tab;
    // Build about chart only when tab opens (canvas not visible earlier)
    if (tab === "about" && G.modelData) buildAboutPerfChart();
  });
});

$("hamburger")?.addEventListener("click", () => {
  document.getElementById("sidebar").classList.toggle("open");
});

// ── Sidebar Slider Handlers ────────────────────────────────────────────────────
function onSliderRisk(v) {
  G.riskThreshold = parseInt(v);
  $("valRisk").textContent = v + "%";
  renderTransactions();
}

function onSliderPriority(v) {
  G.priorityFilter = parseInt(v);
  const labels = ["All", "Medium+", "High Only"];
  $("valPriority").textContent = labels[v];
  renderAlertFeed();
}

function onSliderFeed(v) {
  G.feedSize = parseInt(v);
  $("valFeed").textContent = v;
  renderTransactions();
}

function onSliderRefresh(v) {
  const seconds = [0, 5, 15, 30, 60][parseInt(v)];
  G.autoRefreshSeconds = seconds;
  const labels = ["Off", "5s", "15s", "30s", "60s"];
  $("valRefresh").textContent = labels[parseInt(v)];
  clearInterval(G.autoRefreshTimer);
  G.autoRefreshTimer = null;
  if (seconds > 0) {
    G.autoRefreshTimer = setInterval(() => {
      generateNewTransactions();
      renderTransactions();
      updateTxTimestamp();
    }, seconds * 1000);
    $("txRefreshStatus").textContent = `Auto ↻ ${labels[parseInt(v)]}`;
  } else {
    $("txRefreshStatus").textContent = "";
  }
}

function onSliderOpacity(v) {
  G.chartOpacity = parseInt(v) / 100;
  $("valOpacity").textContent = v + "%";
  if (G.modelData) buildPRChart(G.modelData);
}

// ── Fetch model data ──────────────────────────────────────────────────────────
async function loadModelData() {
  try {
    const res = await fetch("/api/model-data");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    G.modelData = await res.json();
    populateOverview();
    populateModels();
    initTransactionPool();
    buildTransactions();
    initAlerts();
    buildAlerts();
  } catch (err) {
    console.error("Could not load model data:", err);
  }
}

// ── OVERVIEW ──────────────────────────────────────────────────────────────────
function populateOverview() {
  const d = G.modelData;
  if (!d) return;
  const best  = d.model_results[d.best_model];
  const stats = d.dataset_stats;
  $("m-total").textContent     = fmt(stats.total_transactions);
  $("m-fraud").textContent     = fmt(stats.fraud_count);
  $("m-fraud-pct").textContent = `${stats.fraud_pct}% of total`;
  $("m-auroc").textContent     = best.auroc.toFixed(4);
  $("m-auprc").textContent     = best.auprc.toFixed(4);
  $("m-f1").textContent        = best.f1.toFixed(4);
  $("m-fraud-amt").textContent = `$${stats.amount_stats.fraud_mean}`;
  $("m-legit-amt").textContent = `vs $${stats.amount_stats.legit_mean} legit avg`;
  $("leg-legit").textContent   = `Legitimate ${fmt(stats.legit_count)}`;
  $("leg-fraud").textContent   = `Fraud ${fmt(stats.fraud_count)}`;
  buildDistChart(stats);
  buildHourChart(d.fraud_by_hour);
  buildFeatureBars(d.feature_importance);
}

function buildDistChart(stats) {
  const ctx = $("distChart");
  if (!ctx) return;
  if (G.charts.dist) G.charts.dist.destroy();
  G.charts.dist = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Legitimate", "Fraud"],
      datasets: [{ data: [stats.legit_count, stats.fraud_count], backgroundColor: ["#00d4ff","#ff3b6e"], borderWidth: 0, hoverOffset: 6 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "68%",
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.label}: ${fmt(c.raw)}` } } },
    },
  });
}

function buildHourChart(fraudByHour) {
  const el = $("hourBars");
  if (!el || !fraudByHour) return;
  el.innerHTML = "";
  const vals = Array.from({ length: 24 }, (_, i) => fraudByHour[String(i)] || 0);
  const max  = Math.max(...vals);
  vals.forEach((v, i) => {
    const bar = document.createElement("div");
    bar.className = "hour-bar";
    bar.style.height = `${(v / max) * 100}%`;
    bar.style.background = `rgba(255,59,110,${0.3 + 0.7 * (v / max)})`;
    bar.title = `${i.toString().padStart(2,"0")}:00 — ${v} fraud case${v !== 1 ? "s" : ""}`;
    el.appendChild(bar);
  });
}

function buildFeatureBars(fi) {
  const el = $("featureBars");
  if (!el || !fi) return;
  el.innerHTML = "";
  const entries = Object.entries(fi);
  const max = entries[0]?.[1] || 1;
  entries.forEach(([name, val]) => {
    const row = document.createElement("div");
    row.className = "feat-row";
    row.innerHTML = `
      <div class="feat-name">${name}</div>
      <div class="feat-track"><div class="feat-fill" style="width:${(val/max*100).toFixed(1)}%"></div></div>
      <div class="feat-val">${(val*100).toFixed(2)}%</div>`;
    el.appendChild(row);
  });
}

// ── MODEL ANALYTICS ───────────────────────────────────────────────────────────
function populateModels() {
  const d = G.modelData;
  if (!d) return;
  buildModelCards(d);
  buildConfusionMatrix(d);
  buildROCChart(d);
  buildPRChart(d);
  const bestTitle = d.best_model.replace(/_/g," ").replace(/\b\w/g, l => l.toUpperCase());
  $("prTitle") && ($("prTitle").textContent = `${bestTitle} (AUPRC=${d.model_results[d.best_model].auprc})`);
}

function buildModelCards(d) {
  const container = $("modelCards");
  if (!container) return;
  container.innerHTML = "";
  const colorFor = val => val >= 0.8 ? "var(--green)" : val >= 0.5 ? "var(--amber)" : "var(--red)";
  Object.entries(d.model_results).forEach(([name, res]) => {
    const isBest = name === d.best_model;
    const displayName = name.replace(/_/g," ").replace(/\b\w/g, l => l.toUpperCase());
    const metrics = [
      { label:"AUPRC", val:res.auprc }, { label:"AUROC", val:res.auroc }, { label:"F1 Score", val:res.f1 },
      { label:"Precision (fraud)", val:res.precision }, { label:"Recall (fraud)", val:res.recall },
    ];
    const rows = metrics.map(m => `
      <div class="model-row"><span class="model-key">${m.label}</span><span class="model-val" style="color:${colorFor(m.val)}">${m.val.toFixed(4)}</span></div>
      <div class="bar-track"><div class="bar-fill-el" style="width:${(m.val*100).toFixed(1)}%;background:${colorFor(m.val)}"></div></div>`).join("");
    const cm = res.confusion_matrix;
    const [tn,fp,fn,tp] = [cm[0][0],cm[0][1],cm[1][0],cm[1][1]];
    const card = document.createElement("div");
    card.className = `model-card${isBest?" best":""}`;
    card.innerHTML = `
      ${isBest?'<div class="model-best-badge">Best Model</div>':""}
      <div class="model-name" style="color:${isBest?"var(--cyan)":"var(--text)"}">${displayName}</div>
      ${rows}
      <div class="model-note">TN:${fmt(tn)}  FP:${fmt(fp)}  FN:${fmt(fn)}  TP:${fmt(tp)}</div>`;
    container.appendChild(card);
  });
}

function buildConfusionMatrix(d) {
  const el = $("confusionMatrix");
  if (!el) return;
  const best = d.model_results[d.best_model];
  const cm   = best.confusion_matrix;
  const tn=cm[0][0],fp=cm[0][1],fn=cm[1][0],tp=cm[1][1];
  el.innerHTML = `
    <div class="cm-header-row"><div class="cm-col-label">Pred: Legit</div><div class="cm-col-label">Pred: Fraud</div></div>
    <div class="cm-data-row">
      <div class="cm-row-label">Actual:<br>Legit</div>
      <div class="cm-cell cm-tn"><div class="cm-num">${fmt(tn)}</div><div class="cm-lbl">True Neg</div></div>
      <div class="cm-cell cm-fp"><div class="cm-num">${fmt(fp)}</div><div class="cm-lbl">False Pos</div></div>
    </div>
    <div class="cm-data-row">
      <div class="cm-row-label">Actual:<br>Fraud</div>
      <div class="cm-cell cm-fn"><div class="cm-num">${fmt(fn)}</div><div class="cm-lbl">False Neg</div></div>
      <div class="cm-cell cm-tp"><div class="cm-num">${fmt(tp)}</div><div class="cm-lbl">True Pos</div></div>
    </div>
    <div class="cm-stats">Precision: ${(tp/(tp+fp)*100).toFixed(1)}% &nbsp;|&nbsp; Recall: ${(tp/(tp+fn)*100).toFixed(1)}% &nbsp;|&nbsp; Specificity: ${(tn/(tn+fp)*100).toFixed(2)}%</div>`;
}

function buildROCChart(d) {
  const ctx = $("rocChart");
  if (!ctx) return;
  if (G.charts.roc) G.charts.roc.destroy();
  const best = d.model_results[d.best_model];
  const { fpr, tpr } = best.roc_curve;
  const step = Math.max(1, Math.floor(fpr.length / 200));
  const pts = fpr.filter((_,i) => i % step === 0).map((x,i) => ({ x, y: tpr[i*step] || 0 }));
  G.charts.roc = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        { label:`Best Model (AUROC=${best.auroc})`, data: pts, borderColor:"#00d4ff", borderWidth:2.5, pointRadius:0, tension:0.2, fill:true, backgroundColor:"rgba(0,212,255,0.07)" },
        { label:"Random chance (AUROC=0.5)", data:[{x:0,y:0},{x:1,y:1}], borderColor:"#6b7fa8", borderWidth:1.5, pointRadius:0, borderDash:[5,5] },
      ],
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      scales: {
        x: { type:"linear", min:0, max:1,
          title:{ display:true, text:"False Positive Rate (FPR) →  [lower = fewer false alarms]", color:"#6b7fa8", font:{size:10} },
          ticks:{color:"#6b7fa8",font:{size:9},callback:v=>v.toFixed(1)}, grid:{color:"rgba(107,127,168,0.1)"} },
        y: { type:"linear", min:0, max:1,
          title:{ display:true, text:"↑ True Positive Rate (TPR) — Recall  [higher = more fraud caught]", color:"#6b7fa8", font:{size:10} },
          ticks:{color:"#6b7fa8",font:{size:9},callback:v=>v.toFixed(1)}, grid:{color:"rgba(107,127,168,0.1)"} },
      },
      plugins: {
        legend:{ labels:{color:"#9ab",font:{size:10},boxWidth:12} },
        tooltip: { callbacks: {
          title: ctx => `Threshold point`,
          label: ctx => [
            `TPR (Recall): ${ctx.parsed.y.toFixed(3)} — ${(ctx.parsed.y*100).toFixed(1)}% of frauds caught`,
            `FPR: ${ctx.parsed.x.toFixed(3)} — ${(ctx.parsed.x*100).toFixed(1)}% of legit wrongly flagged`
          ]
        }},
        annotation: {
          annotations: {
            perfectPoint: {
              type: 'point', xValue: 0, yValue: 1,
              backgroundColor: 'rgba(0,229,160,0.3)', radius: 5,
              label: { content: 'Perfect', enabled: true }
            }
          }
        }
      },
    },
  });
}

function buildPRChart(d) {
  const ctx = $("prChart");
  if (!ctx) return;
  if (G.charts.pr) G.charts.pr.destroy();
  const best = d.model_results[d.best_model];
  const { precision, recall } = best.pr_curve;
  const baseline = d.dataset_stats.fraud_count / d.dataset_stats.total_transactions;
  const step = Math.max(1, Math.floor(recall.length / 300));
  const pts = recall.filter((_,i) => i % step === 0).map((r,i) => ({ x:r, y:precision[i*step] || 0 }));
  const alpha = G.chartOpacity;
  G.charts.pr = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        { label:`Best Model (AUPRC=${best.auprc})`, data:pts, borderColor:"#00e5a0", borderWidth:2.5, pointRadius:0, tension:0.2, fill:true, backgroundColor:`rgba(0,229,160,${alpha*0.15})` },
        { label:`Random baseline (${(baseline*100).toFixed(3)}% fraud rate)`, data:[{x:0,y:baseline},{x:1,y:baseline}], borderColor:"#6b7fa8", borderWidth:1.5, pointRadius:0, borderDash:[5,5] },
      ],
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      scales: {
        x: { type:"linear", min:0, max:1,
          title:{display:true,text:"Recall / Sensitivity →  [higher = more frauds caught, but more false alarms]",color:"#6b7fa8",font:{size:10}},
          ticks:{color:"#6b7fa8",font:{size:9},callback:v=>v.toFixed(1)}, grid:{color:"rgba(107,127,168,0.1)"} },
        y: { type:"linear", min:0, max:1,
          title:{display:true,text:"↑ Precision  [higher = fewer false alarms per flag]",color:"#6b7fa8",font:{size:10}},
          ticks:{color:"#6b7fa8",font:{size:9},callback:v=>v.toFixed(2)}, grid:{color:"rgba(107,127,168,0.1)"} },
      },
      plugins: {
        legend:{labels:{color:"#9ab",font:{size:10},boxWidth:12}},
        tooltip:{ callbacks:{
          title: () => `Threshold operating point`,
          label: ctx => [
            `Precision: ${ctx.parsed.y.toFixed(3)} — ${(ctx.parsed.y*100).toFixed(1)}% of flags are real fraud`,
            `Recall: ${ctx.parsed.x.toFixed(3)} — ${(ctx.parsed.x*100).toFixed(1)}% of all frauds caught`
          ]
        }},
      },
    },
  });
}

// ── ABOUT PERFORMANCE CHART ───────────────────────────────────────────────────
function buildAboutPerfChart() {
  const ctx = $("aboutPerfChart");
  if (!ctx) return;
  if (G.charts.aboutPerf) G.charts.aboutPerf.destroy();

  // Use actual model data if available, else use known values
  let rfAuprc = 0.8425, lrAuprc = 0.71;
  if (G.modelData) {
    const mr = G.modelData.model_results;
    if (mr.random_forest) rfAuprc = mr.random_forest.auprc;
    if (mr.logistic_regression) lrAuprc = mr.logistic_regression.auprc;
  }
  const baseline = 0.0017; // fraud rate

  G.charts.aboutPerf = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Random Baseline\n(fraud rate)", "Logistic Regression", "Random Forest\n(Our Model)"],
      datasets: [{
        label: "AUPRC Score",
        data: [baseline, lrAuprc, rfAuprc],
        backgroundColor: [
          "rgba(107,127,168,0.5)",
          "rgba(255,184,48,0.6)",
          "rgba(0,212,255,0.7)",
        ],
        borderColor: ["#6b7fa8","#ffb830","#00d4ff"],
        borderWidth: 1.5,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { ticks:{color:"#6b7fa8",font:{size:10}}, grid:{display:false} },
        y: {
          min: 0, max: 1,
          title:{display:true,text:"AUPRC Score",color:"#6b7fa8",font:{size:10}},
          ticks:{color:"#6b7fa8",font:{size:9},callback:v=>v.toFixed(2)},
          grid:{color:"rgba(107,127,168,0.1)"}
        },
      },
      plugins: {
        legend:{display:false},
        tooltip:{callbacks:{
          label: ctx => {
            const v = ctx.parsed.y;
            if (v < 0.01) return `AUPRC: ${v.toFixed(4)} — random guessing`;
            const improvement = (v / baseline).toFixed(0);
            return `AUPRC: ${v.toFixed(4)} (~${improvement}× above random)`;
          }
        }}
      },
    },
  });
}

// ── TRANSACTIONS ──────────────────────────────────────────────────────────────
const TX_MASTER_POOL = [
  { id:"TXN-88421", amtVal:247.00,  score:0.82, status:"fraud"  },
  { id:"TXN-88420", amtVal:1.00,    score:0.67, status:"review" },
  { id:"TXN-88419", amtVal:45.99,   score:0.04, status:"legit"  },
  { id:"TXN-88418", amtVal:850.00,  score:0.71, status:"review" },
  { id:"TXN-88417", amtVal:12.50,   score:0.02, status:"legit"  },
  { id:"TXN-88416", amtVal:320.00,  score:0.91, status:"fraud"  },
  { id:"TXN-88415", amtVal:78.25,   score:0.08, status:"legit"  },
  { id:"TXN-88414", amtVal:2.37,    score:0.55, status:"review" },
  { id:"TXN-88413", amtVal:199.90,  score:0.03, status:"legit"  },
  { id:"TXN-88412", amtVal:4500.00, score:0.88, status:"fraud"  },
  { id:"TXN-88411", amtVal:33.40,   score:0.06, status:"legit"  },
  { id:"TXN-88410", amtVal:560.00,  score:0.79, status:"fraud"  },
  { id:"TXN-88409", amtVal:22.00,   score:0.11, status:"legit"  },
  { id:"TXN-88408", amtVal:1200.00, score:0.76, status:"fraud"  },
  { id:"TXN-88407", amtVal:55.80,   score:0.31, status:"review" },
  { id:"TXN-88406", amtVal:9.99,    score:0.05, status:"legit"  },
  { id:"TXN-88405", amtVal:3800.00, score:0.94, status:"fraud"  },
  { id:"TXN-88404", amtVal:67.40,   score:0.19, status:"legit"  },
  { id:"TXN-88403", amtVal:430.00,  score:0.63, status:"review" },
  { id:"TXN-88402", amtVal:140.00,  score:0.28, status:"review" },
  { id:"TXN-88401", amtVal:18.75,   score:0.03, status:"legit"  },
  { id:"TXN-88400", amtVal:2100.00, score:0.85, status:"fraud"  },
  { id:"TXN-88399", amtVal:36.50,   score:0.07, status:"legit"  },
  { id:"TXN-88398", amtVal:690.00,  score:0.72, status:"fraud"  },
  { id:"TXN-88397", amtVal:14.20,   score:0.04, status:"legit"  },
  { id:"TXN-88396", amtVal:890.00,  score:0.68, status:"review" },
  { id:"TXN-88395", amtVal:5.00,    score:0.58, status:"review" },
  { id:"TXN-88394", amtVal:27.90,   score:0.02, status:"legit"  },
  { id:"TXN-88393", amtVal:6000.00, score:0.97, status:"fraud"  },
  { id:"TXN-88392", amtVal:88.00,   score:0.12, status:"legit"  },
];

// Extra pool of amounts and scores for newly generated transactions
const EXTRA_AMOUNTS = [15.5, 340, 78, 2200, 55, 1, 430, 9.5, 660, 90, 120, 5000, 33, 210, 44];
const EXTRA_SCORES  = [0.03, 0.75, 0.12, 0.89, 0.05, 0.62, 0.44, 0.02, 0.81, 0.07, 0.34, 0.93, 0.09, 0.58, 0.17];

function initTransactionPool() {
  const now = new Date();
  G.txPool = TX_MASTER_POOL.map((t, i) => {
    const d = new Date(now - i * 75000);
    return {
      ...t,
      time: `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`,
    };
  });
}

/**
 * FIX: Refresh now generates genuinely NEW transactions at the TOP of the pool,
 * with real timestamps, new IDs, and randomised amounts/scores.
 * Old transactions beyond the pool limit are discarded so the list feels live.
 */
function generateNewTransactions() {
  const now = new Date();
  const latestId = parseInt(G.txPool[0]?.id?.split("-")[1] || "88500");
  const numNew = 3 + Math.floor(Math.random() * 4); // 3–6 new transactions per refresh

  const newTxs = [];
  for (let i = 0; i < numNew; i++) {
    const d = new Date(now - i * 12000); // 12s apart
    const score = parseFloat((Math.random()).toFixed(2));
    const amtIdx = Math.floor(Math.random() * EXTRA_AMOUNTS.length);
    const amt = EXTRA_AMOUNTS[amtIdx] + (Math.random() * 10 - 5);
    const status = score >= 0.5 ? "fraud" : score >= 0.25 ? "review" : "legit";
    newTxs.push({
      id: `TXN-${latestId + numNew - i}`,
      time: `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`,
      amtVal: parseFloat(Math.max(0.5, amt).toFixed(2)),
      score,
      status,
    });
  }

  // Prepend new transactions, keep pool bounded at 50
  G.txPool = [...newTxs, ...G.txPool].slice(0, 50);
}

function buildTransactions() {
  renderTransactions();
  buildAmountChart();
  updateTxTimestamp();
}

function refreshTransactions() {
  const btn = $("txRefreshBtn");
  if (!btn || btn.disabled) return;
  btn.textContent = "↻ Refreshing…";
  btn.disabled = true;

  // Animate: short delay then actually refresh
  setTimeout(() => {
    generateNewTransactions();
    renderTransactions();
    updateTxTimestamp();
    btn.textContent = "↻ Refresh";
    btn.disabled = false;
  }, 350);
}

function renderTransactions() {
  const tbody = $("txBody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const threshold = G.riskThreshold / 100;
  const shown = G.txPool.slice(0, G.feedSize);
  shown.forEach(t => {
    let status;
    if (t.score >= threshold) status = "fraud";
    else if (t.score >= threshold * 0.5) status = "review";
    else status = "legit";

    const badgeClass = status === "fraud" ? "badge-fraud" : status === "review" ? "badge-review" : "badge-legit";
    const badgeLabel = status.charAt(0).toUpperCase() + status.slice(1);
    const scoreColor = t.score >= threshold ? "var(--red)" : t.score >= threshold*0.5 ? "var(--amber)" : "var(--green)";
    const amtStr = t.amtVal >= 1000 ? `$${(t.amtVal/1000).toFixed(1)}k` : `$${t.amtVal.toFixed(2)}`;
    const tr = document.createElement("tr");
    tr.setAttribute("data-id", t.id);
    if (status === "fraud") tr.style.background = "rgba(255,59,110,0.03)";
    tr.innerHTML = `
      <td style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">${t.id}</td>
      <td style="font-family:var(--font-mono);font-size:11px">${t.time}</td>
      <td style="font-family:var(--font-mono);font-weight:500">${amtStr}</td>
      <td>
        <div class="score-bar-wrap">
          <div class="score-bar-fill" style="width:${(t.score*100).toFixed(0)}%;background:${scoreColor}"></div>
          <span class="score-bar-label" style="color:${scoreColor}">${(t.score*100).toFixed(0)}%</span>
        </div>
      </td>
      <td><span class="badge ${badgeClass}">${badgeLabel}</span></td>
      <td class="tx-actions">
        <button class="tx-btn tx-btn-review"  onclick="txAction('review','${t.id}')">Review</button>
        <button class="tx-btn tx-btn-approve" onclick="txAction('approve','${t.id}')">Approve</button>
        <button class="tx-btn tx-btn-block"   onclick="txAction('block','${t.id}')">Block</button>
      </td>`;
    tbody.appendChild(tr);
  });
  $("txCount").textContent = `Showing ${shown.length} of ${G.txPool.length} transactions`;
}

function txAction(action, id) {
  const row = document.querySelector(`tr[data-id="${id}"]`);
  if (!row) return;
  const msgs = {
    review:  `${id} → Case opened for analyst review`,
    approve: `${id} → Approved and cleared`,
    block:   `${id} → Transaction blocked and card flagged`,
  };
  row.style.opacity = "0";
  row.style.transition = "opacity 0.4s";
  // Also remove from pool so it doesn't re-appear on re-render
  G.txPool = G.txPool.filter(t => t.id !== id);
  setTimeout(() => {
    row.remove();
    if ($("txCount")) $("txCount").textContent = `Last action: ${msgs[action]}`;
  }, 400);
}

function updateTxTimestamp() {
  const el = $("txTimestamp");
  if (el) el.textContent = `Last refreshed: ${new Date().toLocaleTimeString()}`;
}

function buildAmountChart() {
  const ctx = $("amountChart");
  if (!ctx) return;
  if (G.charts.amount) G.charts.amount.destroy();
  G.charts.amount = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["<$10","$10–50","$50–100","$100–200","$200–500","$500–1k",">$1k"],
      datasets: [
        { label:"Legitimate (%)", data:[18,22,19,15,14,8,4],  backgroundColor:"rgba(0,212,255,0.5)",  borderWidth:0 },
        { label:"Fraud (%)",      data:[5,18,24,28,16,7,2],   backgroundColor:"rgba(255,59,110,0.5)", borderWidth:0 },
      ],
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      scales: {
        x:{ ticks:{color:"#6b7fa8",font:{size:9}}, grid:{display:false} },
        y:{ ticks:{color:"#6b7fa8",font:{size:9},callback:v=>v+"%"}, grid:{color:"rgba(107,127,168,0.1)"} },
      },
      plugins:{ legend:{labels:{color:"#9ab",font:{size:10},boxWidth:12}} },
    },
  });
}

// ── ALERTS ────────────────────────────────────────────────────────────────────
function initAlerts() {
  G.alerts = [
    { id:1,  priority:"high", msg:"High-value transaction flagged — $4,500 from new device, IP geolocation mismatch",  time:"2 min ago",  resolved:false, snoozed:false },
    { id:2,  priority:"high", msg:"Velocity alert: 3 transactions in 90 seconds on same card at different merchants",   time:"8 min ago",  resolved:false, snoozed:false },
    { id:3,  priority:"high", msg:"Impossible travel detected — card used in two countries within 30 minutes",          time:"15 min ago", resolved:false, snoozed:false },
    { id:4,  priority:"med",  msg:"Unusual transaction at 2am: $320 — velocity pattern triggered review",               time:"22 min ago", resolved:false, snoozed:false },
    { id:5,  priority:"med",  msg:"Micro-transaction probe pattern detected: $1.00 → $0.50 → $2.00 sequence",          time:"31 min ago", resolved:false, snoozed:false },
    { id:6,  priority:"med",  msg:"New device login combined with high-value transaction — step-up auth required",      time:"45 min ago", resolved:false, snoozed:false },
    { id:7,  priority:"info", msg:"Model performance check: AUPRC still within acceptable range (0.828)",              time:"1 hr ago",   resolved:false, snoozed:false },
    { id:8,  priority:"info", msg:"Scheduled retraining: 500 new labeled samples available from analyst review queue", time:"2 hr ago",   resolved:false, snoozed:false },
    { id:9,  priority:"info", msg:"System health: API latency p99 = 12 ms, well within 100 ms SLA",                   time:"3 hr ago",   resolved:false, snoozed:false },
    { id:10, priority:"med",  msg:"Card used at ATM + e-commerce within 5 minutes — flagged for manual check",         time:"4 hr ago",   resolved:false, snoozed:false },
  ];
}

function buildAlerts() {
  renderAlertFeed();
  updateAlertCounts();
  updateAlertBadge();
}

function renderAlertFeed() {
  const el = $("alertFeed");
  if (!el) return;
  el.innerHTML = "";
  const filterMap = { 0: ["high","med","info"], 1: ["high","med"], 2: ["high"] };
  const allowed = filterMap[G.priorityFilter] || ["high","med","info"];
  const visible = G.alerts.filter(a => !a.resolved && !a.snoozed && allowed.includes(a.priority));

  if (visible.length === 0) {
    $("alertEmpty").style.display = "block";
  } else {
    $("alertEmpty").style.display = "none";
    visible.forEach(a => {
      const clsMap = { high:"", med:"med", info:"info" };
      const div = document.createElement("div");
      div.className = `alert-item ${clsMap[a.priority]}`;
      div.id = `alert-${a.id}`;

      const priorityLabels = { high:"🔴 HIGH", med:"🟡 MED", info:"🔵 INFO" };

      div.innerHTML = `
        <div class="alert-checkbox-wrap">
          <input type="checkbox" class="alert-cb" id="cb-${a.id}" onchange="updateBulkHint()">
        </div>
        <div class="alert-left">
          <span class="alert-priority-dot ${a.priority}"></span>
          <div style="flex:1;min-width:0">
            <div class="alert-meta-row">
              <span class="alert-priority-label">${priorityLabels[a.priority]}</span>
              <span class="alert-time">${a.time}</span>
            </div>
            <div class="alert-text">${a.msg}</div>
          </div>
        </div>
        <div class="alert-btns">
          <div class="alert-priority-select">
            <select class="priority-sel" onchange="changeAlertPriority(${a.id}, this.value)" title="Change priority">
              <option value="high" ${a.priority==="high"?"selected":""}>🔴 High</option>
              <option value="med"  ${a.priority==="med" ?"selected":""}>🟡 Med</option>
              <option value="info" ${a.priority==="info"?"selected":""}>🔵 Info</option>
            </select>
          </div>
          <button class="al-btn al-accept"   onclick="resolveAlert(${a.id})">✓ Accept</button>
          <button class="al-btn al-escalate" onclick="escalateAlert(${a.id})">↑ Escalate</button>
          <button class="al-btn al-snooze"   onclick="snoozeAlert(${a.id})">⏸ Snooze</button>
          <button class="al-btn al-dismiss"  onclick="dismissAlert(${a.id})">✕</button>
        </div>`;
      el.appendChild(div);
    });
  }
  updateBulkHint();
}

function changeAlertPriority(id, newPriority) {
  const a = G.alerts.find(x => x.id === id);
  if (!a) return;
  a.priority = newPriority;
  renderAlertFeed();
  updateAlertCounts();
  updateAlertBadge();
}

function resolveAlert(id) {
  const a = G.alerts.find(x => x.id === id);
  if (!a) return;
  a.resolved = true;
  const el = $(`alert-${id}`);
  if (el) { el.style.opacity = "0"; el.style.transition = "opacity 0.35s"; setTimeout(() => renderAlertFeed(), 350); }
  else { renderAlertFeed(); }
  updateAlertCounts();
  updateAlertBadge();
}

function dismissAlert(id) { resolveAlert(id); }

function snoozeAlert(id) {
  const a = G.alerts.find(x => x.id === id);
  if (!a) return;
  a.snoozed = true;
  const el = $(`alert-${id}`);
  if (el) { el.style.opacity = "0"; el.style.transition = "opacity 0.35s"; setTimeout(() => renderAlertFeed(), 350); }
  else { renderAlertFeed(); }
  updateAlertCounts();
  // Un-snooze after 5 min
  setTimeout(() => { a.snoozed = false; renderAlertFeed(); updateAlertCounts(); updateAlertBadge(); }, 5 * 60 * 1000);
}

function escalateAlert(id) {
  const a = G.alerts.find(x => x.id === id);
  if (!a) return;
  a.priority = "high";
  renderAlertFeed();
  updateAlertCounts();
}

function resolveAllAlerts() {
  G.alerts.forEach(a => { a.resolved = true; });
  renderAlertFeed();
  updateAlertCounts();
  updateAlertBadge();
}

function dismissAllAlerts() { resolveAllAlerts(); }

function snoozeAllAlerts() {
  const SNOOZE_MS = 5 * 60 * 1000;
  if (G.snoozeTimer) {
    clearTimeout(G.snoozeTimer);
    clearInterval(G.snoozeInterval);
  }
  G.alerts.filter(a => !a.resolved).forEach(a => { a.snoozed = true; });
  renderAlertFeed();
  updateAlertCounts();

  // Show countdown banner
  G.snoozeEndTime = Date.now() + SNOOZE_MS;
  const banner = $("snoozeBanner");
  if (banner) banner.style.display = "flex";
  updateSnoozeCountdown();
  G.snoozeInterval = setInterval(updateSnoozeCountdown, 1000);
  G.snoozeTimer = setTimeout(() => {
    cancelSnooze();
  }, SNOOZE_MS);
}

function updateSnoozeCountdown() {
  const remaining = Math.max(0, G.snoozeEndTime - Date.now());
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  const el = $("snoozeCountdown");
  if (el) el.textContent = `${mins}:${String(secs).padStart(2,"0")}`;
}

function cancelSnooze() {
  if (G.snoozeTimer) { clearTimeout(G.snoozeTimer); G.snoozeTimer = null; }
  if (G.snoozeInterval) { clearInterval(G.snoozeInterval); G.snoozeInterval = null; }
  G.alerts.forEach(a => { a.snoozed = false; });
  const banner = $("snoozeBanner");
  if (banner) banner.style.display = "none";
  renderAlertFeed();
  updateAlertCounts();
  updateAlertBadge();
}

// Bulk select helpers
function getCheckedAlertIds() {
  return [...document.querySelectorAll(".alert-cb:checked")].map(cb => parseInt(cb.id.replace("cb-","")));
}

function updateBulkHint() {
  const ids = getCheckedAlertIds();
  const hint = $("apbHint");
  if (hint) hint.textContent = ids.length > 0 ? `${ids.length} alert${ids.length>1?"s":""} selected` : "— check boxes to enable bulk actions";
}

function bulkSetPriority(priority) {
  const ids = getCheckedAlertIds();
  if (ids.length === 0) { updateBulkHint(); return; }
  ids.forEach(id => {
    const a = G.alerts.find(x => x.id === id);
    if (a) a.priority = priority;
  });
  renderAlertFeed();
  updateAlertCounts();
  updateAlertBadge();
}

function bulkResolve() {
  const ids = getCheckedAlertIds();
  if (ids.length === 0) return;
  ids.forEach(id => {
    const a = G.alerts.find(x => x.id === id);
    if (a) a.resolved = true;
  });
  renderAlertFeed();
  updateAlertCounts();
  updateAlertBadge();
}

function updateAlertCounts() {
  const active   = G.alerts.filter(a => !a.resolved);
  const high     = active.filter(a => a.priority === "high").length;
  const med      = active.filter(a => a.priority === "med").length;
  const resolved = G.alerts.filter(a => a.resolved).length + 24;
  $("alertCountHigh")     && ($("alertCountHigh").textContent     = high);
  $("alertCountMed")      && ($("alertCountMed").textContent      = med);
  $("alertCountResolved") && ($("alertCountResolved").textContent = resolved);
  $("alertCountTotal")    && ($("alertCountTotal").textContent    = G.alerts.length + 24);
}

function updateAlertBadge() {
  const active = G.alerts.filter(a => !a.resolved).length;
  const badge = $("alertBadgeCount");
  if (!badge) return;
  if (active === 0) { badge.style.display = "none"; }
  else { badge.style.display = ""; badge.textContent = active; }
}

// ── PREDICT FORM ──────────────────────────────────────────────────────────────
const V_FEATURES = Array.from({ length: 28 }, (_, i) => `V${i + 1}`);

(function buildPredictForm() {
  const v1Grid = $("v1Grid");
  const v2Grid = $("v2Grid");
  if (!v1Grid || !v2Grid) return;
  V_FEATURES.forEach((v, i) => {
    const field = document.createElement("div");
    field.className = "field";
    field.innerHTML = `<label>${v}</label><input type="number" id="f-${v}" placeholder="0.00" step="0.0001">`;
    if (i < 14) v1Grid.appendChild(field);
    else         v2Grid.appendChild(field);
  });
})();

function getFormValues() {
  const data = {};
  data.Amount = parseFloat($("f-Amount")?.value) || 0;
  data.Time   = parseFloat($("f-Time")?.value)   || 0;
  V_FEATURES.forEach(v => { data[v] = parseFloat($(`f-${v}`)?.value) || 0; });
  return data;
}

function setFormValues(vals) {
  Object.entries(vals).forEach(([k, v]) => { const el = $(`f-${k}`); if (el) el.value = v; });
}

function clearForm() {
  $("f-Amount").value = ""; $("f-Time").value = "";
  V_FEATURES.forEach(v => { const el = $(`f-${v}`); if (el) el.value = ""; });
  $("resultCard").style.display = "none";
  $("resultPlaceholder").style.display = "block";
}

function loadSample(type) {
  if (type === "fraud") {
    setFormValues({ Amount:4219.75,Time:7380,V1:-4.82,V2:3.11,V3:-5.22,V4:4.53,V5:-2.18,V6:-3.24,V7:-5.01,V8:1.17,V9:-2.77,V10:-12.1,V11:2.02,V12:-6.43,V13:-0.85,V14:-11.34,V15:-0.29,V16:-4.85,V17:-10.54,V18:-2.21,V19:-0.12,V20:0.33,V21:0.77,V22:-0.15,V23:-0.22,V24:0.04,V25:-0.37,V26:-0.19,V27:0.64,V28:0.24 });
  } else {
    setFormValues({ Amount:32.15,Time:86440,V1:1.19,V2:0.27,V3:0.17,V4:0.45,V5:0.06,V6:-0.08,V7:-0.08,V8:0.09,V9:-0.26,V10:-0.17,V11:1.61,V12:1.07,V13:0.49,V14:-0.14,V15:0.64,V16:0.46,V17:-0.11,V18:-0.18,V19:-0.15,V20:-0.07,V21:-0.23,V22:-0.64,V23:0.10,V24:-0.34,V25:0.17,V26:0.13,V27:-0.01,V28:-0.02 });
  }
  runPredict();
}

async function runPredict() {
  const btn = $("analyzeBtn");
  const btnText = $("btnText");
  if (!btn) return;
  btn.disabled = true;
  btnText.textContent = "Analyzing…";
  const data = getFormValues();
  try {
    const res = await fetch("/api/predict", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();
    displayResult(result, data);
  } catch (err) {
    alert("Prediction failed: " + err.message + "\n\nMake sure the Flask server is running.");
  } finally {
    btn.disabled = false;
    btnText.textContent = "▶ Analyze Transaction";
  }
}

function displayResult(result, inputs) {
  $("resultCard").style.display = "block";
  $("resultPlaceholder").style.display = "none";
  const pct = result.risk_score_pct;
  const circumference = 2 * Math.PI * 50;
  const offset = circumference * (1 - pct / 100);
  const ring = $("ringFill");
  const ringPct = $("ringPct");
  ring.style.strokeDashoffset = offset;
  ringPct.textContent = pct.toFixed(1) + "%";
  const ringColor = pct >= 50 ? "#ff3b6e" : pct >= 25 ? "#ffb830" : "#00e5a0";
  ring.style.stroke = ringColor;
  ringPct.style.color = ringColor;
  const badge = $("verdictBadge");
  const vtext = $("verdictText");
  badge.className = "verdict-badge";
  if (pct >= 50) { badge.classList.add("high"); badge.textContent = "High Risk"; }
  else if (pct >= 25) { badge.classList.add("med"); badge.textContent = "Medium Risk"; }
  else { badge.classList.add("low"); badge.textContent = "Low Risk"; }
  vtext.textContent = result.verdict;
  $("riskNeedle").style.left = `${pct}%`;
  const fg = $("factorsGrid");
  fg.innerHTML = "";
  const factors = [
    { label:"Amount",    flag:inputs.Amount>500,             val:inputs.Amount>500?`$${inputs.Amount} — elevated`:`$${inputs.Amount} — normal` },
    { label:"V14 signal",flag:inputs.V14<-5,                 val:inputs.V14<-5?`${inputs.V14} — anomalous`:`${inputs.V14} — normal` },
    { label:"V10 signal",flag:inputs.V10<-5,                 val:inputs.V10<-5?`${inputs.V10} — anomalous`:`${inputs.V10} — normal` },
    { label:"V17 signal",flag:inputs.V17<-5,                 val:inputs.V17<-5?`${inputs.V17} — anomalous`:`${inputs.V17} — normal` },
    { label:"V4 signal", flag:inputs.V4>3,                   val:inputs.V4>3?`${inputs.V4} — elevated`:`${inputs.V4} — normal` },
    { label:"Time",      flag:(inputs.Time%86400)<21600,     val:(inputs.Time%86400)<21600?"Odd hours":"Daytime" },
  ];
  factors.forEach(f => {
    const color = f.flag ? "var(--amber)" : "var(--green)";
    const item = document.createElement("div");
    item.className = "factor-item";
    item.innerHTML = `<div class="factor-label">${f.label}</div><div class="factor-val" style="color:${color}">${f.val}</div>`;
    fg.appendChild(item);
  });
}

document.addEventListener("DOMContentLoaded", loadModelData);
