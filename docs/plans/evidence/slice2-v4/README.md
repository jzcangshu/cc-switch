# 第四版补充证据

本目录对应 `2026-09-29-slice2-v4-execution-addendum.md`（第四版执行补充）。第三版证据目录未被覆盖。本目录的测试是诊断材料，不是待直接合入产品的完整补丁。

## 来源与运行边界

- 业务基线：`846de29c13ac4d65f164db8c15dd5fd58e29f972`。
- 正式文档目录：`C:/Users/jzcan/.codex/worktrees/codex-history-repair/cc-switch/docs/plans`。
- 隔离候选目录：`C:/Users/jzcan/.codex/worktrees/slice2-proof/cc-switch`。
- 本机原始输出：`D:/cc-switch/.tmp-cluster/slice2-v4-proof`。
- 测试只使用独立目录、内存数据库、合成认证和测试代理。没有停止用户正在运行的应用，没有发送模型请求，没有提交凭据。
- `manifest.json`（证据摘要清单）记录最终脚本、日志及候选源摘要，避免不同版本混用。

## 材料分工

| 文件                                    | 用途                                                               |
| --------------------------------------- | ------------------------------------------------------------------ |
| `prepare.cjs`（准备脚本）               | 在限定隔离目录从基线恢复测试涉及源文件，再附加诊断测试             |
| `stage.cjs`（候选脚本）                 | 实施最小路由、独立守卫、两个入口和文案；只允许隔离工作区           |
| `direct-tests.rs`（规划测试）           | 第三版继承的规划断言                                               |
| `controller-tests.rs`（控制器测试）     | 第三版继承的生命周期及反例断言                                     |
| `supplement-tests.rs`（补充测试）       | 第四版新增六项测试；本次过滤器只运行这六项                         |
| `client-proof.cjs`（客户端脚本）        | 同目录旧代理→共享代理，不重新播种旧历史；旧会话恢复及新会话创建    |
| `client-summary.json`（客户端结果摘要） | 只保留标识、列表、恢复错误和实际落盘元数据，不复制客户端内置提示词 |
| `port-snapshot.json`（端口快照）        | 只读记录真实应用监听端口，不据此推断全部测试失败原因               |

准备脚本会覆盖隔离工作区中列出的诊断源文件，不能对开发中业务工作区运行。执行前核对目标路径和是否有其他进程依赖该目录；这些脚本不是通用工作区清理工具。

## 后端补测结果与失败历史

1. 首次构建失败：诊断测试引用私有设置模块；改为公开重导出的真实设置保存函数。未修改生产模块可见性。
2. 第二次执行：4 通过、2 失败。地址用主机名导致服务绑定拒绝；真实保存测试在“应存在未完成操作”的断言失败，首次未记录返回错误，不能推断该失败必定来自指定注入点，也不能归因于 1175。
3. 第三次执行：5 通过、1 失败。因准备命令中的文件写入失败，实际仍运行第二次测试源；设置保存链通过，地址仍为不支持的主机名。保留日志，不把这次通过当成首次失败原因已查明。
4. 最终执行使用数字回环地址 `127.0.0.2`，保留真实设置错误输出；最终结果为 **6 通过、0 失败、2917 项被过滤**，见 `rust-v4-run4.log`（最终补测日志）。返回错误明确为“配置已发布”注入点，未误把提前失败计为验证成功。

地址测试的修正只调整测试输入，不增加产品的主机名支持。真实设置测试启用桌面框架测试特性，构造应用状态后调用真正的命令函数，不提取新的生产抽象。

六项补测不等同全量验证。第三版全量测试、1175 复现和端口失败仍按第三版证据解释。本轮没有重新执行全量静态检查、前端检查和整个后端测试集。

### 复现命令

从隔离工作区执行，按本机实际位置替换变量；不要复制到主工作区运行：

```powershell
$proofDocs = 'C:/Users/jzcan/.codex/worktrees/codex-history-repair/cc-switch/docs/plans/evidence/slice2-v4'
$proofTree = 'C:/Users/jzcan/.codex/worktrees/slice2-proof/cc-switch'
node "$proofDocs/stage.cjs" $proofTree candidate
$env:RUSTUP_HOME = 'D:/cc-switch/.tmp-cluster/rustup-1.95'
$env:CARGO_TARGET_DIR = 'D:/cc-switch/.tmp-cluster/cc-hr-target-v3'
$env:CARGO_INCREMENTAL = '0'
$env:CC_SWITCH_TEST_HOME = 'D:/cc-switch/.tmp-cluster/slice2-v4-proof/home'
$env:SLICE2_PROOF_ROOT = 'D:/cc-switch/.tmp-cluster/slice2-v4-proof/fixtures'
$env:SLICE2_STAGE = 'candidate'
cargo test --manifest-path "$proofTree/src-tauri/Cargo.toml" --locked --offline --features tauri/test --lib -j 2 proof_v4 -- --test-threads=1 --nocapture
```

命令中文解释：准备候选，使用锁定依赖与本机缓存，单线程运行六项第四版测试并显示注入错误。测试为诊断行为断言；正式测试应按仓库惯例分布在相应源文件内联模块。

## 客户端升级形态实验

运行示例：

```powershell
node "$proofDocs/client-proof.cjs" 'C:/Users/jzcan/AppData/Local/OpenAI/Codex/bin/faa963e871dd422c/codex.exe' 'D:/cc-switch/.tmp-cluster/slice2-v4-proof'
```

可通过 `node "$proofDocs/summarize-client.cjs" <隔离输出目录>`（读取实际落盘文件并输出精简摘要）复核持久化结论。

该命令中文含义：对桌面内置客户端启动独立应用服务，所有配置与合成历史位于第三个参数指定目录。重跑时请换一个新的输出目录，以免前次新建会话混入列表。

旧代理合成会话升级前可恢复，升级后缺少旧供应商定义而失败；默认列表按当前供应商过滤，全量列表仍包含旧标签。这里没有调用产品迁移函数，没有证明迁移代码正确。

新建会话在两阶段分别返回旧代理/共享供应商标识。使用 `summarize-client.cjs`（客户端摘要脚本）在进程退出后读取返回路径的第一行，会话元数据文件存在，标识与返回值一致；结果摘要中的落盘字段来自这个实际读取。完整轮次读取返回不支持错误，不能误写为所有客户端接口均成功。

脚本配置未使用真实账户，代理端点虽为示例本地端口，但未发送任何轮次或模型请求。此次只证明配置加载、列表过滤、会话恢复初始化和会话元数据持久化，不证明真实消息传输、热重载或其他版本。

## 保留与清理

所有原始日志、合成客户端目录与构建缓存留在本机；未删除文件。未来需要清理时由用户处理，先保留本目录摘要及对应原始日志。勿把测试目录中的内置提示词、完整运行时数据库或无关客户端日志提交到产品合并请求。
