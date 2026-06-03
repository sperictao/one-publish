<div align="center">

<img src="src-tauri/icons/128x128@2x.png" alt="OnePublish 아이콘" width="128" height="128" />

# OnePublish

**멀티 언어 프로젝트 배포, 아름답고 간편하게.**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.x-FFC131?logo=tauri&logoColor=white)](https://tauri.app)
[![React 18](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-1.77+-DEA584?logo=rust&logoColor=white)](https://www.rust-lang.org)

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [Français](README.fr.md) · [Deutsch](README.de.md)

</div>

---

## OnePublish란?

OnePublish는 소프트웨어 프로젝트를 배포하기 위한 아름답고 생산적인 GUI를 제공하는 **크로스 플랫폼 데스크톱 애플리케이션**입니다. 복잡한 CLI 명령어를 외우거나 입력할 필요 없이, 저장소를 선택하고 지능형 폼을 통해 매개변수를 구성한 다음 클릭 한 번으로 배포할 수 있습니다.

**하나의 도구. 다양한 언어.** .NET · Rust (cargo) · Go · Java (Gradle) — 모두 하나의 통합된 인터페이스에서 사용 가능합니다.

## ✨ 주요 특징

- 🎯 **멀티 언어 지원** — .NET (`dotnet publish`), Rust (`cargo build --release`), Go (`go build`), Java/Gradle — 더 많은 언어 지원 예정
- 🧠 **스키마 기반 매개변수** — 100% 매개변수 표현력: 모든 CLI 플래그, 환경 변수, 인수가 표현되고 검증되며, 하드코딩되지 않음
- 📋 **명령어 가져오기** — CLI 명령어를 붙여넣으면 OnePublish가 이를 구조화된 매개변수로 역공학(reverse-engineer)합니다
- 📊 **실행 이력** — 최근 20회 이상의 실행을 로컬 타임라인으로 확인하고 한 번의 클릭으로 재실행
- 🔍 **환경 진단** — 누락된 툴체인(SDK, 런타임)을 자동 감지하고 해결 방법 안내
- 🎨 **Apple Liquid Glass 디자인** — macOS에서 영감을 받은 배경 블러 글래스 머티리얼, 스프링 애니메이션, 스펙큘러 하이라이트를 적용한 UI
- 🌐 **국제화** — 중국어(简体中文) 및 영어 완벽 지원
- 🌓 **다크 & 라이트 테마** — 시스템 환경 설정을 자동으로 따름
- 🔄 **자동 업데이트** — GitHub Releases와 통합된 Tauri 업데이터 파이프라인
- ⌨️ **키보드 우선** — 자주 사용하는 동작에 전역 단축키 제공; 마우스 없이도 배포 가능
- 📦 **원클릭 GitHub 릴리스** — `pnpm release -v 1.0.0`으로 버전 동기화, 릴리스 노트 생성, 커밋, 태그, 푸시, CI 대기까지 자동화

---

## 📸 스크린샷

<!-- TODO: add actual screenshots -->
> *곧 스크린샷이 추가됩니다. 그동안 [디자인 철학](docs/design-philosophy.md)과 [Liquid Glass 디자인 시스템](docs/liquid-glass-design-system.md)을 확인해 보세요.*

---

## 🚀 빠른 시작

### 사전 요구 사항

| 필수 항목 | 버전 | 용도 |
|----------|---------|---------|
| **Node.js** | ≥ 18 | 프론트엔드 런타임 |
| **pnpm** | 최신 | 패키지 매니저 |
| **Rust** | ≥ 1.77 | Tauri 백엔드 컴파일 |
| **대상 SDK** | 다양함 | .NET SDK / Rust / Go / Java (Gradle) 중 최소 하나 |

### macOS — 개발 의존성 설치

```bash
# Xcode Command Line Tools (macOS에서 Tauri 사용 시 필수)
xcode-select --install

# Node.js & pnpm
brew install node pnpm

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### Linux — 개발 의존성 설치

```bash
# Ubuntu/Debian
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# Fedora
sudo dnf install webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel \
  librsvg2-devel
```

### Windows — 개발 의존성 설치

```bash
# Chocolatey 사용 시
choco install nodejs pnpm rust
# 또는 공식 설치 프로그램 사용: nodejs.org, rustup.rs
```

### 빌드 및 실행

```bash
# 클론
git clone https://github.com/sperictao/one-publish.git
cd one-publish

# 의존성 설치
pnpm install

# 개발 모드 (핫 리로드)
pnpm dev

# 프로덕션 빌드
pnpm build
# 결과물: src-tauri/target/release/bundle/
```

---

## 🏗️ 아키텍처

```
one-publish/
├── src/                          # React 프론트엔드 (TypeScript)
│   ├── components/
│   │   ├── ui/                   # shadcn/ui 프리미티브 (Button, Dialog, Select...)
│   │   ├── layout/               # 레이아웃: 패널, 리사이즈 핸들, 사이드바
│   │   ├── publish/              # 배포 설정: 매개변수 편집기, 명령어 가져오기
│   │   ├── release/              # 릴리스 체크리스트 마법사
│   │   └── environment/          # 환경 진단 UI
│   ├── features/                 # 도메인 로직: publish, repository, provider, environment
│   ├── hooks/                    # React 훅: useI18n, useAppState, useShortcuts...
│   ├── stores/                   # Zustand 상태 슬라이스
│   ├── lib/                      # 유틸리티: store API, paths, preflight, artifacts
│   ├── i18n/                     # 번역: zh.json, en.json
│   └── index.css                 # Liquid Glass 디자인 토큰 + 유틸리티
│
├── src-tauri/                    # Rust 백엔드 (Tauri)
│   ├── src/
│   │   ├── main.rs               # 진입점
│   │   ├── lib.rs                # 플러그인 등록 + 명령 핸들러
│   │   ├── provider/             # 언어 프로바이더 트레이트 + 구현체
│   │   │   └── providers/        # dotnet.rs, cargo.rs, go.rs, java_gradle.rs
│   │   ├── commands/             # Tauri IPC 명령 (publish, repository, updater)
│   │   ├── environment/          # 언어별 환경 검사
│   │   ├── compiler.rs           # Spec → ExecutionPlan 컴파일러
│   │   ├── spec.rs               # PublishSpec (언어 독립적 데이터 모델)
│   │   ├── plan.rs               # ExecutionPlan (순서가 지정된 단계)
│   │   ├── parameter.rs          # ParameterSchema + 유효성 검증
│   │   ├── store/                # 영속성 (JSON 파일 저장소)
│   │   ├── config_export.rs      # 설정 가져오기/내보내기
│   │   ├── shortcuts.rs          # 전역 단축키 등록
│   │   └── tray.rs               # 시스템 트레이
│   ├── Cargo.toml                # Rust 의존성
│   └── tauri.conf.json           # Tauri 윈도우, 번들, 업데이터 설정
│
├── tests/e2e/                    # Playwright e2e 테스트
├── scripts/                      # 빌드/릴리스 자동화 스크립트
├── docs/                         # 문서
│   ├── design-philosophy.md      # 제품 및 엔지니어링 철학
│   ├── liquid-glass-design-system.md
│   ├── roadmap/MASTER_PLAN.md    # 개발 로드맵 (11단계)
│   ├── updater/SETUP.md          # 업데이터 설정 가이드
│   └── release/GITHUB_RELEASE.md # 릴리스 파이프라인 문서
├── DESIGN.md                     # Apple 디자인 분석 (참고용)
├── package.json
├── vite.config.ts
├── tailwind.config.cjs
└── tsconfig.json
```

---

## 🧩 작동 방식

> **PublishSpec → ExecutionPlan → Execute**

1. **저장소 선택** — 로컬 파일(`.sln`, `Cargo.toml`, `go.mod`, `build.gradle` 등)에서 자동 감지
2. **배포 매개변수 구성** — 프리셋 사용, 스키마 기반 폼, 또는 원시 CLI 명령어 붙여넣기
3. **사전 점검** — 출력 경로, 환경 준비 상태, 브랜치 상태 검증
4. **실행** — 실시간 `stdout`/`stderr`을 UI로 스트리밍하며 취소 지원
5. **리뷰** — 이력 타임라인에 모든 실행 저장; 한 번의 클릭으로 재실행, 진단 정보 내보내기, 또는 CI 핸드오프 스니펫 생성

---

## 🛠️ 기술 스택

| 계층 | 기술 |
|-------|-----------|
| **프론트엔드 프레임워크** | React 18 + TypeScript |
| **빌드 도구** | Vite 7 |
| **스타일링** | Tailwind CSS 3 + shadcn/ui (Radix UI) |
| **디자인 시스템** | Apple Liquid Glass (backdrop-blur, spring physics, specular highlights) |
| **상태 관리** | Zustand 5 |
| **아이콘** | Lucide React |
| **알림** | Sonner |
| **데스크톱 프레임워크** | Tauri 2.x (Rust) |
| **영속성** | JSON 파일 저장소 (`~/.one-publish/config.json`) |
| **타입 브리징** | `ts-rs` (Rust ↔ TypeScript 계약 생성) |
| **유닛 테스트** | Vitest (프론트엔드) + Rust `#[cfg(test)]` (백엔드) |
| **E2E 테스트** | Playwright |
| **패키지 매니저** | pnpm |

---

## 📜 사용 가능한 스크립트

```bash
# 개발
pnpm dev                 # 전체 Tauri 개발 (프론트엔드 + 백엔드)
pnpm dev:renderer        # Vite 개발 서버만 (프론트엔드)

# 빌드
pnpm build               # 프로덕션 Tauri 번들
pnpm build:renderer      # 프론트엔드 빌드만

# 품질
pnpm typecheck           # TypeScript 타입 검사 + 계약 검증
pnpm test                # Vitest 유닛 테스트
pnpm test:ui             # Vitest UI
pnpm test:watch          # Vitest 감시 모드
pnpm e2e                 # Playwright e2e 테스트
pnpm e2e:ui              # Playwright UI 모드

# 릴리스
pnpm release -v 0.8.0     # 전체 릴리스 파이프라인
pnpm release -v 0.8.0 -d  # 드라이 런 (미리보기 전용)

# 유틸리티
pnpm doctor              # react-doctor 실행으로 코드 상태 점검
pnpm build:updater       # 업데이터 프로덕션 설정 생성
```

---

## 🌍 국제화 (i18n)

OnePublish는 **简体中文** 및 **English**를 기본 지원합니다. 설정에서 앱 내 전환하거나 프로그래밍 방식으로 전환할 수 있습니다:

```typescript
// 앱은 localStorage('app-language')를 읽습니다
// 값: 'zh' (기본값) 또는 'en'
```

번역 파일: `src/i18n/zh.json` | `src/i18n/en.json` (각 약 790개 키, 기능 도메인별로 구성).

---

## 🧪 테스트

| 계층 | 도구 | 커버리지 |
|-------|------|----------|
| 프론트엔드 유닛 | Vitest + Testing Library | 컴포넌트, 훅, 스토어, 라이브러리 |
| 백엔드 유닛 | Rust `#[cfg(test)]` | 프로바이더 컴파일, 스토어 마이그레이션, 플랜 생성 |
| E2E | Playwright (13+ 스펙) | 앱 부팅, 저장소 패널, 프로바이더 선택, 배포 프리셋, 사용자 정의 설정, 사전 점검, 계약 스모크 |
| 품질 게이트 | TypeScript strict + `ts-rs` 계약 | 빌드 및 CI에서 강제 적용 |

---

## 🗺️ 로드맵

OnePublish는 .NET 배포 GUI에서 출발하여 **상업용 등급의 멀티 언어 배포 제품**으로 진화하고 있습니다. [마스터 플랜](docs/roadmap/MASTER_PLAN.md)은 11단계로 구성됩니다:

| 단계 | 주제 | 상태 |
|-------|-------|--------|
| 0 | 엔지니어링 기반 (테스트, CI) | ✅ 완료 |
| 1 | 배포 코어 추상화 (Spec, Plan, Logging) | ✅ 완료 |
| 2 | 언어 프로바이더 (Rust/Go/Java) | ✅ 완료 |
| 3 | 100% 매개변수 표현력 (스키마 편집기) | ✅ 완료 |
| 4 | 상업용 기능 (가져오기/내보내기, 환경 검사, 서명) | ✅ 완료 |
| 5 | 릴리스 운영 UX (체크리스트 마법사, 사전 점검) | ✅ 완료 |
| 6 | 멀티 프로바이더 UX 브리지 | ✅ 완료 |
| 7 | 실행 안정성 및 개발자 경험 (스트리밍, 취소, 스냅샷) | ✅ 완료 |
| 8 | 실행 인텔리전스 및 복구 (이력, 재실행, 실패 그룹화) | ✅ 완료 |
| 9 | 진단 심화 및 팀 핸드오프 | ✅ 완료 |
| 10 | 협업 시그널 및 타임라인 인텔리전스 | ✅ 완료 |
| 11 | 팀 워크플로우 통합 | 🚧 진행 중 |

---

## 🤝 기여하기

1. 저장소를 포크합니다
2. 기능 브랜치를 생성합니다 (`git checkout -b feat/amazing-feature`)
3. 테스트를 실행합니다 (`pnpm test && pnpm e2e`)
4. 설명적인 커밋 메시지로 커밋합니다
5. 푸시하고 Pull Request를 엽니다

자세한 개발 지침은 [CLAUDE.md](CLAUDE.md)를 참조하세요 (AI 어시스턴트 친화적).

---

## 📄 라이선스

MIT © 2026 Eric Tao — 자세한 내용은 [LICENSE](LICENSE)를 참조하세요.

---

<div align="center">

Made with ❤️ by [Eric Tao](https://github.com/sperictao)

</div>
