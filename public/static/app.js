// 村田鉄筋㈱ 加工数量分析システム - フロントエンド (堅牢化版)

// ========== 即時起動ガード: スクリプトロード失敗を可視化 ==========
(function setupGlobalErrorGuard() {
  window.addEventListener('error', (e) => {
    console.error('[GlobalError]', e.error || e.message);
    showFatalError(e.error?.message || e.message || '不明なエラー');
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[UnhandledRejection]', e.reason);
    showFatalError(e.reason?.message || String(e.reason));
  });
})();

function showFatalError(message) {
  const app = document.getElementById('app');
  if (!app) return;
  // 既にフォームなどが表示されているならそのまま（ユーザー操作を邪魔しない）
  if (app.querySelector('#loginForm') || app.querySelector('#main')) return;
  app.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="bg-white rounded-2xl shadow-xl p-8 max-w-lg w-full text-center">
        <i class="fas fa-exclamation-triangle text-5xl text-red-500"></i>
        <h2 class="text-xl font-bold text-gray-800 mt-4">データの読み込みに失敗しました</h2>
        <p class="mt-3 text-sm text-gray-600 break-words">${escapeHtml(message || '不明なエラー')}</p>
        <div class="flex gap-2 justify-center mt-6 flex-wrap">
          <button onclick="location.reload()" class="btn-primary">
            <i class="fas fa-redo mr-1"></i>再読み込み
          </button>
          <button onclick="window.__loadWithSampleData && window.__loadWithSampleData()" class="btn-secondary">
            <i class="fas fa-flask mr-1"></i>ダミーデータで表示
          </button>
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ========== 定数 ==========
const PART_KEYS = [
  'foundation_qty','base_qty','column_qty','beam_qty','fukashi_qty',
  'slab_qty','doma_qty','civil_qty','wooden_qty','other_qty'
];
const PART_LABELS = {
  foundation_qty:'基礎', base_qty:'ベース', column_qty:'柱', beam_qty:'梁', fukashi_qty:'フカシ',
  slab_qty:'スラブ', doma_qty:'土間', civil_qty:'土木', wooden_qty:'木造', other_qty:'その他'
};
const PART_COLORS = {
  foundation_qty:'#ef4444', base_qty:'#f97316', column_qty:'#eab308', beam_qty:'#84cc16',
  fukashi_qty:'#10b981', slab_qty:'#06b6d4', doma_qty:'#3b82f6', civil_qty:'#8b5cf6',
  wooden_qty:'#ec4899', other_qty:'#6b7280'
};
const FACTORY_COLORS = { '本社工場':'#2563eb', '第二工場':'#16a34a', '合計':'#f59e0b' };

// ========== サンプルデータ (DB接続失敗時のフォールバック) ==========
const SAMPLE_RECORDS = [
  { id: 1001, date: dayjsSafe().format('YYYY-MM-DD'), factory: '本社工場', staff_count: 8,
    foundation_qty: 3500, base_qty: 1200, column_qty: 1500, beam_qty: 2800, fukashi_qty: 500,
    slab_qty: 800, doma_qty: 600, civil_qty: 300, wooden_qty: 200, other_qty: 100,
    total_qty: 11500, qty_per_person: 1437.5, note: 'サンプルデータ', created_by: 0 },
  { id: 1002, date: dayjsSafe().format('YYYY-MM-DD'), factory: '第二工場', staff_count: 5,
    foundation_qty: 2000, base_qty: 800, column_qty: 1000, beam_qty: 1500, fukashi_qty: 300,
    slab_qty: 500, doma_qty: 400, civil_qty: 200, wooden_qty: 0, other_qty: 50,
    total_qty: 6750, qty_per_person: 1350, note: 'サンプルデータ', created_by: 0 },
  { id: 1003, date: dayjsSafe().subtract(3,'day').format('YYYY-MM-DD'), factory: '本社工場', staff_count: 7,
    foundation_qty: 3200, base_qty: 1100, column_qty: 1400, beam_qty: 2500, fukashi_qty: 450,
    slab_qty: 750, doma_qty: 550, civil_qty: 280, wooden_qty: 180, other_qty: 90,
    total_qty: 10500, qty_per_person: 1500, note: 'サンプルデータ', created_by: 0 },
  { id: 1004, date: dayjsSafe().subtract(3,'day').format('YYYY-MM-DD'), factory: '第二工場', staff_count: 5,
    foundation_qty: 1800, base_qty: 700, column_qty: 900, beam_qty: 1300, fukashi_qty: 250,
    slab_qty: 450, doma_qty: 350, civil_qty: 180, wooden_qty: 0, other_qty: 40,
    total_qty: 5970, qty_per_person: 1194, note: 'サンプルデータ', created_by: 0 }
];

function dayjsSafe(d) {
  try { return d ? dayjs(d) : dayjs(); } catch (e) { return { format: () => '', subtract: () => dayjsSafe() }; }
}

// ========== 状態 ==========
const state = {
  user: null,
  view: 'dashboard',
  records: [],
  factoryFilter: 'all',
  yearFilter: String(new Date().getFullYear()),
  monthFilter: '',
  dateFrom: '',
  dateTo: '',
  qtyUnit: 'kg',
  editingId: null,
  charts: {},
  useSampleData: false,  // DB接続失敗時のフォールバック
  workerFilter: '',       // 人員別分析: 人員名絞り込み
  workerPartFilter: 'all' // 人員別分析: 部位絞り込み
};

// 人員名の正規化ヘルパー (null/文字列/配列/重複対応)
function normalizeWorkerNamesClient(v) {
  if (v == null) return [];
  let arr = [];
  if (Array.isArray(v)) arr = v;
  else if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    if (s.startsWith('[')) {
      try { arr = JSON.parse(s); } catch { arr = s.split(/[,、，]/); }
    } else {
      arr = s.split(/[,、，]/);
    }
  } else { return []; }
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    if (x == null) continue;
    const name = String(x).trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

// 人工 (man_days) の値を 0〜1 にクランプ (空欄→1, 数値以外→1, 負→0, 1超→1)
function clampManDaysClient(v) {
  if (v === '' || v == null) return 1;
  const n = Number(v);
  if (!isFinite(n) || isNaN(n)) return 1;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// 人員配列の正規化: [{name, man_days}] 形式へ
// 入力候補: workers配列(オブジェクト or 文字列) / worker_names配列 / JSON文字列 / null
// worker_names のみある古いデータ → 各人 man_days=1.0 として変換
function normalizeWorkersClient(workers, fallbackNames) {
  let raw = [];
  if (workers != null) {
    if (Array.isArray(workers)) raw = workers;
    else if (typeof workers === 'string') {
      const s = workers.trim();
      if (s.startsWith('[')) {
        try { raw = JSON.parse(s); } catch { raw = []; }
      }
    }
  }
  // workers が空なら worker_names フォールバック
  if (raw.length === 0 && fallbackNames != null) {
    const names = normalizeWorkerNamesClient(fallbackNames);
    raw = names.map(n => ({ name: n, man_days: 1 }));
  }
  const seen = new Set();
  const out = [];
  for (const v of raw) {
    if (v == null) continue;
    let name = '', md = 1;
    if (typeof v === 'string') { name = v.trim(); md = 1; }
    else if (typeof v === 'object') {
      name = String(v.name ?? v.worker_name ?? '').trim();
      md = v.man_days ?? v.manDays ?? 1;
    } else { continue; }
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, man_days: clampManDaysClient(md) });
  }
  return out;
}

// 人工合計を計算 (空名は除外)
function sumManDays(workers) {
  if (!Array.isArray(workers)) return 0;
  return workers.reduce((s, w) => {
    if (!w || !String(w.name || '').trim()) return s;
    return s + clampManDaysClient(w.man_days);
  }, 0);
}

// 人工を見やすく整形 (1.0 → '1.0', 0.5 → '0.5', 2.5 → '2.5')
function fmtManDays(v) {
  const n = Number(v);
  if (!isFinite(n)) return '0';
  // 小数点1桁を基本に、ぴったり整数でも .0 を表示
  return n.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

// ========== ユーティリティ ==========
const fmt = {
  num(n) {
    const v = Number(n);
    if (!isFinite(v)) return '0';
    return v.toLocaleString('ja-JP', { maximumFractionDigits: 1 });
  },
  qty(kg) {
    const v = Number(kg) || 0;
    if (state.qtyUnit === 't') {
      return (v / 1000).toLocaleString('ja-JP', { maximumFractionDigits: 2 }) + ' t';
    }
    return v.toLocaleString('ja-JP', { maximumFractionDigits: 1 }) + ' kg';
  },
  qtyVal(kg) {
    const v = Number(kg) || 0;
    return state.qtyUnit === 't' ? v / 1000 : v;
  },
  date(d) {
    if (!d) return '';
    try { return dayjs(d).format('YYYY/MM/DD'); } catch { return String(d); }
  }
};

function safeArray(v) { return Array.isArray(v) ? v : []; }
function safeNum(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function sumKey(arr, key) {
  return safeArray(arr).reduce((s, r) => s + safeNum(r && r[key]), 0);
}

// ========== API レイヤー (全てtry/catch) ==========
const api = {
  async _safeRequest(fn) {
    try { return await fn(); }
    catch (err) {
      const msg = err?.response?.data?.error || err?.message || String(err);
      const status = err?.response?.status || 0;
      const e = new Error(msg); e.status = status; e.original = err;
      throw e;
    }
  },
  login(username, password) { return this._safeRequest(async () => (await axios.post('/api/auth/login', { username, password })).data); },
  logout() { return this._safeRequest(async () => (await axios.post('/api/auth/logout')).data); },
  async me() {
    try { return (await axios.get('/api/auth/me')).data.user; }
    catch (e) {
      if (e?.response?.status === 401) return null;
      // 401以外は本当のエラー → 上に伝える
      throw e;
    }
  },
  listRecords(params = {}) { return this._safeRequest(async () => (await axios.get('/api/records', { params })).data.records || []); },
  getRecord(id) { return this._safeRequest(async () => (await axios.get(`/api/records/${id}`)).data.record); },
  createRecord(data) { return this._safeRequest(async () => (await axios.post('/api/records', data)).data); },
  updateRecord(id, data) { return this._safeRequest(async () => (await axios.put(`/api/records/${id}`, data)).data); },
  deleteRecord(id) { return this._safeRequest(async () => (await axios.delete(`/api/records/${id}`)).data); },
  previousRecord(date, factory) { return this._safeRequest(async () => (await axios.get('/api/records/copy/previous', { params: { date, factory } })).data.record); },
  daily(params) { return this._safeRequest(async () => (await axios.get('/api/analytics/daily', { params })).data.data || []); },
  monthly(params) { return this._safeRequest(async () => (await axios.get('/api/analytics/monthly', { params })).data.data || []); },
  yearly(params) { return this._safeRequest(async () => (await axios.get('/api/analytics/yearly', { params })).data.data || []); },
  dashboard() { return this._safeRequest(async () => (await axios.get('/api/analytics/dashboard')).data); },
  targets(year) { return this._safeRequest(async () => (await axios.get('/api/targets', { params: { year } })).data.targets || []); },
  setTarget(data) { return this._safeRequest(async () => (await axios.post('/api/targets', data)).data); },
  workers() { return this._safeRequest(async () => (await axios.get('/api/workers')).data.workers || []); },
  workerAnalytics(params) { return this._safeRequest(async () => (await axios.get('/api/analytics/workers', { params })).data.data || []); },
  workerMonthly(params) { return this._safeRequest(async () => (await axios.get('/api/analytics/workers/monthly', { params })).data.data || []); }
};

// ========== ローディング/エラー画面 ==========
function setLoading(message = '読み込み中...') {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = `
    <div class="flex items-center justify-center min-h-screen">
      <div class="text-center">
        <i class="fas fa-spinner fa-spin text-4xl text-blue-600"></i>
        <p class="mt-2 text-gray-600">${escapeHtml(message)}</p>
      </div>
    </div>
  `;
}

function setSectionLoading(elId, message = '読み込み中...') {
  const el = typeof elId === 'string' ? document.getElementById(elId) : elId;
  if (!el) return;
  el.innerHTML = `<div class="text-center py-10"><i class="fas fa-spinner fa-spin text-3xl text-blue-600"></i><p class="mt-2 text-gray-500 text-sm">${escapeHtml(message)}</p></div>`;
}

function setSectionError(elId, message, options = {}) {
  const el = typeof elId === 'string' ? document.getElementById(elId) : elId;
  if (!el) return;
  el.innerHTML = `
    <div class="text-center py-8 px-4">
      <i class="fas fa-exclamation-circle text-3xl text-red-500"></i>
      <p class="mt-2 font-semibold text-gray-800">データの読み込みに失敗しました</p>
      <p class="mt-1 text-sm text-gray-600 break-words">${escapeHtml(message || '不明なエラー')}</p>
      <div class="flex gap-2 justify-center mt-4 flex-wrap">
        ${options.onRetry !== false ? `<button data-retry class="btn-primary text-sm"><i class="fas fa-redo mr-1"></i>再読み込み</button>` : ''}
        ${options.onSample !== false ? `<button data-sample class="btn-secondary text-sm"><i class="fas fa-flask mr-1"></i>ダミーデータで表示</button>` : ''}
      </div>
    </div>
  `;
  el.querySelector('[data-retry]')?.addEventListener('click', () => options.retry?.());
  el.querySelector('[data-sample]')?.addEventListener('click', () => options.sample?.());
}

function emptyChartMessage(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const parent = canvas.parentElement;
  if (!parent) return;
  parent.innerHTML = `
    <div class="flex items-center justify-center h-full text-gray-400">
      <div class="text-center">
        <i class="fas fa-chart-bar text-3xl"></i>
        <p class="mt-2 text-sm">表示できるデータがありません</p>
      </div>
    </div>
  `;
}

// ========== ログイン画面 ==========
function renderLogin() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-blue-50 to-gray-100">
      <div class="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
        <div class="text-center mb-6">
          <i class="fas fa-industry text-5xl text-blue-600"></i>
          <h1 class="text-2xl font-bold text-gray-800 mt-3">村田鉄筋㈱</h1>
          <p class="text-gray-600 text-sm">加工数量分析システム</p>
        </div>
        <form id="loginForm" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">ユーザー名</label>
            <input id="username" type="text" required class="input-base" autocomplete="username" value="admin" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">パスワード</label>
            <input id="password" type="password" required class="input-base" autocomplete="current-password" value="admin123" />
          </div>
          <button type="submit" class="btn-primary w-full">
            <i class="fas fa-sign-in-alt mr-2"></i>ログイン
          </button>
          <div id="loginError" class="text-red-600 text-sm text-center hidden"></div>
        </form>
        <div class="mt-6 text-xs text-gray-500 border-t pt-4">
          <p class="font-semibold">初期アカウント:</p>
          <p>管理者: <code>admin</code> / <code>admin123</code></p>
          <p>一般: <code>user1</code> / <code>user123</code></p>
        </div>
        <div class="mt-4 text-center">
          <button id="sampleModeBtn" class="text-xs text-blue-600 hover:underline">
            <i class="fas fa-flask mr-1"></i>ダミーデータで画面を確認する (ログイン不要)
          </button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errEl = document.getElementById('loginError');
    errEl.classList.add('hidden');
    try {
      const r = await api.login(username, password);
      state.user = r.user;
      state.useSampleData = false;
      await loadAndRender();
    } catch (err) {
      errEl.textContent = err?.message || 'ログインに失敗しました';
      errEl.classList.remove('hidden');
    }
  });
  document.getElementById('sampleModeBtn').addEventListener('click', () => {
    state.user = { id: 0, username: 'preview', display_name: 'プレビューモード', role: 'admin' };
    state.useSampleData = true;
    loadAndRender().catch(e => console.error(e));
  });
}

