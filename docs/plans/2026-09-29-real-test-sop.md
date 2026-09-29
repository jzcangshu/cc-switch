# Codex 真实数据测试 SOP（切片二/2.5 通用，含避坑清单）

> **适用范围**：对 cc-switch Codex 统一会话历史切片（候选 `2049cf45` 及其后继，含切片 2.5 孪生保留）做真实数据测试的**操作规程**。由 2026-09-29 的完整实测复盘整理——所有坑都是当次真实踩过的，不是理论清单。
> **给后来的 Agent**：先通读 §9 避坑清单再动手；本文假设你在一台 Windows 机器上、用户授权你操作其真实 Codex 数据（含真实发送），且已确认 cc-switch 与 Codex 均未运行。
> 业务背景：PR #7743；测试结果样例见该 PR 评论 issuecomment-5882801136。

## 0. 角色与边界（先说清什么不能做）

1. **真实发送只在真实主目录做**。副本里的 `auth.json` 是真实凭据的拷贝，用它发送会与真实目录产生 refresh token 轮换竞争，可能弄坏用户正在用的登录——**绝对禁止**。副本阶段只做恢复/列表类无凭据操作。
2. **不用副本目录兼作备份**。候选应用一旦在副本上运行，副本里的 `config.toml`/`settings.json`/DB 就被污染，不再是无尘还原点。要么建两份副本（一份测试一份封存），要么测试副本与还原点分离（本次教训：备份被污染后只能靠供应商行 SSOT 重建配置）。
3. **环境变量必须与进程启动同一条命令设置**。`Start-Process` 只继承当前 shell 的环境——上一次调用的 `export` 不存在。曾因漏设导致候选以真实主目录运行（见坑 #1）。
4. **单实例保护是硬门槛**：真实 cc-switch 不退出，候选进程起来后会把启动交给旧实例（`tauri_plugin_single_instance`）。启动前用 `Get-Process -Name 'cc-switch','CC Switch','ccswitch'` 检查；检查输出不要用 `head` 截断——曾因输出截断误判进程已死。
5. **不动用户近期会话**：只新建会话 + 使用**很旧**的会话；归档旧会话测试后要重新归档（`codex archive`）。

## 1. 工具与产物准备

| 产物 | 路径 | 说明 |
| --- | --- | --- |
| 候选 exe | `D:\cc-switch\.tmp-cluster\cc-hr-target-v3\debug\cc-switch.exe` | `pnpm run build:renderer` + `pnpm exec tauri build --debug --no-bundle`（工作树内），产物在共享 target 的 debug 下 |
| 副本创建脚本 | `D:\cc-switch\.tmp-cluster\real-test-prep\1-prepare-test-copy.ps1` | robocopy /XJ、改写副本内 8 个 `*_config_dir`、泄漏终检、无 BOM 写回 |
| 隔离启动脚本 | `D:\cc-switch\.tmp-cluster\real-test-prep\2-start-candidate.ps1 -Root <副本>` | 校验 IS-TEST-COPY 标记、拒绝真实目录、单实例检查、设两个环境变量后启动 |
| 恢复检查脚本 | `D:\cc-switch\.tmp-cluster\real-test-prep\resume-check.cjs` | app-server stdio：`thread/list`（默认+不限制）+ 逐 id `thread/resume` |
| Codex 客户端 | `C:\Users\<你>\AppData\Local\OpenAI\Codex\bin\faa963e871dd422c\codex.exe` | **用用户日常版本**（看最近 rollout 的 `cli_version` 字段确认；PATH 上的 `bin\codex.exe` 可能是旧版） |

构建前置：工作树需 `pnpm install`；`pnpm tauri dev` 可替代 exe 但同样受单实例约束。

## 2. 备份与还原点

```powershell
powershell -ExecutionPolicy Bypass -File D:\cc-switch\.tmp-cluster\real-test-prep\1-prepare-test-copy.ps1
```

- 脚本强制要求 cc-switch 已退出；对运行中的 Codex 仅告警（复制期间运行会导致会话文件不一致）。
- **立即记录初始指纹**（还原与"被动过没"的判据）：
  `sha256sum ~/.codex/config.toml ~/.codex/auth.json ~/.cc-switch/settings.json ~/.cc-switch/cc-switch.db`
- 注意脚本会改写副本 settings.json 中的 `*_config_dir`——**副本从此不是原始备份**（见 §9 坑 #2）。

