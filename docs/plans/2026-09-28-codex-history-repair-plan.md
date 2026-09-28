# Codex（编程助手）统一会话历史修复计划 v2（写引擎时代）

> **状态（2026-09-28 晚）：** v2 就地取代同日早间的 v1 计划。上游合入 Codex 写引擎重构（`0e6430ab` 等 22 提交）后，v1 的切片一载体被结构性取代，PR #7728 已关闭（superseded）；逐项核查确认切片二、三的根因**仍然存在**且改动点更清晰。v1 全文见 fork 分支 `codex/codex-history-repair`（远端留档）及本分支 git 历史（`75ed020f`）；根因证据链见同目录 `2026-09-28-codex-history-investigation.md`（仍有效，其根因一与回填污染部分已被上游结构性修复）。
>
> **工作区：** `C:\Users\jzcan\.codex\worktrees\codex-history-repair\cc-switch`，分支 `verify/history-repair-on-new-engine`（基线 `846de29c` = origin/main）。该目录曾被外部清理误删过一次（仅剩 node_modules）；提交对象在主仓库共享对象库中不受影响，恢复命令：`git -C D:/cc-switch worktree prune && git -C D:/cc-switch worktree add <路径> verify/history-repair-on-new-engine`。Rust 工具链用 `RUSTUP_HOME=/d/cc-switch/.tmp-cluster/rustup-1.95`（仓库钉 1.95）；全量测试须 `-j 2` 且 `CARGO_INCREMENTAL=0`（本机内存与磁盘有限）；热构建缓存在 `/d/cc-switch/.tmp-cluster/cc-hr-target-v3`。

**Goal（目标）：** 在不改变第三方手工路由、认证权威来源和官方历史迁移选择的前提下，修复统一会话历史在**官方代理（接管）模式下的分桶分裂**与**存量历史迁移的完整性**；跨后端请求兼容与状态界面按原 v1 路线后续独立交付。

**Architecture（载体）：** 上游写引擎（`src-tauri/src/live/` + `services/provider/codex_direct.rs`）。所有修改建立在引擎的 `Route` / `RouteWrite` 扩展点上；保留引擎的写入次序、字段所有权、休眠表与 retired 清理机制。

---

## 1. 新引擎架构要点（动手前必读）

- **路由判定按供应商类别**：`CodexProjection::of` 对 `is_official` 的行无条件返回 `Route::Official`，**不读行文本**；非官方行走 `third_party_route`（显式第三方选择器→其表；保留 id 旧表→规范化；`openai_base_url` 旧形态→改写为 custom 表）。
- **写入只动自有字段**：`CodexConfigPatch` 替换 `ROW_TOP_FIELDS` / `CODEX_EXCLUSIVE_TOP` / 路由槽；**用户自己的 provider 表、MCP、`[projects]`、注释字节级保留**；retired/占位/代理残留表按归属证据清理，被 profile 引用的表不动。
- **路由写入形态**（`RouteWrite`，`live/project/codex.rs`）：
  - `Official { dormant_base_url }` — 官方直连且开关关：不写选路；既有 custom 表改写成休眠形态（本地代理地址 + 占位 Key），保第三方旧会话 resume。
  - `OfficialMirror` — 官方直连且开关开：选路 `custom` + 官方镜像表（`official_mirror_table(None, true)`），认证走 `auth.json`。
  - `Custom(Table)` — 第三方（直连或代理契约）：选路 `custom`。
  - `OfficialProxy(Table)` — 官方代理：选路 **`cc-switch-official`**（`OFFICIAL_PROXY_ROUTE_ID`），表为 `official_mirror_table(Some(base_url), false)`。
  - `BuiltIn` / `Default` — 内置 id / 无路由。
- **快照式回填已删除**：`restore_live_settings_for_provider_backfill`、common-config 片段机制不存在；行纯净由"live 从不回写行 + 行内路由表不参与投影"保证。
- **profile 覆盖**在写入前由 `check_effective_route` 拒绝并指出键名（原生覆盖 v1 计划 4.1 第 10 行）。

