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
  foundation_qty:'基礎', base_qty:'ベース', column_qty:'柱', beam_qty:'梁', fukashi_qty:'壁',
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

// 人工 (man_days) の値を 0〜2 にクランプ (空欄→1, 数値以外→1, 負→0, 2超→2)
// 残業対応のため上限を2.0、小数は第3位まで保持 (例: 0.125, 1.125, 1.525 等)
// 浮動小数誤差対策として小数点第3位で丸めるが、3桁以内の入力は値が変わらない
function clampManDaysClient(v) {
  if (v === '' || v == null) return 1;
  const n = Number(v);
  if (!isFinite(n) || isNaN(n)) return 1;
  if (n < 0) return 0;
  if (n > 2) return 2;
  // 小数第3位で丸める (1.125 → 1.125, 0.1234 → 0.123)
  return Math.round(n * 1000) / 1000;
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

// 人工を見やすく整形 (例: 1 → '1.0', 0.5 → '0.5', 1.125 → '1.125', 1.525 → '1.525', 4.025 → '4.025')
// 小数点第3位までの値を保持 (末尾の余分な0は省略するが、最低でも1桁は表示)
function fmtManDays(v) {
  const n = Number(v);
  if (!isFinite(n)) return '0';
  // 第3位までの可変桁表示: 1.0/0.5/1.125/1.525 等
  return n.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 3 });
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

// ========== 部位別1人工あたり 共通ヘルパー (新計算ルール) ==========
// 新ルール:
//   部位別人工数 = Σ(その日の総人工 × その日の部位別数量 ÷ その日の総加工数量)   ← 日ごとに計算して合計
//   部位別1人工あたり = 期間部位別数量合計 ÷ 期間部位別人工数合計
//   ※ 全部位を同じ総人工で割らない (部位ごとの稼働日重み付け)
//
// 入力: rows = 各行が「ある日×ある工場」の集計 ({date, factory, staff_count, total_qty, PART_KEYS...})
//   (=APIの /analytics/daily 形式、または raw records と同じ粒度)
function aggregatePartsPerManDay(rows) {
  rows = safeArray(rows);
  const sums = {}; // {part_key: {qty, md}}
  PART_KEYS.forEach(k => { sums[k] = { qty: 0, md: 0 }; });
  for (const r of rows) {
    if (!r) continue;
    const totalQty = safeNum(r.total_qty);
    const staff = safeNum(r.staff_count);
    for (const k of PART_KEYS) {
      const partQty = safeNum(r[k]);
      // その日のその部位の人工数 = staff_count × (部位qty / total_qty)
      const partMd = totalQty > 0 ? staff * partQty / totalQty : 0;
      sums[k].qty += partQty;
      sums[k].md += partMd;
    }
  }
  return PART_KEYS.map(k => ({
    part_key: k,
    part_label: PART_LABELS[k],
    total_qty: sums[k].qty,
    part_man_days: sums[k].md,
    qty_per_man_day: sums[k].md > 0 ? sums[k].qty / sums[k].md : 0
  }));
}

// バックエンド /api/analytics/parts-per-manday の overall 配列を表示用形式に整える
// (新計算ルール: 部位別人工数を返す)
function normalizePartsPerManDayResponse(arr) {
  return safeArray(arr).map(r => ({
    part_key: r.part_key,
    part_label: PART_LABELS[r.part_key] || r.part_key,
    total_qty: safeNum(r.total_qty),
    part_man_days: safeNum(r.part_man_days),
    qty_per_man_day: safeNum(r.qty_per_man_day)
  }));
}

// 部位別1人工あたり加工数量の表 + 任意の棒グラフ用キャンバスHTML を返す
// 表示列: 部位 / 加工数量 / 部位別人工数 / 1人工あたり加工数量
// options.canvasId: 指定すると棒グラフ用 <canvas> を併設
// options.title: 見出し (デフォルト '部位別 1人工あたり加工数量')
// options.subtitle: 表の上に補足を出したい場合
function renderPartsPerManDayTable(data, options = {}) {
  data = safeArray(data);
  const title = options.title || '部位別 1人工あたり加工数量';
  const subtitle = options.subtitle || '';
  const hasAnyQty = data.some(d => safeNum(d.total_qty) > 0);
  const hasAnyMd = data.some(d => safeNum(d.part_man_days) > 0);
  return `<div class="bg-white p-4 rounded-xl shadow-sm">
    <h3 class="font-semibold mb-2"><i class="fas fa-cubes mr-1 text-purple-500"></i>${escapeHtml(title)}</h3>
    ${subtitle ? `<p class="text-xs text-gray-500 mb-2">${escapeHtml(subtitle)}</p>` : ''}
    <p class="text-xs text-gray-400 mb-2">計算: 部位別人工数 = Σ(その日の総人工 × 部位数量 ÷ 総加工数量) / 1人工あたり = 部位数量合計 ÷ 部位別人工数合計</p>
    <div class="overflow-x-auto"><table class="data-table">
      <thead><tr>
        <th>部位</th><th>加工数量</th><th>部位別人工数</th><th>1人工あたり加工数量</th>
      </tr></thead>
      <tbody>${data.map(d => `<tr>
        <td class="text part-${String(d.part_key||'').replace('_qty','')}">${escapeHtml(d.part_label)}</td>
        <td>${fmt.qty(d.total_qty)}</td>
        <td>${safeNum(d.part_man_days) > 0 ? fmtManDays(d.part_man_days) + '人工' : '-'}</td>
        <td class="font-bold">${safeNum(d.part_man_days) > 0 ? fmt.qty(d.qty_per_man_day) + '/人工' : '-'}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    ${!hasAnyQty || !hasAnyMd ? '<p class="text-xs text-gray-400 mt-2"><i class="fas fa-info-circle mr-1"></i>対象データがありません</p>' : ''}
    ${options.canvasId ? `<div class="relative mt-4" style="height:300px"><canvas id="${options.canvasId}"></canvas></div>` : ''}
  </div>`;
}

// 部位別1人工あたり棒グラフを描画
function drawPartsPerManDayChart(canvasId, data) {
  data = safeArray(data);
  const hasAny = data.some(d => safeNum(d.qty_per_man_day) > 0 && safeNum(d.part_man_days) > 0);
  if (!hasAny) { emptyChartMessage(canvasId); return; }
  safeCreateChart(canvasId, {
    type: 'bar',
    data: {
      labels: data.map(d => d.part_label),
      datasets: [{
        label: `1人工あたり (${state.qtyUnit}/人工)`,
        data: data.map(d => fmt.qtyVal(d.qty_per_man_day)),
        backgroundColor: data.map(d => PART_COLORS[d.part_key])
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, title: { display: true, text: state.qtyUnit + ' / 人工' } } }
    }
  });
}

// 部位別1人工あたりCSV出力 (全体)
// 出力列: 部位 / 加工数量 / 部位別人工数 / 1人工あたり加工数量
function exportPartsPerManDayCSV(name, data) {
  data = safeArray(data);
  if (data.length === 0) { alert('データがありません'); return; }
  const rows = data.map(d => ({
    部位: d.part_label,
    加工数量: safeNum(d.total_qty),
    部位別人工数: safeNum(d.part_man_days),
    '1人工あたり加工数量': safeNum(d.part_man_days) > 0 ? safeNum(d.qty_per_man_day) : 0
  }));
  exportCSV(name, rows, ['部位','加工数量','部位別人工数','1人工あたり加工数量']);
}

// 新APIを呼び出して、フィルタを反映した部位別1人工あたり (overall + by_factory) を取得
// fallback: state.useSampleData の時は SAMPLE_RECORDS から日別集計
async function fetchPartsPerManDay(params) {
  if (state.useSampleData) {
    return computePartsPerManDayFromRecords(SAMPLE_RECORDS, params);
  }
  try {
    const r = await api.partsPerManDay(params || {});
    return {
      overall: normalizePartsPerManDayResponse(r?.overall),
      byFactory: Object.fromEntries(
        Object.entries(r?.by_factory || {}).map(([fac, arr]) => [fac, normalizePartsPerManDayResponse(arr)])
      ),
      rowCount: safeNum(r?.row_count)
    };
  } catch (e) {
    console.warn('[partsPerManDay fetch failed, fallback]', e.message);
    return computePartsPerManDayFromRecords(SAMPLE_RECORDS, params);
  }
}

// SAMPLE_RECORDS から計算 (state.useSampleData=true 時)
function computePartsPerManDayFromRecords(records, params) {
  let r = safeArray(records);
  const p = params || {};
  if (p.dateFrom) r = r.filter(x => x.date >= p.dateFrom);
  if (p.dateTo) r = r.filter(x => x.date <= p.dateTo);
  if (p.year) r = r.filter(x => x.date && x.date.startsWith(String(p.year)));
  if (p.month) {
    const m = String(p.month).padStart(2,'0');
    r = r.filter(x => x.date && x.date.slice(5,7) === m);
  }
  if (p.factory && p.factory !== 'all') r = r.filter(x => x.factory === p.factory);
  const overall = aggregatePartsPerManDay(r);
  const facs = [...new Set(r.map(x => x.factory))];
  const byFactory = {};
  for (const fac of facs) {
    byFactory[fac] = aggregatePartsPerManDay(r.filter(x => x.factory === fac));
  }
  return { overall, byFactory, rowCount: r.length };
}

// ========== API レイヤー (全てtry/catch) ==========
const api = {
  async _safeRequest(fn) {
    try { return await fn(); }
    catch (err) {
      const msg = err?.response?.data?.error || err?.message || String(err);
      const status = err?.response?.status || 0;
      const e = new Error(msg); e.status = status; e.original = err;
      // レスポンス本文全体も持たせる (楽観ロック conflict / 重複 duplicate フラグ等をハンドリング用)
      e.data = err?.response?.data || null;
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
  workers() { return this._safeRequest(async () => (await axios.get('/api/workers')).data.workers || []); },
  workerAnalytics(params) { return this._safeRequest(async () => (await axios.get('/api/analytics/workers', { params })).data.data || []); },
  workerMonthly(params) { return this._safeRequest(async () => (await axios.get('/api/analytics/workers/monthly', { params })).data.data || []); },
  // 部位別1人工あたり加工数量 (新計算ルール: 部位別人工数 = 各日のstaff × 部位数量/total_qty を積算)
  partsPerManDay(params) { return this._safeRequest(async () => (await axios.get('/api/analytics/parts-per-manday', { params })).data); },

  // ==== 運搬数量 (加工数量とは独立) ====
  listTransport(params = {}) { return this._safeRequest(async () => (await axios.get('/api/transport-records', { params })).data.records || []); },
  getTransport(id) { return this._safeRequest(async () => (await axios.get(`/api/transport-records/${id}`)).data.record); },
  createTransport(data) { return this._safeRequest(async () => (await axios.post('/api/transport-records', data)).data.record); },
  updateTransport(id, data) { return this._safeRequest(async () => (await axios.put(`/api/transport-records/${id}`, data)).data.record); },
  deleteTransport(id) { return this._safeRequest(async () => (await axios.delete(`/api/transport-records/${id}`)).data); },
  transportVehicles() { return this._safeRequest(async () => (await axios.get('/api/transport-records/vehicles')).data.vehicles || []); },
  transportDaily(params) { return this._safeRequest(async () => (await axios.get('/api/analytics/transport/daily', { params })).data.data || []); },
  transportMonthly(params) { return this._safeRequest(async () => (await axios.get('/api/analytics/transport/monthly', { params })).data.data || []); },
  transportYearly(params) { return this._safeRequest(async () => (await axios.get('/api/analytics/transport/yearly', { params })).data); },
  transportWorkers(params) { return this._safeRequest(async () => (await axios.get('/api/analytics/transport/workers', { params })).data.data || []); }
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
            <input id="username" type="text" required class="input-base" autocomplete="username" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">パスワード</label>
            <input id="password" type="password" required class="input-base" autocomplete="current-password" />
          </div>
          <button type="submit" class="btn-primary w-full">
            <i class="fas fa-sign-in-alt mr-2"></i>ログイン
          </button>
          <div id="loginError" class="text-red-600 text-sm text-center hidden"></div>
        </form>
        <div class="mt-6 text-center border-t pt-4">
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
          ${navBtn('workers','users','人員別分析')}
          <span class="hidden md:inline-block border-l border-gray-300 mx-1"></span>
          ${navBtn('transport-input','truck','積込・運搬数量入力')}
          ${navBtn('transport-list','list','積込・運搬実績一覧')}
          ${navBtn('transport-analysis','chart-line','積込・運搬数量分析')}
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
      case 'workers': await renderWorkers(); break;
      case 'transport-input': renderTransportInput(); break;
      case 'transport-list': await renderTransportList(); break;
      case 'transport-analysis': await renderTransportAnalysis(); break;
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

  // トレーラー台数集計
  const todayTrailer = todayRows.reduce((s,r)=>s+safeNum(r?.trailer_count),0);
  const monthTrailer = monthRows.reduce((s,r)=>s+safeNum(r?.trailer_count),0);
  const yearTrailer  = yearRows.reduce((s,r)=>s+safeNum(r?.trailer_count),0);
  const monthTrailerHonsha = safeNum(monthRows.find(r=>r?.factory==='本社工場')?.trailer_count);
  const monthTrailerDai2   = safeNum(monthRows.find(r=>r?.factory==='第二工場')?.trailer_count);

  // 部位別1人工あたり (新計算ルール: 日ごと算出を合計): 今月分をAPIから取得
  let monthPpmd = [];
  try {
    const ym = String(data.month.ym || '');
    const [y, m] = ym.split('-');
    if (y && m) {
      const ppmd = await fetchPartsPerManDay({ year: y, month: m });
      monthPpmd = ppmd.overall || [];
    } else {
      const ppmd = await fetchPartsPerManDay({});
      monthPpmd = ppmd.overall || [];
    }
  } catch (e) {
    console.warn('[dashboard partsPerManDay]', e.message);
    monthPpmd = [];
  }

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

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div class="stat-card" style="border-left:4px solid #d97706;background:#fffbeb">
          <div class="label text-amber-800"><i class="fas fa-truck-moving mr-1"></i>今日のトレーラー台数</div>
          <div class="value text-amber-900">${todayTrailer.toLocaleString('ja-JP')}<span class="text-base font-normal text-gray-600 ml-1">台</span></div>
          <div class="sub">本社: ${safeNum(todayRows.find(r=>r?.factory==='本社工場')?.trailer_count).toLocaleString('ja-JP')}台 / 第二: ${safeNum(todayRows.find(r=>r?.factory==='第二工場')?.trailer_count).toLocaleString('ja-JP')}台</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #d97706;background:#fffbeb">
          <div class="label text-amber-800"><i class="fas fa-truck-moving mr-1"></i>今月のトレーラー台数</div>
          <div class="value text-amber-900">${monthTrailer.toLocaleString('ja-JP')}<span class="text-base font-normal text-gray-600 ml-1">台</span></div>
          <div class="sub">本社: ${monthTrailerHonsha.toLocaleString('ja-JP')}台 / 第二: ${monthTrailerDai2.toLocaleString('ja-JP')}台</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #d97706;background:#fffbeb">
          <div class="label text-amber-800"><i class="fas fa-truck-moving mr-1"></i>今年のトレーラー台数</div>
          <div class="value text-amber-900">${yearTrailer.toLocaleString('ja-JP')}<span class="text-base font-normal text-gray-600 ml-1">台</span></div>
          <div class="sub">${data.year.year}年合計</div>
        </div>
      </div>

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

      <div id="dashPartsPerMd">${
        renderPartsPerManDayTable(
          monthPpmd,
          {
            title: `部位別 1人工あたり加工数量（今月 ${dayjs(data.month.ym+'-01').format('YYYY年M月')}）`,
            canvasId: 'dashPartsPerMdChart'
          }
        )
      }</div>
    </div>
  `;
  bindUnitToggle();

  // 部位別1人工あたり棒グラフ
  drawPartsPerManDayChart('dashPartsPerMdChart', monthPpmd);

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
        trailer_count: fs.reduce((s,r)=>s+safeNum(r.trailer_count), 0),
        days: new Set(fs.map(r=>r.date)).size
      };
    }).filter(r => r.qty > 0 || r.staff > 0 || r.trailer_count > 0);
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
    trailer_count: '',
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
            <input id="staff_count" type="number" min="0" step="0.001" value="${r.staff_count||''}" class="input-num" placeholder="例: 2.5" inputmode="decimal" />
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
          <p class="text-xs text-gray-600 mb-2">人員名と人工（1日=1.0、半日=0.5、四半日=0.25、残業=1.25〜2.0）を入力してください。人工合計が「人員数」に自動セットされます。空欄なら「人員数」欄を手入力できます。</p>
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

        <div class="bg-amber-50 border border-amber-200 p-4 rounded-lg">
          <h3 class="font-semibold text-amber-900 mb-2">
            <i class="fas fa-truck-moving mr-1"></i>材料搬入
          </h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">トレーラー台数 (台)</label>
              <input id="trailer_count" type="number" min="0" step="0.5" value="${(r.trailer_count===0||r.trailer_count)?r.trailer_count:''}" class="input-num" placeholder="例: 0, 1, 2, 0.5, 1.5" inputmode="decimal" title="材料搬入トレーラー台数 (0以上の数値、0.5刻みで小数も入力可)" />
            </div>
            <p class="text-xs text-gray-600">未入力の場合は0台として扱います</p>
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
            <input type="number" data-worker-md-idx="${i}" value="${fmtManDays(w.man_days)}" min="0" max="2" step="0.001" placeholder="1.0" class="input-num w-full" inputmode="decimal" title="人工 (1日=1.0、半日=0.5、残業=1.25/1.5/1.75、最大=2.0、小数第3位まで入力可)" />
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
      // 材料搬入トレーラー台数もコピー (未定義/nullは0扱いの空表示)
      const prevTrailer = safeNum(prev.trailer_count);
      const trailerEl = document.getElementById('trailer_count');
      if (trailerEl) trailerEl.value = prevTrailer > 0 ? prevTrailer : '';
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
      // 材料搬入トレーラー台数 (未入力は0、マイナス入力は0にクランプ)
      trailer_count: Math.max(0, safeNum(document.getElementById('trailer_count').value)),
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
  document.getElementById('csvBtn').addEventListener('click', exportListCsvUnified);
  document.getElementById('pdfBtn').addEventListener('click', () => exportListPdfUnified());

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
          <th>総加工量</th><th>1人工あたり</th><th class="part-trailer">トレーラー台数</th><th>備考</th><th class="no-print">操作</th>
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
            <td class="text-amber-700 font-semibold">${safeNum(r.trailer_count).toLocaleString('ja-JP')} 台</td>
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
      <div id="dailySummary"></div>
      <div class="bg-white p-4 rounded-xl shadow-sm">
        <div class="relative" style="height:360px"><canvas id="dailyChart"></canvas></div>
      </div>
      <div id="dailyTable" class="bg-white rounded-xl shadow-sm overflow-x-auto"></div>
      <div id="dailyPartsPerMd"></div>
    </div>
  `;
  bindUnitToggle();

  const load = async () => {
    const tableEl = document.getElementById('dailyTable');
    const partsPerMdEl = document.getElementById('dailyPartsPerMd');
    const summaryEl = document.getElementById('dailySummary');
    setSectionLoading(tableEl);
    if (partsPerMdEl) partsPerMdEl.innerHTML = '';
    if (summaryEl) summaryEl.innerHTML = '';
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

    // 指定期間の集計カード (加工総数量 / 総人工 / 1人工あたり加工数量)
    // 工場区分・日付範囲は data がすでにフィルタ済み (api.daily / aggregateDailyLocal)
    // データ0件でも "-" 表示でカードは出す (要件7: 期間にデータがない場合のエラー回避)
    const renderSummaryCard = () => {
      if (!summaryEl) return;
      const totalQty = data.reduce((s, r) => s + safeNum(r.total_qty), 0);
      const totalMd  = data.reduce((s, r) => s + safeNum(r.staff_count), 0);
      const perMd    = totalMd > 0 ? (totalQty / totalMd) : 0;
      const totalTrailer = data.reduce((s, r) => s + safeNum(r.trailer_count), 0);
      const factoryLabel = factory === 'all' ? '全体合算' : factory;
      const periodLabel = `${dateFrom || '-'} 〜 ${dateTo || '-'} / 工場: ${factoryLabel}`;
      // 総人工は要件で「小数点第3位まで表示」とあるため、集計カード専用に3桁固定でフォーマット
      // 例: 82.300、113.637、4.025
      const fmtTotalMd = (n) => Number(n).toLocaleString('ja-JP', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
      summaryEl.innerHTML = `
        <div class="bg-white p-4 rounded-xl shadow-sm">
          <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 class="font-semibold text-gray-800"><i class="fas fa-calculator mr-1 text-blue-600"></i>指定期間の集計</h3>
            <p class="text-xs text-gray-500">期間: ${escapeHtml(periodLabel)}</p>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div class="stat-card all">
              <div class="label"><i class="fas fa-weight-hanging mr-1"></i>加工総数量</div>
              <div class="value">${data.length > 0 ? fmt.qty(totalQty) : '<span class="text-gray-400">-</span>'}</div>
            </div>
            <div class="stat-card honsha">
              <div class="label"><i class="fas fa-users mr-1"></i>総人工</div>
              <div class="value">${data.length > 0 ? fmtTotalMd(totalMd) + '<span class="text-base font-normal text-gray-600 ml-1">人工</span>' : '<span class="text-gray-400">-</span>'}</div>
            </div>
            <div class="stat-card dai2">
              <div class="label"><i class="fas fa-chart-line mr-1"></i>1人工あたり加工数量</div>
              <div class="value">${totalMd > 0 ? fmt.qty(perMd) + '<span class="text-base font-normal text-gray-600 ml-1">/人工</span>' : '<span class="text-gray-400">-</span>'}</div>
            </div>
            <div class="stat-card" style="border-left:4px solid #d97706;background:#fffbeb">
              <div class="label text-amber-800"><i class="fas fa-truck-moving mr-1"></i>トレーラー台数</div>
              <div class="value text-amber-900">${totalTrailer.toLocaleString('ja-JP')}<span class="text-base font-normal text-gray-600 ml-1">台</span></div>
            </div>
          </div>
        </div>
      `;
    };
    renderSummaryCard();

    const dates = [...new Set(data.map(d => d.date))].sort();
    if (dates.length === 0) {
      tableEl.innerHTML = `<div class="text-center py-10 text-gray-500"><i class="fas fa-inbox text-3xl"></i><p class="mt-2">表示できるデータがありません</p></div>`;
      emptyChartMessage('dailyChart');
      if (partsPerMdEl) {
        const empty = aggregatePartsPerManDay([]);
        partsPerMdEl.innerHTML = renderPartsPerManDayTable(empty, {
          title: '部位別 1人工あたり加工数量',
          canvasId: 'dailyPartsPerMdChart'
        });
        drawPartsPerManDayChart('dailyPartsPerMdChart', empty);
      }
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
          <th>合計</th><th>1人工あたり</th><th class="part-trailer">トレーラー台数</th>
        </tr></thead>
        <tbody>
          ${data.map(r => `<tr>
            <td class="text">${fmt.date(r.date)}</td>
            <td class="text"><span class="px-2 py-1 rounded text-xs ${r.factory==='本社工場'?'badge-honsha':'badge-dai2'}">${escapeHtml(r.factory||'')}</span></td>
            <td>${fmtManDays(safeNum(r.staff_count))}</td>
            ${PART_KEYS.map(k=>`<td>${fmt.qty(r[k])}</td>`).join('')}
            <td class="font-bold">${fmt.qty(r.total_qty)}</td>
            <td>${safeNum(r.qty_per_person)>0?fmt.qty(r.qty_per_person):'-'}</td>
            <td class="text-amber-700 font-semibold">${safeNum(r.trailer_count).toLocaleString('ja-JP')} 台</td>
          </tr>`).join('')}
        </tbody>
      </table>
    `;

    // 部位別1人工あたり加工数量
    const partsData = aggregatePartsPerManDay(data);
    if (partsPerMdEl) {
      const subt = `期間: ${dateFrom||'-'} 〜 ${dateTo||'-'} / 工場: ${factory==='all'?'全体合算':factory}`;
      partsPerMdEl.innerHTML = renderPartsPerManDayTable(partsData, {
        title: '部位別 1人工あたり加工数量',
        subtitle: subt,
        canvasId: 'dailyPartsPerMdChart'
      });
      drawPartsPerManDayChart('dailyPartsPerMdChart', partsData);
    }

    // 統一エクスポート用キャッシュに保存 (画面と同じデータを保証)
    _stashDailyCache(data, partsData, { dateFrom, dateTo, factory });
    document.getElementById('dCsv').onclick = exportDailyCsvUnified;
    document.getElementById('dPdf').onclick = () => exportDailyPdfUnified();
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
    if (!keys[k]) keys[k] = { date: rec.date, factory: rec.factory, staff_count: 0, total_qty: 0, trailer_count: 0 };
    PART_KEYS.forEach(p => { keys[k][p] = safeNum(keys[k][p]) + safeNum(rec[p]); });
    keys[k].staff_count += safeNum(rec.staff_count);
    keys[k].total_qty += safeNum(rec.total_qty);
    keys[k].trailer_count += safeNum(rec.trailer_count);
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
      <div id="monthlySummary"></div>
      <div class="bg-white p-4 rounded-xl shadow-sm">
        <div class="relative" style="height:360px"><canvas id="monthlyChart"></canvas></div>
      </div>
      <div id="monthlyTrailerTable" class="bg-white rounded-xl shadow-sm overflow-x-auto"></div>
      <div id="monthlyTable" class="bg-white rounded-xl shadow-sm overflow-x-auto"></div>
      <div id="monthlyPartsPerMd"></div>
    </div>
  `;
  bindUnitToggle();

  const load = async () => {
    const tableEl = document.getElementById('monthlyTable');
    const trailerTableEl = document.getElementById('monthlyTrailerTable');
    const summaryEl = document.getElementById('monthlySummary');
    const partsPerMdEl = document.getElementById('monthlyPartsPerMd');
    setSectionLoading(tableEl);
    if (partsPerMdEl) partsPerMdEl.innerHTML = '';
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

    // 年間トレーラー台数サマリカード (テーブル上部に表示)
    const yearTrailerTotal = data.reduce((s, r) => s + safeNum(r.trailer_count), 0);
    const factoryLabelM = factory === 'all' ? '全体合算' : factory;
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="bg-amber-50 border border-amber-200 p-4 rounded-xl shadow-sm">
          <div class="flex items-center justify-between mb-2 flex-wrap gap-2">
            <h3 class="font-semibold text-amber-900"><i class="fas fa-truck-moving mr-1"></i>${year}年 トレーラー台数(合計)</h3>
            <p class="text-xs text-gray-600">工場: ${escapeHtml(factoryLabelM)}</p>
          </div>
          <div class="text-3xl font-bold text-amber-900">${yearTrailerTotal.toLocaleString('ja-JP')}<span class="text-base font-normal text-gray-600 ml-1">台</span></div>
          <p class="text-xs text-gray-500 mt-1">表示中の月別データのトレーラー台数合計</p>
        </div>
      `;
    }

    if (months.length === 0) {
      tableEl.innerHTML = `<div class="text-center py-10 text-gray-500"><i class="fas fa-inbox text-3xl"></i><p class="mt-2">表示できるデータがありません</p></div>`;
      if (trailerTableEl) trailerTableEl.innerHTML = '';
      emptyChartMessage('monthlyChart');
      if (partsPerMdEl) {
        const empty = aggregatePartsPerManDay([]);
        partsPerMdEl.innerHTML = renderPartsPerManDayTable(empty, {
          title: '部位別 1人工あたり加工数量',
          canvasId: 'monthlyPartsPerMdChart'
        });
        drawPartsPerManDayChart('monthlyPartsPerMdChart', empty);
      }
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

    // トレーラー台数 専用月別サマリ表 (見落とし防止のため、メインテーブルとは別に表示)
    if (trailerTableEl) {
      trailerTableEl.innerHTML = `
        <div class="p-3 bg-amber-50 border-b border-amber-200">
          <h3 class="font-semibold text-amber-900"><i class="fas fa-truck-moving mr-1"></i>月別 トレーラー台数</h3>
          <p class="text-xs text-gray-600 mt-1">${year}年 / 工場: ${escapeHtml(factoryLabelM)}</p>
        </div>
        <table class="data-table">
          <thead><tr>
            <th>月</th><th>工場</th><th style="background:#fef3c7;color:#78350f">トレーラー台数</th>
          </tr></thead>
          <tbody>
            ${data.map(r => `<tr>
              <td class="text">${dayjs(r.ym+'-01').format('YYYY/M月')}</td>
              <td class="text"><span class="px-2 py-1 rounded text-xs ${r.factory==='本社工場'?'badge-honsha':'badge-dai2'}">${escapeHtml(r.factory||'')}</span></td>
              <td class="font-bold text-amber-800" style="background:#fffbeb;font-size:1.05em">${safeNum(r.trailer_count).toLocaleString('ja-JP')} 台</td>
            </tr>`).join('')}
          </tbody>
        </table>
      `;
    }

    tableEl.innerHTML = `
      <div class="p-3 bg-gray-50 border-b border-gray-200">
        <h3 class="font-semibold text-gray-800"><i class="fas fa-table mr-1"></i>月別 詳細データ</h3>
        <p class="text-xs text-gray-600 mt-1">部位別の月間合計 + トレーラー台数(右端列)</p>
      </div>
      <table class="data-table">
        <thead><tr>
          <th>月</th><th>工場</th><th>稼働日</th><th>延べ人工</th><th style="background:#fef3c7;color:#78350f;min-width:110px">トレーラー台数</th>
          ${PART_KEYS.map(k=>`<th>${PART_LABELS[k]}</th>`).join('')}
          <th>月間合計</th><th>1日平均</th><th>1人平均</th>
        </tr></thead>
        <tbody>
          ${data.map(r => `<tr>
            <td class="text">${dayjs(r.ym+'-01').format('YYYY/M月')}</td>
            <td class="text"><span class="px-2 py-1 rounded text-xs ${r.factory==='本社工場'?'badge-honsha':'badge-dai2'}">${escapeHtml(r.factory||'')}</span></td>
            <td>${safeNum(r.days)}</td>
            <td>${fmtManDays(safeNum(r.staff_count))}</td>
            <td class="font-bold text-amber-800" style="background:#fffbeb">${safeNum(r.trailer_count).toLocaleString('ja-JP')} 台</td>
            ${PART_KEYS.map(k=>`<td>${fmt.qty(r[k])}</td>`).join('')}
            <td class="font-bold">${fmt.qty(r.total_qty)}</td>
            <td>${fmt.qty(r.avg_daily_qty)}</td>
            <td>${safeNum(r.qty_per_person)>0?fmt.qty(r.qty_per_person):'-'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    `;
    // 部位別1人工あたり加工数量 (新計算ルール: 日ごとに算出して合計 → APIに委譲)
    let partsData = [];
    try {
      const ppmd = await fetchPartsPerManDay({ year, factory });
      partsData = ppmd.overall || [];
    } catch (e) { console.warn('[monthly partsPerManDay]', e.message); }
    if (partsPerMdEl) {
      const subt = `年: ${year} / 工場: ${factory==='all'?'全体合算':factory}`;
      partsPerMdEl.innerHTML = renderPartsPerManDayTable(partsData, {
        title: '部位別 1人工あたり加工数量',
        subtitle: subt,
        canvasId: 'monthlyPartsPerMdChart'
      });
      drawPartsPerManDayChart('monthlyPartsPerMdChart', partsData);
    }

    // 統一エクスポート用キャッシュに保存 (画面と同じデータを保証)
    _stashMonthlyCache(data, partsData, { year, factory });
    document.getElementById('mCsv').onclick = exportMonthlyCsvUnified;
    document.getElementById('mPdf').onclick = () => exportMonthlyPdfUnified();
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
    if (!keys[k]) keys[k] = { ym, factory: rec.factory, staff_count: 0, total_qty: 0, trailer_count: 0, days_set: new Set() };
    PART_KEYS.forEach(p => { keys[k][p] = safeNum(keys[k][p]) + safeNum(rec[p]); });
    keys[k].staff_count += safeNum(rec.staff_count);
    keys[k].total_qty += safeNum(rec.total_qty);
    keys[k].trailer_count += safeNum(rec.trailer_count);
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
      <div id="yearlyPartsPerMd"></div>
    </div>
  `;
  bindUnitToggle();

  const load = async () => {
    const tableEl = document.getElementById('yearlyTable');
    const partsPerMdEl = document.getElementById('yearlyPartsPerMd');
    setSectionLoading(tableEl);
    if (partsPerMdEl) partsPerMdEl.innerHTML = '';
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
      if (partsPerMdEl) {
        const empty = aggregatePartsPerManDay([]);
        partsPerMdEl.innerHTML = renderPartsPerManDayTable(empty, {
          title: '部位別 1人工あたり加工数量',
          canvasId: 'yearlyPartsPerMdChart'
        });
        drawPartsPerManDayChart('yearlyPartsPerMdChart', empty);
      }
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

    // 年間トレーラー台数サマリ + 月別推移カード
    const totalTrailerYearly = data.reduce((s, r) => s + safeNum(r.trailer_count), 0);
    const monthlyTrailer = Array.from({length:12}, (_,i) => {
      const ym = `${trendYear}-${String(i+1).padStart(2,'0')}`;
      return monthly.filter(x => x.ym === ym).reduce((s,r) => s + safeNum(r.trailer_count), 0);
    });
    const factoryLabelY = factory === 'all' ? '全体合算' : factory;

    tableEl.innerHTML = `
      <div class="bg-amber-50 border border-amber-200 p-4 rounded-xl shadow-sm mb-3">
        <div class="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h3 class="font-semibold text-amber-900"><i class="fas fa-truck-moving mr-1"></i>年間トレーラー台数</h3>
          <p class="text-xs text-gray-600">工場: ${escapeHtml(factoryLabelY)}</p>
        </div>
        <div class="text-3xl font-bold text-amber-900">${totalTrailerYearly.toLocaleString('ja-JP')}<span class="text-base font-normal text-gray-600 ml-1">台</span></div>
        <p class="text-xs text-gray-500 mt-1">全年合計（表示中の年データの合計）</p>
      </div>
      <table class="data-table">
        <thead><tr>
          <th>年</th><th>工場</th><th>稼働日</th><th>延べ人工</th>
          ${PART_KEYS.map(k=>`<th>${PART_LABELS[k]}</th>`).join('')}
          <th>年間合計</th><th>1人工あたり</th><th class="part-trailer">トレーラー台数</th>
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
            <td class="text-amber-700 font-semibold">${safeNum(r.trailer_count).toLocaleString('ja-JP')} 台</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="bg-white p-4 rounded-xl shadow-sm mt-3">
        <div class="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h3 class="font-semibold text-gray-800"><i class="fas fa-chart-bar mr-1 text-amber-600"></i>${trendYear}年 月別トレーラー台数推移</h3>
          <p class="text-xs text-gray-500">工場: ${escapeHtml(factoryLabelY)}</p>
        </div>
        <div class="relative" style="height:280px"><canvas id="trailerTrendChart"></canvas></div>
      </div>
    `;
    // 月別トレーラー棒グラフ描画
    if (monthlyTrailer.some(v => v > 0)) {
      safeCreateChart('trailerTrendChart', {
        type: 'bar',
        data: {
          labels: Array.from({length:12}, (_,i)=>`${i+1}月`),
          datasets: [{ label: 'トレーラー台数 (台)', data: monthlyTrailer, backgroundColor: '#d97706' }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
      });
    } else {
      emptyChartMessage('trailerTrendChart');
    }
    // 部位別1人工あたり加工数量 (年間=全データ / 日ごとに算出して合計 → APIに委譲)
    let partsData = [];
    try {
      const ppmd = await fetchPartsPerManDay({ factory });
      partsData = ppmd.overall || [];
    } catch (e) { console.warn('[yearly partsPerManDay]', e.message); }
    if (partsPerMdEl) {
      const subt = `工場: ${factory==='all'?'全体合算':factory}`;
      partsPerMdEl.innerHTML = renderPartsPerManDayTable(partsData, {
        title: '部位別 1人工あたり加工数量（年間累計）',
        subtitle: subt,
        canvasId: 'yearlyPartsPerMdChart'
      });
      drawPartsPerManDayChart('yearlyPartsPerMdChart', partsData);
    }

    // 統一エクスポート用キャッシュに保存 (画面と同じデータを保証)
    _stashYearlyCache(data, monthly, partsData, trendYear, { factory, year: trendYear });
    document.getElementById('yCsv').onclick = exportYearlyCsvUnified;
    document.getElementById('yPdf').onclick = () => exportYearlyPdfUnified();
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
    if (!keys[k]) keys[k] = { year: y, factory: rec.factory, staff_count: 0, total_qty: 0, trailer_count: 0, days_set: new Set() };
    PART_KEYS.forEach(p => { keys[k][p] = safeNum(keys[k][p]) + safeNum(rec[p]); });
    keys[k].staff_count += safeNum(rec.staff_count);
    keys[k].total_qty += safeNum(rec.total_qty);
    keys[k].trailer_count += safeNum(rec.trailer_count);
    keys[k].days_set.add(rec.date);
  });
  return Object.values(keys).map(k => ({
    ...k,
    days: k.days_set.size, days_set: undefined,
    qty_per_person: k.staff_count > 0 ? k.total_qty / k.staff_count : 0
  })).sort((a,b) => a.year.localeCompare(b.year));
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
          ...Object.fromEntries(PART_KEYS.map(k => [k, 0])),
          // 新計算ルール: 部位別人工数 (per-worker)
          ...Object.fromEntries(PART_KEYS.map(k => ['partmd_' + k, 0]))
        };
      }
      const a = map[name];
      a.days += 1;
      a.man_days_total += md;
      a.total_qty += personQty;
      if (r.factory === '本社工場') { a.honsha_qty += personQty; a.honsha_man_days += md; }
      else if (r.factory === '第二工場') { a.dai2_qty += personQty; a.dai2_man_days += md; }
      PART_KEYS.forEach(k => {
        const partQty = safeNum(r[k]);
        a[k] += (partQty / mdSum) * md;
        // 新計算ルール: その人の部位別人工数 = その人の人工 × 部位数量 ÷ 総加工数量 を日ごとに積算
        if (total > 0) a['partmd_' + k] += md * (partQty / total);
      });
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
let _workerPartsPerMdCache = []; // 人員ごとの部位別1人工あたり (CSV/PDF用)

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

      <!-- 人員ごとの部位別 1人工あたり加工数量 -->
      <div id="wPartsPerMdTable" class="bg-white rounded-xl shadow-sm overflow-x-auto"></div>

      <!-- 部位別 1人工あたり ランキング (基礎/梁/柱) -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="bg-white p-4 rounded-xl shadow-sm">
          <h3 class="font-semibold mb-3"><i class="fas fa-trophy mr-1" style="color:${PART_COLORS.foundation_qty}"></i>基礎 1人工あたり ランキング</h3>
          <div class="relative" style="height:320px"><canvas id="wRankFoundationChart"></canvas></div>
        </div>
        <div class="bg-white p-4 rounded-xl shadow-sm">
          <h3 class="font-semibold mb-3"><i class="fas fa-trophy mr-1" style="color:${PART_COLORS.beam_qty}"></i>梁 1人工あたり ランキング</h3>
          <div class="relative" style="height:320px"><canvas id="wRankBeamChart"></canvas></div>
        </div>
        <div class="bg-white p-4 rounded-xl shadow-sm">
          <h3 class="font-semibold mb-3"><i class="fas fa-trophy mr-1" style="color:${PART_COLORS.column_qty}"></i>柱 1人工あたり ランキング</h3>
          <div class="relative" style="height:320px"><canvas id="wRankColumnChart"></canvas></div>
        </div>
      </div>

      <!-- 部位プルダウン選択型 1人工あたり比較グラフ -->
      <div class="bg-white p-4 rounded-xl shadow-sm">
        <div class="flex flex-wrap items-center gap-3 mb-3">
          <h3 class="font-semibold"><i class="fas fa-filter text-indigo-500 mr-1"></i>部位を選んで 人員別 1人工あたり 比較</h3>
          <select id="wPartSelector" class="input-base" style="max-width:180px">
            ${PART_KEYS.map(k=>`<option value="${k}" ${state.workerPartFilter===k?'selected':''}>${PART_LABELS[k]}</option>`).join('')}
          </select>
        </div>
        <div class="relative" style="height:340px"><canvas id="wPartSelectChart"></canvas></div>
      </div>
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
  document.getElementById('wCsv').addEventListener('click', () => exportWorkerCsvUnified());
  document.getElementById('wPdf').addEventListener('click', () => exportWorkerPdfUnified());

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
            <th>人員名</th><th>参加日数</th><th>人工合計</th><th>総加工数量</th><th>1人工あたり</th>
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

  // ========== 人員ごとの部位別 1人工あたり加工数量 ==========
  renderWorkerPartsPerMd(data);
}