## 3. 基线检查（候选运行前，全部零风险）

1. **会话标签分布**：对每个 rollout 文件取**第一行** `session_meta` 的 `model_provider`（`head -1 | grep -o '"model_provider":"[^"]*"'`），`sort | uniq -c`。
   ⚠️ 坑 #6：**不要**对全文件做裸字符串 grep 统计——用户与 Agent 讨论过这些 id，对话文本里全是假阳性（本次 35 处匹配里只有 9 个是真会话）。
2. **旧桶会话定位**：真会话在 `archived_sessions/`；直接 resume 会先撞 "session is archived" → `codex unarchive <id>`（可逆，测完 `codex archive` 还原）。unarchive 后再 resume，得到真正的存量基线（当时：`Model provider 'cc-switch-official' not found`，候选之前已断）。
3. **正控**：恢复一个旧的 `custom` 会话，必须成功——失败说明测试环境本身有问题，先停。

## 4. 副本阶段（候选端到端，无凭据操作）

**状态安排**（对副本的 DB/settings 直改，应用未运行时）：

```sql
UPDATE providers SET is_current=0 WHERE app_type='codex';
UPDATE providers SET is_current=1 WHERE id='<官方行id>' AND app_type='codex';
INSERT OR REPLACE INTO proxy_config (app_type, enabled, auto_failover_enabled) VALUES ('codex', 1, 0);
```

settings.json 加 `"unifyCodexSessionHistory": true`（**camelCase**，见坑 #7）。注意官方行 meta 里的 `authBinding`（注意 JSON 键是驼峰）：托管绑定会在 attach 时触发 OAuth 刷新，token 已死的账号直接失败退回直连——测试期临时 `pop('authBinding')`，用 `backups/db_backup_*.db` 里的原值还原，并用日志里的账号 id 交叉核对。

**每次启动前必做**（见坑 #3、#8）：删副本的 `.cc-switch/live-state.json`；重插 `proxy_config`（attach 失败会把它同步回 0）。

启动后校验顺序：配置文件选择器/表形态 → 15721 监听（`netstat`）→ 日志无"退回直连" → resume-check（旧 custom 会话必须成功 = 历史连续性正控）。

**切片 2.5 新增验收**（v3 落地后）：
- 变体 A（升级模拟）：副本 config 预置旧 `cc-switch-official` 表（标准契约或改名变体）→ 统一开 + 官方代理 ATTACH → 断言**双表并存**（custom 镜像 + `cc-switch-official` 休眠镜像、地址已维护）→ **旧桶会话 resume 成功**（这是阻断 1 解除的直接证据）。
- 变体 B（已清空设备）：无旧表 → 断言**不无中生有** → 旧桶会话仍阻断（属切片三，如实记录）。

## 5. 真实发送阶段（真实主目录）

**场景矩阵与当次实测结果**：

| 场景 | 状态安排 | 当次结果 |
| --- | --- | --- |
| 官方代理+统一开（③） | 官方行 current + 代理开 + 统一开 | 链路✓（代理日志 `Provider: OpenAI Official → chatgpt.com`）；发送被 OpenAI WAF 403 拦（VPN 出口 IP，环境问题）；新会话落 custom ✓；auth.json 未动 ✓ |
| 第三方（④） | 还原原始配置 + 快跑行 current | **成功**（"OK"，5713 tokens）；新会话落 custom；恢复✓ |
| 官方直连 统一关/开（①②） | — | 发送同样被 WAF 拦；形态由单元测试覆盖，未在真实目录强求 |

**发送命令**（cwd 用临时目录）：

```sh
codex exec --skip-git-repo-check [-c model="<该路径可用的模型名>"] "只回复OK,不要执行任何工具"
```

- 模型名按路径选：官方路径用历史官方会话里的模型（当次 `gpt-5.6-terra`），中转路径用行里配置的模型（`gpt-6-astra`）。
- 输出里的 `rmcp ... 403` 与 `unrecognized configuration setting` 是用户 MCP/配置噪音，与发送成败无关；看末尾的回复与 `tokens used`。

**每场景记录**（脱敏）：客户端版本 / 候选提交 / 统一历史 / 代理 / 选择器 / 新会话 id / 发送成败 / 恢复成败 / 旧会话恢复 / 错误原文。

## 6. 还原与验证

