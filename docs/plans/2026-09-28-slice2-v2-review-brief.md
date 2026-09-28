# Review Brief：切片二 v2 计划交接（供独立复审）

> 当前执行入口：`2026-09-29-slice2-v4-execution-addendum.md`（第四版执行补充）。本文保留历史分析；文案、补测结果和发布过渡约束以第四版为准。第三版原始证据保持不变。

> **已由第三版取代。** 下文保留为第二版审查输入，不再作为执行指令。当前决策见同目录 `2026-09-28-codex-history-repair-plan.md`（第三版修复计划）与 `2026-09-28-slice2-v3-technical-analysis.md`（技术分析）。复核已否定扩大通用接管识别的方案，并证实导入兜底、消费点数量及托管账号不受影响等旧判断不准确。

## 背景：为什么放弃上一个 PR

我们在修 cc-switch 的"统一会话历史"缺陷簇（#6340 显式官方路由无法统一、#5974 接管后历史列表缺半、#4710 完成标记与磁盘不一致、#7257 跨后端续聊）。第一份修复（PR #7728，切片一）在**旧架构**上做：`inject/strip_codex_unified_session_bucket` 文本级注入与剥离。落地当天上游合入 Codex **写引擎重构**（`0e6430ab` 等 22 提交）：路由改按供应商类别判定、统一历史成为原生路由模式 `RouteWrite::OfficialMirror`、快照式回填整体删除。旧 PR 的两侧载体都被结构性取代 → **已关闭（superseded）**。逐项核查确认：#6340 与回填污染已被上游修好；**接管分桶分裂与存量迁移缺陷仍开放**——这就是 v2 计划只做"切片二"的原因。

## 评审对象

- 计划：`docs/plans/2026-09-28-codex-history-repair-plan.md`（v2；**§4 切片二设计是本轮评审重心**，§5-§7 为后续切片可略读）。
- 基线：origin/main `846de29c`；工作树 `C:\Users\jzcan\.codex\worktrees\codex-history-repair\cc-switch`（分支 `verify/history-repair-on-new-engine`，已推 fork）。根因证据：同目录 `2026-09-28-codex-history-investigation.md`（调查报告，根因分析仍有效）。
- 一句话提案：统一开关开启时，官方代理路由新增 `RouteWrite::OfficialMirrorProxy { base_url }`——选路 `custom` + 带本地代理地址的官方镜像表，使接管会话与直连会话同桶；并为接管态检测增加新形态识别。

## 已完成的核查（不必重复，欢迎挑战）

1. §3 存亡核查表：每条都有 file:line 证据，经独立评审抽查属实。
2. 步 0（§4.2）：代理请求分派**纯状态驱动**（`handler_context.rs:110` → `mode/current.rs:76`；`src/proxy/` 对 `cc-switch-official` 零引用）→ 代理侧无需改动；`cc-switch-official` 全部 5 个消费点已清单化并逐点处置。
3. 一轮独立评审（结论"修改后进入"）已合入计划：Blocker = `is_codex_live_taken_over` 需为新形态补识别（三消费点）；Major = `contract_of` 非穷尽 match 需显式臂；doomed 清理的 profile 豁免等表述已修正。

## 请重点挑战的空白

1. **CLI 假设**：计划假设 Codex CLI 按 `model_provider` id 给会话分桶、与表形态（有无 base_url / WS）无关——仓库代码无法证明，是整个方案的根基。
2. **新形态识别的误判面**：`codex_config.rs` 拟新增"custom 槽官方镜像表 + base_url 指向本地代理端口"的接管识别——用户手工写出同形态配置时会不会误伤？
3. **契约 digest 语义**：`contract_of` 新臂对 `mode/controller.rs` 的"digest 相同跳过重写"路径有无隐性影响。
4. **备选方案裁决**：§4.3 否定了"保留 `cc-switch-official` 独立桶、只扩迁移源"——这个更小切口的否定理由是否站得住？

## 纪律

只读评审（可 rg/git show/sed，不构建不改文件）。结论按"正确性 / 修复质量 / 对原项目尊重度"三维度给 verdict + file:line findings；若推翻计划，给出替代切口。产出直接作为最终消息返回。
