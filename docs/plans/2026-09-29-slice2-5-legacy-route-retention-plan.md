# 切片 2.5 实施计划：旧官方代理路由定义的休眠保留（解除发布阻断 1）

> **状态（2026-09-29）：proposed，待独立评审。** 本计划针对 PR #7743（候选 `2049cf45`）的发布阻断 1——作者自动审查 P1 与 PR 正文 ⛔ 第 1 条、我的真实数据测试评论（issuecomment-5882801136 第 4 点）共同确认的升级过渡回归。评审通过后作为独立提交追加到 #7743。
> 业务基线：`846de29c`；候选：`2049cf45`（本计划在其之上叠加）。上游写引擎关键结构见总计划第 1 节；升级回归的完整链路与客户端实证见 `2026-09-29-slice2-v4-execution-addendum.md` §4 与第三版技术分析 §5。

## 1. 问题定义（为什么必须有这个切片）

**升级回归链路（机器人 P1，已逐条核实）：**

1. base 版本：统一开关只影响直连分支，代理官方分支固定写 `RouteWrite::OfficialProxy`（选路 `cc-switch-official`）。开着统一历史 + 官方代理的设备，代理期间会话落旧桶，`cc-switch-official` 表在 live 里被维护。
2. 升级到候选后首次启动：`write_proxy` 中 `force = op_name == op::ATTACH`（`mode/controller.rs:193`）强制 plan/run；`plan()` 代理官方分支按统一开关改走 `RouteWrite::Custom(official_mirror_table(Some(base_url), false))`（`codex_direct.rs:402-405`）。
3. `write_route` 的 doomed 清扫（`live/project/codex.rs:699-712`）按 id 删除未被 profile 引用的 `cc-switch-official` 表 → 旧桶会话失去唯一定义 → 恢复报 `failed to load configuration: Model provider 'cc-switch-official' not found`。
4. 迁移不兜底：官方历史迁移源仅内建 `openai`（`codex_history_migration.rs:46,237`）；第三方白名单 `CC_SWITCH_LEGACY_CODEX_MODEL_PROVIDER_IDS`（:50）不含旧官方代理 id。勾选迁移不能补救。

**实证**：本机真实数据——9 个旧桶会话（归档区）在候选部署**之前**即因 base 引擎的既有清理规则无法恢复（同款报错）；合成实验（v4 §4.1）证明"旧代理配置 + 替换为共享配置 + 重启"即复现。清理规则本身是上游既有架构（base 上任何代理退出/路由改写同样清表），本切片解决的是**升级时点的触发**并顺带为存量设备提供恢复凭据（见 §6 局限）。

**目标**：统一开启后，`cc-switch-official` 定义不再被删除，而是维护为"休眠镜像"——旧桶会话随时可恢复（定义存在），其地址跟随当前代理配置；不做会话迁移（切片三）；不碰启动恢复权限（v3 反例依然成立）。

**语义承诺（"旧会话恢复后发送"的走向）**：恢复只需定义存在。旧桶会话恢复后发送 → 请求指向孪生表的 `base_url`（本地代理）→ 代理按**模式状态**路由到当前供应商（请求分派纯状态驱动，步 0 已证）——即"跟随当前"语义，与调查报告 §6 的别名语义选择一致。代理关闭时该地址不可达，发送得到明确的连接错误（与既有休眠表机制同语义）。

## 2. 方案与被否的替代

**采用：形状识别 + 休眠维护（写路径内解决）。** 引擎写 `custom` 槽镜像时，若 pre-write 配置存在**能识别为应用所写**的 `cc-switch-official` 表，不进 doomed 清扫，而是重写为当前地址的官方镜像休眠形态。依据：doomed 规则本身已把该 id 视为应用命名空间（base 对它的处置是直接删除）；把"删除"软化为"维护"是严格更小的破坏；地址维护复用 `OfficialProxy` 臂对 custom 表做休眠改写的同一机制（`write_route:747-754` 的镜像操作）。

**被否的替代（按最强理由记录）：**