1. 杀掉所有本次启动的 cc-switch 进程（`taskkill /PID <pid> /T /F`）。
2. `config.toml` 从**无尘还原点**恢复并比对哈希。⚠️ 若还原点已污染（坑 #2）：用当前供应商行的 `settings_config.config`（SSOT，含头部与表）+ 行 auth 里的 token 行 + MCP 段重建——语义等价，不宣称字节级一致。
3. DB 还原：`is_current` 回原值、`meta.authBinding` 回填（从 `backups/db_backup_*.db` 取原值）、`proxy_config` 回原值。⚠️ 坑 #10：改 DB 前确认连接的是**真实库**路径——本次曾把还原写进副本库。
4. `settings.json`：核对语义（unify 等键是否用户自设、迁移标记的 configDir 是否指向真实目录），不盲目用副本的覆盖。
5. `auth.json`：逐阶段比对哈希。**全程未变 → 无事**；若某阶段变了（合法刷新），保留新文件并在报告写明——把过期备份盖回去会让用户登录失效。
6. 测试用的归档会话 `codex archive` 还原；新建的测试会话保留（用户已同意）。

## 7. 结果回填

PR 评论（草稿 PR 上直接评），结构照 issuecomment-5882801136：环境 → 用户数据实况 → 结果矩阵 → 关键证据（代理日志行、auth 哈希不变、新会话标签）→ 遗留与边界。发送失败要区分"环境阻断（WAF）"与"代码缺陷"，给出错误原文。

## 8. 停止条件（任一出现立即停并保留现场）

真实配置被写回原用户目录之外的位置；官方请求用了第三方令牌；第三方请求用了官方认证；关闭统一后配置未回到预期旧形态；认证文件出现无法解释的变化。

## 9. 避坑清单（按踩坑顺序编号）

| # | 现象 | 根因 | 对策 |
| --- | --- | --- | --- |
| 1 | 候选在真实主目录跑了几分钟才发现 | `Start-Process` 前没在同一条命令里设环境变量 | 环境变量与启动**同命令**；启动后立刻验证"配置目录=副本" |
| 2 | 原始 config 无尘备份丢失 | 测试副本兼作还原点，被副本阶段候选重写 | 两份副本分离，或 SSOT 重建兜底（§6.2） |
| 3 | 重启后配置不被重写 | `live-state.json` 持久化 mode=direct，startup 看到 Direct 就跳过重写 | 每次启动前删 live-state.json |
| 4 | attach 总是失败退回直连 | 官方行的托管 OAuth 绑定 + Refresh Token 已失效 | 测试期剥离 `meta.authBinding`，用 db_backup 还原 |
| 5 | 代理开关自己变回 0 | attach 失败 `exit_locked` 会同步关闭开关 | 每次启动前重插 `proxy_config` |
| 6 | 会话标签统计全是假阳性 | 裸字符串 grep 命中对话文本 | 只认第一行 session_meta |
| 7 | 设置键 grep 不命中 | settings.json 是 **camelCase**（`unifyCodexSessionHistory`） | 用 JSON 解析读值，别用 snake_case grep |
| 8 | 复制 .codex 中途中止 | 插件缓存里有损坏 junction，`Copy-Item -Recurse` 会炸 | 用 `robocopy /E /XJ` |
| 9 | 进程"已死"误判 | `Get-Process` 输出被管道 `head` 截断 | 检查进程用完整输出或计数判断 |
| 10 | 还原写错库 | 副本库与真实库路径只差一层目录 | DB 连接串写绝对路径后先 `PRAGMA database_list` 核对 |
| 11 | settings.json 写回后应用拒读 | PowerShell `Set-Content -Encoding UTF8` 带 BOM，serde_json 拒绝 | `[IO.File]::WriteAllText($p, $t, UTF8Encoding($false))` |
| 12 | 官方发送 403 | OpenAI 边缘 WAF 拦 VPN 出口 IP（含换出口后仍拦） | 环境问题如实记录；别归因代码；中转路径可验证发送链 |
| 13 | 直接 resume 旧会话报 archived | 旧桶会话在归档区 | `codex unarchive` → 测 → `codex archive` 还原 |
| 14 | 直连模式想重写配置但不生效 | live-state 缺失时 startup 推断"live 已是直连"跳过写入 | 直连形态无法仅靠启动物化——需要代理路径往返或设置保存入口；不要硬凑 |
| 15 | auth.json 差点被过期备份覆盖 | 合法 token 刷新发生在测试期间 | 还原前比对哈希；变了就保留新文件并报告 |