// 外部公開: 致命エラー時に「ダミーデータで表示」を押せるように
window.__loadWithSampleData = () => {
  state.user = { id: 0, username: 'preview', display_name: 'プレビューモード', role: 'admin' };
  state.useSampleData = true;
  loadAndRender().catch(e => console.error(e));
};

// ========== レイアウト ==========
function renderLayout() {
  const u = state.user || { display_name: 'ゲスト', role: 'user' };
  document.getElementById('app').innerHTML = `
    <div class="min-h-screen flex flex-col">
      <header class="bg-white shadow-sm border-b sticky top-0 z-30 no-print">
        <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <i class="fas fa-industry text-blue-600 text-2xl"></i>
            <div>
              <h1 class="font-bold text-gray-800 leading-tight">村田鉄筋㈱</h1>
              <p class="text-xs text-gray-500 leading-tight">加工数量分析システム ${state.useSampleData ? '<span class="text-orange-600">(プレビュー)</span>' : ''}</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm text-gray-600 hidden md:inline">
              <i class="fas fa-user-circle mr-1"></i>${escapeHtml(u.display_name)}
              <span class="ml-1 px-2 py-0.5 text-xs rounded ${u.role==='admin'?'bg-orange-100 text-orange-800':'bg-gray-100 text-gray-700'}">${u.role==='admin'?'管理者':'一般'}</span>
            </span>
            <button id="logoutBtn" class="btn-secondary text-sm">
              <i class="fas fa-sign-out-alt mr-1"></i>ログアウト
            </button>
          </div>
        </div>
        <nav class="max-w-7xl mx-auto px-4 pb-3 flex gap-2 overflow-x-auto">
          ${navBtn('dashboard','tachometer-alt','ダッシュボード')}
          ${navBtn('input','plus-circle','加工数量入力')}
          ${navBtn('list','table','加工実績一覧')}
          ${navBtn('daily','calendar-day','日別分析')}
          ${navBtn('monthly','calendar-alt','月別分析')}
          ${navBtn('yearly','calendar','年間分析')}
          ${navBtn('compare','balance-scale','工場比較')}
          ${navBtn('workers','users','人員別分析')}
          ${u.role==='admin' && !state.useSampleData ? navBtn('target','bullseye','月間目標設定') : ''}
        </nav>
      </header>
      <main id="main" class="flex-1 max-w-7xl w-full mx-auto p-4"></main>
      <footer class="bg-white border-t py-3 text-center text-xs text-gray-500 no-print">
        村田鉄筋㈱ 加工数量分析システム
      </footer>
    </div>
  `;
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    try { if (!state.useSampleData) await api.logout(); } catch {}
    state.user = null;
    state.useSampleData = false;
    renderLogin();
  });
  document.querySelectorAll('[data-nav]').forEach(b => {
    b.addEventListener('click', () => navigateTo(b.dataset.nav));
  });
}

function navBtn(view, icon, label) {
  return `<button data-nav="${view}" class="nav-btn ${state.view===view?'active':''}">
    <i class="fas fa-${icon} mr-1"></i>${label}
  </button>`;
}

function navigateTo(view) {
  state.view = view;
  document.querySelectorAll('[data-nav]').forEach(b => {
    b.classList.toggle('active', b.dataset.nav === view);
  });
  renderMain().catch(e => {
    console.error('[renderMain]', e);
    const main = document.getElementById('main');
    if (main) setSectionError(main, e.message, { retry: () => renderMain() });
  });
}

// ========== メインビュー ==========
async function renderMain() {
  const main = document.getElementById('main');
  if (!main) return;
  setSectionLoading(main);
  try {
    switch (state.view) {
      case 'dashboard': await renderDashboard(); break;
      case 'input': renderInput(); break;
      case 'list': await renderList(); break;
      case 'daily': await renderDaily(); break;
      case 'monthly': await renderMonthly(); break;
      case 'yearly': await renderYearly(); break;
      case 'compare': await renderCompare(); break;
      case 'workers': await renderWorkers(); break;
      case 'target': await renderTargets(); break;
      default: renderDashboard();
    }
  } catch (err) {
    console.error('[view error]', err);
    setSectionError(main, err.message || '画面の表示に失敗しました', { retry: () => renderMain() });
  }
}

