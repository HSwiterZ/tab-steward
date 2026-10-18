# Tab Steward — Chrome タブマネージャー

[![check](https://github.com/HSwiterZ/tab-steward/actions/workflows/ci.yml/badge.svg)](https://github.com/HSwiterZ/tab-steward/actions/workflows/ci.yml)

[English](README.md) · [简体中文](README.zh-CN.md) · **日本語** · [한국어](README.ko.md)

ビルド工程も依存パッケージもない Manifest V3 拡張機能です。すべてのソースは素の ES モジュールなので、
フォルダをそのまま「圧縮されていない拡張機能を読み込む」で動きます。

<table>
  <tr>
    <td><img src="docs/screenshots/dashboard-tabs.png" width="430" alt="Dashboard：ウィンドウ別にまとめたサイトカード"></td>
    <td><img src="docs/screenshots/dashboard-analytics.png" width="430" alt="使用状況分析：サイトのフォアグラウンド時間ランキング"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/dashboard-tabs-dark.png" width="430" alt="Dashboard ダークテーマ"></td>
    <td><img src="docs/screenshots/popup.png" width="270" alt="ツールバーポップアップ"></td>
  </tr>
</table>

> **拡張機能の UI は現在中国語のみです。** ドキュメントは翻訳済みですが、UI はまだ翻訳されていません。
> 上のスクリーンショットも実際の中国語 UI です。

Tab Steward は各タブがどれだけ放置されているかを計測し、古いタブをスリープさせ、タブのまとまりを
名前付きコレクションに一時保存し、重複を整理し、ワークスペース全体をスナップショット／復元し、
時刻指定のリマインダーを設定し、タブ／一時保存／ブックマーク／履歴／閉じたタブを 1 つの
`Ctrl`/`⌘K` パレットから検索します。「開いているタブ管理」「一時保存」「使用状況分析」の 3 つ以外は
すべてオフにできます。データはすべて手元の `chrome.storage.local` に留まり、任意の LLM アシスタントは
デフォルトでオフで、あなたが指定した Base URL としか通信しません。アイコンとスタイルの出所は
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) を参照してください。

## デモ

以下の映像はすべて実際の UI を録画したものです。データは内蔵の mock シード（`src/dev/mock-chrome.js`）で、誰かの実閲覧履歴は含まれていません。

<table>
  <tr>
    <td><img src="docs/demos/search.gif" width="460" alt="統一検索"><br><b>統一検索</b><br><code>⌘K</code> パレットひとつでタブ／一時保存／ブックマーク／履歴／閉じたタブを横断検索。</td>
    <td><img src="docs/demos/stash-drag.gif" width="460" alt="ドラッグで一時保存"><br><b>ドラッグで一時保存</b><br>タブをコレクションにドロップ。折りたたんだ状態でも受け取り、タブは閉じません。</td>
  </tr>
  <tr>
    <td><img src="docs/demos/sleep.gif" width="460" alt="スリープ"><br><b>スリープ</b><br>サイトごとにアイドル度を表示。1タブだけも、グループ全体も。</td>
    <td><img src="docs/demos/duplicates.gif" width="460" alt="重複タブ"><br><b>重複タブ</b><br>重複だけを絞り込み。通知するだけで、閉じる判断はあなたに残します。</td>
  </tr>
  <tr>
    <td><img src="docs/demos/organize.gif" width="460" alt="自動整理"><br><b>自動整理</b><br>サイトを隣接、またはコレクション別にグループ化をワン操作。</td>
    <td><img src="docs/demos/snapshots.gif" width="460" alt="ワークスペーススナップショット"><br><b>ワークスペーススナップショット</b><br>ウィンドウのタブ構成と順序を保存し、いつでも復元。</td>
  </tr>
  <tr>
    <td><img src="docs/demos/reminders.gif" width="460" alt="時刻指定リマインダー"><br><b>時刻指定リマインダー</b><br>対象は開いているタブから選び、時間を設定。ボタン付き通知で届きます。</td>
    <td><img src="docs/demos/analytics.gif" width="460" alt="使用状況分析"><br><b>使用状況分析</b><br>サイト別・ページ別のフォアグラウンド時間とアクティブ回数。すべてローカル。</td>
  </tr>
</table>

## インストール

1. `chrome://extensions` を開く
2. 右上の「デベロッパーモード」を ON にする
3. 「圧縮されていない拡張機能を読み込む」でこのフォルダを選択
4. ツールバーにアイコンが出たら完了。クリックでポップアップ、`Alt+Shift+T` で Dashboard

## 画面

| 画面 | 場所 | 内容 |
|---|---|---|
| ツールバーポップアップ | `src/popup/` | 統一検索（タブ／一時保存／ブックマーク／履歴／閉じたタブ）。下部は「現在のタブ」と「一時保存」の 2 カラム。サイト単位の折りたたみ、一時保存・スリープ・閉じる、重複の整理 |
| Dashboard | `src/dashboard/` | 上部バー＝ロゴ＋検索欄＋機能ボタン。主領域＝現在のタブ（並び替え／ウィンドウ別にグループ化／フィルターチップ／ウィンドウ別セクション／サイトカード）。右カラム＝常時表示のコレクションパネル。リマインダー・スナップショット・分析・ごみ箱は上部バーのアイコンで切り替え |
| 新しいタブページ | `src/newtab/` | デフォルトはミニマルなスタートページ。設定で完全な Dashboard に切り替え可能 |
| 設定 | `src/options/` | すべてのトグルと LLM の設定 |

ショートカット：`Alt+T` ポップアップ、`Alt+Shift+T` Dashboard、`Ctrl/⌘+K` 統一検索。

ページ上で右クリックすると「Tab Steward」の項目が増え、サブメニューにリマインダー設定（プリセット時間）、
一時保存…、一時保存して閉じる…（どちらも全コレクションを一覧表示）、このタブをスリープ、
ウィンドウへ移動（通常ウィンドウを一覧表示）、すべてのタブを整理（サイトを隣接＋コレクション別にグループ化）、
サイト単位の保護トグルが入ります。サブメニューはコレクションやウィンドウの変化に応じて自動で再構築されます。

## 機能モジュールとデフォルト

3 つのコア機能（開いているタブ管理・一時保存・使用状況分析）を除き、すべての機能はトグル可能なモジュールで、
設定ページ上部の「機能モジュール」一覧にまとまっています（唯一の真実の情報源：`src/core/modules.js`）。
**モジュールをオフにすると、ポップアップ・Dashboard・右クリックメニュー・統一検索・設定ページにある
そのモジュールの入口がすべて消え、バックグラウンド動作も停止します。データは一切削除されず、
オンにし直せばそのまま戻ります。**

使用状況分析はコア側です：アイドル度も Dashboard のすべての並び順もこの収集値から計算されるため、
オフにすると並び順が劣化します。なのでトグルは用意していません。

| モジュール | デフォルト |
|---|---|
| 開いているタブ管理、一時保存、使用状況分析 | コア機能。無効化不可 |
| コレクション、重複タブの整理、スリープ、時刻指定リマインダー、ワークスペーススナップショット、自動整理、ブックマークと履歴の検索、ごみ箱とバックアップ | オン |
| LLM 整理アシスタント、タブホバー時のスクリーンショット | オフ（モデルのエンドポイントとキーは各自ご用意／ページの権限は都度許可） |

重複を見つけても通知するだけで、タブを勝手に閉じることはありません。同じページをもう 1 枚開くのは
よくある操作（フォームをもう 1 つ、左右に並べて比較）なので、閉じるかどうかの判断はあなたに残します。
通知にも Dashboard のバナーにも「これを閉じて移動」と「既存のタブに切り替え」の 2 ボタンを置き、
何も選ばなければ両方そのまま残ります。一括整理（ポップアップと Dashboard の「重複を整理」）は
クリックした後にだけ実行され、取り消し（Undo）が付いてきます。

通知が画面に残るか（スティッキー）は別の設定で、デフォルトはオンです。常駐させないと、
Windows 側が通知を表示を待たずに畳んでしまい、「これを閉じて移動」と「10 分スヌーズ」が
クリックできなくなります。

`chrome.processes` は Chrome のデベロッパーチャネルでしか使えず安定版では動かないため、
「レンダラープロセスのメモリ」というモジュールは用意せず、manifest でも `processes` 権限を要求していません。

## 機能とコードの対応

| 機能 | 主要ファイル |
|---|---|
| モジュールのトグル | `src/core/modules.js`（レジストリ）、`src/ui/shared.js` の `featureOn()`（全画面がここから読む） |
| ストレージと移行 | `src/core/storage.js`、`src/core/defaults.js` |
| 使用状況分析とアイドル度 | `src/core/stats.js`、`src/background/tracker.js` |
| スリープと保護 | `src/background/sleep.js`、`src/core/actions.js` |
| 重複タブの整理 | `src/core/dupes.js`、`src/background/index.js` |
| 自動整理とタブグループ | `src/core/organize.js` |
| 統一検索 | `src/core/search.js`、`src/ui/shared.js`（⌘K パネル） |
| 一時保存とコレクション | `src/core/collections.js` |
| ブックマークと履歴 | `src/core/bookmarks.js`、`src/core/history.js` |
| 時刻指定リマインダー | `src/core/reminders.js` |
| ワークスペーススナップショット | `src/core/snapshots.js` |
| ごみ箱とバックアップ | `src/core/trash.js`、`src/core/backup.js` |
| LLM アシスタント | `src/core/llm.js` |
| ホバー時スクリーンショット | `src/background/screenshots.js`（撮影とキャッシュ）、`src/ui/shared.js` の `installHoverPreview()`（表示） |
| UI プリミティブ | `src/ui/kit.js`、`src/ui/icons.js`、`src/ui/styles/*` |

## LLM アシスタント

OpenAI の `/chat/completions` プロトコルに対応しています。まず設定ページの「機能モジュール」で
LLM 整理アシスタントをオンにし、Base URL・API Key・モデル名を入力してください。キーは手元の
`chrome.storage.local` にのみ保存されます。リクエストボディに含まれるのはタブのタイトル、ドメイン、
アイドル分数、状態だけです。完全な URL や履歴は送りません。モデルがテーマ別のグループ化とスリープ案を
返したら、まずプレビューを表示し、あなたが確認して初めて適用されます。確認しなければ何も変わりません。

## 権限

| 権限 | 用途 |
|---|---|
| tabs / tabGroups / windows | タブとグループの読み取り、移動、スリープ、グループ化 |
| storage / unlimitedStorage | コレクション、スナップショット、統計などのローカルデータ |
| bookmarks / history / sessions | ブックマーク保存、履歴検索、閉じたタブの復元 |
| notifications / alarms | リマインダーと自動スリープのトリガー |
| favicon | サイトのアイコン |
| contextMenus | 右クリックの一時保存／保護／リマインダー |
| activeTab | あなたが明示的に操作した際の現在のタブへのアクセス |
| optional_host_permissions `<all_urls>` | 「タブホバー時のスクリーンショット」をオンにした時だけ都度要求 |

## プライバシー

サーバーはありません：テレメトリ、アナリティクス、広告、クラッシュレポートは一切書き込まず、
開発者が運用するエンドポイントも存在しません。コレクション、スナップショット、使用統計、リマインダー、
ごみ箱はすべて手元の `chrome.storage.local` に保存され、アンインストールすれば拡張データと一緒に消えます。

外部へのリクエストは 1 つだけで、しかもデフォルトはオフ：LLM 整理アシスタントです。有効化する前に
Base URL と API Key を自分で入力する必要があります（キーもローカル保存のみ）。リクエストボディは
タブのタイトル、ドメイン、アイドル分数、状態のみで、完全な URL も履歴も含みません。ホバー時
スクリーンショットの `<all_urls>` は都度許可制で、許可しなければ何も入りません。

ブックマークと履歴は検索のためにローカルで読み取るだけで、その結果はブラウザの外に出ません。

## 開発

依存パッケージのインストールは不要です。

```bash
node tools/serve.mjs          # ローカル静的サーバー（デフォルトポート 8787）
node tools/check-imports.mjs  # すべての名前付き import に対応する export があるか
node tools/scan-undefined-refs.mjs  # 逆方向：import せずに使っている識別子（例：Button）
node tools/make-icons.mjs     # アイコン再生成（ピクセル自己チェック付き。透明画像なら即失敗）
node tests/run.mjs            # コアロジックの自動テスト（46 件）
node tools/record-demo.mjs    # デモ GIF を再生成（Chrome と ffmpeg が必要）
```

`package.json` はスクリプトだけで依存を持たないので、`npm test` も `npm run check`
（import チェック＋未 import 識別子スキャン＋テスト）もそのまま動きます。テストは
`tests/chrome-stub.mjs` という chrome テストダブル上で実行されます。これは実 API と同じ厳しさで
実装しています（引数検証、`storage.onChanged` を書き込み側にも発火させる、`alarms` の名前と
クエリのセマンティクス、`tabs.query` は未知のフィルターで即エラー、通知の `priority` が負値の時は
Windows/Linux/macOS それぞれの実際の挙動で拒否）。だからこそ合格に意味があります。

`http://localhost:8787/src/dashboard/index.html` のようなページをブラウザで開くと、
`src/dev/mock-chrome.js` がシードデータ入りの `chrome.*` 実装（タブ、ウィンドウ、グループ、
ブックマーク、履歴、閉じたタブ、ストレージ）を注入するので、拡張機能をインストールしなくても
すべての画面が動き、スクリーンショットも取れます。ページ下部に MOCK バナーが表示され、
タブの追加やシードのリセットができます。任意のページに `?theme=dark`（mock 時のみ有効）を付けると
ダークテーマを強制でき、4 つの画面すべてで並べて比較できます。`?nobanner` はバナーを消すオプションで、
上のドキュメント用スクリーンショットはこの方法で撮っています。

## デザイントークン

色、角丸、間隔、影、アニメーション時間はすべて `src/ui/styles/tokens.css` に集約し、
ライト／ダークはトークン値の差し替えだけ。ブランドカラーは indigo→violet のグラデーションで、
`--primary` はアクションと構造（プライマリボタン、スイッチ、チェックボックス、アクティブタブの
下線、フィルターチップ、プログレスバー、現在行のインジケーター）に限定、`--gradient-brand` は
アイコンと統計カードの罫線に使います。サイトの favicon のレタータイルと Chrome のタブグループ色は
データ側の色なので、`TILE_HUES` は意図的に色相 225–285 の帯を避けています。サイトのアイコンが
UI コントロールに見えないようにするためです。UI を追加するときはトークンを読み、色や `ms` 値を
直書きしないでください。

ヘッドレスでのスクリーンショット例：

```bash
chrome --headless=new --window-size=1440,900 --virtual-time-budget=4500 \
  --screenshot=out.png "http://localhost:8787/src/dashboard/index.html#tabs"
```

注意：ヘッドレスモードは `transform` で中央寄せした要素（検索パレットなど）の描画位置が不安定なので、
レイアウトの確認はヘッドありブラウザで行ってください。

## ライセンス

ソースは [MIT](./LICENSE) ライセンスです。UI アイコンのパスデータは Lucide（ISC）由来で、
一部はさらに Feather（MIT）まで遡ります。スタイルのプリミティブは shadcn/ui（MIT）を参照しています。
3者すべての完全な許諾条件と著作権表示は [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) にあり、
再配布時も必ず維持してください。
