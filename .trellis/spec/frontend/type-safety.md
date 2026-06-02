# Frontend Type Safety

## Generated Contracts

Use `src/generated/tauri-contracts.ts` for payloads that cross the Tauri boundary. This file is generated from Rust and must not be edited manually.

Examples:

- `src/lib/store/api.ts`
- `src/features/publish/publishRuntime.ts`

## Frontend Store Types

Frontend-friendly store types and normalization live in `src/lib/store/types.ts`.

Use normalization helpers when Rust field names or shapes differ from frontend conventions. Do not duplicate conversion logic in components.

## Parameter Types

Publish parameter definitions live in `src/types/parameters.ts` and generated provider schemas. Parameter form components should stay typed to `ParameterDefinition` and the specific value shape they edit.

## Validation

TypeScript types do not replace backend validation. Renderer validation is for user experience; Rust commands remain the authority for filesystem access, publish preflight, import validation, and persisted state integrity.

