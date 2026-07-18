-- 運搬数量機能: 加工数量機能とは完全独立の新テーブル群
-- 既存テーブル (users, processing_records, processing_record_workers, workers,
--                monthly_targets, sessions) には一切 ALTER / DROP / UPDATE を行わない。

-- ============================================
-- 1) transport_records  運搬記録本体
-- ============================================
CREATE TABLE IF NOT EXISTS transport_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transport_date TEXT NOT NULL,                          -- 'YYYY-MM-DD'
  factory TEXT NOT NULL CHECK (factory IN ('本社工場', '第二工場')),
  vehicle TEXT NOT NULL,                                 -- 運搬車両 自由入力 (前後空白除去済み)
  transport_quantity_kg REAL NOT NULL CHECK (transport_quantity_kg > 0),
  created_by INTEGER,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tr_date       ON transport_records(transport_date);
CREATE INDEX IF NOT EXISTS idx_tr_factory    ON transport_records(factory);
CREATE INDEX IF NOT EXISTS idx_tr_vehicle    ON transport_records(vehicle);
CREATE INDEX IF NOT EXISTS idx_tr_created_by ON transport_records(created_by);

-- ============================================
-- 2) transport_record_workers  運搬記録×人員 中間テーブル (担当者情報の正本)
--    人員マスタ (workers) を共有するが、加工側の
--    processing_record_workers とは完全に独立したデータストア。
-- ============================================
CREATE TABLE IF NOT EXISTS transport_record_workers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transport_record_id INTEGER NOT NULL,
  worker_id INTEGER,
  worker_name TEXT NOT NULL,
  man_days REAL NOT NULL CHECK (man_days > 0),           -- 0以下禁止
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (transport_record_id) REFERENCES transport_records(id) ON DELETE CASCADE,
  FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE SET NULL,
  UNIQUE (transport_record_id, worker_name)              -- 同一記録に同一人員の重複禁止
);

CREATE INDEX IF NOT EXISTS idx_trw_record ON transport_record_workers(transport_record_id);
CREATE INDEX IF NOT EXISTS idx_trw_worker ON transport_record_workers(worker_name);