// ========== ダッシュボード ==========
async function renderDashboard() {
  let data;
  try {
    if (state.useSampleData) throw new Error('sample-mode');
    data = await api.dashboard();
  } catch (e) {
    // フォールバック: サンプルデータで集計
    data = buildDashboardFromRecords(SAMPLE_RECORDS);
    state.useSampleData = true;
  }

  // null/undefined防御
  data = data || {};
  data.today = data.today || { date: dayjs().format('YYYY-MM-DD'), rows: [] };
  data.month = data.month || { ym: dayjs().format('YYYY-MM'), rows: [], parts: {} };
  data.year  = data.year  || { year: dayjs().format('YYYY'), rows: [] };
  const todayRows = safeArray(data.today.rows);
  const monthRows = safeArray(data.month.rows);
  const yearRows  = safeArray(data.year.rows);
  const monthParts = data.month.parts || {};

  const todayHonsha = safeNum(todayRows.find(r=>r?.factory==='本社工場')?.qty);
  const todayDai2   = safeNum(todayRows.find(r=>r?.factory==='第二工場')?.qty);
  const todayTotal  = todayHonsha + todayDai2;
  const todayStaff  = todayRows.reduce((s,r)=>s+safeNum(r?.staff),0);

  const monthHonsha = safeNum(monthRows.find(r=>r?.factory==='本社工場')?.qty);
  const monthDai2   = safeNum(monthRows.find(r=>r?.factory==='第二工場')?.qty);
  const monthTotal  = monthHonsha + monthDai2;
  const monthStaff  = monthRows.reduce((s,r)=>s+safeNum(r?.staff),0);
  const monthDays   = monthRows.length ? Math.max(...monthRows.map(r=>safeNum(r?.days))) : 0;

  const yearHonsha  = safeNum(yearRows.find(r=>r?.factory==='本社工場')?.qty);
  const yearDai2    = safeNum(yearRows.find(r=>r?.factory==='第二工場')?.qty);
  const yearTotal   = yearHonsha + yearDai2;

  // 月間目標 (失敗しても無視)
  let targetThis = null;
  if (!state.useSampleData) {
    try {
      const ym = String(data.month.ym || '').split('-');
      if (ym.length === 2) {
        const targets = await api.targets(ym[0]);
        targetThis = safeArray(targets).find(t => Number(t.year)===Number(ym[0]) && Number(t.month)===Number(ym[1]) && t.factory==='全体');
      }
    } catch (e) { console.warn('targets取得失敗:', e.message); }
  }
  const targetRate = targetThis && targetThis.target_qty > 0 ? (monthTotal / targetThis.target_qty * 100) : null;

  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="space-y-6">
      ${state.useSampleData ? sampleBanner() : ''}
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-tachometer-alt mr-2"></i>ダッシュボード</h2>
        ${unitToggle()}
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div class="stat-card all">
          <div class="label"><i class="fas fa-calendar-day mr-1"></i>今日 (${dayjs(data.today.date).format('YYYY/MM/DD')})</div>
          <div class="value">${fmt.qty(todayTotal)}</div>
          <div class="sub">人工合計 ${fmtManDays(todayStaff)} / 1人工あたり ${todayStaff>0?fmt.qty(todayTotal/todayStaff):'-'}</div>
        </div>
        <div class="stat-card all">
          <div class="label"><i class="fas fa-calendar-alt mr-1"></i>今月 (${dayjs(data.month.ym+'-01').format('YYYY年M月')})</div>
          <div class="value">${fmt.qty(monthTotal)}</div>
          <div class="sub">稼働${monthDays}日 / 延べ${fmtManDays(monthStaff)}人工 / 1人工あたり ${monthStaff>0?fmt.qty(monthTotal/monthStaff):'-'}</div>
        </div>
        <div class="stat-card all">
          <div class="label"><i class="fas fa-calendar mr-1"></i>今年 (${data.year.year}年)</div>
          <div class="value">${fmt.qty(yearTotal)}</div>
          <div class="sub">本社 ${fmt.qty(yearHonsha)} / 第二 ${fmt.qty(yearDai2)}</div>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="stat-card honsha">
          <div class="label"><i class="fas fa-building mr-1"></i>本社工場（今月）</div>
          <div class="value text-blue-700">${fmt.qty(monthHonsha)}</div>
          <div class="sub">今日: ${fmt.qty(todayHonsha)}</div>
        </div>
        <div class="stat-card dai2">
          <div class="label"><i class="fas fa-warehouse mr-1"></i>第二工場（今月）</div>
          <div class="value text-green-700">${fmt.qty(monthDai2)}</div>
          <div class="sub">今日: ${fmt.qty(todayDai2)}</div>
        </div>
      </div>

      ${targetRate !== null ? `
        <div class="bg-white p-4 rounded-xl shadow-sm">
          <div class="flex justify-between text-sm mb-2">
            <span class="font-semibold"><i class="fas fa-bullseye mr-1 text-orange-500"></i>今月目標達成率 (全体)</span>
            <span class="font-bold">${targetRate.toFixed(1)}% (目標: ${fmt.qty(targetThis.target_qty)})</span>
          </div>
          <div class="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
            <div class="h-4 ${targetRate>=100?'bg-green-500':targetRate>=75?'bg-blue-500':targetRate>=50?'bg-yellow-500':'bg-red-500'}" style="width:${Math.min(targetRate,100)}%"></div>
          </div>
        </div>
      ` : ''}

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="bg-white p-4 rounded-xl shadow-sm">
          <h3 class="font-semibold mb-3"><i class="fas fa-chart-pie text-orange-500 mr-1"></i>今月の部位別構成</h3>
          <div class="relative" style="height:300px"><canvas id="partsChart"></canvas></div>
        </div>
        <div class="bg-white p-4 rounded-xl shadow-sm">
          <h3 class="font-semibold mb-3"><i class="fas fa-chart-bar text-blue-500 mr-1"></i>工場別 月間加工量</h3>
          <div class="relative" style="height:300px"><canvas id="factoryChart"></canvas></div>
        </div>
      </div>
    </div>
  `;
  bindUnitToggle();

  // 部位別グラフ
  const partsTotal = PART_KEYS.reduce((s,k)=>s+safeNum(monthParts[k]),0);
  if (partsTotal > 0) {
    safeCreateChart('partsChart', {
      type: 'doughnut',
      data: {
        labels: PART_KEYS.map(k => PART_LABELS[k]),
        datasets: [{ data: PART_KEYS.map(k => fmt.qtyVal(monthParts[k]||0)), backgroundColor: PART_KEYS.map(k => PART_COLORS[k]) }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
    });
  } else { emptyChartMessage('partsChart'); }

  if (monthTotal > 0) {
    safeCreateChart('factoryChart', {
      type: 'bar',
      data: {
        labels: ['本社工場','第二工場'],
        datasets: [{ label: `今月 (${state.qtyUnit})`, data: [fmt.qtyVal(monthHonsha), fmt.qtyVal(monthDai2)], backgroundColor: [FACTORY_COLORS['本社工場'], FACTORY_COLORS['第二工場']] }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  } else { emptyChartMessage('factoryChart'); }
}

function sampleBanner() {
  return `
    <div class="bg-orange-50 border border-orange-200 text-orange-800 px-4 py-3 rounded-lg flex items-start gap-2 text-sm">
      <i class="fas fa-info-circle mt-0.5"></i>
      <div class="flex-1">
        <p class="font-semibold">プレビューモード (ダミーデータ表示中)</p>
        <p class="text-xs mt-1">本番データに接続できないため、サンプルデータで画面を表示しています。ログインすると本番データを利用できます。</p>
      </div>
      <button onclick="state.useSampleData=false; state.user=null; renderLogin();" class="btn-secondary text-xs">
        <i class="fas fa-sign-in-alt mr-1"></i>ログインへ
      </button>
    </div>
  `;
}

// ローカル集計からdashboard型データを構築 (サンプル用)
function buildDashboardFromRecords(records) {
  records = safeArray(records);
  const today = dayjs().format('YYYY-MM-DD');
  const ym = dayjs().format('YYYY-MM');
  const year = dayjs().format('YYYY');

  const aggrByFactory = (filter) => {
    const filtered = records.filter(filter);
    const factories = ['本社工場','第二工場'];
    const rows = factories.map(f => {
      const fs = filtered.filter(r => r.factory === f);
      return {
        factory: f,
        qty: fs.reduce((s,r)=>s+safeNum(r.total_qty), 0),
        staff: fs.reduce((s,r)=>s+safeNum(r.staff_count), 0),
        days: new Set(fs.map(r=>r.date)).size
      };
    }).filter(r => r.qty > 0 || r.staff > 0);
    return rows;
  };

  const parts = {};
  PART_KEYS.forEach(k => {
    parts[k] = records.filter(r=>r.date && r.date.startsWith(ym)).reduce((s,r)=>s+safeNum(r[k]), 0);
  });

  return {
    today: { date: today, rows: aggrByFactory(r => r.date === today) },
    month: { ym, rows: aggrByFactory(r => r.date && r.date.startsWith(ym)), parts },
    year:  { year, rows: aggrByFactory(r => r.date && r.date.startsWith(year)) }
  };
}

function unitToggle() {
  return `
    <div class="flex items-center gap-1 bg-white rounded-lg p-1 border">
      <button data-unit="kg" class="px-3 py-1 rounded text-sm ${state.qtyUnit==='kg'?'bg-blue-600 text-white':'text-gray-700'}">kg</button>
      <button data-unit="t" class="px-3 py-1 rounded text-sm ${state.qtyUnit==='t'?'bg-blue-600 text-white':'text-gray-700'}">t</button>
    </div>
  `;
}
function bindUnitToggle() {
  document.querySelectorAll('[data-unit]').forEach(b => {
    b.addEventListener('click', () => {
      state.qtyUnit = b.dataset.unit;
      renderMain();
    });
  });
}

function safeCreateChart(canvasId, config) {
  try {
    const el = document.getElementById(canvasId);
    if (!el) return;
    if (state.charts[canvasId]) {
      try { state.charts[canvasId].destroy(); } catch {}
    }
    if (typeof Chart === 'undefined') {
      emptyChartMessage(canvasId);
      return;
    }
    state.charts[canvasId] = new Chart(el, config);
  } catch (e) {
    console.warn('[chart error]', canvasId, e);
    emptyChartMessage(canvasId);
  }
}

// ========== 入力画面 ==========
function renderInput(record = null) {
  state.editingId = record?.id || null;
  const isEdit = !!record;
  const r = record || {
    date: dayjs().format('YYYY-MM-DD'),
    factory: '本社工場',
    staff_count: '',
    foundation_qty:'', base_qty:'', column_qty:'', beam_qty:'', fukashi_qty:'',
    slab_qty:'', doma_qty:'', civil_qty:'', wooden_qty:'', other_qty:'',
    note: '',
    worker_names: [],
    workers: []
  };
  // ローカルの人員リスト (UIで動的編集): [{name, man_days}]
  let workers = normalizeWorkersClient(r.workers, r.worker_names);
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="max-w-3xl mx-auto">
      ${state.useSampleData ? sampleBanner() : ''}
      <h2 class="text-xl font-bold text-gray-800 mb-4">
        <i class="fas fa-plus-circle mr-2"></i>${isEdit?'加工実績の編集':'加工数量入力'}
      </h2>
      <form id="recordForm" class="bg-white rounded-xl shadow-sm p-6 space-y-5">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">日付 <span class="text-red-500">*</span></label>
            <input id="date" type="date" required value="${r.date}" class="input-base" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">工場区分 <span class="text-red-500">*</span></label>
            <select id="factory" required class="input-base">
              <option value="本社工場" ${r.factory==='本社工場'?'selected':''}>本社工場</option>
              <option value="第二工場" ${r.factory==='第二工場'?'selected':''}>第二工場</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">人員数（人工合計） <span id="staffAutoBadge" class="text-xs text-blue-600 hidden">(人工合計から自動計算)</span></label>
            <input id="staff_count" type="number" min="0" step="0.25" value="${r.staff_count||''}" class="input-num" placeholder="例: 2.5" inputmode="decimal" />
          </div>
        </div>

        <div class="bg-indigo-50 border border-indigo-200 p-4 rounded-lg">
          <div class="flex items-center justify-between mb-2 flex-wrap gap-2">
            <h3 class="font-semibold text-indigo-900">
              <i class="fas fa-users mr-1"></i>人員名 <span id="workerCount" class="text-xs font-normal text-gray-600 ml-1"></span>
            </h3>
            <button type="button" id="addWorkerBtn" class="btn-secondary text-sm">
              <i class="fas fa-plus mr-1"></i>人員を追加
            </button>
          </div>
          <p class="text-xs text-gray-600 mb-2">人員名と人工（1日=1.0、半日=0.5、四半日=0.25）を入力してください。人工合計が「人員数」に自動セットされます。空欄なら「人員数」欄を手入力できます。</p>
          <div id="workerList" class="space-y-2"></div>
        </div>

        ${!isEdit ? `
        <div class="bg-blue-50 p-3 rounded-lg flex items-center justify-between flex-wrap gap-2">
          <p class="text-sm text-blue-800"><i class="fas fa-copy mr-1"></i>同じ工場の前回データをコピーできます</p>
          <button type="button" id="copyPrevBtn" class="btn-secondary text-sm">
            <i class="fas fa-clone mr-1"></i>前回コピー
          </button>
        </div>` : ''}

        <div>
          <h3 class="font-semibold text-gray-700 mb-2">
            <i class="fas fa-cubes mr-1"></i>部位別加工数量 (kg)
          </h3>
          <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
            ${PART_KEYS.map(k => `
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1 part-${k.replace('_qty','')} px-2 py-1 rounded">
                  ${PART_LABELS[k]}
                </label>
                <input id="${k}" type="number" min="0" step="1" value="${r[k]||''}" class="input-num qty-input" placeholder="0" inputmode="numeric" />
              </div>
            `).join('')}
          </div>
        </div>

        <div class="bg-gray-50 p-4 rounded-lg flex items-center justify-between flex-wrap gap-3">
          <div>
            <p class="text-sm text-gray-600">総加工数量</p>
            <p id="totalDisplay" class="text-2xl font-bold text-blue-700">0 kg</p>
          </div>
          <div>
            <p class="text-sm text-gray-600">1人工あたり加工数量</p>
            <p id="perDisplay" class="text-2xl font-bold text-green-700">0 kg</p>
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">備考</label>
          <textarea id="note" rows="2" class="input-base" placeholder="任意">${escapeHtml(r.note||'')}</textarea>
        </div>

        <div class="flex gap-3 pt-2">
          <button type="submit" class="btn-primary flex-1" ${state.useSampleData?'disabled':''}>
            <i class="fas fa-save mr-2"></i>${isEdit?'更新する':'登録する'}
          </button>
          ${isEdit ? `<button type="button" id="cancelEdit" class="btn-secondary">キャンセル</button>` : ''}
        </div>
        ${state.useSampleData ? `<p class="text-xs text-orange-700"><i class="fas fa-info-circle mr-1"></i>プレビューモードでは登録できません。ログインしてご利用ください。</p>` : ''}
        <div id="formError" class="text-red-600 text-sm hidden"></div>
      </form>
    </div>
  `;

  // 人員 UI の描画 (workers配列とDOMを同期)
  const renderWorkerList = () => {
    const list = document.getElementById('workerList');
    if (!list) return;
    if (workers.length === 0) {
      list.innerHTML = `<p class="text-sm text-gray-500 italic py-2">人員は未入力です（人員数は手入力できます）</p>`;
    } else {
      list.innerHTML = workers.map((w, i) => `
        <div class="flex flex-col sm:flex-row gap-2 sm:items-center bg-white p-2 rounded border border-indigo-100">
          <div class="flex-1">
            <label class="text-xs text-gray-500 sm:hidden">人員名</label>
            <input type="text" data-worker-name-idx="${i}" value="${escapeHtml(w.name||'')}" placeholder="人員名" class="input-base w-full" />
          </div>
          <div class="w-full sm:w-28">
            <label class="text-xs text-gray-500 sm:hidden">人工</label>
            <input type="number" data-worker-md-idx="${i}" value="${fmtManDays(w.man_days)}" min="0" max="1" step="0.25" placeholder="1.0" class="input-num w-full" inputmode="decimal" title="人工 (1日=1.0、半日=0.5、四半日=0.25)" />
          </div>
          <button type="button" data-worker-del="${i}" class="btn-danger text-sm whitespace-nowrap sm:w-auto" title="削除">
            <i class="fas fa-trash"></i><span class="hidden sm:inline ml-1">削除</span>
          </button>
        </div>
      `).join('');
    }
    // 人員名入力
    list.querySelectorAll('[data-worker-name-idx]').forEach(inp => {
      inp.addEventListener('input', (e) => {
        const idx = Number(e.target.dataset.workerNameIdx);
        if (workers[idx]) workers[idx].name = e.target.value;
        syncStaffFromWorkers();
        recalc();
      });
    });
    // 人工入力
    list.querySelectorAll('[data-worker-md-idx]').forEach(inp => {
      inp.addEventListener('input', (e) => {
        const idx = Number(e.target.dataset.workerMdIdx);
        if (workers[idx]) workers[idx].man_days = e.target.value; // 値の正規化は送信/集計時
        syncStaffFromWorkers();
        recalc();
      });
      inp.addEventListener('blur', (e) => {
        const idx = Number(e.target.dataset.workerMdIdx);
        if (workers[idx]) {
          workers[idx].man_days = clampManDaysClient(e.target.value);
          e.target.value = fmtManDays(workers[idx].man_days);
        }
        syncStaffFromWorkers();
        recalc();
      });
    });
    // 削除
    list.querySelectorAll('[data-worker-del]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = Number(e.currentTarget.dataset.workerDel);
        workers.splice(idx, 1);
        renderWorkerList();
        syncStaffFromWorkers();
        recalc();
      });
    });
    // 人員名（3人 / 2.5人工） 表示
    const nameCount = workers.filter(w => String(w.name||'').trim()).length;
    const mdSum = sumManDays(workers);
    const wcEl = document.getElementById('workerCount');
    if (wcEl) {
      wcEl.textContent = nameCount > 0 ? `（${nameCount}人 / ${fmtManDays(mdSum)}人工）` : '';
    }
  };
  const syncStaffFromWorkers = () => {
    const nameCount = workers.filter(w => String(w.name||'').trim()).length;
    const mdSum = sumManDays(workers);
    const staffInput = document.getElementById('staff_count');
    const badge = document.getElementById('staffAutoBadge');
    if (nameCount > 0) {
      staffInput.value = fmtManDays(mdSum);
      staffInput.readOnly = true;
      staffInput.classList.add('bg-gray-100', 'cursor-not-allowed');
      badge.classList.remove('hidden');
    } else {
      staffInput.readOnly = false;
      staffInput.classList.remove('bg-gray-100', 'cursor-not-allowed');
      badge.classList.add('hidden');
    }
  };

  document.getElementById('addWorkerBtn').addEventListener('click', () => {
    workers.push({ name: '', man_days: 1 });
    renderWorkerList();
    syncStaffFromWorkers();
    // 直後に新しい入力欄にフォーカス
    setTimeout(() => {
      const list = document.getElementById('workerList');
      const inputs = list?.querySelectorAll('input[data-worker-name-idx]');
      if (inputs && inputs.length) inputs[inputs.length - 1].focus();
    }, 0);
  });

  renderWorkerList();
  syncStaffFromWorkers();

  const recalc = () => {
    let total = 0;
    PART_KEYS.forEach(k => { total += safeNum(document.getElementById(k).value); });
    // 人員名入力時は人工合計を staff_count に同期済み (syncStaffFromWorkers)。手入力時は staff_count を参照。
    const staff = safeNum(document.getElementById('staff_count').value);
    const per = staff > 0 ? total / staff : 0;
    document.getElementById('totalDisplay').textContent = fmt.num(total) + ' kg';
    document.getElementById('perDisplay').textContent = staff > 0 ? fmt.num(per) + ' kg' : '-';
  };
  document.querySelectorAll('#recordForm input, #recordForm select').forEach(el => el.addEventListener('input', recalc));
  recalc();

  document.getElementById('copyPrevBtn')?.addEventListener('click', async () => {
    if (state.useSampleData) { alert('プレビューモードでは使用できません'); return; }
    const date = document.getElementById('date').value;
    const factory = document.getElementById('factory').value;
    try {
      const prev = await api.previousRecord(date, factory);
      if (!prev) { alert('過去データがありません'); return; }
      PART_KEYS.forEach(k => { document.getElementById(k).value = prev[k] || ''; });
      // 人員名と人工をコピー (日付は今日のまま)
      workers = normalizeWorkersClient(prev.workers, prev.worker_names);
      renderWorkerList();
      // 人員未入力なら人員数は前回値、入力済みなら人工合計を自動セット
      if (workers.length === 0) {
        document.getElementById('staff_count').value = prev.staff_count || '';
      }
      syncStaffFromWorkers();
      document.getElementById('note').value = prev.note || '';
      recalc();
      alert(`${prev.date} のデータをコピーしました（日付は今日のままです）`);
    } catch (e) {
      alert('取得に失敗しました: ' + (e.message || ''));
    }
  });

  document.getElementById('cancelEdit')?.addEventListener('click', () => {
    state.editingId = null;
    navigateTo('list');
  });

  document.getElementById('recordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.useSampleData) { alert('プレビューモードでは登録できません'); return; }
    // 入力中の人員をスナップショット (空白除去・man_days正規化)
    const cleanWorkers = normalizeWorkersClient(workers);
    const data = {
      date: document.getElementById('date').value,
      factory: document.getElementById('factory').value,
      staff_count: document.getElementById('staff_count').value,
      note: document.getElementById('note').value,
      workers: cleanWorkers,
      // 後方互換: workers が空のときも worker_names を送る
      worker_names: cleanWorkers.map(w => w.name)
    };
    PART_KEYS.forEach(k => { data[k] = document.getElementById(k).value; });
    const err = document.getElementById('formError');
    err.classList.add('hidden');
    try {
      if (isEdit) {
        await api.updateRecord(record.id, data);
        alert('更新しました');
        state.editingId = null;
        navigateTo('list');
      } else {
        await api.createRecord(data);
        alert('登録しました');
        document.getElementById('recordForm').reset();
        document.getElementById('date').value = dayjs().format('YYYY-MM-DD');
        workers = [];
        renderWorkerList();
        syncStaffFromWorkers();
        recalc();
      }
    } catch (e) {
      err.textContent = e?.message || '保存に失敗しました';
      err.classList.remove('hidden');
    }
  });
}

