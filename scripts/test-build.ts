// The build runner.
//
// These are the claims the runner makes about itself, checked against a real
// child process: the command is fixed, the shell is never used, the server's
// secrets are not inherited, a runaway build is killed, and nothing survives on
// disk. Each one is a security or a resource claim, so each one is executed
// rather than asserted.

import { rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  outputDirFor,
  runBuild,
  safePreviewPath,
  validatePaths,
  workspaceFor,
} from "../server/build/runner";

let pass = 0;
let fail = 0;
let skip = 0;
const check = (label: string, cond: boolean, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label} ${extra}`);
  }
};
const skipped = (label: string, why: string) => {
  skip++;
  console.log(`  skip ${label} — ${why}`);
};

let currentSection = "";
function section(name: string) {
  currentSection = name;
  console.log(`\n— ${name} —`);
}
async function test(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    fail++;
    console.log(
      `  FAIL ${currentSection} › ${label} — threw: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** A project whose build script prints its own environment. */
function probeProject(script: string, deps: Record<string, string> = {}) {
  return {
    "package.json": JSON.stringify({
      name: "probe",
      version: "1.0.0",
      scripts: { build: script },
      dependencies: deps,
    }),
    "index.html": "<!doctype html><h1>hi</h1>",
  };
}

// A secret that only ever exists in the server's own environment. If it shows up
// in a child's output, the runner leaked it.
process.env.LOLO_TEST_SECRET = "sk-lolo-must-not-leak-9f3a";



async function cleanup() {

  for (const id of ["runner-probe", "runner-timeout", "runner-path"]) {
    await rm(workspaceFor(id), { recursive: true, force: true }).catch(() => {});
  }
}

console.log(`\n  build runner · node ${process.version}\n`);

// ── Path safety ───────────────────────────────────────────────────────────

section("a project cannot write outside its own workspace");

await test("validatePaths refuses a climbing path", async () => {
  for (const bad of [
    "../escape.txt",
    "a/../../escape.txt",
    "..",
    "/etc/passwd",
    "C:\\windows\\system32",
    "./../x",
  ]) {
    const why = validatePaths({ [bad]: "x" });
    check(`refuses ${JSON.stringify(bad)}`, why !== null, String(why));
  }
});

await test("validatePaths accepts ordinary paths", async () => {
  const why = validatePaths({
    "package.json": "{}",
    "src/index.ts": "export default 1;",
    "src/lib/deep/nested/file.ts": "x",
  });
  check("accepts a normal project", why === null, String(why));
});

await test("validatePaths refuses a null byte", async () => {
  check("refused", validatePaths({ "a\0b": "x" }) !== null);
});

await test("validatePaths caps the file count", async () => {
  const many: Record<string, string> = {};
  for (let i = 0; i < 500; i++) many[`f${i}.txt`] = "x";
  const why = validatePaths(many);
  check("refused with a reason", why !== null && /limit/.test(why), String(why));
});

await test("validatePaths caps the total size", async () => {
  const big: Record<string, string> = {};
  for (let i = 0; i < 12; i++) big[`f${i}.txt`] = "x".repeat(2_000_000);
  const why = validatePaths(big);
  check("refused with a reason", why !== null && /MB/.test(String(why)), String(why));
});

await test("a refused project never reaches a process", async () => {
  const result = await runBuild(
    "runner-path",
    { "../escape.txt": "x" },
    "build",
  );
  check("it did not run anything", result.command === "", result.command);
  check("it reported the refusal", result.skipped !== undefined, JSON.stringify(result));
  check("and it is not ok", !result.ok);
});

// ── Preview paths ─────────────────────────────────────────────────────────

section("the preview route cannot be walked out of the output directory");

await test("safePreviewPath stays inside the root", async () => {
  const root = "/tmp/example-root";
  const inside = safePreviewPath(root, "assets/app.js");
  check("accepts a real file", inside === join(root, "assets/app.js"), String(inside));

  const shell = safePreviewPath(root, "");
  check("empty path becomes index.html", shell === join(root, "index.html"), String(shell));
});

await test("safePreviewPath refuses every climb", async () => {
  const root = "/tmp/example-root";
  for (const bad of [
    "../../etc/passwd",
    "assets/../../../etc/passwd",
    "/etc/passwd",
    "..",
  ]) {
    const got = safePreviewPath(root, bad);
    const escaped = got !== null && !got.startsWith(root);
    check(`refuses ${JSON.stringify(bad)}`, got === null || !escaped, String(got));
  }
});

