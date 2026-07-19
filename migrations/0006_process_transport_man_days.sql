-- 加工・運搬人工 (process_transport_man_days) 対応
-- 加工数量 (processing_records) に新しい人工項目「加工・運搬人工」を追加する。
-- これは既存の staff_count (直接加工人工) とは独立した項目で、
-- 「1人工あたりの加工・運搬数量 = total_qty / process_transport_man_days」を算出するために使用する。
--
-- 既存機能への影響を排除するため:
--   * NOT NULL 制約は付けない。既存レコードは NULL のまま残す。
--   * DEFAULT を持たないので、既存の INSERT/UPDATE 文が触れない列となり、
--     省略された場合は NULL となる。
--   * 既存の staff_count, qty_per_person, total_qty, 部位別数量には
--     一切変更を加えない。
--   * 積込・運搬機能 (transport_records) には一切変更を加えない。
--
-- クライアント/サーバー側の解釈:
--   NULL または 0 の場合、「1人工あたりの加工・運搬数量」は "-" 表示とする。
--   数値の場合は total_qty / process_transport_man_days で kg/人工 を計算する。

ALTER TABLE processing_records ADD COLUMN process_transport_man_days REAL;