// ========== 一覧画面 ==========
async function renderList() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="space-y-4">
      ${state.useSampleData ? sampleBanner() : ''}
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-table mr-2"></i>加工実績一覧</h2>
        <div class="flex gap-2 flex-wrap">
          ${unitToggle()}
          <button id="csvBtn" class="btn-secondary text-sm"><i class="fas fa-file-csv mr-1"></i>CSV</button>
          <button id="pdfBtn" class="btn-secondary text-sm"><i class="fas fa-file-pdf mr-1"></i>PDF</button>
        </div>
      </div>
      <div class="bg-white p-4 rounded-xl shadow-sm">
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div><label class="block text-xs text-gray-600 mb-1">開始日</label><input id="fDateFrom" type="date" value="${state.dateFrom||''}" class="input-base" /></div>
          <div><label class="block text-xs text-gray-600 mb-1">終了日</label><input id="fDateTo" type="date" value="${state.dateTo||''}" class="input-base" /></div>
          <div><label class="block text-xs text-gray-600 mb-1">年</label><input id="fYear" type="number" value="${state.yearFilter||''}" class="input-base" /></div>
          <div>
            <label class="block text-xs text-gray-600 mb-1">月</label>
            <select id="fMonth" class="input-base">
              <option value="">全て</option>
              ${Array.from({length:12},(_,i)=>i+1).map(m=>`<option value="${m}" ${state.monthFilter==String(m)?'selected':''}>${m}月</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-xs text-gray-600 mb-1">工場</label>
            <select id="fFactory" class="input-base">
              <option value="all" ${state.factoryFilter==='all'?'selected':''}>全体</option>
              <option value="本社工場" ${state.factoryFilter==='本社工場'?'selected':''}>本社工場</option>
              <option value="第二工場" ${state.factoryFilter==='第二工場'?'selected':''}>第二工場</option>
            </select>
          </div>
        </div>
        <div class="flex gap-2 mt-3 flex-wrap">
          <button id="applyFilter" class="btn-primary text-sm"><i class="fas fa-search mr-1"></i>絞り込み</button>
          <button id="clearFilter" class="btn-secondary text-sm">クリア</button>
        </div>
      </div>
      <div id="listArea" class="bg-white rounded-xl shadow-sm overflow-x-auto"></div>
    </div>
  `;
  bindUnitToggle();
  document.getElementById('applyFilter').addEventListener('click', () => {
    state.dateFrom = document.getElementById('fDateFrom').value;
    state.dateTo = document.getElementById('fDateTo').value;
    state.yearFilter = document.getElementById('fYear').value;
    state.monthFilter = document.getElementById('fMonth').value;
    state.factoryFilter = document.getElementById('fFactory').value;
    loadListData();
  });
  document.getElementById('clearFilter').addEventListener('click', () => {
    state.dateFrom = ''; state.dateTo = ''; state.yearFilter = ''; state.monthFilter = ''; state.factoryFilter = 'all';
    loadListData();
  });
  document.getElementById('csvBtn').addEventListener('click', exportListCSV);
  document.getElementById('pdfBtn').addEventListener('click', exportListPDF);

  await loadListData();
}

async function loadListData() {
  const area = document.getElementById('listArea');
  if (!area) return;
  setSectionLoading(area);
  try {
    if (state.useSampleData) {
      state.records = filterRecordsLocal(SAMPLE_RECORDS);
    } else {
      const params = {};
      if (state.dateFrom) params.dateFrom = state.dateFrom;
      if (state.dateTo) params.dateTo = state.dateTo;
      if (state.yearFilter) params.year = state.yearFilter;
      if (state.monthFilter) params.month = state.monthFilter;
      if (state.factoryFilter && state.factoryFilter !== 'all') params.factory = state.factoryFilter;
      state.records = safeArray(await api.listRecords(params));
    }
    renderListTable();
  } catch (e) {
    setSectionError(area, e.message, {
      retry: () => loadListData(),
      sample: () => { state.useSampleData = true; loadListData(); }
    });
  }
}

function filterRecordsLocal(records) {
  let r = safeArray(records);
  if (state.dateFrom) r = r.filter(x => x.date >= state.dateFrom);
  if (state.dateTo) r = r.filter(x => x.date <= state.dateTo);
  if (state.yearFilter) r = r.filter(x => x.date && x.date.startsWith(String(state.yearFilter)));
  if (state.monthFilter) {
    const m = String(state.monthFilter).padStart(2,'0');
    r = r.filter(x => x.date && x.date.slice(5,7) === m);
  }
  if (state.factoryFilter && state.factoryFilter !== 'all') r = r.filter(x => x.factory === state.factoryFilter);
  return r;
}

function renderListTable() {
  const area = document.getElementById('listArea');
  if (!area) return;
  const records = safeArray(state.records);
  if (records.length === 0) {
    area.innerHTML = `<div class="text-center py-10 text-gray-500"><i class="fas fa-inbox text-4xl mb-2"></i><p>データがありません</p></div>`;
    return;
  }
  const perValues = records.map(r => safeNum(r.qty_per_person)).filter(v => v > 0);
  const avgPer = perValues.length ? perValues.reduce((a,b)=>a+b,0) / perValues.length : 0;

  const isAdmin = state.user?.role === 'admin';
  area.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>日付</th><th>工場</th><th>人工合計</th><th>人員名（人工）</th>
          ${PART_KEYS.map(k=>`<th class="part-${k.replace('_qty','')}">${PART_LABELS[k]}</th>`).join('')}
          <th>総加工量</th><th>1人工あたり</th><th>備考</th><th class="no-print">操作</th>
        </tr>
      </thead>
      <tbody>
        ${records.map(r => {
          const total = safeNum(r.total_qty);
          const lowQty = total > 0 && total < 5000;
          const per = safeNum(r.qty_per_person);
          const highPer = per > 0 && avgPer > 0 && per > avgPer * 1.2;
          const wlist = normalizeWorkersClient(r.workers, r.worker_names);
          const wnHtml = wlist.length
            ? wlist.map(w => `<span class="inline-block px-1.5 py-0.5 bg-indigo-100 text-indigo-800 rounded text-xs mr-1 mb-1">${escapeHtml(w.name)}<span class="ml-1 text-indigo-600">(${fmtManDays(w.man_days)})</span></span>`).join('')
            : '<span class="text-gray-400 text-xs">-</span>';
          return `<tr class="${lowQty?'low-qty':''} ${highPer?'high-perperson':''}">
            <td class="text">${fmt.date(r.date)}</td>
            <td class="text"><span class="px-2 py-1 rounded text-xs ${r.factory==='本社工場'?'badge-honsha':'badge-dai2'}">${escapeHtml(r.factory||'')}</span></td>
            <td>${fmtManDays(safeNum(r.staff_count))}</td>
            <td class="text text-xs" style="min-width:140px">${wnHtml}</td>
            ${PART_KEYS.map(k=>`<td>${fmt.qty(r[k])}</td>`).join('')}
            <td class="font-bold">${fmt.qty(total)}</td>
            <td>${per>0?fmt.qty(per):'-'}</td>
            <td class="text text-xs">${escapeHtml(r.note||'')}</td>
            <td class="no-print">
              <div class="flex gap-1 justify-center">
                <button data-edit="${r.id}" class="text-blue-600 hover:underline text-xs" ${state.useSampleData?'disabled':''}><i class="fas fa-edit"></i> 編集</button>
                ${isAdmin && !state.useSampleData?`<button data-del="${r.id}" class="text-red-600 hover:underline text-xs"><i class="fas fa-trash"></i> 削除</button>`:''}
              </div>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
  area.querySelectorAll('[data-edit]').forEach(b => {
    b.addEventListener('click', async () => {
      if (state.useSampleData) { alert('プレビューモードでは編集できません'); return; }
      try {
        const rec = await api.getRecord(b.dataset.edit);
        navigateTo('input');
        setTimeout(() => renderInput(rec), 0);
      } catch (e) { alert('取得失敗: ' + e.message); }
    });
  });
  area.querySelectorAll('[data-del]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm('削除してよろしいですか?')) return;
      try { await api.deleteRecord(b.dataset.del); loadListData(); }
      catch (e) { alert('削除失敗: ' + e.message); }
    });
  });
}

// ========== 日別分析 ==========
async function renderDaily() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="space-y-4">
      ${state.useSampleData ? sampleBanner() : ''}
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-calendar-day mr-2"></i>日別分析</h2>
        ${unitToggle()}
      </div>
      <div class="bg-white p-4 rounded-xl shadow-sm grid grid-cols-2 md:grid-cols-4 gap-3">
        <div><label class="block text-xs text-gray-600 mb-1">開始日</label><input id="dFrom" type="date" value="${state.dateFrom || dayjs().subtract(30,'day').format('YYYY-MM-DD')}" class="input-base" /></div>
        <div><label class="block text-xs text-gray-600 mb-1">終了日</label><input id="dTo" type="date" value="${state.dateTo || dayjs().format('YYYY-MM-DD')}" class="input-base" /></div>
        <div>
          <label class="block text-xs text-gray-600 mb-1">工場</label>
          <select id="dFactory" class="input-base">
            <option value="all">全体合算</option>
            <option value="本社工場">本社工場のみ</option>
            <option value="第二工場">第二工場のみ</option>
          </select>
        </div>
        <div class="flex items-end gap-2 flex-wrap">
          <button id="dApply" class="btn-primary text-sm flex-1"><i class="fas fa-search mr-1"></i>表示</button>
          <button id="dCsv" class="btn-secondary text-sm"><i class="fas fa-file-csv"></i></button>
          <button id="dPdf" class="btn-secondary text-sm"><i class="fas fa-file-pdf"></i></button>
        </div>
      </div>
      <div class="bg-white p-4 rounded-xl shadow-sm">
        <div class="relative" style="height:360px"><canvas id="dailyChart"></canvas></div>
      </div>
      <div id="dailyTable" class="bg-white rounded-xl shadow-sm overflow-x-auto"></div>
    </div>
  `;
  bindUnitToggle();

  const load = async () => {
    const tableEl = document.getElementById('dailyTable');
    setSectionLoading(tableEl);
    const dateFrom = document.getElementById('dFrom').value;
    const dateTo = document.getElementById('dTo').value;
    const factory = document.getElementById('dFactory').value;
    let data = [];
    try {
      if (state.useSampleData) {
        data = aggregateDailyLocal(SAMPLE_RECORDS, { dateFrom, dateTo, factory });
      } else {
        data = await api.daily({ dateFrom, dateTo, factory });
      }
    } catch (e) {
      setSectionError(tableEl, e.message, { retry: load, sample: () => { state.useSampleData = true; load(); } });
      emptyChartMessage('dailyChart');
      return;
    }
    data = safeArray(data);

    const dates = [...new Set(data.map(d => d.date))].sort();
    if (dates.length === 0) {
      tableEl.innerHTML = `<div class="text-center py-10 text-gray-500"><i class="fas fa-inbox text-3xl"></i><p class="mt-2">表示できるデータがありません</p></div>`;
      emptyChartMessage('dailyChart');
      return;
    }
    const honshaData = dates.map(d => fmt.qtyVal(data.find(x=>x.date===d && x.factory==='本社工場')?.total_qty||0));
    const dai2Data = dates.map(d => fmt.qtyVal(data.find(x=>x.date===d && x.factory==='第二工場')?.total_qty||0));
    const datasets = [];
    if (factory === 'all' || factory === '本社工場') datasets.push({ label: '本社工場', data: honshaData, backgroundColor: FACTORY_COLORS['本社工場'] });
    if (factory === 'all' || factory === '第二工場') datasets.push({ label: '第二工場', data: dai2Data, backgroundColor: FACTORY_COLORS['第二工場'] });
    safeCreateChart('dailyChart', {
      type: 'bar',
      data: { labels: dates.map(d => dayjs(d).format('M/D')), datasets },
      options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: factory==='all' }, y: { stacked: factory==='all', beginAtZero: true, title: { display: true, text: state.qtyUnit } } } }
    });

    tableEl.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>日付</th><th>工場</th><th>人工合計</th>
          ${PART_KEYS.map(k=>`<th>${PART_LABELS[k]}</th>`).join('')}
          <th>合計</th><th>1人工あたり</th>
        </tr></thead>
        <tbody>
          ${data.map(r => `<tr>
            <td class="text">${fmt.date(r.date)}</td>
            <td class="text"><span class="px-2 py-1 rounded text-xs ${r.factory==='本社工場'?'badge-honsha':'badge-dai2'}">${escapeHtml(r.factory||'')}</span></td>
            <td>${fmtManDays(safeNum(r.staff_count))}</td>
            ${PART_KEYS.map(k=>`<td>${fmt.qty(r[k])}</td>`).join('')}
            <td class="font-bold">${fmt.qty(r.total_qty)}</td>
            <td>${safeNum(r.qty_per_person)>0?fmt.qty(r.qty_per_person):'-'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    `;

    document.getElementById('dCsv').onclick = () => exportCSV('日別分析', data, ['date','factory','staff_count',...PART_KEYS,'total_qty','qty_per_person']);
    document.getElementById('dPdf').onclick = () => exportPDF('日別分析レポート', data, 'daily');
  };
  document.getElementById('dApply').addEventListener('click', load);
  await load();
}

function aggregateDailyLocal(records, { dateFrom, dateTo, factory }) {
  let r = safeArray(records);
  if (dateFrom) r = r.filter(x => x.date >= dateFrom);
  if (dateTo) r = r.filter(x => x.date <= dateTo);
  if (factory && factory !== 'all') r = r.filter(x => x.factory === factory);
  const keys = {};
  r.forEach(rec => {
    const k = rec.date + '|' + rec.factory;
    if (!keys[k]) keys[k] = { date: rec.date, factory: rec.factory, staff_count: 0, total_qty: 0 };
    PART_KEYS.forEach(p => { keys[k][p] = safeNum(keys[k][p]) + safeNum(rec[p]); });
    keys[k].staff_count += safeNum(rec.staff_count);
    keys[k].total_qty += safeNum(rec.total_qty);
  });
  return Object.values(keys).map(k => ({
    ...k,
    qty_per_person: k.staff_count > 0 ? k.total_qty / k.staff_count : 0
  })).sort((a,b) => a.date.localeCompare(b.date));
}

// ========== 月別分析 ==========
async function renderMonthly() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="space-y-4">
      ${state.useSampleData ? sampleBanner() : ''}
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-calendar-alt mr-2"></i>月別分析</h2>
        ${unitToggle()}
      </div>
      <div class="bg-white p-4 rounded-xl shadow-sm grid grid-cols-2 md:grid-cols-4 gap-3">
        <div><label class="block text-xs text-gray-600 mb-1">年</label><input id="mYear" type="number" value="${state.yearFilter||new Date().getFullYear()}" class="input-base" /></div>
        <div>
          <label class="block text-xs text-gray-600 mb-1">工場</label>
          <select id="mFactory" class="input-base">
            <option value="all">全体合算</option>
            <option value="本社工場">本社工場のみ</option>
            <option value="第二工場">第二工場のみ</option>
          </select>
        </div>
        <div class="flex items-end gap-2 flex-wrap">
          <button id="mApply" class="btn-primary text-sm flex-1"><i class="fas fa-search mr-1"></i>表示</button>
          <button id="mCsv" class="btn-secondary text-sm"><i class="fas fa-file-csv"></i></button>
          <button id="mPdf" class="btn-secondary text-sm"><i class="fas fa-file-pdf"></i></button>
        </div>
      </div>
      <div class="bg-white p-4 rounded-xl shadow-sm">
        <div class="relative" style="height:360px"><canvas id="monthlyChart"></canvas></div>
      </div>
      <div id="monthlyTable" class="bg-white rounded-xl shadow-sm overflow-x-auto"></div>
    </div>
  `;
  bindUnitToggle();

  const load = async () => {
    const tableEl = document.getElementById('monthlyTable');
    setSectionLoading(tableEl);
    const year = document.getElementById('mYear').value;
    const factory = document.getElementById('mFactory').value;
    let data = [];
    try {
      if (state.useSampleData) {
        data = aggregateMonthlyLocal(SAMPLE_RECORDS, { year, factory });
      } else {
        data = await api.monthly({ year, factory });
      }
    } catch (e) {
      setSectionError(tableEl, e.message, { retry: load, sample: () => { state.useSampleData = true; load(); } });
      emptyChartMessage('monthlyChart');
      return;
    }
    data = safeArray(data);
    const months = [...new Set(data.map(d => d.ym))].sort();

    if (months.length === 0) {
      tableEl.innerHTML = `<div class="text-center py-10 text-gray-500"><i class="fas fa-inbox text-3xl"></i><p class="mt-2">表示できるデータがありません</p></div>`;
      emptyChartMessage('monthlyChart');
      return;
    }
    const honshaData = months.map(m => fmt.qtyVal(data.find(x=>x.ym===m && x.factory==='本社工場')?.total_qty||0));
    const dai2Data = months.map(m => fmt.qtyVal(data.find(x=>x.ym===m && x.factory==='第二工場')?.total_qty||0));
    const datasets = [];
    if (factory === 'all' || factory === '本社工場') datasets.push({ label: '本社工場', data: honshaData, backgroundColor: FACTORY_COLORS['本社工場'] });
    if (factory === 'all' || factory === '第二工場') datasets.push({ label: '第二工場', data: dai2Data, backgroundColor: FACTORY_COLORS['第二工場'] });
    safeCreateChart('monthlyChart', {
      type: 'bar',
      data: { labels: months.map(m => dayjs(m+'-01').format('YYYY/M月')), datasets },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, title: { display: true, text: state.qtyUnit } } } }
    });

    tableEl.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>月</th><th>工場</th><th>稼働日</th><th>延べ人工</th>
          ${PART_KEYS.map(k=>`<th>${PART_LABELS[k]}</th>`).join('')}
          <th>月間合計</th><th>1日平均</th><th>1人平均</th>
        </tr></thead>
        <tbody>
          ${data.map(r => `<tr>
            <td class="text">${dayjs(r.ym+'-01').format('YYYY/M月')}</td>
            <td class="text"><span class="px-2 py-1 rounded text-xs ${r.factory==='本社工場'?'badge-honsha':'badge-dai2'}">${escapeHtml(r.factory||'')}</span></td>
            <td>${safeNum(r.days)}</td>
            <td>${fmtManDays(safeNum(r.staff_count))}</td>
            ${PART_KEYS.map(k=>`<td>${fmt.qty(r[k])}</td>`).join('')}
            <td class="font-bold">${fmt.qty(r.total_qty)}</td>
            <td>${fmt.qty(r.avg_daily_qty)}</td>
            <td>${safeNum(r.qty_per_person)>0?fmt.qty(r.qty_per_person):'-'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    `;
    document.getElementById('mCsv').onclick = () => exportCSV('月別分析', data, ['ym','factory','days','staff_count',...PART_KEYS,'total_qty','avg_daily_qty','qty_per_person']);
    document.getElementById('mPdf').onclick = () => exportPDF('月別分析レポート', data, 'monthly');
  };
  document.getElementById('mApply').addEventListener('click', load);
  await load();
}

function aggregateMonthlyLocal(records, { year, factory }) {
  let r = safeArray(records);
  if (year) r = r.filter(x => x.date && x.date.startsWith(String(year)));
  if (factory && factory !== 'all') r = r.filter(x => x.factory === factory);
  const keys = {};
  r.forEach(rec => {
    const ym = (rec.date||'').slice(0,7);
    const k = ym + '|' + rec.factory;
    if (!keys[k]) keys[k] = { ym, factory: rec.factory, staff_count: 0, total_qty: 0, days_set: new Set() };
    PART_KEYS.forEach(p => { keys[k][p] = safeNum(keys[k][p]) + safeNum(rec[p]); });
    keys[k].staff_count += safeNum(rec.staff_count);
    keys[k].total_qty += safeNum(rec.total_qty);
    keys[k].days_set.add(rec.date);
  });
  return Object.values(keys).map(k => {
    const days = k.days_set.size;
    return { ...k, days, days_set: undefined,
      qty_per_person: k.staff_count > 0 ? k.total_qty / k.staff_count : 0,
      avg_daily_qty: days > 0 ? k.total_qty / days : 0
    };
  }).sort((a,b) => a.ym.localeCompare(b.ym));
}

// ========== 年間分析 ==========
async function renderYearly() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="space-y-4">
      ${state.useSampleData ? sampleBanner() : ''}
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-calendar mr-2"></i>年間分析</h2>
        ${unitToggle()}
      </div>
      <div class="bg-white p-4 rounded-xl shadow-sm grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label class="block text-xs text-gray-600 mb-1">工場</label>
          <select id="yFactory" class="input-base">
            <option value="all">全体合算</option>
            <option value="本社工場">本社工場のみ</option>
            <option value="第二工場">第二工場のみ</option>
          </select>
        </div>
        <div><label class="block text-xs text-gray-600 mb-1">月別推移 表示年</label><input id="yTrendYear" type="number" value="${new Date().getFullYear()}" class="input-base" /></div>
        <div class="flex items-end gap-2 flex-wrap">
          <button id="yApply" class="btn-primary text-sm flex-1"><i class="fas fa-search mr-1"></i>表示</button>
          <button id="yCsv" class="btn-secondary text-sm"><i class="fas fa-file-csv"></i></button>
          <button id="yPdf" class="btn-secondary text-sm"><i class="fas fa-file-pdf"></i></button>
        </div>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="bg-white p-4 rounded-xl shadow-sm">
          <h3 class="font-semibold mb-2">年別 加工数量</h3>
          <div class="relative" style="height:320px"><canvas id="yearlyChart"></canvas></div>
        </div>
        <div class="bg-white p-4 rounded-xl shadow-sm">
          <h3 class="font-semibold mb-2">月別推移 (1人工あたり)</h3>
          <div class="relative" style="height:320px"><canvas id="trendChart"></canvas></div>
        </div>
      </div>
      <div class="bg-white p-4 rounded-xl shadow-sm">
        <h3 class="font-semibold mb-2">部位別 年間集計</h3>
        <div class="relative" style="height:320px"><canvas id="yearPartsChart"></canvas></div>
      </div>
      <div id="yearlyTable" class="bg-white rounded-xl shadow-sm overflow-x-auto"></div>
    </div>
  `;
  bindUnitToggle();

  const load = async () => {
    const tableEl = document.getElementById('yearlyTable');
    setSectionLoading(tableEl);
    const factory = document.getElementById('yFactory').value;
    const trendYear = document.getElementById('yTrendYear').value;
    let data = [], monthly = [];
    try {
      if (state.useSampleData) {
        data = aggregateYearlyLocal(SAMPLE_RECORDS, { factory });
        monthly = aggregateMonthlyLocal(SAMPLE_RECORDS, { year: trendYear, factory });
      } else {
        [data, monthly] = await Promise.all([
          api.yearly({ factory }),
          api.monthly({ year: trendYear, factory })
        ]);
      }
    } catch (e) {
      setSectionError(tableEl, e.message, { retry: load, sample: () => { state.useSampleData = true; load(); } });
      ['yearlyChart','trendChart','yearPartsChart'].forEach(emptyChartMessage);
      return;
    }
    data = safeArray(data);
    monthly = safeArray(monthly);

    if (data.length === 0) {
      tableEl.innerHTML = `<div class="text-center py-10 text-gray-500"><i class="fas fa-inbox text-3xl"></i><p class="mt-2">表示できるデータがありません</p></div>`;
      ['yearlyChart','trendChart','yearPartsChart'].forEach(emptyChartMessage);
      return;
    }

    const years = [...new Set(data.map(d => d.year))].sort();
    const honshaData = years.map(y => fmt.qtyVal(data.find(x=>x.year===y && x.factory==='本社工場')?.total_qty||0));
    const dai2Data = years.map(y => fmt.qtyVal(data.find(x=>x.year===y && x.factory==='第二工場')?.total_qty||0));
    const ds = [];
    if (factory==='all'||factory==='本社工場') ds.push({ label:'本社工場', data:honshaData, backgroundColor:FACTORY_COLORS['本社工場']});
    if (factory==='all'||factory==='第二工場') ds.push({ label:'第二工場', data:dai2Data, backgroundColor:FACTORY_COLORS['第二工場']});
    safeCreateChart('yearlyChart', {
      type: 'bar',
      data: { labels: years.map(y=>y+'年'), datasets: ds },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, title: { display: true, text: state.qtyUnit } } } }
    });

    const yms = Array.from({length:12}, (_,i)=>`${trendYear}-${String(i+1).padStart(2,'0')}`);
    const perHonsha = yms.map(ym => monthly.find(x=>x.ym===ym && x.factory==='本社工場')?.qty_per_person||0);
    const perDai2 = yms.map(ym => monthly.find(x=>x.ym===ym && x.factory==='第二工場')?.qty_per_person||0);
    const trendDs = [];
    if (factory==='all'||factory==='本社工場') trendDs.push({ label:'本社工場 1人工あたり', data:perHonsha.map(fmt.qtyVal), borderColor:FACTORY_COLORS['本社工場'], backgroundColor:FACTORY_COLORS['本社工場']+'33', fill: false, tension: 0.2 });
    if (factory==='all'||factory==='第二工場') trendDs.push({ label:'第二工場 1人工あたり', data:perDai2.map(fmt.qtyVal), borderColor:FACTORY_COLORS['第二工場'], backgroundColor:FACTORY_COLORS['第二工場']+'33', fill: false, tension: 0.2 });
    if (monthly.length > 0) {
      safeCreateChart('trendChart', {
        type: 'line',
        data: { labels: yms.map(y => dayjs(y+'-01').format('M月')), datasets: trendDs },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, title: { display: true, text: state.qtyUnit + ' / 人' } } } }
      });
    } else emptyChartMessage('trendChart');

    const partsTotal = {};
    PART_KEYS.forEach(k => { partsTotal[k] = data.reduce((s,r)=>s+safeNum(r[k]),0); });
    const hasParts = PART_KEYS.some(k => partsTotal[k] > 0);
    if (hasParts) {
      safeCreateChart('yearPartsChart', {
        type: 'bar',
        data: {
          labels: PART_KEYS.map(k => PART_LABELS[k]),
          datasets: [{ label: '部位別合計 (' + state.qtyUnit + ')', data: PART_KEYS.map(k => fmt.qtyVal(partsTotal[k])), backgroundColor: PART_KEYS.map(k => PART_COLORS[k]) }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
      });
    } else emptyChartMessage('yearPartsChart');

    tableEl.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>年</th><th>工場</th><th>稼働日</th><th>延べ人工</th>
          ${PART_KEYS.map(k=>`<th>${PART_LABELS[k]}</th>`).join('')}
          <th>年間合計</th><th>1人工あたり</th>
        </tr></thead>
        <tbody>
          ${data.map(r => `<tr>
            <td class="text">${r.year}年</td>
            <td class="text"><span class="px-2 py-1 rounded text-xs ${r.factory==='本社工場'?'badge-honsha':'badge-dai2'}">${escapeHtml(r.factory||'')}</span></td>
            <td>${safeNum(r.days)}</td>
            <td>${fmtManDays(safeNum(r.staff_count))}</td>
            ${PART_KEYS.map(k=>`<td>${fmt.qty(r[k])}</td>`).join('')}
            <td class="font-bold">${fmt.qty(r.total_qty)}</td>
            <td>${safeNum(r.qty_per_person)>0?fmt.qty(r.qty_per_person):'-'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    `;
    document.getElementById('yCsv').onclick = () => exportCSV('年間分析', data, ['year','factory','days','staff_count',...PART_KEYS,'total_qty','qty_per_person']);
    document.getElementById('yPdf').onclick = () => exportPDF('年間分析レポート', data, 'yearly');
  };
  document.getElementById('yApply').addEventListener('click', load);
  await load();
}

function aggregateYearlyLocal(records, { factory }) {
  let r = safeArray(records);
  if (factory && factory !== 'all') r = r.filter(x => x.factory === factory);
  const keys = {};
  r.forEach(rec => {
    const y = (rec.date||'').slice(0,4);
    const k = y + '|' + rec.factory;
    if (!keys[k]) keys[k] = { year: y, factory: rec.factory, staff_count: 0, total_qty: 0, days_set: new Set() };
    PART_KEYS.forEach(p => { keys[k][p] = safeNum(keys[k][p]) + safeNum(rec[p]); });
    keys[k].staff_count += safeNum(rec.staff_count);
    keys[k].total_qty += safeNum(rec.total_qty);
    keys[k].days_set.add(rec.date);
  });
  return Object.values(keys).map(k => ({
    ...k,
    days: k.days_set.size, days_set: undefined,
    qty_per_person: k.staff_count > 0 ? k.total_qty / k.staff_count : 0
  })).sort((a,b) => a.year.localeCompare(b.year));
}

// ========== 工場比較 ==========
async function renderCompare() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="space-y-4">
      ${state.useSampleData ? sampleBanner() : ''}
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-balance-scale mr-2"></i>工場比較</h2>
        ${unitToggle()}
      </div>
      <div class="bg-white p-4 rounded-xl shadow-sm grid grid-cols-2 md:grid-cols-4 gap-3">
        <div><label class="block text-xs text-gray-600 mb-1">年</label><input id="cYear" type="number" value="${new Date().getFullYear()}" class="input-base" /></div>
        <div class="flex items-end gap-2 md:col-span-3 flex-wrap">
          <button id="cApply" class="btn-primary text-sm"><i class="fas fa-search mr-1"></i>表示</button>
          <button id="cCsv" class="btn-secondary text-sm"><i class="fas fa-file-csv mr-1"></i>CSV</button>
          <button id="cPdf" class="btn-secondary text-sm"><i class="fas fa-file-pdf mr-1"></i>PDF</button>
        </div>
      </div>
      <div id="compareKpi" class="grid grid-cols-1 md:grid-cols-3 gap-4"></div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="bg-white p-4 rounded-xl shadow-sm"><h3 class="font-semibold mb-2">月別比較</h3><div class="relative" style="height:340px"><canvas id="cmpMonth"></canvas></div></div>
        <div class="bg-white p-4 rounded-xl shadow-sm"><h3 class="font-semibold mb-2">部位別比較</h3><div class="relative" style="height:340px"><canvas id="cmpParts"></canvas></div></div>
      </div>
      <div id="cmpTable" class="bg-white rounded-xl shadow-sm overflow-x-auto"></div>
    </div>
  `;
  bindUnitToggle();
  const load = async () => {
    const tableEl = document.getElementById('cmpTable');
    setSectionLoading(tableEl);
    const year = document.getElementById('cYear').value;
    let data = [];
    try {
      data = state.useSampleData
        ? aggregateMonthlyLocal(SAMPLE_RECORDS, { year })
        : await api.monthly({ year });
    } catch (e) {
      setSectionError(tableEl, e.message, { retry: load, sample: () => { state.useSampleData = true; load(); } });
      ['cmpMonth','cmpParts'].forEach(emptyChartMessage);
      return;
    }
    data = safeArray(data);
    const honsha = data.filter(d=>d.factory==='本社工場');
    const dai2 = data.filter(d=>d.factory==='第二工場');
    const honshaTotal = sumKey(honsha, 'total_qty');
    const dai2Total = sumKey(dai2, 'total_qty');
    const honshaStaff = sumKey(honsha, 'staff_count');
    const dai2Staff = sumKey(dai2, 'staff_count');

    document.getElementById('compareKpi').innerHTML = `
      <div class="stat-card honsha"><div class="label">本社工場 (${year}年)</div><div class="value text-blue-700">${fmt.qty(honshaTotal)}</div><div class="sub">延べ${fmtManDays(honshaStaff)}人工 / 1人工あたり ${honshaStaff>0?fmt.qty(honshaTotal/honshaStaff):'-'}</div></div>
      <div class="stat-card dai2"><div class="label">第二工場 (${year}年)</div><div class="value text-green-700">${fmt.qty(dai2Total)}</div><div class="sub">延べ${fmtManDays(dai2Staff)}人工 / 1人工あたり ${dai2Staff>0?fmt.qty(dai2Total/dai2Staff):'-'}</div></div>
      <div class="stat-card all"><div class="label">合計</div><div class="value">${fmt.qty(honshaTotal+dai2Total)}</div><div class="sub">本社 ${honshaTotal+dai2Total>0?(honshaTotal/(honshaTotal+dai2Total)*100).toFixed(1):0}% / 第二 ${honshaTotal+dai2Total>0?(dai2Total/(honshaTotal+dai2Total)*100).toFixed(1):0}%</div></div>
    `;

    const months = Array.from({length:12},(_,i)=>`${year}-${String(i+1).padStart(2,'0')}`);
    const mh = months.map(m => fmt.qtyVal(honsha.find(x=>x.ym===m)?.total_qty||0));
    const md = months.map(m => fmt.qtyVal(dai2.find(x=>x.ym===m)?.total_qty||0));
    if (honshaTotal + dai2Total > 0) {
      safeCreateChart('cmpMonth', {
        type:'bar',
        data:{ labels: months.map(m => dayjs(m+'-01').format('M月')), datasets: [
          { label:'本社工場', data: mh, backgroundColor: FACTORY_COLORS['本社工場'] },
          { label:'第二工場', data: md, backgroundColor: FACTORY_COLORS['第二工場'] }
        ]},
        options:{ responsive:true, maintainAspectRatio:false, scales:{y:{beginAtZero:true, title:{display:true,text:state.qtyUnit}}}}
      });

      const ph = PART_KEYS.map(k => fmt.qtyVal(sumKey(honsha, k)));
      const pd = PART_KEYS.map(k => fmt.qtyVal(sumKey(dai2, k)));
      safeCreateChart('cmpParts', {
        type:'bar',
        data:{ labels: PART_KEYS.map(k=>PART_LABELS[k]), datasets:[
          { label:'本社工場', data: ph, backgroundColor: FACTORY_COLORS['本社工場'] },
          { label:'第二工場', data: pd, backgroundColor: FACTORY_COLORS['第二工場'] }
        ]},
        options:{ responsive:true, maintainAspectRatio:false, scales:{y:{beginAtZero:true, title:{display:true,text:state.qtyUnit}}}}
      });
    } else {
      emptyChartMessage('cmpMonth');
      emptyChartMessage('cmpParts');
    }

    tableEl.innerHTML = `
      <table class="data-table">
        <thead><tr><th>月</th><th>本社工場</th><th>第二工場</th><th>合計</th><th>本社比率</th></tr></thead>
        <tbody>
          ${months.map(m => {
            const h = safeNum(honsha.find(x=>x.ym===m)?.total_qty);
            const d = safeNum(dai2.find(x=>x.ym===m)?.total_qty);
            const t = h + d;
            return `<tr>
              <td class="text">${dayjs(m+'-01').format('YYYY/M月')}</td>
              <td>${fmt.qty(h)}</td>
              <td>${fmt.qty(d)}</td>
              <td class="font-bold">${fmt.qty(t)}</td>
              <td>${t>0?(h/t*100).toFixed(1)+'%':'-'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;

    document.getElementById('cCsv').onclick = () => {
      const rows = months.map(m => {
        const h = safeNum(honsha.find(x=>x.ym===m)?.total_qty);
        const d = safeNum(dai2.find(x=>x.ym===m)?.total_qty);
        return { 月: m, 本社工場: h, 第二工場: d, 合計: h+d };
      });
      exportCSV('工場別比較', rows, ['月','本社工場','第二工場','合計']);
    };
    document.getElementById('cPdf').onclick = () => exportPDF('工場別比較レポート', data, 'compare');
  };
  document.getElementById('cApply').addEventListener('click', load);
  await load();
}

// ========== 月間目標設定 ==========
async function renderTargets() {
  const main = document.getElementById('main');
  const year = new Date().getFullYear();
  let targets = [];
  try { targets = await api.targets(year); } catch (e) { targets = []; }
  targets = safeArray(targets);
  main.innerHTML = `
    <div class="space-y-4">
      <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-bullseye mr-2"></i>月間目標設定 (${year}年)</h2>
      <div class="bg-white p-4 rounded-xl shadow-sm">
        <form id="targetForm" class="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
          <div><label class="block text-xs text-gray-600 mb-1">年</label><input id="tYear" type="number" value="${year}" class="input-base" /></div>
          <div><label class="block text-xs text-gray-600 mb-1">月</label>
            <select id="tMonth" class="input-base">${Array.from({length:12},(_,i)=>i+1).map(m=>`<option value="${m}">${m}月</option>`).join('')}</select>
          </div>
          <div><label class="block text-xs text-gray-600 mb-1">工場</label>
            <select id="tFactory" class="input-base">
              <option value="本社工場">本社工場</option>
              <option value="第二工場">第二工場</option>
              <option value="全体">全体</option>
            </select>
          </div>
          <div><label class="block text-xs text-gray-600 mb-1">目標 (kg)</label><input id="tQty" type="number" min="0" step="100" class="input-num" inputmode="numeric" /></div>
          <button type="submit" class="btn-primary"><i class="fas fa-save mr-1"></i>登録/更新</button>
        </form>
      </div>
      <div class="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table class="data-table">
          <thead><tr><th>年</th><th>月</th><th>工場</th><th>目標</th></tr></thead>
          <tbody>
            ${targets.length === 0 ? '<tr><td colspan="4" class="text-center text-gray-500 py-4">未登録</td></tr>' :
              targets.map(t => `<tr>
                <td class="text">${t.year}</td>
                <td class="text">${t.month}月</td>
                <td class="text">${escapeHtml(t.factory||'')}</td>
                <td>${fmt.qty(t.target_qty)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
  document.getElementById('targetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.setTarget({
        year: safeNum(document.getElementById('tYear').value),
        month: safeNum(document.getElementById('tMonth').value),
        factory: document.getElementById('tFactory').value,
        target_qty: safeNum(document.getElementById('tQty').value)
      });
      alert('保存しました');
      renderTargets();
    } catch (err) {
      alert('保存に失敗しました: ' + (err.message || ''));
    }
  });
}


// ========== 人員別分析 ==========
// サンプルモード用のローカル集計 (各日の総加工量を人員数で割る方式)
function aggregateWorkersLocal(records, { year, month, dateFrom, dateTo, factory, workerName }) {
  records = safeArray(records);
  let filtered = records.slice();
  if (year) filtered = filtered.filter(r => r.date && String(r.date).startsWith(String(year)));
  if (month) {
    const m = String(month).padStart(2,'0');
    filtered = filtered.filter(r => r.date && String(r.date).slice(5,7) === m);
  }
  if (dateFrom) filtered = filtered.filter(r => r.date >= dateFrom);
  if (dateTo) filtered = filtered.filter(r => r.date <= dateTo);
  if (factory && factory !== 'all') filtered = filtered.filter(r => r.factory === factory);

  const map = {};
  for (const r of filtered) {
    const wlist = normalizeWorkersClient(r.workers, r.worker_names);
    if (wlist.length === 0) continue; // 人員のない記録は集計対象外
    const mdSum = wlist.reduce((s, w) => s + clampManDaysClient(w.man_days), 0);
    if (mdSum <= 0) continue; // 人工合計0は按分不能のためスキップ
    const total = safeNum(r.total_qty);
    const perManDay = total / mdSum;
    for (const w of wlist) {
      const name = w.name;
      const md = clampManDaysClient(w.man_days);
      const personQty = perManDay * md;
      if (!map[name]) {
        map[name] = {
          worker_name: name, days: 0, total_qty: 0,
          man_days_total: 0, honsha_man_days: 0, dai2_man_days: 0,
          honsha_qty: 0, dai2_qty: 0,
          ...Object.fromEntries(PART_KEYS.map(k => [k, 0]))
        };
      }
      const a = map[name];
      a.days += 1;
      a.man_days_total += md;
      a.total_qty += personQty;
      if (r.factory === '本社工場') { a.honsha_qty += personQty; a.honsha_man_days += md; }
      else if (r.factory === '第二工場') { a.dai2_qty += personQty; a.dai2_man_days += md; }
      PART_KEYS.forEach(k => { a[k] += (safeNum(r[k]) / mdSum) * md; });
    }
  }
  let data = Object.values(map).map(a => ({
    ...a,
    avg_daily_qty: a.days > 0 ? a.total_qty / a.days : 0,
    qty_per_man_day: a.man_days_total > 0 ? a.total_qty / a.man_days_total : 0
  }));
  if (workerName) {
    const q = String(workerName).trim();
    if (q) data = data.filter(d => d.worker_name.includes(q));
  }
  data.sort((x,y) => y.total_qty - x.total_qty);
  return data;
}

function aggregateWorkersMonthlyLocal(records, { year, factory, workerName }) {
  records = safeArray(records);
  let filtered = records.slice();
  if (year) filtered = filtered.filter(r => r.date && String(r.date).startsWith(String(year)));
  if (factory && factory !== 'all') filtered = filtered.filter(r => r.factory === factory);
  const map = {};
  for (const r of filtered) {
    const wlist = normalizeWorkersClient(r.workers, r.worker_names);
    if (wlist.length === 0) continue;
    const mdSum = wlist.reduce((s, w) => s + clampManDaysClient(w.man_days), 0);
    if (mdSum <= 0) continue;
    const total = safeNum(r.total_qty);
    const perManDay = total / mdSum;
    const ym = String(r.date || '').slice(0,7);
    for (const w of wlist) {
      const md = clampManDaysClient(w.man_days);
      const key = w.name + '|' + ym;
      if (!map[key]) map[key] = { worker_name: w.name, ym, person_qty: 0, days: 0, man_days_total: 0 };
      map[key].person_qty += perManDay * md;
      map[key].days += 1;
      map[key].man_days_total += md;
    }
  }
  let data = Object.values(map);
  if (workerName) {
    const q = String(workerName).trim();
    if (q) data = data.filter(d => d.worker_name.includes(q));
  }
  return data;
}

let _workerDataCache = [];
let _workerMonthlyCache = [];

async function renderWorkers() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="space-y-4">
      ${state.useSampleData ? sampleBanner() : ''}
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-users mr-2"></i>人員別分析</h2>
        <div class="flex gap-2 flex-wrap">
          ${unitToggle()}
          <button id="wCsv" class="btn-secondary text-sm"><i class="fas fa-file-csv mr-1"></i>CSV</button>
          <button id="wPdf" class="btn-secondary text-sm"><i class="fas fa-file-pdf mr-1"></i>PDF</button>
        </div>
      </div>

      <div class="bg-white p-4 rounded-xl shadow-sm">
        <div class="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div><label class="block text-xs text-gray-600 mb-1">開始日</label><input id="wDateFrom" type="date" value="${state.dateFrom||''}" class="input-base" /></div>
          <div><label class="block text-xs text-gray-600 mb-1">終了日</label><input id="wDateTo" type="date" value="${state.dateTo||''}" class="input-base" /></div>
          <div><label class="block text-xs text-gray-600 mb-1">年</label><input id="wYear" type="number" value="${state.yearFilter||''}" class="input-base" /></div>
          <div>
            <label class="block text-xs text-gray-600 mb-1">月</label>
            <select id="wMonth" class="input-base">
              <option value="">全て</option>
              ${Array.from({length:12},(_,i)=>i+1).map(m=>`<option value="${m}" ${state.monthFilter==String(m)?'selected':''}>${m}月</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-xs text-gray-600 mb-1">工場</label>
            <select id="wFactory" class="input-base">
              <option value="all" ${state.factoryFilter==='all'?'selected':''}>全体</option>
              <option value="本社工場" ${state.factoryFilter==='本社工場'?'selected':''}>本社工場</option>
              <option value="第二工場" ${state.factoryFilter==='第二工場'?'selected':''}>第二工場</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-gray-600 mb-1">人員名</label>
            <input id="wName" type="text" value="${escapeHtml(state.workerFilter||'')}" class="input-base" placeholder="部分一致" />
          </div>
        </div>
        <div class="flex gap-2 mt-3 flex-wrap">
          <button id="wApply" class="btn-primary text-sm"><i class="fas fa-search mr-1"></i>絞り込み</button>
          <button id="wClear" class="btn-secondary text-sm">クリア</button>
        </div>
      </div>

      <div id="wKpi" class="grid grid-cols-2 md:grid-cols-5 gap-3"></div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="bg-white p-4 rounded-xl shadow-sm">
          <h3 class="font-semibold mb-3"><i class="fas fa-trophy text-yellow-500 mr-1"></i>人員別 総加工量ランキング</h3>
          <div class="relative" style="height:320px"><canvas id="wTotalChart"></canvas></div>
        </div>
        <div class="bg-white p-4 rounded-xl shadow-sm">
          <h3 class="font-semibold mb-3"><i class="fas fa-calendar-check text-blue-500 mr-1"></i>人員別 参加日数</h3>
          <div class="relative" style="height:320px"><canvas id="wDaysChart"></canvas></div>
        </div>
        <div class="bg-white p-4 rounded-xl shadow-sm">
          <h3 class="font-semibold mb-3"><i class="fas fa-chart-line text-green-500 mr-1"></i>人員別 1日平均加工量</h3>
          <div class="relative" style="height:320px"><canvas id="wAvgChart"></canvas></div>
        </div>
        <div class="bg-white p-4 rounded-xl shadow-sm">
          <h3 class="font-semibold mb-3"><i class="fas fa-chart-pie text-orange-500 mr-1"></i>人員別 部位別構成（上位5名）</h3>
          <div class="relative" style="height:320px"><canvas id="wPartsChart"></canvas></div>
        </div>
      </div>

      <div class="bg-white p-4 rounded-xl shadow-sm">
        <h3 class="font-semibold mb-3"><i class="fas fa-chart-bar text-purple-500 mr-1"></i>月別 人員別 加工量推移（上位5名）</h3>
        <div class="relative" style="height:340px"><canvas id="wMonthChart"></canvas></div>
      </div>

      <div id="wTable" class="bg-white rounded-xl shadow-sm overflow-x-auto"></div>
    </div>
  `;
  bindUnitToggle();

  const applyFilters = () => {
    state.dateFrom = document.getElementById('wDateFrom').value;
    state.dateTo = document.getElementById('wDateTo').value;
    state.yearFilter = document.getElementById('wYear').value;
    state.monthFilter = document.getElementById('wMonth').value;
    state.factoryFilter = document.getElementById('wFactory').value;
    state.workerFilter = document.getElementById('wName').value;
    loadWorkerData();
  };
  document.getElementById('wApply').addEventListener('click', applyFilters);
  document.getElementById('wClear').addEventListener('click', () => {
    state.dateFrom = ''; state.dateTo = '';
    state.yearFilter = String(new Date().getFullYear()); state.monthFilter = '';
    state.factoryFilter = 'all'; state.workerFilter = '';
    loadWorkerData();
  });
  document.getElementById('wCsv').addEventListener('click', () => exportWorkerCSV());
  document.getElementById('wPdf').addEventListener('click', () => exportWorkerPDF());

  await loadWorkerData();
}

async function loadWorkerData() {
  const kpiEl = document.getElementById('wKpi');
  const tableEl = document.getElementById('wTable');
  if (!kpiEl || !tableEl) return;
  setSectionLoading(tableEl);
  let data = [];
  let monthlyData = [];
  const params = {};
  if (state.dateFrom) params.dateFrom = state.dateFrom;
  if (state.dateTo) params.dateTo = state.dateTo;
  if (state.yearFilter) params.year = state.yearFilter;
  if (state.monthFilter) params.month = state.monthFilter;
  if (state.factoryFilter && state.factoryFilter !== 'all') params.factory = state.factoryFilter;
  if (state.workerFilter) params.worker_name = state.workerFilter;

  try {
    if (state.useSampleData) throw new Error('sample-mode');
    data = await api.workerAnalytics(params);
    monthlyData = await api.workerMonthly(params);
  } catch (e) {
    if (e.message !== 'sample-mode') {
      console.warn('[worker analytics fallback]', e.message);
      state.useSampleData = true;
    }
    data = aggregateWorkersLocal(SAMPLE_RECORDS, {
      year: state.yearFilter, month: state.monthFilter,
      dateFrom: state.dateFrom, dateTo: state.dateTo,
      factory: state.factoryFilter, workerName: state.workerFilter
    });
    monthlyData = aggregateWorkersMonthlyLocal(SAMPLE_RECORDS, {
      year: state.yearFilter, factory: state.factoryFilter, workerName: state.workerFilter
    });
  }
  data = safeArray(data);
  monthlyData = safeArray(monthlyData);
  _workerDataCache = data;
  _workerMonthlyCache = monthlyData;

  // KPI
  const totalQty = sumKey(data, 'total_qty');
  const workerCount = data.length;
  const manDaysTotal = data.reduce((s, d) => s + safeNum(d.man_days_total), 0);
  const qtyPerManDay = manDaysTotal > 0 ? totalQty / manDaysTotal : 0;
  const topQty = data.length ? data[0] : null;
  const topDays = data.length ? [...data].sort((a,b)=>safeNum(b.days)-safeNum(a.days))[0] : null;

  kpiEl.innerHTML = `
    <div class="stat-card all"><div class="label"><i class="fas fa-weight-hanging mr-1"></i>期間の総加工数量</div><div class="value">${fmt.qty(totalQty)}</div><div class="sub">人員別按分</div></div>
    <div class="stat-card all"><div class="label"><i class="fas fa-id-badge mr-1"></i>登録人員数</div><div class="value">${workerCount}人</div><div class="sub">人工合計 ${fmtManDays(manDaysTotal)}人工</div></div>
    <div class="stat-card all"><div class="label"><i class="fas fa-balance-scale mr-1"></i>1人工あたり平均</div><div class="value">${manDaysTotal>0?fmt.qty(qtyPerManDay):'-'}</div><div class="sub">総加工量÷人工合計</div></div>
    <div class="stat-card honsha"><div class="label"><i class="fas fa-trophy mr-1"></i>最多加工量者</div><div class="value text-blue-700 text-base">${topQty?escapeHtml(topQty.worker_name):'-'}</div><div class="sub">${topQty?fmt.qty(safeNum(topQty.total_qty)):'-'}</div></div>
    <div class="stat-card dai2"><div class="label"><i class="fas fa-medal mr-1"></i>最多参加日数者</div><div class="value text-green-700 text-base">${topDays?escapeHtml(topDays.worker_name):'-'}</div><div class="sub">${topDays?safeNum(topDays.days)+'日':'-'}</div></div>
  `;

  // テーブル
  if (data.length === 0) {
    tableEl.innerHTML = `<div class="text-center py-10 text-gray-500"><i class="fas fa-inbox text-4xl mb-2"></i><p>人員データがありません</p><p class="text-xs mt-1">加工実績の入力時に「人員名」を登録するとここに表示されます</p></div>`;
  } else {
    tableEl.innerHTML = `
      <div class="overflow-x-auto">
      <table class="data-table">
        <thead>
          <tr>
            <th>人員名</th><th>参加日数</th><th>人工合計</th><th>総加工数量</th><th>1人工あたり</th><th>1日平均</th>
            <th>本社工場</th><th>第二工場</th>
            ${PART_KEYS.map(k=>`<th class="part-${k.replace('_qty','')}">${PART_LABELS[k]}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${data.map(d => `
            <tr>
              <td class="text font-semibold">${escapeHtml(d.worker_name)}</td>
              <td>${safeNum(d.days)}日</td>
              <td>${fmtManDays(d.man_days_total)}</td>
              <td class="font-bold">${fmt.qty(d.total_qty)}</td>
              <td>${safeNum(d.man_days_total)>0?fmt.qty(d.qty_per_man_day):'-'}</td>
              <td>${fmt.qty(d.avg_daily_qty)}</td>
              <td>${fmt.qty(d.honsha_qty)}</td>
              <td>${fmt.qty(d.dai2_qty)}</td>
              ${PART_KEYS.map(k=>`<td>${fmt.qty(d[k])}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
      </div>
    `;
  }

  // チャート
  const top10 = data.slice(0, 10);
  if (top10.length > 0) {
    safeCreateChart('wTotalChart', {
      type: 'bar',
      data: {
        labels: top10.map(d => d.worker_name),
        datasets: [{ label: `総加工量 (${state.qtyUnit})`, data: top10.map(d => fmt.qtyVal(d.total_qty)), backgroundColor: '#2563eb' }]
      },
      options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } } }
    });
  } else { emptyChartMessage('wTotalChart'); }

  const top10Days = [...data].sort((a,b)=>safeNum(b.days)-safeNum(a.days)).slice(0, 10);
  if (top10Days.length > 0) {
    safeCreateChart('wDaysChart', {
      type: 'bar',
      data: {
        labels: top10Days.map(d => d.worker_name),
        datasets: [{ label: '参加日数', data: top10Days.map(d => safeNum(d.days)), backgroundColor: '#16a34a' }]
      },
      options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } } }
    });
  } else { emptyChartMessage('wDaysChart'); }

  const top10Avg = [...data].sort((a,b)=>safeNum(b.avg_daily_qty)-safeNum(a.avg_daily_qty)).slice(0, 10);
  if (top10Avg.length > 0) {
    safeCreateChart('wAvgChart', {
      type: 'bar',
      data: {
        labels: top10Avg.map(d => d.worker_name),
        datasets: [{ label: `1日平均 (${state.qtyUnit})`, data: top10Avg.map(d => fmt.qtyVal(d.avg_daily_qty)), backgroundColor: '#f59e0b' }]
      },
      options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } } }
    });
  } else { emptyChartMessage('wAvgChart'); }

  // 部位別構成 (上位5名のスタック)
  const top5 = data.slice(0, 5);
  const partsTotal = top5.reduce((s,d) => s + PART_KEYS.reduce((ss,k)=>ss+safeNum(d[k]),0), 0);
  if (top5.length > 0 && partsTotal > 0) {
    safeCreateChart('wPartsChart', {
      type: 'bar',
      data: {
        labels: top5.map(d => d.worker_name),
        datasets: PART_KEYS.map(k => ({
          label: PART_LABELS[k],
          data: top5.map(d => fmt.qtyVal(d[k])),
          backgroundColor: PART_COLORS[k]
        }))
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } }, plugins: { legend: { position: 'right' } } }
    });
  } else { emptyChartMessage('wPartsChart'); }

  // 月別人員別推移 (上位5名のみ)
  const top5Names = top5.map(d => d.worker_name);
  const yms = Array.from(new Set(monthlyData.map(d => d.ym))).sort();
  if (top5Names.length > 0 && yms.length > 0) {
    const palette = ['#ef4444','#3b82f6','#10b981','#f59e0b','#8b5cf6'];
    const datasets = top5Names.map((name, i) => ({
      label: name,
      data: yms.map(ym => {
        const row = monthlyData.find(d => d.worker_name === name && d.ym === ym);
        return row ? fmt.qtyVal(row.person_qty) : 0;
      }),
      borderColor: palette[i % palette.length],
      backgroundColor: palette[i % palette.length] + '33',
      tension: 0.3,
      fill: false
    }));
    safeCreateChart('wMonthChart', {
      type: 'line',
      data: { labels: yms, datasets },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } } }
    });
  } else { emptyChartMessage('wMonthChart'); }
}

