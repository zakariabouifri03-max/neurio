"""Snapshot-based undo/redo history used by the timeline and image editor."""
from __future__ import annotations

import copy
from typing import Any, Optional


class History:
    def __init__(self, limit: int = 50):
        self.limit = max(1, limit)
        self._undo: list[Any] = []
        self._redo: list[Any] = []

    def push(self, state: Any) -> None:
        """Record `state` (the state BEFORE a change)."""
        self._undo.append(copy.deepcopy(state))
        if len(self._undo) > self.limit:
            del self._undo[0]
        self._redo.clear()

    def undo(self, current: Any) -> Optional[Any]:
        if not self._undo:
            return None
        self._redo.append(copy.deepcopy(current))
        return self._undo.pop()

    def redo(self, current: Any) -> Optional[Any]:
        if not self._redo:
            return None
        self._undo.append(copy.deepcopy(current))
        return self._redo.pop()

    @property
    def can_undo(self) -> bool:
        return bool(self._undo)

    @property
    def can_redo(self) -> bool:
        return bool(self._redo)

    def clear(self) -> None:
        self._undo.clear()
        self._redo.clear()
