// 村田鉄筋㈱ 加工数量分析システム - フロントエンド
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

const state = {
  user: null,
  view: 'dashboard', // dashboard / input / list / daily / monthly / yearly / compare / target
  records: [],
  factoryFilter: 'all',
  yearFilter: String(new Date().getFullYear()),
  monthFilter: '',
  dateFrom: '',
  dateTo: '',
  qtyUnit: 'kg', // 'kg' or 't'
  editingId: null,
  charts: {}
};

const fmt = {
  num(n) {
    if (n == null || isNaN(n)) return '0';
    return Number(n).toLocaleString('ja-JP', { maximumFractionDigits: 1 });
  },
  qty(kg) {
    if (kg == null) return '0';
    if (state.qtyUnit === 't') {
      return Number(kg / 1000).toLocaleString('ja-JP', { maximumFractionDigits: 2 }) + ' t';
    }
    return Number(kg).toLocaleString('ja-JP', { maximumFractionDigits: 1 }) + ' kg';
  },
  qtyVal(kg) {
    if (kg == null) return 0;
    return state.qtyUnit === 't' ? kg / 1000 : kg;
  },
  date(d) {
    if (!d) return '';
    return dayjs(d).format('YYYY/MM/DD');
  }
};

const api = {
  async login(username, password) {
    const res = await axios.post('/api/auth/login', { username, password });
    return res.data;
  },
  async logout() { await axios.post('/api/auth/logout'); },
  async me() {
    try { return (await axios.get('/api/auth/me')).data.user; } catch { return null; }
  },
  async listRecords(params = {}) {
    return (await axios.get('/api/records', { params })).data.records;
  },
  async getRecord(id) { return (await axios.get(`/api/records/${id}`)).data.record; },
  async createRecord(data) { return (await axios.post('/api/records', data)).data; },
  async updateRecord(id, data) { return (await axios.put(`/api/records/${id}`, data)).data; },
  async deleteRecord(id) { return (await axios.delete(`/api/records/${id}`)).data; },
  async previousRecord(date, factory) {
    return (await axios.get('/api/records/copy/previous', { params: { date, factory } })).data.record;
  },
  async daily(params) { return (await axios.get('/api/analytics/daily', { params })).data.data; },
  async monthly(params) { return (await axios.get('/api/analytics/monthly', { params })).data.data; },
  async yearly(params) { return (await axios.get('/api/analytics/yearly', { params })).data.data; },
  async dashboard() { return (await axios.get('/api/analytics/dashboard')).data; },
  async targets(year) { return (await axios.get('/api/targets', { params: { year } })).data.targets; },
  async setTarget(data) { return (await axios.post('/api/targets', data)).data; }
};

