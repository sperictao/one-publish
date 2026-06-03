<div align="center">

<img src="src-tauri/icons/128x128@2x.png" alt="Icône OnePublish" width="128" height="128" />

# OnePublish

**Publication de Projets Multi-Langages, Élégamment Simplifiée.**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.x-FFC131?logo=tauri&logoColor=white)](https://tauri.app)
[![React 18](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-1.77+-DEA584?logo=rust&logoColor=white)](https://www.rust-lang.org)

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [Français](README.fr.md) · [Deutsch](README.de.md)

</div>

---

## Qu'est-ce que OnePublish ?

OnePublish est une **application de bureau multiplateforme** qui offre une interface graphique élégante et productive pour publier des projets logiciels. Au lieu de mémoriser et de saisir des commandes CLI complexes, vous sélectionnez un dépôt, configurez les paramètres via un formulaire intelligent, et publiez en un seul clic.

**Un seul outil. Plusieurs langages.** .NET · Rust (cargo) · Go · Java (Gradle) — tout depuis la même interface unifiée.

## ✨ Points Forts

- 🎯 **Support Multi-Langages** — .NET (`dotnet publish`), Rust (`cargo build --release`), Go (`go build`), Java/Gradle — et d'autres à venir
- 🧠 **Paramètres Basés sur un Schéma** — 100% d'expressivité des paramètres : chaque option CLI, variable d'environnement et argument est représenté et validé, sans être codé en dur
- 📋 **Import de Commandes** — collez n'importe quelle commande CLI et OnePublish la rétro-conçoit en paramètres structurés
- 📊 **Historique d'Exécution** — chronologie locale de vos 20+ dernières exécutions avec ré-exécution en un clic
- 🔍 **Diagnostics d'Environnement** — détection automatique des chaînes d'outils manquantes (SDK, runtimes) avec corrections guidées
- 🎨 **Design Apple Liquid Glass** — interface inspirée de macOS avec matériaux en verre flouté (backdrop-blur), animations à ressort et reflets spéculaires
- 🌐 **Internationalisé** — support complet du chinois (简体中文) et de l'anglais
- 🌓 **Thèmes Sombre & Clair** — suit les préférences de votre système
- 🔄 **Mise à Jour Automatique** — pipeline de mise à jour Tauri avec intégration GitHub Releases
- ⌨️ **Navigation au Clavier** — raccourcis globaux pour les actions fréquentes ; publiez sans toucher la souris
- 📦 **Publication GitHub en Un Clic** — `pnpm release -v 1.0.0` synchronise les versions, génère les notes de version, commit, tague, pousse et attend la CI

---

## 📸 Captures d'Écran

<!-- TODO: add actual screenshots -->
> *Captures d'écran à venir. En attendant, consultez la [philosophie de design](docs/design-philosophy.md) et le [système de design Liquid Glass](docs/liquid-glass-design-system.md).*

---

## 🚀 Démarrage Rapide

### Prérequis

| Requis | Version | Objectif |
|----------|---------|---------|
| **Node.js** | ≥ 18 | Environnement d'exécution frontend |
| **pnpm** | latest | Gestionnaire de paquets |
| **Rust** | ≥ 1.77 | Compilation du backend Tauri |
| **SDK Cible** | variable | Au moins un parmi : .NET SDK / Rust / Go / Java (Gradle) |

### macOS — Installer les Dépendances de Développement

```bash
# Xcode Command Line Tools (requis pour Tauri sur macOS)
xcode-select --install

# Node.js & pnpm
brew install node pnpm

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Linux — Installer les Dépendances de Développement

```bash
# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# Fedora
sudo dnf install webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel \
  librsvg2-devel
```

### Windows — Installer les Dépendances de Développement

```bash
# Avec Chocolatey
choco install nodejs pnpm rust
# Ou via les installateurs officiels : nodejs.org, rustup.rs
```

### Compiler & Lancer

```bash
# Cloner
git clone https://github.com/sperictao/one-publish.git
cd one-publish

# Installer les dépendances
pnpm install

# Mode développement (rechargement à chaud)
pnpm dev

# Build de production
pnpm build
# Sortie : src-tauri/target/release/bundle/
```

---

## 🏗️ Architecture

```
one-publish/
├── src/                          # Frontend React (TypeScript)
│   ├── components/
│   │   ├── ui/                   # Primitives shadcn/ui (Button, Dialog, Select...)
│   │   ├── layout/               # Layout : panneaux, poignées de redimensionnement, barre latérale
│   │   ├── publish/              # Configuration de publication : éditeurs de paramètres, import de commandes
│   │   ├── release/              # Assistant de checklist de release
│   │   └── environment/          # Interface de diagnostics d'environnement
│   ├── features/                 # Logique métier : publish, repository, provider, environment
│   ├── hooks/                    # Hooks React : useI18n, useAppState, useShortcuts...
│   ├── stores/                   # Slices d'état Zustand
│   ├── lib/                      # Utilitaires : API store, chemins, preflight, artifacts
│   ├── i18n/                     # Traductions : zh.json, en.json
│   └── index.css                 # Design tokens Liquid Glass + utilitaires
│
├── src-tauri/                    # Backend Rust (Tauri)
│   ├── src/
│   │   ├── main.rs               # Point d'entrée
│   │   ├── lib.rs                # Enregistrement des plugins + gestionnaire de commandes
│   │   ├── provider/             # Trait de fournisseur de langage + implémentations
│   │   │   └── providers/        # dotnet.rs, cargo.rs, go.rs, java_gradle.rs
│   │   ├── commands/             # Commandes IPC Tauri (publish, repository, updater)
│   │   ├── environment/          # Vérifications d'environnement par langage
│   │   ├── compiler.rs           # Compilateur Spec → ExecutionPlan
│   │   ├── spec.rs               # PublishSpec (modèle de données indépendant du langage)
│   │   ├── plan.rs               # ExecutionPlan (étapes ordonnées)
│   │   ├── parameter.rs          # ParameterSchema + validation
│   │   ├── store/                # Persistance (stockage en fichiers JSON)
│   │   ├── config_export.rs      # Import/export de configuration
│   │   ├── shortcuts.rs          # Enregistrement des raccourcis globaux
│   │   └── tray.rs               # Icône de la barre système
│   ├── Cargo.toml                # Dépendances Rust
│   └── tauri.conf.json           # Configuration de la fenêtre Tauri, bundle, mise à jour
│
├── tests/e2e/                    # Tests e2e Playwright
├── scripts/                      # Scripts d'automatisation Build/Release
├── docs/                         # Documentation
│   ├── design-philosophy.md      # Philosophie produit & ingénierie
│   ├── liquid-glass-design-system.md
│   ├── roadmap/MASTER_PLAN.md    # Feuille de route de développement (11 phases)
│   ├── updater/SETUP.md          # Guide de configuration du mise à jour
│   └── release/GITHUB_RELEASE.md # Documentation du pipeline de release
├── DESIGN.md                     # Analyse du design Apple (référence)
├── package.json
├── vite.config.ts
├── tailwind.config.cjs
└── tsconfig.json
```

---

## 🧩 Comment Ça Marche

> **PublishSpec → ExecutionPlan → Exécuter**

1. **Sélectionnez un dépôt** — Détecté automatiquement à partir des fichiers locaux (`.sln`, `Cargo.toml`, `go.mod`, `build.gradle`, etc.)
2. **Configurez les paramètres de publication** — Utilisez des préréglages, un formulaire basé sur un schéma, ou collez une commande CLI brute
3. **Vérification préalable** — Valide les chemins de sortie, l'état de l'environnement, le statut de la branche
4. **Exécutez** — Diffuse en direct `stdout`/`stderr` dans l'interface avec possibilité d'annulation
5. **Consultez** — La chronologie de l'historique stocke chaque exécution ; ré-exécutez en un clic, exportez les diagnostics, ou générez des extraits de transfert CI

---

## 🛠️ Stack Technique

| Couche | Technologie |
|-------|-----------|
| **Framework Frontend** | React 18 + TypeScript |
| **Outil de Build** | Vite 7 |
| **Styling** | Tailwind CSS 3 + shadcn/ui (Radix UI) |
| **Système de Design** | Apple Liquid Glass (backdrop-blur, physique à ressort, reflets spéculaires) |
| **Gestion d'État** | Zustand 5 |
| **Icônes** | Lucide React |
| **Notifications** | Sonner |
| **Framework Desktop** | Tauri 2.x (Rust) |
| **Persistance** | Stockage en fichiers JSON (`~/.one-publish/config.json`) |
| **Pont de Types** | `ts-rs` (génération de contrats Rust ↔ TypeScript) |
| **Tests Unitaires** | Vitest (frontend) + Rust `#[cfg(test)]` (backend) |
| **Tests E2E** | Playwright |
| **Gestionnaire de Paquets** | pnpm |

---

## 📜 Scripts Disponibles

```bash
# Développement
pnpm dev                 # Développement Tauri complet (frontend + backend)
pnpm dev:renderer        # Serveur de développement Vite uniquement (frontend)

# Build
pnpm build               # Bundle Tauri de production
pnpm build:renderer      # Build frontend uniquement

# Qualité
pnpm typecheck           # Vérification de types TypeScript + validation des contrats
pnpm test                # Tests unitaires Vitest
pnpm test:ui             # Interface Vitest
pnpm test:watch          # Mode surveillance Vitest
pnpm e2e                 # Tests e2e Playwright
pnpm e2e:ui              # Interface Playwright

# Release
pnpm release -v 0.8.0     # Pipeline de release complet
pnpm release -v 0.8.0 -d  # Simulation (aperçu uniquement)

# Utilitaires
pnpm doctor              # Exécuter react-doctor pour la santé du code
pnpm build:updater       # Générer la configuration de production du mise à jour
```

---

## 🌍 Internationalisation (i18n)

OnePublish prend en charge le **简体中文** et l'**English** par défaut. Changez de langue dans l'application via les Paramètres, ou programmatiquement :

```typescript
// L'application lit localStorage('app-language')
// Valeurs : 'zh' (par défaut) ou 'en'
```

Fichiers de traduction : `src/i18n/zh.json` | `src/i18n/en.json` (~790 clés chacun, organisés par domaine fonctionnel).

---

## 🧪 Tests

| Couche | Outil | Couverture |
|-------|------|----------|
| Tests unitaires frontend | Vitest + Testing Library | Composants, hooks, stores, lib |
| Tests unitaires backend | Rust `#[cfg(test)]` | Compilation des fournisseurs, migrations du store, génération de plans |
| E2E | Playwright (13+ specs) | Démarrage de l'application, panneau de dépôt, sélection de fournisseur, préréglages de publication, configuration personnalisée, preflight, smoke tests des contrats |
| Portes de qualité | TypeScript strict + contrats `ts-rs` | Appliquées au build et à la CI |

---

## 🗺️ Feuille de Route

OnePublish évolue d'une interface graphique de publication .NET vers un **produit de publication multi-langages de qualité commerciale**. Le [plan directeur](docs/roadmap/MASTER_PLAN.md) couvre 11 phases :

| Phase | Thème | Statut |
|-------|-------|--------|
| 0 | Fondations d'ingénierie (tests, CI) | ✅ Terminé |
| 1 | Abstraction du cœur de publication (Spec, Plan, Logging) | ✅ Terminé |
| 2 | Fournisseurs de langage (Rust/Go/Java) | ✅ Terminé |
| 3 | Expressivité des paramètres à 100% (éditeur de schéma) | ✅ Terminé |
| 4 | Fonctionnalités commerciales (import/export, vérifications d'env, signature) | ✅ Terminé |
| 5 | UX des opérations de release (assistant checklist, preflight) | ✅ Terminé |
| 6 | Pont UX multi-fournisseurs | ✅ Terminé |
| 7 | Fiabilité d'exécution & DevEx (streaming, annulation, snapshots) | ✅ Terminé |
| 8 | Intelligence d'exécution & récupération (historique, ré-exécution, regroupement d'échecs) | ✅ Terminé |
| 9 | Approfondissement des diagnostics & transfert d'équipe | ✅ Terminé |
| 10 | Signal de collaboration & intelligence de chronologie | ✅ Terminé |
| 11 | Intégration du flux de travail d'équipe | 🚧 En Cours |

---

## 🤝 Contribuer

1. Forkez le dépôt
2. Créez une branche de fonctionnalité (`git checkout -b feat/fonctionnalite-incroyable`)
3. Lancez les tests (`pnpm test && pnpm e2e`)
4. Commitez avec des messages descriptifs
5. Poussez et ouvrez une Pull Request

Consultez [CLAUDE.md](CLAUDE.md) pour des instructions de développement détaillées (adaptées aux assistants IA).

---

## 📄 Licence

MIT © 2026 Eric Tao — voir [LICENSE](LICENSE) pour plus de détails.

---

<div align="center">

Fait avec ❤️ par [Eric Tao](https://github.com/sperictao)

</div>
