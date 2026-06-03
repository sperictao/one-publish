<div align="center">

<img src="src-tauri/icons/128x128@2x.png" alt="OnePublish Icon" width="128" height="128" />

# OnePublish

**マルチ言語プロジェクトのパブリッシュを、美しくシンプルに。**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.x-FFC131?logo=tauri&logoColor=white)](https://tauri.app)
[![React 18](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-1.77+-DEA584?logo=rust&logoColor=white)](https://www.rust-lang.org)

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [Français](README.fr.md) · [Deutsch](README.de.md)

</div>

---

## OnePublish とは？

OnePublish は、ソフトウェアプロジェクトをパブリッシュするための美しく生産性の高い GUI を提供する **クロスプラットフォームのデスクトップアプリケーション**です。複雑な CLI コマンドを覚えて入力する代わりに、リポジトリを選択し、インテリジェントなフォームでパラメータを設定し、ワンクリックでパブリッシュできます。

**一つのツール。複数の言語。** .NET · Rust (cargo) · Go · Java (Gradle) — すべて同じ統一インターフェースから。

## ✨ ハイライト

- 🎯 **マルチ言語サポート** — .NET (`dotnet publish`)、Rust (`cargo build --release`)、Go (`go build`)、Java/Gradle — さらに追加予定
- 🧠 **スキーマ駆動パラメータ** — 100% のパラメータ表現力：すべての CLI フラグ、環境変数、引数が表現・検証され、ハードコードされていません
- 📋 **コマンドインポート** — 任意の CLI コマンドを貼り付けると、OnePublish が構造化されたパラメータに逆解析します
- 📊 **実行履歴** — 過去 20 回以上のローカルタイムライン、ワンクリックで再実行
- 🔍 **環境診断** — 不足しているツールチェーン（SDK、ランタイム）の自動検出とガイド付き修正
- 🎨 **Apple Liquid Glass デザイン** — macOS にインスパイアされた UI、backdrop-blur グラス素材、スプリングアニメーション、スペキュラーハイライト
- 🌐 **国際化対応** — 中国語（簡体字）と英語を完全サポート
- 🌓 **ダーク & ライトテーマ** — システム設定に追従
- 🔄 **自動アップデート** — GitHub Releases と統合された Tauri アップデーターパイプライン
- ⌨️ **キーボード優先** — 頻繁な操作にグローバルショートカット、マウスを使わずにパブリッシュ可能
- 📦 **ワンクリック GitHub リリース** — `pnpm release -v 1.0.0` でバージョン同期、リリースノート生成、コミット、タグ、プッシュ、CI 待機を実行

---

## 📸 スクリーンショット

<!-- TODO: add actual screenshots -->
> *スクリーンショットは近日公開予定です。それまでの間、[設計哲学](docs/design-philosophy.md) と [Liquid Glass デザインシステム](docs/liquid-glass-design-system.md) をご覧ください。*

---

## 🚀 クイックスタート

### 前提条件

| 必須 | バージョン | 用途 |
|----------|---------|---------|
| **Node.js** | ≥ 18 | フロントエンドランタイム |
| **pnpm** | latest | パッケージマネージャ |
| **Rust** | ≥ 1.77 | Tauri バックエンドコンパイル |
| **対象 SDK** | 異なる | 以下のうち少なくとも 1 つ: .NET SDK / Rust / Go / Java (Gradle) |

### macOS — 開発依存関係のインストール

```bash
# Xcode Command Line Tools（macOS で Tauri に必須）
xcode-select --install

# Node.js & pnpm
brew install node pnpm

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Linux — 開発依存関係のインストール

```bash
# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# Fedora
sudo dnf install webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel \
  librsvg2-devel
```

### Windows — 開発依存関係のインストール

```bash
# Chocolatey を使用
choco install nodejs pnpm rust
# または公式インストーラーを使用: nodejs.org, rustup.rs
```

### ビルド & 実行

```bash
# クローン
git clone https://github.com/sperictao/one-publish.git
cd one-publish

# 依存関係のインストール
pnpm install

# 開発モード（ホットリロード）
pnpm dev

# 本番ビルド
pnpm build
# 出力先: src-tauri/target/release/bundle/
```

---

## 🏗️ アーキテクチャ

```
one-publish/
├── src/                          # React フロントエンド (TypeScript)
│   ├── components/
│   │   ├── ui/                   # shadcn/ui プリミティブ (Button, Dialog, Select...)
│   │   ├── layout/               # レイアウト: パネル、リサイズハンドル、サイドバー
│   │   ├── publish/              # パブリッシュ設定: パラメータエディタ、コマンドインポート
│   │   ├── release/              # リリースチェックリストウィザード
│   │   └── environment/          # 環境診断 UI
│   ├── features/                 # ドメインロジック: publish, repository, provider, environment
│   ├── hooks/                    # React フック: useI18n, useAppState, useShortcuts...
│   ├── stores/                   # Zustand ステートスライス
│   ├── lib/                      # ユーティリティ: store API, paths, preflight, artifacts
│   ├── i18n/                     # 翻訳: zh.json, en.json
│   └── index.css                 # Liquid Glass デザイントークン + ユーティリティ
│
├── src-tauri/                    # Rust バックエンド (Tauri)
│   ├── src/
│   │   ├── main.rs               # エントリポイント
│   │   ├── lib.rs                # プラグイン登録 + コマンドハンドラ
│   │   ├── provider/             # 言語プロバイダトレイト + 実装
│   │   │   └── providers/        # dotnet.rs, cargo.rs, go.rs, java_gradle.rs
│   │   ├── commands/             # Tauri IPC コマンド (publish, repository, updater)
│   │   ├── environment/          # 言語ごとの環境チェック
│   │   ├── compiler.rs           # Spec → ExecutionPlan コンパイラ
│   │   ├── spec.rs               # PublishSpec（言語非依存のデータモデル）
│   │   ├── plan.rs               # ExecutionPlan（順序付きステップ）
│   │   ├── parameter.rs          # ParameterSchema + 検証
│   │   ├── store/                # 永続化 (JSON ファイルストレージ)
│   │   ├── config_export.rs      # 設定のインポート/エクスポート
│   │   ├── shortcuts.rs          # グローバルホットキー登録
│   │   └── tray.rs               # システムトレイ
│   ├── Cargo.toml                # Rust 依存関係
│   └── tauri.conf.json           # Tauri ウィンドウ、バンドル、アップデータ設定
│
├── tests/e2e/                    # Playwright e2e テスト
├── scripts/                      # ビルド/リリース自動化スクリプト
├── docs/                         # ドキュメント
│   ├── design-philosophy.md      # 製品およびエンジニアリング哲学
│   ├── liquid-glass-design-system.md
│   ├── roadmap/MASTER_PLAN.md    # 開発ロードマップ（11 フェーズ）
│   ├── updater/SETUP.md          # アップデータ設定ガイド
│   └── release/GITHUB_RELEASE.md # リリースパイプラインドキュメント
├── DESIGN.md                     # Apple デザイン分析（参考）
├── package.json
├── vite.config.ts
├── tailwind.config.cjs
└── tsconfig.json
```

---

## 🧩 仕組み

> **PublishSpec → ExecutionPlan → 実行**

1. **リポジトリを選択** — ローカルファイルから自動検出（`.sln`、`Cargo.toml`、`go.mod`、`build.gradle` など）
2. **パブリッシュパラメータを設定** — プリセット、スキーマ駆動フォーム、または生の CLI コマンドの貼り付けを使用
3. **プリフライトチェック** — 出力パス、環境の準備状況、ブランチの状態を検証
4. **実行** — ライブの `stdout`/`stderr` を UI にストリーミング、キャンセル対応
5. **レビュー** — 履歴タイムラインにすべての実行を保存、ワンクリックで再実行、診断情報のエクスポート、CI 引き継ぎスニペットの生成

---

## 🛠️ 技術スタック

| レイヤー | 技術 |
|-------|-----------|
| **フロントエンドフレームワーク** | React 18 + TypeScript |
| **ビルドツール** | Vite 7 |
| **スタイリング** | Tailwind CSS 3 + shadcn/ui (Radix UI) |
| **デザインシステム** | Apple Liquid Glass (backdrop-blur, spring physics, specular highlights) |
| **状態管理** | Zustand 5 |
| **アイコン** | Lucide React |
| **通知** | Sonner |
| **デスクトップフレームワーク** | Tauri 2.x (Rust) |
| **永続化** | JSON ファイルストレージ (`~/.one-publish/config.json`) |
| **型ブリッジ** | `ts-rs` (Rust ↔ TypeScript コントラクト生成) |
| **ユニットテスト** | Vitest（フロントエンド）+ Rust `#[cfg(test)]`（バックエンド） |
| **E2E テスト** | Playwright |
| **パッケージマネージャ** | pnpm |

---

## 📜 利用可能なスクリプト

```bash
# 開発
pnpm dev                 # フル Tauri 開発（フロントエンド + バックエンド）
pnpm dev:renderer        # Vite 開発サーバーのみ（フロントエンド）

# ビルド
pnpm build               # 本番 Tauri バンドル
pnpm build:renderer      # フロントエンドビルドのみ

# 品質
pnpm typecheck           # TypeScript 型チェック + コントラクト検証
pnpm test                # Vitest ユニットテスト
pnpm test:ui             # Vitest UI
pnpm test:watch          # Vitest ウォッチモード
pnpm e2e                 # Playwright e2e テスト
pnpm e2e:ui              # Playwright UI モード

# リリース
pnpm release -v 0.8.0     # フルリリースパイプライン
pnpm release -v 0.8.0 -d  # ドライラン（プレビューのみ）

# ユーティリティ
pnpm doctor              # react-doctor を実行してコード健全性をチェック
pnpm build:updater       # アップデータ本番設定を生成
```

---

## 🌍 国際化 (i18n)

OnePublish は **簡体字中国語** と **英語** を標準でサポートしています。設定からアプリ内で切り替えるか、プログラムで切り替えます：

```typescript
// アプリは localStorage('app-language') を読み取ります
// 値: 'zh'（デフォルト）または 'en'
```

翻訳ファイル: `src/i18n/zh.json` | `src/i18n/en.json`（各約 790 キー、機能ドメインごとに整理）。

---

## 🧪 テスト

| レイヤー | ツール | カバレッジ |
|-------|------|----------|
| フロントエンドユニット | Vitest + Testing Library | コンポーネント、フック、ストア、lib |
| バックエンドユニット | Rust `#[cfg(test)]` | プロバイダコンパイル、ストアマイグレーション、プラン生成 |
| E2E | Playwright（13+ スペック） | アプリ起動、リポジトリパネル、プロバイダ選択、パブリッシュプリセット、カスタム設定、プリフライト、コントラクトスモーク |
| 品質ゲート | TypeScript strict + `ts-rs` コントラクト | ビルド & CI で強制 |

---

## 🗺️ ロードマップ

OnePublish は .NET パブリッシュ GUI から **商用グレードのマルチ言語パブリッシング製品** へと進化しています。[マスタープラン](docs/roadmap/MASTER_PLAN.md) は 11 のフェーズにわたります：

| フェーズ | テーマ | ステータス |
|-------|-------|--------|
| 0 | エンジニアリング基盤（テスト、CI） | ✅ 完了 |
| 1 | パブリッシュコア抽象化（Spec, Plan, Logging） | ✅ 完了 |
| 2 | 言語プロバイダ（Rust/Go/Java） | ✅ 完了 |
| 3 | 100% パラメータ表現力（スキーマエディタ） | ✅ 完了 |
| 4 | 商用機能（インポート/エクスポート、環境チェック、署名） | ✅ 完了 |
| 5 | リリース操作 UX（チェックリストウィザード、プリフライト） | ✅ 完了 |
| 6 | マルチプロバイダ UX ブリッジ | ✅ 完了 |
| 7 | 実行信頼性 & DevEx（ストリーミング、キャンセル、スナップショット） | ✅ 完了 |
| 8 | 実行インテリジェンス & リカバリ（履歴、再実行、障害グルーピング） | ✅ 完了 |
| 9 | 診断の深化 & チーム引き継ぎ | ✅ 完了 |
| 10 | コラボレーションシグナル & タイムラインインテリジェンス | ✅ 完了 |
| 11 | チームワークフロー統合 | 🚧 進行中 |

---

## 🤝 コントリビューション

1. リポジトリをフォーク
2. 機能ブランチを作成（`git checkout -b feat/amazing-feature`）
3. テストを実行（`pnpm test && pnpm e2e`）
4. 説明的なメッセージでコミット
5. プッシュしてプルリクエストを作成

詳細な開発手順については [CLAUDE.md](CLAUDE.md) をご覧ください（AI アシスタント対応）。

---

## 📄 ライセンス

MIT © 2026 Eric Tao — 詳細は [LICENSE](LICENSE) をご覧ください。

---

<div align="center">

Made with ❤️ by [Eric Tao](https://github.com/sperictao)

</div>
