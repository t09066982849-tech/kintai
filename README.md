# 勤怠管理システム(kintai)

株式会社伊豆倉組の勤怠管理システム。タッチオンタイム・タイムツリー・シャチハタクラウドの3つを、このシステム1つに統合するのが目的。9/1リリース目標。Asanaプロジェクト:https://app.asana.com/1/1216844938289140/project/1217137088641946

## 構成

- **フロント**:素のHTML/CSS/JavaScript(フレームワークなし)。GitHubにpush→Vercelが自動デプロイ。
- **バックエンド**:Supabase(PostgreSQL + Auth + Edge Functions)。サーバー(Railway等)は使わない方針。
- **メール送信**:Resend(送信元 `kintai-noreply@izukura.co.jp`)。Edge Functions経由でのみ使用(ブラウザに鍵を置かないため)。
- **祝日データ**:`holidays-jp.github.io`の無料APIから取得。
- **本番URL**:`kintai-ten-ruby.vercel.app`
- **GitHubリポジトリ**:`t09066982849-tech/kintai`

## ファイル一覧と役割

| ファイル | 役割 |
|---|---|
| `common.js` | 全画面共通。Supabaseクライアント初期化、login/logout、requireEmployee(ログイン確認+従業員情報取得+管理者ナビ表示)、ensureSession |
| `index.html` / `app.js` | 打刻画面。出退勤、GPS、現場選択、月次履歴、修正申請、現在時刻表示、みなし残業集計 |
| `schedule.html` / `schedule.js` | スケジュール(カレンダー)画面。予定登録・編集・削除、複数日対応、参加メンバー、祝日表示 |
| `leave.html` / `leave.js` | 有給・出張申請画面。3段階承認(部長→常務→社長)、出張旅費自動計算、取り消し機能 |
| `admin.html` / `admin.js` | 管理者専用画面。打刻修正の承認、現場マスタ管理、Excel出力(従業員別シート)、承認済み申請書類の閲覧・削除 |
| `document.html` / `document.js` | 有給休暇届・出張申請書のPDF書類(印影入り、承認完了後のみ表示、印刷/PDF保存ボタン) |
| `style.css` | 全画面共通スタイル |

## データベース(Supabase)テーブル

- `employees`:従業員マスタ。`is_admin`、`department`(civil/accounting)、`role`(president/director/manager_civil/manager_accounting/null)、`travel_rate_group_id`、`work_start`/`work_end`(未使用・保留中)
- `sites`:現場マスタ。`work_start`/`work_end`列あり(保留中の時間補正機能用)
- `time_records`:打刻記録。実時刻のみ保存(計算型)。出退勤GPS付き
- `correction_requests`:打刻修正申請(時刻+現場)。管理者が承認/却下
- `schedules`:スケジュール。`type`は event/paid_leave/business_trip。複数日対応(`end_date`)。全員閲覧可
- `schedule_members`:スケジュールの参加メンバー(多対多)
- `leave_requests`:有給・出張申請。3段階承認の状態を保持。出張は`zone`/`daily_allowance`/`hotel_fee`/`total_amount`も持つ
- `travel_rate_groups` / `travel_rates`:旅費規程(グループ単位で道内/道外の日当・宿泊費)
- `holidays`:祝日マスタ(全社共通、`sync-holidays`で自動取得)

## Supabase Edge Functions

- `check-missing-punches`:毎日12時実行(cron設定済み)。「前日」ではなく土日・祝日を遡った直近の平日分の打刻漏れを検知しメール通知(2026-08-10修正:単純な前日判定から、休み明けは直前の平日をチェックする方式に変更)。**現在RESTRICT_TO_SHIMAKI=trueで嶋木さんのみ対象**(全員分の動作確認が済んだらfalseに戻す)
- `check-missing-punches-biweekly`:毎月1日・16日12時実行(cron設定済み)。直近15日分をまとめて棚卸し
- `notify-leave-approval`:leave.jsから都度呼び出し。申請時→部長、各承認時→次の承認者、全承認完了時→申請者本人にメール
- `sync-holidays`:祝日データ取得(手動実行。今後は年1回の自動実行cronを検討)

**3つの通知系Edge FunctionsはすべてTEST_MODE=trueのまま。本番切り替え時は`TEST_MODE = false`に変更し、`RESTRICT_TO_SHIMAKI`も外すこと。**

## 承認者(role)

- 社長:伊豆倉 寿信(president)
- 常務:伊豆倉 米郎(director)
- 土木部長:山本 英嗣(manager_civil)
- 経理部長:佐藤 秀樹(manager_accounting)
- 経理部所属:松浦 春那・佐藤 秀樹・山崎 太一・平野 聖美・古澤 直理・嶋木 正、それ以外は土木部

