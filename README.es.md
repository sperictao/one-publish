<div align="center">

<img src="src-tauri/icons/128x128@2x.png" alt="Icono de OnePublish" width="128" height="128" />

# OnePublish

**Publicación de Proyectos Multi-Lenguaje, Bellamente Simplificada.**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.x-FFC131?logo=tauri&logoColor=white)](https://tauri.app)
[![React 18](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-1.77+-DEA584?logo=rust&logoColor=white)](https://www.rust-lang.org)

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [Français](README.fr.md) · [Deutsch](README.de.md)

</div>

---

## ¿Qué es OnePublish?

OnePublish es una **aplicación de escritorio multiplataforma** que te ofrece una interfaz gráfica hermosa y productiva para publicar proyectos de software. En lugar de recordar y escribir comandos CLI complejos, seleccionas un repositorio, configuras los parámetros a través de un formulario inteligente y publicas con un solo clic.

**Una herramienta. Múltiples lenguajes.** .NET · Rust (cargo) · Go · Java (Gradle) — todo desde la misma interfaz unificada.

## ✨ Destacados

- 🎯 **Soporte Multi-Lenguaje** — .NET (`dotnet publish`), Rust (`cargo build --release`), Go (`go build`), Java/Gradle — con más por venir
- 🧠 **Parámetros Basados en Esquema** — 100% de expresividad de parámetros: cada flag CLI, variable de entorno y argumento está representado y validado, no hardcodeado
- 📋 **Importación de Comandos** — pega cualquier comando CLI y OnePublish lo aplica ingeniería inversa en parámetros estructurados
- 📊 **Historial de Ejecución** — línea de tiempo local de tus últimas 20+ ejecuciones con re-ejecución en un clic
- 🔍 **Diagnóstico de Entorno** — detección automática de toolchains faltantes (SDKs, runtimes) con soluciones guiadas
- 🎨 **Diseño Apple Liquid Glass** — interfaz inspirada en macOS con materiales de vidrio backdrop-blur, animaciones elásticas y reflejos especulares
- 🌐 **Internacionalizado** — soporte completo para chino (简体中文) e inglés
- 🌓 **Temas Claro y Oscuro** — sigue la preferencia de tu sistema
- 🔄 **Actualización Automática** — pipeline del actualizador de Tauri con integración de GitHub Releases
- ⌨️ **Prioridad al Teclado** — atajos globales para acciones frecuentes; publica sin tocar el ratón
- 📦 **GitHub Release en Un Clic** — `pnpm release -v 1.0.0` sincroniza versiones, genera notas de lanzamiento, confirma, etiqueta, empuja y espera por CI

---

## 📸 Capturas de Pantalla

<!-- TODO: agregar capturas de pantalla reales -->
> *Capturas de pantalla próximamente. Mientras tanto, consulta la [filosofía de diseño](docs/design-philosophy.md) y el [sistema de diseño Liquid Glass](docs/liquid-glass-design-system.md).*

---

## 🚀 Inicio Rápido

### Prerrequisitos

| Requerido | Versión | Propósito |
|-----------|---------|-----------|
| **Node.js** | ≥ 18 | Tiempo de ejecución del frontend |
| **pnpm** | más reciente | Gestor de paquetes |
| **Rust** | ≥ 1.77 | Compilación del backend Tauri |
| **SDK Objetivo** | varía | Al menos uno de: .NET SDK / Rust / Go / Java (Gradle) |

### macOS — Instalar Dependencias de Desarrollo

```bash
# Herramientas de Línea de Comandos de Xcode (requerido para Tauri en macOS)
xcode-select --install

# Node.js y pnpm
brew install node pnpm

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Linux — Instalar Dependencias de Desarrollo

```bash
# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# Fedora
sudo dnf install webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel \
  librsvg2-devel
```

### Windows — Instalar Dependencias de Desarrollo

```bash
# Con Chocolatey
choco install nodejs pnpm rust
# O mediante instaladores oficiales: nodejs.org, rustup.rs
```

### Compilar y Ejecutar

```bash
# Clonar
git clone https://github.com/sperictao/one-publish.git
cd one-publish

# Instalar dependencias
pnpm install

# Modo desarrollo (recarga en caliente)
pnpm dev

# Compilación de producción
pnpm build
# Salida: src-tauri/target/release/bundle/
```

---

## 🏗️ Arquitectura

```
one-publish/
├── src/                          # Frontend React (TypeScript)
│   ├── components/
│   │   ├── ui/                   # Primitivas shadcn/ui (Button, Dialog, Select...)
│   │   ├── layout/               # Diseño: paneles, manejadores de redimensión, barra lateral
│   │   ├── publish/              # Configuración de publicación: editores de parámetros, importación de comandos
│   │   ├── release/              # Asistente de lista de verificación de lanzamiento
│   │   └── environment/          # Interfaz de diagnóstico de entorno
│   ├── features/                 # Lógica de dominio: publish, repository, provider, environment
│   ├── hooks/                    # Hooks de React: useI18n, useAppState, useShortcuts...
│   ├── stores/                   # Slices de estado Zustand
│   ├── lib/                      # Utilidades: API de almacenamiento, rutas, preflight, artefactos
│   ├── i18n/                     # Traducciones: zh.json, en.json
│   └── index.css                 # Tokens de diseño Liquid Glass + utilidades
│
├── src-tauri/                    # Backend Rust (Tauri)
│   ├── src/
│   │   ├── main.rs               # Punto de entrada
│   │   ├── lib.rs                # Registro de plugins + manejador de comandos
│   │   ├── provider/             # Trait de proveedor de lenguaje + implementaciones
│   │   │   └── providers/        # dotnet.rs, cargo.rs, go.rs, java_gradle.rs
│   │   ├── commands/             # Comandos IPC de Tauri (publish, repository, updater)
│   │   ├── environment/          # Verificaciones de entorno por lenguaje
│   │   ├── compiler.rs           # Compilador Spec → ExecutionPlan
│   │   ├── spec.rs               # PublishSpec (modelo de datos agnóstico al lenguaje)
│   │   ├── plan.rs               # ExecutionPlan (pasos ordenados)
│   │   ├── parameter.rs          # ParameterSchema + validación
│   │   ├── store/                # Persistencia (almacenamiento en archivos JSON)
│   │   ├── config_export.rs      # Importación/exportación de configuración
│   │   ├── shortcuts.rs          # Registro de atajos de teclado globales
│   │   └── tray.rs               # Bandeja del sistema
│   ├── Cargo.toml                # Dependencias de Rust
│   └── tauri.conf.json           # Configuración de ventana, empaquetado y actualizador de Tauri
│
├── tests/e2e/                    # Pruebas e2e con Playwright
├── scripts/                      # Scripts de automatización de compilación/lanzamiento
├── docs/                         # Documentación
│   ├── design-philosophy.md      # Filosofía de producto e ingeniería
│   ├── liquid-glass-design-system.md
│   ├── roadmap/MASTER_PLAN.md    # Hoja de ruta de desarrollo (11 fases)
│   ├── updater/SETUP.md          # Guía de configuración del actualizador
│   └── release/GITHUB_RELEASE.md # Documentación del pipeline de lanzamiento
├── DESIGN.md                     # Análisis de diseño de Apple (referencia)
├── package.json
├── vite.config.ts
├── tailwind.config.cjs
└── tsconfig.json
```

---

## 🧩 Cómo Funciona

> **PublishSpec → ExecutionPlan → Execute**

1. **Selecciona un repositorio** — Detectado automáticamente desde archivos locales (`.sln`, `Cargo.toml`, `go.mod`, `build.gradle`, etc.)
2. **Configura los parámetros de publicación** — Usa preajustes, un formulario basado en esquema, o pega un comando CLI sin procesar
3. **Verificación previa** — Valida rutas de salida, preparación del entorno, estado de la rama
4. **Ejecutar** — Transmite `stdout`/`stderr` en vivo en la interfaz con soporte para cancelación
5. **Revisar** — La línea de tiempo del historial almacena cada ejecución; re-ejecuta con un clic, exporta diagnósticos o genera fragmentos para CI

---

## 🛠️ Stack Tecnológico

| Capa | Tecnología |
|------|------------|
| **Framework Frontend** | React 18 + TypeScript |
| **Herramienta de Compilación** | Vite 7 |
| **Estilos** | Tailwind CSS 3 + shadcn/ui (Radix UI) |
| **Sistema de Diseño** | Apple Liquid Glass (backdrop-blur, física elástica, reflejos especulares) |
| **Gestión de Estado** | Zustand 5 |
| **Iconos** | Lucide React |
| **Notificaciones** | Sonner |
| **Framework de Escritorio** | Tauri 2.x (Rust) |
| **Persistencia** | Almacenamiento en archivos JSON (`~/.one-publish/config.json`) |
| **Puenteo de Tipos** | `ts-rs` (generación de contratos Rust ↔ TypeScript) |
| **Pruebas Unitarias** | Vitest (frontend) + Rust `#[cfg(test)]` (backend) |
| **Pruebas E2E** | Playwright |
| **Gestor de Paquetes** | pnpm |

---

## 📜 Scripts Disponibles

```bash
# Desarrollo
pnpm dev                 # Desarrollo completo con Tauri (frontend + backend)
pnpm dev:renderer        # Solo servidor de desarrollo Vite (frontend)

# Compilación
pnpm build               # Paquete de producción Tauri
pnpm build:renderer      # Solo compilación del frontend

# Calidad
pnpm typecheck           # Verificación de tipos TypeScript + validación de contratos
pnpm test                # Pruebas unitarias con Vitest
pnpm test:ui             # Interfaz de Vitest
pnpm test:watch          # Modo vigilancia de Vitest
pnpm e2e                 # Pruebas e2e con Playwright
pnpm e2e:ui              # Modo interfaz de Playwright

# Lanzamiento
pnpm release -v 0.8.0     # Pipeline completo de lanzamiento
pnpm release -v 0.8.0 -d  # Simulación (solo vista previa)

# Utilidades
pnpm doctor              # Ejecutar react-doctor para salud del código
pnpm build:updater       # Generar configuración de producción del actualizador
```

---

## 🌍 Internacionalización (i18n)

OnePublish soporta **简体中文** e **English** desde el primer momento. Cambia dentro de la aplicación a través de Configuración, o programáticamente:

```typescript
// La aplicación lee localStorage('app-language')
// Valores: 'zh' (predeterminado) o 'en'
```

Archivos de traducción: `src/i18n/zh.json` | `src/i18n/en.json` (~790 claves cada uno, organizados por dominio de funcionalidad).

---

## 🧪 Pruebas

| Capa | Herramienta | Cobertura |
|------|-------------|-----------|
| Pruebas unitarias frontend | Vitest + Testing Library | Componentes, hooks, stores, lib |
| Pruebas unitarias backend | Rust `#[cfg(test)]` | Compilación de providers, migraciones de store, generación de planes |
| E2E | Playwright (13+ especificaciones) | Inicio de app, panel de repositorio, selección de provider, preajustes de publicación, configuración personalizada, verificación previa, pruebas de contratos |
| Puertas de calidad | TypeScript estricto + contratos `ts-rs` | Aplicado en compilación y CI |

---

## 🗺️ Hoja de Ruta

OnePublish está evolucionando de una GUI de publicación .NET a un **producto de publicación multi-lenguaje de grado comercial**. El [plan maestro](docs/roadmap/MASTER_PLAN.md) abarca 11 fases:

| Fase | Tema | Estado |
|------|------|--------|
| 0 | Fundación de ingeniería (pruebas, CI) | ✅ Completado |
| 1 | Abstracción del núcleo de publicación (Spec, Plan, Logging) | ✅ Completado |
| 2 | Proveedores de lenguaje (Rust/Go/Java) | ✅ Completado |
| 3 | 100% de expresividad de parámetros (editor de esquemas) | ✅ Completado |
| 4 | Funcionalidades comerciales (import/export, verificaciones de entorno, firma) | ✅ Completado |
| 5 | UX de operaciones de lanzamiento (asistente de lista de verificación, verificación previa) | ✅ Completado |
| 6 | Puente UX multi-proveedor | ✅ Completado |
| 7 | Confiabilidad de ejecución y DevEx (transmisión, cancelación, instantáneas) | ✅ Completado |
| 8 | Inteligencia de ejecución y recuperación (historial, re-ejecución, agrupación de fallos) | ✅ Completado |
| 9 | Profundización de diagnósticos y transferencia al equipo | ✅ Completado |
| 10 | Señal de colaboración e inteligencia de línea de tiempo | ✅ Completado |
| 11 | Integración de flujo de trabajo en equipo | 🚧 En Progreso |

---

## 🤝 Contribuir

1. Haz un fork del repositorio
2. Crea una rama de funcionalidad (`git checkout -b feat/funcionalidad-increible`)
3. Ejecuta las pruebas (`pnpm test && pnpm e2e`)
4. Haz commit con mensajes descriptivos
5. Empuja y abre un Pull Request

Consulta [CLAUDE.md](CLAUDE.md) para instrucciones detalladas de desarrollo (apto para asistentes de IA).

---

## 📄 Licencia

MIT © 2026 Eric Tao — consulta [LICENSE](LICENSE) para más detalles.

---

<div align="center">

Hecho con ❤️ por [Eric Tao](https://github.com/sperictao)

</div>
