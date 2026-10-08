"""Small, offline-only helpers used by Neurio Coder."""
from __future__ import annotations

import os
import re
from pathlib import Path, PurePosixPath
from typing import Dict, List


# Only source/text formats are ever sent as local-model context.
TEXT_SUFFIXES = {
    ".c", ".cc", ".cpp", ".cs", ".css", ".dart", ".gd", ".go", ".h",
    ".hpp", ".html", ".htm", ".java", ".js", ".jsx", ".json", ".kt",
    ".lua", ".md", ".mjs", ".php", ".py", ".rb", ".rs", ".sass",
    ".scss", ".sh", ".sql", ".svelte", ".swift", ".toml", ".ts", ".tsx",
    ".txt", ".vue", ".xml", ".yaml", ".yml",
}
SKIP_DIRS = {
    ".git", ".hg", ".svn", ".idea", ".vscode", ".next", ".nuxt",
    ".venv", "venv", "env", "node_modules", "__pycache__", "dist",
    "build", "coverage", "target", "vendor",
}
SECRET_NAMES = {
    "id_rsa", "id_ed25519", "credentials", "credentials.json",
    "secrets.json", "secret.json", "config.secret.json",
}

_FILE_BLOCK_RE = re.compile(
    r"<file\s+path\s*=\s*(['\"])(.*?)\1\s*>(.*?)</file\s*>",
    re.IGNORECASE | re.DOTALL,
)
_FENCED_FILE_RE = re.compile(
    r"```(?:file|path)\s*[: ]\s*([^\r\n]+)\s*\r?\n(.*?)```",
    re.IGNORECASE | re.DOTALL,
)
_CODE_BLOCK_RE = re.compile(
    r"```(?:[A-Za-z0-9_+.#-]+)?\s*\r?\n(.*?)```",
    re.DOTALL,
)


def _strip_outer_fence(content: str) -> str:
    """Remove one accidental Markdown fence around a file's contents."""
    match = re.fullmatch(
        r"\s*```(?:[A-Za-z0-9_+.#-]+)?\s*\r?\n(.*?)\r?\n```\s*",
        content,
        re.DOTALL,
    )
    return match.group(1) if match else content.strip("\r\n")


def parse_generated_files(response: str, target_name: str = "main.py") -> Dict[str, str]:
    """Extract generated files from Neurio's tagged format or a single code block.

    Preferred model format is ``<file path="relative/path">...``. A response
    containing one ordinary fenced code block can also be saved to target_name.
    Multiple unlabelled code blocks are intentionally not guessed.
    """
    files: Dict[str, str] = {}

    for match in _FILE_BLOCK_RE.finditer(response):
        path = match.group(2).strip()
        content = _strip_outer_fence(match.group(3))
        if path:
            files[path] = content
    if files:
        return files

    for match in _FENCED_FILE_RE.finditer(response):
        path = match.group(1).strip().strip("`\"'")
        content = _strip_outer_fence(match.group(2))
        if path:
            files[path] = content
    if files:
        return files

    code_blocks = _CODE_BLOCK_RE.findall(response)
    if len(code_blocks) == 1 and target_name.strip():
        return {target_name.strip(): code_blocks[0].rstrip("\r\n")}
    return {}


def safe_workspace_target(workspace: os.PathLike[str] | str, relative_path: str) -> Path:
    """Resolve a relative output path and reject traversal or symlink escapes."""
    raw = relative_path.strip().replace("\\", "/")
    if not raw or raw.startswith("/") or re.match(r"^[A-Za-z]:", raw):
        raise ValueError("Use a relative file path inside the workspace.")

    pure = PurePosixPath(raw)
    if any(part in {"", ".", ".."} for part in pure.parts):
        raise ValueError("The file path cannot contain '.' or '..' path segments.")

    root = Path(workspace).expanduser().resolve()
    target = root.joinpath(*pure.parts).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError("The file path must stay inside the selected workspace.") from exc
    return target


def parse_ollama_models(output: str) -> List[str]:
    """Parse names from the plain-text output of the local ``ollama list`` CLI."""
    models: List[str] = []
    for line in output.splitlines():
        parts = line.split()
        if parts and parts[0].upper() != "NAME" and ":" in parts[0]:
            # Ollama also exposes hosted/cloud models through its CLI. Keep
            # those out of the picker so this app remains strictly local.
            if "cloud" not in parts[0].casefold():
                models.append(parts[0])
    return models


def workspace_context(
    workspace: os.PathLike[str] | str,
    max_files: int = 35,
    max_chars: int = 42000,
) -> str:
    """Read a bounded set of source files, skipping secrets and build folders."""
    root = Path(workspace).expanduser().resolve()
    if not root.is_dir():
        return ""

    candidates: List[Path] = []
    for current, dirs, names in os.walk(root, followlinks=False):
        dirs[:] = sorted(
            name for name in dirs
            if name not in SKIP_DIRS and not name.startswith(".")
            and not (Path(current) / name).is_symlink()
        )
        for name in sorted(names):
            item = Path(current) / name
            lower = name.lower()
            if item.is_symlink() or lower.startswith(".env") or lower in SECRET_NAMES:
                continue
            if item.suffix.lower() not in TEXT_SUFFIXES:
                continue
            try:
                item.resolve().relative_to(root)
                if item.stat().st_size > max_chars * 4:
                    continue
            except (OSError, ValueError):
                continue
            candidates.append(item)
            if len(candidates) >= max_files:
                break
        if len(candidates) >= max_files:
            break

    output: List[str] = []
    used = 0
    for item in candidates:
        rel = item.relative_to(root).as_posix()
        try:
            content = item.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue
        remaining = max_chars - used
        if remaining <= 0:
            break
        if len(content) > remaining:
            content = content[:remaining] + "\n...[context limit reached]"
        section = f"\n--- {rel} ---\n{content}\n"
        if used + len(section) > max_chars:
            section = section[: max_chars - used]
        output.append(section)
        used += len(section)

    if not output:
        return "(No source files found in this workspace yet.)"
    return "\nPROJECT SOURCE FILES (read-only context):\n" + "".join(output)