function exportWorkerCSV() {
  const data = safeArray(_workerDataCache);
  if (data.length === 0) { alert('データがありません'); return; }
  // 人工合計が0でない安全な値で qty_per_man_day を確保
  const rows = data.map(d => ({
    ...d,
    man_days_total: safeNum(d.man_days_total),
    qty_per_man_day: safeNum(d.man_days_total) > 0 ? safeNum(d.qty_per_man_day) : 0,
    honsha_man_days: safeNum(d.honsha_man_days),
    dai2_man_days: safeNum(d.dai2_man_days)
  }));
  const keys = ['worker_name','days','man_days_total','total_qty','qty_per_man_day','avg_daily_qty','honsha_qty','dai2_qty','honsha_man_days','dai2_man_days', ...PART_KEYS];
  exportCSV('人員別分析', rows, keys);
}

function exportWorkerPDF() {
  const data = safeArray(_workerDataCache);
  if (data.length === 0) { alert('データがありません'); return; }
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFontSize(14);
    doc.text('Murata Tekkin - Worker Analysis Report', 14, 14);
    doc.setFontSize(9);
    const filter = [];
    if (state.yearFilter) filter.push(`Year:${state.yearFilter}`);
    if (state.monthFilter) filter.push(`Month:${state.monthFilter}`);
    if (state.dateFrom) filter.push(`From:${state.dateFrom}`);
    if (state.dateTo) filter.push(`To:${state.dateTo}`);
    if (state.factoryFilter && state.factoryFilter !== 'all') filter.push(`Factory:${state.factoryFilter}`);
    if (state.workerFilter) filter.push(`Name:${state.workerFilter}`);
    doc.text(`Generated: ${dayjs().format('YYYY-MM-DD HH:mm')}  Unit: ${state.qtyUnit}  ${filter.join('  ')}`, 14, 20);

    const top10 = data.slice(0, 10);
    doc.setFontSize(11);
    doc.text('Total Quantity Ranking (Top 10)', 14, 28);
    doc.autoTable({
      head: [['Rank','Worker','Days','ManDays','TotalQty','PerManDay','AvgDaily','Honsha','Dai2']],
      body: top10.map((d,i) => [
        i+1, d.worker_name, safeNum(d.days),
        fmtManDays(d.man_days_total),
        fmt.qty(d.total_qty).replace(/\s.*/,''),
        safeNum(d.man_days_total) > 0 ? fmt.qty(d.qty_per_man_day).replace(/\s.*/,'') : '-',
        fmt.qty(d.avg_daily_qty).replace(/\s.*/,''),
        fmt.qty(d.honsha_qty).replace(/\s.*/,''),
        fmt.qty(d.dai2_qty).replace(/\s.*/,'')
      ]),
      startY: 32, styles: { fontSize: 8, cellPadding: 1 }, headStyles: { fillColor: [37,99,235] }
    });

    const finalY1 = (doc.lastAutoTable && doc.lastAutoTable.finalY ? doc.lastAutoTable.finalY : 60) + 6;
    doc.setFontSize(11);
    doc.text('Parts Breakdown by Worker', 14, finalY1);
    doc.autoTable({
      head: [['Worker', ...PART_KEYS.map(k => PART_LABELS[k])]],
      body: data.map(d => [
        d.worker_name,
        ...PART_KEYS.map(k => fmt.qty(d[k]).replace(/\s.*/,''))
      ]),
      startY: finalY1 + 2, styles: { fontSize: 7, cellPadding: 1 }, headStyles: { fillColor: [37,99,235] }
    });

    doc.save(`人員別分析_${dayjs().format('YYYYMMDD_HHmmss')}.pdf`);
  } catch (e) { alert('PDF出力に失敗しました: ' + e.message); }
}