// 人員ごとの部位別 1人工あたり加工数量 を描画 (新計算ルール)
// data: 人員別分析API の戻り値 (各worker: {worker_name, man_days_total, foundation_qty, ..., other_qty, partmd_foundation_qty, ..., partmd_other_qty})
//   注: foundation_qty 等は按分済み加工数量 (バックエンドSQL: (r[part]/r.staff_count)*worker.man_days の合計)
//       partmd_foundation_qty 等は新計算ルールの「部位別人工数」 (バックエンドSQL: COALESCE(worker.man_days, 1.0) * r[part]/r.total_qty の合計)
// 部位別 1人工あたり = worker[part_key] / worker['partmd_' + part_key]
//   表は long-format (人員×部位の行): 人員名/部位/加工数量/部位別人工数/1人工あたり加工数量
function renderWorkerPartsPerMd(data) {
  data = safeArray(data);
  const tableEl = document.getElementById('wPartsPerMdTable');
  if (!tableEl) return;

  if (data.length === 0) {
    tableEl.innerHTML = `
      <div class="p-4">
        <h3 class="font-semibold mb-2"><i class="fas fa-cubes mr-1 text-purple-500"></i>人員名ごとの部位別 1人工あたり加工数量</h3>
        <div class="text-center py-6 text-gray-500 text-sm"><i class="fas fa-inbox text-2xl"></i><p class="mt-1">表示できるデータがありません</p></div>
      </div>`;
    ['wRankFoundationChart','wRankBeamChart','wRankColumnChart','wPartSelectChart'].forEach(emptyChartMessage);
    bindWorkerPartSelector([]);
    return;
  }

  // 各worker × 各part の (part_qty, part_man_days, qty_per_man_day) を組み立て
  // rows[]: { worker_name, man_days_total, part_key, part_label, part_qty, part_man_days, qty_per_man_day }
  const rows = [];
  // 部位別ランキング/プルダウングラフ用の wide-format も並行作成
  const wideRows = data.map(d => {
    const wide = { worker_name: d.worker_name, man_days_total: safeNum(d.man_days_total) };
    PART_KEYS.forEach(k => {
      const partQty = safeNum(d[k]);
      const partMd = safeNum(d['partmd_' + k]);
      const qtyPerMd = partMd > 0 ? partQty / partMd : 0;
      wide[k] = qtyPerMd;             // 1人工あたり (ランキング/グラフ用)
      wide['_qty_' + k] = partQty;    // 部位別加工数量 (CSV/PDF用)
      wide['_md_' + k] = partMd;      // 部位別人工数 (CSV/PDF用)
      rows.push({
        worker_name: d.worker_name,
        man_days_total: safeNum(d.man_days_total),
        part_key: k,
        part_label: PART_LABELS[k],
        part_qty: partQty,
        part_man_days: partMd,
        qty_per_man_day: qtyPerMd
      });
    });
    return wide;
  });

  // テーブル (long-format: 人員名 / 部位 / 加工数量 / 部位別人工数 / 1人工あたり加工数量)
  // 表示しやすさのため加工数量0の部位は省略 (全部位0なら -) ; ただし人員名は最初の部位行で1度だけ表示
  const grouped = {};
  rows.forEach(r => {
    if (!grouped[r.worker_name]) grouped[r.worker_name] = [];
    grouped[r.worker_name].push(r);
  });

  const tbodyHtml = Object.entries(grouped).map(([name, list]) => {
    const visible = list.filter(r => r.part_qty > 0 || r.part_man_days > 0);
    const useRows = visible.length > 0 ? visible : [list[0]]; // 全部0なら最初の1行だけプレースホルダー表示
    return useRows.map((r, i) => `<tr>
      ${i === 0 ? `<td class="text font-semibold" rowspan="${useRows.length}">${escapeHtml(name)}</td>` : ''}
      <td class="text part-${String(r.part_key||'').replace('_qty','')}">${escapeHtml(r.part_label)}</td>
      <td>${r.part_qty > 0 ? fmt.qty(r.part_qty) : '-'}</td>
      <td>${r.part_man_days > 0 ? fmtManDays(r.part_man_days) + '人工' : '-'}</td>
      <td class="font-bold">${r.part_man_days > 0 ? fmt.qty(r.qty_per_man_day) + '/人工' : '-'}</td>
    </tr>`).join('');
  }).join('');

  tableEl.innerHTML = `
    <div class="p-4">
      <h3 class="font-semibold mb-2"><i class="fas fa-cubes mr-1 text-purple-500"></i>人員名ごとの部位別 1人工あたり加工数量</h3>
      <p class="text-xs text-gray-500 mb-1">計算式 (新): その人の部位別人工数 = Σ(その日のその人の人工 × 部位数量 ÷ 総加工数量) / 1人工あたり = 部位別加工数量合計 ÷ 部位別人工数合計</p>
      <div class="overflow-x-auto">
      <table class="data-table">
        <thead>
          <tr>
            <th>人員名</th><th>部位</th><th>加工数量</th><th>部位別人工数</th><th>1人工あたり加工数量</th>
          </tr>
        </thead>
        <tbody>${tbodyHtml}</tbody>
      </table>
      </div>
    </div>
  `;

  // 基礎/梁/柱 ランキング (Top 10) — wide-format の qty/人工値を使用
  const drawRanking = (canvasId, partKey, color) => {
    const sorted = [...wideRows]
      .filter(r => r['_md_' + partKey] > 0 && r[partKey] > 0)
      .sort((a,b) => safeNum(b[partKey]) - safeNum(a[partKey]))
      .slice(0, 10);
    if (sorted.length === 0) { emptyChartMessage(canvasId); return; }
    safeCreateChart(canvasId, {
      type: 'bar',
      data: {
        labels: sorted.map(r => r.worker_name),
        datasets: [{
          label: `${PART_LABELS[partKey]} 1人工あたり (${state.qtyUnit}/人工)`,
          data: sorted.map(r => fmt.qtyVal(r[partKey])),
          backgroundColor: color
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, title: { display: true, text: state.qtyUnit + ' / 人工' } } }
      }
    });
  };
  drawRanking('wRankFoundationChart', 'foundation_qty', PART_COLORS.foundation_qty);
  drawRanking('wRankBeamChart', 'beam_qty', PART_COLORS.beam_qty);
  drawRanking('wRankColumnChart', 'column_qty', PART_COLORS.column_qty);

  // 部位プルダウン用キャッシュ (wide-format)
  _workerPartsPerMdCache = wideRows;

  // 部位プルダウン選択型グラフ
  bindWorkerPartSelector(wideRows);
}

// 後で再描画できるように分離
// rows は wide-format: { worker_name, man_days_total, [partKey]: qty/人工値, _md_<partKey>: 部位別人工数 ... }
function drawWorkerPartSelectChart(rows, partKey) {
  rows = safeArray(rows);
  if (rows.length === 0 || !PART_KEYS.includes(partKey)) {
    emptyChartMessage('wPartSelectChart');
    return;
  }
  const sorted = [...rows]
    .filter(r => safeNum(r['_md_' + partKey]) > 0)
    .sort((a,b) => safeNum(b[partKey]) - safeNum(a[partKey]))
    .slice(0, 15);
  if (sorted.length === 0 || sorted.every(r => safeNum(r[partKey]) <= 0)) {
    emptyChartMessage('wPartSelectChart');
    return;
  }
  safeCreateChart('wPartSelectChart', {
    type: 'bar',
    data: {
      labels: sorted.map(r => r.worker_name),
      datasets: [{
        label: `${PART_LABELS[partKey]} 1人工あたり (${state.qtyUnit}/人工)`,
        data: sorted.map(r => fmt.qtyVal(r[partKey])),
        backgroundColor: PART_COLORS[partKey] || '#6b7280'
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, title: { display: true, text: state.qtyUnit + ' / 人工' } } }
    }
  });
}

