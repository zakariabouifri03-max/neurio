"""Generic undo/redo stack based on reversible command objects.

A command is any object with ``do()`` and ``undo()`` methods (or the pair of
callables passed to :class:`Command`).  Editors wrap their mutations in
commands so the same history powers Ctrl+Z everywhere.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable


@dataclass
class Command:
    """A reversible action described by two callables and a label."""

    label: str
    do_fn: Callable[[], None]
    undo_fn: Callable[[], None]

    def do(self) -> None:
        self.do_fn()

    def undo(self) -> None:
        self.undo_fn()


@dataclass
class UndoStack:
    limit: int = 200
    _undo: list[Command] = field(default_factory=list)
    _redo: list[Command] = field(default_factory=list)
    on_change: Callable[[], None] | None = None

    def push(self, command: Command, execute: bool = True) -> None:
        if execute:
            command.do()
        self._undo.append(command)
        if len(self._undo) > self.limit:
            self._undo.pop(0)
        self._redo.clear()
        self._notify()

    def undo(self) -> bool:
        if not self._undo:
            return False
        cmd = self._undo.pop()
        cmd.undo()
        self._redo.append(cmd)
        self._notify()
        return True

    def redo(self) -> bool:
        if not self._redo:
            return False
        cmd = self._redo.pop()
        cmd.do()
        self._undo.append(cmd)
        self._notify()
        return True

    def can_undo(self) -> bool:
        return bool(self._undo)

    def can_redo(self) -> bool:
        return bool(self._redo)

    def undo_label(self) -> str:
        return self._undo[-1].label if self._undo else ""

    def redo_label(self) -> str:
        return self._redo[-1].label if self._redo else ""

    def clear(self) -> None:
        self._undo.clear()
        self._redo.clear()
        self._notify()

    def _notify(self) -> None:
        if self.on_change:
            self.on_change()
