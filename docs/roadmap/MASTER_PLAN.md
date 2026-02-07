# MultiPublish Master Plan (OnePublish Roadmap)

This roadmap upgrades OnePublish from a .NET publish GUI into a commercial-grade, multi-language publishing product.

Guiding decision: parameter coverage is achieved via schema-driven advanced mode (expression power 100%), not by hand-building UI controls for every flag.

## North Star

- Multi-language publishing: Rust / Go / Java (expand later)
- 100% parameter expressiveness: any CLI flag/env/arg can be represented, validated, and emitted
- Commercial quality: repeatable, observable, testable, extensible, and shippable

## Principles

- Schema-driven UI for long-tail parameters
- Explicit execution plan (spec -> plan -> steps)
- Clear errors (classified, actionable)
- Local-first core; external integrations are optional
- Progressive delivery: ship vertical slices

## Phases

### Phase 0: Engineering Foundation
- Task 0001: Roadmap + task tracking + PRD/TDD template
- Task 0002: Frontend unit tests (Vitest) + first testable modules
- Task 0003: Rust unit tests + command layer testability
- Task 0004: Minimal e2e smoke test (launch, settings, language switch)

### Phase 1: Publish Core Abstraction
- Task 0101: PublishSpec data model (language-agnostic)
- Task 0102: ExecutionPlan compiler (spec -> steps)
- Task 0103: Unified logging + error taxonomy

### Phase 2: Language Providers
- Task 0201: Provider interface + manifest + loader
- Task 0202: Rust provider (cargo)
- Task 0203: Go provider
- Task 0204: Java provider

### Phase 3: 100% Parameter Expressiveness
- Task 0301: Parameter schema spec + renderer
- Task 0302: Advanced parameter editor (flags/kv/raw)
- Task 0303: Command import (optional)

### Phase 4: Commercial Features
- Task 0401: Config import/export + team sharing (no secrets in plain text)
- Task 0402: Environment probing + guided fixes
- Task 0403: Packaging + signing abstraction
- Task 0404: Updater pipeline

### Phase 5: Release Operations UX
- Task 0501: Updater config visibility + quick open
- Task 0502: Signed release checklist wizard
- Task 0503: Preflight report export (environment + artifact + updater)
