# Phase 6 Smoke Checklist (2026-02-08)

目标：验证 TASK-0602/TASK-0603 的核心路径（命令导入 -> 参数映射 -> 执行）在多 Provider 下可用。

## 环境快照

- 日期：2026-02-08
- 机器：macOS (arm64)
- dotnet：`9.0.100`
- cargo：`1.92.0`
- go：`go1.25.6`
- java：未安装（`java -version` 失败）
- gradle：未安装（`gradle -v` 不存在）

## 真实仓库 Smoke 样本

统一临时目录：`/tmp/one-publish-smoke-20260208`

### 1) dotnet

- 样本项目：`/tmp/one-publish-smoke-20260208/dotnet/SmokeDotnet`
- 导入命令（用于“从命令导入”）：
  - `dotnet publish SmokeDotnet.csproj -c Release -o ./publish-dotnet`
- 执行命令（通用执行管道最终等价命令）：
  - `dotnet publish SmokeDotnet.csproj -c Release -o ./publish-dotnet`
- 结果：通过
  - 输出目录：`/tmp/one-publish-smoke-20260208/dotnet/SmokeDotnet/publish-dotnet`
  - 文件数：5
  - 日志：`/tmp/one-publish-smoke-dotnet-publish.log`

### 2) cargo

- 样本项目：`/tmp/one-publish-smoke-20260208/cargo/smoke_cargo`
- 导入命令（用于“从命令导入”）：
  - `cargo build --release --target-dir ./target-smoke`
- 执行命令（通用执行管道最终等价命令）：
  - `cargo build --release --target-dir ./target-smoke`
- 结果：通过
  - 输出目录：`/tmp/one-publish-smoke-20260208/cargo/smoke_cargo/target-smoke/release`
  - 文件数：3
  - 日志：`/tmp/one-publish-smoke-cargo-build.log`

### 3) go

- 样本项目：`/tmp/one-publish-smoke-20260208/go/smoke_go`
- 导入命令（用于“从命令导入”）：
  - `go build -o ./bin/smoke-go ./...`
- 执行命令（通用执行管道最终等价命令）：
  - `go build -o ./bin/smoke-go ./...`
- 结果：通过
  - 输出文件：`/tmp/one-publish-smoke-20260208/go/smoke_go/bin/smoke-go`
  - 文件大小：2387874 bytes
  - 日志：`/tmp/one-publish-smoke-go-build.log`

### 4) java (gradle)

- 导入命令（用于“从命令导入”）：
  - `./gradlew build --info`
- 执行命令（通用执行管道最终等价命令）：
  - `./gradlew build --info`
- 结果：阻塞（当前环境缺少 Java Runtime/Gradle Wrapper 运行条件）
  - 失败原因：`java -version` 不可用
  - 建议：安装 JDK 17+，并在项目中提供 `gradlew`/`gradlew.bat`

## UI 手工验收要点（与任务 AC 对齐）

1. 切换 Provider 到 cargo/go/java，使用“从命令导入”粘贴对应命令。
2. 验证“命令导入映射结果”卡片：
   - 已映射字段显示正确
   - 未映射字段有明确反馈
3. 验证非 dotnet 的参数编辑器可编辑并可保存到配置。
4. 点击“执行发布”：
   - 命令执行日志显示 program + args
   - 成功/失败消息可操作
5. dotnet 兼容性：
   - 原有 dotnet 发布流程可继续使用
   - PublishProfile 仍可经 `properties.PublishProfile` 生效
