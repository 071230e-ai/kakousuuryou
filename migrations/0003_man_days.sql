-- 人工 (man_days) 対応
-- processing_records に workers_json (人員と人工のJSON配列) を追加
-- processing_record_workers に man_days を追加

ALTER TABLE processing_records ADD COLUMN workers_json TEXT;

ALTER TABLE processing_record_workers ADD COLUMN man_days REAL NOT NULL DEFAULT 1.0;

-- 既存の processing_record_workers の man_days を 1.0 (1人工) で埋める (互換性)
UPDATE processing_record_workers SET man_days = 1.0 WHERE man_days IS NULL;

-- workers_json から人別集計するためのインデックス (worker_name + date)
CREATE INDEX IF NOT EXISTS idx_prw_worker_date ON processing_record_workers(worker_name, date);
