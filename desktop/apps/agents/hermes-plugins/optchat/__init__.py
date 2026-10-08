"""OptChat: one chat that never ends, as a Hermes MemoryProvider.

Every message of every session is logged word for word under <hermes_home>/optchat/, a cheap
model compresses the log into a binary tree of one-line summaries, and each session starts
with the view: summary lines covering the whole chat, recent ones fine and old ones coarse.
The agent zooms a line open with ``optchat_zoom``. Design: UniiChat/OptChat (spec §1-6).

Config: ``memory.optchat`` in config.yaml overrides ``model.Config``'s defaults.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from agent.memory_provider import MemoryProvider, spawn_context_thread

from .compaction import hermes_call
from .memory import Memory, acquire, release
from .model import Config
from .prompt import SYSTEM_PROMPT_BLOCK

logger = logging.getLogger(__name__)

ZOOM_SCHEMA = {
    "name": "optchat_zoom",
    "description": (
        "Open line id+n of the <chat> memory view into the two lines of n/2 messages it was made "
        "from; n = 1 gives message id whole. n is a power of 2 and id a multiple of n."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "id": {"type": "integer", "description": "The line's first message id."},
            "n": {"type": "integer", "description": "How many messages the line covers."},
        },
        "required": ["id", "n"],
    },
}

DATE_SCHEMA = {
    "name": "optchat_date",
    "description": "The date and time of message id in the <chat> memory view.",
    "parameters": {
        "type": "object",
        "properties": {"id": {"type": "integer", "description": "The message id."}},
        "required": ["id"],
    },
}


def _load_config() -> Config:
    try:
        from hermes_cli.config import cfg_get, load_config_readonly

        return Config.from_mapping(cfg_get(load_config_readonly(), "memory", "optchat", default={}))
    except Exception as exc:
        logger.warning("optchat: config unreadable (%s); using defaults", exc)
        return Config()


def _clean_user(text: str) -> Optional[str]:
    """The user's own words: without the <memory-context> block Hermes appends to multimodal
    content (string content keeps it in the api_content sidecar instead), and for a /skill turn
    the instruction alone, not the skill body."""
    from agent.memory_manager import sanitize_context
    from agent.skill_commands import extract_user_instruction_from_skill_message

    return extract_user_instruction_from_skill_message(sanitize_context(text))


def _warn_if_view_spills(cfg: Config) -> None:
    """Hermes spills a prefetch over ``hooks.output_spill.max_chars`` (10,000 by default) to a file
    and injects a 1 KB preview instead, which would replace the view with its first lines."""
    try:
        from tools.hook_output_spill import get_spill_config

        spill = get_spill_config()
    except Exception:
        return
    if spill.get("enabled") and spill.get("max_chars", 0) < cfg.view_bytes * 5 // 4:
        logger.warning(
            "optchat: hooks.output_spill.max_chars=%s is below the view (up to %s bytes); "
            "raise it or the view is cut to a preview", spill.get("max_chars"), cfg.view_bytes,
        )


class OptChatProvider(MemoryProvider):
    def __init__(self, config: Optional[Config] = None, call=None):
        self._config = config
        self._call = call
        self._mem: Optional[Memory] = None
        self._writes = False
        self._platform = ""

    @property
    def name(self) -> str:
        return "optchat"

    def is_available(self) -> bool:
        return True

    def initialize(self, session_id: str, **kwargs) -> None:
        cfg = self._config or _load_config()
        call = self._call or (hermes_call(cfg) if cfg.compactor == "model" else None)
        root = Path(kwargs["hermes_home"]) / "optchat"
        self._mem = acquire(root, cfg, call=call, spawn=spawn_context_thread)
        # Subagents, cron and flush agents read the chat but never write it; nor does a second
        # process (the CLI while the gateway holds the lock).
        self._writes = self._mem.writable and kwargs.get("agent_context", "primary") == "primary"
        self._platform = str(kwargs.get("platform") or "")
        if not self._mem.writable:
            logger.info("optchat: %s is locked by another process; read-only", root)
        _warn_if_view_spills(cfg)

    def system_prompt_block(self) -> str:
        return SYSTEM_PROMPT_BLOCK if self._mem else ""

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        if not self._mem or not self._mem.take_injection(session_id):
            return ""
        self._mem.refresh()
        return self._mem.render()

    def sync_turn(self, user_content: str, assistant_content: str, *, session_id: str = "",
                  messages: Optional[List[Dict[str, Any]]] = None, **kwargs) -> None:
        if not (self._mem and self._writes):
            return
        source = f"{self._platform}:{session_id}"
        if messages is None:
            messages = [{"role": "user", "content": user_content}, {"role": "assistant", "content": assistant_content}]
            self._mem.forget_session(session_id)
        self._mem.ingest(session_id, messages, source, _clean_user)

    def on_session_switch(self, new_session_id: str, *, parent_session_id: str = "", reset: bool = False,
                          rewound: bool = False, **kwargs) -> None:
        if self._mem:
            self._mem.forget_session(new_session_id)

    def on_delegation(self, task: str, result: str, *, child_session_id: str = "", **kwargs) -> None:
        if self._mem and self._writes and (result or "").strip():
            name = child_session_id or "delegate"
            self._mem.log("work", f"[{name}] task: {task}\n{result}", f"{self._platform}:{name}")

    def on_memory_write(self, action: str, target: str, content: str,
                        metadata: Optional[Dict[str, Any]] = None) -> None:
        if not (self._mem and self._writes):
            return
        meta = metadata or {}
        previous = meta.get("previous_content")
        text = f"memory {action} ({target}): {content or ''}"
        if previous and previous != content:
            text += f"\nprevious: {previous}"
        self._mem.log("note", text, f"{self._platform}:{meta.get('session_id', '')}")

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        return [ZOOM_SCHEMA, DATE_SCHEMA]

    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs) -> str:
        from tools.registry import tool_error

        if not self._mem:
            return tool_error("optchat is not initialized")
        try:
            self._mem.refresh()
            if tool_name == "optchat_zoom":
                return json.dumps({"result": self._mem.zoom(int(args["id"]), int(args["n"]))}, ensure_ascii=False)
            if tool_name == "optchat_date":
                return json.dumps({"result": self._mem.date(int(args["id"]))})
        except (KeyError, TypeError, ValueError) as exc:
            return tool_error(f"bad arguments: {exc}")
        return tool_error(f"Unknown tool: {tool_name}")

    def shutdown(self) -> None:
        if self._mem:
            release(self._mem)
            self._mem = None


def register(ctx) -> None:
    ctx.register_memory_provider(OptChatProvider())
