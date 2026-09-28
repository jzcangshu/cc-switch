# 合并请求草稿（本地审查，未发布）

标题：`fix(codex): keep official proxy sessions in the unified bucket`（官方代理会话保持在统一桶）。

基线：`846de29c13ac4d65f164db8c15dd5fd58e29f972`。
分支：`codex/keep-official-proxy-history-unified`（官方代理保持共享历史）。
提交：`2049cf45db086467b5d8c4afa6f4416ac96402ac`（单一产品修复提交）。
状态：待用户审查；旧会话过渡未解决，不能发布。检查结果以下方证据为准，不宣称全绿。

---

## 问题与根因 / Problem and root cause

开启统一历史后，官方直连把新会话写入共享标识，但官方代理仍写入旧官方代理标识。因此从直连切到代理会继续产生分开的历史桶。

根因位于 `src-tauri/src/services/provider/codex_direct.rs` 的官方代理规划分支：它始终使用旧官方代理路由，没有读取统一历史设置。既有写引擎已经支持共享槽，官方代理镜像也已经具备正确的官方认证字段，无需新建路由变体或修改认证流程。

With unified history enabled, official direct sessions use the shared provider ID, while official proxy sessions still use the legacy proxy ID. The official proxy planning branch unconditionally chooses the legacy route. Reuse the existing shared-slot route when unification is enabled, retaining the existing official mirror and authentication target.

英文段落中文解释：官方代理分支未读取统一开关；修复只选择已有共享路由，保持镜像表与官方认证目标。

## 修改边界 / Scope

- 官方代理只在统一开启时写入共享标识，关闭时保持旧标识；继续使用原官方认证目标与空认证标记。
- `src-tauri/src/services/proxy.rs` 新增专用于读入的严格形状检查；只有供应商导入和启动通用片段初始化调用它。没有占位符的官方共享代理镜像也不能被存为直连配置。
- 导入错误保留原键，文案明确“包含占位符，或与代理投影形态相同”，不把手工同形配置断言为已接管。
- 为标准测试构建增加桌面框架开发依赖测试特性；锁定版本不变。

The new read-side guard is limited to provider import and automatic snippet initialization. It is deliberately not used as ownership evidence for recovery or stored-row validation. Standard test builds enable Tauri's test helpers through a development dependency, without changing the locked version.

英文段落中文解释：新守卫只防读入污染，不扩大恢复或数据库行判定权限；测试支持通过开发依赖自动启用。

## 保持不变与行为说明 / Preserved behavior

- 官方普通登录、托管账号、第三方凭据及请求转发规则不变。
- 手工同形配置不会因新守卫被启动过程认领，数据库行不会被新守卫判为污染。
- 写引擎清理、休眠表、配置档覆盖拒绝、切换锁、提交及恢复次序不变。
- 形状完全相同的远端手工配置也会保守拒绝导入；这是误拒绝边界，不是所有权判定。
- 对风险形态，启动自动初始化跳过整次片段提取，包括安全非路由字段；抽取函数本身和已有片段不变。

Authentication, request routing, writer cleanup, dormant tables, profile checks and recovery ordering are unchanged. A matching hand-written remote table is conservatively rejected on import. Automatic snippet initialization skips the whole matching config; it does not erase an existing snippet or change the extractor itself.

英文段落中文解释：所有认证、路由与写引擎不变量保持；明确远端同形拒绝和整次自动片段跳过的行为变化。

## 发布依赖 / Release dependency

旧代理定义被既有清理规则移除后，未迁移的旧代理会话可能仍能在全量列表中看到，却无法恢复。已用同目录升级形态实验复现。迁移未选择、等待、失败、部分成功均需要独立过渡保障；不能强制迁移，也不能靠全局固定别名掩盖。此补丁不修改清理或迁移主逻辑，因此目前只供审查，不能作为独立可发布修复。

This draft is not release-ready. Existing cleanup removes the legacy provider definition; unmigrated legacy sessions can then fail to resume. A separately validated transition must cover migration declined, pending, failed and partially completed states. This patch does not broaden cleanup or force history migration.

英文段落中文解释：旧会话兼容仍阻断发布，必须独立验证各种迁移状态，本补丁不强行解决其他层的问题。

## 验证 / Validation

| 检查           | 结果                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| 新增内联回归   | 12 通过；原基线对应场景 2 通过、8 预期失败                                                            |
| 后端格式       | 通过                                                                                                  |
| 全目标静态检查 | 未通过；基线及候选均在未改请求转换测试的引用比较处报告同一警告                                        |
| 后端全部目标   | 3079 通过、1 端口占用失败、10 忽略；174 项集成测试全部通过                                            |
| 前端类型与格式 | 通过                                                                                                  |
| 前端全量       | 1654 通过、5 失败；涉及的两个文件在基线和候选分别单独运行均为 56 通过                                 |
| 真实客户端协议 | 桌面内置 0.158.0-alpha.2.1 与命令行 0.140.0，在隔离目录完成本地模拟响应一轮及恢复；未发送真实模型请求 |

Twelve regression tests pass. Full backend execution reports 3,079 passed, one occupied-port failure and ten ignored; all 174 integration tests pass. Clippy reports the same unchanged-code warning on the baseline and candidate. Frontend type and formatting checks pass; the full frontend run has five failures, while the affected files pass in isolation on both revisions. These results are evidence for review, not a claim that all release gates pass.

英文段落中文解释：新增测试与集成测试通过，但静态检查、后端端口冲突和前端全量不稳定仍保留为未通过门槛，不用局部通过替代全量结果。

本地模拟服务只验证客户端接受官方共享镜像、发送与恢复的协议行为，不是生产代理真实账号端到端验收。真实账号发送、全部模式的运行中热切换和旧会话发布过渡仍未完成，不应将此草稿直接转为可发布合并请求。

变更覆盖 8 个文件：4 个生产调用/规划文件、2 个仅注释更新文件、1 个仅测试控制器文件及测试依赖配置。新增行主要是内联回归；没有引入生产路由变体、泛化抽象或锁/恢复主流程改造。

议题：关联 #5974；不使用自动关闭指令，因为存量历史与发布过渡尚未完成，也不关闭 #4710 或 #7257。
