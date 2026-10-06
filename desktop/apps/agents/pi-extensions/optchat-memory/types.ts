export type Kind = "user" | "talk" | "tool" | "echo" | "note";

export type MessageRecord = {
  i: number;
  kind: Kind;
  text: string;
  size: number;
  date: string;
  source?: string;
};

export type NodeRecord = {
  l: number;
  i: number;
  text: string;
  size: number;
};

export type Part = { l: number; i: number };

export type Config = {
  memoryDir: string;
  nodeBytes: number;
  viewBytes: number;
  jobs: number;
  tries: number;
  retryMs: number;
  capChars: number;
  replaceContext: boolean;
  disableModelCompactor: boolean;
  compactorModel?: string;
  compactorThinking?: string;
  compactorMaxTokens: number;
};
