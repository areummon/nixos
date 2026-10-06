# Pstack memory bridge

The Nix-managed OptChat extension recognizes the pinned Pstack Pi port's
`--pstack-depth` flag. At positive depth it loads only frozen parent memory:
`zoom` and `date`, plus memory context. It does not acquire the live archive
lock, start compactors, log child messages, or register memory-control/spawn tools.

The parent publishes an atomic, mode-0600 snapshot at startup and before
`agent`/`send_message`. Pstack's subprocess inherits `PI_OPTCHAT_PSTACK_SNAPSHOT`.
Each child reads once at extension load. Nested children inherit the snapshot
path. An existing child keeps its frozen copy; a resumed/new process reads the
latest published snapshot. This is historical context, not shared live memory.

The private snapshot includes the rendered view, original capped messages and
summary nodes. It is under `memoryDir/pstack-snapshots/<parent-pid>.json`, outside
`main`/`tree`. It is replaced, not appended, and removed at orderly shutdown.
Crashes may leave a stale file. Snapshot publication duplicates the current
archive on disk and children hold a copy in RAM; it is not a scalable remote
memory service. The snapshot carries the same sensitive history as the archive.

Foreground tool results are already logged by OptChat. Background
`pstack-agent` completion messages are logged as `work` records in the parent.
The child's internal conversation stays in Pstack's separate Pi session.

No upstream source patches or additional Nix package links are required:
`pi.nix` already installs this entire OptChat directory as a global extension.
Pstack children must continue loading global extensions and preserving the
inherited environment/depth flag. An unavailable snapshot produces a warning
and failing memory tools, never fallback to the live writer. The task itself
can still run without memory. If upstream changes its child CLI contract,
review this adapter before updating the pinned revision.

This does not alter Pstack's sandbox, permissions, model routing, worktrees,
or readonly behavior. It is a memory bridge, not a security boundary.

Tests:

```sh
node --experimental-strip-types --test desktop/apps/agents/pi-extensions/optchat-memory/pstack-memory.test.mjs
```
