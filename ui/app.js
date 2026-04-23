const liveBanner = document.getElementById('live-banner');
const liveStats = document.getElementById('live-stats');
const liveBarFill = document.getElementById('live-bar-fill');
const livePct = document.getElementById('live-pct');
const metricsGrid = document.getElementById('metrics-grid');
const reposBody = document.getElementById('repos-body');
const searchInput = document.getElementById('repo-search');
const langFilter = document.getElementById('lang-filter');
const minStarsInput = document.getElementById('min-stars');
const panelSub = document.getElementById('panel-sub');
const pageInfo = document.getElementById('page-info');
const prevBtn = document.getElementById('prev-page');
const nextBtn = document.getElementById('next-page');
const gatePill = document.getElementById('gate-pill');
const gateNote = document.getElementById('gate-note');
const langChart = document.getElementById('lang-chart');
const starsChart = document.getElementById('stars-chart');
const langSub = document.getElementById('lang-sub');
const pageFoot = document.getElementById('page-foot');

const PAGE_SIZE = 25;
const state = {
  all: [],
  filtered: [],
  page: 0,
  sortKey: 'stargazer_count',
  sortDir: 'desc',
};

async function loadDashboardData() {
  try {
    const [summaryResponse, uiResponse] = await Promise.all([
      fetch('/artifacts/run-summary.json'),
      fetch('/artifacts/ui-dataset.json'),
    ]);

    if (!summaryResponse.ok || !uiResponse.ok) {
      throw new Error('Missing artifact files. Run crawl + export first.');
    }

    const summary = await summaryResponse.json();
    const uiDataset = await uiResponse.json();

    state.all = uiDataset.topRepositories ?? [];

    renderGate(summary);
    renderMetrics(summary, uiDataset);
    renderLanguageChart(state.all);
    renderStarsHistogram(state.all);
    populateLanguageFilter(state.all);
    applyFilters();
    renderFooter(uiDataset);
  } catch (error) {
    metricsGrid.innerHTML = `<article class="metric-card"><p class="metric-label">Error</p><p class="metric-value metric-state-bad">${escapeHtml(error.message)}</p></article>`;
    reposBody.innerHTML = `<tr><td colspan="5">Could not load artifacts. Run: <code>npm run crawl && npm run export:data</code></td></tr>`;
    gatePill.textContent = 'ERROR';
    gatePill.className = 'gate-pill bad';
    gateNote.textContent = error.message;
  }
}

/* ---------- Gate / summary ---------- */
function renderGate(summary) {
  const hitTarget = summary.uniqueRepositories >= summary.targetRepositories;
  const underTime = summary.durationSeconds <= 600;
  const statusOk = summary.status === 'completed';
  const pass = hitTarget && underTime && statusOk;

  gatePill.textContent = pass ? 'TARGET MET' : statusOk ? 'BELOW TARGET' : 'FAILED';
  gatePill.className = `gate-pill ${pass ? 'good' : statusOk ? 'warn' : 'bad'}`;

  const repos = numberFormat(summary.uniqueRepositories);
  const mins = (summary.durationSeconds / 60).toFixed(2);
  gateNote.textContent = `${repos} repos · ${mins} min · ${summary.stopReason || summary.status}`;
}

function renderMetrics(summary, uiDataset) {
  const duration = Number(summary.durationSeconds);
  const perSec = duration > 0 ? summary.uniqueRepositories / duration : 0;
  const perMin = perSec * 60;
  const apiEff = summary.apiRequests > 0
    ? (summary.uniqueRepositories / summary.apiRequests).toFixed(1)
    : '—';

  const statusClass = summary.status === 'completed' ? 'metric-state-good' : 'metric-state-bad';
  const perfClass = duration <= 600 ? 'metric-state-good' : 'metric-state-warn';
  const targetClass = summary.uniqueRepositories >= summary.targetRepositories
    ? 'metric-state-good' : 'metric-state-warn';
  const errClass = summary.errors > 0 ? 'metric-state-bad'
    : summary.retries > 0 ? 'metric-state-warn' : 'metric-state-good';

  metricsGrid.innerHTML = [
    metricCard('Status', summary.status, statusClass, summary.stopReason || ''),
    metricCard('Duration', `${duration.toFixed(2)}s`, perfClass, `${(duration / 60).toFixed(2)} min`),
    metricCard('Unique Repos', numberFormat(summary.uniqueRepositories), targetClass, `target ${numberFormat(summary.targetRepositories)}`),
    metricCard('Throughput', `${numberFormat(Math.round(perMin))}/min`, '', `${perSec.toFixed(1)} repos/s`),
    metricCard('API Requests', numberFormat(summary.apiRequests), '', `${apiEff} repos/req`),
    metricCard('Retries · Errors', `${summary.retries} · ${summary.errors}`, errClass,
      `stored ${numberFormat(uiDataset?.totals?.repositories ?? 0)}`),
  ].join('');
}

