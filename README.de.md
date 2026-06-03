<div align="center">

<img src="src-tauri/icons/128x128@2x.png" alt="OnePublish Icon" width="128" height="128" />

# OnePublish

**Multi-Language Projekt-Builds, elegant vereinfacht.**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.x-FFC131?logo=tauri&logoColor=white)](https://tauri.app)
[![React 18](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-1.77+-DEA584?logo=rust&logoColor=white)](https://www.rust-lang.org)

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [Français](README.fr.md) · [Deutsch](README.de.md)

</div>

---

## Was ist OnePublish?

OnePublish ist eine **plattformübergreifende Desktop-Anwendung**, die eine elegante, produktive Benutzeroberfläche für das Veröffentlichen von Softwareprojekten bietet. Anstatt komplexe CLI-Befehle auswendig zu lernen und einzutippen, wählst du ein Repository aus, konfigurierst die Parameter über ein intelligentes Formular und veröffentlichst mit einem einzigen Klick.

**Ein Werkzeug. Mehrere Sprachen.** .NET · Rust (cargo) · Go · Java (Gradle) — alles über dieselbe einheitliche Oberfläche.

## ✨ Highlights

- 🎯 **Multi-Language-Unterstützung** — .NET (`dotnet publish`), Rust (`cargo build --release`), Go (`go build`), Java/Gradle — mit weiteren in Planung
- 🧠 **Schema-gesteuerte Parameter** — 100 % Parameter-Ausdruckskraft: jedes CLI-Flag, jede Umgebungsvariable und jedes Argument wird repräsentiert und validiert, nicht hartcodiert
- 📋 **Befehlsimport** — füge einen beliebigen CLI-Befehl ein und OnePublish wandelt ihn in strukturierte Parameter um
- 📊 **Ausführungshistorie** — lokale Zeitleiste der letzten 20+ Läufe mit einem Klick erneut ausführen
- 🔍 **Umgebungsdiagnose** — automatische Erkennung fehlender Toolchains (SDKs, Laufzeiten) mit geführten Lösungen
- 🎨 **Apple Liquid Glass Design** — macOS-inspirierte Benutzeroberfläche mit Backdrop-Blur-Glasmaterialien, Federanimationen und Spiegelglanzlichtern
- 🌐 **Internationalisiert** — vollständige Unterstützung für Chinesisch (简体中文) und Englisch
- 🌓 **Dunkles & helles Theme** — folgt deiner Systemeinstellung
- 🔄 **Auto-Update** — Tauri-Updater-Pipeline mit GitHub-Releases-Integration
- ⌨️ **Tastaturorientiert** — globale Tastenkürzel für häufige Aktionen; Veröffentlichen ohne die Maus zu berühren
- 📦 **One-Click GitHub Release** — `pnpm release -v 1.0.0` synchronisiert Versionen, generiert Release-Notes, committet, tagged, pusht und wartet auf CI

---

## 📸 Screenshots

<!-- TODO: add actual screenshots -->
> *Screenshots folgen in Kürze. In der Zwischenzeit sieh dir die [Design-Philosophie](docs/design-philosophy.md) und das [Liquid Glass Design System](docs/liquid-glass-design-system.md) an.*

---

## 🚀 Schnellstart

### Voraussetzungen

| Erforderlich | Version | Zweck |
|----------|---------|---------|
| **Node.js** | ≥ 18 | Frontend-Laufzeit |
| **pnpm** | neueste | Paketmanager |
| **Rust** | ≥ 1.77 | Tauri-Backend-Kompilierung |
| **Ziel-SDK** | variiert | Mindestens eines von: .NET SDK / Rust / Go / Java (Gradle) |

### macOS — Dev-Abhängigkeiten installieren

```bash
# Xcode Command Line Tools (erforderlich für Tauri auf macOS)
xcode-select --install

# Node.js & pnpm
brew install node pnpm

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Linux — Dev-Abhängigkeiten installieren

```bash
# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# Fedora
sudo dnf install webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel \
  librsvg2-devel
```

### Windows — Dev-Abhängigkeiten installieren

```bash
# Mit Chocolatey
choco install nodejs pnpm rust
# Oder über die offiziellen Installer: nodejs.org, rustup.rs
```

### Bauen & Ausführen

```bash
# Klonen
git clone https://github.com/sperictao/one-publish.git
cd one-publish

# Abhängigkeiten installieren
pnpm install

# Entwicklungsmodus (Hot-Reload)
pnpm dev

# Produktions-Build
pnpm build
# Ausgabe: src-tauri/target/release/bundle/
```

---

## 🏗️ Architektur

```
one-publish/
├── src/                          # React Frontend (TypeScript)
│   ├── components/
│   │   ├── ui/                   # shadcn/ui Primitive (Button, Dialog, Select...)
│   │   ├── layout/               # Layout: Panels, Resize-Handles, Sidebar
│   │   ├── publish/              # Publish-Konfiguration: Parameter-Editoren, Befehlsimport
│   │   ├── release/              # Release-Checklist-Assistent
│   │   └── environment/          # UI für Umgebungsdiagnose
│   ├── features/                 # Domänenlogik: publish, repository, provider, environment
│   ├── hooks/                    # React Hooks: useI18n, useAppState, useShortcuts...
│   ├── stores/                   # Zustand State Slices
│   ├── lib/                      # Hilfsfunktionen: store API, paths, preflight, artifacts
│   ├── i18n/                     # Übersetzungen: zh.json, en.json
│   └── index.css                 # Liquid Glass Design Tokens + Utilities
│
├── src-tauri/                    # Rust Backend (Tauri)
│   ├── src/
│   │   ├── main.rs               # Einstiegspunkt
│   │   ├── lib.rs                # Plugin-Registrierung + Command-Handler
│   │   ├── provider/             # Language-Provider-Trait + Implementierungen
│   │   │   └── providers/        # dotnet.rs, cargo.rs, go.rs, java_gradle.rs
│   │   ├── commands/             # Tauri IPC Commands (publish, repository, updater)
│   │   ├── environment/          # Umgebungsprüfungen pro Sprache
│   │   ├── compiler.rs           # Spec → ExecutionPlan Compiler
│   │   ├── spec.rs               # PublishSpec (sprachunabhängiges Datenmodell)
│   │   ├── plan.rs               # ExecutionPlan (geordnete Schritte)
│   │   ├── parameter.rs          # ParameterSchema + Validierung
│   │   ├── store/                # Persistenz (JSON-Dateispeicher)
│   │   ├── config_export.rs      # Konfigurations-Import/Export
│   │   ├── shortcuts.rs          # Globale Hotkey-Registrierung
│   │   └── tray.rs               # System-Tray
│   ├── Cargo.toml                # Rust-Abhängigkeiten
│   └── tauri.conf.json           # Tauri-Fenster-, Bundle-, Updater-Konfiguration
│
├── tests/e2e/                    # Playwright E2E-Tests
├── scripts/                      # Build/Release-Automatisierungsskripte
├── docs/                         # Dokumentation
│   ├── design-philosophy.md      # Produkt- & Engineering-Philosophie
│   ├── liquid-glass-design-system.md
│   ├── roadmap/MASTER_PLAN.md    # Entwicklungs-Roadmap (11 Phasen)
│   ├── updater/SETUP.md          # Updater-Konfigurationsanleitung
│   └── release/GITHUB_RELEASE.md # Release-Pipeline-Dokumentation
├── DESIGN.md                     # Apple Design-Analyse (Referenz)
├── package.json
├── vite.config.ts
├── tailwind.config.cjs
└── tsconfig.json
```

---

## 🧩 Funktionsweise

> **PublishSpec → ExecutionPlan → Ausführen**

1. **Repository auswählen** — Automatisch aus lokalen Dateien erkannt (`.sln`, `Cargo.toml`, `go.mod`, `build.gradle` etc.)
2. **Publish-Parameter konfigurieren** — Verwende Voreinstellungen, ein schema-gesteuertes Formular oder füge einen rohen CLI-Befehl ein
3. **Preflight-Prüfung** — Validiert Ausgabepfade, Umgebungsbereitschaft, Branch-Status
4. **Ausführen** — Streamt `stdout`/`stderr` live in die Benutzeroberfläche mit Abbruch-Unterstützung
5. **Überprüfen** — Die Verlaufschronik speichert jeden Lauf; mit einem Klick erneut ausführen, Diagnosen exportieren oder CI-Übergabe-Snippets generieren

---

## 🛠️ Technologie-Stack

| Ebene | Technologie |
|-------|-----------|
| **Frontend-Framework** | React 18 + TypeScript |
| **Build-Tool** | Vite 7 |
| **Styling** | Tailwind CSS 3 + shadcn/ui (Radix UI) |
| **Design System** | Apple Liquid Glass (Backdrop-Blur, Federphysik, Spiegelglanzlichter) |
| **State Management** | Zustand 5 |
| **Icons** | Lucide React |
| **Benachrichtigungen** | Sonner |
| **Desktop-Framework** | Tauri 2.x (Rust) |
| **Persistenz** | JSON-Dateispeicher (`~/.one-publish/config.json`) |
| **Typ-Bridging** | `ts-rs` (Rust ↔ TypeScript Vertragsgenerierung) |
| **Unit-Tests** | Vitest (Frontend) + Rust `#[cfg(test)]` (Backend) |
| **E2E-Tests** | Playwright |
| **Paketmanager** | pnpm |

---

## 📜 Verfügbare Skripte

```bash
# Entwicklung
pnpm dev                 # Vollständiger Tauri-Dev-Modus (Frontend + Backend)
pnpm dev:renderer        # Nur Vite Dev Server (Frontend)

# Build
pnpm build               # Produktions-Tauri-Bundle
pnpm build:renderer      # Nur Frontend-Build

# Qualität
pnpm typecheck           # TypeScript-Typprüfung + Vertragsvalidierung
pnpm test                # Vitest Unit-Tests
pnpm test:ui             # Vitest UI
pnpm test:watch          # Vitest Watch-Modus
pnpm e2e                 # Playwright E2E-Tests
pnpm e2e:ui              # Playwright UI-Modus

# Release
pnpm release -v 0.8.0     # Vollständige Release-Pipeline
pnpm release -v 0.8.0 -d  # Dry-Run (nur Vorschau)

# Hilfsprogramme
pnpm doctor              # react-doctor für Code-Gesundheit ausführen
pnpm build:updater       # Updater-Produktionskonfiguration generieren
```

---

## 🌍 Internationalisierung (i18n)

OnePublish unterstützt **简体中文** und **Englisch** standardmäßig. Wechsle in der App über die Einstellungen oder programmatisch:

```typescript
// Die App liest localStorage('app-language')
// Werte: 'zh' (Standard) oder 'en'
```

Übersetzungsdateien: `src/i18n/zh.json` | `src/i18n/en.json` (~790 Schlüssel jeweils, nach Feature-Domäne organisiert).

---

## 🧪 Tests

| Ebene | Werkzeug | Abdeckung |
|-------|------|----------|
| Frontend Unit | Vitest + Testing Library | Komponenten, Hooks, Stores, lib |
| Backend Unit | Rust `#[cfg(test)]` | Provider-Kompilierung, Store-Migrationen, Plan-Generierung |
| E2E | Playwright (13+ Specs) | App-Start, Repository-Panel, Provider-Auswahl, Publish-Voreinstellungen, benutzerdefinierte Konfiguration, Preflight, Vertrags-Smoke-Tests |
| Qualitäts-Gates | TypeScript strict + `ts-rs`-Verträge | Erzwungen bei Build & CI |

---

## 🗺️ Roadmap

OnePublish entwickelt sich von einer .NET-Publish-GUI zu einem **kommerziellen, mehrsprachigen Publishing-Produkt**. Der [Master-Plan](docs/roadmap/MASTER_PLAN.md) umfasst 11 Phasen:

| Phase | Thema | Status |
|-------|-------|--------|
| 0 | Engineering-Grundlagen (Tests, CI) | ✅ Erledigt |
| 1 | Publish-Kernabstraktion (Spec, Plan, Logging) | ✅ Erledigt |
| 2 | Sprach-Provider (Rust/Go/Java) | ✅ Erledigt |
| 3 | 100 % Parameter-Ausdruckskraft (Schema-Editor) | ✅ Erledigt |
| 4 | Kommerzielle Features (Import/Export, Umgebungsprüfungen, Signierung) | ✅ Erledigt |
| 5 | Release-Operations-UX (Checklist-Assistent, Preflight) | ✅ Erledigt |
| 6 | Multi-Provider-UX-Brücke | ✅ Erledigt |
| 7 | Ausführungszuverlässigkeit & DevEx (Streaming, Abbruch, Snapshots) | ✅ Erledigt |
| 8 | Lauf-Intelligenz & Wiederherstellung (Historie, erneutes Ausführen, Fehlergruppierung) | ✅ Erledigt |
| 9 | Vertiefte Diagnose & Team-Übergabe | ✅ Erledigt |
| 10 | Kollaborationssignale & Zeitleisten-Intelligenz | ✅ Erledigt |
| 11 | Team-Workflow-Integration | 🚧 In Arbeit |

---

## 🤝 Mitwirken

1. Forke das Repository
2. Erstelle einen Feature-Branch (`git checkout -b feat/amazing-feature`)
3. Führe die Tests aus (`pnpm test && pnpm e2e`)
4. Committe mit aussagekräftigen Nachrichten
5. Pushe und öffne einen Pull Request

Siehe [CLAUDE.md](CLAUDE.md) für detaillierte Entwicklungshinweise (KI-Assistent-freundlich).

---

## 📄 Lizenz

MIT © 2026 Eric Tao — siehe [LICENSE](LICENSE) für Details.

---

<div align="center">

Mit ❤️ gemacht von [Eric Tao](https://github.com/sperictao)

</div>