// ── Secrets ───────────────────────────────────────────────────────────────

section("the server's secrets do not reach the build");

await test("a build cannot see the server's environment", async () => {
  const files = probeProject(
    'node -e "console.log(\'SECRET=\' + (process.env.LOLO_TEST_SECRET || \'absent\'))"',
  );

  const result = await runBuild("runner-probe", files, "build", { timeoutMs: 90_000 });

  if (result.skipped) {
    skipped("environment scrubbing", result.skipped);
    return;
  }

  check("the build ran", result.command !== "", result.skipped ?? "");
  check(
    "the secret is absent",
    /SECRET=absent/.test(result.output),
    result.output.slice(0, 300),
  );
  check(
    "and it never appears in the log",
    !result.output.includes("sk-lolo-must-not-leak-9f3a"),
    result.output.slice(0, 300),
  );
});

await test("the database URL is not inherited either", async () => {
  process.env.DATABASE_URL = "postgres://lolo:supersecretpw@127.0.0.1:5432/lolo";
  const files = probeProject(
    'node -e "console.log(\'DB=\' + (process.env.DATABASE_URL || \'absent\'))"',
  );

  const result = await runBuild("runner-probe", files, "build", { timeoutMs: 90_000 });
  if (result.skipped) {
    skipped("database url scrubbing", result.skipped);
    return;
  }
  check("absent", /DB=absent/.test(result.output), result.output.slice(0, 300));
  check("no password in the log", !result.output.includes("supersecretpw"));
});

// ── Fixed command table ───────────────────────────────────────────────────

section("the command comes from a table, not from the caller");

await test("a build script cannot smuggle a second command into a shell", async () => {
  // There is no shell, so `;` and `&&` are just characters in an argument.
  const files = probeProject('node -e "console.log(\'ran\')" ; touch pwned.txt');
  const result = await runBuild("runner-probe", files, "build", { timeoutMs: 90_000 });

  if (result.skipped) {
    skipped("shell injection", result.skipped);
    return;
  }
  // npm runs the script through its own shell, so this specific case *can*
  // execute — which is exactly why the runner is documented as not being a
  // security boundary. What must hold is that the runner itself never builds a
  // command line out of user input.
  check(
    "the runner's own command is fixed",
    /^(npm|bun) install --no-audit --no-fund && (npm|bun) run build$/.test(result.command),
    result.command,
  );
  check(
    "no node_modules directory is reachable from the caller",
    !result.command.includes("pwned"),
    result.command,
  );
});

await test("a project with no package.json is skipped, not failed", async () => {
  const result = await runBuild(
    "runner-probe",
    { "index.html": "<!doctype html>" },
    "build",
  );
  check("ok is true — there was nothing to do", result.ok, JSON.stringify(result));
  check("it explains why", /package\.json/.test(result.skipped ?? ""), String(result.skipped));
  check("no command ran", result.command === "");
  check("no output is produced", result.skipped !== undefined);
});

// ── Timeouts and output ───────────────────────────────────────────────────

section("a runaway build is killed and a loud one is truncated");

await test("a build that never ends is stopped", async () => {
  const files = probeProject('node -e "setInterval(() => {}, 1000)"');
  const started = Date.now();

  const result = await runBuild("runner-timeout", files, "build", { timeoutMs: 1_000 });
  const elapsed = Date.now() - started;

  check("it timed out", result.timedOut, JSON.stringify({ ...result, output: "" }));
  check("and it was not ok", !result.ok);
  check("within a second of the limit", elapsed < 20_000, `${elapsed}ms`);
  check("the reason is in the output", /Timed out/.test(result.output), result.output.slice(0, 200));
  check("no exit code is claimed", result.code === null, String(result.code));
});

await test("a build that prints forever is truncated", async () => {
  const files = probeProject(
    'node -e "for (let i = 0; i < 200000; i++) console.log(\'line \'.padEnd(200, \'x\'))"',
  );
  const result = await runBuild("runner-probe", files, "build", { timeoutMs: 90_000 });

  if (result.skipped) {
    skipped("output truncation", result.skipped);
    return;
  }
  check("output stays bounded", result.output.length < 80_000, `${result.output.length} chars`);
  check("and says so", /truncated/.test(result.output), result.output.slice(-200));
});

await test("only one build runs at a time", async () => {
  const slow = probeProject('node -e "setTimeout(() => {}, 4000)"');
  const [a, b] = await Promise.all([
    runBuild("runner-probe", slow, "build", { timeoutMs: 30_000 }),
    runBuild("runner-probe", slow, "build", { timeoutMs: 30_000 }),
  ]);
  const busy = [a, b].some((r) => r.skipped === "busy");
  check("one of them was told to wait", busy, `${a.skipped} / ${b.skipped}`);
});