function metricCard(label, value, extraClass, sub) {
  return `
    <article class="metric-card">
      <p class="metric-label">${escapeHtml(label)}</p>
      <p class="metric-value ${escapeHtml(extraClass)}">${escapeHtml(value)}</p>
      ${sub ? `<p class="metric-sub">${escapeHtml(sub)}</p>` : ''}
    </article>`;
}

/* ---------- Charts ---------- */
function renderLanguageChart(repos) {
  const counts = new Map();
  for (const r of repos) {
    const lang = r.primary_language || 'Unknown';
    counts.set(lang, (counts.get(lang) || 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const max = top[0]?.[1] || 1;

  langSub.textContent = `${counts.size} languages · top 10 shown`;
  langChart.innerHTML = top.map(([lang, n]) => {
    const pct = (n / max) * 100;
    return `
      <div class="bar-row">
        <span class="bar-label" title="${escapeAttr(lang)}">${escapeHtml(lang)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
        <span class="bar-val">${n}</span>
      </div>`;
  }).join('');
}

function renderStarsHistogram(repos) {
  const buckets = [
    { label: '<5k', lo: 0, hi: 5000 },
    { label: '5–10k', lo: 5000, hi: 10000 },
    { label: '10–25k', lo: 10000, hi: 25000 },
    { label: '25–50k', lo: 25000, hi: 50000 },
    { label: '50–100k', lo: 50000, hi: 100000 },
    { label: '100k+', lo: 100000, hi: Infinity },
  ];
  const counts = buckets.map((b) =>
    repos.filter((r) => r.stargazer_count >= b.lo && r.stargazer_count < b.hi).length
  );
  const max = Math.max(...counts, 1);

  starsChart.style.setProperty('--bins', String(buckets.length));
  const bars = counts.map((c) => {
    const h = Math.max((c / max) * 100, c > 0 ? 6 : 2);
    return `<div class="hist-bar" style="height:${h.toFixed(1)}%"><span>${c}</span></div>`;
  }).join('');
  const labels = buckets.map((b) => `<span>${escapeHtml(b.label)}</span>`).join('');
  starsChart.innerHTML = `
    <div class="hist-wrap" style="--bins:${buckets.length}">${bars}</div>
    <div class="hist-labels" style="--bins:${buckets.length}">${labels}</div>
  `;
}

/* ---------- Filters + table ---------- */
function populateLanguageFilter(repos) {
  const langs = [...new Set(repos.map((r) => r.primary_language).filter(Boolean))].sort();
  langFilter.innerHTML =
    '<option value="">All languages</option>' +
    langs.map((l) => `<option value="${escapeAttr(l)}">${escapeHtml(l)}</option>`).join('');
}

function applyFilters() {
  const q = (searchInput.value || '').trim().toLowerCase();
  const lang = langFilter.value;
  const minStars = Number(minStarsInput.value || 0);

  let rows = state.all.filter((r) => {
    if (minStars && r.stargazer_count < minStars) return false;
    if (lang && r.primary_language !== lang) return false;
    if (!q) return true;
    const hay = `${r.name_with_owner} ${r.primary_language || ''} ${r.description || ''}`.toLowerCase();
    return hay.includes(q);
  });

  rows = sortRows(rows, state.sortKey, state.sortDir);
  state.filtered = rows;
  state.page = 0;
  renderTable();
}

function sortRows(rows, key, dir) {
  const mult = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
    return String(av).localeCompare(String(bv)) * mult;
  });
}

function renderTable() {
  const total = state.filtered.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (state.page >= pages) state.page = pages - 1;
  const start = state.page * PAGE_SIZE;
  const slice = state.filtered.slice(start, start + PAGE_SIZE);

  panelSub.textContent = `${numberFormat(total)} of ${numberFormat(state.all.length)} repositories · sorted by ${state.sortKey} ${state.sortDir}`;
  pageInfo.textContent = total === 0
    ? 'no results'
    : `page ${state.page + 1} / ${pages} · ${start + 1}–${Math.min(start + PAGE_SIZE, total)}`;
  prevBtn.disabled = state.page === 0;
  nextBtn.disabled = state.page >= pages - 1;

  if (!slice.length) {
    reposBody.innerHTML = '<tr><td colspan="5">No repositories match your filters.</td></tr>';
    updateSortIndicators();
    return;
  }

  reposBody.innerHTML = slice.map((repo) => {
    const updatedDate = parseTimestamp(repo.updated_at);
    const updatedAt = updatedDate ? updatedDate.toISOString().slice(0, 10) : '—';
    const desc = repo.description ? `<span class="desc">${escapeHtml(repo.description)}</span>` : '';
    const lang = repo.primary_language
      ? `<span class="lang-chip">${escapeHtml(repo.primary_language)}</span>`
      : '<span style="color:var(--muted-2)">—</span>';
    return `
      <tr>
        <td>
          <a class="repo-link" href="${escapeAttr(repo.url)}" target="_blank" rel="noreferrer">
            ${escapeHtml(repo.name_with_owner)}
          </a>
          ${desc}
        </td>
        <td>${lang}</td>
        <td class="num">${numberFormat(repo.stargazer_count)}</td>
        <td class="num">${numberFormat(repo.fork_count)}</td>
        <td>${escapeHtml(updatedAt)}</td>
      </tr>`;
  }).join('');

  updateSortIndicators();
}

function updateSortIndicators() {
  document.querySelectorAll('th.sortable').forEach((th) => {
    const key = th.dataset.sort;
    const ind = th.querySelector('.sort-ind');
    if (key === state.sortKey) {
      th.classList.add('active');
      ind.textContent = state.sortDir === 'asc' ? '▲' : '▼';
    } else {
      th.classList.remove('active');
      ind.textContent = '↕';
    }
  });
}

function renderFooter(uiDataset) {
  const genDate = parseTimestamp(uiDataset.generatedAt);
  const gen = genDate ? genDate.toLocaleString() : '—';
  pageFoot.textContent = `artifact generated ${gen} · top ${uiDataset?.totals?.topRepositoriesLimit ?? 500} of ${numberFormat(uiDataset?.totals?.repositories ?? 0)}`;
}

/* ---------- Events ---------- */
searchInput?.addEventListener('input', applyFilters);
langFilter?.addEventListener('change', applyFilters);
minStarsInput?.addEventListener('input', applyFilters);

prevBtn?.addEventListener('click', () => {
  if (state.page > 0) { state.page--; renderTable(); }
});
nextBtn?.addEventListener('click', () => {
  const pages = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
  if (state.page < pages - 1) { state.page++; renderTable(); }
});

document.querySelectorAll('th.sortable').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (state.sortKey === key) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortKey = key;
      state.sortDir = (key === 'stargazer_count' || key === 'fork_count') ? 'desc' : 'asc';
    }
    state.filtered = sortRows(state.filtered, state.sortKey, state.sortDir);
    state.page = 0;
    renderTable();
  });
});

