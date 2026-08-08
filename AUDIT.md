# ✅ GIGA Standard v4 監査：オンライン出版社 Pro

監査日：2026-08-08 ／ 対象コミット：`e802866`
判定はすべて **改修前の実測値**。対応フェーズ欄は本ロールアウトでの実施計画。

## 0. 構成の判定

| 項目 | 実測 |
|---|---|
| アーキテクチャ型 | **C+型**（GAS ウェブアプリ本体 + GitHub Pages の PWA シェル） |
| GAS 側 | `code.gs`（446行 / 17KB）、`index.html`（2,173行 / 151KB・React + Babel standalone を CDN から実行） |
| シェル側 | `pwa/index.html`（7.5KB）、`pwa/manifest.webmanifest`、`pwa/sw.js`、`pwa/icons/`（4点） |
| `vite.config.*` | なし（B型ではない） |
| `appsscript.json` | **リポジトリに存在しない**（OAuth スコープをコードから検証できない） |
| `.clasp.json` / `.env` | コミットされていない ✅ |

---

## A. 法務・配布

| # | 項目 | 判定 | 実測 | 対応 |
|---|---|:--:|---|---|
| A1 | LICENSE 実ファイル | ❌ | README に「MIT」と書いてあるだけで実ファイルが無い | **P0** |
| A2 | .gitignore | ❌ | 存在しない（`.clasp.json` を誤コミットする危険） | **P0** |
| A3 | dependabot.yml | ❌ | 存在しない | **P0** |
| A4 | README.md / MANUAL.md 両方 | ✅ | 両方あり。内容も実装と一致 | 加筆のみ P3 |

## B. セキュリティ

| # | 項目 | 判定 | 実測 | 対応 |
|---|---|:--:|---|---|
| B1 | CSP（connect-src が最小） | ❌ | `Content-Security-Policy` 0件。外部CDN 5系統（tailwindcss / jsdelivr / fonts.googleapis / cdnjs / unpkg×3）に依存 | **報告のみ**（§停止条件） |
| B2 | 秘密情報・IDの直書きなし | ⚠️ | APIキー・パスワードは `PropertiesService` 管理で ✅。ただし `code.gs:51` の `setFaviconUrl` に Drive ファイルID が直書き（公開ファイルのIDであり実害は小さいが定数化が望ましい） | 報告（P3提案） |
| B3 | OAuthスコープ最小 | ⚠️ | `appsscript.json` が無く検証不能。コードは `SpreadsheetApp` / `DriveApp.getFolderById` / `UrlFetchApp`(Gemini) を使用 → `DriveApp` の使用により `auth/drive` 全体が自動付与されている可能性が高い | **報告のみ**（本番の再認可が必要なため） |
| B4 | postMessage の宛先が `*` でない | ✅ | `postMessage` の使用箇所なし | — |
| B5 | サーバー側5段ガード | ⚠️ | 教師機能は `verifyTeacher_()`（合言葉1段）で保護。児童・ギャラリーは無認証で全作品を取得できる設計（`getDraftList('student')` が氏名・学級・本文を全件返す） | **報告のみ**（設計変更のため別PR） |

> **B5 の補足（先生向け）**：このアプリは「1つのクラスで1つのURLを共有する」前提の設計です。
> URLを知っている人は、ログインなしでクラス全員の作品と氏名を読めます。
> URLを校外に出さない運用が前提であり、これは既存の仕様です。今回の改修では変更していません。

## C. 堅牢性

| # | 項目 | 判定 | 実測 | 対応 |
|---|---|:--:|---|---|
| C1 | LockService + try/finally | ✅ | `saveOrSubmitDraft` / `addGalleryComment` の両方で `waitLock(10000)` → `finally { releaseLock() }` | — |
| C2 | 自動復旧（シート再生成） | ✅ | `initDatabase()` がシート・フォルダを毎回検証し再生成 | — |
| C3 | pagehide で記録確定 | ⚠️ | `visibilitychange` は対応済み。`pagehide`（Chromebook のタブ破棄）は未対応。また保存はサーバーへの非同期呼び出しのみで、ローカル退避の同期書き込みが無い | **P1** |
| C4 | 通信失敗時のリトライと明示 | ✅ | `runGAS` が3回リトライ、オフラインキュー + `online` 復帰時の救出保存あり | — |
| C5 | localStorage.clear() 不使用 | ✅ | 0件。キー単位で削除 | — |

## D. 表示（Part I §2）