## 2. 硬约束（沿用 v1，全部仍然有效）

1. 任意第三方手工路由和未知供应商标识不被统一开关改写。→ 引擎已保证：unify 仅作用于 `Route::Official` 分支。
2. 当前有效官方登录是权威；只切换历史投影时不重新写入冻结认证。→ `AuthGoal::Official/KeepNative`；auth.json 永不入行。
3. 未勾选迁入官方历史，不修改既有官方历史。→ 迁移门槛与用户勾选语义（切片三）。
4. 开关开启且活动配置受应用管理时，新建会话进入同一个共享桶；直连和接管只是该桶下端点与传输能力不同。→ **当前未满足代理模式，本 v2 切片二的目标**。
5. 投影可逆：原始"没有选择器"和"显式官方选择器"必须区分；用户原有的同形表必须保留。→ 引擎字段写入天然可逆；行内不落投影；用户表保留。
6. 迁移后，被选择的会话段在元数据、持久化运行时供应商字段和权威数据库中保持一致；消息正文、工具内容、密文、会话编号不变。→ 切片三。
7. 恢复仅作用于账本能够证明来源的会话。→ 切片三。
8. 一次失败不能写完成标记；部分完成必须可诊断、可重试。→ 切片三。
9. 代理层不改变未选择兼容处理的同后端请求；官方认证失败继续遵守现有禁止向其他供应商自动重试的保护。→ 切片五。

## 3. v1 问题清单存亡核查（2026-09-28，基线 `846de29c`）

| 原问题 | 状态 | 证据（main） |
| --- | --- | --- |
| #6340 显式官方路由注入被拒 → 迁移永不执行 | ✅ 结构性修复：按类别判路由，Mirror 原生写 `custom`，门槛满足，有集成测试 | `project/codex.rs:185`、`codex_direct.rs:371`、`provider_service.rs reapply_codex_official_live_rewrites_only_the_session_routing` |
| 回填污染行（切片一逆操作的存在理由） | ✅ 结构性消失：live 从不回写行、行内路由表不投影、快照回填删除 | 08a80b90、b0875f4c |
| v1 切片一的三个 review 发现（父表误删/内联半回退/非字符串镜像） | ✅ 全部失的：`inject_*`/`with_original` 已不存在；main 的防御性 strip 为原始版本（`codex_config.rs:2416`），其"选择器无条件删除"缺口残留但行内不应再有投影，不值得单独修 | — |
| 第三方手工路由不被改写（硬约束 1） | ✅ 保持 | `third_party_route` |
| profile 覆盖选路（v1 4.1 行 10） | ✅ 原生拒绝并指出键名 | `check_effective_route` |
| **接管分桶分裂（根因二）** | ❌ **存在**：Proxy 分支不读统一开关，接管会话进 `cc-switch-official` 桶 | `codex_direct.rs:385-397`、`project/codex.rs:457` |
| **接管历史不在迁移源（根因四 7.2）** | ❌ **存在**：迁移源仅内建 `openai` 桶 | `migration.rs:46,190` |
| **运行时字段遗漏（根因四 7.1）** | ❌ **存在**：逐行改写仍只处理 `session_meta`，回调无状态 | `migration.rs:491-497,1017-1022` |
| 一次性完成标记 / 账本 / 重试（根因四 7.3-7.5） | ❌ 存在（v1 机制原样） | `migration.rs:29,217,318` |
| 状态界面（切片四）/ 请求兼容（切片五） | 未变 | — |

**待与维护者确认（不自行实现）：**
1. 官方行 `openai_base_url` 中转：引擎不投影该键，fresh 行切换时静默失效（与开关无关）；live 已有的在 unify 开时惰性保留、关时恢复。v1 要求的"拒绝统一并报告"路径不存在。
2. 第三方行任意 id 一律规范化为 `custom`（"Rows that use another id… normalized on the way out"）：旧 id 的表按 retired 清理，旧 id 标签的历史会话在默认过滤下不可见；休眠表只保 resume 能力不改会话标签。与 #7487 的语义关系需确认。