// ===== 認証画面 =====
function renderLogin() {
  document.getElementById('app').innerHTML = `
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
        <div class="mt-6 text-xs text-gray-500 border-t pt-4">
          <p class="font-semibold">初期アカウント:</p>
          <p>管理者: <code>admin</code> / <code>admin123</code></p>
          <p>一般: <code>user1</code> / <code>user123</code></p>
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
      await loadAndRender();
    } catch (err) {
      errEl.textContent = err.response?.data?.error || 'ログインに失敗しました';
      errEl.classList.remove('hidden');
    }
  });
}

// ===== レイアウト =====
function renderLayout() {
  const u = state.user;
  document.getElementById('app').innerHTML = `
    <div class="min-h-screen flex flex-col">
      <header class="bg-white shadow-sm border-b sticky top-0 z-30 no-print">
        <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <i class="fas fa-industry text-blue-600 text-2xl"></i>
            <div>
              <h1 class="font-bold text-gray-800 leading-tight">村田鉄筋㈱</h1>
              <p class="text-xs text-gray-500 leading-tight">加工数量分析システム</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm text-gray-600 hidden md:inline">
              <i class="fas fa-user-circle mr-1"></i>${u.display_name}
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
          ${u.role==='admin' ? navBtn('target','bullseye','月間目標設定') : ''}
        </nav>
      </header>
      <main id="main" class="flex-1 max-w-7xl w-full mx-auto p-4">
        <div class="text-center py-10"><i class="fas fa-spinner fa-spin text-3xl text-blue-600"></i></div>
      </main>
      <footer class="bg-white border-t py-3 text-center text-xs text-gray-500 no-print">
        村田鉄筋㈱ 加工数量分析システム
      </footer>
    </div>
  `;
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await api.logout();
    state.user = null;
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
  renderMain();
}

// ===== メインビュー =====
async function renderMain() {
  const main = document.getElementById('main');
  main.innerHTML = `<div class="text-center py-10"><i class="fas fa-spinner fa-spin text-3xl text-blue-600"></i></div>`;
  switch (state.view) {
    case 'dashboard': await renderDashboard(); break;
    case 'input': renderInput(); break;
    case 'list': await renderList(); break;
    case 'daily': await renderDaily(); break;
    case 'monthly': await renderMonthly(); break;
    case 'yearly': await renderYearly(); break;
    case 'compare': await renderCompare(); break;
    case 'target': await renderTargets(); break;
  }
}

// ===== ダッシュボード =====
async function renderDashboard() {
  const data = await api.dashboard();
  const todayHonsha = data.today.rows.find(r=>r.factory==='本社工場')?.qty || 0;
  const todayDai2 = data.today.rows.find(r=>r.factory==='第二工場')?.qty || 0;
  const todayTotal = todayHonsha + todayDai2;
  const todayStaff = data.today.rows.reduce((s,r)=>s+(r.staff||0),0);

  const monthHonsha = data.month.rows.find(r=>r.factory==='本社工場')?.qty || 0;
  const monthDai2 = data.month.rows.find(r=>r.factory==='第二工場')?.qty || 0;
  const monthTotal = monthHonsha + monthDai2;
  const monthStaff = data.month.rows.reduce((s,r)=>s+(r.staff||0),0);
  const monthDays = Math.max(...data.month.rows.map(r=>r.days||0), 0);

  const yearHonsha = data.year.rows.find(r=>r.factory==='本社工場')?.qty || 0;
  const yearDai2 = data.year.rows.find(r=>r.factory==='第二工場')?.qty || 0;
  const yearTotal = yearHonsha + yearDai2;

  // 月間目標取得
  const ym = dayjs().format('YYYY-MM').split('-');
  const targets = await api.targets(ym[0]);
  const targetThis = targets.find(t => t.year==Number(ym[0]) && t.month==Number(ym[1]) && t.factory==='全体');
  const targetRate = targetThis && targetThis.target_qty > 0 ? (monthTotal / targetThis.target_qty * 100) : null;

  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-tachometer-alt mr-2"></i>ダッシュボード</h2>
        ${unitToggle()}
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div class="stat-card all">
          <div class="label"><i class="fas fa-calendar-day mr-1"></i>今日 (${dayjs(data.today.date).format('YYYY/MM/DD')})</div>
          <div class="value">${fmt.qty(todayTotal)}</div>
          <div class="sub">人員 ${todayStaff}人 / 1人あたり ${todayStaff>0?fmt.qty(todayTotal/todayStaff):'-'}</div>
        </div>
        <div class="stat-card all">
          <div class="label"><i class="fas fa-calendar-alt mr-1"></i>今月 (${dayjs(data.month.ym).format('YYYY年M月')})</div>
          <div class="value">${fmt.qty(monthTotal)}</div>
          <div class="sub">稼働${monthDays}日 / 延べ${monthStaff}人 / 1人あたり ${monthStaff>0?fmt.qty(monthTotal/monthStaff):'-'}</div>
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

  // 部位別円グラフ
  const parts = data.month.parts || {};
  const partsLabels = PART_KEYS.map(k => PART_LABELS[k]);
  const partsData = PART_KEYS.map(k => fmt.qtyVal(parts[k]||0));
  const partsColors = PART_KEYS.map(k => PART_COLORS[k]);
  createChart('partsChart', {
    type: 'doughnut',
    data: { labels: partsLabels, datasets: [{ data: partsData, backgroundColor: partsColors }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
  });
  createChart('factoryChart', {
    type: 'bar',
    data: {
      labels: ['本社工場','第二工場'],
      datasets: [{ label: `今月 (${state.qtyUnit})`, data: [fmt.qtyVal(monthHonsha), fmt.qtyVal(monthDai2)], backgroundColor: [FACTORY_COLORS['本社工場'], FACTORY_COLORS['第二工場']] }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });
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

function createChart(canvasId, config) {
  const el = document.getElementById(canvasId);
  if (!el) return;
  if (state.charts[canvasId]) { state.charts[canvasId].destroy(); }
  state.charts[canvasId] = new Chart(el, config);
}

// ===== 入力画面 =====
function renderInput(record = null) {
  state.editingId = record?.id || null;
  const isEdit = !!record;
  const r = record || {
    date: dayjs().format('YYYY-MM-DD'),
    factory: '本社工場',
    staff_count: '',
    foundation_qty:'', base_qty:'', column_qty:'', beam_qty:'', fukashi_qty:'',
    slab_qty:'', doma_qty:'', civil_qty:'', wooden_qty:'', other_qty:'',
    note: ''
  };
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="max-w-3xl mx-auto">
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
            <label class="block text-sm font-medium text-gray-700 mb-1">人員数</label>
            <input id="staff_count" type="number" min="0" step="1" value="${r.staff_count}" class="input-num" placeholder="例: 8" />
          </div>
        </div>

        ${!isEdit ? `
        <div class="bg-blue-50 p-3 rounded-lg flex items-center justify-between">
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
            ${PART_KEYS.map((k, i) => `
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1 part-${k.replace('_qty','')} px-2 py-1 rounded">
                  ${PART_LABELS[k]}
                </label>
                <input id="${k}" type="number" min="0" step="1" value="${r[k]||''}" class="input-num qty-input" placeholder="0" />
              </div>
            `).join('')}
          </div>
        </div>

        <div class="bg-gray-50 p-4 rounded-lg flex items-center justify-between">
          <div>
            <p class="text-sm text-gray-600">総加工数量</p>
            <p id="totalDisplay" class="text-2xl font-bold text-blue-700">0 kg</p>
          </div>
          <div>
            <p class="text-sm text-gray-600">1人あたり加工数量</p>
            <p id="perDisplay" class="text-2xl font-bold text-green-700">0 kg</p>
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">備考</label>
          <textarea id="note" rows="2" class="input-base" placeholder="任意">${r.note||''}</textarea>
        </div>

        <div class="flex gap-3 pt-2">
          <button type="submit" class="btn-primary flex-1">
            <i class="fas fa-save mr-2"></i>${isEdit?'更新する':'登録する'}
          </button>
          ${isEdit ? `<button type="button" id="cancelEdit" class="btn-secondary">キャンセル</button>` : ''}
        </div>
        <div id="formError" class="text-red-600 text-sm hidden"></div>
      </form>
    </div>
  `;

  const recalc = () => {
    let total = 0;
    PART_KEYS.forEach(k => { total += Number(document.getElementById(k).value) || 0; });
    const staff = Number(document.getElementById('staff_count').value) || 0;
    const per = staff > 0 ? total / staff : 0;
    document.getElementById('totalDisplay').textContent = fmt.num(total) + ' kg';
    document.getElementById('perDisplay').textContent = staff > 0 ? fmt.num(per) + ' kg' : '-';
  };
  document.querySelectorAll('#recordForm input, #recordForm select').forEach(el => el.addEventListener('input', recalc));
  recalc();

  const copyBtn = document.getElementById('copyPrevBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const date = document.getElementById('date').value;
      const factory = document.getElementById('factory').value;
      try {
        const prev = await api.previousRecord(date, factory);
        if (!prev) { alert('過去データがありません'); return; }
        PART_KEYS.forEach(k => { document.getElementById(k).value = prev[k] || ''; });
        document.getElementById('staff_count').value = prev.staff_count || '';
        recalc();
        alert(`${prev.date} のデータをコピーしました`);
      } catch (e) {
        alert('取得に失敗しました');
      }
    });
  }

  document.getElementById('cancelEdit')?.addEventListener('click', () => {
    state.editingId = null;
    navigateTo('list');
  });

  document.getElementById('recordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      date: document.getElementById('date').value,
      factory: document.getElementById('factory').value,
      staff_count: document.getElementById('staff_count').value,
      note: document.getElementById('note').value
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
        recalc();
      }
    } catch (e) {
      err.textContent = e.response?.data?.error || '保存に失敗しました';
      err.classList.remove('hidden');
    }
  });
}

// ===== 一覧画面 =====
async function renderList() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-table mr-2"></i>加工実績一覧</h2>
        <div class="flex gap-2">
          ${unitToggle()}
          <button id="csvBtn" class="btn-secondary text-sm"><i class="fas fa-file-csv mr-1"></i>CSV</button>
          <button id="pdfBtn" class="btn-secondary text-sm"><i class="fas fa-file-pdf mr-1"></i>PDF</button>
        </div>
      </div>
      <div class="bg-white p-4 rounded-xl shadow-sm">
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div><label class="block text-xs text-gray-600 mb-1">開始日</label><input id="fDateFrom" type="date" value="${state.dateFrom}" class="input-base" /></div>
          <div><label class="block text-xs text-gray-600 mb-1">終了日</label><input id="fDateTo" type="date" value="${state.dateTo}" class="input-base" /></div>
          <div><label class="block text-xs text-gray-600 mb-1">年</label><input id="fYear" type="number" value="${state.yearFilter}" class="input-base" /></div>
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
        <div class="flex gap-2 mt-3">
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
  const params = {};
  if (state.dateFrom) params.dateFrom = state.dateFrom;
  if (state.dateTo) params.dateTo = state.dateTo;
  if (state.yearFilter) params.year = state.yearFilter;
  if (state.monthFilter) params.month = state.monthFilter;
  if (state.factoryFilter && state.factoryFilter !== 'all') params.factory = state.factoryFilter;
  state.records = await api.listRecords(params);
  renderListTable();
}

function renderListTable() {
  const area = document.getElementById('listArea');
  if (state.records.length === 0) {
    area.innerHTML = `<div class="text-center py-10 text-gray-500"><i class="fas fa-inbox text-4xl mb-2"></i><p>データがありません</p></div>`;
    return;
  }
  // 平均を計算してロー基準
  const perValues = state.records.map(r => r.qty_per_person || 0).filter(v => v > 0);
  const avgPer = perValues.length ? perValues.reduce((a,b)=>a+b,0) / perValues.length : 0;

  const isAdmin = state.user.role === 'admin';
  area.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>日付</th><th>工場</th><th>人員</th>
          ${PART_KEYS.map(k=>`<th class="part-${k.replace('_qty','')}">${PART_LABELS[k]}</th>`).join('')}
          <th>総加工量</th><th>1人あたり</th><th>備考</th><th class="no-print">操作</th>
        </tr>
      </thead>
      <tbody>
        ${state.records.map(r => {
          const lowQty = r.total_qty > 0 && r.total_qty < 5000;
          const highPer = r.qty_per_person > 0 && avgPer > 0 && r.qty_per_person > avgPer * 1.2;
          return `<tr class="${lowQty?'low-qty':''} ${highPer?'high-perperson':''}">
            <td class="text">${fmt.date(r.date)}</td>
            <td class="text"><span class="px-2 py-1 rounded text-xs ${r.factory==='本社工場'?'badge-honsha':'badge-dai2'}">${r.factory}</span></td>
            <td>${r.staff_count}</td>
            ${PART_KEYS.map(k=>`<td>${fmt.qty(r[k])}</td>`).join('')}
            <td class="font-bold">${fmt.qty(r.total_qty)}</td>
            <td>${r.qty_per_person>0?fmt.qty(r.qty_per_person):'-'}</td>
            <td class="text text-xs">${r.note||''}</td>
            <td class="no-print">
              <div class="flex gap-1 justify-center">
                <button data-edit="${r.id}" class="text-blue-600 hover:underline text-xs"><i class="fas fa-edit"></i> 編集</button>
                ${isAdmin?`<button data-del="${r.id}" class="text-red-600 hover:underline text-xs"><i class="fas fa-trash"></i> 削除</button>`:''}
              </div>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
  document.querySelectorAll('[data-edit]').forEach(b => {
    b.addEventListener('click', async () => {
      const rec = await api.getRecord(b.dataset.edit);
      navigateTo('input');
      setTimeout(() => renderInput(rec), 0);
    });
  });
  document.querySelectorAll('[data-del]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm('削除してよろしいですか?')) return;
      await api.deleteRecord(b.dataset.del);
      loadListData();
    });
  });
}

