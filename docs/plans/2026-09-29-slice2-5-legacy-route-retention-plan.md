# 切片 2.5 实施计划 v2：旧官方代理路由定义的保留（解除发布阻断 1）

> **状态（2026-09-29）：proposed（v2，已吸收独立评审五项修正），待复审。** 针对 PR #7743（候选 `2049cf45`）的发布阻断 1——作者自动审查 P1、PR 正文 ⛔ 第 1 条、真实数据测试评论（issuecomment-5882801136 第 4 点）共同确认的升级过渡回归。
> 业务基线：`846de29c`；候选：`2049cf45`（本计划在其之上叠加）。升级回归链路、客户端实证见 v4 执行补充 §4 与第三版技术分析 §5。
> **v2 修订记录**：①保留判定从"形状识别"改为"id 管理权限 + 内容规范化"（修残余回归：用户改名等显示字段编辑不再导致旧表被删）；②修正认证约定自相矛盾（孪生保留 `requires_openai_auth = true`，只是不含任何凭据字段）；③地址跟随承诺按真实触发路径收窄；④撤回"孪生自动触发导入守卫"的错误论断，改为有意不扩大守卫；⑤撤回对已丢失定义无效的手动恢复配方，改写前提。

## 1. 问题定义

1. base：统一开关只影响直连分支；代理官方分支固定写 `RouteWrite::OfficialProxy`（选路 `cc-switch-official`），且该臂对既有表**无条件 `put_table` 覆盖**（`write_route:747-760`）——base 对这个 id 的任何内容都是"清掉重写"，具备自愈性。
2. 升级候选后首次启动：`write_proxy` `force = op_name == op::ATTACH`（`mode/controller.rs:193`）强制 plan/run；官方代理分支按统一开关改写 `RouteWrite::Custom(official_mirror_table(...))`（`codex_direct.rs:402-405`）。
3. `write_route` doomed 清扫（`codex.rs:699-712`）按 id 删除未被 profile 引用的 `cc-switch-official` 表；新 Custom 分支只写共享槽、不补旧 id → 旧桶会话失去唯一定义 → `Model provider 'cc-switch-official' not found`。
4. 迁移不兜底：官方迁移源仅内建 `openai`（`migration.rs:46,237`）；第三方白名单（:50）不含该 id。

实证：本机 9 个旧桶会话（归档区）在候选之前即因 base 既有清理规则断链（同款报错）；v4 §4.1 合成实验复现升级时点。清理规则是上游既有架构；本切片解决**升级时点的触发**，并为存量设备保留恢复凭据的窗口（§6）。

**目标**：统一开启后，`cc-switch-official` 定义保留为标准休眠镜像且地址随合法写入维护；旧桶会话随时可恢复。**不做**会话迁移（切片三）、不碰启动恢复权限、不做请求分派/认证改动。

**语义承诺（准确版）**：定义保留解决"供应商定义缺失"，使旧桶会话可**恢复（resume）**。恢复后的**发送**另有各自条件：官方目标由代理校验客户端的有效官方登录（托管账号还需账号匹配），第三方目标按既有规则替换认证；跨后端请求兼容性是切片五议题。切离托管账号时现有认证流程可能清除其登录——"表还在"不等于"认证上下文还在"。

## 2. 方案与被否的替代

**采用：id 管理权限 + 内容规范化。** `cc-switch-official` 是应用自有命名空间——doomed 规则的既有前提就是按 id 清理它（base 对该 id 下**任何内容**的处置都是删除）。本切片把"删除"软化为"规范化保留"：统一开启的投影遇到该 id 的既有表，保留槽位、把内容规范化为标准休眠镜像（`official_mirror_table(Some(当前地址), false)`），地址随合法写入维护。用户对该表的显示名等编辑会被规范化覆盖——base 的处置是整表删除，规范化是严格更小的破坏；这正是 v4 调查 §6"别名随当前供应商投影"的既有语义。

**被否的替代（最强理由优先）：**

- **形状门控保留（v1 方案）**：只认领标准镜像形状。被否原因：base 靠"删了重写"对该 id 自愈，形状门控破坏了这一性质——用户只改显示名，旧表被删且不补，残余同类升级回归（评审第 1 条，成立）。且"形状即所有权"的措辞会误导维护者；写入权限来自既有管理范围与合法操作入口，形状至多是兼容识别。
- **不处理，等切片三**：升级回归在切片三前持续发生（每次统一开 + 代理的 ATTACH 都清表）；"合并"与"可发布"之间需要不破坏旧会话的过渡态。
- **来源查询门控（查 state_5.sqlite）**：精确但引入外部 schema 版本耦合与失败路径复杂化；state DB 读写属于切片三领域。
- **迁移先行（切片三整体提前）**：工程量数倍，且迁移运行前的那次 ATTACH 仍会清表，窗口不消除。

