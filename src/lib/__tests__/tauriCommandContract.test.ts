// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * IPC 契约测试：期望的参数键直接从 Rust `#[tauri::command]` 签名推导，
 * 前端每个 `invoke("cmd", args)` 调用点由 TypeScript 类型检查器解析实参
 * 的属性集合，二者逐一比对——新增 invoke 包装无需手写期望表即被覆盖。
 *
 * Tauri v2 把 snake_case 参数名映射为 camelCase 键；非 `Option` 参数缺键
 * 只会在运行时报 "missing required key"，未知键则被静默忽略。
 */

const repositoryRoot = path.resolve(__dirname, "../../..");
const rustSourceRoot = path.join(repositoryRoot, "src-tauri", "src");
const frontendSourceRoot = path.join(repositoryRoot, "src");

/** Tauri 运行时注入、不来自前端实参的参数类型。 */
const INJECTED_PARAMETER_TYPE =
  /^(?:tauri::)?(?:AppHandle|State|Window|WebviewWindow|Webview)\b/;

interface RustCommandParameter {
  key: string;
  required: boolean;
  rustType: string;
}

interface InvokeCallSite {
  command: string;
  location: string;
  keys: Map<string, { optional: boolean; typeText: string }>;
}

function listFiles(
  dir: string,
  predicate: (file: string) => boolean
): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listFiles(fullPath, predicate);
    }
    return predicate(fullPath) ? [fullPath] : [];
  });
}

function toCamelCase(snakeCase: string): string {
  return snakeCase.replace(/_([a-z0-9])/g, (_, char: string) =>
    char.toUpperCase()
  );
}

/** 按顶层逗号切分参数列表（忽略 `<>`、`()`、`[]` 内部的逗号）。 */
function splitTopLevel(parameterList: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of parameterList) {
    if ("<([".includes(char)) depth += 1;
    if (">)]".includes(char)) depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function readParameterList(source: string, openParenIndex: number): string {
  let depth = 0;
  for (let index = openParenIndex; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    if (source[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openParenIndex + 1, index);
      }
    }
  }
  throw new Error(`unbalanced parameter list at ${openParenIndex}`);
}

function parseRustCommands(): Map<string, RustCommandParameter[]> {
  const commandPattern =
    /#\[tauri::command\]\s*(?:#\[[^\]]*\]\s*)*pub(?:\([^)]*\))?\s+(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(/g;
  const commands = new Map<string, RustCommandParameter[]>();

  for (const file of listFiles(rustSourceRoot, (f) => f.endsWith(".rs"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(commandPattern)) {
      const name = match[1];
      const openParenIndex = (match.index ?? 0) + match[0].length - 1;
      const parameters = splitTopLevel(
        readParameterList(source, openParenIndex)
      )
        .map((parameter) => {
          const separator = parameter.indexOf(":");
          return {
            identifier: parameter
              .slice(0, separator)
              .replace(/^mut\s+/, "")
              .trim(),
            rustType: parameter.slice(separator + 1).trim(),
          };
        })
        .filter(({ rustType }) => !INJECTED_PARAMETER_TYPE.test(rustType))
        .map(({ identifier, rustType }) => ({
          key: toCamelCase(identifier),
          required: !/^Option\s*</.test(rustType),
          rustType,
        }));

      if (commands.has(name)) {
        throw new Error(`duplicate tauri command name: ${name}`);
      }
      commands.set(name, parameters);
    }
  }
  return commands;
}

function parseRegisteredCommands(): Set<string> {
  const libSource = readFileSync(path.join(rustSourceRoot, "lib.rs"), "utf8");
  const handlerBody = libSource.match(/generate_handler!\[([\s\S]*?)\]/)?.[1];
  if (!handlerBody) {
    throw new Error("generate_handler! not found in src-tauri/src/lib.rs");
  }
  return new Set(
    handlerBody
      .replace(/\/\/.*$/gm, "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => entry.split("::").pop() as string)
  );
}

function invokeLocalNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "@tauri-apps/api/core" &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      for (const element of statement.importClause.namedBindings.elements) {
        if ((element.propertyName ?? element.name).text === "invoke") {
          names.add(element.name.text);
        }
      }
    }
  }
  return names;
}

