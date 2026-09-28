const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const root = process.argv[2];
if (!root || !root.replaceAll("\\", "/").includes("/slice2-proof/"))
  throw Error("Use the isolated slice2-proof worktree only");
const base = "846de29c13ac4d65f164db8c15dd5fd58e29f972";
for (const [file, fixture, mode] of [
  [
    "src-tauri/src/services/provider/codex_direct.rs",
    "direct-tests.rs",
    "append",
  ],
  ["src-tauri/src/mode/controller.rs", "controller-tests.rs", "inside"],
]) {
  let text = cp.execFileSync("git", ["show", base + ":" + file], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10e6,
  });
  let tests = fs
    .readFileSync(path.join(__dirname, fixture), "utf8")
    .replaceAll(
      "crate::services::provider::live::import_default_config",
      "ProviderService::import_default_config",
    );
  if (fixture === "controller-tests.rs") {
    tests += fs.readFileSync(
      path.join(__dirname, "supplement-tests.rs"),
      "utf8",
    );
  }
  text =
    mode === "append"
      ? text + tests
      : text.slice(0, text.lastIndexOf("\n}")) +
        tests +
        text.slice(text.lastIndexOf("\n}"));
  fs.writeFileSync(path.join(root, file), text);
}
