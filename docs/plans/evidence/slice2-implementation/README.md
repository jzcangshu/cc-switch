# 正式实施证据

产品提交：`2049cf45db086467b5d8c4afa6f4416ac96402ac`。
产品基线：`846de29c13ac4d65f164db8c15dd5fd58e29f972`。
产品目录：`C:/Users/jzcan/.codex/worktrees/unified-proxy-history/cc-switch`。
原始日志目录：`D:/cc-switch/.tmp-cluster/slice2-implementation`。

## 实际结果

| 验证           | 结果与证据                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 修复前场景测试 | 2 通过、8 预期失败；`baseline-tests.log`（基线回归日志）                                                                       |
| 修复后新增测试 | 12 通过；`candidate-tests.log`（候选回归日志）；未用额外框架特性参数                                                           |
| 后端格式       | 通过；`rust-format.log`（格式日志，成功无输出）                                                                                |
| 全目标静态检查 | 候选与基线均在未修改请求转换测试第 4498 行出现相同引用比较警告；两个静态检查日志保留                                           |
| 后端全量       | 首次遇库测试失败后停止；随后用不提前退出模式运行全部目标：3079 通过、1 失败、10 忽略；174 项集成全部通过                       |
| 后端失败对照   | 固定基线单项也因 15721 端口占用失败；`port-baseline.log`（基线端口测试日志），没有关闭真实应用                                 |
| 前端类型与格式 | 均通过，日志保留                                                                                                               |
| 前端全量       | 146 文件中 144 通过、2 失败；1654 测试通过、5 失败。两个失败文件在基线与候选独立执行分别 56 通过。保留全量失败，不认定门槛全绿 |
| 客户端         | 桌面内置 `0.158.0-alpha.2.1` 与本机命令行 `0.140.0` 各发送一轮本地模拟响应、完成并恢复；元数据实际落盘为共享标识               |

完整大日志不复制到产品分支；`manifest.json`（证据清单）记录本机原始日志的摘要。此目录关键日志是有意保留的诊断资料，不是产品源文件。

## 命令与环境

后端使用锁定依赖及离线缓存，工具链目录 `D:/cc-switch/.tmp-cluster/rustup-1.95`，构建缓存 `D:/cc-switch/.tmp-cluster/cc-hr-target-v3`，禁用增量、构建并发 2。测试串行并使用隔离测试目录。

```powershell
$env:RUSTUP_HOME = 'D:/cc-switch/.tmp-cluster/rustup-1.95'
$env:CARGO_TARGET_DIR = 'D:/cc-switch/.tmp-cluster/cc-hr-target-v3'
$env:CARGO_INCREMENTAL = '0'
$env:CC_SWITCH_TEST_HOME = 'D:/cc-switch/.tmp-cluster/slice2-implementation/home'
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --locked --offline --manifest-path src-tauri/Cargo.toml -j 2 --all-targets -- -D warnings
cargo test --locked --offline --manifest-path src-tauri/Cargo.toml --lib -j 2 codex_unified_proxy -- --test-threads=1
cargo test --locked --offline --manifest-path src-tauri/Cargo.toml -j 2 --no-fail-fast -- --test-threads=1
pnpm typecheck
pnpm format:check
pnpm test:unit
pnpm exec vitest run tests/components/PiProviderForm.test.tsx tests/integration/App.test.tsx
```

命令中文解释：依次做后端格式、全目标静态检查、新增回归、全部后端目标，以及前端类型、格式、全量和失败文件对照。实际每项保存退出码；不能因后续命令成功而覆盖先前失败。

基线对照在文档工作区运行；已通过版本差异检查确认该目录的后端、前端、测试和锁文件与业务基线一致。前端全量失败发生于较高并发负载，单独重跑通过只能证明不稳定，不能证明具体根因。

## 客户端验证边界

复现脚本：上一层 `client-local-roundtrip.cjs`（本地消息往返脚本），参数为客户端可执行文件与新的隔离输出目录。它启动本地随机端口模拟服务，在专用配置目录放置合成测试凭据，调用新建会话、开始一轮及恢复接口。`client-summary.json`（结果摘要）来自实际接口结果与会话文件元数据。

这不是运行产品代理的真实账户端到端验收，也不是所有模式热切换证明。命令行客户端曾自动同步公共插件目录，相关测试子进程已停止；模型请求本身只到本地服务，不宣称整个客户端没有外部网络活动。

## 审查结论与剩余门槛

新增行为具备修复前失败、修复后通过的证据；手工配置、认证、数据库行与旧恢复判定保护有回归覆盖。未修改生产主循环、锁、请求转换或历史迁移。

仍不可发布：旧代理会话缺失旧定义后的恢复问题必须独立解决；全量静态检查和测试门槛未全绿；真实账户及完整热切换验收未做。发布约束参见第四版执行补充，草稿不能自动关闭整个历史缺失问题。
