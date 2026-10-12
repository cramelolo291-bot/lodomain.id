// A terminal that reads the project's virtual file tree.
//
// It is deliberately read-only. Everything it does is a read, a count, a
// search, or a build check — there is no `rm`, no `curl`, no shell. The
// operator and their friends share this server, and a terminal that can execute
// arbitrary commands is a remote shell with extra steps.
//
// The tree is passed in rather than read from the database, so this function
// is pure and testable without a running Postgres.

export type CommandResult = { out: string[]; code: number };

type Tree = Record<string, string>;

function line(...parts: string[]): string {
  return parts.join(" ");
}

/** Groups paths into a directory tree for `ls` and `tree`. */
function buildTree(paths: string[]): Map<string, Set<string>> {
  const tree = new Map<string, Set<string>>();
  for (const p of paths) {
    const parts = p.split("/");
    let prefix = "";
    for (let i = 0; i < parts.length; i += 1) {
      const dir = i === parts.length - 1 ? "" : parts.slice(0, i + 1).join("/");
      const name = parts[i]!;
      const key = prefix;
      if (!tree.has(key)) tree.set(key, new Set());
      tree.get(key)!.add(name);
      prefix = dir;
    }
  }
  return tree;
}

function isPrefix(target: string, prefix: string): boolean {
  if (!prefix) return true;
  return target === prefix || target.startsWith(`${prefix}/`);
}

/** `ls`, `tree`, `cat`, `wc`, `head`, `tail`, `grep`, `find`, `wc -l`, `clear`. */
export function runCommand(input: string, files: Tree): CommandResult {
  const raw = input.trim();
  const out: string[] = [];
  const paths = Object.keys(files).sort();

  if (!raw) return { out: [], code: 0 };

  const [cmd, ...rest] = raw.split(/\s+/);
  const arg = rest.join(" ");
  const flag = (name: string) => rest.includes(`-${name}`);

  switch (cmd) {
    case "help":
      out.push(
        "Available: ls, tree, cat, head, tail, wc, grep, find, db, help, clear",
        "Read-only. Nothing here can write, delete, or reach the network.",
      );
      return { out, code: 0 };

    case "clear":
      return { out, code: 0 };

    case "pwd":
      return { out: [line("/app")], code: 0 };

    case "ls": {
      if (arg === "-R" || arg === "-r") {
        out.push(".");
        for (const p of paths) out.push(p);
        return { out, code: 0 };
      }
      if (arg) {
        const prefix = arg.replace(/\/$/, "");
        const matched = paths.filter((p) => isPrefix(p, prefix));
        if (matched.length === 0) return { out: [`ls: ${arg}: no such directory`], code: 1 };
        out.push(...matched);
        return { out, code: 0 };
      }
      const dirs = new Set<string>();
      for (const p of paths) {
        const slash = p.lastIndexOf("/");
        if (slash >= 0) dirs.add(p.slice(0, slash));
      }
      out.push(...[...dirs].sort());
      out.push(...paths.filter((p) => !p.includes("/")));
      return { out, code: 0 };
    }

    case "tree": {
      if (paths.length === 0) return { out: ["(empty)"], code: 0 };
      const tree = buildTree(paths);
      out.push(".");
      const print = (dir: string, prefix: string) => {
        const children = [...(tree.get(dir) ?? [])].sort();
        children.forEach((name, index) => {
          const last = index === children.length - 1;
          out.push(`${prefix}${last ? "└─" : "├─"} ${name}`);
          const childPath = dir ? `${dir}/${name}` : name;
          if (tree.has(childPath)) print(childPath, `${prefix}${last ? "   " : "│  "}`);
        });
      };
      print("", "");
      out.push("", `${paths.length} files`);
      return { out, code: 0 };
    }

    case "cat": {
      if (!arg) return { out: ["cat: missing operand"], code: 1 };
      const content = files[arg];
      if (content === undefined) {
        // Accept a bare filename when the match is unambiguous.
        const matches = paths.filter((p) => p.endsWith(`/${arg}`) || p === arg);
        if (matches.length === 1) return { out: files[matches[0]!]!.split("\n"), code: 0 };
        return { out: [`cat: ${arg}: no such file`], code: 1 };
      }
      return { out: content.split("\n"), code: 0 };
    }

    case "head":
    case "tail": {
      if (!arg) return { out: [`${cmd}: missing operand`], code: 1 };
      const n = Number.parseInt(rest.find((r) => /^\d+$/.test(r)) ?? "20", 10);
      const target = rest.find((r) => !/^-\w+$/.test(r) && !/^\d+$/.test(r));
      if (!target || files[target] === undefined) {
        return { out: [`${cmd}: ${target ?? ""}: no such file`], code: 1 };
      }
      const rows = files[target]!.split("\n");
      out.push(...(cmd === "head" ? rows.slice(0, n) : rows.slice(-n)));
      return { out, code: 0 };
    }

    case "wc": {
      if (arg && files[arg] !== undefined) {
        const rows = files[arg]!.split("\n");
        out.push(flag("l") || !flag("w") ? `${rows.length} ${arg}` : `${rows.join(" ").split(/\s+/).length} ${arg}`);
        return { out, code: 0 };
      }
      for (const p of paths) {
        const rows = files[p]!.split("\n");
        const words = rows.join(" ").split(/\s+/).filter(Boolean).length;
        out.push(`${String(rows.length).padStart(6)}${String(words).padStart(8)}${String(files[p]!.length).padStart(9)}  ${p}`);
      }
      out.push(`${String(paths.length).padStart(6)} total`);
      return { out, code: 0 };
    }

    case "grep": {
      const pattern = rest.find((r) => !r.startsWith("-"));
      if (!pattern) return { out: ["grep: missing pattern"], code: 1 };
      let re: RegExp;
      try {
        re = new RegExp(pattern, flag("i") ? "i" : "");
      } catch {
        return { out: [`grep: ${pattern}: invalid pattern`], code: 1 };
      }
      let hits = 0;
      for (const p of paths) {
        const rows = files[p]!.split("\n");
        rows.forEach((text, i) => {
          if (!re.test(text)) return;
          hits += 1;
          out.push(`${p}:${i + 1}: ${text.trim()}`);
        });
      }
      if (hits === 0) out.push("(no matches)");
      return { out, code: hits ? 0 : 1 };
    }

    case "find": {
      const pattern = arg ? arg.replace(/\*/g, "") : "";
      const matched = paths.filter((p) => !pattern || p.includes(pattern));
      out.push(...matched);
      if (matched.length === 0) out.push("(nothing found)");
      return { out, code: 0 };
    }

    case "db": {
      out.push(
        "Tables live at /api/projects/:id/tables.",
        "From here: GET lists them, POST creates one.",
      );
      return { out, code: 0 };
    }

    case "tsc":
    case "typecheck":
      return {
        out: ["Not executed: this read-only terminal cannot run the TypeScript compiler. Use the real Build → Typecheck action."],
        code: 1,
      };

    default:
      return { out: [`${cmd}: command not found. Try 'help'.`], code: 127 };
  }
}
