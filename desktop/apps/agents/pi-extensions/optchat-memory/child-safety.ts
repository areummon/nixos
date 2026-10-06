// Tool-policy boundary, not OS isolation of the in-process extension runtime.
const READ_TOOLS = new Set(["read", "zoom", "date", "codemode"]);

export function readOnlyBlock(tool: string): string | undefined {
  return READ_TOOLS.has(tool) ? undefined :
    `Read-only subagent: ${tool} is disabled. Ask the parent to perform shell commands or changes.`;
}

export class ApprovalQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(action);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

export function childUI(parent: any, id: string, queue: ApprovalQueue, failure: (message: string) => void) {
  let sandboxReady = false;
  // Proxy methods explicitly: Pi spreads UI contexts internally, so inherited
  // methods alone would be lost. Keep child status/widgets out of the parent UI.
  const ui: any = {};
  for (const key of ["theme", "getAllThemes", "getTheme", "getToolsExpanded"]) {
    ui[key] = typeof parent[key] === "function" ? parent[key].bind(parent) : parent[key];
  }
  for (const key of ["onTerminalInput", "setStatus", "setWorkingMessage", "setWorkingVisible",
    "setWorkingIndicator", "setHiddenThinkingLabel", "setWidget", "setFooter", "setHeader",
    "setTitle", "pasteToEditor", "setEditorText", "addAutocompleteProvider", "setEditorComponent",
    "setToolsExpanded"]) ui[key] = () => undefined;
  ui.getEditorText = () => "";
  ui.getEditorComponent = () => undefined;
  ui.setTheme = () => ({ success: false, error: "Child cannot change parent theme" });
  ui.setStatus = (key: string, value: string | undefined) => {
    if (key === "sandbox") sandboxReady = !!value;
  };
  ui.notify = (message: string, type?: string) => {
    if (type === "error" || /sandbox.*(?:failed|disabled|not supported)/i.test(message)) failure(message);
    parent.notify(`[subagent ${id}] ${message}`, type);
  };
  for (const key of ["select", "confirm", "input", "editor"]) {
    ui[key] = (title: string, ...args: any[]) => queue.run(() =>
      parent[key](`[subagent ${id}] ${title}`, ...args));
  }
  ui.custom = (...args: any[]) => queue.run(() => {
    parent.notify(`Approval requested by subagent ${id}. Prefer session-only, narrow grants.`, "info");
    return parent.custom(...args);
  });
  return { ui, ready: () => sandboxReady };
}