## 3. 精确改动点（2 个生产文件，约 40 行）

### 3.1 `live/project/codex.rs`

**`CodexConfigPatch` 新字段**（:502-515）：

```rust
/// 统一历史启用后旧 `cc-switch-official` 会话仍引用该 id 的定义。Some(当前代理
/// 基址) = 该 id 的既有表保留并规范化为该地址的休眠镜像；None = 维持 base 的
/// 删除行为。生产路径当前恒为 Some；None 保留给切片三迁移完成后的清理开关
/// 与测试对照。
pub maintain_official_proxy_route: Option<String>,
```

**doomed 过滤器**（:699-712）：

```rust
let maintain = self.maintain_official_proxy_route.is_some();
// ...
&& (!(maintain && *id == OFFICIAL_PROXY_ROUTE_ID)
    && (*id == OFFICIAL_PROXY_ROUTE_ID || holds_placeholder(item) || self.is_retired(id, item)))
```

按 id 豁免，**不做形状门控**（v2 修正 ①）。被 profile 引用的表本就在 `!referenced...` 中先行豁免，两种豁免叠加语义不变。

**路由 `match` 块后、`if providers.is_empty()`（:764）前，新增规范化维护写**：

```rust
if let Some(url) = &self.maintain_official_proxy_route {
    if !matches!(self.route, RouteWrite::OfficialProxy(_))
        && providers.contains_key(OFFICIAL_PROXY_ROUTE_ID)
        && !referenced.iter().any(|name| name == OFFICIAL_PROXY_ROUTE_ID)
    {
        put_table(providers, OFFICIAL_PROXY_ROUTE_ID, official_mirror_table(Some(url), false), container_inline);
    }
}
```

要点：**规范化 = 用标准休眠镜像整体替换该槽内容**——不保留原内容（改名、用户追加键一并归一；base 的处置是整表删除，本方案严格更小破坏）；**绝不无中生有**（`owned_table` 无容器分支不变，没有该表就不会出现）；`OfficialProxy` 活跃写后跳过（等值避免双写）；被 profile 引用时跳过（`profile_selectors` 在 `write_route` 开头 :664 读取，先于本分支，作用域可达）。孪生内容 = `official_mirror_table(Some(url), false)`：**保留 `requires_openai_auth = true`（官方镜像认证要求，v2 修正 ②）**，不含任何 bearer/占位凭据字段——因此也不含 `PROXY_TOKEN_PLACEHOLDER`，`codex_live_has_proxy_placeholder` 不命中，v3 §3.2 启动误检与 v2 反例均不回归（启动编排零改动）。

### 3.2 `services/provider/codex_direct.rs`

`plan()` 为所有投影统一设置 `maintain_official_proxy_route`：`Target::Proxy` 用 `Some(base_url)`；其余用 `Some(configured_proxy_base_url(db))`（与 `Official { dormant_base_url }` :376 同源，含 port=0 回退）。

**地址跟随承诺（v2 修正 ③，准确边界）**：已接入代理时随成功重同步更新；直连/休眠期间地址变更**不触发**本客户端写入（重同步入口跳过直连模式，代理服务可能因其他应用继续存活——"必然连接失败"的表述删除），孪生地址在下一次合法投影时刷新。代理地址变化本身改变契约 `url`，因此**代理模式下**无滞后窗口；直连模式的滞后是接受的语义（resume 不依赖地址）。

### 3.3 守卫零改动（v2 修正 ④）

导入守卫（`codex_has_mirror_proxy_mirror_shape` → `live_has_proxy_import_risk`）只检查共享槽活动路由（selector=`custom` + `model_providers.custom`），**不遍历其他表**。孪生（未选中的旧定义）**不触发**导入拒绝或片段跳过——这是有意行为：不为一张永久休眠表扩大守卫去拒绝正常直连配置；片段抽取器本就整体移除 `model_providers`，孪生无泄漏路径。活动路由命中既有条件（代理镜像形状/占位符）时照旧拒绝。v1 的"共享形状函数"重构随之取消，v4 §2.2 的同步维护约定继续由注释 + 生成形状测试承担。

## 4. 不变量

1. v3 §3.2 启动误检不回归：孪生无占位符 token → `is_codex_live_taken_over` 不命中；启动编排零改动。
2. v2 反例不回归：保留发生在引擎自己的写入路径，不进入启动恢复、行污染判定；手工配置在启动时依旧不被认领。
3. 第三方保护：只触及应用自有命名空间 id；用户表、MCP、projects 零接触。规范化可能覆盖用户写入该 id 的内容——base 的处置是整表删除，严格更小破坏，发布说明如实写明。
4. 契约、发布/前滚、锁结构、`check_effective_route`、`RESERVED_TABLE_IDS`（不含该 id）全部不动；孪生随补丁同次发布，无新事务语义（仅证明两张表一起发布，不扩展为设置/认证/模式状态整体原子性）。

