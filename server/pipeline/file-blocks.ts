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
// Anything that isn't a well-formed block is left alone. A malformed block
// never throws — it is just treated as prose, because a parser exception here
// would lose the user's answer entirely.

export type FileWrite = { path: string; content: string };

const FENCE = /```lolo:write\s+([^\s`]+)\s*\n([\s\S]*?)```/g;

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
} {
  const writes: FileWrite[] = [];

  const prose = text.replace(FENCE, (whole, rawPath: string, body: string) => {
    const path = rawPath.trim();
    if (!isSafePath(path)) return whole; // leave it visible, don't apply it

    // Exactly one trailing newline is an artefact of the fence, not content.
    const content = body.replace(/\n$/, "");
    writes.push({ path, content });
    return "";
  });

  return { writes, prose: prose.replace(/\n{3,}/g, "\n\n").trim() };
}

export function renderFileWrites(writes: FileWrite[]): string {
  return writes
    .map((w) => `\`\`\`lolo:write ${w.path}\n${w.content}\n\`\`\``)
    .join("\n\n");
}