/* ---------- Utils ---------- */
function numberFormat(value) {
  return Number(value || 0).toLocaleString();
}

// Postgres timestamps come as "2026-04-21 14:12:38+00" (space, abbreviated tz).
// Normalize to a form JS Date can always parse.
function parseTimestamp(value) {
  if (!value) return null;
  const normalized = String(value)
    .replace(' ', 'T')
    .replace(/\+(\d{2})$/, '+$1:00')
    .replace(/-(\d{2})$/, '-$1:00');
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '');
}

/* ---------- Live crawl polling ---------- */
let livePoller = null;

async function pollProgress() {
  try {
    const res = await fetch('/artifacts/progress.json', { cache: 'no-store' });
    if (!res.ok) { stopLivePolling(); return; }

    const p = await res.json();

    if (p.status === 'done') {
      stopLivePolling();
      // crawl just finished — reload dashboard data
      await loadDashboardData();
      return;
    }

    // status === 'running'
    liveBanner.hidden = false;
    const pct = p.targetRepositories > 0
      ? Math.min(100, (p.uniqueRepositories / p.targetRepositories) * 100)
      : 0;
    const elapsed = p.elapsedSeconds ?? 0;
    const rate = elapsed > 0 ? Math.round((p.uniqueRepositories / elapsed) * 60) : 0;

    liveStats.textContent =
      `${numberFormat(p.uniqueRepositories)} / ${numberFormat(p.targetRepositories)} repos` +
      `  ·  ${numberFormat(rate)}/min` +
      `  ·  ${elapsed}s elapsed` +
      `  ·  ${numberFormat(p.apiRequests)} API calls`;

    liveBarFill.style.width = `${pct.toFixed(1)}%`;
    livePct.textContent = `${pct.toFixed(0)}%`;

    // Update gate pill to show in-progress state
    gatePill.textContent = 'CRAWLING';
    gatePill.className = 'gate-pill warn';
    gateNote.textContent = `${numberFormat(p.uniqueRepositories)} repos so far · ${elapsed}s`;
  } catch {
    // progress.json not available yet — no crawl running
    stopLivePolling();
  }
}

function stopLivePolling() {
  if (livePoller) { clearInterval(livePoller); livePoller = null; }
}

async function startLivePollingIfCrawling() {
  try {
    const res = await fetch('/artifacts/progress.json', { cache: 'no-store' });
    if (!res.ok) return;
    const p = await res.json();
    if (p.status === 'running') {
      liveBanner.hidden = false;
      livePoller = setInterval(pollProgress, 1000);
      await pollProgress();
    }
  } catch { /* no progress file — normal */ }
}

void startLivePollingIfCrawling();
void loadDashboardData();
