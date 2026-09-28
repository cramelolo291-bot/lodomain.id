// Drives the real turn pipeline the workspace uses, then inspects the data
// space the same way the Data panel does. Verifies the two are actually wired
// together and not just each working in isolation.

import { api } from "../src/lib/api";

// jsdom-free stub: the mock backend only touches localStorage.
const mem = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
} as Storage;

let pass = 0;
let fail = 0;
const check = (label: string, cond: boolean, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label} ${extra}`);
  }
};

const PROJECT = "lolo-app";

async function main() {
  console.log("\n— agent turn provisions data —");
  const conv = await api.createConversation("lolo", "z-ai/glm-5.3-flash");

  const before = await api.dataTables(PROJECT);
  check("project starts with tables", before.length > 0, `${before.length}`);

  const res = await api.runTurn({
    conversationId: conv.id,
    prompt: "Bikin aplikasi toko online dengan database keranjang",
    agent: "lolo",
    model: "z-ai/glm-5.3-flash",
  });
  check("turn succeeded", res.status === "ok", JSON.stringify(res).slice(0, 120));

  const after = await api.dataTables(PROJECT);
  check(
    "agent added a products table",
    after.some((t) => t.name === "products"),
    after.map((t) => t.name).join(),
  );
  check("seed tables still intact", before.every((b) => after.some((a) => a.name === b.name)));
  check("files were written", Object.keys((await api.getProject()).files).length > 0);

  console.log("\n— a second turn is additive, not destructive —");
  const countBefore = after.length;
  await api.runTurn({
    conversationId: conv.id,
    prompt: "Bikin aplikasi toko online dengan database keranjang",
    agent: "lolo",
    model: "z-ai/glm-5.3-flash",
  });
  const after2 = await api.dataTables(PROJECT);
  check("no duplicate table on repeat", after2.length === countBefore, `${countBefore} -> ${after2.length}`);

  await api.runTurn({
    conversationId: conv.id,
    prompt: "buat tabel todo",
    agent: "lolo",
    model: "z-ai/glm-5.3-flash",
  });
  const after3 = await api.dataTables(PROJECT);
  check("a different prompt adds its own table", after3.some((t) => t.name === "tasks"));
  check("all tables survive", after3.length === countBefore + 1, `${after3.length}`);

  console.log("\n— editing rows the way the grid does —");
  const users = after3.find((t) => t.name === "users")!;
  const added = await api.dataAddRow(PROJECT, "users", {
    email: "temen@lolo.ai",
    name: "Temen",
    role: "user",
    active: true,
  });
  check("addRow returns the new row", added.email === "temen@lolo.ai");
  check("addRow assigned an id", typeof added.id === "number");

  await api.dataUpdateRow(PROJECT, "users", "id", String(added.id), "role", "admin");
  const reread = (await api.dataTables(PROJECT)).find((t) => t.name === "users")!;
  check(
    "updateRow persisted",
    reread.rows.find((r) => r.id === added.id)?.role === "admin",
  );
  check("updateRow left the others alone", reread.rows.length === users.rows.length + 1);

  await api.dataDeleteRow(PROJECT, "users", "id", String(added.id));
  const afterDel = (await api.dataTables(PROJECT)).find((t) => t.name === "users")!;
  check("deleteRow removed it", afterDel.rows.length === users.rows.length);

  console.log("\n— SQL console —");
  const q = await api.dataQuery(PROJECT, "SELECT name FROM products");
  check("SELECT through the api works", q.rows.length > 0, `${q.rows.length}`);
  const ins = await api.dataQuery(
    PROJECT,
    "INSERT INTO products (name, price, stock) VALUES ('Lampu gantung', 450000, 7)",
  );
  check("INSERT through the api works", ins.affected === 1);
  const afterIns = await api.dataTables(PROJECT);
  check(
    "INSERT persisted to the store",
    afterIns.find((t) => t.name === "products")!.rows.some((r) => r.name === "Lampu gantung"),
  );

  const dropped = await api.dataCreateTable(PROJECT, "scratch", [
    { name: "id", type: "number", pk: true },
  ]);
  void dropped;
  check("new table is empty", (await api.dataTables(PROJECT)).find((t) => t.name === "scratch")!.rows.length === 0);
  await api.dataDropTable(PROJECT, "scratch");
  check("dropTable removed it", !(await api.dataTables(PROJECT)).some((t) => t.name === "scratch"));

  console.log("\n— persistence —");
  const raw = mem.get("lolo.mock.v1");
  check("state is written to storage", typeof raw === "string" && raw.length > 0);
  check("data space is in the saved state", raw?.includes('"data"') === true);

  // A snapshot written before `data` existed must still open. This is the
  // exact case that threw "Cannot read properties of undefined" in the app.
  console.log("\n— an old snapshot without the data field —");
  const current = JSON.parse(mem.get("lolo.mock.v1")!);
  const legacy: Record<string, unknown> = { ...current };
  delete legacy.data;
  mem.set("lolo.mock.v1", JSON.stringify(legacy));

  const { api: reloaded } = await import(`../src/lib/api.ts?legacy=${Date.now()}`);
  const restored = await reloaded.dataTables(PROJECT);
  check("an old snapshot loads", Array.isArray(restored), JSON.stringify(restored).slice(0, 80));
  check("the seeded tables come back", restored.length === 5, `${restored.length}`);
  check(
    "the seeded table set is intact",
    ["users", "conversations", "pool_accounts", "usage_events", "api_keys"].every((n) =>
      restored.some((t: { name: string }) => t.name === n),
    ),
    restored.map((t: { name: string }) => t.name).join(),
  );
  const conversations = await reloaded.listConversations();
  check("conversations survived too", conversations.length > 0, `${conversations.length}`);

  // Writing to the recovered state must work, not just reading.
  const created = await reloaded.dataCreateTable(PROJECT, "recovered", [
    { name: "id", type: "number", pk: true },
  ]);
  void created;
  const recovered = await reloaded.dataTables(PROJECT);
  check(
    "the recovered state is writable",
    recovered.some((t: { name: string }) => t.name === "recovered"),
    recovered.map((t: { name: string }) => t.name).join(),
  );

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

void main();
