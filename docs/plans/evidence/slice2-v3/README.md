# 第三版切片二诊断证据

本目录保存可重建的诊断代码、关键原始失败日志、最终专用测试日志和客户端结果摘要。它不是准备合并的产品补丁。

## 1. 文件用途

- `prepare.cjs`（基线诊断准备脚本）：从固定提交恢复两个测试目标文件，在完整仓库中追加内联诊断。
- `stage.cjs`（对照阶段脚本）：选择基线、扩大通用检测的反例、最小候选三种状态。仅允许用于名称包含隔离证据工作树的目录，会重写五个指定实验文件，不能对有待保留修改的目录运行。
- `direct-tests.rs`（投影与契约诊断）、`controller-tests.rs`（导入、启动、重同步和恢复诊断）：调用原仓库业务函数，不替换业务算法。
- `client-proof.cjs`（客户端隔离测试）：独立配置目录、三条合成历史，调用初始化、列表、读取和恢复；不发送模型请求。
- `manifest.json`（证据清单）：固定提交、客户端版本及文件摘要。摘要按打包前的原始字节记录。
- `client-summary.json`（客户端结果摘要）：四种配置的列表及恢复结果。
- `results.md`（验证记录）：结果、重叠范围、环境失败和未完成验证。

基线日志来自首次较小的诊断集。后来补充了地址矩阵、片段抽取、托管认证、开关反向切换和发布后故障。当前脚本包含最终诊断集，因此重新运行基线会产生更多预期失败，不能机械要求失败数量等于首次日志。

## 2. 重建仓库测试

用应用工作树工具从证据清单的固定提交创建或复用 `slice2-proof`（隔离证据工作树）。当前已存在：

`C:/Users/jzcan/.codex/worktrees/slice2-proof/cc-switch`（隔离源码目录）。

下列命令在该隔离目录执行；每步确认退出码。候选为成功预期，基线和扩大识别的反例包含故意失败的需求断言。脚本不会删除文件；源码写入引擎及原仓库测试自身可能按各自实现清理内部临时文件。合成夹具由专用诊断保留。

```powershell
$proofEvidence = 'C:/Users/jzcan/.codex/worktrees/codex-history-repair/cc-switch/docs/plans/evidence/slice2-v3'
$proofCheckout = 'C:/Users/jzcan/.codex/worktrees/slice2-proof/cc-switch'
$env:RUSTUP_HOME = 'D:/cc-switch/.tmp-cluster/rustup-1.95'
$env:CARGO_TARGET_DIR = 'D:/cc-switch/.tmp-cluster/cc-hr-target-v3'
$env:CARGO_INCREMENTAL = '0'
$env:CC_SWITCH_TEST_HOME = 'D:/cc-switch/.tmp-cluster/slice2-v3-proof/replay-home'
$env:SLICE2_PROOF_ROOT = 'D:/cc-switch/.tmp-cluster/slice2-v3-proof/replay-fixtures'
$env:SLICE2_STAGE = 'candidate'
node "$proofEvidence/stage.cjs" $proofCheckout candidate
cargo test --locked --offline -j 2 --manifest-path "$proofCheckout/src-tauri/Cargo.toml" --lib proof_ -- --test-threads=1 --skip proof_import_baseline --skip failed_append_prefix_proof
```

将阶段参数和对应环境标记改为 `baseline`（原实现）可验证未实现需求。改为 `broad`（扩大通用识别），仅运行 `proof_manual`（手工配置保护测试过滤词），两项应失败。不要在编译仍运行时切换阶段。

后台测试输出包含一个原有的、名称碰巧带诊断过滤词的测试，因此最终命令明确跳过它；同时跳过仅用于首次基线特征确认的导入成功断言。最终专用集为 12 项。

## 3. 客户端复核

```powershell
node "$proofEvidence/client-proof.cjs" 'C:/Users/jzcan/AppData/Local/OpenAI/Codex/bin/faa963e871dd422c/codex.exe'
```

客户端路径会随应用升级变化。先核对版本和摘要；使用不同版本必须在结果中注明。脚本在自身旁创建隔离客户端目录和原始结果，不读真实认证文件。原始实验在本机证据目录运行，提交的摘要不包含用户历史。

## 4. 保留与清理

完整本机材料位于 `D:/cc-switch/.tmp-cluster/slice2-v3-proof`（诊断目录）；编译缓存位于 `D:/cc-switch/.tmp-cluster/cc-hr-target-v3`（已有共享缓存）。本轮没有主动删除这些目录，也没有归档实验工作树。确认不再需要后由用户处理；共享编译缓存可能仍供其他工作使用。