- **不处理，等切片三**：迁移确实是一劳永逸的解，但升级回归在切片三落地前持续发生（每次统一开 + 代理的 ATTACH 都清表），且"合并代码"与"可发布"之间需要一个不破坏旧会话的过渡态——这正是阻断定义本身。
- **来源查询门控（查 `state_5.sqlite` 是否有旧桶会话才保留）**：判定最精确，但引入对外部 schema 的版本耦合（state_5 命名与表结构随客户端版本变），且"保留/清理"的时序与查询失败路径复杂化。state DB 读写本来就是切片三的领域，留给它。
- **迁移先行（把切片三整体提前）**：彻底但工程量数倍（账本、备份、逐段执行、运行时字段），且迁移不能消除"表在升级瞬间被删"的窗口——迁移运行前的那次 ATTACH 仍然清表。两步走的顺序（先保定义、后迁会话）是 v4 §4.2 既有结论。

## 3. 精确改动点

### 3.1 `live/project/codex.rs` — 共享形状函数 + 补丁字段 + 写路径

**新增共享判定函数**（放在 `official_mirror_table` 附近）：

```rust
/// 官方代理镜像的语义形状：name="OpenAI"、requires_openai_auth=true、
/// supports_websockets=false、wire_api="responses"、base_url 非空字符串。
/// 引擎写路径的维护认领与导入守卫共用；URL 的严格形状校验（http、/v1、
/// 无 userinfo/query/fragment）只属于导入守卫——两边错误代价不同：
/// 守卫漏判 = 放行一次导入（可逆）；引擎漏认 = 表被清、旧会话断（不可逆）。
pub fn is_official_proxy_mirror_table(table: &dyn TableLike) -> bool
```

判定按现有取值惯例（`Item::as_str/as_bool` + `non_empty_str`）实现；**不要求恰好五字段**——用户在应用写的表上追加过键时仍应被认领维护，否则退回被删路径，恰是本切片要消除的伤害。

**`CodexConfigPatch` 新字段**（:502-515 结构体）：

```rust
/// 统一历史启用后旧 `cc-switch-official` 会话仍引用该 id 的定义。Some(当前代理
/// 基址) = 写路径把已存在的旧定义维护为该地址的休眠镜像；None = 维持既有清理。
pub maintain_official_proxy_route: Option<String>,
```

**`write_route` 两处改动**：

a. doomed 过滤器（:699-712）：`*id == OFFICIAL_PROXY_ROUTE_ID` 分支加维护豁免——

```rust
let maintain = self.maintain_official_proxy_route.is_some();
// ...
&& (!(maintain
      && *id == OFFICIAL_PROXY_ROUTE_ID
      && item.as_table_like().is_some_and(is_official_proxy_mirror_table))
    && (*id == OFFICIAL_PROXY_ROUTE_ID || holds_placeholder(item) || self.is_retired(id, item)))
```

形状认不得（用户手改到无法辨识、或维护字段为 None）→ 维持删除，清理语义对未知内容不放宽。

b. 路由 `match` 块之后、`if providers.is_empty()`（:764）之前，新增维护写：

```rust
if let Some(url) = &self.maintain_official_proxy_route {
    if !matches!(self.route, RouteWrite::OfficialProxy(_))
        && providers.get(OFFICIAL_PROXY_ROUTE_ID).is_some_and(is_official_proxy_mirror_table)
        && !referenced.iter().any(|name| name == OFFICIAL_PROXY_ROUTE_ID)
    {
        put_table(providers, OFFICIAL_PROXY_ROUTE_ID, official_mirror_table(Some(url), false), container_inline);
    }
}
```

要点：**只维护已存在者，绝不无中生有**（没有 `model_providers` 容器的分支 `owned_table` 不变）；`OfficialProxy` 活跃写后此处是等值重写，直接跳过；被 profile 引用的表连 doomed 都豁免，维护写同样必须跳过（否则会把引用方的表内容覆盖掉——评审请重点看这一条与 `referenced` 的交互）。

### 3.2 `services/provider/codex_direct.rs` — plan() 提供维护地址

`plan()` 为所有投影统一设置字段（官方直连/官方代理/第三方/BuiltIn/Default 都可能是在旧桶会话尚存时的当前投影）：

