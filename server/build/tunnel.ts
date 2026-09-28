// A byte-level tunnel to a dev server, for WebSocket upgrades.
//
// The HTTP proxy in `dev.ts` cannot carry HMR: a WebSocket opens with an
// `Upgrade` header and then becomes two raw sockets speaking a framing protocol
// that neither side should be parsing again. Re-encoding it as fetch and
// decoding on the way back would mean reimplementing the protocol, and getting
// it wrong fails in a way that looks like a bundler bug.
//
// So this does not proxy. It copies bytes. The request line is rewritten to
// point at the dev server's port, the two sockets are piped into each other,
// and nothing is interpreted again. That is what a tunnel is for.

import { connect, type Socket } from "node:net";
import type { IncomingMessage } from "node:http";

/**
 * Rewrites the request line and Host header for an upstream port.
 *
 * Only the origin moves. The path, query and every other header are passed
 * through untouched, because the dev server is the one that has to see the
 * request the client actually made.
 */
export function rewriteHead(raw: string, port: number): string {
  const lines = raw.split("\r\n");
  const parts = (lines[0] ?? "").split(" ");

  if (parts.length >= 3) {
    // METHOD PATH VERSION — the path already carries the query string.
    lines[0] = [parts[0], parts[1], parts[2]].join(" ");
  }

  for (let i = 1; i < lines.length; i += 1) {
    if (/^host:/i.test(lines[i]!)) {
      lines[i] = `Host: 127.0.0.1:${port}`;
      break;
    }
  }

  return lines.join("\r\n");
}

/**
 * Rebuilds a request head from Node's parsed headers.
 *
 * Node hands over headers field by field, so the original bytes have to be
 * reconstructed. `Connection` and `Upgrade` are dropped and re-added: sending a
 * stale `Connection: keep-alive` alongside a new upgrade is the kind of thing
 * that produces a 400 from the upstream with nothing useful in it.
 */
export function buildRawHead(request: IncomingMessage): string {
  const lines = [`GET ${request.url ?? "/"} HTTP/1.1`];

  for (let i = 0; i < request.rawHeaders.length; i += 2) {
    const name = request.rawHeaders[i]!;
    const value = request.rawHeaders[i + 1]!;
    if (/^(connection|upgrade|proxy-connection|keep-alive)$/i.test(name)) continue;
    lines.push(`${name}: ${value}`);
  }

  lines.push("Connection: Upgrade");
  lines.push("Upgrade: websocket");
  return lines.join("\r\n");
}

/**
 * Forwards one upgrade to a dev server and pipes the two sockets together.
 *
 * `port` is never taken from the request — the caller resolves it from the
 * process this server started. The only thing a client controls is the path,
 * and the caller validates that before it gets here.
 */
export function tunnelUpgrade(
  request: IncomingMessage,
  client: Socket,
  head: Buffer,
  port: number,
): void {
  const raw = buildRawHead(request);
  const upstream = connect({ host: "127.0.0.1", port });

  let settled = false;
  const refuse = (status: string, reason: string) => {
    if (settled || client.destroyed) {
      client.destroy();
      return;
    }
    settled = true;
    const body =
      `HTTP/1.1 ${status}\r\n` +
      `connection: close\r\n` +
      `content-type: text/plain; charset=utf-8\r\n` +
      `content-length: ${Buffer.byteLength(reason)}\r\n\r\n${reason}`;

    // `end` and `destroy` in the same breath throws the write away — the client
    // sees a closed socket and no status at all, which is exactly the opaque
    // failure this is meant to avoid. Destroy only once it has been flushed.
    client.end(body, () => client.destroy());
  };

  upstream.on("connect", () => {
    settled = true;
    upstream.write(`${rewriteHead(raw, port)}\r\n\r\n`);

    // The first WebSocket frame usually arrives with the upgrade itself.
    // Dropping it hangs the client until its own timeout, with no error.
    if (head.length > 0) upstream.write(head);

    client.pipe(upstream);
    upstream.pipe(client);
  });

  upstream.on("error", () => {
    refuse("502 Bad Gateway", "dev server unreachable");
  });

  client.on("error", () => upstream.destroy());

  // When either end goes, so does the other. Without this a closed browser tab
  // leaves a socket pinned inside the dev server for the life of the process.
  client.on("close", () => upstream.destroy());
  upstream.on("close", () => {
    if (!client.destroyed) client.end();
  });
}
