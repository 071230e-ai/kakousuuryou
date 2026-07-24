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
  trailer_count: number
  // 加工・運搬人工 (既存の staff_count = 直接加工人工とは独立した項目)
  // NULL または 0 のときは "1人工あたりの加工・運搬数量" を "-" 表示とする
  process_transport_man_days: number | null
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
  fukashi_qty: '壁',
  slab_qty: 'スラブ',
  doma_qty: '土間',
  civil_qty: '土木',
  wooden_qty: '木造',
  other_qty: 'その他'
}

export const FACTORIES = ['本社工場', '第二工場'] as const
export type Factory = typeof FACTORIES[number]

// ============================================================
// 運搬数量機能 (加工数量とは完全に独立)
// ============================================================

export interface TransportWorkerEntry {
  worker_id?: number | null
  worker_name: string
  man_days: number
}

// 車両明細 (親: transport_records / 子テーブル: transport_vehicle_items)
// 1件の積込・運搬実績に対して複数の車両×数量を紐付ける。
export interface TransportVehicleItem {
  id?: number
  vehicle_name: string
  quantity: number      // kg (小数第3位まで)
  sort_order?: number   // 入力順 (0起点)
}

export interface TransportRecord {
  id: number
  transport_date: string
  factory: Factory
  // 旧: 単一車両モデル。後方互換のため列は残っている。
  // マイグレーション後は vehicles (子明細) を正とし、UI では vehicles を優先表示する。
  vehicle: string
  transport_quantity_kg: number
  created_by: number | null
  created_at: string
  updated_at: string
  // 中間テーブルから join した派生情報
  workers?: TransportWorkerEntry[]
  vehicles?: TransportVehicleItem[]        // 車両明細 (sort_order 昇順)
  total_man_days?: number
  // vehicles の合計 (存在すれば sum(vehicles.quantity)、無ければ transport_quantity_kg)
  total_quantity_kg?: number
  qty_per_man_day?: number
}