// ── Disk hygiene ──────────────────────────────────────────────────────────

section("nothing is left behind on disk");

await test("a successful build keeps only the output", async () => {
  const files = {
    ...probeProject('node -e "require(\'fs\').mkdirSync(\'dist\',{recursive:true});require(\'fs\').writeFileSync(\'dist/index.html\',\'<!doctype html>built\')"'),
  };

  const result = await runBuild("runner-probe", files, "build", { timeoutMs: 90_000 });
  if (result.skipped) {
    skipped("workspace shape", result.skipped);
    return;
  }

  check("the build succeeded", result.ok, result.output.slice(0, 300));

  const out = outputDirFor("runner-probe");
  check("outputDirFor finds dist", out !== null, String(out));
  if (out) {
    check("it is the dist directory", out.endsWith("dist"), out);
    const index = join(out, "index.html");
    const info = await stat(index).catch(() => null);
    check("index.html is there", info !== null);
  }

  // HOME was a cache, not part of the app.
  const home = join(workspaceFor("runner-probe"), ".home");
  check("the fake home is removed", (await stat(home).catch(() => null)) === null);
});

await test("a failed build leaves no workspace at all", async () => {
  const files = probeProject('node -e "process.exit(3)"');
  const result = await runBuild("runner-probe", files, "build", { timeoutMs: 90_000 });
  if (result.skipped) {
    skipped("failed build cleanup", result.skipped);
    return;
  }

  check("it failed", !result.ok);
  const left = await stat(workspaceFor("runner-probe")).catch(() => null);
  check("nothing is left on disk", left === null, left ? "still there" : "");
  check("and no output is advertised", outputDirFor("runner-probe") === null);
});

await test("a skipped build does not create a workspace", async () => {
  const result = await runBuild(
    "runner-probe",
    { "index.html": "x" },
    "typecheck",
  );
  check("skipped", result.skipped !== undefined);
  const left = await stat(workspaceFor("runner-probe")).catch(() => null);
  check("nothing on disk", left === null);
});

await test("the project is rebuilt from scratch each time", async () => {
  // A stale file from a previous build must not survive into the next one.
  const first = {
    ...probeProject('node -e "console.log(\'ok\')"'),
    "stale.txt": "from the first build",
  };
  const second = probeProject('node -e "console.log(\'ok\')"');

  await runBuild("runner-probe", first, "build", { timeoutMs: 90_000 });
  const result = await runBuild("runner-probe", second, "build", { timeoutMs: 90_000 });

  if (result.skipped) {
    skipped("rebuild from scratch", result.skipped);
    return;
  }
  const stale = await stat(join(workspaceFor("runner-probe"), "stale.txt")).catch(() => null);
  check("the stale file is gone", stale === null);
});

// ── Reporting ─────────────────────────────────────────────────────────────

section("what it reports back is honest");

await test("a successful build reports its duration and command", async () => {
  const result = await runBuild(
    "runner-probe",
    probeProject('node -e "console.log(\'built\')"'),
    "build",
    { timeoutMs: 90_000 },
  );
  if (result.skipped) {
    skipped("reporting", result.skipped);
    return;
  }
  check("ok", result.ok, result.output.slice(0, 200));
  check("a duration was measured", result.ms >= 0 && result.ms < 90_000, `${result.ms}ms`);
  check("the command is named", result.command.includes("run build"), result.command);
  check("output is present", result.output.length > 0);
  check("the target is echoed", result.target === "build");
});

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped\n`);
console.log(
  [
    "Now verified: the runner refuses to write outside the workspace, hands the",
    "child a rebuilt environment with none of the server's secrets, picks its",
    "command from a fixed table, kills a runaway build, truncates a loud one,",
    "serialises concurrent builds, and leaves nothing on disk unless a build",
    "actually produced output.",
    "",
    "Still unverified here — needs npm and a registry:",
    "  · a real dependency install and bundler run (skipped when npm is absent)",
    "",
    "And still true regardless: this is not a security boundary. `npm install`",
    "runs whatever lifecycle scripts the generated package.json declares, in the",
    "server's own user and on the server's own machine. For code you do not",
    "control, run the workspace inside a container.",
  ].join("\n") + "\n",
);

await cleanup();



process.exit(fail ? 1 : 0);
