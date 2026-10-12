// Drives the real turn pipeline the workspace uses, then inspects the data
// space the same way the Data panel does. Verifies the two are actually wired
// together and not just each working in isolation.

process.env.VITE_API_MODE = "mock";
const { api } = await import("../src/lib/api");

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

  console.log("\n— a build request actually produces files —");
  // The bug this locks down: the scaffold wrote the same bytes on every turn,
  // so a "build me a shop" request diffed to zero and the agent answered
  // "nothing to change". A build request must always move the tree.
  const { plan } = await import("../src/lib/project");
  const agentDef = { name: "Forge", tagline: "t", description: "d" } as never;

  const shop = plan(
    "Buatkan web mobile toko online tampilan modern rapih banget",
    { name: "lolo-app", files: {} },
    agentDef,
  );
  check("a shop request writes files", shop.changes.length > 0, `${shop.changes.length}`);
  const shopHtml = shop.files["index.html"]!;
  check("it builds a page, not a placeholder", shopHtml.includes("<!doctype html>"));
  check("the name comes from the request", /<title>Toko Online<\/title>/.test(shopHtml), /<title>(.*?)<\/title>/.exec(shopHtml)?.[1] ?? "");
  check("a shop gets a cart", shopHtml.includes('placeholder="Cari produk'));
  check("it is built for a phone", shopHtml.includes("safe-area-inset-bottom"));

  const other = plan("Bikin aplikasi absensi siswa", { name: "lolo-app", files: {} }, agentDef);
  check("a different request builds a different app", other.files["index.html"] !== shopHtml);
  check("a non-shop request is not a shop", !other.files["index.html"]!.includes('placeholder="Cari produk'));
  check("both are titled from their own prompt", /Absensi Siswa/.test(other.files["index.html"]!));

  const again = plan(
    "Buatkan web mobile toko online tampilan modern rapih banget",
    { name: "lolo-app", files: shop.files },
    agentDef,
  );
  check("the same request twice is honestly a no-op", again.changes.length === 0, `${again.changes.length}`);

  const pkg = JSON.parse(shop.files["package.json"]!) as { name: string; scripts: Record<string, string> };
  check("package name is derived, not constant", pkg.name === "toko-online", pkg.name);
  check("it carries a real dev script", typeof pkg.scripts.dev === "string" && pkg.scripts.dev.length > 0);

  // The generated app used to cap its own width at 30rem, which in a preview
  // pane rendered as a narrow strip floating in the middle of the screen.
  const cap = /max-width:\s*([\d.]+)rem/.exec(shopHtml)?.[1];
  check("the layout is not capped to a phone-width strip", Number(cap) >= 64, `max-width: ${cap}rem`);
  check("the page is fluid, not fixed", /width:\s*100%/.test(shopHtml));
  check("it has a desktop breakpoint", /@media \(min-width: 900px\)/.test(shopHtml));
  check("it has a wide breakpoint", /@media \(min-width: 1280px\)/.test(shopHtml));
  check("the header is fluid too", /\.top \{[^}]*clamp\(/.test(shopHtml.replace(/\n/g, " ")));

  console.log("\n— a PDF is a real PDF —");
  const { markdownToPdf, pdfFilename } = await import("../server/build/pdf");
  const doc = markdownToPdf(
    "# Laporan\n\nParagraf yang cukup panjang untuk memastikan barisnya benar-benar diwrap.\n\n- satu\n- dua\n",
    { title: "Laporan" },
  );
  const pdfText = doc.toString("latin1");
  check("it starts with the PDF magic", pdfText.startsWith("%PDF-1.4"), pdfText.slice(0, 8));
  check("it ends with EOF", pdfText.trimEnd().endsWith("%%EOF"));
  check("it has a cross-reference table", pdfText.includes("\nxref\n"));
  check("it has a trailer", pdfText.includes("trailer"));
  check("it embeds a base-14 font", pdfText.includes("/BaseFont /Helvetica"));

  // A PDF whose startxref does not point at `xref` is a file no reader opens.
  const start = Number(/startxref\s+(\d+)/.exec(pdfText)?.[1]);
  check("startxref points at the xref table", pdfText.slice(start, start + 4) === "xref");
  const entries = pdfText
    .slice(start)
    .split("trailer")[0]!
    .split("\n")
    .map((l) => /^(\d{10}) 00000 n/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
  const badOffset = entries.findIndex((off, i) => !pdfText.slice(off).startsWith(`${i + 1} 0 obj`));
  check(
    "every xref offset lands on its object",
    badOffset === -1,
    badOffset >= 0 ? `obj ${badOffset + 1} -> ${JSON.stringify(raw.slice(entries[badOffset]!, entries[badOffset]! + 20))}` : "",
  );

  const long = markdownToPdf(Array.from({ length: 400 }, (_, i) => `Baris nomor ${i} dengan isi yang cukup panjang untuk mengisi ruang.`).join("\n\n"));
  const pages = (long.toString("latin1").match(/\/Type \/Page[^s]/g) ?? []).length;
  check("long input paginates", pages > 1, `${pages} pages`);

  check("filename is sanitised", pdfFilename("../../etc/passwd") === "etcpasswd.pdf", pdfFilename("../../etc/passwd"));
  check("filename has no header injection", !/[\r\n]/.test(pdfFilename("Laporan\nX: 1")), pdfFilename("Laporan\nX: 1"));
  check("an empty title still gets a name", pdfFilename("   ") === "dokumen.pdf");

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

void main();
