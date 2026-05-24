export type Bindings = {
  DB: D1Database
}

export type UserRole = 'admin' | 'user'

export interface User {
  id: number
  username: string
  display_name: string
  role: UserRole
}

export interface ProcessingRecord {
  id: number
  date: string
  factory: string
  staff_count: number
  foundation_qty: number
  base_qty: number
  column_qty: number
  beam_qty: number
  fukashi_qty: number
  slab_qty: number
  doma_qty: number
  civil_qty: number
  wooden_qty: number
  other_qty: number
  total_qty: number
  qty_per_person: number
  note: string | null
  created_by: number | null
  created_at: string
  updated_at: string
}

export const PART_KEYS = [
  'foundation_qty',
  'base_qty',
  'column_qty',
  'beam_qty',
  'fukashi_qty',
  'slab_qty',
  'doma_qty',
  'civil_qty',
  'wooden_qty',
  'other_qty'
] as const

export const PART_LABELS: Record<string, string> = {
  foundation_qty: '基礎',
  base_qty: 'ベース',
  column_qty: '柱',
  beam_qty: '梁',
  fukashi_qty: 'フカシ',
  slab_qty: 'スラブ',
  doma_qty: '土間',
  civil_qty: '土木',
  wooden_qty: '木造',
  other_qty: 'その他'
}

export const FACTORIES = ['本社工場', '第二工場'] as const
export type Factory = typeof FACTORIES[number]
