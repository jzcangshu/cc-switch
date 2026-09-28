const fs = require("node:fs");
const cp = require("node:child_process");
const path = require("node:path");
const root = process.argv[2],
  stage = process.argv[3];
if (!root?.replaceAll("\\", "/").includes("/slice2-proof/"))
  throw Error("scratch worktree required");
const original = (file) =>
  cp.execFileSync(
    "git",
    ["show", "846de29c13ac4d65f164db8c15dd5fd58e29f972:" + file],
    { cwd: root, encoding: "utf8", maxBuffer: 10e6 },
  );
function edit(file, fn) {
  fs.writeFileSync(path.join(root, file), fn(original(file)));
}
// Start by restoring the baseline and appending the exact same proof tests.
cp.execFileSync(process.execPath, [path.join(__dirname, "prepare.cjs"), root]);
for (const f of [
  "src-tauri/src/services/proxy.rs",
  "src-tauri/src/services/provider/live.rs",
  "src-tauri/src/lib.rs",
])
  edit(f, (x) => x);
if (stage === "candidate") {
  const f = path.join(root, "src-tauri/src/services/provider/codex_direct.rs");
  let s = fs.readFileSync(f, "utf8");
  s = s.replace(
    "RouteWrite::OfficialProxy(official_mirror_table(Some(base_url), false)),",
    `if crate::settings::unify_codex_session_history() {
                        RouteWrite::Custom(official_mirror_table(Some(base_url), false))
                    } else {
                        RouteWrite::OfficialProxy(official_mirror_table(Some(base_url), false))
                    },`,
  );
  fs.writeFileSync(f, s);
  const helper = `
    /// Conservative read-only guard. This is NOT authority to rewrite live or reject a stored row.
    pub(crate) fn live_has_proxy_import_risk(&self, app: &AppType) -> bool {
        if !matches!(app, AppType::Codex) { return self.live_has_proxy_placeholder(app); }
        self.read_codex_live().is_ok_and(|config| {
            Self::is_codex_live_taken_over(&config) || Self::codex_has_mirror_proxy_shape(&config)
        })
    }
    // Keep this exact shape in sync with official_mirror_table; the generated-shape import test
    // must fail if that writer changes. This is an import risk check, not ownership evidence.
    fn codex_has_mirror_proxy_shape(config: &Value) -> bool {
        let Some(doc) = config.get("config").and_then(Value::as_str)
            .and_then(|text| text.parse::<toml_edit::DocumentMut>().ok()) else { return false; };
        if doc.get("model_provider").and_then(toml_edit::Item::as_str) != Some("custom") { return false; }
        let Some(t) = doc.get("model_providers").and_then(toml_edit::Item::as_table_like)
            .and_then(|p| p.get("custom")).and_then(toml_edit::Item::as_table_like) else { return false; };
        t.len() == 5 && t.get("name").and_then(toml_edit::Item::as_str) == Some("OpenAI")
            && t.get("wire_api").and_then(toml_edit::Item::as_str) == Some("responses")
            && t.get("requires_openai_auth").and_then(toml_edit::Item::as_bool) == Some(true)
            && t.get("supports_websockets").and_then(toml_edit::Item::as_bool) == Some(false)
            && t.get("base_url").and_then(toml_edit::Item::as_str)
                .and_then(|s| url::Url::parse(s).ok()).is_some_and(|u|
                    u.scheme() == "http" && u.host_str().is_some() && u.port_or_known_default().is_some()
                    && u.path() == "/v1" && u.username().is_empty() && u.password().is_none()
                    && u.query().is_none() && u.fragment().is_none())
    }
`;
  edit("src-tauri/src/services/proxy.rs", (s) =>
    s.replace(
      "    fn is_codex_live_taken_over(config: &Value) -> bool {",
      helper + "\n    fn is_codex_live_taken_over(config: &Value) -> bool {",
    ),
  );
  for (const f of [
    "src-tauri/src/services/provider/live.rs",
    "src-tauri/src/lib.rs",
  ])
    edit(f, (s) =>
      s.replaceAll(
        ".live_has_proxy_placeholder(&app_type)",
        ".live_has_proxy_import_risk(&app_type)",
      ),
    );
  const importFile = path.join(root, "src-tauri/src/services/provider/live.rs");
  fs.writeFileSync(
    importFile,
    fs
      .readFileSync(importFile, "utf8")
      .replace(
        "Live 配置当前处于代理接管状态（包含占位符），不能导入为供应商。请先关闭代理接管或恢复 Live 配置后重试。",
        "当前配置包含代理占位符，或与代理投影形态相同，无法安全导入为供应商。请检查并恢复实际配置后重试。",
      )
      .replace(
        "The live config is currently taken over by the proxy (contains placeholders) and cannot be imported as a provider. Disable proxy takeover or restore the live config first.",
        "The current config contains proxy placeholders or matches a proxy projection, so it cannot be safely imported as a provider. Check and restore the intended configuration before retrying.",
      ),
  );
} else if (stage === "broad") {
  edit("src-tauri/src/services/proxy.rs", (s) =>
    s.replace(
      "        Self::codex_live_has_proxy_placeholder(config)",
      `        config.get("config").and_then(Value::as_str).is_some_and(|text| {
            let Ok(d) = text.parse::<toml::Table>() else { return false; };
            d.get("model_provider").and_then(toml::Value::as_str) == Some("custom")
                && d.get("model_providers").and_then(|v| v.get("custom")).is_some_and(|t|
                    t.get("name").and_then(toml::Value::as_str) == Some("OpenAI")
                    && t.get("requires_openai_auth").and_then(toml::Value::as_bool) == Some(true)
                    && t.get("supports_websockets").and_then(toml::Value::as_bool) == Some(false)
                    && t.get("wire_api").and_then(toml::Value::as_str) == Some("responses")
                    && t.get("base_url").and_then(toml::Value::as_str) == Some("http://127.0.0.1:15721/v1"))
        }) || Self::codex_live_has_proxy_placeholder(config)`,
    ),
  );
}
console.log(stage);
