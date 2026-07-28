# app-legal-pages

新規アプリ共通の法務ページを公開する静的サイトです。

- 公開URL: <https://speeed131.github.io/app-legal-pages/>
- ホスティング: GitHub Pages
- 解析、Cookie、広告、外部フォント、クライアントJavaScript: なし
- 初号機: 「英検3級 英単語 スキ単」

## ディレクトリ

```text
apps/
  <app-slug>/
    app.json
    index.html
    privacy-policy/index.html
    terms/index.html
    tokushoho/index.html
assets/
  legal.css
scripts/
  build.mjs
  validate.mjs
```

各アプリの正式URLは次の形式です。

```text
https://speeed131.github.io/app-legal-pages/apps/<app-slug>/privacy-policy/
https://speeed131.github.io/app-legal-pages/apps/<app-slug>/terms/
https://speeed131.github.io/app-legal-pages/apps/<app-slug>/tokushoho/
```

## 更新手順

1. 対象アプリの実装、App Store Connect、RevenueCat、分析SDKの設定を確認する。
2. `app.json` と法務3文書を同じ変更で更新する。
3. 価格、商品種別、無料トライアル、ファミリー共有、問い合わせ先、制定・改定日を照合する。
4. `npm test` を実行する。
5. `npm run build` を実行し、`_site/` の内容をローカルHTTPサーバーで目視確認する。
6. `main` への反映後、Actionsと公開URLのHTTP 200を確認する。
7. アプリ内URL、App Store Connect、法務台帳を同時に更新する。

`_site/` は生成物のためコミットしません。

## 新規アプリの追加

既存の同種アプリで運用中の法務文書を基準に、新しいslugのディレクトリを追加します。共通条項の構成・条番号・文言は維持し、アプリ名、商標、対象範囲、実装、商品条件など事実が異なる箇所だけを変更します。一般条項の改善が必要な場合は、特定アプリだけを独自改変せず、基準文書と影響する全アプリを同時に改訂します。

最小差分で作成したうえで、次を必ず実装と照合してください。

- 端末内に保存するデータ
- 外部へ送信するイベント、識別子、診断情報
- アカウント、広告、位置情報、通知、クラウド同期の有無
- 課金商品、価格、更新、解約、返金、共有条件
- 配信地域、対象年齢、商標、公式サービスとの関係
- 問い合わせ先、事業者情報、保存・削除方法

未確定値を `TBD` や仮の数値で公開せず、確定まで文書をデプロイ対象へ追加しないでください。

## ローカル検証

```bash
npm test
npm run build
python3 -m http.server 4173 --directory _site
```

ローカルでは <http://localhost:4173/> を開きます。`404.html` のルートリンクだけはGitHub Pagesの本番prefixを前提とします。

## 公開

`.github/workflows/pages.yml` がpull requestで検証を行い、`main` へのpushでGitHub Pagesへデプロイします。

法務本文の内容確認は専門家による法的助言を代替するものではありません。サービス内容、法令、Appleの要件、外部SDKの仕様が変わった場合は再確認してください。
