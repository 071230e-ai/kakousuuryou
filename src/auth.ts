import type { Context, Next } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Bindings, User, UserRole } from './types'

function toHex(buf: ArrayBuffer | Uint8Array): string {
  return Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16)
  return out
}

async function sha256(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text)
  return toHex(await crypto.subtle.digest('SHA-256', buf))
}

function randomToken(): string {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return toHex(arr)
}

// パスワードハッシュ: PBKDF2-SHA256 (Workers の上限 100,000 回)
// 保存形式: pbkdf2$<iterations>$<salt hex>$<hash hex>
// 旧形式 (ソルト無し SHA-256 の hex) もログイン時に検証し、成功したら新形式へ移行する
const PBKDF2_ITERATIONS = 100000

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return toHex(bits)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${await pbkdf2(password, salt, PBKDF2_ITERATIONS)}`
}

export async function verifyPassword(password: string, stored: string): Promise<{ ok: boolean; legacy: boolean }> {
  if (stored.startsWith('pbkdf2$')) {
    const [, iter, saltHex, hash] = stored.split('$')
    const actual = await pbkdf2(password, fromHex(saltHex), Number(iter))
    return { ok: timingSafeEqual(actual, hash), legacy: false }
  }
  return { ok: timingSafeEqual(await sha256(password), stored), legacy: true }
}

export async function login(db: D1Database, username: string, password: string): Promise<{ token: string; user: User } | null> {
  const row = await db.prepare('SELECT id, username, display_name, role, password_hash FROM users WHERE username = ?')
    .bind(username)
    .first<User & { password_hash: string }>()
  if (!row) return null
  const { ok, legacy } = await verifyPassword(password, row.password_hash)
  if (!ok) return null
  if (legacy) {
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password), row.id).run()
  }

  // 期限切れセッションの掃除
  await db.prepare("DELETE FROM sessions WHERE datetime(expires_at) <= datetime('now')").run()

  const token = randomToken()
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
  await db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, row.id, expires).run()
  const user: User = { id: row.id, username: row.username, display_name: row.display_name, role: row.role }
  return { token, user }
}

export async function logout(db: D1Database, token: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
}

export async function getUserFromToken(db: D1Database, token: string): Promise<User | null> {
  if (!token) return null
  // expires_at は ISO 形式 (…T…Z)、CURRENT_TIMESTAMP は空白区切りのため、
  // 文字列比較ではなく datetime() で正規化して比較する
  const row = await db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')
  `).bind(token).first<User>()
  return row || null
}

export async function authMiddleware(c: Context<{ Bindings: Bindings; Variables: { user: User } }>, next: Next) {
  const token = getCookie(c, 'session_token') || ''
  const user = await getUserFromToken(c.env.DB, token)
  if (!user) {
    return c.json({ error: '認証が必要です' }, 401)
  }
  c.set('user', user)
  await next()
}

export function requireAdmin(c: Context<{ Bindings: Bindings; Variables: { user: User } }>, next: Next) {
  const user = c.get('user')
  if (!user || user.role !== 'admin') {
    return c.json({ error: '管理者権限が必要です' }, 403)
  }
  return next()
}

export { sha256, randomToken, setCookie, deleteCookie, getCookie }