役職交代時は`employees.role`をSQLで書き換えるだけでよい(コード修正不要)。

## 旅費規程グループ

- 社長(伊豆倉寿信):道内 日当6000/宿泊12000、道外 日当9500/宿泊14000
- 取締役(伊豆倉米郎・伊豆倉鈴雄・佐々木紀康・大坂朝夫):道内 日当5000/宿泊9000、道外 日当8000/宿泊11000
- 大角賢一:道内 日当3000/宿泊8000、道外なし
- 基本(上記以外全員):道内 日当3000/宿泊7000、道外 日当5000/宿泊9000

宿泊費は「日数-1」を宿泊数として計算。

## できていること(9/1リリースに向けて概ね完成)

- 打刻(GPS・現場選択・履歴・月切り替え・現在時刻表示・セッション切れ検知・連打防止)
- 打刻修正申請(時刻+現場、承認/却下)
- スケジュール(カレンダー・複数日・終日/時刻指定・参加メンバー・祝日表示・表示優先順位)
- 有給・出張申請(3段階承認・自動スキップ・取り消し・出張旅費自動計算・承認後スケジュール自動反映)
- 申請書類のPDF化(印影入り、有給/出張で別レイアウト)
- 管理者機能(現場管理・Excel出力・承認済み書類の閲覧削除)
- 打刻漏れ通知(毎日+半月、土日祝日除外、cron設定済み)
- 承認フェーズ通知(申請〜完了まで一通り)
- 4画面の相互ナビゲーション(管理者のみ「管理」リンク表示)
- 28名分の本番アカウント登録済み

## 残タスク

- [ ] `check-missing-punches`の月曜自動実行の最終確認(RESTRICT_TO_SHIMAKIを解除するタイミングもここで判断)
- [ ] 全28名分の本番アカウントでの動作確認
- [ ] スマホでの表示確認(特にスケジュールのカレンダー)
- [ ] 3つの通知系Edge FunctionsのTEST_MODE解除(リリース直前)
- [ ] 9/1本番リリース

## 保留中・将来対応

- 現場ごとの勤務時間補正+みなし残業(月40時間)計算 → `sites.work_start/work_end`列は用意済みだが未使用。設計をやり直す可能性ありのため保留
- プッシュ通知(スケジュールのリマインダー) → Web Pushの実装が必要、規模が大きいため後回し
- 有給・出張申請書のFileforce自動保存 → 現状は管理者が手動でPDF保存→Fileforceにアップロードする運用。自動化するならPython実行環境が別途必要
- 出張申請の交通費・宿泊費のFileforce証跡運用ルール確定

## 開発ルール

- **合言葉方式**:コード変更は必ず内容を先に説明し、ユーザーが「やっちゃいな」と言うまで実行しない(GitHubコミット・Supabase操作とも)。「進めよう」等の曖昧な同意では実行しないこと。
- GitHubへの直接コミットは、Claudeが専用のFine-grained PAT(このリポジトリのみ、Contents:Read and write)を使って行っている。トークンは別途ユーザーから都度受け取る運用。
- Supabase(SQL実行、Edge Functions編集、Secrets登録)はユーザーが手動で行う(直接接続は未設定)。
- 複数アカウントでの同時ログインテストは、タブではなく別ブラウザ/シークレットウィンドウを使うこと(セッションが競合するため)。

## 修正履歴(重要なバグ)

- **2026-08-10**:`check-missing-punches`で2つのバグを発見・修正。①「前日」を単純計算していたため、月曜実行時に日曜(対象外の日)を見てしまい、金曜分の打刻漏れを見逃していた→土日・祝日を遡って直近の平日を探す方式に修正。②スケジュール除外判定で、`end_date`がnull(単日の予定)の場合を「無期限」と誤解釈し、1日だけの有給がそれ以降ずっと除外対象になっていた→`end_date`がnullの場合は`date`と同日のみ対象とするよう修正。`check-missing-punches-biweekly`は元々正しい書き方だったため同バグはなし。

## 秘密情報の所在(値はここに書かない)

- Supabase Publishable Key:各HTML内の`supabaseUrl`/`supabaseKey`に直書き(公開情報のため問題なし)
- Resend APIキー:Supabase Edge Functions の Secrets(`RESEND_API_KEY`)
- Supabase service_role キー:Supabase Vault(`service_role_key`という名前で保管、cronから参照)
- GitHub PAT:ユーザーが管理。Claudeとの会話内で都度共有