| # | 項目 | 判定 | 実測 | 対応 |
|---|---|:--:|---|---|
| D1 | viewport に viewport-fit=cover | ✅ | `index.html` / `pwa/index.html` / `code.gs` の `addMetaTag` すべてに付与済み。`user-scalable=no` は不使用 | — |
| D2 | 100dvh を使用 | ⚠️ | `@supports (height:100dvh)` で上書きしており実害は無いが、素の `100vh` が2箇所（`index.html:52`, `pwa/index.html:21`）。`visualViewport` 未対応（原稿用紙の入力欄がソフトキーボードで潰れる） | **P1** |
| D3 | safe-area-inset を適用 | ❌ | **0件**。`viewport-fit=cover` を付けているのに safe-area を足していないため、iPad のホームバー・ノッチに UI が潜り込む | **P1** |
| D4 | clamp() による fluid type | ❌ | 0件。Tailwind の固定クラスのみ | **P1** |
| D5 | Canvas に devicePixelRatio 補正 | ➖ | Canvas は1箇所（`index.html:97` `resizeImage`）のみで、**画面表示用ではなく挿絵画像の縮小用オフスクリーン Canvas**。DPR 補正は仕様上不要（適用すると出力画像が2倍に膨れて逆効果） | 該当なし |
| D6 | 320px 幅で横スクロールが出ない | ⚠️ | 目視検証未実施（GAS 環境が必要なため実機確認は先生に依頼）。`min-w-0` / `truncate` / `shrink-0` は各所に適用済みで設計上の配慮はあり | P1で `overflow-x` ガードを追加 |
| D7 | 画像に width/height、150KB以下 | ❌ | `pwa/index.html` のロゴ `<img>` に width/height 無し（CLS）。`pwa/icons/icon-512.png` **100KB**（目標60KB）、`icon-maskable-512.png` **84KB**。`docs/note/images/` の24枚が合計 **13.4MB**（最大892KB）※ドキュメント用でアプリは読み込まない | **P2** |
| D8 | コントラスト 4.5:1 以上 | ⚠️ | 主要文字色は `slate-700/800` で十分。`text-slate-400`（`#94a3b8`、白背景で 2.8:1）が日付・補助テキストに使用されており不足 | **P1**（補助テキストのみ1段濃く） |
| D9 | タップ領域 44px 以上・touch-action | ⚠️ | `touch-action: manipulation` は適用済み ✅。歯車・閉じるなどアイコンのみのボタンが `p-1.5`〜`p-2` で **約38px**（44px 未満） | **P1** |
| D10 | prefers-reduced-motion 対応 | ❌ | **0件**。`animate-modal` / `animate-toast` / `animate-bounce` / `transition` が94箇所 | **P1** |
| D11 | 提示モード | ➖ | 未実装。ギャラリーを電子黒板に映す使い方が想定されるため有用だが、UIボタンの追加＝機能追加のため今回は**提案のみ** | 提案（P3） |
| D12 | 印刷CSS | ⚠️ | `@page A4 landscape` と `.no-print` は実装済み ✅。`print-color-adjust: exact` が無く、**原稿用紙のマス目と朱書き（添削の赤線）が印刷されない**ブラウザがある。`break-inside: avoid` も無し | **P1** |

## E. PWA（Part I §3）

| # | 項目 | 判定 | 実測 | 対応 |
|---|---|:--:|---|---|
| E1 | manifest の id/scope/start_url がリポジトリ名絶対パス | ❌ | `id` が**未設定**、`scope: "./"`、`start_url: "./index.html"`。`gigayama.github.io` は数十アプリで同一オリジンを共有するため、識別子が暗黙の start_url 任せになっている | **P1** |
| E2 | アイコン4種 + apple-touch-icon | ❌ | 192 / 512 / maskable-512 / svg はあるが、**maskable-192 と apple-touch-icon が無い**（`apple-touch-icon` に 192 を流用しており、iOS でマスク前提の余白が出る） | **P1** |
| E3 | beforeinstallprompt を head 最上部で捕捉 | ❌ | `pwa/index.html` の **body 末尾**（195行目付近）で登録。Chrome は条件成立と同時にイベントを出すため、遅い回線ではインストールボタンが出ない | **P1** |
| E4 | インストールボタンをアプリ内に設置 | ⚠️ | セットアップ画面にはあるが、URL入力済みでアプリ起動後（`app-mode`）は**画面から消える**ため、2回目以降の児童はインストールできない | **P1** |
| E5 | sw.js が自アプリ接頭辞のキャッシュのみ削除 | ✅ | `CACHE_PREFIX = 'opp-shell-'` で絞り込み済み（PR #2 で修正済み） | — |
| E6 | sw.js が localStorage に触れていない | ✅ | 0件 | — |
| E7 | 更新通知 | ❌ | 無し。`skipWaiting()` を install で即実行しているだけで、児童には更新が伝わらない | **P1** |
| E8 | offline.html | ❌ | 存在しない。圏外だと真っ白 or ブラウザのエラー画面 | **P1** |
| E9 | APP_VERSION を更新 | ⚠️ | `'v2'`。今回の変更に合わせて更新が必要 | **P1** |
| E10 | iOS の「ホーム画面に追加」手順を MANUAL に記載 | ❌ | README に1行あるのみ。MANUAL.md には記載なし | **P3** |
| E11 | precache が addAll で全滅する | ❌ | `cache.addAll(SHELL_ASSETS)` のため1本でも404だとインストールが失敗し、オフライン起動できない | **P1** |