## 5. 验收矩阵

六维（v4 §4.2）：

| # | 维度 | 断言 | 位置 |
| --- | --- | --- | --- |
| 1 | 认证 | 孪生保留 `requires_openai_auth = true`，不含任何 bearer/占位凭据；发送认证按目标类型走既有规则 | `codex_direct` 内联 |
| 2 | 地址跟随 | 代理接入时 resync → 双表地址同步；直连期间地址变更不立即重写、下一次合法投影刷新 | `controller` 内联 |
| 3 | 退出代理 | 统一开+代理 → 退出 → custom=直连镜像且孪生保留 | `controller` 内联 |
| 4 | 切第三方 | 官方→第三方→官方往返，孪生全程保留，令牌互不混入 | `controller` 内联（扩既有往返测试） |
| 5 | 关统一 | unify off + 代理 → 槽位回到活跃 `OfficialProxy` 表，旧桶会话恢复/发送回到候选前行为；该路径重建已被删除的定义 | `codex_direct` plan 形状 + `controller` 表内容 |
| 6 | 备份恢复 | 含旧契约（含改名/追加键变体）的 pre-write → 投影后规范化保留 | `codex_direct` 内联 render+apply |

回归与边界：

| # | 断言 | 位置 |
| --- | --- | --- |
| 7 | 改名/追加键/未知内容的同名表 → 规范化为标准休眠镜像（不再删除） | `codex_direct` 内联 |
| 8 | profile 引用豁免：既不清也不被维护写覆盖 | `codex_direct` 内联 |
| 9 | 契约摘要不含孪生与新字段；同契约不触发写入 | `codex_direct` 内联 |
| 10 | 启动无误检：孪生存在 + live-state=direct → startup 字节不变 | `controller` 内联 |
| 11 | 守卫边界：仅存在孪生（活动路由为直连镜像/第三方表）时导入**不**拒绝；活动路由命中既有条件时拒绝 | `proxy`/`controller` 内联 |
| 12 | 发布失败注入：补丁原子发布，失败后孪生与主表状态一致（回滚/前滚不产生半张孪生） | `controller` 内联（扩既有保存回滚测试） |
| 13 | 切片二既有 12 项 + 模块回归全绿 | 全量门 |
| 14 | 客户端级：合成旧桶会话 + 投影后双表配置 → `thread/resume` 成功；恢复后发送走"跟随当前"路径 | 交付前实机门槛（resume-check 方法），不入产品测试 |

## 6. 边界与诚实声明

1. **已丢失定义的存量设备**（作者本机 9 个归档会话）：保留逻辑只规范化**已存在**的表。统一开启下任何官方投影都不生成旧 id（v2 修正 ⑤——v1 的"切代理再切回"配方在统一开启时无效，删除）；有效的人工路径只有"统一关闭 + 官方代理"（注意该操作对迁移意愿与完成标记的既有影响），主恢复路径 = 切片三迁移。
2. **"用户手动删除后不再出现"**准确表述：休眠维护不会重建；统一关闭的官方代理投影仍会创建活跃定义。
3. **降级**：降回 base 后 base 的 doomed 规则清除孪生——回到 base 行为，发布说明如实写明。
4. **孪生对客户端的可见性**：列表按会话标签过滤（已实证）；其余行为列入交付前实机检查。

## 7. 风险与请复审重点

1. 规范化覆盖用户写入该 id 的内容（含真实凭据丢失）——base 同样删除，损害等价；请确认发布说明的措辞充分。
2. `maintain` 恒为 Some 时 `None` 分支仅服务切片三清理开关与测试对照——请评审判定 Option 是否应收敛为必填。
3. 直连休眠期孪生地址滞后是接受的语义（resume 不依赖地址）——若产品要求直连期间也实时跟随，需要额外维护入口，本切片明确不做。
4. 测试 12（发布失败 × 孪生原子性）是新增断言，实现时若发现补丁粒度不支持该断言，回退为文档说明并如实记录。

## 8. 交付形态与验证命令

- 单提交追加到 PR #7743：`fix(codex): keep the legacy official proxy route definition resumable`。PR 正文 ⛔ 第 1 条更新为"升级保留已实现，待客户端级验收"；机器人 P1 回复引用本计划 v2。
- 规模：生产代码约 35-40 行（2 文件）+ 测试约 150 行；守卫文件零改动。
- 验证命令沿用总计划 §8（1.95 工具链、`-j 2`、`CARGO_INCREMENTAL=0`）；格式/clippy(--lib)/全量库测试按既有门槛，基线失败对照沿用已记录清单。
- 交付前实机门槛：§5.14 客户端恢复/发送验证 + 官方发送验收（需用户重登 ChatGPT 与可用网络出口）。