- `Target::Proxy`：`Some(base_url)`（与路由表地址同源）；
- 其余：`Some(configured_proxy_base_url(db))`（与 `Official { dormant_base_url }` :376 同一来源，含 port=0 回退默认端口的既有逻辑）。

`contract_of` 不读新字段——孪生维护只伴随有合法理由的写入发生，不单独触发写入；代理地址变化本身改变契约 `url` → 必触发重写 → 孪生同步更新，无滞后窗口（除 `maintain=None` 的理论路径外不存在"地址变了但没写"的分支，请评审复核 `get_proxy_listen_sync` 的取值路径）。

### 3.3 `services/proxy.rs` — 守卫改用共享形状函数（去重，行为不变）

`codex_has_mirror_proxy_shape`（:270-277）改为：selector 判定不变；四语义字段 + base_url 存在改调 `is_official_proxy_mirror_table`；其 `t.len() == 5` 与 URL 严格校验保留在守卫侧。**守卫行为零变化**（既有守卫测试与生成形状矩阵测试继续通过即为证）。这一步同时把 v4 §2.2 的"守卫与生成函数同步维护"从注释约定升级为同一函数。

### 3.4 与切片二新增守卫的关系

切片二守卫判定的是"live 是共享槽官方代理镜像"（新形态）；本切片的孪生表**就是**同一形态（`official_mirror_table(Some(url), false)`），因此：含孪生的 live 配置导入被拒、片段自动抽取跳过——语义正确（应用管理产物不导入为供应商），且无需任何守卫扩展。

## 4. 不变量（为何不触发既有反例）

1. **v3 §3.2 启动误检不回归**：孪生 = `official_mirror_table(Some(url), false)`，**无** `experimental_bearer_token` → `codex_live_has_proxy_placeholder` 不命中 → `is_codex_live_taken_over` 不因孪生变 true → startup 不会把含孪生的配置当旧版接管态改写。启动恢复编排（controller.rs:751 起）零改动。
2. **v2 反例不回归**：形状识别只发生在引擎自己的写入路径（write_route 对即将被本投影重写的文件做的事），不进入启动恢复、行污染判定（`usable_direct`/`config_has_proxy_placeholder`）或任何"凭形状获得改写授权"的路径。手工同形配置在启动时依旧不被认领。
3. **第三方保护**：孪生只触及保留 id `cc-switch-official`（应用自有命名空间，base 对它的既有处置是删除）；用户表、MCP、projects 零接触。
4. **契约与写入次序**：契约算法、发布/前滚、锁结构、`check_effective_route` 全部不动；孪生维护是同一次补丁发布的一部分，无新事务语义。
5. **`RESERVED_TABLE_IDS`（openai/ollama/lmstudio）零交互**：旧官方代理 id 不在其中，改名清扫不经过它。

## 5. 验收矩阵（每条 = 一个测试断言）

六维（对应 v4 §4.2 门控条件）：

| # | 维度 | 断言 | 测试位置 |
| --- | --- | --- | --- |
| 1 | 认证不混 | 孪生表无 `requires_openai_auth`、无 bearer 字段；旧会话经代理发送时认证由当前供应商行决定 | `codex_direct` 内联 |
| 2 | 地址跟随 | 改 listen address → 真实 resync → 双表 `base_url` 同步更新 | `controller` 内联 |
| 3 | 退出代理 | 统一开+代理 → 退出 → custom=直连镜像（无 base_url、ws on）且孪生仍在、地址已维护 | `controller` 内联 |
| 4 | 切第三方 | 官方→第三方→官方往返，孪生全程保留，第三方令牌与官方认证互不混入 | `controller` 内联（扩既有往返测试） |
| 5 | 关统一 | unify off + 代理 → 该槽位回到活跃 `OfficialProxy` 表，旧桶会话恢复/发送回到候选前行为 | `codex_direct` plan 形状 + `controller` 表内容 |
| 6 | 备份恢复 | 含旧契约的配置作为 pre-write → 投影后维护而非删除 | `codex_direct` 内联 render+apply |

回归与边界：

