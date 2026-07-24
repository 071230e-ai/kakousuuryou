-- 積込・運搬 車両明細対応 (親1件 : 車両明細N件)
--
-- 目的:
--   これまで transport_records に単一の (vehicle, transport_quantity_kg) を持たせていたが、
--   1日の実績に対して複数の車両×数量を入力できるように、車両明細用の子テーブルを追加する。
--
-- 数値精度方針 (小数第3位まで完全精度):
--   * 数量は INTEGER の "quantity_milli_kg" (ミリkg = kg × 1000) で保存する。
--   * 例: 8000kg → 8000000, 4500.5kg → 4500500, 0.001kg → 1
--   * これにより SQLite REAL の IEEE754 浮動小数点誤差 (0.1 + 0.2 ≠ 0.3 等)
--     および SUM 集計時の誤差蓄積を、DB層で完全に排除する。
--   * 表示・API レスポンス時は milli_kg / 1000 で kg に戻す。
--   * SUM は SUM(quantity_milli_kg) を先に行い、最後に 1000 で割る。
--   * 既存の transport_records.transport_quantity_kg (REAL) 列はスキーマ変更しない。
--     これは後方互換のためのミラー値であり、アプリからは常に quantity_milli_kg を正として扱う。
--
-- 設計方針 (既存構造との整合性):
--   * 既存 transport_record_workers の命名・FK・インデックス方式を踏襲する。
--   * sort_order で入力順を保持する。
--   * FK ON DELETE CASCADE により、親削除時に子明細も自動削除される。
--
-- 後方互換性:
--   * transport_records.vehicle / transport_quantity_kg 列は削除しない。
--     API 側では、明細が存在しない既存レコードに対しては旧列を単一明細としてフォールバック表示する。
--     マイグレーション後は新明細テーブル (quantity_milli_kg) が正となる。
--   * POST/PUT では、新規保存する親レコードの transport_quantity_kg にも合計(kg)をミラーとして書き込む
--     (旧SQLパスや旧ダンプデータとの参照互換を保つため)。
--
-- 冪等性:
--   * CREATE TABLE / CREATE INDEX は IF NOT EXISTS。
--   * 既存レコードから明細への移行 INSERT は
--       WHERE NOT EXISTS (SELECT 1 FROM transport_vehicle_items WHERE transport_record_id = r.id)
--     により、既に明細が存在するレコードには重複挿入しない。
--     何回実行しても、対象レコードにつき明細は 1 件しか作られない安全な設計。
--   * 既存の vehicle / transport_quantity_kg 列や親レコードは一切 UPDATE / DELETE しない。

-- ============================================
-- 1) transport_vehicle_items  車両明細 (親: transport_records)
-- ============================================
CREATE TABLE IF NOT EXISTS transport_vehicle_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transport_record_id INTEGER NOT NULL,
  vehicle_name TEXT NOT NULL,                                        -- 車両名 (前後空白除去済み、最大100文字)
  quantity_milli_kg INTEGER NOT NULL CHECK (quantity_milli_kg > 0),  -- 数量(kg × 1000) 0以下禁止
  sort_order INTEGER NOT NULL DEFAULT 0,                             -- 入力順 (0起点)
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (transport_record_id) REFERENCES transport_records(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tvi_record       ON transport_vehicle_items(transport_record_id);
CREATE INDEX IF NOT EXISTS idx_tvi_vehicle_name ON transport_vehicle_items(vehicle_name);
CREATE INDEX IF NOT EXISTS idx_tvi_sort         ON transport_vehicle_items(transport_record_id, sort_order);

-- ============================================
-- 2) 既存データ移行 (冪等)
-- ============================================
-- 旧 transport_records の (vehicle, transport_quantity_kg) を、車両明細 1 件として取り込む。
-- 対象は、まだ明細が 1 件も紐付いていないレコードのみ。
-- vehicle が空/NULL、または quantity <= 0 のレコードは対象外とする (CHECK 制約に違反しないため)。
-- kg → milli_kg は CAST(ROUND(kg * 1000) AS INTEGER) で厳密に整数化する。
INSERT INTO transport_vehicle_items (transport_record_id, vehicle_name, quantity_milli_kg, sort_order)
SELECT r.id,
       TRIM(r.vehicle),
       CAST(ROUND(r.transport_quantity_kg * 1000) AS INTEGER),
       0
  FROM transport_records r
 WHERE r.vehicle IS NOT NULL
   AND TRIM(r.vehicle) != ''
   AND r.transport_quantity_kg IS NOT NULL
   AND r.transport_quantity_kg > 0
   AND CAST(ROUND(r.transport_quantity_kg * 1000) AS INTEGER) > 0
   AND NOT EXISTS (
         SELECT 1 FROM transport_vehicle_items tvi
          WHERE tvi.transport_record_id = r.id
       );
