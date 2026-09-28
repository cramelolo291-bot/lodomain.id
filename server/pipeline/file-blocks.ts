// Extracting file writes from a model's reply.
//
// A local model cannot call tools reliably, so the protocol is a fenced block
// with a path header. It is easy for a 7B model to produce and trivial to
// parse, which is why this beats JSON tool calls at this model size.
//
//   ```lolo:write index.html
//   <!doctype html>…
//   ```
//
// and a build directive, which is how the agent checks its own work:
//
//   ```lolo:build
//   ```
//
// Anything that isn't a well-formed block is left alone. A malformed block
// never throws — it is just treated as prose, because a parser exception here
// would lose the user's answer entirely.

export type FileWrite = { path: string; content: string };

/**
 * The only things a model is allowed to ask the runner to do. Anything else in
 * the directive is dropped rather than passed through, so a hallucinated
 * `lolo:build rm -rf /` cannot become a command.
 */
export const BUILD_TARGETS = ["install", "build", "typecheck", "test"] as const;
export type BuildTargetRequest = (typeof BUILD_TARGETS)[number];

const FENCE = /```lolo:write\s+([^\s`]+)\s*\n([\s\S]*?)```/g;
const BUILD_FENCE = /```lolo:build\s*([a-z]*)\s*```/g;

/** Rejects paths that would escape the project directory. */
export function isSafePath(path: string): boolean {
  if (!path || path.length > 200) return false;
  if (path.startsWith("/") || path.startsWith("~")) return false;
  if (path.includes("..") || path.includes("\\")) return false;
  // Only a real relative path: segments of letters, digits, dot, dash,
  // underscore, slash.
  return /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(path);
}

export function parseFileWrites(text: string): {
  writes: FileWrite[];
  /** The reply with the file blocks removed, for display. */
  prose: string;
  /**
   * What the model asked to be run, in the order it asked. Empty means it
   * wanted to write files and stop — which is the common case.
   */
  builds: BuildTargetRequest[];
} {
  const writes: FileWrite[] = [];
  const builds: BuildTargetRequest[] = [];

  const withoutBuilds = text.replace(BUILD_FENCE, (whole, rawTarget: string) => {
    const target = (rawTarget || "build").trim() as BuildTargetRequest;
    // An unrecognised target is not an error — it is a directive we do not
    // honour, and the text stays visible so a human can see what was asked.
    if (!BUILD_TARGETS.includes(target)) return whole;

    // A 7B model will happily emit the same block six times. One build per
    // occurrence is already generous; the pipeline caps the total, and the
    // runner serialises, so a burst cannot fork-bomb the box.
    builds.push(target);
    return "";
  });

  const prose = withoutBuilds.replace(FENCE, (whole, rawPath: string, body: string) => {
    const path = rawPath.trim();
    if (!isSafePath(path)) return whole; // leave it visible, don't apply it

    // Exactly one trailing newline is an artefact of the fence, not content.
    const content = body.replace(/\n$/, "");
    writes.push({ path, content });
    return "";
  });

  return { writes, builds, prose: prose.replace(/\n{3,}/g, "\n\n").trim() };
}

export function renderFileWrites(writes: FileWrite[]): string {
  return writes
    .map((w) => `\`\`\`lolo:write ${w.path}\n${w.content}\n\`\`\``)
    .join("\n\n");
}
