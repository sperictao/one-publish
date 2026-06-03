<div align="center">

<img src="src-tauri/icons/128x128@2x.png" alt="Ícone do OnePublish" width="128" height="128" />

# OnePublish

**Publicação de Projetos Multi-Linguagem, Lindamente Simplificada.**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.x-FFC131?logo=tauri&logoColor=white)](https://tauri.app)
[![React 18](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-1.77+-DEA584?logo=rust&logoColor=white)](https://www.rust-lang.org)

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [Français](README.fr.md) · [Deutsch](README.de.md)

</div>

---

## O que é o OnePublish?

OnePublish é um **aplicativo de desktop multiplataforma** que oferece uma GUI bonita e produtiva para publicar projetos de software. Em vez de memorizar e digitar comandos CLI complexos, você seleciona um repositório, configura parâmetros através de um formulário inteligente e publica com um único clique.

**Uma ferramenta. Múltiplas linguagens.** .NET · Rust (cargo) · Go · Java (Gradle) — tudo na mesma interface unificada.

## ✨ Destaques

- 🎯 **Suporte Multi-Linguagem** — .NET (`dotnet publish`), Rust (`cargo build --release`), Go (`go build`), Java/Gradle — com mais por vir
- 🧠 **Parâmetros Baseados em Esquema** — 100% de expressividade de parâmetros: cada flag CLI, variável de ambiente e argumento é representado e validado, sem hardcode
- 📋 **Importação de Comandos** — cole qualquer comando CLI e o OnePublish faz engenharia reversa transformando-o em parâmetros estruturados
- 📊 **Histórico de Execução** — linha do tempo local das últimas mais de 20 execuções com re-execução em um clique
- 🔍 **Diagnóstico de Ambiente** — detecção automática de toolchains ausentes (SDKs, runtimes) com correções guiadas
- 🎨 **Design Apple Liquid Glass** — UI inspirada no macOS com materiais de vidro backdrop-blur, animações com física de mola e destaques especulares
- 🌐 **Internacionalizado** — suporte completo a Chinês (简体中文) e Inglês
- 🌓 **Temas Claro e Escuro** — segue a preferência do seu sistema
- 🔄 **Atualização Automática** — pipeline de atualização do Tauri com integração ao GitHub Releases
- ⌨️ **Focado em Teclado** — atalhos globais para ações frequentes; publique sem tocar no mouse
- 📦 **GitHub Release com Um Clique** — `pnpm release -v 1.0.0` sincroniza versões, gera notas de lançamento, faz commit, tag, push e aguarda o CI

---

## 📸 Capturas de Tela

<!-- TODO: adicionar capturas de tela reais -->
> *Capturas de tela em breve. Enquanto isso, confira a [filosofia de design](docs/design-philosophy.md) e o [sistema de design Liquid Glass](docs/liquid-glass-design-system.md).*

---

## 🚀 Início Rápido

### Pré-requisitos

| Necessário | Versão | Finalidade |
|----------|---------|---------|
| **Node.js** | ≥ 18 | Runtime do frontend |
| **pnpm** | mais recente | Gerenciador de pacotes |
| **Rust** | ≥ 1.77 | Compilação do backend Tauri |
| **SDK Alvo** | varia | Pelo menos um dos: .NET SDK / Rust / Go / Java (Gradle) |

### macOS — Instalar Dependências de Desenvolvimento

```bash
# Xcode Command Line Tools (necessário para Tauri no macOS)
xcode-select --install

# Node.js & pnpm
brew install node pnpm

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Linux — Instalar Dependências de Desenvolvimento

```bash
# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# Fedora
sudo dnf install webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel \
  librsvg2-devel
```

### Windows — Instalar Dependências de Desenvolvimento

```bash
# Com Chocolatey
choco install nodejs pnpm rust
# Ou pelos instaladores oficiais: nodejs.org, rustup.rs
```

### Compilar e Executar

```bash
# Clonar
git clone https://github.com/sperictao/one-publish.git
cd one-publish

# Instalar dependências
pnpm install

# Modo de desenvolvimento (hot-reload)
pnpm dev

# Compilação de produção
pnpm build
# Saída: src-tauri/target/release/bundle/
```

---

## 🏗️ Arquitetura

```
one-publish/
├── src/                          # Frontend React (TypeScript)
│   ├── components/
│   │   ├── ui/                   # Primitivos shadcn/ui (Button, Dialog, Select...)
│   │   ├── layout/               # Layout: painéis, alças de redimensionamento, barra lateral
│   │   ├── publish/              # Configuração de publicação: editores de parâmetros, importação de comandos
│   │   ├── release/              # Assistente de checklist de lançamento
│   │   └── environment/          # UI de diagnóstico de ambiente
│   ├── features/                 # Lógica de domínio: publish, repository, provider, environment
│   ├── hooks/                    # React hooks: useI18n, useAppState, useShortcuts...
│   ├── stores/                   # Slices de estado Zustand
│   ├── lib/                      # Utilitários: store API, paths, preflight, artifacts
│   ├── i18n/                     # Traduções: zh.json, en.json
│   └── index.css                 # Design tokens Liquid Glass + utilitários
│
├── src-tauri/                    # Backend Rust (Tauri)
│   ├── src/
│   │   ├── main.rs               # Ponto de entrada
│   │   ├── lib.rs                # Registro de plugins + manipulador de comandos
│   │   ├── provider/             # Trait de provedor de linguagem + implementações
│   │   │   └── providers/        # dotnet.rs, cargo.rs, go.rs, java_gradle.rs
│   │   ├── commands/             # Comandos IPC do Tauri (publish, repository, updater)
│   │   ├── environment/          # Verificações de ambiente por linguagem
│   │   ├── compiler.rs           # Compilador Spec → ExecutionPlan
│   │   ├── spec.rs               # PublishSpec (modelo de dados independente de linguagem)
│   │   ├── plan.rs               # ExecutionPlan (etapas ordenadas)
│   │   ├── parameter.rs          # ParameterSchema + validação
│   │   ├── store/                # Persistência (armazenamento em arquivo JSON)
│   │   ├── config_export.rs      # Importação/exportação de configuração
│   │   ├── shortcuts.rs          # Registro de atalhos globais
│   │   └── tray.rs               # Bandeja do sistema
│   ├── Cargo.toml                # Dependências Rust
│   └── tauri.conf.json           # Configuração de janela, bundle e atualização do Tauri
│
├── tests/e2e/                    # Testes e2e com Playwright
├── scripts/                      # Scripts de automação de build/release
├── docs/                         # Documentação
│   ├── design-philosophy.md      # Filosofia de produto e engenharia
│   ├── liquid-glass-design-system.md
│   ├── roadmap/MASTER_PLAN.md    # Roteiro de desenvolvimento (11 fases)
│   ├── updater/SETUP.md          # Guia de configuração do atualizador
│   └── release/GITHUB_RELEASE.md # Documentação do pipeline de lançamento
├── DESIGN.md                     # Análise de design da Apple (referência)
├── package.json
├── vite.config.ts
├── tailwind.config.cjs
└── tsconfig.json
```

---

## 🧩 Como Funciona

> **PublishSpec → ExecutionPlan → Executar**

1. **Selecione um repositório** — Detectado automaticamente a partir de arquivos locais (`.sln`, `Cargo.toml`, `go.mod`, `build.gradle`, etc.)
2. **Configure os parâmetros de publicação** — Use presets, um formulário baseado em esquema ou cole um comando CLI bruto
3. **Verificação preflight** — Valida caminhos de saída, prontidão do ambiente, status do branch
4. **Executar** — Transmite `stdout`/`stderr` ao vivo na UI com suporte a cancelamento
5. **Revisar** — Linha do tempo do histórico armazena cada execução; re-execute com um clique, exporte diagnósticos ou gere trechos para handoff de CI

---

## 🛠️ Tecnologias Utilizadas

| Camada | Tecnologia |
|-------|-----------|
| **Framework Frontend** | React 18 + TypeScript |
| **Ferramenta de Build** | Vite 7 |
| **Estilização** | Tailwind CSS 3 + shadcn/ui (Radix UI) |
| **Sistema de Design** | Apple Liquid Glass (backdrop-blur, física de molas, destaques especulares) |
| **Gerenciamento de Estado** | Zustand 5 |
| **Ícones** | Lucide React |
| **Notificações** | Sonner |
| **Framework Desktop** | Tauri 2.x (Rust) |
| **Persistência** | Armazenamento em arquivo JSON (`~/.one-publish/config.json`) |
| **Ponte de Tipos** | `ts-rs` (geração de contratos Rust ↔ TypeScript) |
| **Testes Unitários** | Vitest (frontend) + Rust `#[cfg(test)]` (backend) |
| **Testes E2E** | Playwright |
| **Gerenciador de Pacotes** | pnpm |

---

## 📜 Scripts Disponíveis

```bash
# Desenvolvimento
pnpm dev                 # Tauri dev completo (frontend + backend)
pnpm dev:renderer        # Apenas servidor Vite dev (frontend)

# Build
pnpm build               # Bundle Tauri de produção
pnpm build:renderer      # Apenas build do frontend

# Qualidade
pnpm typecheck           # Verificação de tipos TypeScript + validação de contratos
pnpm test                # Testes unitários Vitest
pnpm test:ui             # Vitest UI
pnpm test:watch          # Modo watch do Vitest
pnpm e2e                 # Testes e2e com Playwright
pnpm e2e:ui              # Modo UI do Playwright

# Release
pnpm release -v 0.8.0     # Pipeline completo de lançamento
pnpm release -v 0.8.0 -d  # Dry-run (apenas visualização)

# Utilitários
pnpm doctor              # Executa react-doctor para saúde do código
pnpm build:updater       # Gera configuração de produção do atualizador
```

---

## 🌍 Internacionalização (i18n)

OnePublish suporta **简体中文** e **English** pronto para uso. Alterne no aplicativo via Configurações ou programaticamente:

```typescript
// O aplicativo lê localStorage('app-language')
// Valores: 'zh' (padrão) ou 'en'
```

Arquivos de tradução: `src/i18n/zh.json` | `src/i18n/en.json` (~790 chaves cada, organizadas por domínio de funcionalidade).

---

## 🧪 Testes

| Camada | Ferramenta | Cobertura |
|-------|------|----------|
| Unitário frontend | Vitest + Testing Library | Componentes, hooks, stores, lib |
| Unitário backend | Rust `#[cfg(test)]` | Compilação de providers, migrações de store, geração de planos |
| E2E | Playwright (13+ specs) | Inicialização do app, painel de repositório, seleção de provider, presets de publicação, configuração personalizada, preflight, smoke de contratos |
| Barreiras de qualidade | TypeScript strict + contratos `ts-rs` | Aplicadas no build e CI |

---

## 🗺️ Roteiro

O OnePublish está evoluindo de uma GUI de publicação .NET para um **produto de publicação multi-linguagem de nível comercial**. O [plano mestre](docs/roadmap/MASTER_PLAN.md) abrange 11 fases:

| Fase | Tema | Status |
|-------|-------|--------|
| 0 | Fundação de engenharia (testes, CI) | ✅ Concluído |
| 1 | Abstração do núcleo de publicação (Spec, Plan, Logging) | ✅ Concluído |
| 2 | Provedores de linguagem (Rust/Go/Java) | ✅ Concluído |
| 3 | 100% de expressividade de parâmetros (editor de esquema) | ✅ Concluído |
| 4 | Funcionalidades comerciais (import/export, verificações de ambiente, assinatura) | ✅ Concluído |
| 5 | UX de operações de lançamento (assistente de checklist, preflight) | ✅ Concluído |
| 6 | Ponte UX multi-provedor | ✅ Concluído |
| 7 | Confiabilidade de execução e DevEx (streaming, cancelamento, snapshots) | ✅ Concluído |
| 8 | Inteligência de execução e recuperação (histórico, re-execução, agrupamento de falhas) | ✅ Concluído |
| 9 | Aprofundamento de diagnósticos e handoff para equipe | ✅ Concluído |
| 10 | Sinal de colaboração e inteligência de linha do tempo | ✅ Concluído |
| 11 | Integração de fluxo de trabalho em equipe | 🚧 Em Andamento |

---

## 🤝 Contribuindo

1. Faça um fork do repositório
2. Crie um branch de funcionalidade (`git checkout -b feat/recurso-incrivel`)
3. Execute os testes (`pnpm test && pnpm e2e`)
4. Faça commit com mensagens descritivas
5. Envie e abra um Pull Request

Veja [CLAUDE.md](CLAUDE.md) para instruções detalhadas de desenvolvimento (amigável para assistentes de IA).

---

## 📄 Licença

MIT © 2026 Eric Tao — veja [LICENSE](LICENSE) para detalhes.

---

<div align="center">

Feito com ❤️ por [Eric Tao](https://github.com/sperictao)

</div>