## 4. 切片二 v2：官方代理路由的共享桶与所有权解耦

### 4.1 Problem

`codex_direct.rs plan()` 的 Proxy 分支对官方行无条件返回 `RouteWrite::OfficialProxy`（选路 `cc-switch-official`），**不读统一开关**。后果：unify 开启时，直连新会话进 `custom` 桶、代理模式新会话进 `cc-switch-official` 桶，直连↔接管往返令一半历史默认不可见（#5974 症状族）；迁移源不含 `cc-switch-official`，这些会话永远不可迁移。上游选择独立 id 是为了"接管所有权信号"（调查报告 §3），但新引擎的模式判定来自应用状态而非配置解析，id 兼任所有权的历史理由已不成立。

### 4.2 Proposal

统一开关开启 + 官方代理 → 新增 `RouteWrite::OfficialMirrorProxy { base_url }`：选路 `custom`，表为 `official_mirror_table(Some(base_url), false)`（镜像表带本地代理地址、关 WebSocket、`requires_openai_auth = true` 走官方登录）。`selector()` 对该变体返回 `Some(ROUTE_ID)`。

- 退出代理（直连 + unify 开）：现有 `OfficialMirror` 接管 custom 槽，桶连续。
- 退出代理（直连 + unify 关）：现有 `Official { dormant }` 把 custom 改写为休眠形态，第三方 resume 语义不变。
- 统一开关关闭 + 代理：维持上游现状（`cc-switch-official`），零回归。
- 既有 `cc-switch-official` 残表：`write_route` 的 doomed 清理已覆盖（`OFFICIAL_PROXY_ROUTE_ID` 无条件入 doomed），无需新增逻辑。
- 所有权解耦：接管与否由应用状态（代理模式 + 当前行类别）判定，不再依赖配置里的 id；这正是调查报告 §3 "把所有权信号从桶名分离" 的落点。

**动工前必须先完成的去风险验证（步 0）：** 确认本地代理的路由分派对"custom 槽里的官方流量"能正确选择官方上游与登录处理——即 `services/proxy.rs` / `forwarder.rs` 的分派是**按应用状态（当前模式 + 当前行）**还是按配置表 id/形状。若按状态分派，id 信号是残留物，方案成立；若按表形状分派，需证明 `requires_openai_auth = true` 且无 bearer 的 custom 表会被分派到官方处理路径（第三方表带 bearer、形状可区分）。验证结论写入本节后再动工。

### 4.3 Alternatives considered

- **保留 `cc-switch-official` 独立桶，扩迁移源兜底（切片三把接管桶迁入 custom）**——最强理由：零写引擎风险、所有权信号天然清晰、改动只在迁移侧。否定：桶分裂在每次直连↔接管往返中持续产生新混合会话，迁移永远追赶式修复；#5974 的用户可见症状（切换后列表缺一半）不消失；且上游自己的休眠表机制已证明"custom 槽内容可按模式替换、id 固定"是既定架构方向，独立桶与之背道。
- **unify 关闭时也共享桶**——否定：改变开关关闭时的默认官方路由语义，扩大行为面，违背"开关只管历史分桶"的产品边界。

### 4.4 状态矩阵（验收即断言）

| 统一开关 | 模式 | 活动桶 | 表形态 | 认证 |
| --- | --- | --- | --- | --- |
| 关 | 官方直连 | 无选路（原生 openai） | custom→休眠表（如有） | 官方登录 |
| 开 | 官方直连 | `custom` | 官方镜像（无 base_url，WS 开） | 官方登录 |
| 关 | 官方代理 | `cc-switch-official` | 镜像 + 本地代理地址（WS 关） | 官方登录（现状不回归） |
| 开 | 官方代理 | **`custom`** | **镜像 + 本地代理地址（WS 关）** | 官方登录 |
| 任意 | 第三方（直连/代理） | `custom` | 第三方表（带 Key） | 行自带凭据 |