function collectInvokeCallSites(): InvokeCallSite[] {
  const config = ts.readConfigFile(
    path.join(repositoryRoot, "tsconfig.json"),
    ts.sys.readFile
  );
  const { options } = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    repositoryRoot
  );
  const rootNames = listFiles(
    frontendSourceRoot,
    (file) =>
      /\.tsx?$/.test(file) &&
      !file.includes(`${path.sep}__tests__${path.sep}`) &&
      !/\.test\.tsx?$/.test(file) &&
      readFileSync(file, "utf8").includes("@tauri-apps/api/core")
  );
  const program = ts.createProgram({ rootNames, options });
  const checker = program.getTypeChecker();
  const callSites: InvokeCallSite[] = [];

  for (const fileName of rootNames) {
    const sourceFile = program.getSourceFile(fileName);
    const localNames = sourceFile ? invokeLocalNames(sourceFile) : new Set();
    if (!sourceFile || localNames.size === 0) continue;

    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        localNames.has(node.expression.text)
      ) {
        const [commandArgument, argsArgument] = node.arguments;
        const { line } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart()
        );
        const location = `${path.relative(repositoryRoot, fileName)}:${line + 1}`;
        if (!commandArgument || !ts.isStringLiteralLike(commandArgument)) {
          throw new Error(
            `${location}: invoke command must be a string literal`
          );
        }

        const keys = new Map<string, { optional: boolean; typeText: string }>();
        if (argsArgument) {
          const argsType = checker.getTypeAtLocation(argsArgument);
          for (const property of checker.getPropertiesOfType(argsType)) {
            keys.set(property.name, {
              optional: (property.flags & ts.SymbolFlags.Optional) !== 0,
              typeText: checker.typeToString(
                checker.getTypeOfSymbolAtLocation(property, argsArgument)
              ),
            });
          }
          if (keys.size === 0 && argsType.getStringIndexType()) {
            throw new Error(
              `${location}: invoke args must have a concrete object type, got ${checker.typeToString(argsType)}`
            );
          }
        }
        callSites.push({ command: commandArgument.text, location, keys });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return callSites;
}

describe("Tauri IPC contract (derived from Rust command signatures)", () => {
  let rustCommands: Map<string, RustCommandParameter[]>;
  let registeredCommands: Set<string>;
  let callSites: InvokeCallSite[];

  beforeAll(() => {
    rustCommands = parseRustCommands();
    registeredCommands = parseRegisteredCommands();
    callSites = collectInvokeCallSites();
  }, 60_000);

  it("parses the Rust commands and every frontend invoke call site", () => {
    // 防止解析器静默失效：命令与调用点数量都应远大于零。
    expect(rustCommands.size).toBeGreaterThan(50);
    expect(callSites.length).toBeGreaterThan(50);
    expect(rustCommands.get("apply_imported_config")).toEqual([
      { key: "repoId", required: true, rustType: "String" },
      { key: "profiles", required: true, rustType: "Vec<ConfigProfile>" },
    ]);
  });

  it("every invoke call targets a registered command with exactly the Rust argument keys", () => {
    const violations = callSites.flatMap(({ command, location, keys }) => {
      const parameters = rustCommands.get(command);
      if (!parameters) {
        return [`${location}: unknown command "${command}"`];
      }
      const problems: string[] = [];
      if (!registeredCommands.has(command)) {
        problems.push(
          `${location}: "${command}" is not registered in generate_handler!`
        );
      }
      const rustKeys = new Set(parameters.map(({ key }) => key));
      for (const key of keys.keys()) {
        if (!rustKeys.has(key)) {
          problems.push(
            `${location}: "${command}" has no parameter "${key}" (expected: ${[...rustKeys].join(", ") || "none"})`
          );
        }
      }
      for (const parameter of parameters) {
        const tsKey = keys.get(parameter.key);
        if (parameter.required && (!tsKey || tsKey.optional)) {
          problems.push(
            `${location}: "${command}" requires "${parameter.key}" (${parameter.rustType}) but it is ${tsKey ? "optional" : "missing"}`
          );
        }
      }
      return problems;
    });

    expect(violations).toEqual([]);
  });

  it("apply_imported_config sends the ts-rs export profile shape as its nested payload", () => {
    const sites = callSites.filter(
      ({ command }) => command === "apply_imported_config"
    );

    expect(sites).toHaveLength(1);
    // ConfigExportProfile 由 ts-rs 从 Rust config_export::ConfigProfile 生成，
    // 嵌套字段（snake_case）因此由 tsc 对齐 Rust 的 serde 形状。
    expect(sites[0].keys.get("profiles")?.typeText).toBe(
      "ConfigExportProfile[]"
    );
  });
});
