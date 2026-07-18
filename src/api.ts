import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Bindings, User } from './types'
import { PART_KEYS } from './types'
import { login, logout, authMiddleware, requireAdmin } from './auth'

const api = new Hono<{ Bindings: Bindings; Variables: { user: User } }>()

// ==== 認証 ====
api.post('/auth/login', async (c) => {
  const body = await c.req.json<{ username: string; password: string }>()
  if (!body.username || !body.password) {
    return c.json({ error: 'ユーザー名とパスワードを入力してください' }, 400)
  }
  const result = await login(c.env.DB, body.username, body.password)
  if (!result) {
    return c.json({ error: 'ユーザー名またはパスワードが違います' }, 401)
  }
  setCookie(c, 'session_token', result.token, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 7
  })
  return c.json({ user: result.user })
})

api.post('/auth/logout', async (c) => {
  const token = getCookie(c, 'session_token') || ''
  await logout(c.env.DB, token)
  deleteCookie(c, 'session_token', { path: '/' })
  return c.json({ ok: true })
})

api.get('/auth/me', authMiddleware, (c) => {
  return c.json({ user: c.get('user') })
})

// ==== 加工実績 ====

// 計算ユーティリティ
function calcTotals(rec: Record<string, any>) {
  let total = 0
  for (const k of PART_KEYS) {
    total += Number(rec[k]) || 0
  }
  const staff = Number(rec.staff_count) || 0
  const per = staff > 0 ? total / staff : 0
  return { total_qty: total, qty_per_person: per }
}

// 人員名の正規化と重複排除 (旧 worker_names 用、互換性のため残す)
function normalizeWorkerNames(input: any): string[] {
  if (input == null) return []
  let arr: any[] = []
  if (Array.isArray(input)) arr = input
  else if (typeof input === 'string') {
    const s = input.trim()
    if (!s) return []
    // JSON配列か,区切り
    if (s.startsWith('[')) {
      try { arr = JSON.parse(s) } catch { arr = s.split(/[,、，]/) }
    } else {
      arr = s.split(/[,、，]/)
    }
  } else {
    return []
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of arr) {
    if (v == null) continue
    const name = String(v).trim()
    if (!name) continue
    if (seen.has(name)) continue // 重複排除
    seen.add(name)
    out.push(name)
  }
  return out
}

// 人工 (man_days) の正規化: 0〜2の範囲にクランプ、空欄は1
// 残業対応のため上限を2.0、小数は第3位まで保持 (例: 0.125, 1.125, 1.525, 2.000)
// 浮動小数誤差対策として小数第3位で丸めるが、3桁以内の入力は値が変わらない
function clampManDays(v: any): number {
  if (v == null || v === '') return 1.0
  const n = Number(v)
  if (!isFinite(n)) return 1.0
  if (n < 0) return 0
  if (n > 2) return 2.0
  // 小数第3位で丸める (1.125 → 1.125, 0.1234 → 0.123)
  return Math.round(n * 1000) / 1000
}

// 人員配列の正規化: [{name, man_days}] 形式を返す
// 入力許容形式:
//   - [{name:'A', man_days:1}, ...]
//   - ['A','B','C']           ← 旧形式 (各1人工で扱う)
//   - 'A、B,C'                 ← 旧文字列形式
//   - null/undefined          ← []
function normalizeWorkers(input: any, fallbackNames?: any): Array<{name: string, man_days: number}> {
  let raw: any[] = []
  if (Array.isArray(input)) raw = input
  else if (input != null) {
    // workers が文字列等で来た場合 (通常は来ない)
    raw = []
  }
  // workers が空の場合、フォールバックとして worker_names を使う
  if (raw.length === 0 && fallbackNames != null) {
    const names = normalizeWorkerNames(fallbackNames)
    raw = names.map(n => ({ name: n, man_days: 1.0 }))
  }
  const seen = new Set<string>()
  const out: Array<{name: string, man_days: number}> = []
  for (const v of raw) {
    if (v == null) continue
    let name = ''
    let md: any = 1.0
    if (typeof v === 'string') {
      name = v.trim()
      md = 1.0
    } else if (typeof v === 'object') {
      name = String(v.name ?? v.worker_name ?? '').trim()
      md = v.man_days ?? v.manDays ?? 1.0
    } else {
      continue
    }
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push({ name, man_days: clampManDays(md) })
  }
  return out
}

// DB保存値から workers 配列を取得 (workers_json 優先、なければ worker_names から復元)
function parseStoredWorkers(workersJson: any, workerNamesStored: any): Array<{name: string, man_days: number}> {
  // workers_json があればそれを使う
  if (workersJson != null) {
    let parsed: any = workersJson
    if (typeof workersJson === 'string') {
      const s = workersJson.trim()
      if (s) {
        try { parsed = JSON.parse(s) } catch { parsed = null }
      } else { parsed = null }
    }
    if (Array.isArray(parsed) && parsed.length > 0) {
      const out: Array<{name: string, man_days: number}> = []
      const seen = new Set<string>()
      for (const v of parsed) {
        if (v == null) continue
        let name = ''
        let md: any = 1.0
        if (typeof v === 'string') { name = v.trim(); md = 1.0 }
        else if (typeof v === 'object') {
          name = String(v.name ?? v.worker_name ?? '').trim()
          md = v.man_days ?? v.manDays ?? 1.0
        }
        if (!name || seen.has(name)) continue
        seen.add(name)
        out.push({ name, man_days: clampManDays(md) })
      }
      if (out.length > 0) return out
    }
  }
  // フォールバック: worker_names (各1人工)
  const names = parseStoredWorkerNames(workerNamesStored)
  return names.map(n => ({ name: n, man_days: 1.0 }))
}

// workers マスタに upsert し、worker_id を返す
async function upsertWorker(db: D1Database, name: string): Promise<number | null> {
  if (!name) return null
  try {
    await db.prepare('INSERT OR IGNORE INTO workers (name) VALUES (?)').bind(name).run()
    const row = await db.prepare('SELECT id FROM workers WHERE name = ?').bind(name).first<{ id: number }>()
    return row?.id ?? null
  } catch {
    return null
  }
}