// ========== CSV / PDF 出力 ==========
function exportCSV(name, rows, keys) {
  rows = safeArray(rows);
  if (rows.length === 0) { alert('データがありません'); return; }
  const labelMap = { ...PART_LABELS, date:'日付', factory:'工場', staff_count:'人員数（人工合計）', worker_names:'人員名', worker_name:'人員名', workers:'人員（人工）', total_qty:'総加工量(kg)', qty_per_person:'1人工あたり(kg)', qty_per_man_day:'1人工あたり加工量(kg)', man_days_total:'人工合計', honsha_man_days:'本社工場の人工', dai2_man_days:'第二工場の人工', ym:'年月', year:'年', days:'参加日数', avg_daily_qty:'1日平均(kg)', honsha_qty:'本社工場(kg)', dai2_qty:'第二工場(kg)', person_qty:'按分加工量(kg)', note:'備考' };
  const header = keys.map(k => labelMap[k] || k).join(',');
  const body = rows.map(r => keys.map(k => {
    const v = r ? r[k] : '';
    if (v == null) return '';
    if (typeof v === 'string' && (v.includes(',') || v.includes('"'))) return `"${v.replace(/"/g,'""')}"`;
    return v;
  }).join(',')).join('\n');
  const bom = '\uFEFF';
  const blob = new Blob([bom + header + '\n' + body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}_${dayjs().format('YYYYMMDD_HHmmss')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportListCSV() {
  const records = safeArray(state.records);
  if (records.length === 0) { alert('データがありません'); return; }
  // workers を文字列化したコピーを作成 (CSV用): "斉藤（1.0人工）、小澤（1.0人工）、ソックヘン（0.5人工）"
  const rows = records.map(r => {
    const wlist = normalizeWorkersClient(r.workers, r.worker_names);
    return {
      ...r,
      workers: wlist.map(w => `${w.name}（${fmtManDays(w.man_days)}人工）`).join('、'),
      worker_names: wlist.map(w => w.name).join('、')
    };
  });
  const keys = ['date','factory','staff_count','workers',...PART_KEYS,'total_qty','qty_per_person','note'];
  exportCSV('加工実績一覧', rows, keys);
}

function exportListPDF() {
  const records = safeArray(state.records);
  if (records.length === 0) { alert('データがありません'); return; }
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFontSize(14);
    doc.text('Murata Tekkin - Processing Records', 14, 14);
    doc.setFontSize(9);
    doc.text(`Generated: ${dayjs().format('YYYY-MM-DD HH:mm')}  Unit: ${state.qtyUnit}`, 14, 20);
    const head = [['Date','Factory','ManDays','Workers(ManDays)', ...PART_KEYS.map(k => PART_LABELS[k]), 'Total','Per ManDay']];
    const body = records.map(r => {
      const wlist = normalizeWorkersClient(r.workers, r.worker_names);
      const wStr = wlist.length ? wlist.map(w => `${w.name}(${fmtManDays(w.man_days)})`).join('、') : '-';
      return [
        r.date, r.factory, fmtManDays(safeNum(r.staff_count)), wStr,
        ...PART_KEYS.map(k => fmt.qty(r[k]).replace(/\s.*/,'')),
        fmt.qty(r.total_qty).replace(/\s.*/,''),
        safeNum(r.qty_per_person)>0?fmt.qty(r.qty_per_person).replace(/\s.*/,''):'-'
      ];
    });
    doc.autoTable({ head, body, startY: 24, styles: { fontSize: 7, cellPadding: 1 }, headStyles: { fillColor: [37,99,235] } });
    doc.save(`加工実績一覧_${dayjs().format('YYYYMMDD_HHmmss')}.pdf`);
  } catch (e) { alert('PDF出力に失敗しました: ' + e.message); }
}

function exportPDF(title, data, kind) {
  data = safeArray(data);
  if (data.length === 0) { alert('データがありません'); return; }
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFontSize(14);
    doc.text(title, 14, 14);
    doc.setFontSize(9);
    doc.text(`Generated: ${dayjs().format('YYYY-MM-DD HH:mm')}  Unit: ${state.qtyUnit}`, 14, 20);
    let head, body;
    if (kind === 'daily') {
      head = [['Date','Factory','Staff', ...PART_KEYS.map(k=>PART_LABELS[k]), 'Total','PerPerson']];
      body = data.map(r => [r.date, r.factory, safeNum(r.staff_count), ...PART_KEYS.map(k=>fmt.qty(r[k]).replace(/\s.*/,'')), fmt.qty(r.total_qty).replace(/\s.*/,''), safeNum(r.qty_per_person)>0?fmt.qty(r.qty_per_person).replace(/\s.*/,''):'-']);
    } else if (kind === 'monthly') {
      head = [['Month','Factory','Days','Staff', ...PART_KEYS.map(k=>PART_LABELS[k]), 'Total','AvgDaily','PerPerson']];
      body = data.map(r => [r.ym, r.factory, safeNum(r.days), safeNum(r.staff_count), ...PART_KEYS.map(k=>fmt.qty(r[k]).replace(/\s.*/,'')), fmt.qty(r.total_qty).replace(/\s.*/,''), fmt.qty(r.avg_daily_qty).replace(/\s.*/,''), safeNum(r.qty_per_person)>0?fmt.qty(r.qty_per_person).replace(/\s.*/,''):'-']);
    } else if (kind === 'yearly') {
      head = [['Year','Factory','Days','Staff', ...PART_KEYS.map(k=>PART_LABELS[k]), 'Total','PerPerson']];
      body = data.map(r => [r.year, r.factory, safeNum(r.days), safeNum(r.staff_count), ...PART_KEYS.map(k=>fmt.qty(r[k]).replace(/\s.*/,'')), fmt.qty(r.total_qty).replace(/\s.*/,''), safeNum(r.qty_per_person)>0?fmt.qty(r.qty_per_person).replace(/\s.*/,''):'-']);
    } else {
      head = [['Month','Factory','Total']];
      body = data.map(r => [r.ym || r.year, r.factory, fmt.qty(r.total_qty).replace(/\s.*/,'')]);
    }
    doc.autoTable({ head, body, startY: 24, styles: { fontSize: 7, cellPadding: 1 }, headStyles: { fillColor: [37,99,235] } });
    doc.save(`${title}_${dayjs().format('YYYYMMDD_HHmmss')}.pdf`);
  } catch (e) { alert('PDF出力に失敗しました: ' + e.message); }
}

// ========== 起動 ==========
async function loadAndRender() {
  try {
    renderLayout();
    await renderMain();
  } catch (e) {
    console.error('[loadAndRender]', e);
    showFatalError(e.message);
  }
}

async function init() {
  setLoading('初期化中...');
  let error = null;
  try {
    // 必要ライブラリのチェック
    if (typeof axios === 'undefined') throw new Error('ライブラリの読み込みに失敗しました (axios)');
    if (typeof dayjs === 'undefined') throw new Error('ライブラリの読み込みに失敗しました (dayjs)');

    // ログイン状態確認
    let me = null;
    try { me = await api.me(); }
    catch (e) {
      // me取得自体が失敗 (ネットワーク/500等)
      console.warn('[init] /api/auth/me 失敗:', e.message);
      // 致命視せず → ログイン画面に遷移
    }

    if (me) {
      state.user = me;
      await loadAndRender();
    } else {
      renderLogin();
    }
  } catch (e) {
    error = e;
    console.error('[init error]', e);
  } finally {
    // どんなことがあっても loading は解除する
    if (error) {
      showFatalError(error.message);
    }
  }
}

// 公開: ログイン画面の sampleモードボタンから呼び出す
window.renderLogin = renderLogin;
window.state = state;

// DOMContentLoaded で起動
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