function bindWorkerPartSelector(rows) {
  const sel = document.getElementById('wPartSelector');
  if (!sel) return;
  const initialKey = PART_KEYS.includes(state.workerPartFilter) ? state.workerPartFilter : 'foundation_qty';
  sel.value = initialKey;
  drawWorkerPartSelectChart(rows, initialKey);
  // 既存リスナーがあれば onchange を上書き
  sel.onchange = () => {
    state.workerPartFilter = sel.value;
    drawWorkerPartSelectChart(rows, sel.value);
  };
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
  const keys = ['worker_name','days','man_days_total','total_qty','qty_per_man_day','honsha_qty','dai2_qty','honsha_man_days','dai2_man_days', ...PART_KEYS];
  exportCSV('人員別分析', rows, keys);

  // 人員ごとの部位別 1人工あたり加工数量 CSV (long-format, 新計算ルール)
  // 列: 人員名 / 部位 / 加工数量 / 部位別人工数 / 1人工あたり加工数量
  const partsRows = [];
  data.forEach(d => {
    PART_KEYS.forEach(k => {
      const partQty = safeNum(d[k]);
      const partMd = safeNum(d['partmd_' + k]);
      const qtyPerMd = partMd > 0 ? partQty / partMd : 0;
      // 数量も人工も0の行はスキップ
      if (partQty <= 0 && partMd <= 0) return;
      partsRows.push({
        人員名: d.worker_name,
        部位: PART_LABELS[k],
        加工数量: partQty,
        部位別人工数: partMd,
        '1人工あたり加工数量': partMd > 0 ? qtyPerMd : 0
      });
    });
  });
  if (partsRows.length === 0) {
    // 全人員で全部位0の場合でも、最低限ヘッダだけは出す
    partsRows.push({ 人員名: '-', 部位: '-', 加工数量: 0, 部位別人工数: 0, '1人工あたり加工数量': 0 });
  }
  const partsKeys = ['人員名','部位','加工数量','部位別人工数','1人工あたり加工数量'];
  exportCSV('人員別_部位別1人工あたり', partsRows, partsKeys);
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
      head: [['Rank','Worker','Days','ManDays','TotalQty','PerManDay','Honsha','Dai2']],
      body: top10.map((d,i) => [
        i+1, d.worker_name, safeNum(d.days),
        fmtManDays(d.man_days_total),
        fmt.qty(d.total_qty).replace(/\s.*/,''),
        safeNum(d.man_days_total) > 0 ? fmt.qty(d.qty_per_man_day).replace(/\s.*/,'') : '-',
        fmt.qty(d.honsha_qty).replace(/\s.*/,''),
        fmt.qty(d.dai2_qty).replace(/\s.*/,'')
      ]),
      startY: 32, styles: { fontSize: 8, cellPadding: 1 }, headStyles: { fillColor: [37,99,235] }
    });

    const finalY1 = (doc.lastAutoTable && doc.lastAutoTable.finalY ? doc.lastAutoTable.finalY : 60) + 6;
    doc.setFontSize(11);
    doc.text('Parts Breakdown by Worker (Allocated Qty)', 14, finalY1);
    doc.autoTable({
      head: [['Worker', ...PART_KEYS.map(k => PART_LABELS[k])]],
      body: data.map(d => [
        d.worker_name,
        ...PART_KEYS.map(k => fmt.qty(d[k]).replace(/\s.*/,''))
      ]),
      startY: finalY1 + 2, styles: { fontSize: 7, cellPadding: 1 }, headStyles: { fillColor: [37,99,235] }
    });

    // 新規ページ: 人員ごとの部位別 1人工あたり加工数量 (新計算ルール: long-format)
    // 列: Worker / Part / Qty / Part ManDays / Per ManDay
    doc.addPage('a4', 'landscape');
    doc.setFontSize(14);
    doc.text('Parts Quantity per Man-Day by Worker (Per-Part Man-Days Method)', 14, 14);
    doc.setFontSize(9);
    doc.text(`Generated: ${dayjs().format('YYYY-MM-DD HH:mm')}  Unit: ${state.qtyUnit}  ${filter.join('  ')}`, 14, 20);
    doc.text('Formula: part_man_days = sum_over_days(worker_man_days * part_qty / total_qty); per_md = part_qty / part_man_days', 14, 25);

    const partsBody = [];
    data.forEach(d => {
      PART_KEYS.forEach(k => {
        const partQty = safeNum(d[k]);
        const partMd = safeNum(d['partmd_' + k]);
        if (partQty <= 0 && partMd <= 0) return;
        const qtyPerMd = partMd > 0 ? partQty / partMd : 0;
        partsBody.push([
          d.worker_name,
          PART_LABELS[k],
          partQty > 0 ? fmt.qty(partQty).replace(/\s.*/,'') : '-',
          partMd > 0 ? fmtManDays(partMd) : '-',
          partMd > 0 ? fmt.qty(qtyPerMd).replace(/\s.*/,'') : '-'
        ]);
      });
    });
    if (partsBody.length === 0) {
      partsBody.push(['-','-','-','-','-']);
    }
    doc.autoTable({
      head: [['Worker','Part','Qty','Part ManDays','Per ManDay']],
      body: partsBody,
      startY: 30, styles: { fontSize: 8, cellPadding: 1 }, headStyles: { fillColor: [124,58,237] }
    });

    doc.save(`人員別分析_${dayjs().format('YYYYMMDD_HHmmss')}.pdf`);
  } catch (e) { alert('PDF出力に失敗しました: ' + e.message); }
}


// ========== CSV / PDF 出力 ==========
function exportCSV(name, rows, keys) {
  rows = safeArray(rows);
  if (rows.length === 0) { alert('データがありません'); return; }
  const labelMap = { ...PART_LABELS, date:'日付', factory:'工場', staff_count:'人員数（人工合計）', worker_names:'人員名', worker_name:'人員名', workers:'人員（人工）', total_qty:'総加工量(kg)', qty_per_person:'1人工あたり(kg)', qty_per_man_day:'1人工あたり加工量(kg)', man_days_total:'人工合計', honsha_man_days:'本社工場の人工', dai2_man_days:'第二工場の人工', ym:'年月', year:'年', days:'参加日数', avg_daily_qty:'1日平均(kg)', honsha_qty:'本社工場(kg)', dai2_qty:'第二工場(kg)', person_qty:'按分加工量(kg)', note:'備考', trailer_count:'トレーラー台数(台)' };
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
  const keys = ['date','factory','staff_count','workers',...PART_KEYS,'total_qty','qty_per_person','trailer_count','note'];
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
    const head = [['Date','Factory','ManDays','Workers(ManDays)', ...PART_KEYS.map(k => PART_LABELS[k]), 'Total','Per ManDay','Trailer']];
    const body = records.map(r => {
      const wlist = normalizeWorkersClient(r.workers, r.worker_names);
      const wStr = wlist.length ? wlist.map(w => `${w.name}(${fmtManDays(w.man_days)})`).join('、') : '-';
      return [
        r.date, r.factory, fmtManDays(safeNum(r.staff_count)), wStr,
        ...PART_KEYS.map(k => fmt.qty(r[k]).replace(/\s.*/,'')),
        fmt.qty(r.total_qty).replace(/\s.*/,''),
        safeNum(r.qty_per_person)>0?fmt.qty(r.qty_per_person).replace(/\s.*/,''):'-',
        safeNum(r.trailer_count).toLocaleString('ja-JP')
      ];
    });
    doc.autoTable({ head, body, startY: 24, styles: { fontSize: 7, cellPadding: 1 }, headStyles: { fillColor: [37,99,235] } });
    doc.save(`加工実績一覧_${dayjs().format('YYYYMMDD_HHmmss')}.pdf`);
  } catch (e) { alert('PDF出力に失敗しました: ' + e.message); }
}

function exportPDF(title, data, kind, extras = {}) {
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
      head = [['Date','Factory','Staff', ...PART_KEYS.map(k=>PART_LABELS[k]), 'Total','PerPerson','Trailer']];
      body = data.map(r => [r.date, r.factory, safeNum(r.staff_count), ...PART_KEYS.map(k=>fmt.qty(r[k]).replace(/\s.*/,'')), fmt.qty(r.total_qty).replace(/\s.*/,''), safeNum(r.qty_per_person)>0?fmt.qty(r.qty_per_person).replace(/\s.*/,''):'-', safeNum(r.trailer_count).toLocaleString('ja-JP')]);
      // 期間トレーラー合計のサマリ
      const totalTrailer = data.reduce((s,r)=>s+safeNum(r.trailer_count),0);
      doc.text(`Trailer Total: ${totalTrailer.toLocaleString('ja-JP')} dai`, 14, 26);
    } else if (kind === 'monthly') {
      head = [['Month','Factory','Days','Staff', ...PART_KEYS.map(k=>PART_LABELS[k]), 'Total','AvgDaily','PerPerson','Trailer']];
      body = data.map(r => [r.ym, r.factory, safeNum(r.days), safeNum(r.staff_count), ...PART_KEYS.map(k=>fmt.qty(r[k]).replace(/\s.*/,'')), fmt.qty(r.total_qty).replace(/\s.*/,''), fmt.qty(r.avg_daily_qty).replace(/\s.*/,''), safeNum(r.qty_per_person)>0?fmt.qty(r.qty_per_person).replace(/\s.*/,''):'-', safeNum(r.trailer_count).toLocaleString('ja-JP')]);
    } else if (kind === 'yearly') {
      head = [['Year','Factory','Days','Staff', ...PART_KEYS.map(k=>PART_LABELS[k]), 'Total','PerPerson','Trailer']];
      body = data.map(r => [r.year, r.factory, safeNum(r.days), safeNum(r.staff_count), ...PART_KEYS.map(k=>fmt.qty(r[k]).replace(/\s.*/,'')), fmt.qty(r.total_qty).replace(/\s.*/,''), safeNum(r.qty_per_person)>0?fmt.qty(r.qty_per_person).replace(/\s.*/,''):'-', safeNum(r.trailer_count).toLocaleString('ja-JP')]);
      const totalTrailer = data.reduce((s,r)=>s+safeNum(r.trailer_count),0);
      doc.text(`Trailer Total (filtered years): ${totalTrailer.toLocaleString('ja-JP')} dai`, 14, 26);
    } else {
      head = [['Month','Factory','Total']];
      body = data.map(r => [r.ym || r.year, r.factory, fmt.qty(r.total_qty).replace(/\s.*/,'')]);
    }
    doc.autoTable({ head, body, startY: 24, styles: { fontSize: 7, cellPadding: 1 }, headStyles: { fillColor: [37,99,235] } });

    // 部位別 1人工あたり加工数量 を追加 (新計算ルール: 部位別人工数 を表示)
    // 列: Part / Total Qty / Part Man-Days / Per Man-Day
    const addPartsPerMdPage = (partsData, subtitle) => {
      if (!Array.isArray(partsData) || partsData.length === 0) return;
      doc.addPage('a4', 'landscape');
      doc.setFontSize(14);
      doc.text('Parts Quantity per Man-Day (Per-Part Man-Days Method)', 14, 14);
      doc.setFontSize(9);
      doc.text(`Generated: ${dayjs().format('YYYY-MM-DD HH:mm')}  Unit: ${state.qtyUnit}`, 14, 20);
      doc.text('Formula: part_man_days = sum_over_days(total_staff * part_qty / total_qty); per_md = part_qty / part_man_days', 14, 25);
      if (subtitle) doc.text(subtitle, 14, 30);
      doc.autoTable({
        head: [['Part','Total Qty','Part Man-Days','Per Man-Day']],
        body: partsData.map(d => [
          d.part_label,
          d.total_qty > 0 ? fmt.qty(d.total_qty).replace(/\s.*/,'') : '-',
          safeNum(d.part_man_days) > 0 ? fmtManDays(d.part_man_days) : '-',
          safeNum(d.part_man_days) > 0 ? fmt.qty(d.qty_per_man_day).replace(/\s.*/,'') + '/MD' : '-'
        ]),
        startY: subtitle ? 35 : 30, styles: { fontSize: 9, cellPadding: 2 }, headStyles: { fillColor: [124,58,237] }
      });
    };

    if (extras && extras.partsPerMd) {
      addPartsPerMdPage(extras.partsPerMd, kind === 'compare' ? 'All Factories' : '');
    }
    if (extras && extras.partsPerMdHonsha) addPartsPerMdPage(extras.partsPerMdHonsha, 'Honsha Factory');
    if (extras && extras.partsPerMdDai2) addPartsPerMdPage(extras.partsPerMdDai2, 'Dai-2 Factory');

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

// ========== 統一CSV/PDF出力機構 ==========
// 5画面(加工実績一覧/日別/月別/年間/人員別)のCSV/PDF出力を統一

// 危険文字を除去してファイル名として安全にする
function _safeFileName(s) {
  return String(s || '').replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

// CSVセルエスケープ: 常にダブルクォート囲みで""" エスケープ
function _escapeCsv(v) {
  if (v == null) return '""';
  const s = String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

// 数値→文字列 (CSV用: カンマ区切りなし、単位なし)
function _csvNum(v, opts = {}) {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (!isFinite(n)) return '';
  const digits = opts.digits;
  if (typeof digits === 'number') {
    return n.toFixed(digits);
  }
  // 整数っぽければ整数、そうでなければそのまま (末尾余分0を除去)
  if (Math.floor(n) === n) return String(n);
  return String(Math.round(n * 1000) / 1000);
}

// 数値→表示用 (PDF用: カンマ区切り+単位)
function _pdfNum(v, opts = {}) {
  if (v == null || v === '') return opts.blank || '-';
  const n = Number(v);
  if (!isFinite(n)) return opts.blank || '-';
  const digits = opts.digits ?? 0;
  const unit = opts.unit ? ` ${opts.unit}` : '';
  return n.toLocaleString('ja-JP', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }) + unit;
}

// 現在の絞り込み条件を人間可読な行に整形
// filters: 各画面から渡されるオブジェクト (未指定='全〜'表示)
function _formatFilters(filters) {
  if (!filters) return [];
  const lines = [];
  const factoryLabel = (f) => {
    if (!f || f === 'all') return '全体合算';
    return f;
  };
  if (filters.dateFrom !== undefined || filters.dateTo !== undefined) {
    const from = filters.dateFrom || '';
    const to = filters.dateTo || '';
    if (from || to) {
      lines.push(`期間: ${from || '(未指定)'} 〜 ${to || '(未指定)'}`);
    } else {
      lines.push('期間: 全期間');
    }
  }
  if (filters.year !== undefined) {
    lines.push(`年: ${filters.year || '全年'}`);
  }
  if (filters.month !== undefined) {
    lines.push(`月: ${filters.month ? filters.month + '月' : '全月'}`);
  }
  if (filters.factory !== undefined) {
    lines.push(`工場: ${factoryLabel(filters.factory)}`);
  }
  if (filters.workerName !== undefined) {
    lines.push(`人員名: ${filters.workerName || '全員'}`);
  }
  if (filters.part !== undefined) {
    lines.push(`部位: ${filters.part || '全部位'}`);
  }
  lines.push(`出力日時: ${dayjs().format('YYYY/MM/DD HH:mm')}`);
  return lines;
}

// ========== 統一CSV出力 ==========
// options: { filename, columns:[{key,label,digits?,type?}], rows, filters }
//   type: 'text'|'number'|'date' (default 'text')
//   digits: 数値の小数桁 (省略時=整数扱い、小数はそのまま)
function exportCsvUnified(options) {
  const { filename, columns, rows, filters, title } = options || {};
  const dataRows = Array.isArray(rows) ? rows : [];
  if (!Array.isArray(columns) || columns.length === 0) {
    console.error('[exportCsvUnified] columns is required');
    alert('CSV出力に失敗しました: 列定義がありません');
    return;
  }
  if (dataRows.length === 0) {
    alert('出力対象のデータがありません');
    return;
  }
  try {
    const lines = [];
    // タイトル/絞り込み条件をコメントヘッダとして先頭に
    if (title) lines.push(_escapeCsv(title));
    const fLines = _formatFilters(filters);
    fLines.forEach(l => lines.push(_escapeCsv(l)));
    if (title || fLines.length > 0) lines.push(''); // 空行
    // 見出し
    lines.push(columns.map(c => _escapeCsv(c.label || c.key)).join(','));
    // 本体
    dataRows.forEach(r => {
      const cells = columns.map(c => {
        const v = r ? r[c.key] : '';
        if (c.type === 'number') return _escapeCsv(_csvNum(v, { digits: c.digits }));
        return _escapeCsv(v == null ? '' : v);
      });
      lines.push(cells.join(','));
    });
    const csvText = lines.join('\r\n');
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = _safeFileName(filename || 'export') + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    console.log('[CSV出力] ', {
      filename: a.download,
      rows: dataRows.length,
      columns: columns.length,
      filters: filters
    });
  } catch (e) {
    console.error('[exportCsvUnified] エラー', e);
    alert('CSV出力に失敗しました: ' + (e.message || '不明なエラー'));
  }
}

// ========== 日本語PDFフォントローダ ==========
// 真のTrueType形式(IPAゴシック)を同一オリジンからロードし、jsPDFに登録
// - CORS問題なし・CFF/OTFエラーなし・オフライン動作可
// 一度ロードしたらbase64を再利用 (jsPDFインスタンスごとにaddFontは必須)

let _pdfFontLoadPromise = null;
const PDF_FONT_NAME = 'NotoSansJP';
// ローカルバンドル済みTTF (真のTrueType形式、IPAゴシック相当)
// 同一オリジン配信のため CORS 不要、ブラウザキャッシュ有効
const PDF_FONT_URLS = [
  '/static/fonts/NotoSansJP-Regular.ttf'
];

// ArrayBuffer → Base64 変換
function _arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // 32KB chunks
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

async function _loadPdfJapaneseFont(doc) {
  // 各PDFインスタンスごとにVFS登録は必要だが、fetch済みbase64は再利用
  if (!_pdfFontLoadPromise) {
    _pdfFontLoadPromise = (async () => {
      let lastErr = null;
      for (const url of PDF_FONT_URLS) {
        try {
          console.log('[PDF font] fetching', url);
          const res = await fetch(url, { cache: 'force-cache' });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const buf = await res.arrayBuffer();
          if (buf.byteLength < 10000) throw new Error('font too small: ' + buf.byteLength);
          // マジックバイト確認: 00 01 00 00 が真のTrueType, 4F 54 54 4F はOTF(非対応)
          const magic = new Uint8Array(buf.slice(0, 4));
          const isTrueTTF = magic[0] === 0x00 && magic[1] === 0x01 && magic[2] === 0x00 && magic[3] === 0x00;
          if (!isTrueTTF) {
            console.warn('[PDF font] not a TrueType file, magic=', Array.from(magic).map(b=>b.toString(16).padStart(2,'0')).join(' '));
          }
          const base64 = _arrayBufferToBase64(buf);
          console.log('[PDF font] fetched', url, 'size=', buf.byteLength, 'bytes, isTrueTTF=', isTrueTTF);
          return { base64, url };
        } catch (e) {
          lastErr = e;
          console.warn('[PDF font] failed', url, e.message);
        }
      }
      throw lastErr || new Error('全てのフォントURLで取得失敗');
    })();
  }
  try {
    const { base64, url } = await _pdfFontLoadPromise;
    // jsPDFに登録 (VFS→addFont→setFont)
    const fname = 'NotoSansJP-Regular.ttf';
    doc.addFileToVFS(fname, base64);
    doc.addFont(fname, PDF_FONT_NAME, 'normal');
    doc.setFont(PDF_FONT_NAME, 'normal');
    return true;
  } catch (e) {
    console.error('[PDF font] load failed', e);
    _pdfFontLoadPromise = null; // 次回リトライ可能に
    throw e;
  }
}

// ========== 統一PDF出力 ==========
// options: {
//   title, subtitle, filename, filters,
//   sections: [{ heading, columns, rows, columnStyles }],  // 複数表を1PDFに
//   orientation: 'landscape'|'portrait'|'a3-landscape'
//   summary: [{label, value}]  タイトル直下のサマリカード相当
// }
async function exportPdfUnified(options) {
  const {
    title, subtitle, filename, filters,
    sections = [], orientation = 'landscape',
    summary = []
  } = options || {};

  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert('PDFライブラリの読込に失敗しました (jsPDF)');
    console.error('[exportPdfUnified] jsPDF未読込');
    return;
  }
  const { jsPDF } = window.jspdf;
  // 有効データチェック: 少なくとも1セクションに1行以上あるか
  const totalRows = sections.reduce((s, sec) => s + (Array.isArray(sec.rows) ? sec.rows.length : 0), 0);
  if (totalRows === 0) {
    alert('出力対象のデータがありません');
    return;
  }

  const isA3 = orientation === 'a3-landscape' || orientation === 'a3';
  const isPortrait = orientation === 'portrait';
  const doc = new jsPDF({
    orientation: isPortrait ? 'portrait' : 'landscape',
    unit: 'mm',
    format: isA3 ? 'a3' : 'a4'
  });

  // 日本語フォント読込 (失敗時はエラー表示して中断)
  try {
    await _loadPdfJapaneseFont(doc);
  } catch (e) {
    alert('PDF用日本語フォントの読み込みに失敗しました。ネットワーク環境をご確認の上、再度お試しください。\n\n' + (e.message || e));
    console.error('[exportPdfUnified] font load failed', e);
    return;
  }

  if (!doc.autoTable) {
    alert('PDFテーブル拡張の読込に失敗しました (jspdf-autotable)');
    console.error('[exportPdfUnified] autoTable未読込');
    return;
  }

  try {
    const pageW = doc.internal.pageSize.getWidth();
    const marginL = 8; // 左右余白を8mmに縮小 (仕様通り)
    let cursorY = 12;

    // タイトル — 印刷向け: 純黒で大きめに
    doc.setFont(PDF_FONT_NAME, 'normal');
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(15);
    doc.text(title || 'レポート', marginL, cursorY);
    cursorY += 6;
    if (subtitle) {
      doc.setFontSize(11);
      doc.text(subtitle, marginL, cursorY);
      cursorY += 5;
    }

    // 絞り込み条件行 — 濃いめの色で
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);
    const fLines = _formatFilters(filters);
    fLines.forEach(l => {
      doc.text(l, marginL, cursorY);
      cursorY += 4.4;
    });
    cursorY += 1;
    doc.setTextColor(0, 0, 0);

    // サマリ (集計カード相当) — 印刷向け: 値は純黒・拡大表示
    if (summary && summary.length > 0) {
      doc.setFontSize(10);
      doc.setFont(PDF_FONT_NAME, 'normal');
      // 4列で並べる
      const cols = Math.min(4, summary.length);
      const cardW = (pageW - marginL * 2 - (cols - 1) * 3) / cols;
      const cardH = 16; // 値のフォント拡大に合わせて少し高く
      for (let i = 0; i < summary.length; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const x = marginL + col * (cardW + 3);
        const y = cursorY + row * (cardH + 2);
        // カード枠と背景は少し濃いめに(印刷時の可読性)
        doc.setDrawColor(100, 100, 100);
        doc.setLineWidth(0.25);
        doc.setFillColor(240, 244, 250);
        doc.roundedRect(x, y, cardW, cardH, 1.5, 1.5, 'FD');
        // ラベル: やや濃いグレー(印刷可能な濃度)
        doc.setFontSize(9);
        doc.setTextColor(50, 50, 50);
        doc.text(String(summary[i].label || ''), x + 2.5, y + 5);
        // 値: 純黒・大きめ(印刷時に最も見える箇所)
        doc.setFontSize(13);
        doc.setTextColor(0, 0, 0);
        doc.text(String(summary[i].value || '-'), x + 2.5, y + 12);
      }
      const rowsCount = Math.ceil(summary.length / cols);
      cursorY += rowsCount * (cardH + 2) + 2;
      doc.setTextColor(0, 0, 0);
      doc.setLineWidth(0.2); // リセット
    }

    // セクション毎に autoTable
    for (let si = 0; si < sections.length; si++) {
      const sec = sections[si];
      const rows = Array.isArray(sec.rows) ? sec.rows : [];
      if (rows.length === 0 && sec.skipIfEmpty !== false) continue;

      if (sec.heading) {
        if (cursorY > doc.internal.pageSize.getHeight() - 40) {
          doc.addPage();
          cursorY = 12;
        }
        doc.setFontSize(12); // 11→12 セクション見出しを目立たせる
        doc.setFont(PDF_FONT_NAME, 'normal');
        doc.setTextColor(0, 0, 0);
        doc.text(sec.heading, marginL, cursorY);
        cursorY += 3;
      }

      const cols = sec.columns || [];
      const head = [cols.map(c => c.label || c.key)];
      const body = rows.map(r => cols.map(c => {
        const v = r ? r[c.key] : '';
        if (c.pdfRender) return c.pdfRender(v, r);
        if (c.type === 'number') {
          return _pdfNum(v, { digits: c.digits ?? 0, unit: c.unit || '' });
        }
        return v == null ? '' : String(v);
      }));

      // 列スタイル自動:
      //  - type==='number' は右揃え + 純黒
      //  - 数値以外は左揃え + 純黒
      //  - 見出しは中央揃え(headStylesで指定済)
      //  - 重要列(合計/1人工あたり/トレーラー/1日平均等)は薄い黄色背景でハイライト
      // 注意: 日本語フォント(NotoSansJP)は 'normal' しか登録していないため
      //       fontStyle:'bold' は指定しない(指定すると豆腐化する)。
      //       代わりに textColor=純黒 + 背景色ハイライト + fontSize=8 で
      //       「太字相当の視認性」を確保する。
      const HIGHLIGHT_FILL = [255, 249, 219]; // 薄い黄色: 合計・重要指標
      const isImportantKey = (k) => /^(total_qty|qty_per_person|qty_per_man_day|trailer_count|avg_daily_qty|monthly_total|yearly_total|grand_total)$/.test(String(k || ''));
      const columnStyles = {};
      const availableW = pageW - marginL * 2;
      // 指定合計幅を計算し、pageWを超える場合は比例縮小
      let totalSpecW = 0;
      cols.forEach(c => { totalSpecW += (c.width || 0); });
      const scale = (totalSpecW > 0 && totalSpecW > availableW) ? (availableW / totalSpecW) : 1;
      cols.forEach((c, i) => {
        const isNum = c.type === 'number';
        columnStyles[i] = {
          halign: isNum ? 'right' : 'left',
          textColor: [0, 0, 0] // 印刷向け: 全セル純黒
        };
        if (c.width) columnStyles[i].cellWidth = Math.max(6, Math.floor(c.width * scale * 10) / 10);
        // 重要列は薄い黄色背景で強調(太字の代替)
        if (isImportantKey(c.key)) {
          columnStyles[i].fillColor = HIGHLIGHT_FILL;
        }
        // 列独自スタイルを最後に適用(呼び出し側の指定を優先)
        if (c.style) Object.assign(columnStyles[i], c.style);
      });
      if (sec.columnStyles) Object.assign(columnStyles, sec.columnStyles);

      doc.autoTable({
        head,
        body,
        startY: cursorY + 1,
        theme: 'grid',
        tableWidth: 'auto',
        styles: {
          font: PDF_FONT_NAME,
          fontStyle: 'normal',
          fontSize: sec.fontSize || 8, // 印刷向け: デフォルト7→8にUP
          cellPadding: 1.5,             // 少し余白を広く
          overflow: 'linebreak',
          valign: 'middle',
          textColor: [0, 0, 0],         // 本文は純黒
          lineColor: [80, 80, 80],      // 罫線を濃く(180→80)
          lineWidth: 0.2,               // 罫線を太く(0.1→0.2)
          minCellWidth: 6
        },
        headStyles: {
          font: PDF_FONT_NAME,
          fontStyle: 'normal',           // 日本語フォントboldなし
          fontSize: sec.fontSize || 8,
          fillColor: sec.headColor || [37, 99, 235],
          textColor: [255, 255, 255],    // 濃青地に白抜き(印刷ハイコントラスト)
          halign: 'center',
          valign: 'middle',
          overflow: 'linebreak',
          lineColor: [30, 60, 160],      // ヘッダー枠も濃く
          lineWidth: 0.3
        },
        bodyStyles: {
          font: PDF_FONT_NAME,
          fontStyle: 'normal',
          textColor: [0, 0, 0]           // 本文は必ず純黒
        },
        alternateRowStyles: {
          fillColor: [249, 250, 252]     // 縞模様は極薄グレー(印刷しても数字が消えない濃度)
        },
        columnStyles,
        showHead: 'everyPage',
        pageBreak: 'auto',
        rowPageBreak: 'avoid',
        margin: { left: marginL, right: marginL },
        // 保険: 各セルの文字色を確実に純黒に(ライブラリのデフォルト上書き対策)
        didParseCell: function (data) {
          if (data.section === 'body') {
            data.cell.styles.textColor = data.cell.styles.textColor || [0, 0, 0];
          }
        }
      });
      cursorY = (doc.lastAutoTable && doc.lastAutoTable.finalY ? doc.lastAutoTable.finalY : cursorY) + 4;
    }

    // ページ番号 (全ページ) + 用紙情報 (左下) — 印刷向け: 濃いグレー
    const pageCount = doc.internal.getNumberOfPages();
    const paperLabel = (isA3 ? 'A3' : 'A4') + '/' + (isPortrait ? '縦' : '横');
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFont(PDF_FONT_NAME, 'normal');
      doc.setFontSize(9);            // 8→9 少し大きく
      doc.setTextColor(60, 60, 60);  // 120→60 印刷可能な濃度
      const pw = doc.internal.pageSize.getWidth();
      const ph = doc.internal.pageSize.getHeight();
      doc.text(`${p} / ${pageCount}`, pw - marginL, ph - 5, { align: 'right' });
      doc.text(paperLabel, marginL, ph - 5);
      doc.setTextColor(0, 0, 0);
    }

    doc.save(_safeFileName(filename || 'export') + '.pdf');
    console.log('[PDF出力]', {
      filename: _safeFileName(filename || 'export') + '.pdf',
      sections: sections.length,
      totalRows,
      filters
    });
  } catch (e) {
    console.error('[exportPdfUnified] エラー', e);
    alert('PDF出力に失敗しました: ' + (e.message || '不明なエラー'));
  }
}