### 4.5 必测边界

官方直连→代理→直连（开关各态组合）；代理中开关切换；代理中官方↔第三方切换；休眠表与镜像表在 custom 槽上的相互改写；`cc-switch-official` 残表清理；第三方行全程不被触碰；迁移门槛在代理模式下可通过（`live_not_unified` 不再误报）；代理认证刷新后重投影。每次断言实际选路、端点、认证与休眠表未被回退。

### 4.6 触点与测试

- `services/provider/codex_direct.rs`：`plan()` Proxy 分支加 unify 判定；`RouteWrite` 新变体。
- `live/project/codex.rs`：`RouteWrite::selector()`、`apply` 的表写入（复用 `put_table`/`official_mirror_table`）。
- 视步 0 结论可能涉及 `services/proxy.rs` 的分派注释或微调（预期只需注释级）。
- 测试：`codex_direct` 单测矩阵 + `provider_service` 集成（镜像现有 `reapply_codex_official_live_rewrites_only_the_session_routing` 的代理模式版本）。

## 5. 切片三 v2：存量历史迁移（第二版）

沿 v1 §6 主体设计（预检状态机、来源账本、逐会话段执行、失败重试——见下），三处修订：

1. **迁移源纳入 `cc-switch-official`**：切片二落地后，历史接管会话可确认由应用生成（旧版本写死的 id + 官方镜像/代理表形状），符合 v1 §6.1 "来源包含内置官方标识与可确认由应用生成的旧官方接管标识" 的既有约束；不得经第三方迁移白名单。
2. **运行时字段**：`thread_settings_applied` 的 `model_provider_id` 仍会覆盖已迁移的 `session_meta`（调查 §7.1，上游 0.156.1 提取逻辑）。逐行改写需携带会话段状态——现回调是无状态 `Fn`，**必须先用最小夹具证明扩参可行**，不得预设。
3. **门槛语义更新**：`live_not_unified` 在切片二后主要剩"开关关闭"与"未覆盖的旧版本残留"两种成因；迁移与每应用切换锁的协调（v1 §6.2）照旧。

### 5.1 逐会话段执行（沿 v1 §6.3）

1. 改会话元数据供应商字段。
2. 改该段已应用运行时设置中的供应商字段（步 2 依赖夹具证明）。
3. 按目标会话编号更新数据库；避免无编号约束的大范围更新。
4. 还原会话文件修改时间。
5. 核对三处一致，比较非路由正文摘要校验值。
6. 重新检查开关、目录及活动投影仍匹配后写完成标记（v2 标记，不沿用 `codex-official-history-unify-v1` 挡板）。

不修改模型字段来"顺便治好续聊"；旧模型需要独立策略。

### 5.2 预检、写入与失败恢复（沿 v1 §6.2/6.4）

状态机 `待执行 → 预检 → 备份与来源清单 → 改写中 → 校验中 → 完成`，分支 `等待客户端关闭 / 路由未统一 / 不支持的结构` 与 `部分完成、可重试`。预检列出确切文件、会话段与数据库行；新代际在首个修改前写来源、目标、版本与计划清单；失败不写完成标记、不后台修改用户状态；"中途回滚"与"用户关开关还原"区分（前者精确原值，后者按账本还原）。互斥只覆盖应用内调用，迁移期间文档要求客户端保持关闭。

### 5.3 回归矩阵（沿 v1 §6.5）

元数据与运行时字段不一致；v1 标记已存在；只有 `cc-switch-official` 历史；混合会话段；未知第三方；新建共享桶会话；归档历史；配置重定向数据库；不同目录的账本；无/损坏元数据旧代际；数据库占用或损坏；第二个目标写失败；同秒重复执行；重复迁移与恢复；开关执行中关闭；迁移与供应商切换并发；目录变更；文件被外部追加；正文与修改时间保留。

## 6. 切片四：显示实际执行状态与重试（沿 v1 §7）

