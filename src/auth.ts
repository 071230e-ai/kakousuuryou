import type { Context, Next } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Bindings, User, UserRole } from './types'

async function sha256(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function randomToken(): string {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function hashPassword(password: string): Promise<string> {
  return sha256(password)
}

export async function login(db: D1Database, username: string, password: string): Promise<{ token: string; user: User } | null> {
  const hash = await sha256(password)
  const row = await db.prepare('SELECT id, username, display_name, role FROM users WHERE username = ? AND password_hash = ?')
    .bind(username, hash)
    .first<User>()
  if (!row) return null

  const token = randomToken()
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
  await db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, row.id, expires).run()
  return { token, user: row }
}

export async function logout(db: D1Database, token: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
}

export async function getUserFromToken(db: D1Database, token: string): Promise<User | null> {
  if (!token) return null
  const row = await db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > CURRENT_TIMESTAMP
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
