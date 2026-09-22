import { createHash } from 'node:crypto';
import { posix } from 'node:path';

export const CODEX_REMOTE_SOCKET_RELATIVE =
  'app-server-control/app-server-control.sock';

/** macOS caps a Unix socket path at 104 bytes (`sun_path`), and Codex builds its
 *  control socket as `$CODEX_HOME/app-server-control/app-server-control.sock` —
 *  42 bytes of suffix. So the alias home itself must fit in ~61 bytes.
 *
 *  `$TMPDIR` cannot host it: macOS spells it
 *  `/var/folders/xx/<30-char-hash>/T/` (49 bytes) and the alias came out at 121
 *  — LONGER than the 118-byte real home it was introduced to shorten, so every
 *  daemon start failed with `path must be shorter than SUN_LEN`. Root the alias
 *  at a fixed short prefix instead and keep the digest to 8 hex chars: the whole
 *  socket path then lands at 60 bytes with room to spare. */
export const CODEX_REMOTE_ALIAS_ROOT = '/tmp/mdc';

/** Longest socket path the platform will accept, minus a small safety margin. */
export const CODEX_REMOTE_SOCKET_MAX = 104;

/** Keep the CODEX_HOME spelling short enough for macOS's Unix-socket limit.
 *  `tempRoot` defaults to the short fixed root; callers may override it (tests).
 *
 *  Joined with the POSIX path module deliberately: the ONLY call site is
 *  enableCodexRemoteForSpawn, which is gated to `process.platform !== 'win32'`
 *  (Codex's remote app-server is unix-socket-only), and a Windows `join` would
 *  spell the alias with backslashes — wrong in the socket path AND in the shell
 *  commands the alias rides into. Platform-consistent, not merely short. */
export function codexRemoteAliasPath(
  realHome: string,
  agentId: string,
  tempRoot: string = CODEX_REMOTE_ALIAS_ROOT
): string {
  const digest = createHash('sha256')
    .update(`${realHome}\0${agentId}`)
    .digest('hex')
    .slice(0, 8);
  return posix.join(tempRoot, digest);
}

/** Whether a candidate home yields a control socket the platform can bind.
 *  POSIX join — see codexRemoteAliasPath. */
export function codexRemoteSocketFits(shortHome: string): boolean {
  return posix.join(shortHome, CODEX_REMOTE_SOCKET_RELATIVE).length < CODEX_REMOTE_SOCKET_MAX;
}

export function codexRemoteEndpoint(shortHome: string): string {
  return `unix://${posix.join(shortHome, CODEX_REMOTE_SOCKET_RELATIVE)}`;
}

/** Global options must precede `resume`, so prepend the endpoint in all cases. */
export function withCodexRemoteArgs(args: string[], endpoint: string): string[] {
  if (args.includes('--remote')) return args;
  return ['--remote', endpoint, ...args];
}