| # | 断言 | 位置 |
| --- | --- | --- |
| 7 | 未知内容同名表仍被清理（清理语义对认不出的内容不放宽） | `codex_direct` 内联 |
| 8 | profile 引用豁免：引用中的表既不清也不被维护写覆盖 | `codex_direct` 内联（扩既有测试） |
| 9 | 契约摘要不含孪生与新字段；同契约不触发写入 | `codex_direct` 内联（扩既有契约测试） |
| 10 | 启动无误检：孪生存在 + live-state=direct → startup 字节不变、不进 legacy 分支 | `controller` 内联（复用 manual_shape 骨架） |
| 11 | 孪生存在时导入拒绝、片段抽取跳过（守卫行为与镜像形态一致） | `proxy`/`controller` 内联（矩阵加孪生夹具） |
| 12 | 切片二既有 12 项测试 + 模块回归全绿 | 全量门 |
| 13 | 客户端级：合成旧桶会话 + 投影后双表配置 → `thread/resume` 成功 | 交付前实机门槛（复用 resume-check 方法），不入产品测试 |

## 6. 边界与诚实声明（本切片不解决的事）

1. **已清空旧表的存量设备**（如作者本机的 9 个归档会话）：保留逻辑只维护**已存在**的表，不能无中生有。这类设备的恢复路径 = 切片三迁移，或用户手动把官方供应商切到代理再切回（一次活跃投影写出真表/触发迁移语义）。本切片不伪装覆盖它们。
2. **孪生的最终清理**：本切片不自动清理（保留到切片三或永久存在）。用户手动删除后不再出现（只在已存在时维护）。
3. **降级**：降回 base 后，base 的 doomed 规则会把孪生清掉——回到 base 既有行为，如实写入发布说明。
4. **客户端可见性待实机确认**：孪生定义对客户端列表不可见（列表按会话标签过滤，已实证），但"定义存在"对客户端其他行为（如设置页展示）的影响列入交付前实机检查项。

## 7. 风险与请评审重点攻击的点

1. **维护写的覆盖面**：`maintain` 为 Some 时对所有投影生效（含第三方/BuiltIn/Default）——是否存在某条投影路径不该维护孪生？我的论证：孪生只服务于旧桶会话恢复，与当前投影是谁无关；若评审找到反例（如某路径写入时保留孪生会造成客户端错误行为），请指出。
2. **`referenced` 交互**：被 profile 引用的 `cc-switch-official` 表跳过维护写——但引用它的 profile 若被删除，下次投影恢复维护。请复核 `profile_selectors` 的读取时机与维护写的先后。
3. **形状宽松度**：引擎认领只查 4 语义字段 + base_url 非空（不查恰好五字段、不查 URL 形状）；守卫保持严格。不对称的理由见 §3.1（错误代价不同）。请评审判定该不对称是否会被未来维护者误解。
4. **`contract_of` 与孪生的时序**：孪生地址滞后仅在"契约不变但地址已变"时可能——我论证该路径不存在（url 在契约里）。请复核 `get_proxy_listen_sync` 与 `build_proxy_urls` 是否可能不同源。
5. **测试盲区**：`--features tauri/test` 的设置保存回滚测试与孪生的组合（发布失败 → 回滚 → 孪生处于中间态？）——发布是原子整体，孪生随补丁同生共死，理论上无中间态；建议评审要求补一条"发布失败后孪生与主表一致"的断言。

## 8. 交付形态与验证命令

- 单提交追加到 PR #7743：`fix(codex): keep the legacy official proxy route definition resumable`（标题可调）。PR 正文 ⛔ 第 1 条更新为"升级保留已实现，待客户端级验收"；机器人 P1 回复引用本计划。
- 估算规模：生产代码 ~50 行（3 文件）+ 测试 ~150 行。
- 验证命令沿用总计划 §8（1.95 工具链、`-j 2`、`CARGO_INCREMENTAL=0`），新测试过滤器 `codex_unified_proxy` + `proof_` 回归；格式/clippy(--lib)/全量库测试按既有门槛，基线失败对照沿用已记录清单（model_pricing×4 + skill×1 + 端口占用）。
- 交付前实机门槛：§5.13 的客户端恢复验证 + 官方发送验收（需用户重新登录 ChatGPT 与可用网络出口，与切片二遗留项合并执行）。
