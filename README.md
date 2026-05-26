# 村田鉄筋㈱ 加工数量分析システム

## プロジェクト概要
- **名称**: 村田鉄筋㈱ 加工数量分析システム
- **目的**: 本社工場・第二工場の日々の加工数量を入力し、日別・月別・年間で加工実績を分析する業務アプリ
- **主な機能**:
  - 加工数量の毎日入力（部位別 10 区分）
  - 工場区分別（本社工場 / 第二工場 / 全体合算）の集計
  - ダッシュボード、日別・月別・年間・工場比較の各分析画面
  - CSV / PDF 出力
  - ログイン（管理者 / 一般ユーザー）と権限制御
  - 月間目標設定と達成率表示
  - 前日コピー機能、重複登録チェック、低数量自動色付け
  - **人員名登録 / 人員別分析** (v1.2): 加工実績ごとに人員名を複数登録し、人ごとの加工量・参加日数・部位別構成を分析
  - **人工（man_days）入力対応** (v1.3 / プレビュー中): 各人員に 0〜1 の人工値（1日=1.0、半日=0.5、四半日=0.25）を入力可能。人員数 = 人工合計（例: 1+1+0.5 → 2.5人工）。総加工量 ÷ 人工合計で「1人工あたり加工数量」を計算し、部位別数量も人工に応じて按分。CSV/PDF/一覧/人員別分析すべて対応。`worker_names` のみの旧データは各人 1.0 人工として後方互換。

## 公開 URL
- **本番**: https://murata-tekkin-processing.pages.dev
- **最新デプロイ (v1.3 人工 / man_days 対応)**: https://6008bb4c.murata-tekkin-processing.pages.dev
- **GitHub**: https://github.com/071230e-ai/kakousuuryou

## 初期ログインアカウント
| ユーザー名 | パスワード | 権限 |
|---|---|---|
| `admin` | `admin123` | 管理者（全機能） |
| `user1` | `user123` | 一般ユーザー（入力 / 自身のデータ閲覧・編集） |

## データアーキテクチャ
- **データベース**: Cloudflare D1（SQLite ベース・グローバル分散）
  - DB名: `murata-tekkin-processing-prod`
  - DB ID: `0417f3ce-1fab-405a-b632-e6bbbe07ed7d`
- **主要テーブル**:
  - `users`: ユーザー（id, username, password_hash[SHA-256], display_name, role）
  - `processing_records`: 加工実績（日付 / 工場 / 人員数 / 部位別10項目 / 総量 / 1人あたり / 備考 / **worker_names** JSON配列 / **workers_json** JSON配列[{name, man_days}]）
  - `monthly_targets`: 月間目標（年・月・工場・目標数量）
  - `sessions`: ログインセッショントークン（7日有効）
  - **`workers`**: 人員マスタ（id, name UNIQUE, is_active, created_at）— 入力時に自動 upsert
  - **`processing_record_workers`**: 加工実績と人員の関連テーブル（processing_record_id, worker_id, worker_name, **man_days REAL DEFAULT 1.0**, factory, date）— 人別分析用の正規化テーブル（cascade delete対応）

### 部位 10 区分
基礎 / ベース / 柱 / 梁 / フカシ / スラブ / 土間 / 土木 / 木造 / その他

### 計算ルール（v1.3 人工対応）
- `total_qty` = 全 10 部位の合計（kg）
- **`staff_count` の意味が変更**: 人員が登録されている場合は **人工合計（man_days の総和）** を表す（例: 1.0+1.0+0.5 → 2.5）。手入力時は従来通り人数値。
- `qty_per_person`（= 1人工あたり加工数量）= `total_qty ÷ staff_count`（0 の場合は 0、ゼロ除算なし）
- **人工（man_days）**: 各人員ごとに 0〜1 の値。1日=1.0、半日=0.5、四半日=0.25。空欄/非数値→1.0、負値→0、1超→1 にクランプ。
- **人別加工量** = `(その日の総加工量 ÷ 人工合計) × その人の人工` → 人工に応じた按分
- **人別部位別量** = `(その日の部位別量 ÷ 人工合計) × その人の人工` を積算
- **後方互換**: 旧データ（`workers_json=null` で `worker_names` のみ）は各人 `man_days=1.0` として読み込まれる

## 主要 API エンドポイント
### 認証
| メソッド | パス | 説明 |
|---|---|---|
| POST | `/api/auth/login` | ログイン（Cookie に session_token 設定） |
| POST | `/api/auth/logout` | ログアウト |
| GET  | `/api/auth/me` | 現在のユーザー情報 |