// ===== 日別分析 =====
async function renderDaily() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="space-y-4">
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
        <div class="flex items-end gap-2">
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
    const dateFrom = document.getElementById('dFrom').value;
    const dateTo = document.getElementById('dTo').value;
    const factory = document.getElementById('dFactory').value;
    const data = await api.daily({ dateFrom, dateTo, factory });

    // chart: 日付ごとに合算 (工場別を積み上げ)
    const dates = [...new Set(data.map(d => d.date))].sort();
    const honshaData = dates.map(d => fmt.qtyVal(data.find(x=>x.date===d && x.factory==='本社工場')?.total_qty||0));
    const dai2Data = dates.map(d => fmt.qtyVal(data.find(x=>x.date===d && x.factory==='第二工場')?.total_qty||0));
    const datasets = [];
    if (factory === 'all' || factory === '本社工場') datasets.push({ label: '本社工場', data: honshaData, backgroundColor: FACTORY_COLORS['本社工場'] });
    if (factory === 'all' || factory === '第二工場') datasets.push({ label: '第二工場', data: dai2Data, backgroundColor: FACTORY_COLORS['第二工場'] });
    createChart('dailyChart', {
      type: 'bar',
      data: { labels: dates.map(d => dayjs(d).format('M/D')), datasets },
      options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: factory==='all' }, y: { stacked: factory==='all', beginAtZero: true, title: { display: true, text: state.qtyUnit } } } }
    });

    // テーブル
    const tableEl = document.getElementById('dailyTable');
    tableEl.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>日付</th><th>工場</th><th>人員</th>
          ${PART_KEYS.map(k=>`<th>${PART_LABELS[k]}</th>`).join('')}
          <th>合計</th><th>1人あたり</th>
        </tr></thead>
        <tbody>
          ${data.map(r => `<tr>
            <td class="text">${fmt.date(r.date)}</td>
            <td class="text"><span class="px-2 py-1 rounded text-xs ${r.factory==='本社工場'?'badge-honsha':'badge-dai2'}">${r.factory}</span></td>
            <td>${r.staff_count}</td>
            ${PART_KEYS.map(k=>`<td>${fmt.qty(r[k])}</td>`).join('')}
            <td class="font-bold">${fmt.qty(r.total_qty)}</td>
            <td>${r.qty_per_person>0?fmt.qty(r.qty_per_person):'-'}</td>
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

// ===== 月別分析 =====
async function renderMonthly() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-calendar-alt mr-2"></i>月別分析</h2>
        ${unitToggle()}
      </div>
      <div class="bg-white p-4 rounded-xl shadow-sm grid grid-cols-2 md:grid-cols-4 gap-3">
        <div><label class="block text-xs text-gray-600 mb-1">年</label><input id="mYear" type="number" value="${state.yearFilter}" class="input-base" /></div>
        <div>
          <label class="block text-xs text-gray-600 mb-1">工場</label>
          <select id="mFactory" class="input-base">
            <option value="all">全体合算</option>
            <option value="本社工場">本社工場のみ</option>
            <option value="第二工場">第二工場のみ</option>
          </select>
        </div>
        <div class="flex items-end gap-2">
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
    const year = document.getElementById('mYear').value;
    const factory = document.getElementById('mFactory').value;
    const data = await api.monthly({ year, factory });
    const months = [...new Set(data.map(d => d.ym))].sort();
    const honshaData = months.map(m => fmt.qtyVal(data.find(x=>x.ym===m && x.factory==='本社工場')?.total_qty||0));
    const dai2Data = months.map(m => fmt.qtyVal(data.find(x=>x.ym===m && x.factory==='第二工場')?.total_qty||0));
    const datasets = [];
    if (factory === 'all' || factory === '本社工場') datasets.push({ label: '本社工場', data: honshaData, backgroundColor: FACTORY_COLORS['本社工場'] });
    if (factory === 'all' || factory === '第二工場') datasets.push({ label: '第二工場', data: dai2Data, backgroundColor: FACTORY_COLORS['第二工場'] });
    createChart('monthlyChart', {
      type: 'bar',
      data: { labels: months.map(m => dayjs(m+'-01').format('YYYY/M月')), datasets },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, title: { display: true, text: state.qtyUnit } } } }
    });

    document.getElementById('monthlyTable').innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>月</th><th>工場</th><th>稼働日</th><th>延べ人員</th>
          ${PART_KEYS.map(k=>`<th>${PART_LABELS[k]}</th>`).join('')}
          <th>月間合計</th><th>1日平均</th><th>1人平均</th>
        </tr></thead>
        <tbody>
          ${data.map(r => `<tr>
            <td class="text">${dayjs(r.ym+'-01').format('YYYY/M月')}</td>
            <td class="text"><span class="px-2 py-1 rounded text-xs ${r.factory==='本社工場'?'badge-honsha':'badge-dai2'}">${r.factory}</span></td>
            <td>${r.days}</td>
            <td>${r.staff_count}</td>
            ${PART_KEYS.map(k=>`<td>${fmt.qty(r[k])}</td>`).join('')}
            <td class="font-bold">${fmt.qty(r.total_qty)}</td>
            <td>${fmt.qty(r.avg_daily_qty)}</td>
            <td>${r.qty_per_person>0?fmt.qty(r.qty_per_person):'-'}</td>
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

// ===== 年間分析 =====
async function renderYearly() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="space-y-4">
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
        <div class="flex items-end gap-2">
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
          <h3 class="font-semibold mb-2">月別推移 (1人あたり)</h3>
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
    const factory = document.getElementById('yFactory').value;
    const trendYear = document.getElementById('yTrendYear').value;
    const data = await api.yearly({ factory });

    const years = [...new Set(data.map(d => d.year))].sort();
    const honshaData = years.map(y => fmt.qtyVal(data.find(x=>x.year===y && x.factory==='本社工場')?.total_qty||0));
    const dai2Data = years.map(y => fmt.qtyVal(data.find(x=>x.year===y && x.factory==='第二工場')?.total_qty||0));
    const ds = [];
    if (factory==='all'||factory==='本社工場') ds.push({ label:'本社工場', data:honshaData, backgroundColor:FACTORY_COLORS['本社工場']});
    if (factory==='all'||factory==='第二工場') ds.push({ label:'第二工場', data:dai2Data, backgroundColor:FACTORY_COLORS['第二工場']});
    createChart('yearlyChart', {
      type: 'bar',
      data: { labels: years.map(y=>y+'年'), datasets: ds },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, title: { display: true, text: state.qtyUnit } } } }
    });

    // 月別推移 (指定年の1人あたり)
    const monthly = await api.monthly({ year: trendYear, factory });
    const yms = Array.from({length:12}, (_,i)=>`${trendYear}-${String(i+1).padStart(2,'0')}`);
    const perHonsha = yms.map(ym => monthly.find(x=>x.ym===ym && x.factory==='本社工場')?.qty_per_person||0);
    const perDai2 = yms.map(ym => monthly.find(x=>x.ym===ym && x.factory==='第二工場')?.qty_per_person||0);
    const trendDs = [];
    if (factory==='all'||factory==='本社工場') trendDs.push({ label:'本社工場 1人あたり', data:perHonsha.map(fmt.qtyVal), borderColor:FACTORY_COLORS['本社工場'], backgroundColor:FACTORY_COLORS['本社工場']+'33', fill: false, tension: 0.2 });
    if (factory==='all'||factory==='第二工場') trendDs.push({ label:'第二工場 1人あたり', data:perDai2.map(fmt.qtyVal), borderColor:FACTORY_COLORS['第二工場'], backgroundColor:FACTORY_COLORS['第二工場']+'33', fill: false, tension: 0.2 });
    createChart('trendChart', {
      type: 'line',
      data: { labels: yms.map(y => dayjs(y+'-01').format('M月')), datasets: trendDs },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, title: { display: true, text: state.qtyUnit + ' / 人' } } } }
    });

    // 部位別年間 (全年合計)
    const partsTotal = {};
    PART_KEYS.forEach(k => { partsTotal[k] = data.reduce((s,r)=>s+(r[k]||0),0); });
    createChart('yearPartsChart', {
      type: 'bar',
      data: {
        labels: PART_KEYS.map(k => PART_LABELS[k]),
        datasets: [{ label: '部位別合計 (' + state.qtyUnit + ')', data: PART_KEYS.map(k => fmt.qtyVal(partsTotal[k])), backgroundColor: PART_KEYS.map(k => PART_COLORS[k]) }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });

    document.getElementById('yearlyTable').innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>年</th><th>工場</th><th>稼働日</th><th>延べ人員</th>
          ${PART_KEYS.map(k=>`<th>${PART_LABELS[k]}</th>`).join('')}
          <th>年間合計</th><th>1人あたり</th>
        </tr></thead>
        <tbody>
          ${data.map(r => `<tr>
            <td class="text">${r.year}年</td>
            <td class="text"><span class="px-2 py-1 rounded text-xs ${r.factory==='本社工場'?'badge-honsha':'badge-dai2'}">${r.factory}</span></td>
            <td>${r.days}</td>
            <td>${r.staff_count}</td>
            ${PART_KEYS.map(k=>`<td>${fmt.qty(r[k])}</td>`).join('')}
            <td class="font-bold">${fmt.qty(r.total_qty)}</td>
            <td>${r.qty_per_person>0?fmt.qty(r.qty_per_person):'-'}</td>
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

// ===== 工場比較 =====
async function renderCompare() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-balance-scale mr-2"></i>工場比較</h2>
        ${unitToggle()}
      </div>
      <div class="bg-white p-4 rounded-xl shadow-sm grid grid-cols-2 md:grid-cols-4 gap-3">
        <div><label class="block text-xs text-gray-600 mb-1">年</label><input id="cYear" type="number" value="${new Date().getFullYear()}" class="input-base" /></div>
        <div class="flex items-end gap-2 md:col-span-3">
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
    const year = document.getElementById('cYear').value;
    const data = await api.monthly({ year });
    const honsha = data.filter(d=>d.factory==='本社工場');
    const dai2 = data.filter(d=>d.factory==='第二工場');
    const sum = (arr, key) => arr.reduce((s,r)=>s+(Number(r[key])||0),0);
    const honshaTotal = sum(honsha, 'total_qty');
    const dai2Total = sum(dai2, 'total_qty');
    const honshaStaff = sum(honsha, 'staff_count');
    const dai2Staff = sum(dai2, 'staff_count');

    document.getElementById('compareKpi').innerHTML = `
      <div class="stat-card honsha"><div class="label">本社工場 (${year}年)</div><div class="value text-blue-700">${fmt.qty(honshaTotal)}</div><div class="sub">延べ${honshaStaff}人 / 1人あたり ${honshaStaff>0?fmt.qty(honshaTotal/honshaStaff):'-'}</div></div>
      <div class="stat-card dai2"><div class="label">第二工場 (${year}年)</div><div class="value text-green-700">${fmt.qty(dai2Total)}</div><div class="sub">延べ${dai2Staff}人 / 1人あたり ${dai2Staff>0?fmt.qty(dai2Total/dai2Staff):'-'}</div></div>
      <div class="stat-card all"><div class="label">合計</div><div class="value">${fmt.qty(honshaTotal+dai2Total)}</div><div class="sub">本社 ${honshaTotal+dai2Total>0?(honshaTotal/(honshaTotal+dai2Total)*100).toFixed(1):0}% / 第二 ${honshaTotal+dai2Total>0?(dai2Total/(honshaTotal+dai2Total)*100).toFixed(1):0}%</div></div>
    `;

    // 月別比較
    const months = Array.from({length:12},(_,i)=>`${year}-${String(i+1).padStart(2,'0')}`);
    const mh = months.map(m => fmt.qtyVal(honsha.find(x=>x.ym===m)?.total_qty||0));
    const md = months.map(m => fmt.qtyVal(dai2.find(x=>x.ym===m)?.total_qty||0));
    createChart('cmpMonth', {
      type:'bar',
      data:{ labels: months.map(m => dayjs(m+'-01').format('M月')), datasets: [
        { label:'本社工場', data: mh, backgroundColor: FACTORY_COLORS['本社工場'] },
        { label:'第二工場', data: md, backgroundColor: FACTORY_COLORS['第二工場'] }
      ]},
      options:{ responsive:true, maintainAspectRatio:false, scales:{y:{beginAtZero:true, title:{display:true,text:state.qtyUnit}}}}
    });

    // 部位別比較
    const ph = PART_KEYS.map(k => fmt.qtyVal(sum(honsha, k)));
    const pd = PART_KEYS.map(k => fmt.qtyVal(sum(dai2, k)));
    createChart('cmpParts', {
      type:'bar',
      data:{ labels: PART_KEYS.map(k=>PART_LABELS[k]), datasets:[
        { label:'本社工場', data: ph, backgroundColor: FACTORY_COLORS['本社工場'] },
        { label:'第二工場', data: pd, backgroundColor: FACTORY_COLORS['第二工場'] }
      ]},
      options:{ responsive:true, maintainAspectRatio:false, scales:{y:{beginAtZero:true, title:{display:true,text:state.qtyUnit}}}}
    });

    // 表
    document.getElementById('cmpTable').innerHTML = `
      <table class="data-table">
        <thead><tr><th>月</th><th>本社工場</th><th>第二工場</th><th>合計</th><th>本社比率</th></tr></thead>
        <tbody>
          ${months.map(m => {
            const h = honsha.find(x=>x.ym===m)?.total_qty || 0;
            const d = dai2.find(x=>x.ym===m)?.total_qty || 0;
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
        const h = honsha.find(x=>x.ym===m)?.total_qty || 0;
        const d = dai2.find(x=>x.ym===m)?.total_qty || 0;
        return { 月: m, 本社工場: h, 第二工場: d, 合計: h+d };
      });
      exportCSV('工場別比較', rows, ['月','本社工場','第二工場','合計']);
    };
    document.getElementById('cPdf').onclick = () => exportPDF('工場別比較レポート', data, 'compare');
  };
  document.getElementById('cApply').addEventListener('click', load);
  await load();
}

// ===== 月間目標設定 =====
async function renderTargets() {
  const main = document.getElementById('main');
  const year = new Date().getFullYear();
  const targets = await api.targets(year);
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
          <div><label class="block text-xs text-gray-600 mb-1">目標 (kg)</label><input id="tQty" type="number" min="0" step="100" class="input-num" /></div>
          <button type="submit" class="btn-primary"><i class="fas fa-save mr-1"></i>登録/更新</button>
        </form>
      </div>
      <div class="bg-white rounded-xl shadow-sm overflow-x-auto">
        <table class="data-table">
          <thead><tr><th>年</th><th>月</th><th>工場</th><th>目標</th></tr></thead>
          <tbody>
            ${targets.map(t => `<tr>
              <td class="text">${t.year}</td>
              <td class="text">${t.month}月</td>
              <td class="text">${t.factory}</td>
              <td>${fmt.qty(t.target_qty)}</td>
            </tr>`).join('') || '<tr><td colspan="4" class="text-center text-gray-500 py-4">未登録</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
  document.getElementById('targetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api.setTarget({
      year: Number(document.getElementById('tYear').value),
      month: Number(document.getElementById('tMonth').value),
      factory: document.getElementById('tFactory').value,
      target_qty: Number(document.getElementById('tQty').value)
    });
    alert('保存しました');
    renderTargets();
  });
}

