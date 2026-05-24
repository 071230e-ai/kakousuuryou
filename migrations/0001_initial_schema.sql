-- ユーザーテーブル
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user', -- 'admin' or 'user'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 加工実績テーブル
CREATE TABLE IF NOT EXISTS processing_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,                    -- YYYY-MM-DD
  factory TEXT NOT NULL,                  -- '本社工場' or '第二工場'
  staff_count INTEGER NOT NULL DEFAULT 0,
  foundation_qty REAL NOT NULL DEFAULT 0, -- 基礎 (kg)
  base_qty REAL NOT NULL DEFAULT 0,       -- ベース
  column_qty REAL NOT NULL DEFAULT 0,     -- 柱
  beam_qty REAL NOT NULL DEFAULT 0,       -- 梁
  fukashi_qty REAL NOT NULL DEFAULT 0,    -- フカシ
  slab_qty REAL NOT NULL DEFAULT 0,       -- スラブ
  doma_qty REAL NOT NULL DEFAULT 0,       -- 土間
  civil_qty REAL NOT NULL DEFAULT 0,      -- 土木
  wooden_qty REAL NOT NULL DEFAULT 0,     -- 木造
  other_qty REAL NOT NULL DEFAULT 0,      -- その他
  total_qty REAL NOT NULL DEFAULT 0,      -- 総加工数量
  qty_per_person REAL NOT NULL DEFAULT 0, -- 1人あたり
  note TEXT,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- 月間目標数量テーブル
CREATE TABLE IF NOT EXISTS monthly_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  factory TEXT NOT NULL,   -- '本社工場' / '第二工場' / '全体'
  target_qty REAL NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(year, month, factory)
);

-- セッショントークンテーブル
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_records_date ON processing_records(date);
CREATE INDEX IF NOT EXISTS idx_records_factory ON processing_records(factory);
CREATE INDEX IF NOT EXISTS idx_records_date_factory ON processing_records(date, factory);
CREATE INDEX IF NOT EXISTS idx_records_created_by ON processing_records(created_by);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
