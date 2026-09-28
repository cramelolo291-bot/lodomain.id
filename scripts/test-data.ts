import {
  seedData,
  tablesFor,
  addRow,
  updateRow,
  deleteRow,
  createTable,
  applySql,
  tablesForPrompt,
  mergeTables,
} from "../src/lib/data";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label} ${extra}`);
  }
}

console.log("\n— data space —");
const space = seedData();
const tables = tablesFor(space, "lolo-app");

check("seed has 5 tables", tables.length === 5, `got ${tables.length}`);
check("users table exists", tables.some((t) => t.name === "users"));

// Read
const r1 = applySql(tables, "SELECT email, role FROM users WHERE role = admin");
check("SELECT filters by role", r1.result.rows.length === 1, `got ${r1.result.rows.length}`);
check("SELECT projects columns", r1.result.columns.join() === "email,role");

// Insert
const r2 = applySql(tables, "INSERT INTO users (email, name, role, active) VALUES ('naya@lolo.ai', 'Naya', 'user', true)");
check("INSERT adds a row", r2.tables.find((t) => t.name === "users")!.rows.length === 4);
check("INSERT echoes the row", r2.result.rows[0]!.email === "naya@lolo.ai");
check("INSERT assigns pk", r2.result.rows[0]!.id === 4);

// Update
const r3 = applySql(r2.tables, "UPDATE users SET role = 'admin' WHERE id = 3");
const u3 = r3.tables.find((t) => t.name === "users")!.rows.find((r) => r.id === 3)!;
check("UPDATE changes the row", u3.role === "admin");
check("UPDATE leaves others alone", r3.tables.find((t) => t.name === "users")!.rows[0]!.role === "admin" && r3.tables.find((t) => t.name === "users")!.rows.length === 4);

// Update coerces to the column type
const r3b = applySql(r3.tables, "UPDATE usage_events SET ok = 'false' WHERE id = 1");
const u1 = r3b.tables.find((t) => t.name === "usage_events")!.rows[0]!;
check("UPDATE coerces bool", u1.ok === false, `got ${JSON.stringify(u1.ok)}`);

// Delete
const r4 = applySql(r3b.tables, "DELETE FROM users WHERE id = 2");
check("DELETE removes one row", r4.tables.find((t) => t.name === "users")!.rows.length === 3);
check("DELETE is targeted", r4.tables.find((t) => t.name === "users")!.rows.some((r) => r.id === 2) === false);

// SHOW TABLES
const r5 = applySql(tables, "SHOW TABLES");
check("SHOW TABLES lists all", r5.result.rows.length === 5);

// Bad input is reported, not swallowed
try {
  applySql(tables, "SELECT * FROM nope");
  check("unknown table throws", false);
} catch (e) {
  check("unknown table throws", e instanceof Error && e.message.includes("nope"));
}
const r6 = applySql(tables, "EXPLAIN EVERYTHING");
check("unsupported SQL gets a note", typeof r6.result.note === "string");

console.log("\n— direct CRUD —");
const t2 = createTable(tables, "tasks", [
  { name: "id", type: "number", pk: true },
  { name: "title", type: "text" },
]);
check("createTable appends", t2.length === 6);
try {
  createTable(t2, "tasks", []);
  check("duplicate table throws", false);
} catch {
  check("duplicate table throws", true);
}

const ins = addRow(t2, "tasks", { title: "Tulis server" });
check("addRow fills pk", ins.row.id === 1, `got ${ins.row.id}`);
const upd = updateRow(ins.tables, "tasks", "id", 1, "title", "Tulis server Hono");
check("updateRow edits in place", upd.find((t) => t.name === "tasks")!.rows[0]!.title === "Tulis server Hono");
const del = deleteRow(upd, "tasks", "id", 1);
check("deleteRow removes", del.find((t) => t.name === "tasks")!.rows.length === 0);

console.log("\n— agent-provisioned tables —");
for (const prompt of [
  "bikin database untuk keranjang belanja",
  "buat tabel todo",
  "tambah halaman About",
]) {
  const t = tablesForPrompt(prompt);
  console.log(`  "${prompt}" -> ${t.length ? t.map((x) => x.name).join() : "(none)"}`);
}
check("cart prompt makes products", tablesForPrompt("bikin database untuk keranjang belanja").some((t) => t.name === "products"));
check("todo prompt makes tasks", tablesForPrompt("buat tabel todo").some((t) => t.name === "tasks"));
check("unrelated prompt makes none", tablesForPrompt("tambah halaman About").length === 0);

// Merging is additive and idempotent
const a = tablesForPrompt("bikin database untuk keranjang belanja");
const m1 = mergeTables(tables, a);
const m2 = mergeTables(m1, a);
check("merge adds once", m1.length === 6 && m2.length === 6, `${m1.length}/${m2.length}`);
check("merge never overwrites", m2.find((t) => t.name === "users")!.rows.length === 3);

// Every seeded table must be internally consistent
for (const t of tables) {
  const pkCol = t.columns.find((c) => c.pk);
  if (pkCol) {
    check(`${t.name}: all rows have ${pkCol.name}`, t.rows.every((r) => r[pkCol.name] !== undefined));
  }
  const bad = t.rows.filter((r) => Object.keys(r).some((k) => !t.columns.some((c) => c.name === k)));
  check(`${t.name}: no unknown columns`, bad.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