// ========== 5画面固有のエクスポートハンドラ (統一版) ==========

// 現在の絞り込み条件を state から収集 (list画面のフィルターUIから)
function _collectListFilters() {
  return {
    dateFrom: state.dateFrom || '',
    dateTo: state.dateTo || '',
    year: state.yearFilter || '',
    month: state.monthFilter || '',
    factory: state.factoryFilter || 'all'
  };
}

// -- 加工実績一覧 --
function exportListCsvUnified() {
  const records = Array.isArray(state.records) ? state.records : [];
  const filters = _collectListFilters();
  console.log('[加工実績一覧 CSV] 画面表示件数=', records.length, ' filters=', filters);
  const rows = records.map(r => {
    const wlist = normalizeWorkersClient(r.workers, r.worker_names);
    return {
      date: r.date || '',
      factory: r.factory || '',
      staff_count: safeNum(r.staff_count),
      worker_names: wlist.map(w => w.name).join('、'),
      workers: wlist.map(w => `${w.name}（${fmtManDays(w.man_days)}）`).join('、'),
      foundation_qty: safeNum(r.foundation_qty),
      base_qty: safeNum(r.base_qty),
      column_qty: safeNum(r.column_qty),
      beam_qty: safeNum(r.beam_qty),
      fukashi_qty: safeNum(r.fukashi_qty),
      slab_qty: safeNum(r.slab_qty),
      doma_qty: safeNum(r.doma_qty),
      civil_qty: safeNum(r.civil_qty),
      wooden_qty: safeNum(r.wooden_qty),
      other_qty: safeNum(r.other_qty),
      total_qty: safeNum(r.total_qty),
      qty_per_person: safeNum(r.qty_per_person),
      trailer_count: safeNum(r.trailer_count),
      note: r.note || ''
    };
  });
  const columns = [
    { key: 'date', label: '日付' },
    { key: 'factory', label: '工場区分' },
    { key: 'staff_count', label: '人工合計', type: 'number', digits: 3 },
    { key: 'workers', label: '人員名（人工）' },
    { key: 'foundation_qty', label: '基礎（kg）', type: 'number' },
    { key: 'base_qty', label: 'ベース（kg）', type: 'number' },
    { key: 'column_qty', label: '柱（kg）', type: 'number' },
    { key: 'beam_qty', label: '梁（kg）', type: 'number' },
    { key: 'fukashi_qty', label: '壁（kg）', type: 'number' },
    { key: 'slab_qty', label: 'スラブ（kg）', type: 'number' },
    { key: 'doma_qty', label: '土間（kg）', type: 'number' },
    { key: 'civil_qty', label: '土木（kg）', type: 'number' },
    { key: 'wooden_qty', label: '木造（kg）', type: 'number' },
    { key: 'other_qty', label: 'その他（kg）', type: 'number' },
    { key: 'total_qty', label: '総加工数量（kg）', type: 'number' },
    { key: 'qty_per_person', label: '1人工あたり加工数量（kg/人工）', type: 'number', digits: 1 },
    { key: 'trailer_count', label: 'トレーラー台数（台）', type: 'number' },
    { key: 'note', label: '備考' }
  ];
  const fname = `加工実績一覧_${filters.dateFrom || '全期間'}_${filters.dateTo || ''}_${filters.factory === 'all' ? '全体合算' : filters.factory}`;
  exportCsvUnified({
    filename: fname,
    title: '加工実績一覧',
    columns, rows, filters
  });
}

async function exportListPdfUnified() {
  const records = Array.isArray(state.records) ? state.records : [];
  const filters = _collectListFilters();
  console.log('[加工実績一覧 PDF] 画面表示件数=', records.length, ' filters=', filters);
  if (records.length === 0) { alert('出力対象のデータがありません'); return; }

  // 共通データ整形
  const rows = records.map(r => {
    const wlist = normalizeWorkersClient(r.workers, r.worker_names);
    return {
      date: r.date || '',
      factory: r.factory || '',
      staff_count: safeNum(r.staff_count),
      workers: wlist.length ? wlist.map(w => `${w.name}（${fmtManDays(w.man_days)}）`).join('、') : '-',
      foundation_qty: safeNum(r.foundation_qty),
      base_qty: safeNum(r.base_qty),
      column_qty: safeNum(r.column_qty),
      beam_qty: safeNum(r.beam_qty),
      fukashi_qty: safeNum(r.fukashi_qty),
      slab_qty: safeNum(r.slab_qty),
      doma_qty: safeNum(r.doma_qty),
      civil_qty: safeNum(r.civil_qty),
      wooden_qty: safeNum(r.wooden_qty),
      other_qty: safeNum(r.other_qty),
      total_qty: safeNum(r.total_qty),
      qty_per_person: safeNum(r.qty_per_person),
      trailer_count: safeNum(r.trailer_count),
      note: r.note || ''
    };
  });

  // 表1: 基本情報 (A3横向き=420mm、余白8+8=16mm、有効幅≈404mm)
  const table1Cols = [
    { key: 'date', label: '日付', width: 26 },
    { key: 'factory', label: '工場', width: 26 },
    { key: 'staff_count', label: '人工計', type: 'number', digits: 3, width: 22 },
    { key: 'workers', label: '人員（人工）', width: 120 },
    { key: 'total_qty', label: '総加工量(kg)', type: 'number', width: 30 },
    { key: 'qty_per_person', label: '1人工あたり', type: 'number', digits: 1, width: 30 },
    { key: 'trailer_count', label: 'ﾄﾚｰﾗｰ(台)', type: 'number', width: 24 },
    { key: 'note', label: '備考', width: 120 }
  ];
  // 表2: 部位別加工数量
  const table2Cols = [
    { key: 'date', label: '日付', width: 26 },
    { key: 'factory', label: '工場', width: 26 },
    { key: 'foundation_qty', label: '基礎', type: 'number', width: 32 },
    { key: 'base_qty', label: 'ベース', type: 'number', width: 32 },
    { key: 'column_qty', label: '柱', type: 'number', width: 32 },
    { key: 'beam_qty', label: '梁', type: 'number', width: 32 },
    { key: 'fukashi_qty', label: '壁', type: 'number', width: 32 },
    { key: 'slab_qty', label: 'スラブ', type: 'number', width: 32 },
    { key: 'doma_qty', label: '土間', type: 'number', width: 32 },
    { key: 'civil_qty', label: '土木', type: 'number', width: 32 },
    { key: 'wooden_qty', label: '木造', type: 'number', width: 32 },
    { key: 'other_qty', label: 'その他', type: 'number', width: 32 }
  ];

  const fname = `加工実績一覧_${filters.dateFrom || '全期間'}_${filters.dateTo || ''}_${filters.factory === 'all' ? '全体合算' : filters.factory}`;
  await exportPdfUnified({
    title: '加工実績一覧',
    filename: fname,
    filters,
    orientation: 'a3-landscape',
    sections: [
      { heading: '表1：基本情報', columns: table1Cols, rows, fontSize: 8 },
      { heading: '表2：部位別加工数量（kg）', columns: table2Cols, rows, fontSize: 8, headColor: [124, 58, 237] }
    ]
  });
}

// -- 日別分析 --
// dailyData/dailyPartsPerMd をキャッシュしておく
let _dailyCache = { data: [], parts: [], filters: {} };
function _stashDailyCache(data, parts, filters) {
  _dailyCache = {
    data: Array.isArray(data) ? data.slice() : [],
    parts: Array.isArray(parts) ? parts.slice() : [],
    filters: filters || {}
  };
}
function exportDailyCsvUnified() {
  const { data, parts, filters } = _dailyCache;
  console.log('[日別分析 CSV] 画面表示件数=', data.length, ' filters=', filters);
  if (data.length === 0) { alert('出力対象のデータがありません'); return; }
  const totalQty = data.reduce((s, r) => s + safeNum(r.total_qty), 0);
  const totalMd = data.reduce((s, r) => s + safeNum(r.staff_count), 0);
  const totalTrailer = data.reduce((s, r) => s + safeNum(r.trailer_count), 0);

  // 集計サマリを先頭付きの CSV に (data + サマリ行)
  // メイン: 日別一覧
  const columns = [
    { key: 'date', label: '日付' },
    { key: 'factory', label: '工場区分' },
    { key: 'staff_count', label: '人工合計', type: 'number', digits: 3 },
    { key: 'foundation_qty', label: '基礎（kg）', type: 'number' },
    { key: 'base_qty', label: 'ベース（kg）', type: 'number' },
    { key: 'column_qty', label: '柱（kg）', type: 'number' },
    { key: 'beam_qty', label: '梁（kg）', type: 'number' },
    { key: 'fukashi_qty', label: '壁（kg）', type: 'number' },
    { key: 'slab_qty', label: 'スラブ（kg）', type: 'number' },
    { key: 'doma_qty', label: '土間（kg）', type: 'number' },
    { key: 'civil_qty', label: '土木（kg）', type: 'number' },
    { key: 'wooden_qty', label: '木造（kg）', type: 'number' },
    { key: 'other_qty', label: 'その他（kg）', type: 'number' },
    { key: 'total_qty', label: '総加工数量（kg）', type: 'number' },
    { key: 'qty_per_person', label: '1人工あたり加工数量（kg/人工）', type: 'number', digits: 1 },
    { key: 'trailer_count', label: 'トレーラー台数（台）', type: 'number' }
  ];
  const rows = data.map(r => ({
    ...r,
    staff_count: safeNum(r.staff_count),
    total_qty: safeNum(r.total_qty),
    qty_per_person: safeNum(r.qty_per_person),
    trailer_count: safeNum(r.trailer_count)
  }));

  // 部位別1人工あたり (別セクション)
  const partsColumns = [
    { key: 'part_label', label: '部位' },
    { key: 'total_qty', label: '部位別総加工数量（kg）', type: 'number' },
    { key: 'part_man_days', label: '部位別人工数', type: 'number', digits: 3 },
    { key: 'qty_per_man_day', label: '1人工あたり加工数量（kg/人工）', type: 'number', digits: 1 }
  ];
  const partsRows = (parts || []).map(p => ({
    part_label: p.part_label,
    total_qty: safeNum(p.total_qty),
    part_man_days: safeNum(p.part_man_days),
    qty_per_man_day: safeNum(p.qty_per_man_day)
  }));

  // 集計サマリを1行目に含めるため、rowsに集計行を追加せず、CSV先頭のtitle以下にfilterで表示 + 追加サマリ列を別途
  // シンプルにするためメイン一覧のみ / 部位別を別ファイルで
  const fname = `日別分析_${filters.dateFrom || '全期間'}_${filters.dateTo || ''}_${filters.factory === 'all' ? '全体合算' : filters.factory}`;
  exportCsvUnified({
    filename: fname + '_日別一覧',
    title: `日別分析 - 日別一覧 (集計: 総加工量=${_csvNum(totalQty)}kg / 総人工=${_csvNum(totalMd, {digits:3})} / トレーラー合計=${_csvNum(totalTrailer)}台)`,
    columns, rows, filters
  });
  if (partsRows.length > 0) {
    exportCsvUnified({
      filename: fname + '_部位別1人工あたり',
      title: '日別分析 - 部位別1人工あたり加工数量',
      columns: partsColumns,
      rows: partsRows,
      filters
    });
  }
}

async function exportDailyPdfUnified() {
  const { data, parts, filters } = _dailyCache;
  console.log('[日別分析 PDF] 画面表示件数=', data.length, ' filters=', filters);
  if (data.length === 0) { alert('出力対象のデータがありません'); return; }
  const totalQty = data.reduce((s, r) => s + safeNum(r.total_qty), 0);
  const totalMd = data.reduce((s, r) => s + safeNum(r.staff_count), 0);
  const perMd = totalMd > 0 ? totalQty / totalMd : 0;
  const totalTrailer = data.reduce((s, r) => s + safeNum(r.trailer_count), 0);

  const rows = data.map(r => ({
    ...r,
    staff_count: safeNum(r.staff_count),
    total_qty: safeNum(r.total_qty),
    qty_per_person: safeNum(r.qty_per_person),
    trailer_count: safeNum(r.trailer_count)
  }));

  // 表1: 日別基本集計 (A4横向きに収まる列数)
  const table1Cols = [
    { key: 'date', label: '日付', width: 30 },
    { key: 'factory', label: '工場', width: 32 },
    { key: 'staff_count', label: '総人工', type: 'number', digits: 3, width: 26 },
    { key: 'total_qty', label: '総加工数量(kg)', type: 'number', width: 36 },
    { key: 'qty_per_person', label: '1人工あたり', type: 'number', digits: 1, width: 34 },
    { key: 'trailer_count', label: 'ﾄﾚｰﾗｰ台数', type: 'number', width: 28 }
  ];

  // 表2: 日別部位別数量 (A3横向きが安全)
  const table2Cols = [
    { key: 'date', label: '日付', width: 26 },
    { key: 'factory', label: '工場', width: 28 },
    { key: 'foundation_qty', label: '基礎', type: 'number', width: 34 },
    { key: 'base_qty', label: 'ベース', type: 'number', width: 34 },
    { key: 'column_qty', label: '柱', type: 'number', width: 34 },
    { key: 'beam_qty', label: '梁', type: 'number', width: 34 },
    { key: 'fukashi_qty', label: '壁', type: 'number', width: 34 },
    { key: 'slab_qty', label: 'スラブ', type: 'number', width: 34 },
    { key: 'doma_qty', label: '土間', type: 'number', width: 34 },
    { key: 'civil_qty', label: '土木', type: 'number', width: 34 },
    { key: 'wooden_qty', label: '木造', type: 'number', width: 34 },
    { key: 'other_qty', label: 'その他', type: 'number', width: 34 }
  ];

  const sections = [
    { heading: '表1：日別基本集計', columns: table1Cols, rows, fontSize: 8 },
    { heading: '表2：日別部位別数量（kg）', columns: table2Cols, rows, fontSize: 8, headColor: [16, 129, 96] }
  ];
  if (parts && parts.length > 0) {
    sections.push({
      heading: '表3：部位別 1人工あたり加工数量',
      columns: [
        { key: 'part_label', label: '部位', width: 40 },
        { key: 'total_qty', label: '総加工量(kg)', type: 'number', width: 50 },
        { key: 'part_man_days', label: '部位別人工数', type: 'number', digits: 3, width: 40 },
        { key: 'qty_per_man_day', label: '1人工あたり(kg/人工)', type: 'number', digits: 1, width: 50 }
      ],
      rows: parts.map(p => ({
        part_label: p.part_label,
        total_qty: safeNum(p.total_qty),
        part_man_days: safeNum(p.part_man_days),
        qty_per_man_day: safeNum(p.qty_per_man_day)
      })),
      fontSize: 9,
      headColor: [124, 58, 237]
    });
  }

  const fname = `日別分析_${filters.dateFrom || '全期間'}_${filters.dateTo || ''}_${filters.factory === 'all' ? '全体合算' : filters.factory}`;
  await exportPdfUnified({
    title: '日別分析レポート',
    filename: fname,
    filters,
    orientation: 'a3-landscape',
    summary: [
      { label: '加工総数量', value: _pdfNum(totalQty, { unit: 'kg' }) },
      { label: '総人工', value: _pdfNum(totalMd, { digits: 3, unit: '人工' }) },
      { label: '1人工あたり', value: totalMd > 0 ? _pdfNum(perMd, { digits: 1, unit: 'kg/人工' }) : '-' },
      { label: 'トレーラー合計', value: _pdfNum(totalTrailer, { unit: '台' }) }
    ],
    sections
  });
}

// -- 月別分析 --
let _monthlyCache = { data: [], parts: [], filters: {} };
function _stashMonthlyCache(data, parts, filters) {
  _monthlyCache = {
    data: Array.isArray(data) ? data.slice() : [],
    parts: Array.isArray(parts) ? parts.slice() : [],
    filters: filters || {}
  };
}
function exportMonthlyCsvUnified() {
  const { data, parts, filters } = _monthlyCache;
  console.log('[月別分析 CSV] 画面表示件数=', data.length, ' filters=', filters);
  if (data.length === 0) { alert('出力対象のデータがありません'); return; }

  const columns = [
    { key: 'ym', label: '年月' },
    { key: 'factory', label: '工場区分' },
    { key: 'days', label: '稼働日数', type: 'number' },
    { key: 'staff_count', label: '総人工', type: 'number', digits: 3 },
    { key: 'foundation_qty', label: '基礎（kg）', type: 'number' },
    { key: 'base_qty', label: 'ベース（kg）', type: 'number' },
    { key: 'column_qty', label: '柱（kg）', type: 'number' },
    { key: 'beam_qty', label: '梁（kg）', type: 'number' },
    { key: 'fukashi_qty', label: '壁（kg）', type: 'number' },
    { key: 'slab_qty', label: 'スラブ（kg）', type: 'number' },
    { key: 'doma_qty', label: '土間（kg）', type: 'number' },
    { key: 'civil_qty', label: '土木（kg）', type: 'number' },
    { key: 'wooden_qty', label: '木造（kg）', type: 'number' },
    { key: 'other_qty', label: 'その他（kg）', type: 'number' },
    { key: 'total_qty', label: '月間総加工数量（kg）', type: 'number' },
    { key: 'avg_daily_qty', label: '1日平均（kg）', type: 'number', digits: 1 },
    { key: 'qty_per_person', label: '1人工あたり加工数量（kg/人工）', type: 'number', digits: 1 },
    { key: 'trailer_count', label: 'トレーラー台数（台）', type: 'number' }
  ];
  const rows = data.map(r => ({
    ym: r.ym,
    factory: r.factory,
    days: safeNum(r.days),
    staff_count: safeNum(r.staff_count),
    foundation_qty: safeNum(r.foundation_qty),
    base_qty: safeNum(r.base_qty),
    column_qty: safeNum(r.column_qty),
    beam_qty: safeNum(r.beam_qty),
    fukashi_qty: safeNum(r.fukashi_qty),
    slab_qty: safeNum(r.slab_qty),
    doma_qty: safeNum(r.doma_qty),
    civil_qty: safeNum(r.civil_qty),
    wooden_qty: safeNum(r.wooden_qty),
    other_qty: safeNum(r.other_qty),
    total_qty: safeNum(r.total_qty),
    avg_daily_qty: safeNum(r.avg_daily_qty),
    qty_per_person: safeNum(r.qty_per_person),
    trailer_count: safeNum(r.trailer_count)
  }));

  const fname = `月別分析_${filters.year || '全年'}年_${filters.factory === 'all' ? '全体合算' : filters.factory}`;
  exportCsvUnified({
    filename: fname,
    title: '月別分析',
    columns, rows, filters
  });
  if (parts && parts.length > 0) {
    exportCsvUnified({
      filename: fname + '_部位別1人工あたり',
      title: '月別分析 - 部位別1人工あたり加工数量',
      columns: [
        { key: 'part_label', label: '部位' },
        { key: 'total_qty', label: '部位別総加工数量（kg）', type: 'number' },
        { key: 'part_man_days', label: '部位別人工数', type: 'number', digits: 3 },
        { key: 'qty_per_man_day', label: '1人工あたり加工数量（kg/人工）', type: 'number', digits: 1 }
      ],
      rows: parts.map(p => ({
        part_label: p.part_label,
        total_qty: safeNum(p.total_qty),
        part_man_days: safeNum(p.part_man_days),
        qty_per_man_day: safeNum(p.qty_per_man_day)
      })),
      filters
    });
  }
}