// 加工記録に対する人員リレーションを書き直し (man_days込み)
async function rewriteRecordWorkers(db: D1Database, recordId: number, date: string, factory: string, workers: Array<{name: string, man_days: number}>) {
  await db.prepare('DELETE FROM processing_record_workers WHERE processing_record_id = ?').bind(recordId).run()
  for (const w of workers) {
    const wid = await upsertWorker(db, w.name)
    await db.prepare(`
      INSERT INTO processing_record_workers (processing_record_id, worker_id, worker_name, factory, date, man_days)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(recordId, wid, w.name, factory, date, w.man_days).run()
  }
}

function parseStoredWorkerNames(v: any): string[] {
  if (v == null) return []
  if (Array.isArray(v)) return v
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return []
    if (s.startsWith('[')) {
      try { const arr = JSON.parse(s); return Array.isArray(arr) ? arr.map(String) : [] } catch { return s.split(/[,、，]/).map(x=>x.trim()).filter(Boolean) }
    }
    return s.split(/[,、，]/).map(x=>x.trim()).filter(Boolean)
  }
  return []
}

function enrichRecord(r: any) {
  const workers = parseStoredWorkers(r?.workers_json, r?.worker_names)
  const names = workers.map(w => w.name)
  return { ...r, worker_names: names, workers }
}

// 一覧取得 (絞り込み)
api.get('/records', authMiddleware, async (c) => {
  const user = c.get('user')
  const url = new URL(c.req.url)
  const dateFrom = url.searchParams.get('dateFrom')
  const dateTo = url.searchParams.get('dateTo')
  const year = url.searchParams.get('year')
  const month = url.searchParams.get('month')
  const factory = url.searchParams.get('factory')

  let sql = `SELECT r.*, u.display_name as creator_name FROM processing_records r 
             LEFT JOIN users u ON u.id = r.created_by WHERE 1=1`
  const params: any[] = []

  if (user.role !== 'admin') {
    sql += ' AND r.created_by = ?'
    params.push(user.id)
  }
  if (dateFrom) { sql += ' AND r.date >= ?'; params.push(dateFrom) }
  if (dateTo) { sql += ' AND r.date <= ?'; params.push(dateTo) }
  if (year) { sql += ` AND substr(r.date, 1, 4) = ?`; params.push(year) }
  if (month) { sql += ` AND substr(r.date, 6, 2) = ?`; params.push(month.padStart(2, '0')) }
  if (factory && factory !== 'all') { sql += ' AND r.factory = ?'; params.push(factory) }

  sql += ' ORDER BY r.date DESC, r.factory ASC'

  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  return c.json({ records: (results as any[]).map(enrichRecord) })
})

// 個別取得
api.get('/records/:id', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const user = c.get('user')
  const row = await c.env.DB.prepare('SELECT * FROM processing_records WHERE id = ?').bind(id).first()
  if (!row) return c.json({ error: 'データが見つかりません' }, 404)
  if (user.role !== 'admin' && (row as any).created_by !== user.id) {
    return c.json({ error: '権限がありません' }, 403)
  }
  return c.json({ record: enrichRecord(row) })
})

// 新規登録
api.post('/records', authMiddleware, async (c) => {
  const user = c.get('user')
  const body = await c.req.json<any>()
  if (!body.date || !body.factory) {
    return c.json({ error: '日付と工場区分は必須です' }, 400)
  }

  // 重複チェック
  const dup = await c.env.DB.prepare('SELECT id FROM processing_records WHERE date = ? AND factory = ?')
    .bind(body.date, body.factory).first()
  if (dup) {
    return c.json({ error: `${body.date} の ${body.factory} のデータは既に登録されています (ID: ${(dup as any).id})` }, 409)
  }

  // 人員処理 (workers配列があれば人工合計を staff_count に、なければ worker_names → 1人工換算 → なければ手入力)
  const workers = normalizeWorkers(body.workers, body.worker_names)
  const manDaysSum = workers.reduce((s, w) => s + (Number(w.man_days) || 0), 0)
  const staffCount = workers.length > 0 ? manDaysSum : (Number(body.staff_count) || 0)
  const recordForCalc = { ...body, staff_count: staffCount }
  const { total_qty, qty_per_person } = calcTotals(recordForCalc)
  const workerNamesArr = workers.map(w => w.name) // 後方互換用

  const trailerCount = Math.max(0, Number(body.trailer_count) || 0)
  const result = await c.env.DB.prepare(`
    INSERT INTO processing_records
    (date, factory, staff_count, foundation_qty, base_qty, column_qty, beam_qty, fukashi_qty, slab_qty, doma_qty, civil_qty, wooden_qty, other_qty, total_qty, qty_per_person, note, created_by, worker_names, workers_json, trailer_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    body.date, body.factory, staffCount,
    Number(body.foundation_qty) || 0, Number(body.base_qty) || 0, Number(body.column_qty) || 0,
    Number(body.beam_qty) || 0, Number(body.fukashi_qty) || 0, Number(body.slab_qty) || 0,
    Number(body.doma_qty) || 0, Number(body.civil_qty) || 0, Number(body.wooden_qty) || 0,
    Number(body.other_qty) || 0, total_qty, qty_per_person, body.note || null, user.id,
    workerNamesArr.length ? JSON.stringify(workerNamesArr) : null,
    workers.length ? JSON.stringify(workers) : null,
    trailerCount
  ).run()

  const recordId = Number(result.meta.last_row_id)
  if (workers.length) {
    await rewriteRecordWorkers(c.env.DB, recordId, body.date, body.factory, workers)
  }

  return c.json({ id: recordId, total_qty, qty_per_person, staff_count: staffCount, worker_names: workerNamesArr, workers })
})

// 更新
api.put('/records/:id', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const user = c.get('user')
  const body = await c.req.json<any>()
  const existing = await c.env.DB.prepare('SELECT created_by FROM processing_records WHERE id = ?').bind(id).first()
  if (!existing) return c.json({ error: 'データが見つかりません' }, 404)
  if (user.role !== 'admin' && (existing as any).created_by !== user.id) {
    return c.json({ error: '権限がありません' }, 403)
  }
  const workers = normalizeWorkers(body.workers, body.worker_names)
  const manDaysSum = workers.reduce((s, w) => s + (Number(w.man_days) || 0), 0)
  const staffCount = workers.length > 0 ? manDaysSum : (Number(body.staff_count) || 0)
  const recordForCalc = { ...body, staff_count: staffCount }
  const { total_qty, qty_per_person } = calcTotals(recordForCalc)
  const workerNamesArr = workers.map(w => w.name)

  const trailerCount = Math.max(0, Number(body.trailer_count) || 0)
  await c.env.DB.prepare(`
    UPDATE processing_records SET
      date=?, factory=?, staff_count=?, foundation_qty=?, base_qty=?, column_qty=?, beam_qty=?,
      fukashi_qty=?, slab_qty=?, doma_qty=?, civil_qty=?, wooden_qty=?, other_qty=?,
      total_qty=?, qty_per_person=?, note=?, worker_names=?, workers_json=?, trailer_count=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(
    body.date, body.factory, staffCount,
    Number(body.foundation_qty) || 0, Number(body.base_qty) || 0, Number(body.column_qty) || 0,
    Number(body.beam_qty) || 0, Number(body.fukashi_qty) || 0, Number(body.slab_qty) || 0,
    Number(body.doma_qty) || 0, Number(body.civil_qty) || 0, Number(body.wooden_qty) || 0,
    Number(body.other_qty) || 0, total_qty, qty_per_person, body.note || null,
    workerNamesArr.length ? JSON.stringify(workerNamesArr) : null,
    workers.length ? JSON.stringify(workers) : null,
    trailerCount,
    id
  ).run()

  await rewriteRecordWorkers(c.env.DB, Number(id), body.date, body.factory, workers)

  return c.json({ ok: true, total_qty, qty_per_person, staff_count: staffCount, worker_names: workerNamesArr, workers })
})

// 削除 (管理者のみ)
api.delete('/records/:id', authMiddleware, requireAdmin, async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM processing_record_workers WHERE processing_record_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM processing_records WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// 前日コピー: 指定日 + 工場 で 前日の同工場データを取得
api.get('/records/copy/previous', authMiddleware, async (c) => {
  const url = new URL(c.req.url)
  const date = url.searchParams.get('date')
  const factory = url.searchParams.get('factory')
  if (!date || !factory) return c.json({ error: 'date,factory required' }, 400)

  const row = await c.env.DB.prepare(`
    SELECT * FROM processing_records WHERE factory = ? AND date < ? ORDER BY date DESC LIMIT 1
  `).bind(factory, date).first()
  return c.json({ record: row ? enrichRecord(row) : null })
})

// ==== workers マスタ ====
api.get('/workers', authMiddleware, async (c) => {
  const url = new URL(c.req.url)
  const activeOnly = url.searchParams.get('active') !== '0'
  let sql = 'SELECT id, name, is_active, created_at FROM workers'
  if (activeOnly) sql += ' WHERE is_active = 1'
  sql += ' ORDER BY name ASC'
  const { results } = await c.env.DB.prepare(sql).all()
  return c.json({ workers: results })
})

// ==== 分析API ====

// 日別サマリ
api.get('/analytics/daily', authMiddleware, async (c) => {
  const url = new URL(c.req.url)
  const dateFrom = url.searchParams.get('dateFrom') || ''
  const dateTo = url.searchParams.get('dateTo') || ''
  const factory = url.searchParams.get('factory') || 'all'

  let sql = `SELECT date, factory, SUM(staff_count) as staff_count,
             SUM(foundation_qty) as foundation_qty, SUM(base_qty) as base_qty,
             SUM(column_qty) as column_qty, SUM(beam_qty) as beam_qty,
             SUM(fukashi_qty) as fukashi_qty, SUM(slab_qty) as slab_qty,
             SUM(doma_qty) as doma_qty, SUM(civil_qty) as civil_qty,
             SUM(wooden_qty) as wooden_qty, SUM(other_qty) as other_qty,
             SUM(total_qty) as total_qty,
             SUM(COALESCE(trailer_count, 0)) as trailer_count,
             GROUP_CONCAT(worker_names, '|||') as worker_names_grouped
             FROM processing_records WHERE 1=1`
  const params: any[] = []
  if (dateFrom) { sql += ' AND date >= ?'; params.push(dateFrom) }
  if (dateTo) { sql += ' AND date <= ?'; params.push(dateTo) }
  if (factory !== 'all') { sql += ' AND factory = ?'; params.push(factory) }
  sql += ' GROUP BY date, factory ORDER BY date ASC'

  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  // worker_names を結合して配列化
  const enriched = (results as any[]).map(r => {
    let names: string[] = []
    if (r.worker_names_grouped) {
      const groups = String(r.worker_names_grouped).split('|||')
      groups.forEach(g => { names.push(...parseStoredWorkerNames(g)) })
      // 重複排除（同日同工場の場合 1レコード/工場/日 なので通常重複無し）
      names = [...new Set(names)]
    }
    return {
      ...r,
      worker_names: names,
      qty_per_person: r.staff_count > 0 ? r.total_qty / r.staff_count : 0
    }
  })
  return c.json({ data: enriched })
})

// 月別サマリ
api.get('/analytics/monthly', authMiddleware, async (c) => {
  const url = new URL(c.req.url)
  const year = url.searchParams.get('year') || ''
  const factory = url.searchParams.get('factory') || 'all'

  let sql = `SELECT substr(date,1,7) as ym, factory,
             SUM(staff_count) as staff_count,
             SUM(foundation_qty) as foundation_qty, SUM(base_qty) as base_qty,
             SUM(column_qty) as column_qty, SUM(beam_qty) as beam_qty,
             SUM(fukashi_qty) as fukashi_qty, SUM(slab_qty) as slab_qty,
             SUM(doma_qty) as doma_qty, SUM(civil_qty) as civil_qty,
             SUM(wooden_qty) as wooden_qty, SUM(other_qty) as other_qty,
             SUM(total_qty) as total_qty,
             SUM(COALESCE(trailer_count, 0)) as trailer_count,
             COUNT(DISTINCT date) as days
             FROM processing_records WHERE 1=1`
  const params: any[] = []
  if (year) { sql += ' AND substr(date,1,4) = ?'; params.push(year) }
  if (factory !== 'all') { sql += ' AND factory = ?'; params.push(factory) }
  sql += ' GROUP BY ym, factory ORDER BY ym ASC'

  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  const enriched = (results as any[]).map(r => ({
    ...r,
    qty_per_person: r.staff_count > 0 ? r.total_qty / r.staff_count : 0,
    avg_daily_qty: r.days > 0 ? r.total_qty / r.days : 0
  }))
  return c.json({ data: enriched })
})

// 年間サマリ
api.get('/analytics/yearly', authMiddleware, async (c) => {
  const url = new URL(c.req.url)
  const factory = url.searchParams.get('factory') || 'all'

  let sql = `SELECT substr(date,1,4) as year, factory,
             SUM(staff_count) as staff_count,
             SUM(foundation_qty) as foundation_qty, SUM(base_qty) as base_qty,
             SUM(column_qty) as column_qty, SUM(beam_qty) as beam_qty,
             SUM(fukashi_qty) as fukashi_qty, SUM(slab_qty) as slab_qty,
             SUM(doma_qty) as doma_qty, SUM(civil_qty) as civil_qty,
             SUM(wooden_qty) as wooden_qty, SUM(other_qty) as other_qty,
             SUM(total_qty) as total_qty,
             SUM(COALESCE(trailer_count, 0)) as trailer_count,
             COUNT(DISTINCT date) as days
             FROM processing_records WHERE 1=1`
  const params: any[] = []
  if (factory !== 'all') { sql += ' AND factory = ?'; params.push(factory) }
  sql += ' GROUP BY year, factory ORDER BY year ASC'

  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  const enriched = (results as any[]).map(r => ({
    ...r,
    qty_per_person: r.staff_count > 0 ? r.total_qty / r.staff_count : 0
  }))
  return c.json({ data: enriched })
})

// ダッシュボード用集計
api.get('/analytics/dashboard', authMiddleware, async (c) => {
  const today = new Date().toISOString().slice(0, 10)
  const ym = today.slice(0, 7)
  const year = today.slice(0, 4)

  const todayRow = await c.env.DB.prepare(`
    SELECT factory, SUM(total_qty) as qty, SUM(staff_count) as staff,
           SUM(COALESCE(trailer_count, 0)) as trailer_count
    FROM processing_records WHERE date = ? GROUP BY factory
  `).bind(today).all()

  const monthRow = await c.env.DB.prepare(`
    SELECT factory, SUM(total_qty) as qty, SUM(staff_count) as staff, COUNT(DISTINCT date) as days,
           SUM(COALESCE(trailer_count, 0)) as trailer_count
    FROM processing_records WHERE substr(date,1,7) = ? GROUP BY factory
  `).bind(ym).all()

  const yearRow = await c.env.DB.prepare(`
    SELECT factory, SUM(total_qty) as qty, SUM(staff_count) as staff, COUNT(DISTINCT date) as days,
           SUM(COALESCE(trailer_count, 0)) as trailer_count
    FROM processing_records WHERE substr(date,1,4) = ? GROUP BY factory
  `).bind(year).all()

  const partsSqlParts = PART_KEYS.map(k => `SUM(${k}) as ${k}`).join(', ')
  const monthParts = await c.env.DB.prepare(`
    SELECT ${partsSqlParts} FROM processing_records WHERE substr(date,1,7) = ?
  `).bind(ym).first()

  return c.json({
    today: { date: today, rows: todayRow.results },
    month: { ym, rows: monthRow.results, parts: monthParts },
    year: { year, rows: yearRow.results }
  })
})

// 月間目標
api.get('/targets', authMiddleware, async (c) => {
  const url = new URL(c.req.url)
  const year = url.searchParams.get('year')
  let sql = 'SELECT * FROM monthly_targets WHERE 1=1'
  const params: any[] = []
  if (year) { sql += ' AND year = ?'; params.push(year) }
  sql += ' ORDER BY year DESC, month DESC, factory'
  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  return c.json({ targets: results })
})

api.post('/targets', authMiddleware, requireAdmin, async (c) => {
  const body = await c.req.json<{ year: number; month: number; factory: string; target_qty: number }>()
  await c.env.DB.prepare(`
    INSERT INTO monthly_targets (year, month, factory, target_qty)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(year, month, factory) DO UPDATE SET target_qty = excluded.target_qty
  `).bind(body.year, body.month, body.factory, body.target_qty).run()
  return c.json({ ok: true })
})

// ==== 人員別分析 ====
// 各人の参加日数、関わった総加工量、部位別按分、工場別を集計 (man_days考慮)
// 計算式: 各人の加工数量 = (total_qty / staff_count) × その人のman_days
//   ※staff_count = man_daysの合計 (workersがある場合)
//   ※workersが無い古いデータは man_days=1.0, staff_count=name数で互換動作
api.get('/analytics/workers', authMiddleware, async (c) => {
  const url = new URL(c.req.url)
  const dateFrom = url.searchParams.get('dateFrom') || ''
  const dateTo = url.searchParams.get('dateTo') || ''
  const year = url.searchParams.get('year') || ''
  const month = url.searchParams.get('month') || ''
  const factory = url.searchParams.get('factory') || 'all'
  const workerNameFilter = url.searchParams.get('worker') || url.searchParams.get('worker_name') || ''

  // 1人工あたりの加工量 = r.total_qty / r.staff_count
  // 各人の加工量 = 1人工あたり × prw.man_days
  // 各人の部位別加工量 = (r[part] / r.staff_count) × prw.man_days  (按分は staff_count比、man_days考慮)
  // 各人の部位別人工数 = prw.man_days × (r[part] / r.total_qty)   ← 新しい計算
  //   (= その人の人工を部位別数量比率で割り振る)
  const partSums = PART_KEYS.map(k => `(r.${k} * 1.0 / NULLIF(r.staff_count, 0)) * COALESCE(prw.man_days, 1.0) as part_${k}`).join(', ')
  const partMdSums = PART_KEYS.map(k => `COALESCE(prw.man_days, 1.0) * (r.${k} * 1.0 / NULLIF(r.total_qty, 0)) as partmd_${k}`).join(', ')
  let sql = `
    SELECT prw.worker_name as worker_name, prw.factory as factory, prw.date as date,
           COALESCE(prw.man_days, 1.0) as man_days,
           (r.total_qty * 1.0 / NULLIF(r.staff_count, 0)) * COALESCE(prw.man_days, 1.0) as person_qty,
           r.staff_count as staff_count,
           r.total_qty as total_qty,
           ${partSums},
           ${partMdSums}
    FROM processing_record_workers prw
    JOIN processing_records r ON r.id = prw.processing_record_id
    WHERE 1=1
  `
  const params: any[] = []
  if (dateFrom) { sql += ' AND prw.date >= ?'; params.push(dateFrom) }
  if (dateTo) { sql += ' AND prw.date <= ?'; params.push(dateTo) }
  if (year) { sql += ` AND substr(prw.date,1,4) = ?`; params.push(year) }
  if (month) { sql += ` AND substr(prw.date,6,2) = ?`; params.push(month.padStart(2,'0')) }
  if (factory && factory !== 'all') { sql += ' AND prw.factory = ?'; params.push(factory) }
  if (workerNameFilter) { sql += ' AND prw.worker_name LIKE ?'; params.push('%' + workerNameFilter + '%') }

  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  const rows = results as any[]

  // 人員ごと集計
  const aggMap = new Map<string, any>()
  for (const r of rows) {
    const name = r.worker_name
    if (!aggMap.has(name)) {
      aggMap.set(name, {
        worker_name: name,
        days: 0,
        man_days_total: 0,
        total_qty: 0,
        honsha_qty: 0,
        dai2_qty: 0,
        honsha_man_days: 0,
        dai2_man_days: 0,
        dates: new Set<string>(),
        ...Object.fromEntries(PART_KEYS.map(k => [k, 0])),
        // 部位別人工数の合計 (各日 prw.man_days × r[k] / r.total_qty の積算)
        ...Object.fromEntries(PART_KEYS.map(k => ['partmd_' + k, 0]))
      })
    }
    const a = aggMap.get(name)
    const q = Number(r.person_qty) || 0
    const md = Number(r.man_days) || 0
    a.total_qty += q
    a.man_days_total += md
    if (r.factory === '本社工場') { a.honsha_qty += q; a.honsha_man_days += md }
    else if (r.factory === '第二工場') { a.dai2_qty += q; a.dai2_man_days += md }
    a.dates.add(r.date)
    for (const k of PART_KEYS) {
      a[k] += Number(r['part_' + k]) || 0
      a['partmd_' + k] += Number(r['partmd_' + k]) || 0
    }
  }
  const data = Array.from(aggMap.values()).map(a => {
    const days = a.dates.size
    return {
      worker_name: a.worker_name,
      days,
      man_days_total: a.man_days_total,
      total_qty: a.total_qty,
      avg_daily_qty: days > 0 ? a.total_qty / days : 0,
      qty_per_man_day: a.man_days_total > 0 ? a.total_qty / a.man_days_total : 0,
      honsha_qty: a.honsha_qty,
      dai2_qty: a.dai2_qty,
      honsha_man_days: a.honsha_man_days,
      dai2_man_days: a.dai2_man_days,
      ...Object.fromEntries(PART_KEYS.map(k => [k, a[k]])),
      // 部位別人工数 (新計算用: 部位別数量比率で按分された人工数)
      ...Object.fromEntries(PART_KEYS.map(k => ['partmd_' + k, a['partmd_' + k]]))
    }
  })
  // 加工量降順
  data.sort((x, y) => y.total_qty - x.total_qty)

  return c.json({ data })
})

// ==== 部位別人工数集計 (新計算ルール) ====
// 各日×工場ごとに staff_count を部位別数量比率で割り振り、合計を返す。
// dateFrom/dateTo/year/factory による絞り込みを反映。
// 計算式: 各日の部位別人工数 = その日の staff_count × その日の部位別数量 / その日の total_qty
//   → 期間合計 = Σ (日別部位別人工数)
//   → 期間部位別1人工あたり = 期間部位別数量合計 ÷ 期間部位別人工数合計
api.get('/analytics/parts-per-manday', authMiddleware, async (c) => {
  const url = new URL(c.req.url)
  const dateFrom = url.searchParams.get('dateFrom') || ''
  const dateTo = url.searchParams.get('dateTo') || ''
  const year = url.searchParams.get('year') || ''
  const month = url.searchParams.get('month') || ''
  const factory = url.searchParams.get('factory') || 'all'

  // 各レコード(=各日×工場)ごとに、部位別数量と total_qty, staff_count を取得
  let sql = `SELECT date, factory, staff_count, total_qty,
             foundation_qty, base_qty, column_qty, beam_qty, fukashi_qty,
             slab_qty, doma_qty, civil_qty, wooden_qty, other_qty
             FROM processing_records WHERE 1=1`
  const params: any[] = []
  if (dateFrom) { sql += ' AND date >= ?'; params.push(dateFrom) }
  if (dateTo) { sql += ' AND date <= ?'; params.push(dateTo) }
  if (year) { sql += ' AND substr(date,1,4) = ?'; params.push(year) }
  if (month) { sql += ' AND substr(date,6,2) = ?'; params.push(month.padStart(2, '0')) }
  if (factory && factory !== 'all') { sql += ' AND factory = ?'; params.push(factory) }
  sql += ' ORDER BY date ASC, factory ASC'

  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  const rows = results as any[]

  // 全体集計 (1工場分1日として扱う = (date, factory) が1単位)
  const partsAll: Record<string, { qty: number; md: number }> = {}
  // 工場別集計
  const partsByFactory: Record<string, Record<string, { qty: number; md: number }>> = {}
  PART_KEYS.forEach(k => { partsAll[k] = { qty: 0, md: 0 } })

  for (const r of rows) {
    const totalQty = Number(r.total_qty) || 0
    const staffCount = Number(r.staff_count) || 0
    const fac = String(r.factory || '')
    if (!partsByFactory[fac]) {
      partsByFactory[fac] = {}
      PART_KEYS.forEach(k => { partsByFactory[fac][k] = { qty: 0, md: 0 } })
    }
    for (const k of PART_KEYS) {
      const partQty = Number(r[k]) || 0
      // 各日×工場ごとの部位別人工数 = staff_count × (part_qty / total_qty)
      const partMd = totalQty > 0 ? staffCount * partQty / totalQty : 0
      partsAll[k].qty += partQty
      partsAll[k].md += partMd
      partsByFactory[fac][k].qty += partQty
      partsByFactory[fac][k].md += partMd
    }
  }

  const formatParts = (m: Record<string, { qty: number; md: number }>) =>
    PART_KEYS.map(k => ({
      part_key: k,
      total_qty: m[k].qty,
      part_man_days: m[k].md,
      qty_per_man_day: m[k].md > 0 ? m[k].qty / m[k].md : 0
    }))

  return c.json({
    overall: formatParts(partsAll),
    by_factory: Object.fromEntries(
      Object.entries(partsByFactory).map(([fac, m]) => [fac, formatParts(m)])
    ),
    row_count: rows.length
  })
})

// 月別 × 人員別 (推移グラフ用) — man_days考慮
api.get('/analytics/workers/monthly', authMiddleware, async (c) => {
  const url = new URL(c.req.url)
  const year = url.searchParams.get('year') || String(new Date().getFullYear())
  const factory = url.searchParams.get('factory') || 'all'
  const workerNameFilter = url.searchParams.get('worker') || url.searchParams.get('worker_name') || ''

  let sql = `
    SELECT prw.worker_name as worker_name, substr(prw.date,1,7) as ym,
           SUM((r.total_qty * 1.0 / NULLIF(r.staff_count, 0)) * COALESCE(prw.man_days, 1.0)) as person_qty,
           SUM(COALESCE(prw.man_days, 1.0)) as man_days_total,
           COUNT(DISTINCT prw.date) as days
    FROM processing_record_workers prw
    JOIN processing_records r ON r.id = prw.processing_record_id
    WHERE substr(prw.date,1,4) = ?
  `
  const params: any[] = [year]
  if (factory && factory !== 'all') { sql += ' AND prw.factory = ?'; params.push(factory) }
  if (workerNameFilter) { sql += ' AND prw.worker_name LIKE ?'; params.push('%' + workerNameFilter + '%') }
  sql += ' GROUP BY prw.worker_name, ym ORDER BY ym ASC'

  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  return c.json({ data: results })
})

// ============================================================================
//  運搬数量機能 API (加工数量機能とは完全に独立)
//  - 加工数量テーブル / API / 分析処理は一切参照しない
//  - 既存 processing_records には触れない
// ============================================================================

const FACTORY_SET = new Set(['本社工場', '第二工場'])
const VEHICLE_MAX_LEN = 100

// 運搬人員リストの正規化。
// 入力形式: Array<{ worker_name?: string, name?: string, man_days: number|string }>
// 戻り値: 有効な { worker_name, man_days } のみ / 同一名は409対象なので配列内重複は保持しない (Setで排除)
function normalizeTransportWorkers(input: any): { workers: Array<{worker_name: string; man_days: number}>, error?: string } {
  if (!Array.isArray(input)) return { workers: [], error: '運搬人員が正しくありません' }
  const seen = new Set<string>()
  const out: Array<{worker_name: string; man_days: number}> = []
  for (const raw of input) {
    if (raw == null || typeof raw !== 'object') continue
    const name = String(raw.worker_name ?? raw.name ?? '').trim()
    if (!name) continue
    if (seen.has(name)) {
      return { workers: [], error: `同一の運搬人員 "${name}" が重複しています` }
    }
    seen.add(name)
    // man_days 検証: 数値 & > 0 & 小数第3位まで許容 (第4位以降は丸め)
    const rawMd = raw.man_days
    if (rawMd === '' || rawMd == null) {
      return { workers: [], error: `運搬人員 "${name}" の人工が未入力です` }
    }
    const md = Number(rawMd)
    if (!isFinite(md)) {
      return { workers: [], error: `運搬人員 "${name}" の人工が数値ではありません` }
    }
    if (md <= 0) {
      return { workers: [], error: `運搬人員 "${name}" の人工は0より大きい値を指定してください` }
    }
    // 小数第3位で丸める
    const rounded = Math.round(md * 1000) / 1000
    out.push({ worker_name: name, man_days: rounded })
  }
  if (out.length === 0) return { workers: [], error: '運搬人員を1名以上入力してください' }
  return { workers: out }
}

// workers マスタに存在しない名前をまとめて INSERT OR IGNORE → 全名前の id を解決
async function resolveWorkerIds(db: D1Database, names: string[]): Promise<Record<string, number | null>> {
  const uniq = Array.from(new Set(names.filter(n => !!n)))
  if (uniq.length === 0) return {}
  // 未登録名を一括で INSERT OR IGNORE (batch で1トランザクション化)
  await db.batch(uniq.map(n =>
    db.prepare('INSERT OR IGNORE INTO workers (name) VALUES (?)').bind(n)
  ))
  const placeholders = uniq.map(() => '?').join(',')
  const { results } = await db.prepare(
    `SELECT id, name FROM workers WHERE name IN (${placeholders})`
  ).bind(...uniq).all()
  const map: Record<string, number | null> = {}
  for (const n of uniq) map[n] = null
  for (const r of (results as any[])) map[r.name] = Number(r.id)
  return map
}

// 運搬レコードに紐付く人員リストを取得
async function loadTransportWorkers(db: D1Database, recordId: number) {
  const { results } = await db.prepare(`
    SELECT worker_id, worker_name, man_days
    FROM transport_record_workers
    WHERE transport_record_id = ?
    ORDER BY id ASC
  `).bind(recordId).all()
  return (results as any[]).map(r => ({
    worker_id: r.worker_id,
    worker_name: r.worker_name,
    man_days: Number(r.man_days) || 0
  }))
}

function enrichTransportRecord(r: any, workers: any[]) {
  const totalMd = workers.reduce((s, w) => s + (Number(w.man_days) || 0), 0)
  const qty = Number(r.transport_quantity_kg) || 0
  return {
    ...r,
    transport_quantity_kg: qty,
    workers,
    total_man_days: totalMd,
    qty_per_man_day: totalMd > 0 ? qty / totalMd : 0
  }
}

// ---- 一覧 ----
api.get('/transport-records', authMiddleware, async (c) => {
  const user = c.get('user')
  const url = new URL(c.req.url)
  const dateFrom = url.searchParams.get('dateFrom')
  const dateTo = url.searchParams.get('dateTo')
  const year = url.searchParams.get('year')
  const month = url.searchParams.get('month')
  const factory = url.searchParams.get('factory')
  const vehicleQ = url.searchParams.get('vehicle')
  const workerQ = url.searchParams.get('worker')

  // 一般ユーザーは自分の作成分のみ (既存 /api/records と同じポリシー)
  let sql = `SELECT r.*, u.display_name as creator_name
             FROM transport_records r
             LEFT JOIN users u ON u.id = r.created_by
             WHERE 1=1`
  const params: any[] = []
  if (user.role !== 'admin') {
    sql += ' AND r.created_by = ?'
    params.push(user.id)
  }
  if (dateFrom) { sql += ' AND r.transport_date >= ?'; params.push(dateFrom) }
  if (dateTo)   { sql += ' AND r.transport_date <= ?'; params.push(dateTo) }
  if (year)     { sql += ' AND substr(r.transport_date,1,4) = ?'; params.push(year) }
  if (month)    { sql += ' AND substr(r.transport_date,6,2) = ?'; params.push(String(month).padStart(2,'0')) }
  if (factory && factory !== 'all') { sql += ' AND r.factory = ?'; params.push(factory) }
  if (vehicleQ) { sql += ' AND r.vehicle LIKE ?'; params.push('%' + vehicleQ + '%') }
  if (workerQ) {
    sql += ' AND EXISTS (SELECT 1 FROM transport_record_workers trw WHERE trw.transport_record_id = r.id AND trw.worker_name LIKE ?)'
    params.push('%' + workerQ + '%')
  }
  sql += ' ORDER BY r.transport_date DESC, r.id DESC'

  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  const rows = results as any[]

  // 人員をまとめて取得 (N+1 回避のため IN 句)
  const ids = rows.map(r => r.id)
  let workersMap: Record<number, any[]> = {}
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',')
    const { results: wrs } = await c.env.DB.prepare(`
      SELECT transport_record_id, worker_id, worker_name, man_days
      FROM transport_record_workers
      WHERE transport_record_id IN (${placeholders})
      ORDER BY id ASC
    `).bind(...ids).all()
    for (const w of (wrs as any[])) {
      const rid = w.transport_record_id
      if (!workersMap[rid]) workersMap[rid] = []
      workersMap[rid].push({ worker_id: w.worker_id, worker_name: w.worker_name, man_days: Number(w.man_days) || 0 })
    }
  }
  const enriched = rows.map(r => enrichTransportRecord(r, workersMap[r.id] || []))
  return c.json({ records: enriched })
})

// ---- 過去入力の車両候補 (サジェスト) ----
api.get('/transport-records/vehicles', authMiddleware, async (c) => {
  const user = c.get('user')
  let sql = 'SELECT DISTINCT vehicle FROM transport_records WHERE vehicle IS NOT NULL AND vehicle != ""'
  const params: any[] = []
  if (user.role !== 'admin') { sql += ' AND created_by = ?'; params.push(user.id) }
  sql += ' ORDER BY vehicle ASC LIMIT 200'
  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  return c.json({ vehicles: (results as any[]).map(r => r.vehicle) })
})

// ---- 個別取得 ----
api.get('/transport-records/:id', authMiddleware, async (c) => {
  const id = Number(c.req.param('id'))
  const user = c.get('user')
  const row = await c.env.DB.prepare('SELECT * FROM transport_records WHERE id = ?').bind(id).first()
  if (!row) return c.json({ error: 'データが見つかりません' }, 404)
  if (user.role !== 'admin' && (row as any).created_by !== user.id) {
    return c.json({ error: '権限がありません' }, 403)
  }
  const workers = await loadTransportWorkers(c.env.DB, id)
  return c.json({ record: enrichTransportRecord(row, workers) })
})

// ---- 新規登録 ----
api.post('/transport-records', authMiddleware, async (c) => {
  const user = c.get('user')
  const body = await c.req.json<any>()

  // ------- バリデーション -------
  if (!body.transport_date || typeof body.transport_date !== 'string') {
    return c.json({ error: '日付を入力してください' }, 400)
  }
  if (!body.factory || !FACTORY_SET.has(body.factory)) {
    return c.json({ error: '工場区分は「本社工場」または「第二工場」を選択してください' }, 400)
  }
  const vehicle = String(body.vehicle ?? '').trim()
  if (!vehicle) return c.json({ error: '運搬車両を入力してください' }, 400)
  if (vehicle.length > VEHICLE_MAX_LEN) {
    return c.json({ error: `運搬車両は ${VEHICLE_MAX_LEN} 文字以内で入力してください` }, 400)
  }
  const qtyRaw = body.transport_quantity_kg
  if (qtyRaw === '' || qtyRaw == null) {
    return c.json({ error: '運搬数量を入力してください' }, 400)
  }
  const qtyIn = Number(qtyRaw)
  if (!isFinite(qtyIn)) return c.json({ error: '運搬数量は数値で入力してください' }, 400)
  if (qtyIn <= 0) return c.json({ error: '運搬数量は0より大きい値を指定してください' }, 400)
  // 運搬数量は小数第3位まで保持。それより下位は四捨五入する。
  const qty = Math.round(qtyIn * 1000) / 1000

  const { workers, error: wErr } = normalizeTransportWorkers(body.workers)
  if (wErr) return c.json({ error: wErr }, 400)

  // ------- 重複警告 (同日・同工場・同車両・同数量・同人員構成・同人工構成) -------
  if (!body.duplicateAck) {
    const { results: dupCandidates } = await c.env.DB.prepare(`
      SELECT id FROM transport_records
      WHERE transport_date = ? AND factory = ? AND vehicle = ? AND transport_quantity_kg = ?
    `).bind(body.transport_date, body.factory, vehicle, qty).all()

    const inputSig = JSON.stringify(workers.map(w => ({ n: w.worker_name, m: w.man_days })).sort((a,b) => a.n.localeCompare(b.n)))
    for (const cand of dupCandidates as any[]) {
      const w2 = await loadTransportWorkers(c.env.DB, cand.id)
      const sig = JSON.stringify(w2.map(w => ({ n: w.worker_name, m: Number(w.man_days) })).sort((a,b) => a.n.localeCompare(b.n)))
      if (sig === inputSig) {
        return c.json({
          error: '同じ内容の運搬記録が既に登録されています。それでも登録する場合は「はい」を押してください。',
          duplicate: true,
          existingId: cand.id
        }, 409)
      }
    }
  }

  // ------- 一体的な登録 (本体 + 人員) : D1 batch() による単一トランザクション -------
  // batch() は Cloudflare D1 の公式トランザクションAPIで、渡した全ステートメントが
  // 単一の暗黙 BEGIN/COMMIT で実行される。途中で1つでも失敗すれば全体が ROLLBACK される。
  // https://developers.cloudflare.com/d1/best-practices/use-d1-with-hono/#transactions
  try {
    // 1) workers マスタを batch で upsert（外部トランザクション。ここでの部分成功はマスタなので許容）
    const nameToId = await resolveWorkerIds(c.env.DB, workers.map(w => w.worker_name))

    // 2) 本体 INSERT を実行して last_row_id を取得（batch では前段の結果を bind に流し込めないため）
    //    ここで失敗した場合は本体も人員も一切残らない（本体INSERT前）
    const insertRes = await c.env.DB.prepare(`
      INSERT INTO transport_records (transport_date, factory, vehicle, transport_quantity_kg, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).bind(body.transport_date, body.factory, vehicle, qty, user.id).run()
    const recordId = Number(insertRes.meta.last_row_id)

    // 3) 人員 INSERT を batch でまとめて1トランザクション実行
    //    全 INSERT が成功したら COMMIT、1つでも失敗（例：UNIQUE違反、CHECK違反）したら
    //    全 INSERT が ROLLBACK される。ただし前段 2) の本体 INSERT は既に COMMIT 済みのため、
    //    そのまま残る。→ 補償として本体を DELETE してロールバック相当にする。
    try {
      if (workers.length > 0) {
        await c.env.DB.batch(workers.map(w =>
          c.env.DB.prepare(`
            INSERT INTO transport_record_workers (transport_record_id, worker_id, worker_name, man_days)
            VALUES (?, ?, ?, ?)
          `).bind(recordId, nameToId[w.worker_name] ?? null, w.worker_name, w.man_days)
        ))
      }
    } catch (e: any) {
      // 補償: 本体 DELETE。CASCADE により人員側も自動削除される。
      // 補償自体が失敗した場合は 500 を返し、管理者に整合性確認を促す。
      try {
        await c.env.DB.prepare('DELETE FROM transport_records WHERE id = ?').bind(recordId).run()
      } catch (e2: any) {
        return c.json({
          error: `運搬人員の保存に失敗し、本体の巻き戻しにも失敗しました。管理者に連絡してください (recordId=${recordId})`,
          detail: e?.message || String(e),
          rollbackError: e2?.message || String(e2)
        }, 500)
      }
      return c.json({ error: '運搬人員の保存に失敗しました: ' + (e?.message || String(e)) }, 500)
    }

    const w2 = await loadTransportWorkers(c.env.DB, recordId)
    const row = await c.env.DB.prepare('SELECT * FROM transport_records WHERE id = ?').bind(recordId).first()
    return c.json({ record: enrichTransportRecord(row, w2) })
  } catch (e: any) {
    return c.json({ error: '登録に失敗しました: ' + (e?.message || String(e)) }, 500)
  }
})

