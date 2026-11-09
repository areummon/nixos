// Credentials out of the log. The log is append-only and every view hands it
// to every future turn, so a key pasted once would stay forever. Unlike
// upstream's `memo note`, which refuses the write, the log here is every
// message, so the key is replaced and the rest of the message kept. The shapes
// are upstream's (VictorTaelin/OptMem PR 18, from gitleaks' default rules):
// only shapes that are hardly ever anything else. hermes-plugins/optmem/redact.py
// holds the same patterns; keep the two in step.

export const MARK = "[redacted]";

// An `sk-` key holds hyphens only after a vendor's prefix, and otherwise wants
// a digit: `sk-learn-v1-2-notes` is a word, not a key.
const TOKEN = new RegExp(
  "(?<![A-Za-z0-9])(?:"
  + "sk-(?:ant|proj|svcacct|admin|None|or)-[\\w-]{20,}"
  + "|sk-(?=\\w*\\d)[A-Za-z0-9_]{20,}"
  + "|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\\w{30,}"
  + "|(?:AKIA|ASIA)[0-9A-Z]{16}"
  + "|xox[abeprs]-[A-Za-z0-9-]{10,}|xapp-[A-Za-z0-9-]{10,}"
  + "|AIza[0-9A-Za-z_-]{35}|ya29\\.[\\w-]{20,}"
  + "|[rs]k_(?:live|test)_[0-9A-Za-z]{20,}"
  + "|glpat-[A-Za-z0-9_-]{20,}"
  + "|hf_[A-Za-z0-9]{30,}|npm_[A-Za-z0-9]{36}"
  + "|eyJ[\\w-]{8,}\\.eyJ[\\w-]{8,}\\.[\\w-]*"
  + "|pypi-AgEIcHlwaS5vcmc[\\w-]{20,}|sbp_[0-9a-f]{40}|sb_secret_(?=[\\w-]*\\d)[\\w-]{16,}"
  + "|do[opr]_v1_[0-9a-f]{64}|SG\\.[\\w-]{22}\\.[\\w-]{43}|SK[0-9a-fA-F]{32}"
  + "|tskey-[a-z]+-(?=[\\w-]*\\d)[\\w-]{16,}|lin_api_[A-Za-z0-9]{40}|ops_eyJ[\\w+/]{40,}"
  + "|whsec_[A-Za-z0-9+/]{24,}|shp(?:at|ca|pa|ss)_[0-9a-fA-F]{32}"
  + "|dapi[0-9a-f]{32}|AGE-SECRET-KEY-1[0-9A-Z]{58}"
  + "|hooks\\.slack\\.com/(?:services|workflows|triggers)/[A-Za-z0-9+/]{20,}"
  + ")",
  "g",
);

// A key block, to its END line, or to the end of the text when a cut dropped it.
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g;

// A password written into a URL. Kept: a variable or placeholder, an earlier
// redaction, and the user's own name (postgres:postgres).
const URL_PASSWORD = /(:\/\/([^\s/:@]+):)([^\s/@]+)(@)/g;
const PLACEHOLDER = /^(?:[$<{%*[]|(?:x+|X+|\.+|redacted|password|secret|pass)$)/i;

export function redact(text: string): string {
  if (!text) return text;
  return text
    .replace(PRIVATE_KEY, "[redacted private key]")
    .replace(TOKEN, MARK)
    .replace(URL_PASSWORD, (all, head, user, pw, at) => (pw === user || PLACEHOLDER.test(pw) ? all : head + MARK + at));
}