async function exportMonthlyPdfUnified() {
  const { data, parts, filters } = _monthlyCache;
  console.log('[月別分析 PDF] 画面表示件数=', data.length, ' filters=', filters);
  if (data.length === 0) { alert('出力対象のデータがありません'); return; }
  const totalQty = data.reduce((s, r) => s + safeNum(r.total_qty), 0);
  const totalMd = data.reduce((s, r) => s + safeNum(r.staff_count), 0);
  const totalTrailer = data.reduce((s, r) => s + safeNum(r.trailer_count), 0);

  const rows = data.map(r => ({
    ym: r.ym,
    factory: r.factory,
    days: safeNum(r.days),
    staff_count: safeNum(r.staff_count),
    foundation_qty: safeNum(r.foundation_qty),
    base_qty: safeNum(r.base_qty),
    column_qty: safeNum(r.column_qty),
    beam_qty: safeNum(r.beam_qty),
    fukashi_qty: safeNum(r.fukashi_qty),
    slab_qty: safeNum(r.slab_qty),
    doma_qty: safeNum(r.doma_qty),
    civil_qty: safeNum(r.civil_qty),
    wooden_qty: safeNum(r.wooden_qty),
    other_qty: safeNum(r.other_qty),
    total_qty: safeNum(r.total_qty),
    avg_daily_qty: safeNum(r.avg_daily_qty),
    qty_per_person: safeNum(r.qty_per_person),
    trailer_count: safeNum(r.trailer_count)
  }));

  // 表1: 基本集計 (A4横向きに収まる)
  const table1Cols = [
    { key: 'ym', label: '年月', width: 22 },
    { key: 'factory', label: '工場', width: 28 },
    { key: 'days', label: '稼働日', type: 'number', width: 20 },
    { key: 'staff_count', label: '総人工', type: 'number', digits: 3, width: 22 },
    { key: 'trailer_count', label: 'ﾄﾚｰﾗｰ台数', type: 'number', width: 24, style: { fillColor: [255, 251, 235] } },
    { key: 'total_qty', label: '月間合計(kg)', type: 'number', width: 34 },
    { key: 'avg_daily_qty', label: '1日平均', type: 'number', digits: 1, width: 30 },
    { key: 'qty_per_person', label: '1人工あたり', type: 'number', digits: 1, width: 32 }
  ];

  // 表2: 部位別加工数量 (A3横向きが安全)
  const table2Cols = [
    { key: 'ym', label: '年月', width: 24 },
    { key: 'factory', label: '工場', width: 28 },
    { key: 'foundation_qty', label: '基礎', type: 'number', width: 32 },
    { key: 'base_qty', label: 'ベース', type: 'number', width: 32 },
    { key: 'column_qty', label: '柱', type: 'number', width: 32 },
    { key: 'beam_qty', label: '梁', type: 'number', width: 32 },
    { key: 'fukashi_qty', label: '壁', type: 'number', width: 32 },
    { key: 'slab_qty', label: 'スラブ', type: 'number', width: 32 },
    { key: 'doma_qty', label: '土間', type: 'number', width: 32 },
    { key: 'civil_qty', label: '土木', type: 'number', width: 32 },
    { key: 'wooden_qty', label: '木造', type: 'number', width: 32 },
    { key: 'other_qty', label: 'その他', type: 'number', width: 32 }
  ];

  // 表3(新): 月別・部位別構成比(%) — 各月の月間合計を分母に、既存 rows データから算出
  // 分母は「その月の月間合計 = total_qty」であり、レポート全期間の totalQty ではない。
  // 各部位の構成比 = その月の各部位加工数量 ÷ その月の総加工数量 × 100
  // 月間合計が 0 の場合はゼロ除算を避けて全部位 0.0%、合計列も 0.0% とする。
  // 月間合計 > 0 の場合、合計列は表示値の単純和ではなく必ず 100.0% を表示する
  // (小数第1位への丸め差で 99.9% や 100.1% になっても、合計列は 100.0% 固定)。
  const partKeys = [
    ['foundation_qty', '基礎'],
    ['base_qty',       'ベース'],
    ['column_qty',     '柱'],
    ['beam_qty',       '梁'],
    ['fukashi_qty',    '壁'],
    ['slab_qty',       'スラブ'],
    ['doma_qty',       '土間'],
    ['civil_qty',      '土木'],
    ['wooden_qty',     '木造'],
    ['other_qty',      'その他']
  ];
  const monthlyShareRows = rows.map(r => {
    const mTotal = safeNum(r.total_qty);
    const o = { ym: r.ym, factory: r.factory };
    partKeys.forEach(([k]) => {
      o[k + '_pct'] = mTotal > 0 ? (safeNum(r[k]) / mTotal * 100) : 0;
    });
    // 合計列: 月間合計>0なら常に100.0%、0なら0.0%
    o.total_pct = mTotal > 0 ? 100 : 0;
    return o;
  });
  const table3Cols = [
    { key: 'ym',      label: '年月', width: 22 },
    { key: 'factory', label: '工場', width: 26 },
    ...partKeys.map(([k, label]) => ({
      key: k + '_pct',
      label,
      type: 'number',
      width: 26,
      pdfRender: (v) => safeNum(v).toFixed(1) + '%'
    })),
    {
      key: 'total_pct',
      label: '合計',
      type: 'number',
      width: 26,
      pdfRender: (v) => safeNum(v).toFixed(1) + '%'
    }
  ];

  const sections = [
    { heading: '表1：基本集計', columns: table1Cols, rows, fontSize: 8 },
    { heading: '表2：部位別加工数量（kg）', columns: table2Cols, rows, fontSize: 8, headColor: [16, 129, 96] },
    { heading: '表3：月別・部位別構成比（%）', columns: table3Cols, rows: monthlyShareRows, fontSize: 8, headColor: [217, 119, 6] }
  ];
  if (parts && parts.length > 0) {
    // 表4: 部位別 1人工あたり加工数量 (レポート全期間の総加工量を分母とする構成比を含む)
    // 分母 = レポート全期間の総加工量 (既存 totalQty を再利用、再集計しない)
    // 月別構成比(表3)とは分母が異なるため混同しないこと
    const grandForShare = safeNum(totalQty);
    const partRows = parts.map(p => {
      const q = safeNum(p.total_qty);
      const share = grandForShare > 0 ? (q / grandForShare * 100) : 0;
      return {
        part_label: p.part_label,
        total_qty: q,
        share_pct: share,
        part_man_days: safeNum(p.part_man_days),
        qty_per_man_day: safeNum(p.qty_per_man_day)
      };
    });
    sections.push({
      heading: '表4：部位別 1人工あたり加工数量',
      columns: [
        { key: 'part_label',      label: '部位',                width: 34 },
        { key: 'total_qty',       label: '総加工量(kg)',        type: 'number', width: 42 },
        {
          key: 'share_pct',
          label: '構成比(%)',
          type: 'number',
          width: 30,
          // 数値のみ表示(棒グラフ・背景色なし、他の数値列と同一スタイル)
          pdfRender: (v) => safeNum(v).toFixed(1) + '%'
        },
        { key: 'part_man_days',   label: '部位別人工数',        type: 'number', digits: 3, width: 42 },
        { key: 'qty_per_man_day', label: '1人工あたり(kg/人工)', type: 'number', digits: 1, width: 50 }
      ],
      rows: partRows,
      fontSize: 9,
      headColor: [124, 58, 237]
    });
  }
  const fname = `月別分析_${filters.year || '全年'}年_${filters.factory === 'all' ? '全体合算' : filters.factory}`;
  await exportPdfUnified({
    title: '月別分析レポート',
    filename: fname,
    filters,
    orientation: 'a3-landscape',
    summary: [
      { label: '総加工数量', value: _pdfNum(totalQty, { unit: 'kg' }) },
      { label: '総人工', value: _pdfNum(totalMd, { digits: 3, unit: '人工' }) },
      { label: 'トレーラー合計', value: _pdfNum(totalTrailer, { unit: '台' }) },
      { label: '対象月数', value: `${data.length} 行` }
    ],
    sections
  });
}

// -- 年間分析 --
let _yearlyCache = { data: [], monthly: [], parts: [], trendYear: '', filters: {} };
function _stashYearlyCache(data, monthly, parts, trendYear, filters) {
  _yearlyCache = {
    data: Array.isArray(data) ? data.slice() : [],
    monthly: Array.isArray(monthly) ? monthly.slice() : [],
    parts: Array.isArray(parts) ? parts.slice() : [],
    trendYear: trendYear || '',
    filters: filters || {}
  };
}
function exportYearlyCsvUnified() {
  const { data, monthly, parts, trendYear, filters } = _yearlyCache;
  console.log('[年間分析 CSV] 画面表示件数=', data.length, ' filters=', filters);
  if (data.length === 0) { alert('出力対象のデータがありません'); return; }

  const yearlyCols = [
    { key: 'year', label: '年' },
    { key: 'factory', label: '工場区分' },
    { key: 'days', label: '稼働日数', type: 'number' },
    { key: 'staff_count', label: '総人工', type: 'number', digits: 3 },
    { key: 'foundation_qty', label: '基礎（kg）', type: 'number' },
    { key: 'base_qty', label: 'ベース（kg）', type: 'number' },
    { key: 'column_qty', label: '柱（kg）', type: 'number' },
    { key: 'beam_qty', label: '梁（kg）', type: 'number' },
    { key: 'fukashi_qty', label: '壁（kg）', type: 'number' },
    { key: 'slab_qty', label: 'スラブ（kg）', type: 'number' },
    { key: 'doma_qty', label: '土間（kg）', type: 'number' },
    { key: 'civil_qty', label: '土木（kg）', type: 'number' },
    { key: 'wooden_qty', label: '木造（kg）', type: 'number' },
    { key: 'other_qty', label: 'その他（kg）', type: 'number' },
    { key: 'total_qty', label: '年間総加工数量（kg）', type: 'number' },
    { key: 'qty_per_person', label: '1人工あたり加工数量（kg/人工）', type: 'number', digits: 1 },
    { key: 'trailer_count', label: '年間トレーラー台数（台）', type: 'number' }
  ];
  const yearlyRows = data.map(r => ({
    year: r.year,
    factory: r.factory,
    days: safeNum(r.days),
    staff_count: safeNum(r.staff_count),
    foundation_qty: safeNum(r.foundation_qty),
    base_qty: safeNum(r.base_qty),
    column_qty: safeNum(r.column_qty),
    beam_qty: safeNum(r.beam_qty),
    fukashi_qty: safeNum(r.fukashi_qty),
    slab_qty: safeNum(r.slab_qty),
    doma_qty: safeNum(r.doma_qty),
    civil_qty: safeNum(r.civil_qty),
    wooden_qty: safeNum(r.wooden_qty),
    other_qty: safeNum(r.other_qty),
    total_qty: safeNum(r.total_qty),
    qty_per_person: safeNum(r.qty_per_person),
    trailer_count: safeNum(r.trailer_count)
  }));
  const fname = `年間分析_${trendYear || '全年'}年_${filters.factory === 'all' ? '全体合算' : filters.factory}`;
  exportCsvUnified({
    filename: fname,
    title: '年間分析',
    columns: yearlyCols, rows: yearlyRows, filters
  });

  // 月別トレーラー台数推移 (別ファイル)
  if (trendYear && monthly && monthly.length > 0) {
    const monthlyByYm = {};
    monthly.forEach(m => {
      if (!monthlyByYm[m.ym]) monthlyByYm[m.ym] = { total_qty: 0, trailer_count: 0 };
      monthlyByYm[m.ym].total_qty += safeNum(m.total_qty);
      monthlyByYm[m.ym].trailer_count += safeNum(m.trailer_count);
    });
    const trendRows = Array.from({length: 12}, (_, i) => {
      const ym = `${trendYear}-${String(i+1).padStart(2, '0')}`;
      const r = monthlyByYm[ym] || { total_qty: 0, trailer_count: 0 };
      return {
        month: `${i+1}月`,
        total_qty: safeNum(r.total_qty),
        trailer_count: safeNum(r.trailer_count)
      };
    });
    exportCsvUnified({
      filename: fname + '_月別推移',
      title: `年間分析 - ${trendYear}年 月別トレーラー台数・加工量推移`,
      columns: [
        { key: 'month', label: '月' },
        { key: 'total_qty', label: '月間加工量（kg）', type: 'number' },
        { key: 'trailer_count', label: 'トレーラー台数（台）', type: 'number' }
      ],
      rows: trendRows,
      filters
    });
  }
  if (parts && parts.length > 0) {
    exportCsvUnified({
      filename: fname + '_部位別1人工あたり',
      title: '年間分析 - 部位別1人工あたり加工数量',
      columns: [
        { key: 'part_label', label: '部位' },
        { key: 'total_qty', label: '部位別総加工数量（kg）', type: 'number' },
        { key: 'part_man_days', label: '部位別人工数', type: 'number', digits: 3 },
        { key: 'qty_per_man_day', label: '1人工あたり加工数量（kg/人工）', type: 'number', digits: 1 }
      ],
      rows: parts.map(p => ({
        part_label: p.part_label,
        total_qty: safeNum(p.total_qty),
        part_man_days: safeNum(p.part_man_days),
        qty_per_man_day: safeNum(p.qty_per_man_day)
      })),
      filters
    });
  }
}

async function exportYearlyPdfUnified() {
  const { data, monthly, parts, trendYear, filters } = _yearlyCache;
  console.log('[年間分析 PDF] 画面表示件数=', data.length, ' filters=', filters);
  if (data.length === 0) { alert('出力対象のデータがありません'); return; }
  const totalQty = data.reduce((s, r) => s + safeNum(r.total_qty), 0);
  const totalMd = data.reduce((s, r) => s + safeNum(r.staff_count), 0);
  const totalTrailer = data.reduce((s, r) => s + safeNum(r.trailer_count), 0);

  const rows = data.map(r => ({
    year: r.year,
    factory: r.factory,
    days: safeNum(r.days),
    staff_count: safeNum(r.staff_count),
    foundation_qty: safeNum(r.foundation_qty),
    base_qty: safeNum(r.base_qty),
    column_qty: safeNum(r.column_qty),
    beam_qty: safeNum(r.beam_qty),
    fukashi_qty: safeNum(r.fukashi_qty),
    slab_qty: safeNum(r.slab_qty),
    doma_qty: safeNum(r.doma_qty),
    civil_qty: safeNum(r.civil_qty),
    wooden_qty: safeNum(r.wooden_qty),
    other_qty: safeNum(r.other_qty),
    total_qty: safeNum(r.total_qty),
    qty_per_person: safeNum(r.qty_per_person),
    trailer_count: safeNum(r.trailer_count)
  }));

  // 表1: 年間基本集計
  const table1Cols = [
    { key: 'year', label: '年', width: 22 },
    { key: 'factory', label: '工場', width: 30 },
    { key: 'days', label: '稼働日', type: 'number', width: 22 },
    { key: 'staff_count', label: '総人工', type: 'number', digits: 3, width: 26 },
    { key: 'total_qty', label: '年間合計(kg)', type: 'number', width: 38 },
    { key: 'qty_per_person', label: '1人工あたり', type: 'number', digits: 1, width: 34 },
    { key: 'trailer_count', label: '年間ﾄﾚｰﾗｰ台数', type: 'number', width: 34, style: { fillColor: [255, 251, 235] } }
  ];

  // 表2: 年間部位別加工数量
  const table2Cols = [
    { key: 'year', label: '年', width: 22 },
    { key: 'factory', label: '工場', width: 28 },
    { key: 'foundation_qty', label: '基礎', type: 'number', width: 32 },
    { key: 'base_qty', label: 'ベース', type: 'number', width: 32 },
    { key: 'column_qty', label: '柱', type: 'number', width: 32 },
    { key: 'beam_qty', label: '梁', type: 'number', width: 32 },
    { key: 'fukashi_qty', label: '壁', type: 'number', width: 32 },
    { key: 'slab_qty', label: 'スラブ', type: 'number', width: 32 },
    { key: 'doma_qty', label: '土間', type: 'number', width: 32 },
    { key: 'civil_qty', label: '土木', type: 'number', width: 32 },
    { key: 'wooden_qty', label: '木造', type: 'number', width: 32 },
    { key: 'other_qty', label: 'その他', type: 'number', width: 32 }
  ];

  const sections = [
    { heading: '表1：年間基本集計', columns: table1Cols, rows, fontSize: 9 },
    { heading: '表2：年間部位別加工数量（kg）', columns: table2Cols, rows, fontSize: 9, headColor: [16, 129, 96] }
  ];

  // 表3: 月別推移
  if (trendYear && monthly && monthly.length > 0) {
    const monthlyByYm = {};
    monthly.forEach(m => {
      if (!monthlyByYm[m.ym]) monthlyByYm[m.ym] = { total_qty: 0, staff_count: 0, trailer_count: 0 };
      monthlyByYm[m.ym].total_qty += safeNum(m.total_qty);
      monthlyByYm[m.ym].staff_count += safeNum(m.staff_count);
      monthlyByYm[m.ym].trailer_count += safeNum(m.trailer_count);
    });
    const trendRows = Array.from({length: 12}, (_, i) => {
      const ym = `${trendYear}-${String(i+1).padStart(2, '0')}`;
      const r = monthlyByYm[ym] || { total_qty: 0, staff_count: 0, trailer_count: 0 };
      const perMd = r.staff_count > 0 ? r.total_qty / r.staff_count : 0;
      return {
        month: `${i+1}月`,
        total_qty: safeNum(r.total_qty),
        staff_count: safeNum(r.staff_count),
        qty_per_person: perMd,
        trailer_count: safeNum(r.trailer_count)
      };
    });
    sections.push({
      heading: `表3：${trendYear}年 月別推移`,
      columns: [
        { key: 'month', label: '月', width: 30 },
        { key: 'total_qty', label: '加工数量(kg)', type: 'number', width: 60 },
        { key: 'staff_count', label: '総人工', type: 'number', digits: 3, width: 50 },
        { key: 'qty_per_person', label: '1人工あたり', type: 'number', digits: 1, width: 50 },
        { key: 'trailer_count', label: 'ﾄﾚｰﾗｰ台数', type: 'number', width: 50 }
      ],
      rows: trendRows,
      fontSize: 9,
      headColor: [217, 119, 6]
    });
  }

  if (parts && parts.length > 0) {
    sections.push({
      heading: '表4：部位別 1人工あたり加工数量（年間累計）',
      columns: [
        { key: 'part_label', label: '部位', width: 40 },
        { key: 'total_qty', label: '総加工量(kg)', type: 'number', width: 50 },
        { key: 'part_man_days', label: '部位別人工数', type: 'number', digits: 3, width: 40 },
        { key: 'qty_per_man_day', label: '1人工あたり(kg/人工)', type: 'number', digits: 1, width: 50 }
      ],
      rows: parts.map(p => ({
        part_label: p.part_label,
        total_qty: safeNum(p.total_qty),
        part_man_days: safeNum(p.part_man_days),
        qty_per_man_day: safeNum(p.qty_per_man_day)
      })),
      fontSize: 9,
      headColor: [124, 58, 237]
    });
  }

  const fname = `年間分析_${trendYear || '全年'}年_${filters.factory === 'all' ? '全体合算' : filters.factory}`;
  await exportPdfUnified({
    title: '年間分析レポート',
    filename: fname,
    filters,
    orientation: 'a3-landscape',
    summary: [
      { label: '年間総加工数量', value: _pdfNum(totalQty, { unit: 'kg' }) },
      { label: '総人工', value: _pdfNum(totalMd, { digits: 3, unit: '人工' }) },
      { label: '年間トレーラー台数', value: _pdfNum(totalTrailer, { unit: '台' }) },
      { label: '月別推移対象年', value: trendYear ? `${trendYear}年` : '-' }
    ],
    sections
  });
}

// -- 人員別分析 --
// 人員別のCSV/PDF: 画面と同じ _workerDataCache から出力
function _collectWorkerFilters() {
  return {
    dateFrom: state.dateFrom || '',
    dateTo: state.dateTo || '',
    year: state.yearFilter || '',
    month: state.monthFilter || '',
    factory: state.factoryFilter || 'all',
    workerName: state.workerFilter || ''
  };
}
function exportWorkerCsvUnified() {
  const data = Array.isArray(_workerDataCache) ? _workerDataCache : [];
  const filters = _collectWorkerFilters();
  console.log('[人員別分析 CSV] 画面表示件数=', data.length, ' filters=', filters);
  if (data.length === 0) { alert('出力対象のデータがありません'); return; }

  // 主要な人員別サマリ (「1日平均」を含めない)
  const columns = [
    { key: 'worker_name', label: '人員名' },
    { key: 'days', label: '参加日数', type: 'number' },
    { key: 'man_days_total', label: '人工合計', type: 'number', digits: 3 },
    { key: 'total_qty', label: '総加工数量（kg）', type: 'number' },
    { key: 'qty_per_man_day', label: '1人工あたり加工数量（kg/人工）', type: 'number', digits: 1 },
    { key: 'honsha_qty', label: '本社工場（kg）', type: 'number' },
    { key: 'dai2_qty', label: '第二工場（kg）', type: 'number' },
    { key: 'foundation_qty', label: '基礎（kg）', type: 'number' },
    { key: 'base_qty', label: 'ベース（kg）', type: 'number' },
    { key: 'column_qty', label: '柱（kg）', type: 'number' },
    { key: 'beam_qty', label: '梁（kg）', type: 'number' },
    { key: 'fukashi_qty', label: '壁（kg）', type: 'number' },
    { key: 'slab_qty', label: 'スラブ（kg）', type: 'number' },
    { key: 'doma_qty', label: '土間（kg）', type: 'number' },
    { key: 'civil_qty', label: '土木（kg）', type: 'number' },
    { key: 'wooden_qty', label: '木造（kg）', type: 'number' },
    { key: 'other_qty', label: 'その他（kg）', type: 'number' }
  ];
  const rows = data.map(d => ({
    worker_name: d.worker_name,
    days: safeNum(d.days),
    man_days_total: safeNum(d.man_days_total),
    total_qty: safeNum(d.total_qty),
    qty_per_man_day: safeNum(d.man_days_total) > 0 ? safeNum(d.qty_per_man_day) : 0,
    honsha_qty: safeNum(d.honsha_qty),
    dai2_qty: safeNum(d.dai2_qty),
    foundation_qty: safeNum(d.foundation_qty),
    base_qty: safeNum(d.base_qty),
    column_qty: safeNum(d.column_qty),
    beam_qty: safeNum(d.beam_qty),
    fukashi_qty: safeNum(d.fukashi_qty),
    slab_qty: safeNum(d.slab_qty),
    doma_qty: safeNum(d.doma_qty),
    civil_qty: safeNum(d.civil_qty),
    wooden_qty: safeNum(d.wooden_qty),
    other_qty: safeNum(d.other_qty)
  }));
  const fname = `人員別分析_${filters.dateFrom || '全期間'}_${filters.dateTo || ''}_${filters.factory === 'all' ? '全体合算' : filters.factory}`;
  exportCsvUnified({
    filename: fname,
    title: '人員別分析',
    columns, rows, filters
  });

  // 部位別1人工あたり (long-format)
  const partsRows = [];
  data.forEach(d => {
    PART_KEYS.forEach(k => {
      const partQty = safeNum(d[k]);
      const partMd = safeNum(d['partmd_' + k]);
      if (partQty <= 0 && partMd <= 0) return;
      const qtyPerMd = partMd > 0 ? partQty / partMd : 0;
      partsRows.push({
        worker_name: d.worker_name,
        part_label: PART_LABELS[k],
        part_qty: partQty,
        part_man_days: partMd,
        qty_per_man_day: qtyPerMd
      });
    });
  });
  if (partsRows.length > 0) {
    exportCsvUnified({
      filename: fname + '_部位別1人工あたり',
      title: '人員別分析 - 人員×部位別 1人工あたり加工数量',
      columns: [
        { key: 'worker_name', label: '人員名' },
        { key: 'part_label', label: '部位' },
        { key: 'part_qty', label: '部位別加工数量（kg）', type: 'number' },
        { key: 'part_man_days', label: '部位別人工数', type: 'number', digits: 3 },
        { key: 'qty_per_man_day', label: '1人工あたり加工数量（kg/人工）', type: 'number', digits: 1 }
      ],
      rows: partsRows,
      filters
    });
  }
}

async function exportWorkerPdfUnified() {
  const data = Array.isArray(_workerDataCache) ? _workerDataCache : [];
  const filters = _collectWorkerFilters();
  console.log('[人員別分析 PDF] 画面表示件数=', data.length, ' filters=', filters);
  if (data.length === 0) { alert('出力対象のデータがありません'); return; }
  const totalQty = data.reduce((s, d) => s + safeNum(d.total_qty), 0);
  const totalMd = data.reduce((s, d) => s + safeNum(d.man_days_total), 0);
  const perMd = totalMd > 0 ? totalQty / totalMd : 0;

  // 表1: 基本情報 (「1日平均」を含めず、「1人工あたり」を維持)
  // A3横向き (420mm) - 余白16mm = 有効幅約404mm
  const table1Cols = [
    { key: 'worker_name', label: '人員名', width: 46 },
    { key: 'days', label: '参加日数', type: 'number', width: 32 },
    { key: 'man_days_total', label: '人工合計', type: 'number', digits: 3, width: 38 },
    { key: 'total_qty', label: '総加工数量(kg)', type: 'number', width: 50 },
    { key: 'qty_per_man_day', label: '1人工あたり', type: 'number', digits: 1, width: 46 },
    { key: 'honsha_qty', label: '本社工場(kg)', type: 'number', width: 46 },
    { key: 'dai2_qty', label: '第二工場(kg)', type: 'number', width: 46 }
  ];
  const table1Rows = data.map(d => ({
    worker_name: d.worker_name,
    days: safeNum(d.days),
    man_days_total: safeNum(d.man_days_total),
    total_qty: safeNum(d.total_qty),
    qty_per_man_day: safeNum(d.man_days_total) > 0 ? safeNum(d.qty_per_man_day) : 0,
    honsha_qty: safeNum(d.honsha_qty),
    dai2_qty: safeNum(d.dai2_qty)
  }));

  // 表2: 部位別加工量 (人員名 + 10部位)
  const table2Cols = [
    { key: 'worker_name', label: '人員名', width: 46 },
    { key: 'foundation_qty', label: '基礎', type: 'number', width: 34 },
    { key: 'base_qty', label: 'ベース', type: 'number', width: 34 },
    { key: 'column_qty', label: '柱', type: 'number', width: 34 },
    { key: 'beam_qty', label: '梁', type: 'number', width: 34 },
    { key: 'fukashi_qty', label: '壁', type: 'number', width: 34 },
    { key: 'slab_qty', label: 'スラブ', type: 'number', width: 34 },
    { key: 'doma_qty', label: '土間', type: 'number', width: 34 },
    { key: 'civil_qty', label: '土木', type: 'number', width: 34 },
    { key: 'wooden_qty', label: '木造', type: 'number', width: 34 },
    { key: 'other_qty', label: 'その他', type: 'number', width: 34 }
  ];
  const table2Rows = data.map(d => ({
    worker_name: d.worker_name,
    foundation_qty: safeNum(d.foundation_qty),
    base_qty: safeNum(d.base_qty),
    column_qty: safeNum(d.column_qty),
    beam_qty: safeNum(d.beam_qty),
    fukashi_qty: safeNum(d.fukashi_qty),
    slab_qty: safeNum(d.slab_qty),
    doma_qty: safeNum(d.doma_qty),
    civil_qty: safeNum(d.civil_qty),
    wooden_qty: safeNum(d.wooden_qty),
    other_qty: safeNum(d.other_qty)
  }));

  // 表3: 人員×部位 1人工あたり (long-format)
  const partsRows = [];
  data.forEach(d => {
    PART_KEYS.forEach(k => {
      const partQty = safeNum(d[k]);
      const partMd = safeNum(d['partmd_' + k]);
      if (partQty <= 0 && partMd <= 0) return;
      const qtyPerMd = partMd > 0 ? partQty / partMd : 0;
      partsRows.push({
        worker_name: d.worker_name,
        part_label: PART_LABELS[k],
        part_qty: partQty,
        part_man_days: partMd,
        qty_per_man_day: qtyPerMd
      });
    });
  });

  const sections = [
    { heading: '表1：人員別 基本情報', columns: table1Cols, rows: table1Rows, fontSize: 9 },
    { heading: '表2：人員別 部位別加工量（kg）', columns: table2Cols, rows: table2Rows, fontSize: 9, headColor: [16, 129, 96] }
  ];
  if (partsRows.length > 0) {
    sections.push({
      heading: '表3：人員×部位 1人工あたり加工数量',
      columns: [
        { key: 'worker_name', label: '人員名', width: 50 },
        { key: 'part_label', label: '部位', width: 32 },
        { key: 'part_qty', label: '部位別加工量(kg)', type: 'number', width: 44 },
        { key: 'part_man_days', label: '部位別人工数', type: 'number', digits: 3, width: 36 },
        { key: 'qty_per_man_day', label: '1人工あたり(kg/人工)', type: 'number', digits: 1, width: 46 }
      ],
      rows: partsRows,
      fontSize: 8,
      headColor: [124, 58, 237]
    });
  }
  const fname = `人員別分析_${filters.dateFrom || '全期間'}_${filters.dateTo || ''}_${filters.factory === 'all' ? '全体合算' : filters.factory}`;
  await exportPdfUnified({
    title: '人員別分析レポート',
    filename: fname,
    filters,
    orientation: 'a3-landscape',
    summary: [
      { label: '登録人員数', value: `${data.length} 人` },
      { label: '人工合計', value: _pdfNum(totalMd, { digits: 3, unit: '人工' }) },
      { label: '総加工数量', value: _pdfNum(totalQty, { unit: 'kg' }) },
      { label: '1人工あたり平均', value: totalMd > 0 ? _pdfNum(perMd, { digits: 1, unit: 'kg/人工' }) : '-' }
    ],
    sections
  });
}