// ---- 更新 ----
api.put('/transport-records/:id', authMiddleware, async (c) => {
  const id = Number(c.req.param('id'))
  const user = c.get('user')
  const body = await c.req.json<any>()

  const existing = await c.env.DB.prepare('SELECT * FROM transport_records WHERE id = ?').bind(id).first()
  if (!existing) return c.json({ error: 'データが見つかりません' }, 404)
  if (user.role !== 'admin' && (existing as any).created_by !== user.id) {
    return c.json({ error: '権限がありません' }, 403)
  }

  // ------ 楽観ロック（同時更新検出）: クライアントが持っている updated_at を送ってきた場合のみ検査。
  //         既存クライアントとの互換性のため、body.expected_updated_at が無ければスキップする。
  if (body.expected_updated_at && String((existing as any).updated_at) !== String(body.expected_updated_at)) {
    return c.json({
      error: '他のユーザーによりこのレコードが更新されています。画面を再読込してからやり直してください。',
      conflict: true,
      currentUpdatedAt: (existing as any).updated_at
    }, 409)
  }

  if (!body.transport_date) return c.json({ error: '日付を入力してください' }, 400)
  if (!body.factory || !FACTORY_SET.has(body.factory)) {
    return c.json({ error: '工場区分は「本社工場」または「第二工場」を選択してください' }, 400)
  }
  const vehicle = String(body.vehicle ?? '').trim()
  if (!vehicle) return c.json({ error: '運搬車両を入力してください' }, 400)
  if (vehicle.length > VEHICLE_MAX_LEN) return c.json({ error: `運搬車両は ${VEHICLE_MAX_LEN} 文字以内で入力してください` }, 400)
  const qtyIn = Number(body.transport_quantity_kg)
  if (!isFinite(qtyIn) || qtyIn <= 0) return c.json({ error: '運搬数量は0より大きい数値を指定してください' }, 400)
  // 運搬数量は小数第3位まで保持
  const qty = Math.round(qtyIn * 1000) / 1000

  const { workers, error: wErr } = normalizeTransportWorkers(body.workers)
  if (wErr) return c.json({ error: wErr }, 400)

  // ------- 更新: D1 batch() による単一トランザクション -------
  // 本体UPDATE + 既存人員DELETE + 新人員INSERT を batch でまとめて実行。
  // 1つでも失敗すれば全体が ROLLBACK され、元データは完全にそのまま残る。
  try {
    // 1) workers マスタ upsert（別トランザクション。マスタなので部分成功は問題なし）
    const nameToId = await resolveWorkerIds(c.env.DB, workers.map(w => w.worker_name))

    // 2) 本体更新 + 中間テーブル入れ替えを1つの batch にまとめる
    const stmts = [
      c.env.DB.prepare(`
        UPDATE transport_records SET
          transport_date = ?, factory = ?, vehicle = ?, transport_quantity_kg = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(body.transport_date, body.factory, vehicle, qty, id),
      c.env.DB.prepare('DELETE FROM transport_record_workers WHERE transport_record_id = ?').bind(id),
      ...workers.map(w =>
        c.env.DB.prepare(`
          INSERT INTO transport_record_workers (transport_record_id, worker_id, worker_name, man_days)
          VALUES (?, ?, ?, ?)
        `).bind(id, nameToId[w.worker_name] ?? null, w.worker_name, w.man_days)
      )
    ]
    await c.env.DB.batch(stmts)
  } catch (e: any) {
    // batch 全体が ROLLBACK されているため元データは無傷。エラーだけ返す。
    return c.json({ error: '更新に失敗しました。データは変更されていません: ' + (e?.message || String(e)) }, 500)
  }

  const w2 = await loadTransportWorkers(c.env.DB, id)
  const row = await c.env.DB.prepare('SELECT * FROM transport_records WHERE id = ?').bind(id).first()
  return c.json({ record: enrichTransportRecord(row, w2) })
})

// ---- 削除 (admin のみ / 既存の加工削除と同一ポリシー) ----
api.delete('/transport-records/:id', authMiddleware, requireAdmin, async (c) => {
  const id = Number(c.req.param('id'))
  const existing = await c.env.DB.prepare('SELECT id FROM transport_records WHERE id = ?').bind(id).first()
  if (!existing) return c.json({ error: 'データが見つかりません' }, 404)
  // FK ON DELETE CASCADE で中間テーブルも自動削除
  await c.env.DB.prepare('DELETE FROM transport_records WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// ============================================================================
//  運搬数量 分析 API
//  すべて transport_records / transport_record_workers のみを参照する。
//  加工数量テーブル (processing_records / processing_record_workers) は参照しない。
// ============================================================================

// 分析用のフィルタを SQL 断片に変換
function buildTransportFilterSql(url: URL, prefix = 'r'): { where: string, params: any[] } {
  const parts: string[] = []
  const params: any[] = []
  const dateFrom = url.searchParams.get('dateFrom')
  const dateTo = url.searchParams.get('dateTo')
  const year = url.searchParams.get('year')
  const month = url.searchParams.get('month')
  const factory = url.searchParams.get('factory')
  if (dateFrom) { parts.push(`${prefix}.transport_date >= ?`); params.push(dateFrom) }
  if (dateTo)   { parts.push(`${prefix}.transport_date <= ?`); params.push(dateTo) }
  if (year)     { parts.push(`substr(${prefix}.transport_date,1,4) = ?`); params.push(year) }
  if (month)    { parts.push(`substr(${prefix}.transport_date,6,2) = ?`); params.push(String(month).padStart(2,'0')) }
  if (factory && factory !== 'all') { parts.push(`${prefix}.factory = ?`); params.push(factory) }
  return { where: parts.length ? ' AND ' + parts.join(' AND ') : '', params }
}

// ---- 日別 ----
api.get('/analytics/transport/daily', authMiddleware, async (c) => {
  const url = new URL(c.req.url)
  const { where, params } = buildTransportFilterSql(url, 'r')

  // 記録単位で集計 (件数 = 記録数、数量 = SUM(kg)、人工 = SUM(sum(man_days)))
  // 人工は「その記録の合計人工」の日別合計 → サブクエリで先に記録ごとに集計
  const sql = `
    SELECT r.transport_date AS date,
           SUM(r.transport_quantity_kg) AS total_qty,
           SUM(rec_md.md_sum)           AS total_man_days,
           COUNT(*)                     AS record_count,
           SUM(CASE WHEN r.factory = '本社工場' THEN r.transport_quantity_kg ELSE 0 END) AS honsha_qty,
           SUM(CASE WHEN r.factory = '第二工場' THEN r.transport_quantity_kg ELSE 0 END) AS dai2_qty
      FROM transport_records r
      LEFT JOIN (
        SELECT transport_record_id, SUM(man_days) AS md_sum
          FROM transport_record_workers
         GROUP BY transport_record_id
      ) rec_md ON rec_md.transport_record_id = r.id
     WHERE 1=1 ${where}
     GROUP BY r.transport_date
     ORDER BY r.transport_date ASC
  `
  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  const data = (results as any[]).map(r => {
    const totalQty = Number(r.total_qty) || 0
    const totalMd = Number(r.total_man_days) || 0
    const cnt = Number(r.record_count) || 0
    return {
      date: r.date,
      total_qty: totalQty,
      total_man_days: totalMd,
      record_count: cnt,
      qty_per_record: cnt > 0 ? totalQty / cnt : 0,
      qty_per_man_day: totalMd > 0 ? totalQty / totalMd : 0,
      honsha_qty: Number(r.honsha_qty) || 0,
      dai2_qty: Number(r.dai2_qty) || 0
    }
  })
  return c.json({ data })
})

// ---- 月別 ----
api.get('/analytics/transport/monthly', authMiddleware, async (c) => {
  const url = new URL(c.req.url)
  const { where, params } = buildTransportFilterSql(url, 'r')

  const sql = `
    SELECT substr(r.transport_date,1,7) AS ym,
           SUM(r.transport_quantity_kg) AS total_qty,
           SUM(rec_md.md_sum)           AS total_man_days,
           COUNT(*)                     AS record_count,
           SUM(CASE WHEN r.factory = '本社工場' THEN r.transport_quantity_kg ELSE 0 END) AS honsha_qty,
           SUM(CASE WHEN r.factory = '第二工場' THEN r.transport_quantity_kg ELSE 0 END) AS dai2_qty
      FROM transport_records r
      LEFT JOIN (
        SELECT transport_record_id, SUM(man_days) AS md_sum
          FROM transport_record_workers
         GROUP BY transport_record_id
      ) rec_md ON rec_md.transport_record_id = r.id
     WHERE 1=1 ${where}
     GROUP BY ym
     ORDER BY ym ASC
  `
  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  const raw = (results as any[]).map(r => ({
    ym: r.ym,
    total_qty: Number(r.total_qty) || 0,
    total_man_days: Number(r.total_man_days) || 0,
    record_count: Number(r.record_count) || 0,
    honsha_qty: Number(r.honsha_qty) || 0,
    dai2_qty: Number(r.dai2_qty) || 0
  }))
  // 前月比 (連続月とは限らないので、直前の要素との比較)
  const data = raw.map((r, i) => {
    const prev = i > 0 ? raw[i-1] : null
    return {
      ...r,
      qty_per_record: r.record_count > 0 ? r.total_qty / r.record_count : 0,
      qty_per_man_day: r.total_man_days > 0 ? r.total_qty / r.total_man_days : 0,
      // 前月比（増減率）: (当月 - 前月) / 前月。前月が 0 または不在のときは null → フロントで「－」表示
      prev_month_change: (prev && prev.total_qty > 0) ? ((r.total_qty - prev.total_qty) / prev.total_qty) : null
    }
  })
  return c.json({ data })
})

// ---- 年別 (年別集計 + 対象期間の月別推移) ----
api.get('/analytics/transport/yearly', authMiddleware, async (c) => {
  const url = new URL(c.req.url)
  const { where, params } = buildTransportFilterSql(url, 'r')

  // 年別集計 + 前年比
  const sqlYear = `
    SELECT substr(r.transport_date,1,4) AS year,
           SUM(r.transport_quantity_kg) AS total_qty,
           SUM(rec_md.md_sum)           AS total_man_days,
           COUNT(*)                     AS record_count,
           SUM(CASE WHEN r.factory = '本社工場' THEN r.transport_quantity_kg ELSE 0 END) AS honsha_qty,
           SUM(CASE WHEN r.factory = '第二工場' THEN r.transport_quantity_kg ELSE 0 END) AS dai2_qty
      FROM transport_records r
      LEFT JOIN (
        SELECT transport_record_id, SUM(man_days) AS md_sum
          FROM transport_record_workers
         GROUP BY transport_record_id
      ) rec_md ON rec_md.transport_record_id = r.id
     WHERE 1=1 ${where}
     GROUP BY year
     ORDER BY year ASC
  `
  const { results: yr } = await c.env.DB.prepare(sqlYear).bind(...params).all()
  const raw = (yr as any[]).map(r => ({
    year: r.year,
    total_qty: Number(r.total_qty) || 0,
    total_man_days: Number(r.total_man_days) || 0,
    record_count: Number(r.record_count) || 0,
    honsha_qty: Number(r.honsha_qty) || 0,
    dai2_qty: Number(r.dai2_qty) || 0
  }))
  const yearly = raw.map((r, i) => {
    const prev = i > 0 ? raw[i-1] : null
    return {
      ...r,
      qty_per_record: r.record_count > 0 ? r.total_qty / r.record_count : 0,
      qty_per_man_day: r.total_man_days > 0 ? r.total_qty / r.total_man_days : 0,
      // 前年比（増減率）: (当年 - 前年) / 前年。前年が 0 または不在のときは null → フロントで「－」表示
      prev_year_change: (prev && prev.total_qty > 0) ? ((r.total_qty - prev.total_qty) / prev.total_qty) : null
    }
  })

  // 月別推移: 同じフィルタ (year フィルタは URL に含めない場合、全期間の月別推移になる)
  const sqlMonthly = `
    SELECT substr(r.transport_date,1,7) AS ym,
           SUM(r.transport_quantity_kg) AS total_qty,
           SUM(rec_md.md_sum)           AS total_man_days,
           COUNT(*)                     AS record_count
      FROM transport_records r
      LEFT JOIN (
        SELECT transport_record_id, SUM(man_days) AS md_sum
          FROM transport_record_workers
         GROUP BY transport_record_id
      ) rec_md ON rec_md.transport_record_id = r.id
     WHERE 1=1 ${where}
     GROUP BY ym
     ORDER BY ym ASC
  `
  const { results: mr } = await c.env.DB.prepare(sqlMonthly).bind(...params).all()
  const monthly = (mr as any[]).map(r => {
    const totalQty = Number(r.total_qty) || 0
    const totalMd = Number(r.total_man_days) || 0
    return {
      ym: r.ym,
      total_qty: totalQty,
      total_man_days: totalMd,
      record_count: Number(r.record_count) || 0,
      qty_per_man_day: totalMd > 0 ? totalQty / totalMd : 0
    }
  })

  return c.json({ data: yearly, monthly })
})

// ---- 人員別 (人工比で按分) ----
api.get('/analytics/transport/workers', authMiddleware, async (c) => {
  const url = new URL(c.req.url)
  const { where, params } = buildTransportFilterSql(url, 'r')
  const workerQ = url.searchParams.get('worker') || url.searchParams.get('worker_name') || ''

  // 各記録ごとの合計人工を得た上で、
  //   人員別按分数量 = 記録の運搬数量 × その人員の man_days / 記録の合計人工
  const sql = `
    SELECT trw.worker_name AS worker_name,
           trw.man_days     AS man_days,
           r.transport_quantity_kg AS record_qty,
           r.transport_date AS date,
           r.factory        AS factory,
           r.id             AS record_id,
           rec_md.md_sum    AS md_sum
      FROM transport_record_workers trw
      JOIN transport_records r ON r.id = trw.transport_record_id
      LEFT JOIN (
        SELECT transport_record_id, SUM(man_days) AS md_sum
          FROM transport_record_workers
         GROUP BY transport_record_id
      ) rec_md ON rec_md.transport_record_id = r.id
     WHERE 1=1 ${where}
       ${workerQ ? 'AND trw.worker_name LIKE ?' : ''}
  `
  const bind = workerQ ? [...params, '%' + workerQ + '%'] : params
  const { results } = await c.env.DB.prepare(sql).bind(...bind).all()

  // 集計
  type Agg = {
    worker_name: string
    total_man_days: number
    record_ids: Set<number>
    dates: Set<string>
    total_qty: number
    honsha_qty: number
    dai2_qty: number
  }
  const map = new Map<string, Agg>()
  for (const r of (results as any[])) {
    const name = r.worker_name
    if (!map.has(name)) {
      map.set(name, {
        worker_name: name,
        total_man_days: 0,
        record_ids: new Set<number>(),
        dates: new Set<string>(),
        total_qty: 0, honsha_qty: 0, dai2_qty: 0
      })
    }
    const a = map.get(name)!
    const md = Number(r.man_days) || 0
    const rq = Number(r.record_qty) || 0
    const ms = Number(r.md_sum) || 0
    // 按分
    const share = ms > 0 ? rq * md / ms : 0
    a.total_man_days += md
    a.total_qty += share
    if (r.factory === '本社工場') a.honsha_qty += share
    else if (r.factory === '第二工場') a.dai2_qty += share
    a.record_ids.add(Number(r.record_id))
    a.dates.add(String(r.date))
  }
  const data = Array.from(map.values()).map(a => ({
    worker_name: a.worker_name,
    total_man_days: a.total_man_days,
    record_count: a.record_ids.size,
    days: a.dates.size,
    total_qty: a.total_qty,
    honsha_qty: a.honsha_qty,
    dai2_qty: a.dai2_qty,
    qty_per_man_day: a.total_man_days > 0 ? a.total_qty / a.total_man_days : 0
  }))
  data.sort((x, y) => y.total_qty - x.total_qty)
  return c.json({ data })
})

export default api
