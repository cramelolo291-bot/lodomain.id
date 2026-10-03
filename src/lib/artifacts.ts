// Files produced by the chat.
//
// Every artefact the assistant writes is kept here so a session survives a
// reload and the work can be exported. Storage is deliberately local to the
// browser: these are scratch files the chat produced, not server state, and
// nothing is written anywhere the user did not ask for.

const KEY = "lolo-studio-artifacts:v1";

export type Artifact = {
  id: string;
  path: string;
  language: string;
  body: string;
  createdAt: number;
};

function read(): Artifact[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Artifact[]) : [];
  } catch {
    return [];
  }
}

function write(list: Artifact[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Quota exceeded: keep the session usable even if nothing persists.
  }
}

export function listArtifacts(): Artifact[] {
  return read().sort((a, b) => b.createdAt - a.createdAt);
}

export function saveArtifact(a: Omit<Artifact, "id" | "createdAt">): Artifact {
  const artifact: Artifact = {
    ...a,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };
  write([...read().filter((x) => x.path !== a.path), artifact]);
  return artifact;
}

export function deleteArtifact(id: string): void {
  write(read().filter((a) => a.id !== id));
}

export function clearArtifacts(): void {
  write([]);
}

/** Every artifact as one markdown-ish text bundle, for download. */
export function exportBundle(): string {
  return read()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((a) => `${"=".repeat(72)}\n// ${a.path}  (${a.language})\n${"=".repeat(72)}\n${a.body}\n`)
    .join("\n");
}

export function download(filename: string, body: string, mime = "text/plain"): void {
  const blob = new Blob([body], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}