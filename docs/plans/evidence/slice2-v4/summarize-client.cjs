// Summarize only isolated fixtures; never copy full client session instructions.
const fs = require("node:fs");
const path = require("node:path");
const output = path.resolve(process.argv[2]);
const data = JSON.parse(
  fs.readFileSync(path.join(output, "client-results.json"), "utf8"),
);
const results = data.map((x) => {
  const file = x.created?.result?.thread?.path;
  if (file && !path.resolve(file).startsWith(output + path.sep)) {
    throw new Error("Created session must remain inside isolated output");
  }
  const first =
    file && fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, "utf8").split("\n")[0])
      : null;
  const list = (value) =>
    value?.result?.data?.map((t) => ({ id: t.id, provider: t.modelProvider }));
  return {
    name: x.name,
    defaultList: list(x.normal),
    allList: list(x.all),
    legacyResume: x.legacyResume?.error || {
      provider: x.legacyResume?.result?.thread?.modelProvider,
    },
    created: {
      id: x.created?.result?.thread?.id,
      provider: x.created?.result?.thread?.modelProvider,
      persisted: !!first,
      persistedProvider: first?.payload?.model_provider,
    },
    createdReadError: x.createdRead?.error,
  };
});
process.stdout.write(
  JSON.stringify({ version: "0.158.0-alpha.2.1", results }, null, 2) + "\n",
);
