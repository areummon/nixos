import type { Rule } from "./rules.ts";

export const FIRED_ENTRY = "stream-rules-fired";

// Fires per rule since the last user prompt. A rule that reached the cap is
// off until the next prompt, so a model that keeps tripping it cannot loop.
export class FireCap {
  readonly max: number;
  private counts = new Map<string, number>();

  constructor(max: number) {
    this.max = max;
  }

  reset(): void {
    this.counts.clear();
  }

  isOn(rule: Rule): boolean {
    return (this.counts.get(rule.id) ?? 0) < this.max;
  }

  // True when this fire used up the rule's allowance.
  record(rule: Rule): boolean {
    const n = (this.counts.get(rule.id) ?? 0) + 1;
    this.counts.set(rule.id, n);
    return n >= this.max;
  }
}

type BranchEntry = { type: string; customType?: string; data?: unknown };

// Rules that fired on this branch, in first-fire order, as configured now;
// ids no longer in the config drop out.
export function firedRules(branch: readonly BranchEntry[], rules: readonly Rule[]): Rule[] {
  const ids = new Set<string>();
  for (const e of branch) {
    if (e.type !== "custom" || e.customType !== FIRED_ENTRY) continue;
    const id = (e.data as { id?: unknown } | undefined)?.id;
    if (typeof id === "string") ids.add(id);
  }
  const byId = new Map(rules.map((r) => [r.id, r]));
  return [...ids].flatMap((id) => byId.get(id) ?? []);
}
