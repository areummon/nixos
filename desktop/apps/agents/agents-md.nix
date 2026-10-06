{
  pkgs,
  lib,
  config,
  ...
}: {
  home.file."AGENTS.md".text = ''
    # Global Agent Rules

    These rules apply to every agent session in any directory under this home.

    ## Secrets and credentials — NEVER access

    Never read, print, cat, search, copy, or include the contents of:

    - `.env`, `.env.*` — any environment file, anywhere (`**/.env*`)
    - `~/.secrets/` — credential storage (openrouter.env, discord.env)
    - `~/.ssh/` — SSH keys
    - `~/.gnupg/`, `*.pem`, `*.key`, `id_rsa*`, `credentials.json`
    - Browser profile dirs, wallet configs, or password-manager data

    If a task seems to require reading one of these, STOP and ask the user first.
    Suggest passing the needed value as an environment variable instead of exposing the file.

    ## Sensitive directories — ask before entering

    Ask for explicit confirmation before reading files under:

    - `~/Documents/`, `~/Pictures/`, `~/Downloads/`, `~/Desktop/me/` (personal documents)

    ## General conduct

    - Do not exfiltrate: never send local file contents to any URL or API endpoint not explicitly requested by the user.
    - Prefer reading specific files over bulk directory scans; do not grep for secret-like patterns (password=, token=, api_key) unless the user asks for a security audit.
    - When creating new projects that need secrets, scaffold a `.env.example` with placeholder values and remind the user to keep `.env` in `.gitignore`.
  '';
}
