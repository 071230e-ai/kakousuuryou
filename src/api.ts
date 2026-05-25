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

// 人員名の正規化と重複排除
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

// 加工記録に対する人員リレーションを書き直し
async function rewriteRecordWorkers(db: D1Database, recordId: number, date: string, factory: string, names: string[]) {
  await db.prepare('DELETE FROM processing_record_workers WHERE processing_record_id = ?').bind(recordId).run()
  for (const name of names) {
    const wid = await upsertWorker(db, name)
    await db.prepare(`
      INSERT INTO processing_record_workers (processing_record_id, worker_id, worker_name, factory, date)
      VALUES (?, ?, ?, ?, ?)
    `).bind(recordId, wid, name, factory, date).run()
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
  const names = parseStoredWorkerNames(r?.worker_names)
  return { ...r, worker_names: names }
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

  // 人員名処理 (人員名があれば人員数を自動算出)
  const workerNames = normalizeWorkerNames(body.worker_names)
  const staffCount = workerNames.length > 0 ? workerNames.length : (Number(body.staff_count) || 0)
  const recordForCalc = { ...body, staff_count: staffCount }
  const { total_qty, qty_per_person } = calcTotals(recordForCalc)

  const result = await c.env.DB.prepare(`
    INSERT INTO processing_records
    (date, factory, staff_count, foundation_qty, base_qty, column_qty, beam_qty, fukashi_qty, slab_qty, doma_qty, civil_qty, wooden_qty, other_qty, total_qty, qty_per_person, note, created_by, worker_names)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    body.date, body.factory, staffCount,
    Number(body.foundation_qty) || 0, Number(body.base_qty) || 0, Number(body.column_qty) || 0,
    Number(body.beam_qty) || 0, Number(body.fukashi_qty) || 0, Number(body.slab_qty) || 0,
    Number(body.doma_qty) || 0, Number(body.civil_qty) || 0, Number(body.wooden_qty) || 0,
    Number(body.other_qty) || 0, total_qty, qty_per_person, body.note || null, user.id,
    workerNames.length ? JSON.stringify(workerNames) : null
  ).run()

  const recordId = Number(result.meta.last_row_id)
  if (workerNames.length) {
    await rewriteRecordWorkers(c.env.DB, recordId, body.date, body.factory, workerNames)
  }

  return c.json({ id: recordId, total_qty, qty_per_person, staff_count: staffCount, worker_names: workerNames })
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
  const workerNames = normalizeWorkerNames(body.worker_names)
  const staffCount = workerNames.length > 0 ? workerNames.length : (Number(body.staff_count) || 0)
  const recordForCalc = { ...body, staff_count: staffCount }
  const { total_qty, qty_per_person } = calcTotals(recordForCalc)

  await c.env.DB.prepare(`
    UPDATE processing_records SET
      date=?, factory=?, staff_count=?, foundation_qty=?, base_qty=?, column_qty=?, beam_qty=?,
      fukashi_qty=?, slab_qty=?, doma_qty=?, civil_qty=?, wooden_qty=?, other_qty=?,
      total_qty=?, qty_per_person=?, note=?, worker_names=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).bind(
    body.date, body.factory, staffCount,
    Number(body.foundation_qty) || 0, Number(body.base_qty) || 0, Number(body.column_qty) || 0,
    Number(body.beam_qty) || 0, Number(body.fukashi_qty) || 0, Number(body.slab_qty) || 0,
    Number(body.doma_qty) || 0, Number(body.civil_qty) || 0, Number(body.wooden_qty) || 0,
    Number(body.other_qty) || 0, total_qty, qty_per_person, body.note || null,
    workerNames.length ? JSON.stringify(workerNames) : null, id
  ).run()

  await rewriteRecordWorkers(c.env.DB, Number(id), body.date, body.factory, workerNames)

  return c.json({ ok: true, total_qty, qty_per_person, staff_count: staffCount, worker_names: workerNames })
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
    SELECT factory, SUM(total_qty) as qty, SUM(staff_count) as staff
    FROM processing_records WHERE date = ? GROUP BY factory
  `).bind(today).all()

  const monthRow = await c.env.DB.prepare(`
    SELECT factory, SUM(total_qty) as qty, SUM(staff_count) as staff, COUNT(DISTINCT date) as days
    FROM processing_records WHERE substr(date,1,7) = ? GROUP BY factory
  `).bind(ym).all()

  const yearRow = await c.env.DB.prepare(`
    SELECT factory, SUM(total_qty) as qty, SUM(staff_count) as staff, COUNT(DISTINCT date) as days
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
// 各人の参加日数、関わった総加工量、部位別按分、工場別を集計
api.get('/analytics/workers', authMiddleware, async (c) => {
  const url = new URL(c.req.url)
  const dateFrom = url.searchParams.get('dateFrom') || ''
  const dateTo = url.searchParams.get('dateTo') || ''
  const year = url.searchParams.get('year') || ''
  const month = url.searchParams.get('month') || ''
  const factory = url.searchParams.get('factory') || 'all'
  const workerNameFilter = url.searchParams.get('worker') || ''

  // processing_record_workers と processing_records を結合
  const partSums = PART_KEYS.map(k => `r.${k} * 1.0 / NULLIF(r.staff_count, 0) as part_${k}`).join(', ')
  let sql = `
    SELECT prw.worker_name as worker_name, prw.factory as factory, prw.date as date,
           r.total_qty * 1.0 / NULLIF(r.staff_count, 0) as person_qty,
           r.staff_count as staff_count,
           ${partSums}
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
  if (workerNameFilter) { sql += ' AND prw.worker_name = ?'; params.push(workerNameFilter) }

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
        total_qty: 0,
        honsha_qty: 0,
        dai2_qty: 0,
        dates: new Set<string>(),
        ...Object.fromEntries(PART_KEYS.map(k => [k, 0]))
      })
    }
    const a = aggMap.get(name)
    const q = Number(r.person_qty) || 0
    a.total_qty += q
    if (r.factory === '本社工場') a.honsha_qty += q
    else if (r.factory === '第二工場') a.dai2_qty += q
    a.dates.add(r.date)
    for (const k of PART_KEYS) {
      a[k] += Number(r['part_' + k]) || 0
    }
  }
  const data = Array.from(aggMap.values()).map(a => {
    const days = a.dates.size
    return {
      worker_name: a.worker_name,
      days,
      total_qty: a.total_qty,
      avg_daily_qty: days > 0 ? a.total_qty / days : 0,
      honsha_qty: a.honsha_qty,
      dai2_qty: a.dai2_qty,
      ...Object.fromEntries(PART_KEYS.map(k => [k, a[k]]))
    }
  })
  // 加工量降順
  data.sort((x, y) => y.total_qty - x.total_qty)

  return c.json({ data })
})

// 月別 × 人員別 (推移グラフ用)
api.get('/analytics/workers/monthly', authMiddleware, async (c) => {
  const url = new URL(c.req.url)
  const year = url.searchParams.get('year') || String(new Date().getFullYear())
  const factory = url.searchParams.get('factory') || 'all'

  let sql = `
    SELECT prw.worker_name as worker_name, substr(prw.date,1,7) as ym,
           SUM(r.total_qty * 1.0 / NULLIF(r.staff_count, 0)) as person_qty,
           COUNT(DISTINCT prw.date) as days
    FROM processing_record_workers prw
    JOIN processing_records r ON r.id = prw.processing_record_id
    WHERE substr(prw.date,1,4) = ?
  `
  const params: any[] = [year]
  if (factory && factory !== 'all') { sql += ' AND prw.factory = ?'; params.push(factory) }
  sql += ' GROUP BY prw.worker_name, ym ORDER BY ym ASC'

  const { results } = await c.env.DB.prepare(sql).bind(...params).all()
  return c.json({ data: results })
})

export default api
