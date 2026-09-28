const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const binary = process.argv[2];
const root = path.join(__dirname, "client-fixtures");
const fixtures = [
  ["11111111-1111-4111-8111-111111111111", "custom"],
  ["22222222-2222-4222-8222-222222222222", "openai"],
  ["33333333-3333-4333-8333-333333333333", "cc-switch-official"],
];
const configs = {
  shared_direct: `model_provider = "custom"\n[model_providers.custom]\nname = "OpenAI"\nwire_api = "responses"\nrequires_openai_auth = true\nsupports_websockets = true\n`,
  shared_proxy: `model_provider = "custom"\n[model_providers.custom]\nname = "OpenAI"\nwire_api = "responses"\nrequires_openai_auth = true\nsupports_websockets = false\nbase_url = "http://127.0.0.1:15721/v1"\n`,
  legacy_proxy: `model_provider = "cc-switch-official"\n[model_providers.cc-switch-official]\nname = "OpenAI"\nwire_api = "responses"\nrequires_openai_auth = true\nsupports_websockets = false\nbase_url = "http://127.0.0.1:15721/v1"\n`,
  native: "",
};
async function run(name, config) {
  const home = path.join(root, name);
  const sessions = path.join(home, "sessions", "2026", "09", "28");
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(
    path.join(home, "config.toml"),
    `model = "gpt-5.4"\ncli_auth_credentials_store = "file"\n` +
      config +
      "\n[analytics]\nenabled = false\n",
  );
  for (const [id, provider] of fixtures) {
    const timestamp = "2026-09-28T10:00:00.000Z";
    const rows = [
      {
        timestamp,
        type: "session_meta",
        payload: {
          id,
          timestamp,
          cwd: home,
          originator: "codex_cli_rs",
          cli_version: "0.158.0",
          source: "cli",
          model_provider: provider,
        },
      },
      {
        timestamp,
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Isolated history fixture; do not send.",
            },
          ],
        },
      },
      {
        timestamp,
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "Isolated history fixture; do not send.",
          images: [],
          local_images: [],
        },
      },
    ];
    fs.writeFileSync(
      path.join(sessions, `rollout-2026-09-28T10-00-00-${id}.jsonl`),
      rows.map((x) => JSON.stringify(x)).join("\n") + "\n",
    );
  }
  const child = spawn(binary, ["app-server", "--listen", "stdio://"], {
    cwd: home,
    env: { ...process.env, CODEX_HOME: home },
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let next = 1,
    buf = "",
    stderr = "";
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = next++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("timeout " + method));
      }, 25000);
      pending.set(id, (v) => {
        clearTimeout(timer);
        resolve(v);
      });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  child.stdout.on("data", (b) => {
    buf += b;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const v = JSON.parse(line);
        if (pending.has(v.id)) {
          pending.get(v.id)(v);
          pending.delete(v.id);
        }
      } catch {}
    }
  });
  child.stderr.on("data", (b) => {
    stderr += b;
  });
  try {
    const init = await request("initialize", {
      clientInfo: {
        name: "slice2_proof",
        title: "Isolated history proof",
        version: "1",
      },
      capabilities: { experimentalApi: true },
    });
    child.stdin.write(
      JSON.stringify({ method: "initialized", params: {} }) + "\n",
    );
    const normal = await request("thread/list", { limit: 100 });
    const all = await request("thread/list", {
      limit: 100,
      modelProviders: [],
    });
    const explicit = await request("thread/list", {
      limit: 100,
      modelProviders: ["custom"],
    });
    const read = await request("thread/read", {
      threadId: fixtures[0][0],
      includeTurns: true,
    });
    const resume = await request("thread/resume", { threadId: fixtures[0][0] });
    return { name, init, normal, all, explicit, read, resume };
  } finally {
    child.kill();
    fs.writeFileSync(path.join(home, "stderr.log"), stderr);
  }
}
(async () => {
  const out = [];
  for (const [n, c] of Object.entries(configs)) {
    try {
      out.push(await run(n, c));
    } catch (e) {
      out.push({ name: n, error: String(e) });
    }
    fs.writeFileSync(
      path.join(__dirname, "client-results.json"),
      JSON.stringify(out, null, 2),
    );
  }
  console.log(
    out.map((x) => ({
      name: x.name,
      error: x.error,
      normal: x.normal?.result?.data?.map((t) => [t.id, t.modelProvider]),
      all: x.all?.result?.data?.map((t) => [t.id, t.modelProvider]),
      readError: x.read?.error,
    })),
  );
})();