// ============================================================================
//  運搬数量機能 (加工数量とは完全独立)
//  - 既存の renderInput / renderList / renderDaily / renderMonthly /
//    renderYearly / renderWorkers / exportCsvUnified / exportPdfUnified
//    は一切変更していない。運搬機能は本ブロック内で完結する。
// ============================================================================

// 運搬用の永続 state (view の再描画をまたいで維持)
const transportState = {
  editingId: null,
  editingUpdatedAt: null, // 楽観ロック用: 編集開始時点の updated_at
  filters: {
    dateFrom: '',
    dateTo: '',
    factory: 'all',
    vehicle: '',
    worker: ''
  },
  analysisTab: 'daily',
  analysisFilters: {
    dateFrom: dayjs().startOf('month').format('YYYY-MM-DD'),
    dateTo: dayjs().endOf('month').format('YYYY-MM-DD'),
    year: String(new Date().getFullYear()),
    factory: 'all'
  },
  charts: {}
};

// ---- 共通ユーティリティ (運搬専用・既存関数は流用せず独立) ----
// 運搬数量は小数第3位まで許可 (DB REAL)。末尾の不要な0は表示しない。
// 例: 8250 → "8,250" / 8250.5 → "8,250.5" / 8250.125 → "8,250.125"
function trFmtQty(n) {
  const v = Number(n);
  if (!isFinite(v)) return '0';
  return v.toLocaleString('ja-JP', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}
// 1人工当たりなど「明示的に小数1桁固定」の値用 (KPI 表示)
function trFmtQty1(n) {
  const v = Number(n);
  if (!isFinite(v)) return '0.0';
  return v.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
function trFmtMd(n) {
  const v = Number(n);
  if (!isFinite(v)) return '0.000';
  return v.toLocaleString('ja-JP', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}
// 前月比・前年比（増減率）を符号付きで表示する
// v は「増減率の実数」 例: +1.413 → +141.3% / -0.254 → -25.4% / 0 → +0.0%
// 前月または前年が 0 または不在の場合は null が渡され「－」を返す
function trFmtChange(v) {
  if (v == null || !isFinite(v)) return '－';
  const pct = v * 100;
  const sign = pct >= 0 ? '+' : '';
  return sign + pct.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
}
// 互換: 既存コードから trFmtRatio が呼ばれても増減率にリダイレクト
function trFmtRatio(v) { return trFmtChange(v); }
function trDestroyCharts() {
  Object.keys(transportState.charts).forEach(k => {
    try { transportState.charts[k]?.destroy(); } catch (e) {}
    delete transportState.charts[k];
  });
}

// クライアント側 人工クランプ (バックエンドと同じロジック: >0、小数第3位まで)
// 空欄は 0 を返し、UI 側でバリデーションする
function trParseManDays(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  if (n <= 0) return 0;
  return Math.round(n * 1000) / 1000;
}

// ============================================================================
//  運搬数量入力画面
// ============================================================================
function renderTransportInput(record = null) {
  transportState.editingId = record?.id || null;
  // 楽観ロック用: 編集開始時点の updated_at を保持。PUT 送信時に expected_updated_at として送る。
  transportState.editingUpdatedAt = record?.updated_at || null;
  const isEdit = !!record;
  const r = record || {
    transport_date: dayjs().format('YYYY-MM-DD'),
    factory: '本社工場',
    vehicle: '',
    transport_quantity_kg: '',
    workers: []
  };
  // ローカル workers: [{worker_name, man_days}]
  let workers = Array.isArray(r.workers) ? r.workers.map(w => ({
    worker_name: String(w.worker_name || '').trim(),
    man_days: (w.man_days === '' || w.man_days == null) ? '' : Number(w.man_days)
  })) : [];
  if (workers.length === 0 && !isEdit) workers = [{ worker_name: '', man_days: '' }];

  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="max-w-3xl mx-auto">
      <h2 class="text-xl font-bold text-gray-800 mb-4">
        <i class="fas fa-truck mr-2"></i>${isEdit ? '積込・運搬実績の編集' : '積込・運搬数量入力'}
      </h2>
      <form id="transportForm" class="bg-white rounded-xl shadow-sm p-6 space-y-5">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">日付 <span class="text-red-500">*</span></label>
            <input id="tr_date" type="date" required value="${r.transport_date || ''}" class="input-base" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">工場の別 <span class="text-red-500">*</span></label>
            <select id="tr_factory" required class="input-base">
              <option value="本社工場" ${r.factory === '本社工場' ? 'selected' : ''}>本社工場</option>
              <option value="第二工場" ${r.factory === '第二工場' ? 'selected' : ''}>第二工場</option>
            </select>
          </div>
        </div>

        <div class="bg-indigo-50 border border-indigo-200 p-4 rounded-lg">
          <div class="flex items-center justify-between mb-2 flex-wrap gap-2">
            <h3 class="font-semibold text-indigo-900">
              <i class="fas fa-users mr-1"></i>積込・運搬人員・人工 <span id="tr_workerCount" class="text-xs font-normal text-gray-600 ml-1"></span>
            </h3>
            <button type="button" id="tr_addWorkerBtn" class="btn-secondary text-sm">
              <i class="fas fa-plus mr-1"></i>人員を追加
            </button>
          </div>
          <p class="text-xs text-gray-600 mb-2">積込・運搬人員と人工を入力してください。人工は 0 より大きい数値・小数第3位まで（1人工＝7時間）。合計人工が下に自動表示されます。</p>
          <div id="tr_workerList" class="space-y-2"></div>
          <div class="mt-3 text-right">
            <span class="text-sm text-gray-600 mr-2">合計人工</span>
            <span id="tr_totalMd" class="text-lg font-bold text-indigo-700">0.000</span>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">積込・運搬車両 <span class="text-red-500">*</span></label>
            <input id="tr_vehicle" type="text" required maxlength="100" value="${escapeHtml(r.vehicle || '')}" placeholder="例: 10t車、8tユニック、京都100あ12-34" class="input-base" list="tr_vehicleList" />
            <datalist id="tr_vehicleList"></datalist>
            <p class="text-xs text-gray-500 mt-1">車両区分は自由入力です（100文字以内）</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">積込・運搬数量 <span class="text-red-500">*</span></label>
            <div class="flex items-center gap-2">
              <input id="tr_qty" type="number" required min="0.001" step="0.001" value="${(r.transport_quantity_kg === 0 || r.transport_quantity_kg) ? r.transport_quantity_kg : ''}" placeholder="例: 12500" class="input-num flex-1" inputmode="decimal" />
              <span class="text-gray-700 font-medium">kg</span>
            </div>
            <p class="text-xs text-gray-500 mt-1">0より大きい数値・小数入力可</p>
          </div>
        </div>

        <div class="flex gap-3 pt-2">
          <button type="submit" id="tr_submitBtn" class="btn-primary flex-1">
            <i class="fas fa-save mr-2"></i>${isEdit ? '更新する' : '登録する'}
          </button>
          <button type="button" id="tr_clearBtn" class="btn-secondary">
            <i class="fas fa-eraser mr-1"></i>クリア
          </button>
          ${isEdit ? `<button type="button" id="tr_cancelEditBtn" class="btn-secondary">キャンセル</button>` : ''}
        </div>
        <div id="tr_formError" class="text-red-600 text-sm hidden"></div>
        <div id="tr_formSuccess" class="text-green-700 text-sm hidden"></div>
      </form>
    </div>
  `;

  // 車両サジェスト取得
  api.transportVehicles().then(list => {
    const dl = document.getElementById('tr_vehicleList');
    if (dl && Array.isArray(list)) {
      dl.innerHTML = list.map(v => `<option value="${escapeHtml(v)}"></option>`).join('');
    }
  }).catch(() => {});

  // 人員マスタ取得
  let workerMaster = [];
  api.workers().then(list => { workerMaster = list || []; renderTrWorkerList(); }).catch(() => { renderTrWorkerList(); });

  const renderTrWorkerList = () => {
    const list = document.getElementById('tr_workerList');
    if (!list) return;
    if (workers.length === 0) {
      list.innerHTML = `<p class="text-sm text-gray-500 italic py-2">人員が未入力です。「人員を追加」を押して追加してください。</p>`;
    } else {
      // 人員選択には過去マスタからサジェスト、手入力も可 (datalist)
      list.innerHTML = workers.map((w, i) => `
        <div class="flex flex-col sm:flex-row gap-2 sm:items-center bg-white p-2 rounded border border-indigo-100">
          <div class="flex-1">
            <label class="text-xs text-gray-500 sm:hidden">積込・運搬人員</label>
            <input type="text" data-tr-worker-name="${i}" value="${escapeHtml(w.worker_name || '')}" placeholder="人員名" class="input-base w-full" list="tr_workerMasterList" />
          </div>
          <div class="w-full sm:w-32">
            <label class="text-xs text-gray-500 sm:hidden">人工</label>
            <input type="number" data-tr-worker-md="${i}" value="${w.man_days === '' ? '' : w.man_days}" min="0.001" step="0.001" placeholder="1.000" class="input-num w-full" inputmode="decimal" />
          </div>
          <button type="button" data-tr-worker-del="${i}" class="btn-danger text-sm whitespace-nowrap" title="削除">
            <i class="fas fa-trash"></i><span class="hidden sm:inline ml-1">削除</span>
          </button>
        </div>
      `).join('') + `<datalist id="tr_workerMasterList">${workerMaster.map(w => `<option value="${escapeHtml(w.name)}"></option>`).join('')}</datalist>`;
    }
    list.querySelectorAll('[data-tr-worker-name]').forEach(inp => {
      inp.addEventListener('input', (e) => {
        const idx = Number(e.target.dataset.trWorkerName);
        if (workers[idx]) workers[idx].worker_name = e.target.value;
      });
    });
    list.querySelectorAll('[data-tr-worker-md]').forEach(inp => {
      inp.addEventListener('input', (e) => {
        const idx = Number(e.target.dataset.trWorkerMd);
        if (workers[idx]) workers[idx].man_days = e.target.value === '' ? '' : Number(e.target.value);
        recalcTotalMd();
      });
    });
    list.querySelectorAll('[data-tr-worker-del]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = Number(e.currentTarget.dataset.trWorkerDel);
        workers.splice(idx, 1);
        renderTrWorkerList();
        recalcTotalMd();
      });
    });
    recalcTotalMd();
  };

  const recalcTotalMd = () => {
    const total = workers.reduce((s, w) => {
      const v = Number(w.man_days);
      return isFinite(v) && v > 0 ? s + v : s;
    }, 0);
    const el = document.getElementById('tr_totalMd');
    if (el) el.textContent = trFmtMd(total);
    const wc = document.getElementById('tr_workerCount');
    const validNames = workers.filter(w => String(w.worker_name || '').trim()).length;
    if (wc) wc.textContent = validNames > 0 ? `（${validNames}人 / ${trFmtMd(total)}人工）` : '';
  };

  renderTrWorkerList();

  document.getElementById('tr_addWorkerBtn').addEventListener('click', () => {
    workers.push({ worker_name: '', man_days: '' });
    renderTrWorkerList();
  });

  document.getElementById('tr_clearBtn').addEventListener('click', () => {
    if (!confirm('入力内容をクリアしますか？')) return;
    workers = [{ worker_name: '', man_days: '' }];
    document.getElementById('tr_date').value = dayjs().format('YYYY-MM-DD');
    document.getElementById('tr_factory').value = '本社工場';
    document.getElementById('tr_vehicle').value = '';
    document.getElementById('tr_qty').value = '';
    document.getElementById('tr_formError').classList.add('hidden');
    document.getElementById('tr_formSuccess').classList.add('hidden');
    renderTrWorkerList();
  });

  if (isEdit) {
    document.getElementById('tr_cancelEditBtn').addEventListener('click', () => {
      transportState.editingId = null;
      navigateTo('transport-list');
    });
  }

  document.getElementById('transportForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('tr_formError');
    const okEl = document.getElementById('tr_formSuccess');
    errEl.classList.add('hidden'); okEl.classList.add('hidden');

    const date = document.getElementById('tr_date').value;
    const factory = document.getElementById('tr_factory').value;
    const vehicle = document.getElementById('tr_vehicle').value.trim();
    const qtyRaw = document.getElementById('tr_qty').value;

    // クライアント側バリデーション (サーバ側でも同様に検証)
    if (!date) return showTrErr(errEl, '日付を入力してください');
    if (!factory) return showTrErr(errEl, '工場の別を選択してください');
    if (!vehicle) return showTrErr(errEl, '積込・運搬車両を入力してください');
    if (vehicle.length > 100) return showTrErr(errEl, '積込・運搬車両は100文字以内で入力してください');
    if (qtyRaw === '' || qtyRaw == null) return showTrErr(errEl, '積込・運搬数量を入力してください');
    const qtyNum = Number(qtyRaw);
    if (!isFinite(qtyNum) || qtyNum <= 0) return showTrErr(errEl, '積込・運搬数量は0より大きい数値を指定してください');
    // 運搬数量は小数第3位まで保持 (DB REAL)。第4位以降は四捨五入する。
    const qty = Math.round(qtyNum * 1000) / 1000;

    const validWorkers = workers
      .map(w => ({ worker_name: String(w.worker_name || '').trim(), man_days: w.man_days === '' ? null : Number(w.man_days) }))
      .filter(w => w.worker_name);
    if (validWorkers.length === 0) return showTrErr(errEl, '積込・運搬人員を1名以上入力してください');
    const nameSet = new Set();
    for (const w of validWorkers) {
      if (nameSet.has(w.worker_name)) return showTrErr(errEl, `同一の積込・運搬人員 "${w.worker_name}" が重複しています`);
      nameSet.add(w.worker_name);
      if (w.man_days == null || !isFinite(w.man_days)) return showTrErr(errEl, `積込・運搬人員 "${w.worker_name}" の人工が未入力です`);
      if (w.man_days <= 0) return showTrErr(errEl, `積込・運搬人員 "${w.worker_name}" の人工は0より大きい値を指定してください`);
    }

    const submitBtn = document.getElementById('tr_submitBtn');
    submitBtn.disabled = true;
    const orig = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>処理中...';

    const payload = {
      transport_date: date,
      factory,
      vehicle,
      transport_quantity_kg: qty,
      workers: validWorkers.map(w => ({ worker_name: w.worker_name, man_days: w.man_days }))
    };
    // 楽観ロック: 編集時のみ、開始時点の updated_at を送る。サーバ側で現在値と比較し
    // 不一致なら 409 (conflict) を返す。他タブ・他ユーザーの並行編集を検出する。
    if (isEdit && transportState.editingUpdatedAt) {
      payload.expected_updated_at = transportState.editingUpdatedAt;
    }

    try {
      let saved;
      if (isEdit) {
        saved = await api.updateTransport(transportState.editingId, payload);
      } else {
        saved = await api.createTransport(payload);
      }
      // 成功時: サーバから返る最新 updated_at を保持しておく (連続編集対応)
      transportState.editingUpdatedAt = saved.updated_at || null;
      okEl.innerHTML = `<i class="fas fa-check-circle mr-1"></i>${isEdit ? '更新しました' : '登録しました'} (ID: ${saved.id})　<a class="underline text-blue-600" href="#" id="tr_gotoList">積込・運搬実績一覧を見る</a>`;
      okEl.classList.remove('hidden');
      document.getElementById('tr_gotoList')?.addEventListener('click', (ev) => {
        ev.preventDefault(); navigateTo('transport-list');
      });
      if (!isEdit) {
        // 続けて登録できるようフォームをリセット (人員は残す)
        document.getElementById('tr_qty').value = '';
      }
    } catch (err) {
      // 楽観ロック競合 (409 + conflict:true) - 他ユーザー/他タブが先に更新した
      if (err.status === 409 && err.data && err.data.conflict === true) {
        submitBtn.disabled = false; submitBtn.innerHTML = orig;
        const msg = '他のユーザーによりこの積込・運搬記録が更新されています。最新の内容を再読み込みしてから、もう一度編集してください。';
        if (confirm(msg + '\n\n[OK] 最新データを取り直して編集を続ける / [キャンセル] 一覧へ戻る')) {
          try {
            const fresh = await api.getTransport(transportState.editingId);
            renderTransportInput(fresh);
          } catch (e2) {
            showTrErr(errEl, '最新データの取得に失敗しました: ' + (e2.message || String(e2)));
          }
        } else {
          navigateTo('transport-list');
        }
        return;
      }
      // 重複警告 (409 + duplicate:true) の場合、ユーザーに確認して再送
      if (err.status === 409 && err.data && err.data.duplicate === true) {
        submitBtn.disabled = false; submitBtn.innerHTML = orig;
        if (confirm(err.message + '\n\nそれでも登録しますか？')) {
          submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>処理中...';
          try {
            const saved = await api.createTransport({ ...payload, duplicateAck: true });
            transportState.editingUpdatedAt = saved.updated_at || null;
            okEl.innerHTML = `<i class="fas fa-check-circle mr-1"></i>登録しました (ID: ${saved.id})`;
            okEl.classList.remove('hidden');
            document.getElementById('tr_qty').value = '';
          } catch (err2) {
            showTrErr(errEl, err2.message || String(err2));
          } finally {
            submitBtn.disabled = false; submitBtn.innerHTML = orig;
          }
        } else {
          submitBtn.disabled = false; submitBtn.innerHTML = orig;
        }
        return;
      }
      showTrErr(errEl, err.message || String(err));
    } finally {
      submitBtn.disabled = false; submitBtn.innerHTML = orig;
    }
  });

  function showTrErr(el, msg) {
    el.innerHTML = `<i class="fas fa-exclamation-circle mr-1"></i>${escapeHtml(msg)}`;
    el.classList.remove('hidden');
  }
}

// ============================================================================
//  運搬実績一覧
// ============================================================================
async function renderTransportList() {
  const main = document.getElementById('main');
  const f = transportState.filters;
  main.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <h2 class="text-xl font-bold text-gray-800">
          <i class="fas fa-list mr-2"></i>積込・運搬実績一覧
        </h2>
        <div class="flex gap-2 flex-wrap">
          <button id="tr_list_csv" class="btn-secondary text-sm"><i class="fas fa-file-csv mr-1"></i>CSV</button>
          <button id="tr_list_pdf" class="btn-secondary text-sm"><i class="fas fa-file-pdf mr-1"></i>PDF</button>
          <button id="tr_list_new" class="btn-primary text-sm"><i class="fas fa-plus mr-1"></i>新規登録</button>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-sm p-4">
        <div class="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div>
            <label class="text-xs text-gray-600">開始日</label>
            <input id="tr_f_from" type="date" value="${f.dateFrom || ''}" class="input-base" />
          </div>
          <div>
            <label class="text-xs text-gray-600">終了日</label>
            <input id="tr_f_to" type="date" value="${f.dateTo || ''}" class="input-base" />
          </div>
          <div>
            <label class="text-xs text-gray-600">工場</label>
            <select id="tr_f_factory" class="input-base">
              <option value="all" ${f.factory === 'all' ? 'selected' : ''}>全工場合算</option>
              <option value="本社工場" ${f.factory === '本社工場' ? 'selected' : ''}>本社工場</option>
              <option value="第二工場" ${f.factory === '第二工場' ? 'selected' : ''}>第二工場</option>
            </select>
          </div>
          <div>
            <label class="text-xs text-gray-600">積込・運搬人員 (部分一致)</label>
            <input id="tr_f_worker" type="text" value="${escapeHtml(f.worker || '')}" placeholder="例: 山田" class="input-base" />
          </div>
          <div>
            <label class="text-xs text-gray-600">積込・運搬車両 (部分一致)</label>
            <input id="tr_f_vehicle" type="text" value="${escapeHtml(f.vehicle || '')}" placeholder="例: 10t" class="input-base" />
          </div>
          <div class="flex items-end gap-1">
            <button id="tr_f_apply" class="btn-primary text-sm flex-1"><i class="fas fa-filter mr-1"></i>絞込</button>
            <button id="tr_f_reset" class="btn-secondary text-sm"><i class="fas fa-undo"></i></button>
          </div>
        </div>
      </div>

      <div id="tr_summaryArea" class="grid grid-cols-2 md:grid-cols-4 gap-3"></div>

      <div id="tr_listArea" class="bg-white rounded-xl shadow-sm p-2 md:p-4"></div>
    </div>
  `;

  document.getElementById('tr_list_new').addEventListener('click', () => navigateTo('transport-input'));
  document.getElementById('tr_f_apply').addEventListener('click', () => reloadTrList());
  document.getElementById('tr_f_reset').addEventListener('click', () => {
    transportState.filters = { dateFrom: '', dateTo: '', factory: 'all', vehicle: '', worker: '' };
    renderTransportList();
  });

  await reloadTrList();
}

async function reloadTrList() {
  const f = transportState.filters;
  f.dateFrom = document.getElementById('tr_f_from').value || '';
  f.dateTo = document.getElementById('tr_f_to').value || '';
  f.factory = document.getElementById('tr_f_factory').value || 'all';
  f.worker = document.getElementById('tr_f_worker').value.trim();
  f.vehicle = document.getElementById('tr_f_vehicle').value.trim();

  const area = document.getElementById('tr_listArea');
  setSectionLoading(area);
  try {
    const records = await api.listTransport({
      dateFrom: f.dateFrom || undefined,
      dateTo: f.dateTo || undefined,
      factory: f.factory,
      worker: f.worker || undefined,
      vehicle: f.vehicle || undefined
    });
    renderTrListTable(records);
    document.getElementById('tr_list_csv').onclick = () => exportTransportListCsv(records, f);
    (() => {
      const btn = document.getElementById('tr_list_pdf');
      btn.onclick = () => trRunPdfExport(btn, () => exportTransportListPdf(records, f));
    })();
  } catch (err) {
    setSectionError(area, err.message || String(err), {
      onSample: false,
      retry: () => reloadTrList()
    });
  }
}

function renderTrListTable(records) {
  const area = document.getElementById('tr_listArea');
  const sumArea = document.getElementById('tr_summaryArea');
  const totalQty = records.reduce((s, r) => s + (Number(r.transport_quantity_kg) || 0), 0);
  const totalMd = records.reduce((s, r) => s + (Number(r.total_man_days) || 0), 0);
  const count = records.length;
  const perMd = totalMd > 0 ? totalQty / totalMd : 0;

  sumArea.innerHTML = `
    <div class="bg-white rounded-xl shadow-sm p-3 border-l-4 border-blue-500">
      <p class="text-xs text-gray-500">積込・運搬件数</p>
      <p class="text-2xl font-bold text-gray-800">${count} 件</p>
    </div>
    <div class="bg-white rounded-xl shadow-sm p-3 border-l-4 border-green-500">
      <p class="text-xs text-gray-500">積込・運搬数量合計</p>
      <p class="text-2xl font-bold text-green-700">${trFmtQty(totalQty)} <span class="text-sm">kg</span></p>
    </div>
    <div class="bg-white rounded-xl shadow-sm p-3 border-l-4 border-indigo-500">
      <p class="text-xs text-gray-500">人工合計</p>
      <p class="text-2xl font-bold text-indigo-700">${trFmtMd(totalMd)}</p>
    </div>
    <div class="bg-white rounded-xl shadow-sm p-3 border-l-4 border-purple-500">
      <p class="text-xs text-gray-500">1人工当たり積込・運搬数量</p>
      <p class="text-2xl font-bold text-purple-700">${totalMd > 0 ? trFmtQty1(perMd) : '－'} <span class="text-sm">kg/人工</span></p>
    </div>
  `;

  if (records.length === 0) {
    area.innerHTML = `<div class="text-center py-10 text-gray-500"><i class="fas fa-inbox text-3xl"></i><p class="mt-2">該当する積込・運搬記録がありません</p></div>`;
    return;
  }

  const isAdmin = state.user?.role === 'admin';
  // デスクトップ表: table / モバイル: カード表示
  const rows = records.map(r => {
    const workersStr = (r.workers || []).map(w => `${escapeHtml(w.worker_name)}(${trFmtMd(w.man_days)})`).join(', ');
    const perMd = (Number(r.total_man_days) || 0) > 0 ? Number(r.transport_quantity_kg) / Number(r.total_man_days) : null;
    return { r, workersStr, perMd };
  });

  area.innerHTML = `
    <!-- デスクトップ: テーブル -->
    <div class="overflow-x-auto hidden md:block">
      <table class="w-full text-sm">
        <thead class="bg-gray-100">
          <tr class="text-left">
            <th class="px-2 py-2">日付</th>
            <th class="px-2 py-2">工場</th>
            <th class="px-2 py-2">積込・運搬人員 (人工)</th>
            <th class="px-2 py-2 text-right">合計人工</th>
            <th class="px-2 py-2">積込・運搬車両</th>
            <th class="px-2 py-2 text-right">積込・運搬数量</th>
            <th class="px-2 py-2 text-right">1人工当たり</th>
            <th class="px-2 py-2 text-center">操作</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(({r, workersStr, perMd}) => `
            <tr class="border-t border-gray-100 hover:bg-blue-50">
              <td class="px-2 py-2 whitespace-nowrap">${escapeHtml(r.transport_date)}</td>
              <td class="px-2 py-2 whitespace-nowrap">${escapeHtml(r.factory)}</td>
              <td class="px-2 py-2">${workersStr}</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${trFmtMd(r.total_man_days)}</td>
              <td class="px-2 py-2 whitespace-nowrap">${escapeHtml(r.vehicle)}</td>
              <td class="px-2 py-2 text-right whitespace-nowrap font-semibold">${trFmtQty(r.transport_quantity_kg)} kg</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${perMd != null ? trFmtQty1(perMd) + ' kg' : '－'}</td>
              <td class="px-2 py-2 text-center whitespace-nowrap">
                <button data-tr-edit="${r.id}" class="text-blue-600 hover:underline text-xs mr-1"><i class="fas fa-edit"></i>編集</button>
                ${isAdmin ? `<button data-tr-del="${r.id}" class="text-red-600 hover:underline text-xs"><i class="fas fa-trash"></i>削除</button>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <!-- モバイル: カード -->
    <div class="md:hidden space-y-2">
      ${rows.map(({r, workersStr, perMd}) => `
        <div class="border border-gray-200 rounded-lg p-3 bg-white">
          <div class="flex items-center justify-between mb-2">
            <span class="font-semibold">${escapeHtml(r.transport_date)}</span>
            <span class="text-xs px-2 py-0.5 rounded ${r.factory === '本社工場' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'}">${escapeHtml(r.factory)}</span>
          </div>
          <div class="text-sm space-y-1">
            <div><span class="text-gray-500">車両:</span> ${escapeHtml(r.vehicle)}</div>
            <div><span class="text-gray-500">人員:</span> ${workersStr}</div>
            <div><span class="text-gray-500">合計人工:</span> ${trFmtMd(r.total_man_days)} / <span class="text-gray-500">1人工当たり:</span> ${perMd != null ? trFmtQty1(perMd) + ' kg' : '－'}</div>
            <div class="text-lg font-bold text-green-700">${trFmtQty(r.transport_quantity_kg)} kg</div>
          </div>
          <div class="mt-2 flex gap-2 justify-end">
            <button data-tr-edit="${r.id}" class="btn-secondary text-xs"><i class="fas fa-edit mr-1"></i>編集</button>
            ${isAdmin ? `<button data-tr-del="${r.id}" class="btn-danger text-xs"><i class="fas fa-trash mr-1"></i>削除</button>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;

  area.querySelectorAll('[data-tr-edit]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = Number(e.currentTarget.dataset.trEdit);
      try {
        const rec = await api.getTransport(id);
        state.view = 'transport-input';
        document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === 'transport-input'));
        renderTransportInput(rec);
      } catch (err) {
        alert('取得失敗: ' + (err.message || String(err)));
      }
    });
  });
  area.querySelectorAll('[data-tr-del]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = Number(e.currentTarget.dataset.trDel);
      if (!confirm(`積込・運搬記録 ID: ${id} を削除します。よろしいですか？`)) return;
      try {
        await api.deleteTransport(id);
        await reloadTrList();
      } catch (err) {
        alert('削除失敗: ' + (err.message || String(err)));
      }
    });
  });
}

// ============================================================================
//  運搬数量分析 (日別 / 月別 / 年別 / 人員別 タブ)
//  加工数量データは一切参照しない (バックエンド側も同じ)。
// ============================================================================
async function renderTransportAnalysis() {
  const main = document.getElementById('main');
  const af = transportState.analysisFilters;
  const tab = transportState.analysisTab;

  main.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <h2 class="text-xl font-bold text-gray-800">
          <i class="fas fa-chart-line mr-2"></i>積込・運搬数量分析
        </h2>
        <div class="flex gap-2">
          <button id="tra_csv" class="btn-secondary text-sm"><i class="fas fa-file-csv mr-1"></i>CSV</button>
          <button id="tra_pdf" class="btn-secondary text-sm"><i class="fas fa-file-pdf mr-1"></i>PDF</button>
        </div>
      </div>

      <div class="flex gap-2 flex-wrap border-b">
        ${['daily','monthly','yearly','workers'].map(t => `
          <button data-tra-tab="${t}" class="px-4 py-2 -mb-px border-b-2 ${tab === t ? 'border-blue-600 text-blue-600 font-semibold' : 'border-transparent text-gray-600 hover:text-blue-600'}">
            ${({daily:'日別', monthly:'月別', yearly:'年別', workers:'人員別'})[t]}
          </button>
        `).join('')}
      </div>

      <div class="bg-white rounded-xl shadow-sm p-4">
        <div id="tra_filter_area" class="grid grid-cols-2 md:grid-cols-5 gap-3"></div>
      </div>

      <div id="tra_summary" class="grid grid-cols-2 md:grid-cols-5 gap-3"></div>

      <div id="tra_body" class="space-y-4"></div>
    </div>
  `;

  renderTraFilters();

  document.querySelectorAll('[data-tra-tab]').forEach(b => {
    b.addEventListener('click', () => {
      transportState.analysisTab = b.dataset.traTab;
      renderTransportAnalysis();
    });
  });

  await loadTraTab();
}

function renderTraFilters() {
  const af = transportState.analysisFilters;
  const tab = transportState.analysisTab;
  const area = document.getElementById('tra_filter_area');
  // 日別・人員別は期間 / 月別は年 / 年別は工場のみ (期間指定は月別推移用として残す)
  const commonFactory = `
    <div>
      <label class="text-xs text-gray-600">工場</label>
      <select id="tra_factory" class="input-base">
        <option value="all" ${af.factory === 'all' ? 'selected' : ''}>全工場合算</option>
        <option value="本社工場" ${af.factory === '本社工場' ? 'selected' : ''}>本社工場</option>
        <option value="第二工場" ${af.factory === '第二工場' ? 'selected' : ''}>第二工場</option>
      </select>
    </div>`;
  if (tab === 'daily' || tab === 'workers') {
    area.innerHTML = `
      <div><label class="text-xs text-gray-600">開始日</label><input id="tra_from" type="date" value="${af.dateFrom}" class="input-base" /></div>
      <div><label class="text-xs text-gray-600">終了日</label><input id="tra_to" type="date" value="${af.dateTo}" class="input-base" /></div>
      ${commonFactory}
      <div class="flex items-end"><button id="tra_apply" class="btn-primary text-sm w-full"><i class="fas fa-filter mr-1"></i>適用</button></div>
    `;
  } else if (tab === 'monthly') {
    area.innerHTML = `
      <div><label class="text-xs text-gray-600">年</label><input id="tra_year" type="number" min="2000" max="2100" value="${af.year}" class="input-base" /></div>
      ${commonFactory}
      <div class="flex items-end"><button id="tra_apply" class="btn-primary text-sm w-full"><i class="fas fa-filter mr-1"></i>適用</button></div>
    `;
  } else { // yearly
    area.innerHTML = `
      ${commonFactory}
      <div class="flex items-end"><button id="tra_apply" class="btn-primary text-sm w-full"><i class="fas fa-filter mr-1"></i>適用</button></div>
    `;
  }
  document.getElementById('tra_apply').addEventListener('click', () => {
    const t = transportState.analysisTab;
    if (t === 'daily' || t === 'workers') {
      af.dateFrom = document.getElementById('tra_from').value || '';
      af.dateTo = document.getElementById('tra_to').value || '';
    } else if (t === 'monthly') {
      af.year = document.getElementById('tra_year').value || String(new Date().getFullYear());
    }
    af.factory = document.getElementById('tra_factory').value || 'all';
    loadTraTab();
  });
}

async function loadTraTab() {
  const body = document.getElementById('tra_body');
  const sum = document.getElementById('tra_summary');
  const tab = transportState.analysisTab;
  const af = transportState.analysisFilters;
  trDestroyCharts();
  setSectionLoading(body);
  sum.innerHTML = '';

  const params = {
    dateFrom: af.dateFrom || undefined,
    dateTo: af.dateTo || undefined,
    year: (tab === 'monthly') ? af.year : undefined,
    factory: af.factory
  };
  try {
    if (tab === 'daily') {
      const data = await api.transportDaily(params);
      renderTraSummary(sum, data);
      renderTraDaily(body, data);
      document.getElementById('tra_csv').onclick = () => exportTransportAnalysisCsv('daily', data, params);
      { const btn = document.getElementById('tra_pdf'); btn.onclick = () => trRunPdfExport(btn, () => exportTransportAnalysisPdf('daily', data, params)); }
    } else if (tab === 'monthly') {
      const data = await api.transportMonthly(params);
      renderTraSummary(sum, data);
      renderTraMonthly(body, data);
      document.getElementById('tra_csv').onclick = () => exportTransportAnalysisCsv('monthly', data, params);
      { const btn = document.getElementById('tra_pdf'); btn.onclick = () => trRunPdfExport(btn, () => exportTransportAnalysisPdf('monthly', data, params)); }
    } else if (tab === 'yearly') {
      const r = await api.transportYearly(params);
      renderTraSummary(sum, r.data);
      renderTraYearly(body, r.data, r.monthly);
      document.getElementById('tra_csv').onclick = () => exportTransportAnalysisCsv('yearly', r.data, params, r.monthly);
      { const btn = document.getElementById('tra_pdf'); btn.onclick = () => trRunPdfExport(btn, () => exportTransportAnalysisPdf('yearly', r.data, params, r.monthly)); }
    } else if (tab === 'workers') {
      const data = await api.transportWorkers(params);
      renderTraSummary(sum, data);
      renderTraWorkers(body, data);
      document.getElementById('tra_csv').onclick = () => exportTransportAnalysisCsv('workers', data, params);
      { const btn = document.getElementById('tra_pdf'); btn.onclick = () => trRunPdfExport(btn, () => exportTransportAnalysisPdf('workers', data, params)); }
    }
  } catch (err) {
    setSectionError(body, err.message || String(err), { onSample: false, retry: () => loadTraTab() });
  }
}

function renderTraSummary(el, data) {
  const totalQty = data.reduce((s, r) => s + (Number(r.total_qty) || 0), 0);
  const totalMd = data.reduce((s, r) => s + (Number(r.total_man_days) || 0), 0);
  const totalRc = data.reduce((s, r) => s + (Number(r.record_count) || 0), 0);
  const perRec = totalRc > 0 ? totalQty / totalRc : 0;
  const perMd = totalMd > 0 ? totalQty / totalMd : 0;
  el.innerHTML = `
    <div class="bg-white rounded-xl shadow-sm p-3 border-l-4 border-green-500">
      <p class="text-xs text-gray-500">積込・運搬数量</p>
      <p class="text-xl font-bold text-green-700">${trFmtQty(totalQty)} <span class="text-sm">kg</span></p>
    </div>
    <div class="bg-white rounded-xl shadow-sm p-3 border-l-4 border-indigo-500">
      <p class="text-xs text-gray-500">積込・運搬人工</p>
      <p class="text-xl font-bold text-indigo-700">${trFmtMd(totalMd)}</p>
    </div>
    <div class="bg-white rounded-xl shadow-sm p-3 border-l-4 border-blue-500">
      <p class="text-xs text-gray-500">積込・運搬件数</p>
      <p class="text-xl font-bold text-blue-700">${totalRc}</p>
    </div>
    <div class="bg-white rounded-xl shadow-sm p-3 border-l-4 border-teal-500">
      <p class="text-xs text-gray-500">1件当たり積込・運搬数量</p>
      <p class="text-xl font-bold text-teal-700">${totalRc > 0 ? trFmtQty(perRec) : '－'} <span class="text-sm">kg</span></p>
    </div>
    <div class="bg-white rounded-xl shadow-sm p-3 border-l-4 border-purple-500">
      <p class="text-xs text-gray-500">1人工当たり積込・運搬数量</p>
      <p class="text-xl font-bold text-purple-700">${totalMd > 0 ? trFmtQty1(perMd) : '－'} <span class="text-sm">kg/人工</span></p>
    </div>
  `;
}

// ---- 日別 ----
function renderTraDaily(el, data) {
  if (data.length === 0) {
    el.innerHTML = trEmptyPanel('日別データがありません');
    return;
  }
  el.innerHTML = `
    <div class="bg-white rounded-xl shadow-sm p-4">
      <h3 class="font-semibold mb-2">日別推移グラフ</h3>
      <div class="relative" style="height:260px"><canvas id="tra_daily_chart"></canvas></div>
    </div>
    <div class="bg-white rounded-xl shadow-sm p-2 md:p-4 overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-gray-100">
          <tr class="text-left">
            <th class="px-2 py-2">日付</th>
            <th class="px-2 py-2 text-right">積込・運搬数量</th>
            <th class="px-2 py-2 text-right">積込・運搬人工</th>
            <th class="px-2 py-2 text-right">積込・運搬件数</th>
            <th class="px-2 py-2 text-right">1件当たり</th>
            <th class="px-2 py-2 text-right">1人工当たり</th>
            <th class="px-2 py-2 text-right">本社工場</th>
            <th class="px-2 py-2 text-right">第二工場</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(r => `
            <tr class="border-t hover:bg-blue-50">
              <td class="px-2 py-2 whitespace-nowrap">${escapeHtml(r.date)}</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${trFmtQty(r.total_qty)} kg</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${trFmtMd(r.total_man_days)}</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${r.record_count}</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${r.record_count > 0 ? trFmtQty(r.qty_per_record) + ' kg' : '－'}</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${r.total_man_days > 0 ? trFmtQty1(r.qty_per_man_day) + ' kg' : '－'}</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${trFmtQty(r.honsha_qty)} kg</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${trFmtQty(r.dai2_qty)} kg</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  const ctx = document.getElementById('tra_daily_chart');
  transportState.charts.daily = new Chart(ctx, {
    data: {
      labels: data.map(r => r.date),
      datasets: [
        { type:'bar', label:'積込・運搬数量(kg)', data: data.map(r => r.total_qty), backgroundColor:'rgba(16, 185, 129, 0.6)', yAxisID:'y' },
        { type:'line', label:'1人工当たり(kg/人工)', data: data.map(r => r.total_man_days > 0 ? r.qty_per_man_day : null), borderColor:'rgb(147, 51, 234)', backgroundColor:'rgba(147, 51, 234, 0.2)', yAxisID:'y1', tension:0.2 }
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      scales: {
        y: { position:'left', title:{ display:true, text:'積込・運搬数量(kg)' } },
        y1:{ position:'right', title:{ display:true, text:'1人工当たり(kg/人工)' }, grid:{ drawOnChartArea:false } }
      }
    }
  });
}

// ---- 月別 ----
function renderTraMonthly(el, data) {
  if (data.length === 0) {
    el.innerHTML = trEmptyPanel('月別データがありません');
    return;
  }
  el.innerHTML = `
    <div class="bg-white rounded-xl shadow-sm p-4">
      <h3 class="font-semibold mb-2">月別積込・運搬数量</h3>
      <div class="relative" style="height:260px"><canvas id="tra_monthly_chart"></canvas></div>
    </div>
    <div class="bg-white rounded-xl shadow-sm p-2 md:p-4 overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-gray-100">
          <tr class="text-left">
            <th class="px-2 py-2">月</th>
            <th class="px-2 py-2 text-right">積込・運搬数量</th>
            <th class="px-2 py-2 text-right">積込・運搬人工</th>
            <th class="px-2 py-2 text-right">積込・運搬件数</th>
            <th class="px-2 py-2 text-right">1件当たり</th>
            <th class="px-2 py-2 text-right">1人工当たり</th>
            <th class="px-2 py-2 text-right">本社工場</th>
            <th class="px-2 py-2 text-right">第二工場</th>
            <th class="px-2 py-2 text-right" title="(当月 - 前月) / 前月 × 100">前月比<br><span class="text-xs font-normal text-gray-500">増減率</span></th>
          </tr>
        </thead>
        <tbody>
          ${data.map(r => `
            <tr class="border-t hover:bg-blue-50">
              <td class="px-2 py-2 whitespace-nowrap">${escapeHtml(r.ym)}</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${trFmtQty(r.total_qty)} kg</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${trFmtMd(r.total_man_days)}</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${r.record_count}</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${r.record_count > 0 ? trFmtQty(r.qty_per_record) + ' kg' : '－'}</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${r.total_man_days > 0 ? trFmtQty1(r.qty_per_man_day) + ' kg' : '－'}</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${trFmtQty(r.honsha_qty)} kg</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${trFmtQty(r.dai2_qty)} kg</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${trFmtChange(r.prev_month_change)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  const ctx = document.getElementById('tra_monthly_chart');
  transportState.charts.monthly = new Chart(ctx, {
    type:'bar',
    data: {
      labels: data.map(r => r.ym),
      datasets: [
        { label:'本社工場(kg)', data: data.map(r => r.honsha_qty), backgroundColor:'rgba(59, 130, 246, 0.7)' },
        { label:'第二工場(kg)', data: data.map(r => r.dai2_qty), backgroundColor:'rgba(168, 85, 247, 0.7)' }
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      scales: { x:{ stacked:true }, y:{ stacked:true, title:{ display:true, text:'積込・運搬数量(kg)' } } }
    }
  });
}

// ---- 年別 ----
function renderTraYearly(el, yearly, monthly) {
  if (yearly.length === 0 && monthly.length === 0) {
    el.innerHTML = trEmptyPanel('年別データがありません');
    return;
  }
  el.innerHTML = `
    <div class="bg-white rounded-xl shadow-sm p-2 md:p-4 overflow-x-auto">
      <h3 class="font-semibold mb-2">年別集計</h3>
      <table class="w-full text-sm">
        <thead class="bg-gray-100">
          <tr class="text-left">
            <th class="px-2 py-2">年</th>
            <th class="px-2 py-2 text-right">積込・運搬数量</th>
            <th class="px-2 py-2 text-right">積込・運搬人工</th>
            <th class="px-2 py-2 text-right">積込・運搬件数</th>
            <th class="px-2 py-2 text-right">1件当たり</th>
            <th class="px-2 py-2 text-right">1人工当たり</th>
            <th class="px-2 py-2 text-right">本社工場</th>
            <th class="px-2 py-2 text-right">第二工場</th>
            <th class="px-2 py-2 text-right" title="(当年 - 前年) / 前年 × 100">前年比<br><span class="text-xs font-normal text-gray-500">増減率</span></th>
          </tr>
        </thead>
        <tbody>
          ${yearly.length === 0 ? `<tr><td class="px-2 py-4 text-center text-gray-500" colspan="9">年別データなし</td></tr>` : yearly.map(r => `
            <tr class="border-t hover:bg-blue-50">
              <td class="px-2 py-2">${escapeHtml(r.year)}</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${trFmtQty(r.total_qty)} kg</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${trFmtMd(r.total_man_days)}</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${r.record_count}</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${r.record_count > 0 ? trFmtQty(r.qty_per_record) + ' kg' : '－'}</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${r.total_man_days > 0 ? trFmtQty1(r.qty_per_man_day) + ' kg' : '－'}</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${trFmtQty(r.honsha_qty)} kg</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${trFmtQty(r.dai2_qty)} kg</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${trFmtChange(r.prev_year_change)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="bg-white rounded-xl shadow-sm p-4">
      <h3 class="font-semibold mb-2">月別推移</h3>
      <div class="relative" style="height:260px"><canvas id="tra_yearly_chart"></canvas></div>
    </div>
  `;
  if (monthly.length > 0) {
    const ctx = document.getElementById('tra_yearly_chart');
    transportState.charts.yearly = new Chart(ctx, {
      data: {
        labels: monthly.map(r => r.ym),
        datasets: [
          { type:'bar', label:'積込・運搬数量(kg)', data: monthly.map(r => r.total_qty), backgroundColor:'rgba(16, 185, 129, 0.6)', yAxisID:'y' },
          { type:'line', label:'積込・運搬人工', data: monthly.map(r => r.total_man_days), borderColor:'rgb(59, 130, 246)', backgroundColor:'rgba(59, 130, 246, 0.2)', yAxisID:'y1', tension:0.2 },
          { type:'line', label:'1人工当たり(kg/人工)', data: monthly.map(r => r.total_man_days > 0 ? r.qty_per_man_day : null), borderColor:'rgb(147, 51, 234)', backgroundColor:'rgba(147, 51, 234, 0.2)', yAxisID:'y2', tension:0.2, borderDash:[5,3] }
        ]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        scales: {
          y:  { position:'left',  title:{ display:true, text:'積込・運搬数量(kg)' } },
          y1: { position:'right', title:{ display:true, text:'積込・運搬人工' }, grid:{ drawOnChartArea:false } },
          y2: { display:false }
        }
      }
    });
  }
}

// ---- 人員別 ----
function renderTraWorkers(el, data) {
  if (data.length === 0) {
    el.innerHTML = trEmptyPanel('人員別データがありません');
    return;
  }
  el.innerHTML = `
    <div class="bg-white rounded-xl shadow-sm p-4">
      <h3 class="font-semibold mb-2">人員別積込・運搬数量 (Top 20)</h3>
      <div class="relative" style="height:280px"><canvas id="tra_workers_chart"></canvas></div>
    </div>
    <div class="bg-white rounded-xl shadow-sm p-2 md:p-4 overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-gray-100">
          <tr class="text-left">
            <th class="px-2 py-2">積込・運搬人員</th>
            <th class="px-2 py-2 text-right">担当人工</th>
            <th class="px-2 py-2 text-right">担当件数</th>
            <th class="px-2 py-2 text-right">担当日数</th>
            <th class="px-2 py-2 text-right">担当積込・運搬数量</th>
            <th class="px-2 py-2 text-right">1人工当たり</th>
            <th class="px-2 py-2 text-right">本社工場</th>
            <th class="px-2 py-2 text-right">第二工場</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(r => `
            <tr class="border-t hover:bg-blue-50">
              <td class="px-2 py-2 whitespace-nowrap font-medium">${escapeHtml(r.worker_name)}</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${trFmtMd(r.total_man_days)}</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${r.record_count}</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${r.days}</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${trFmtQty(r.total_qty)} kg</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${r.total_man_days > 0 ? trFmtQty1(r.qty_per_man_day) + ' kg' : '－'}</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${trFmtQty(r.honsha_qty)} kg</td>
              <td class="px-2 py-2 text-right whitespace-nowrap">${trFmtQty(r.dai2_qty)} kg</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  const top = data.slice(0, 20);
  const ctx = document.getElementById('tra_workers_chart');
  transportState.charts.workers = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top.map(r => r.worker_name),
      datasets: [{ label:'担当積込・運搬数量(kg)', data: top.map(r => r.total_qty), backgroundColor:'rgba(16, 185, 129, 0.7)' }]
    },
    options: { responsive:true, maintainAspectRatio:false, indexAxis: 'y', scales:{ x:{ title:{ display:true, text:'積込・運搬数量(kg)' } } } }
  });
}

function trEmptyPanel(msg) {
  return `<div class="bg-white rounded-xl shadow-sm p-10 text-center text-gray-500">
    <i class="fas fa-inbox text-3xl"></i><p class="mt-2">${escapeHtml(msg)}</p>
  </div>`;
}

// ============================================================================
//  運搬用 CSV / PDF 出力 (加工用 exportCsvUnified / exportPdfUnified は変更せず、
//  完全に別関数として実装。日本語対応の PDF フォントロード関数だけは既存の
//  ensureNotoSansJP を再利用する。)
// ============================================================================

function trCsvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function trCsvDownload(rows, filename) {
  const csv = rows.map(row => row.map(trCsvEscape).join(',')).join('\r\n');
  const bom = '\uFEFF';
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
// CSV 用: 数値をそのまま (3桁区切りなし) 出力。Excel で数値として扱えるようにする。
// digits: 表示する最大小数桁数 (未指定=3)。末尾の 0 と不要な "." は削除する。
// 例: 8250 → "8250" / 8250.5 → "8250.5" / 8250.125 → "8250.125" / 8250.500 → "8250.5"
function trCsvNum(n, digits = 3) {
  const v = Number(n);
  if (!isFinite(v)) return '';
  // toFixed で丸めてから末尾の 0 と小数点を削除
  let s = v.toFixed(Math.max(0, Math.min(10, digits)));
  if (s.indexOf('.') >= 0) {
    s = s.replace(/0+$/, '').replace(/\.$/, '');
  }
  return s;
}
// 人工は小数第3位まで、末尾0は保持しない (例: 1 → "1" / 0.5 → "0.5" / 1.125 → "1.125")
function trCsvMd(n) { return trCsvNum(n, 3); }
// 割合(%)など小数1桁固定が望ましいもの用 (前月比・1人工当たりなど)
function trCsvNum1(n) { return trCsvNum(n, 1); }

// フィルタ条件を人間可読な文字列に変換
function trFilterLabel(params) {
  const parts = [];
  if (params.year) parts.push(`年:${params.year}`);
  if (params.dateFrom || params.dateTo) parts.push(`期間:${params.dateFrom || '～'}〜${params.dateTo || '～'}`);
  parts.push(`工場:${params.factory === 'all' || !params.factory ? '全工場合算' : params.factory}`);
  return parts.join(' / ');
}

// ---- CSV: 一覧 ----
function exportTransportListCsv(records, filters) {
  const rows = [];
  rows.push([`積込・運搬実績一覧 出力条件`, trFilterLabel(filters)]);
  rows.push([]);
  rows.push(['日付','工場','積込・運搬人員(人工)','合計人工','積込・運搬車両','積込・運搬数量(kg)','1人工当たり積込・運搬数量(kg/人工)']);
  let totQty = 0, totMd = 0;
  for (const r of records) {
    const workersStr = (r.workers || []).map(w => `${w.worker_name}(${trFmtMd(w.man_days)})`).join('; ');
    const md = Number(r.total_man_days) || 0;
    const qty = Number(r.transport_quantity_kg) || 0;
    const perMd = md > 0 ? qty / md : '';
    rows.push([r.transport_date, r.factory, workersStr, trCsvMd(md), r.vehicle, trCsvNum(qty), perMd !== '' ? trCsvNum(perMd, 1) : '']);
    totQty += qty; totMd += md;
  }
  rows.push([]);
  rows.push(['合計','','', trCsvMd(totMd),'', trCsvNum(totQty), totMd > 0 ? trCsvNum(totQty / totMd, 1) : '']);
  const fn = `積込・運搬実績一覧_${filters.dateFrom || '全期間'}_${filters.dateTo || ''}_${filters.factory === 'all' ? '全体合算' : filters.factory}.csv`;
  trCsvDownload(rows, fn);
}

// ---- CSV: 各分析 ----
function exportTransportAnalysisCsv(kind, data, params, monthly) {
  const rows = [];
  const filterStr = trFilterLabel(params);
  if (kind === 'daily') {
    rows.push(['積込・運搬数量分析(日別) 出力条件', filterStr]);
    rows.push([]);
    rows.push(['日付','積込・運搬数量(kg)','積込・運搬人工','積込・運搬件数','1件当たり積込・運搬数量(kg)','1人工当たり積込・運搬数量(kg/人工)','本社工場積込・運搬数量(kg)','第二工場積込・運搬数量(kg)']);
    let tq=0, tmd=0, trc=0, thh=0, td2=0;
    for (const r of data) {
      rows.push([r.date, trCsvNum(r.total_qty), trCsvMd(r.total_man_days), r.record_count,
        r.record_count > 0 ? trCsvNum(r.qty_per_record) : '',
        r.total_man_days > 0 ? trCsvNum(r.qty_per_man_day, 1) : '',
        trCsvNum(r.honsha_qty), trCsvNum(r.dai2_qty)]);
      tq += Number(r.total_qty)||0; tmd += Number(r.total_man_days)||0; trc += Number(r.record_count)||0;
      thh += Number(r.honsha_qty)||0; td2 += Number(r.dai2_qty)||0;
    }
    rows.push([]);
    rows.push(['合計', trCsvNum(tq), trCsvMd(tmd), trc,
      trc > 0 ? trCsvNum(tq / trc) : '',
      tmd > 0 ? trCsvNum(tq / tmd, 1) : '',
      trCsvNum(thh), trCsvNum(td2)]);
  } else if (kind === 'monthly') {
    rows.push(['積込・運搬数量分析(月別) 出力条件', filterStr]);
    rows.push([]);
    rows.push(['月','積込・運搬数量(kg)','積込・運搬人工','積込・運搬件数','1件当たり積込・運搬数量(kg)','1人工当たり積込・運搬数量(kg/人工)','本社工場積込・運搬数量(kg)','第二工場積込・運搬数量(kg)','前月比増減率(%)']);
    let tq=0, tmd=0, trc=0, thh=0, td2=0;
    for (const r of data) {
      rows.push([r.ym, trCsvNum(r.total_qty), trCsvMd(r.total_man_days), r.record_count,
        r.record_count > 0 ? trCsvNum(r.qty_per_record) : '',
        r.total_man_days > 0 ? trCsvNum(r.qty_per_man_day, 1) : '',
        trCsvNum(r.honsha_qty), trCsvNum(r.dai2_qty),
        r.prev_month_change == null ? '－' : (r.prev_month_change >= 0 ? '+' : '') + trCsvNum(r.prev_month_change * 100, 1) + '%']);
      tq += Number(r.total_qty)||0; tmd += Number(r.total_man_days)||0; trc += Number(r.record_count)||0;
      thh += Number(r.honsha_qty)||0; td2 += Number(r.dai2_qty)||0;
    }
    rows.push([]);
    rows.push(['合計', trCsvNum(tq), trCsvMd(tmd), trc, trc > 0 ? trCsvNum(tq / trc) : '', tmd > 0 ? trCsvNum(tq / tmd, 1) : '', trCsvNum(thh), trCsvNum(td2), '']);
  } else if (kind === 'yearly') {
    rows.push(['積込・運搬数量分析(年別) 出力条件', filterStr]);
    rows.push([]);
    rows.push(['年','積込・運搬数量(kg)','積込・運搬人工','積込・運搬件数','1件当たり積込・運搬数量(kg)','1人工当たり積込・運搬数量(kg/人工)','本社工場積込・運搬数量(kg)','第二工場積込・運搬数量(kg)','前年比増減率(%)']);
    for (const r of data) {
      rows.push([r.year, trCsvNum(r.total_qty), trCsvMd(r.total_man_days), r.record_count,
        r.record_count > 0 ? trCsvNum(r.qty_per_record) : '',
        r.total_man_days > 0 ? trCsvNum(r.qty_per_man_day, 1) : '',
        trCsvNum(r.honsha_qty), trCsvNum(r.dai2_qty),
        r.prev_year_change == null ? '－' : (r.prev_year_change >= 0 ? '+' : '') + trCsvNum(r.prev_year_change * 100, 1) + '%']);
    }
    if (Array.isArray(monthly) && monthly.length > 0) {
      rows.push([]);
      rows.push(['月別推移']);
      rows.push(['月','積込・運搬数量(kg)','積込・運搬人工','1人工当たり積込・運搬数量(kg/人工)']);
      for (const r of monthly) {
        rows.push([r.ym, trCsvNum(r.total_qty), trCsvMd(r.total_man_days), r.total_man_days > 0 ? trCsvNum(r.qty_per_man_day, 1) : '']);
      }
    }
  } else if (kind === 'workers') {
    rows.push(['積込・運搬数量分析(人員別) 出力条件', filterStr]);
    rows.push([]);
    rows.push(['積込・運搬人員','担当人工','担当件数','担当日数','担当積込・運搬数量(kg)','1人工当たり積込・運搬数量(kg/人工)','本社工場積込・運搬数量(kg)','第二工場積込・運搬数量(kg)']);
    let tq=0, tmd=0, thh=0, td2=0;
    for (const r of data) {
      rows.push([r.worker_name, trCsvMd(r.total_man_days), r.record_count, r.days, trCsvNum(r.total_qty),
        r.total_man_days > 0 ? trCsvNum(r.qty_per_man_day, 1) : '',
        trCsvNum(r.honsha_qty), trCsvNum(r.dai2_qty)]);
      tq += Number(r.total_qty)||0; tmd += Number(r.total_man_days)||0;
      thh += Number(r.honsha_qty)||0; td2 += Number(r.dai2_qty)||0;
    }
    rows.push([]);
    rows.push(['合計', trCsvMd(tmd), '', '', trCsvNum(tq), tmd > 0 ? trCsvNum(tq / tmd, 1) : '', trCsvNum(thh), trCsvNum(td2)]);
  }
  const label = ({daily:'日別', monthly:'月別', yearly:'年別', workers:'人員別'})[kind];
  const fn = `積込・運搬数量分析_${label}_${params.dateFrom || params.year || '全期間'}_${params.factory === 'all' ? '全体合算' : params.factory}.csv`;
  trCsvDownload(rows, fn);
}

// ---- PDF ボタン用: 二重クリック防止 + 非同期完了待ち + エラー通知ラッパー ----
// PDF ボタンの onclick から呼び出す。fn は Promise を返す async 関数。
// btnEl は disabled 化する対象のボタン要素。
async function trRunPdfExport(btnEl, fn) {
  if (btnEl && btnEl.disabled) return;
  const originalHtml = btnEl ? btnEl.innerHTML : null;
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>出力中…';
  }
  try {
    await fn();
  } catch (e) {
    // trPdfInit 内で既に alert を出しているケース (フォント読込失敗) と、
    // その他の予期しない例外を切り分けて通知する。
    const already = e && String(e.message || '').includes('font');
    console.error('[trRunPdfExport] PDF出力エラー', e);
    if (!already) alert('PDF出力に失敗しました: ' + (e && e.message ? e.message : String(e)));
  } finally {
    if (btnEl) {
      btnEl.disabled = false;
      if (originalHtml != null) btnEl.innerHTML = originalHtml;
    }
  }
}

// ---- PDF: 共通ヘッダー/フォント ----
// 既存加工PDFで実績のある _loadPdfJapaneseFont / PDF_FONT_NAME をそのまま再利用する。
// (旧実装は存在しない関数 `ensureNotoSansJP` を typeof で参照し常に false 分岐に落ち、
//  フォント未登録のまま jsPDF 標準フォントで描画 → 日本語が全面文字化けしていた。)
// 失敗時は暗黙フォールバックせず、必ず alert + throw で中断する。
async function trPdfInit() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    const msg = 'PDFライブラリの読込に失敗しました (jsPDF)';
    alert(msg); throw new Error(msg);
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  try {
    await _loadPdfJapaneseFont(doc);
  } catch (e) {
    const msg = 'PDF用日本語フォントの読み込みに失敗しました。画面を再読み込みして、もう一度お試しください。';
    console.error('[trPdfInit] font load failed', e);
    alert(msg + '\n\n' + (e && e.message ? e.message : e));
    throw e;
  }
  // フォント登録確認: getFontList() に PDF_FONT_NAME が含まれない場合は
  // 文字化けPDFを出さないよう中断する
  try {
    const list = typeof doc.getFontList === 'function' ? doc.getFontList() : null;
    const registered = !!(list && list[PDF_FONT_NAME]);
    if (!registered) {
      const msg = 'PDF用日本語フォントの読み込みに失敗しました。画面を再読み込みして、もう一度お試しください。';
      console.error('[trPdfInit] font not registered. getFontList=', list);
      alert(msg);
      throw new Error('font not registered: ' + PDF_FONT_NAME);
    }
  } catch (e) {
    if (e && String(e.message || '').startsWith('font not registered')) throw e;
    // getFontList 自体が未実装の古い jsPDF ではスキップ (実運用の jsPDF 2.5.1 では実装済)
    console.warn('[trPdfInit] getFontList not usable, skipping strict check', e);
  }
  doc.setFont(PDF_FONT_NAME, 'normal');
  return doc;
}
// PDF 用: 3桁区切り + 小数最大 digits 桁 (末尾0は削除)
// digits を明示的に指定した場合は minimumFractionDigits = maximumFractionDigits = digits で「固定桁」表示
// (人工の 3桁固定、割合の 1桁固定など)。未指定は最大3桁で末尾0削除 (運搬数量の変動小数用)
// 例: trPdfNum(8250)      → "8,250"
//     trPdfNum(8250.5)    → "8,250.5"
//     trPdfNum(1234.125)  → "1,234.125"
//     trPdfNum(1, 3)      → "1.000"  (人工など固定桁)
//     trPdfNum(1.5, 1)    → "1.5"    (1人工当たりなど固定桁)
function trPdfNum(n, digits) {
  const v = Number(n);
  if (!isFinite(v)) return '';
  if (typeof digits === 'number') {
    // 明示的に固定桁指定 (既存の 3桁/1桁 用途と互換)
    return v.toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  // 変動小数 (最大 3 桁、末尾 0 削除) — 運搬数量の表示用
  return v.toLocaleString('ja-JP', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

// PDF 見出し + フィルタ条件表示
// autoTable 呼出後に jsPDF のカレントフォントが標準フォントへ戻る場合があるため、
// 各テキスト描画前に必ず PDF_FONT_NAME を setFont し直す。
function trPdfHeader(doc, title, params) {
  doc.setFont(PDF_FONT_NAME, 'normal');
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.text(title, 40, 40);
  doc.setFont(PDF_FONT_NAME, 'normal');
  doc.setFontSize(10);
  doc.text(`条件: ${trFilterLabel(params)}`, 40, 58);
  doc.setFont(PDF_FONT_NAME, 'normal');
  doc.text(`出力日時: ${dayjs().format('YYYY-MM-DD HH:mm')}`, 40, 72);
}

// PDF サマリ (5 KPI) を1行の表として描く
function trPdfSummary(doc, startY, summary) {
  doc.autoTable({
    startY,
    head: [summary.map(s => s.label)],
    body: [summary.map(s => s.value)],
    theme: 'grid',
    styles:      { font: PDF_FONT_NAME, fontStyle: 'normal', fontSize: 9, halign: 'center' },
    headStyles:  { font: PDF_FONT_NAME, fontStyle: 'normal', fillColor: [59, 130, 246], textColor: 255 },
    bodyStyles:  { font: PDF_FONT_NAME, fontStyle: 'normal', textColor: [0, 0, 0] }
  });
  return doc.lastAutoTable.finalY + 10;
}

function trBuildKpiSummary(data) {
  const totQty = data.reduce((s, r) => s + (Number(r.total_qty) || 0), 0);
  const totMd = data.reduce((s, r) => s + (Number(r.total_man_days) || 0), 0);
  const totRc = data.reduce((s, r) => s + (Number(r.record_count) || 0), 0);
  return [
    { label: '積込・運搬数量(kg)',    value: trPdfNum(totQty) },
    { label: '積込・運搬人工',        value: trPdfNum(totMd, 3) },
    { label: '積込・運搬件数',        value: String(totRc) },
    { label: '1件当たり(kg)',   value: totRc > 0 ? trPdfNum(totQty / totRc) : '－' },
    { label: '1人工当たり(kg/人工)', value: totMd > 0 ? trPdfNum(totQty / totMd, 1) : '－' }
  ];
}

// ---- PDF: 一覧 ----
async function exportTransportListPdf(records, filters) {
  const doc = await trPdfInit();
  trPdfHeader(doc, '積込・運搬実績一覧', filters);
  const totQty = records.reduce((s, r) => s + (Number(r.transport_quantity_kg) || 0), 0);
  const totMd = records.reduce((s, r) => s + (Number(r.total_man_days) || 0), 0);
  const summary = [
    { label: '積込・運搬件数', value: String(records.length) },
    { label: '積込・運搬数量(kg)', value: trPdfNum(totQty) },
    { label: '人工合計', value: trPdfNum(totMd, 3) },
    { label: '1人工当たり(kg/人工)', value: totMd > 0 ? trPdfNum(totQty / totMd, 1) : '－' }
  ];
  const y = trPdfSummary(doc, 90, summary);
  const body = records.map(r => {
    const md = Number(r.total_man_days) || 0;
    const qty = Number(r.transport_quantity_kg) || 0;
    return [
      r.transport_date, r.factory,
      (r.workers||[]).map(w => `${w.worker_name}(${trFmtMd(w.man_days)})`).join(', '),
      trPdfNum(md, 3), r.vehicle,
      trPdfNum(qty), md > 0 ? trPdfNum(qty / md, 1) : '－'
    ];
  });
  doc.autoTable({
    startY: y,
    head: [['日付','工場','積込・運搬人員(人工)','合計人工','積込・運搬車両','積込・運搬数量(kg)','1人工当たり(kg/人工)']],
    body,
    theme: 'grid',
    styles:     { font: PDF_FONT_NAME, fontStyle: 'normal', fontSize: 8, overflow: 'linebreak', valign: 'middle' },
    headStyles: { font: PDF_FONT_NAME, fontStyle: 'normal', fillColor: [59, 130, 246], textColor: 255, halign: 'center' },
    bodyStyles: { font: PDF_FONT_NAME, fontStyle: 'normal', textColor: [0, 0, 0] },
    columnStyles: {
      0: { cellWidth: 68 }, 1: { cellWidth: 55 }, 2: { cellWidth: 200 },
      3: { cellWidth: 55, halign: 'right' }, 4: { cellWidth: 100 },
      5: { cellWidth: 75, halign: 'right' }, 6: { cellWidth: 80, halign: 'right' }
    },
    showHead: 'everyPage',
    margin: { left: 40, right: 40 }
  });
  const fn = `積込・運搬実績一覧_${filters.dateFrom || '全期間'}_${filters.dateTo || ''}_${filters.factory === 'all' ? '全体合算' : filters.factory}.pdf`;
  doc.save(fn);
}

// ---- PDF: 各分析 ----
async function exportTransportAnalysisPdf(kind, data, params, monthly) {
  const doc = await trPdfInit();
  const label = ({daily:'日別', monthly:'月別', yearly:'年別', workers:'人員別'})[kind];
  trPdfHeader(doc, `積込・運搬数量分析（${label}）`, params);
  const summary = (kind === 'workers')
    ? [
        { label: '登録人員数', value: `${data.length} 人` },
        { label: '積込・運搬数量(kg)', value: trPdfNum(data.reduce((s,r)=>s+(Number(r.total_qty)||0),0)) },
        { label: '積込・運搬人工', value: trPdfNum(data.reduce((s,r)=>s+(Number(r.total_man_days)||0),0), 3) },
        { label: '1人工当たり(kg/人工)', value: (() => { const q = data.reduce((s,r)=>s+(Number(r.total_qty)||0),0); const md = data.reduce((s,r)=>s+(Number(r.total_man_days)||0),0); return md > 0 ? trPdfNum(q/md, 1) : '－'; })() }
      ]
    : trBuildKpiSummary(data);
  const y = trPdfSummary(doc, 90, summary);

  let head, body, colStyles;
  if (kind === 'daily') {
    head = [['日付','積込・運搬数量(kg)','積込・運搬人工','積込・運搬件数','1件当たり(kg)','1人工当たり(kg/人工)','本社工場(kg)','第二工場(kg)']];
    body = data.map(r => [
      r.date, trPdfNum(r.total_qty), trPdfNum(r.total_man_days, 3), String(r.record_count),
      r.record_count > 0 ? trPdfNum(r.qty_per_record) : '－',
      r.total_man_days > 0 ? trPdfNum(r.qty_per_man_day, 1) : '－',
      trPdfNum(r.honsha_qty), trPdfNum(r.dai2_qty)
    ]);
    colStyles = { 1:{halign:'right'},2:{halign:'right'},3:{halign:'right'},4:{halign:'right'},5:{halign:'right'},6:{halign:'right'},7:{halign:'right'} };
  } else if (kind === 'monthly') {
    head = [['月','積込・運搬数量(kg)','積込・運搬人工','積込・運搬件数','1件当たり(kg)','1人工当たり(kg/人工)','本社工場(kg)','第二工場(kg)','前月比(増減率)']];
    body = data.map(r => [
      r.ym, trPdfNum(r.total_qty), trPdfNum(r.total_man_days, 3), String(r.record_count),
      r.record_count > 0 ? trPdfNum(r.qty_per_record) : '－',
      r.total_man_days > 0 ? trPdfNum(r.qty_per_man_day, 1) : '－',
      trPdfNum(r.honsha_qty), trPdfNum(r.dai2_qty),
      r.prev_month_change == null ? '－' : (r.prev_month_change >= 0 ? '+' : '') + trPdfNum(r.prev_month_change * 100, 1) + '%'
    ]);
    colStyles = { 1:{halign:'right'},2:{halign:'right'},3:{halign:'right'},4:{halign:'right'},5:{halign:'right'},6:{halign:'right'},7:{halign:'right'},8:{halign:'right'} };
  } else if (kind === 'yearly') {
    head = [['年','積込・運搬数量(kg)','積込・運搬人工','積込・運搬件数','1件当たり(kg)','1人工当たり(kg/人工)','本社工場(kg)','第二工場(kg)','前年比(増減率)']];
    body = data.map(r => [
      r.year, trPdfNum(r.total_qty), trPdfNum(r.total_man_days, 3), String(r.record_count),
      r.record_count > 0 ? trPdfNum(r.qty_per_record) : '－',
      r.total_man_days > 0 ? trPdfNum(r.qty_per_man_day, 1) : '－',
      trPdfNum(r.honsha_qty), trPdfNum(r.dai2_qty),
      r.prev_year_change == null ? '－' : (r.prev_year_change >= 0 ? '+' : '') + trPdfNum(r.prev_year_change * 100, 1) + '%'
    ]);
    colStyles = { 1:{halign:'right'},2:{halign:'right'},3:{halign:'right'},4:{halign:'right'},5:{halign:'right'},6:{halign:'right'},7:{halign:'right'},8:{halign:'right'} };
  } else if (kind === 'workers') {
    head = [['積込・運搬人員','担当人工','担当件数','担当日数','担当積込・運搬数量(kg)','1人工当たり(kg/人工)','本社工場(kg)','第二工場(kg)']];
    body = data.map(r => [
      r.worker_name, trPdfNum(r.total_man_days, 3), String(r.record_count), String(r.days),
      trPdfNum(r.total_qty),
      r.total_man_days > 0 ? trPdfNum(r.qty_per_man_day, 1) : '－',
      trPdfNum(r.honsha_qty), trPdfNum(r.dai2_qty)
    ]);
    colStyles = { 1:{halign:'right'},2:{halign:'right'},3:{halign:'right'},4:{halign:'right'},5:{halign:'right'},6:{halign:'right'},7:{halign:'right'} };
  }

  doc.autoTable({
    startY: y, head, body,
    theme: 'grid',
    styles:     { font: PDF_FONT_NAME, fontStyle: 'normal', fontSize: 8, overflow: 'linebreak', valign: 'middle' },
    headStyles: { font: PDF_FONT_NAME, fontStyle: 'normal', fillColor: [59, 130, 246], textColor: 255, halign: 'center' },
    bodyStyles: { font: PDF_FONT_NAME, fontStyle: 'normal', textColor: [0, 0, 0] },
    columnStyles: colStyles,
    showHead: 'everyPage',
    margin: { left: 40, right: 40 }
  });

  // 年別のときは月別推移表も追加
  if (kind === 'yearly' && Array.isArray(monthly) && monthly.length > 0) {
    const y2 = doc.lastAutoTable.finalY + 15;
    // autoTable 後は jsPDF カレントフォントが標準に戻る場合があるため setFont を再指定
    doc.setFont(PDF_FONT_NAME, 'normal');
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.text('月別推移', 40, y2);
    doc.autoTable({
      startY: y2 + 6,
      head: [['月','積込・運搬数量(kg)','積込・運搬人工','1人工当たり(kg/人工)']],
      body: monthly.map(r => [ r.ym, trPdfNum(r.total_qty), trPdfNum(r.total_man_days, 3), r.total_man_days > 0 ? trPdfNum(r.qty_per_man_day, 1) : '－' ]),
      theme: 'grid',
      styles:     { font: PDF_FONT_NAME, fontStyle: 'normal', fontSize: 8, overflow: 'linebreak', valign: 'middle' },
      headStyles: { font: PDF_FONT_NAME, fontStyle: 'normal', fillColor: [16, 185, 129], textColor: 255, halign: 'center' },
      bodyStyles: { font: PDF_FONT_NAME, fontStyle: 'normal', textColor: [0, 0, 0] },
      columnStyles: { 1:{halign:'right'},2:{halign:'right'},3:{halign:'right'} },
      showHead: 'everyPage',
      margin: { left: 40, right: 40 }
    });
  }

  const fn = `積込・運搬数量分析_${label}_${params.dateFrom || params.year || '全期間'}_${params.factory === 'all' ? '全体合算' : params.factory}.pdf`;
  doc.save(fn);
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