// ===== CSV / PDF 出力ユーティリティ =====
function exportCSV(name, rows, keys) {
  if (!rows || rows.length === 0) { alert('データがありません'); return; }
  const labelMap = { ...PART_LABELS, date:'日付', factory:'工場', staff_count:'人員数', total_qty:'総加工量(kg)', qty_per_person:'1人あたり(kg)', ym:'年月', year:'年', days:'稼働日', avg_daily_qty:'1日平均(kg)', note:'備考' };
  const header = keys.map(k => labelMap[k] || k).join(',');
  const body = rows.map(r => keys.map(k => {
    const v = r[k];
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
  if (state.records.length === 0) { alert('データがありません'); return; }
  const keys = ['date','factory','staff_count',...PART_KEYS,'total_qty','qty_per_person','note'];
  exportCSV('加工実績一覧', state.records, keys);
}

function exportListPDF() {
  if (state.records.length === 0) { alert('データがありません'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFontSize(14);
  doc.text('Murata Tekkin - Processing Records', 14, 14);
  doc.setFontSize(9);
  doc.text(`Generated: ${dayjs().format('YYYY-MM-DD HH:mm')}  Unit: ${state.qtyUnit}`, 14, 20);

  const head = [['Date','Factory','Staff', ...PART_KEYS.map(k => PART_LABELS[k]), 'Total','Per Person']];
  const body = state.records.map(r => [
    r.date, r.factory, r.staff_count,
    ...PART_KEYS.map(k => fmt.qty(r[k]).replace(/\s.*/,'')),
    fmt.qty(r.total_qty).replace(/\s.*/,''),
    r.qty_per_person>0?fmt.qty(r.qty_per_person).replace(/\s.*/,''):'-'
  ]);
  doc.autoTable({ head, body, startY: 24, styles: { fontSize: 7, cellPadding: 1 }, headStyles: { fillColor: [37,99,235] } });
  doc.save(`加工実績一覧_${dayjs().format('YYYYMMDD_HHmmss')}.pdf`);
}

function exportPDF(title, data, kind) {
  if (!data || data.length === 0) { alert('データがありません'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFontSize(14);
  doc.text(title, 14, 14);
  doc.setFontSize(9);
  doc.text(`Generated: ${dayjs().format('YYYY-MM-DD HH:mm')}  Unit: ${state.qtyUnit}`, 14, 20);

  let head, body;
  if (kind === 'daily') {
    head = [['Date','Factory','Staff', ...PART_KEYS.map(k=>PART_LABELS[k]), 'Total','PerPerson']];
    body = data.map(r => [r.date, r.factory, r.staff_count, ...PART_KEYS.map(k=>fmt.qty(r[k]).replace(/\s.*/,'')), fmt.qty(r.total_qty).replace(/\s.*/,''), r.qty_per_person>0?fmt.qty(r.qty_per_person).replace(/\s.*/,''):'-']);
  } else if (kind === 'monthly') {
    head = [['Month','Factory','Days','Staff', ...PART_KEYS.map(k=>PART_LABELS[k]), 'Total','AvgDaily','PerPerson']];
    body = data.map(r => [r.ym, r.factory, r.days, r.staff_count, ...PART_KEYS.map(k=>fmt.qty(r[k]).replace(/\s.*/,'')), fmt.qty(r.total_qty).replace(/\s.*/,''), fmt.qty(r.avg_daily_qty).replace(/\s.*/,''), r.qty_per_person>0?fmt.qty(r.qty_per_person).replace(/\s.*/,''):'-']);
  } else if (kind === 'yearly') {
    head = [['Year','Factory','Days','Staff', ...PART_KEYS.map(k=>PART_LABELS[k]), 'Total','PerPerson']];
    body = data.map(r => [r.year, r.factory, r.days, r.staff_count, ...PART_KEYS.map(k=>fmt.qty(r[k]).replace(/\s.*/,'')), fmt.qty(r.total_qty).replace(/\s.*/,''), r.qty_per_person>0?fmt.qty(r.qty_per_person).replace(/\s.*/,''):'-']);
  } else {
    head = [['Month','Factory','Total']];
    body = data.map(r => [r.ym || r.year, r.factory, fmt.qty(r.total_qty).replace(/\s.*/,'')]);
  }
  doc.autoTable({ head, body, startY: 24, styles: { fontSize: 7, cellPadding: 1 }, headStyles: { fillColor: [37,99,235] } });
  doc.save(`${title}_${dayjs().format('YYYYMMDD_HHmmss')}.pdf`);
}

// ===== 起動 =====
async function loadAndRender() {
  renderLayout();
  await renderMain();
}

async function init() {
  const u = await api.me();
  if (u) {
    state.user = u;
    await loadAndRender();
  } else {
    renderLogin();
  }
}

init();
