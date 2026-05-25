-- 人員マスタテーブル
CREATE TABLE IF NOT EXISTS workers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 加工記録と人員の関連テーブル
CREATE TABLE IF NOT EXISTS processing_record_workers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  processing_record_id INTEGER NOT NULL,
  worker_id INTEGER,
  worker_name TEXT NOT NULL,
  factory TEXT NOT NULL,
  date TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (processing_record_id) REFERENCES processing_records(id) ON DELETE CASCADE,
  FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE SET NULL
);

-- 既存 processing_records に worker_names カラム追加 (JSON文字列で保持: 高速アクセス用)
ALTER TABLE processing_records ADD COLUMN worker_names TEXT;

-- インデックス
CREATE INDEX IF NOT EXISTS idx_prw_record ON processing_record_workers(processing_record_id);
CREATE INDEX IF NOT EXISTS idx_prw_worker_name ON processing_record_workers(worker_name);
CREATE INDEX IF NOT EXISTS idx_prw_date ON processing_record_workers(date);
CREATE INDEX IF NOT EXISTS idx_prw_factory ON processing_record_workers(factory);
CREATE INDEX IF NOT EXISTS idx_prw_date_factory ON processing_record_workers(date, factory);
CREATE INDEX IF NOT EXISTS idx_workers_name ON workers(name);