## F. アクセシビリティ・性能

| # | 項目 | 判定 | 実測 | 対応 |
|---|---|:--:|---|---|
| F1 | alt / aria-label / aria-live | ❌ | `<img>` 2箇所は `alt` あり ✅。`aria-label` **0件**（アイコンのみのボタンが多数）、`aria-live` **0件**（保存完了・提出のトーストが読み上げられない）、`role="dialog"` **0件** | **P1** |
| F2 | キーボードのみで全機能に到達 | ⚠️ | Esc で閉じるは実装済み ✅。モーダルのフォーカストラップ無し（背面の要素に Tab が抜ける）。`:focus-visible` の指定も無い | **P1** |
| F3 | 初回JS 300KB以下 | ❌ | **大幅超過**。React + ReactDOM + Babel standalone + Tailwind CDN + diff_match_patch で **約 1.5MB**（うち Babel standalone だけで約 900KB）。さらにブラウザ側で 151KB の JSX を実行時トランスパイルしている | **報告のみ**（§停止条件・別PR） |
| F4 | 1ファイル 5,000行 / 400KB 以内 | ✅ | `index.html` 2,173行 / 151KB | — |

## G. 学習ログ（学習系のみ）

| # | 項目 | 判定 | 実測 |
|---|---|:--:|---|
| G1 | study.v1 準拠 | ➖ | 未導入。本アプリは作文の提出物管理であり学習ログ系ではないため必須ではない |
| G2 | 中断記録・5分ルール | ➖ | 同上 |

---

## ❌ のうち、今回**直さない**もの（理由と対処方針）

### 1. B1 / F3 — CDN 依存と CSP（最大の課題）

**現状**：`index.html` は Tailwind CDN・React UMD・**Babel standalone** を外部から読み込み、
2,173行の JSX を**児童の端末で毎回トランスパイル**している。
初回読み込みは実測で約 1.5MB、目標（300KB）の5倍。校内Wi-Fiで40人同時に開くと最も重い箇所。

**直さない理由**：
- 解消には「ビルド工程の導入（B型化）」または「vendor/ への自己ホスト + JSX の事前変換」が必要で、
  変更行数が 100行を大きく超える。テストが無い状態での大改修は §停止条件に該当する。
- GAS は `HtmlService` で HTML を返す都合上、静的アセットの自己ホストにも設計変更が要る。

**対処方針（別PRの提案）**：
1. `pwa/vendor/` に React / diff_match_patch / Tailwind のビルド済みCSS を配置し、GAS 側からではなく
   シェル側で配信する（C+型の利点を活かす）。
2. JSX を事前ビルドして `.js` にし、`type="text/babel"` と Babel standalone を撤去する（**単独で約900KB削減**）。
3. その上で CSP を投入し、`npx serve` でコンソールに `Refused to` が0件であることを確認する。

→ 段階1・2だけでも初回転送量は 1/4 以下になる。**まずここを人間と合意したい。**

### 2. B3 — OAuth スコープ

`appsscript.json` がリポジトリに無いため、本番のスコープを推測で書き換えることができない。
`DriveApp.getFolderById()` を使っているため `https://www.googleapis.com/auth/drive` が付いている可能性が高く、
GIGA Standard の禁止項目に該当する。

**必要な作業（先生の操作が要る）**：
1. GAS エディタ →「プロジェクトの設定」→「`appsscript.json` を表示する」にチェック。
2. `oauthScopes` を確認し、`.../auth/drive` があれば `.../auth/drive.file` への変更を検討。
   ただし **既存の画像フォルダにアクセスできなくなる可能性があるため、必ず検証用のコピーで先に試す**こと。
3. スコープ変更後は**全ユーザーの再認可が必要**。学期の途中では行わないこと。

→ 本番の値が分からないまま `appsscript.json` をコミットすると、`clasp push` で本番の設定を
上書きして認可が壊れる。よって**このファイルは今回追加しない**。

### 3. B5 — 児童モードの無認証アクセス

「1クラス1URL」の設計であり、変更するとデータ構造（学級・氏名の扱い）と運用手順の両方が変わる。
§停止条件「スプレッドシートのスキーマ変更が必要なとき」に該当するため、報告に留める。

### 4. D11 — 提示モード

UI にボタンを追加する＝機能追加であり、改修モードの規則6（UIの文言・配色を変えない）の趣旨から外れる。
ギャラリーを電子黒板に映す使い方が想定されるため、**別PRでの追加を提案**する。