### 加工実績
| メソッド | パス | 認証 | 説明 |
|---|---|---|---|
| GET    | `/api/records` | 必須 | 一覧（dateFrom, dateTo, year, month, factory で絞り込み） |
| GET    | `/api/records/:id` | 必須 | 1件取得 |
| POST   | `/api/records` | 必須 | 新規登録（重複チェック付き） |
| PUT    | `/api/records/:id` | 必須 | 更新 |
| DELETE | `/api/records/:id` | 管理者 | 削除 |
| GET    | `/api/records/copy/previous?date=YYYY-MM-DD&factory=...` | 必須 | 前日コピー用に直近データ取得 |

### 分析
| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/analytics/dashboard` | 今日・今月・今年の集計 |
| GET | `/api/analytics/daily?dateFrom&dateTo&factory` | 日別集計（人員名リスト含む） |
| GET | `/api/analytics/monthly?year&factory` | 月別集計 |
| GET | `/api/analytics/yearly?factory` | 年別集計 |
| GET | `/api/analytics/workers?year&month&dateFrom&dateTo&factory&worker_name` | 人員別集計（参加日数 / 総加工量 / 工場別 / 部位別10項目） |
| GET | `/api/analytics/workers/monthly?year&factory&worker_name` | 人員別月別推移 |

### 人員マスタ
| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/workers` | 登録された全人員のリスト |

### 月間目標
| メソッド | パス | 認証 |
|---|---|---|
| GET  | `/api/targets?year=YYYY` | 必須 |
| POST | `/api/targets` | 管理者 |

## 画面構成
1. **ダッシュボード**: 今日・今月・今年の加工量、工場別、部位別円グラフ、目標達成率
2. **加工数量入力**: 日付/工場/人員数/**人員名（複数追加・削除可、行ごとに追加ボタン）**/部位別10項目/備考、前日コピーボタン（人員名も含めてコピー）
3. **加工実績一覧**: 人員名タグ列付き、絞り込み・編集・削除・CSV/PDF 出力、低数量行は赤、高生産性行は緑で表示
4. **日別分析**: 日付ごとの棒グラフ（工場積み上げ）と表
5. **月別分析**: 月ごとの棒グラフと月間サマリ表
6. **年間分析**: 年別、月別推移（1人あたり）、部位別年間集計
7. **工場比較**: 本社 vs 第二の月別・部位別並列比較、構成比表示
8. **人員別分析** (NEW): 期間/年/月/工場/人員名で絞り込み、KPI（総加工量/登録人員数/1人あたり平均/最多加工量者/最多参加日数者）、ランキング表、5つのグラフ（総加工量・参加日数・1日平均・部位別構成・月別推移）、CSV/PDF 出力
9. **月間目標設定**（管理者のみ）

## ユーザーガイド
### 加工数量の入力
1. ログイン後、画面上部の **「加工数量入力」** を開く
2. 日付・工場区分・人員数を入力
3. 各部位の数量を kg 単位で入力（入力中に総加工数量・1人あたりが自動表示）
4. 「前回コピー」ボタンで同工場の前回データを呼び出せます
5. 「登録する」を押すと保存されます（同じ日付+工場で重複は不可）

### 分析の見方
- 各分析画面の右上 **「kg / t」** トグルで単位切り替え
- 工場フィルタで「本社工場のみ」「第二工場のみ」「全体合算」を選択
- 各画面の **「CSV」「PDF」** ボタンで現在の表示内容を出力

### 権限
- 管理者: すべてのデータの閲覧・登録・編集・削除・出力・目標設定
- 一般ユーザー: 入力と自分のデータの閲覧・編集（削除不可）

## 開発・運用
### 技術スタック
- **フロントエンド**: HTML / Vanilla JS (SPA) + TailwindCSS (CDN) + Chart.js + jsPDF + dayjs + axios
- **バックエンド**: Hono 4 (TypeScript / JSX)
- **ランタイム**: Cloudflare Pages Functions (Workers)
- **DB**: Cloudflare D1

### ローカル開発
```bash
# DB 初期化（初回のみ）
npm run db:migrate:local
npm run db:seed:local

# ビルド & 起動
npm run build
pm2 start ecosystem.config.cjs

# テスト
curl http://localhost:3000
```

### 本番デプロイ
```bash
npm run build
npx wrangler pages deploy dist --project-name murata-tekkin-processing --branch main
```

### DB マイグレーション
- ローカル: `npm run db:migrate:local`
- 本番: `npm run db:migrate:prod`

## まだ実装していない機能 / 次の開発ステップ
- ユーザー管理画面（新規ユーザー追加・パスワード変更を画面から）
- 詳細な集計（部位別生産性ランキングの自動化、月間推移グラフへの目標ライン重ね描き）
- データインポート（CSV 一括取り込み）
- 通知機能（目標未達アラートなど）
- 監査ログ（誰がいつ編集したかの履歴）
- スマホでのオフライン入力（PWA 化）

## デプロイ状況
- **プラットフォーム**: Cloudflare Pages
- **ステータス**: ✅ Active
- **プロジェクト名**: `murata-tekkin-processing`
- **本番ブランチ**: main
- **最終更新**: 2026-05-24
