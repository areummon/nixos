#!/usr/bin/env bash
# Run the real pi binary on the working-tree extensions in a throwaway agent dir
# laid out like home-manager's: settings.json lists the extensions in load order,
# each a symlink, next to a node_modules link. Only auth and the model catalog
# are shared with ~/.pi/agent, as symlinks; nothing there is read or changed.
#
#   live-run.sh [-m model] [-x ext1,ext2] [-f fixture-dir] [-c name=json-file]... -- prompt...
#
# Prints the run dir; events.jsonl holds Pi's JSON event stream, agent/sessions the session file.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
model=openai-codex/gpt-6-luna
exts=gondolin,hashline,diagnostics,stream-rules,advisor,optmem
fixture=""
configs=()
while getopts "m:x:f:c:" opt; do
  case $opt in
    m) model=$OPTARG ;;
    x) exts=$OPTARG ;;
    f) fixture=$OPTARG ;;
    c) configs+=("$OPTARG") ;;
    *) exit 2 ;;
  esac
done
shift $((OPTIND - 1))

run=$(mktemp -d /tmp/pi-live.XXXXXX)
agent=$run/agent
mkdir -p "$run/proj" "$agent/pi-extensions" "$run/optmem/projects" "$run/optmem/global"
[ -n "$fixture" ] && cp -r "$fixture"/. "$run/proj/"
ln -s "$HOME/.pi/agent/npm/node_modules" "$agent/node_modules"
ln -s "$HOME/.pi/agent/auth.json" "$agent/auth.json"
ln -s "$HOME/.pi/agent/models-store.json" "$agent/models-store.json"

IFS=, read -ra names <<<"$exts"
for name in "${names[@]}"; do ln -s "$here/$name" "$agent/pi-extensions/$name"; done
node -e '
  const [agent, ...names] = process.argv.slice(1);
  const extensions = names.map((n) => agent + "/pi-extensions/" + n);
  require("fs").writeFileSync(agent + "/settings.json", JSON.stringify({ cacheWarming: "off", extensions }));
' "$agent" "${names[@]}"
export PI_CODING_AGENT_DIR=$agent

node -e '
  const [src, dst, dir] = process.argv.slice(1);
  const c = JSON.parse(require("fs").readFileSync(src, "utf8"));
  c.projectBaseDir = dir + "/projects";
  c.globalMemoryDir = dir + "/global";
  c.compactorModel = process.env.LIVE_COMPACTOR_MODEL || "openai-codex/gpt-6-luna";
  require("fs").writeFileSync(dst, JSON.stringify(c));
' "$HOME/.pi/agent/optmem.json" "$run/optmem.json" "$run/optmem"
export PI_OPTMEM_CONFIG=$run/optmem.json

for c in "${configs[@]}"; do
  name=${c%%=*}
  var=PI_$(echo "$name" | tr 'a-z-' 'A-Z_')_CONFIG
  cp "${c#*=}" "$run/$name.json"
  export "$var=$run/$name.json"
done

cd "$run/proj"
timeout "${LIVE_TIMEOUT:-240}" pi --model "$model" --mode json "$@" </dev/null \
  >"$run/events.jsonl" 2>"$run/stderr.log" || echo "pi exited $?" >>"$run/stderr.log"
echo "$run"
