"""Credentials out of the log. Pure: no I/O.

The log is append-only and every view hands it to every future session, so a key pasted once
would stay forever. Unlike upstream's ``memo note``, which refuses the write, the log here is
every message, so the key is replaced instead and the rest of the message kept. The shapes are
upstream's (VictorTaelin/OptMem PR 18, from gitleaks' default rules): only shapes that are
hardly ever anything else, since a miss costs a leak and a false alarm only a word.
pi-extensions/optmem/redact.ts holds the same patterns; keep the two in step.
"""

from __future__ import annotations

import re

MARK = "[redacted]"

# An ``sk-`` key holds hyphens only after a vendor's prefix, and otherwise wants a digit:
# ``sk-learn-v1-2-notes`` is a word, a real key of 20 random characters all but always holds one.
TOKEN = re.compile(
    r"(?<![A-Za-z0-9])(?:"
    r"sk-(?:ant|proj|svcacct|admin|None|or)-[\w-]{20,}"
    r"|sk-(?=\w*\d)[A-Za-z0-9_]{20,}"
    r"|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{30,}"
    r"|(?:AKIA|ASIA)[0-9A-Z]{16}"
    r"|xox[abeprs]-[A-Za-z0-9-]{10,}|xapp-[A-Za-z0-9-]{10,}"
    r"|AIza[0-9A-Za-z_-]{35}|ya29\.[\w-]{20,}"
    r"|[rs]k_(?:live|test)_[0-9A-Za-z]{20,}"
    r"|glpat-[A-Za-z0-9_-]{20,}"
    r"|hf_[A-Za-z0-9]{30,}|npm_[A-Za-z0-9]{36}"
    r"|eyJ[\w-]{8,}\.eyJ[\w-]{8,}\.[\w-]*"
    r"|pypi-AgEIcHlwaS5vcmc[\w-]{20,}|sbp_[0-9a-f]{40}|sb_secret_(?=[\w-]*\d)[\w-]{16,}"
    r"|do[opr]_v1_[0-9a-f]{64}|SG\.[\w-]{22}\.[\w-]{43}|SK[0-9a-fA-F]{32}"
    r"|tskey-[a-z]+-(?=[\w-]*\d)[\w-]{16,}|lin_api_[A-Za-z0-9]{40}|ops_eyJ[\w+/]{40,}"
    r"|whsec_[A-Za-z0-9+/]{24,}|shp(?:at|ca|pa|ss)_[0-9a-fA-F]{32}"
    r"|dapi[0-9a-f]{32}|AGE-SECRET-KEY-1[0-9A-Z]{58}"
    r"|hooks\.slack\.com/(?:services|workflows|triggers)/[A-Za-z0-9+/]{20,}"
    r")",
    re.ASCII,
)

# A key block, to its END line, or to the end of the text when a cut dropped it.
PRIVATE_KEY = re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?(?:-----END [A-Z ]*PRIVATE KEY-----|\Z)", re.S)

# A password written into a URL. Kept: a variable or placeholder, an earlier redaction, and the
# user's own name, the default of every local database (postgres:postgres).
URL_PASSWORD = re.compile(r"(://[^\s/:@]+:)([^\s/@]+)(@)")
_PLACEHOLDER = re.compile(r"[$<{%*\[]|(?:x+|X+|\.+|(?i:redacted|password|secret|pass))$")


def _password(m: re.Match) -> str:
    user, pw = m.group(1)[3:-1], m.group(2)
    if pw == user or _PLACEHOLDER.match(pw):
        return m.group(0)
    return m.group(1) + MARK + m.group(3)


def redact(text: str) -> str:
    """``text`` with every credential replaced by ``[redacted]``."""
    if not text:
        return text
    text = PRIVATE_KEY.sub("[redacted private key]", text)
    text = TOKEN.sub(MARK, text)
    return URL_PASSWORD.sub(_password, text)