待切片三可区分完成、部分完成、跳过、等待后交付只读状态与重试入口；界面从后端结果显示，不读写完成标记。状态源须可跨重启读取（评估扩展现有 `local_migrations` 记录，见 `settings.rs` / `commands/settings.rs`）。显示：活动路由是否统一、迁移是否被选择、执行版本与目录、迁移数量、未处理数量、跳过原因、最近错误。"已保存开关""新会话路由已统一""既有历史修复完成"是三个状态。界面文字更新 zh/en/ja 三份统一历史指南（`docs/guides/codex-unified-session-history-guide-*.md`）与设置界面 `CodexAuthSettings.tsx`。**注意：三份指南现存的"注入被拒"描述是写引擎重构前的旧语义（上游文档债），切片二/三落地时一并重写场景 C 的成因（代理模式下 `live_not_unified` 等）。**

## 7. 切片五：跨后端请求兼容（沿 v1 §8，载体未变）

首个切片沿用 v1 §8.1：核对 #7342 的窄入口（官方原生响应请求、直接推理项数组内容），补负向用例；不进共享过滤器。通用兼容能力研究、`forwarder.rs` 按目标隔离的入口、失败重试从原请求重建副本、普通直连无拦截入口等边界全部沿用 v1 §8.2。`proxy/forwarder.rs` 在 main 上仍然存在，原设计有效。

## 8. 文件边界与验证命令

| 切片 | 文件 |
| --- | --- |
| 二 | `src-tauri/src/services/provider/codex_direct.rs`；`src-tauri/src/live/project/codex.rs`；必要时 `src-tauri/src/services/proxy.rs` |
| 三 | `src-tauri/src/codex_history_migration.rs`；`src-tauri/src/codex_state_db.rs` |
| 四 | `src-tauri/src/settings.rs`；`src-tauri/src/commands/settings.rs`；`src/components/settings/CodexAuthSettings.tsx`；`docs/guides/codex-unified-session-history-guide-{zh,en,ja}.md` |
| 五 | `src-tauri/src/proxy/forwarder.rs` 及相邻适配 |

```sh
export RUSTUP_HOME=/d/cc-switch/.tmp-cluster/rustup-1.95 CARGO_INCREMENTAL=0
export CARGO_TARGET_DIR=/d/cc-switch/.tmp-cluster/cc-hr-target-v3
cargo test  --locked -j 2 --manifest-path src-tauri/Cargo.toml --lib -- live::project::codex services::provider::codex_direct codex_history_migration
cargo test  --locked -j 2 --manifest-path src-tauri/Cargo.toml --test provider_service
cargo fmt   --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --locked -j 2 --manifest-path src-tauri/Cargo.toml -- -D warnings   # CI 同款；--all-targets 另有既有 op_ref（transform_codex_chat.rs:4498，勿修，与本簇无关）
pnpm typecheck && pnpm format:check && pnpm test:unit
```

本机 `pnpm test:unit` 不稳定（main 与分支失败集合漂移），以 typecheck/format:check 为准，单元套件以 CI 为准。

## 9. 实机验收（沿 v1 §10，按新引擎更新）

1. 固定桌面内置客户端和命令行版本，各完成官方直连 ↔ 第三方、官方代理 ↔ 第三方、官方直连 ↔ 官方代理（开关各态组合）。
2. 同一会话分别检查列表可见、读取、恢复、发送一轮；不能只验证其中一个动作。
3. 覆盖开关中途变化、应用重启、停止路由、旧 v1 标记、旧 `cc-switch-official` 桶、文件与数据库原本不一致。
4. 每步核对行配置、当前实际端点及官方认证没有回退，保留脱敏摘要与正文校验值。
5. 请求兼容另做同后端对照、跨后端工具往返、旧模型、合法密文、无法展开引用与压缩状态；普通直连不列为代理能力已验证。

每个合并请求只声明其真正覆盖的议题与状态。切片二可关联 #5974，但不能因此同时关闭 #4710 与 #7257。
