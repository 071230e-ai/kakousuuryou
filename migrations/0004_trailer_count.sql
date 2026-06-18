-- 材料搬入トレーラー台数 (trailer_count) 対応
-- processing_records にトレーラー台数列を追加
-- 既存データは 0 (デフォルト) として扱う

ALTER TABLE processing_records ADD COLUMN trailer_count REAL NOT NULL DEFAULT 0;
