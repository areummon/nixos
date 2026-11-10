// The contract gondolin hands other extensions on pi.events. Every operation
// runs in the VM; consumers must treat a missing workspace as "do nothing",
// never as a reason to fall back to the host.
export const WORKSPACE_EVENT = "gondolin:workspace";

export type ExecResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type Workspace = {
  // Host directory mounted at guestRoot; tool paths are resolved against it.
  hostRoot: string;
  guestRoot: string;
  toGuestPath(hostPath: string): string;
  readFile(hostPath: string): Promise<Buffer>;
  writeFile(hostPath: string, content: string): Promise<void>;
  exec(
    argv: string[],
    options: { cwd?: string; timeoutMs: number; signal?: AbortSignal },
  ): Promise<ExecResult>;
};
