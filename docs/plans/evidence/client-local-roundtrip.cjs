// Isolated client smoke test: fake credentials and a loopback-only Responses fixture.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const binary = process.argv[2];
const home = path.resolve(process.argv[3]);
fs.mkdirSync(home, { recursive: true });
let requests = 0;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (b) => (body += b));
  req.on("end", () => {
    if (!req.url.endsWith("/responses")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ data: [] }));
    }
    requests++;
    const message = {
      id: "msg_test",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [
        { type: "output_text", text: "Local fixture reply.", annotations: [] },
      ],
    };
    const response = {
      id: "resp_test",
      object: "response",
      created_at: 1,
      status: "completed",
      model: "gpt-5.4",
      output: [message],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    };
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    for (const event of [
      {
        type: "response.created",
        response: { ...response, status: "in_progress", output: [] },
      },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { ...message, status: "in_progress", content: [] },
      },
      {
        type: "response.content_part.added",
        item_id: message.id,
        output_index: 0,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [] },
      },
      {
        type: "response.output_text.delta",
        item_id: message.id,
        output_index: 0,
        content_index: 0,
        delta: "Local fixture reply.",
      },
      {
        type: "response.output_text.done",
        item_id: message.id,
        output_index: 0,
        content_index: 0,
        text: "Local fixture reply.",
      },
      {
        type: "response.content_part.done",
        item_id: message.id,
        output_index: 0,
        content_index: 0,
        part: message.content[0],
      },
      { type: "response.output_item.done", output_index: 0, item: message },
      { type: "response.completed", response },
    ])
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  });
});
(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  fs.writeFileSync(
    path.join(home, "config.toml"),
    `model = "gpt-5.4"\nmodel_provider = "custom"\ncli_auth_credentials_store = "file"\n[model_providers.custom]\nname = "OpenAI"\nwire_api = "responses"\nrequires_openai_auth = true\nsupports_websockets = false\nbase_url = "http://127.0.0.1:${port}/v1"\n[analytics]\nenabled = false\n`,
  );
  fs.writeFileSync(
    path.join(home, "auth.json"),
    JSON.stringify({ OPENAI_API_KEY: "isolated-test-key" }),
  );
  const child = spawn(binary, ["app-server", "--listen", "stdio://"], {
    cwd: home,
    env: {
      ...process.env,
      CODEX_HOME: home,
      OPENAI_API_KEY: "isolated-test-key",
    },
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let sequence = 0,
    buffer = "",
    stderr = "";
  const pending = new Map(),
    events = [];
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("timeout: " + method));
      }, 20000);
      pending.set(id, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  let finish;
  const completed = new Promise((resolve) => (finish = resolve));
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      try {
        const value = JSON.parse(line);
        if (pending.has(value.id)) {
          pending.get(value.id)(value);
          pending.delete(value.id);
        } else if (value.method) {
          events.push(value);
          if (value.method === "turn/completed") finish(value);
        }
      } catch {
        /* Non-protocol stdout is ignored. */
      }
    }
  });
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const result = {};
  try {
    result.initialize = await request("initialize", {
      clientInfo: { name: "isolated_roundtrip", version: "1" },
      capabilities: { experimentalApi: true },
    });
    child.stdin.write(
      JSON.stringify({ method: "initialized", params: {} }) + "\n",
    );
    result.start = await request("thread/start", { ephemeral: false });
    const id = result.start.result?.thread?.id;
    if (!id) throw Error(JSON.stringify(result.start));
    result.turn = await request("turn/start", {
      threadId: id,
      input: [
        {
          type: "text",
          text: "Reply with the local fixture.",
          text_elements: [],
        },
      ],
    });
    let timer;
    result.completed = await Promise.race([
      completed,
      new Promise(
        (resolve) =>
          (timer = setTimeout(() => resolve({ timeout: true }), 25000)),
      ),
    ]);
    clearTimeout(timer);
    result.resume = await request("thread/resume", { threadId: id });
    result.requests = requests;
    result.eventMethods = events.map((event) => event.method);
  } catch (error) {
    result.error = String(error);
  } finally {
    child.kill();
    await new Promise((resolve) =>
      child.exitCode !== null ? resolve() : child.once("exit", resolve),
    );
    server.close();
    fs.writeFileSync(path.join(home, "stderr.log"), stderr);
    fs.writeFileSync(
      path.join(home, "result.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(
      JSON.stringify({
        requests,
        completed: result.completed,
        error: result.error,
        resumeError: result.resume?.error,
      }),
    );
  }
})();
