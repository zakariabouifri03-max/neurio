"""Pure-Python command pattern with an undo/redo stack.

Every timeline mutation goes through a :class:`Command` so the whole edit
history is serialisable in behaviour and testable without Qt.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, List, Optional

from .events import Signal


class Command:
    """Base class for undoable operations."""

    def __init__(self, label: str = "") -> None:
        self.label = label or self.__class__.__name__

    def do(self) -> None:  # pragma: no cover - abstract
        raise NotImplementedError

    def undo(self) -> None:  # pragma: no cover - abstract
        raise NotImplementedError

    def merge_with(self, previous: "Command") -> bool:
        """Coalesce a continuous gesture (e.g. a slider drag) into one undo step.

        Return True when *previous* was absorbed. The previous command keeps
        responsibility for restoring the pre-gesture state.
        """
        return False


class CallbackCommand(Command):
    """Command built from do/undo callbacks (handy for tests and small edits)."""

    def __init__(self, label: str, do: Callable[[], None], undo: Callable[[], None]):
        super().__init__(label)
        self._do, self._undo = do, undo

    def do(self) -> None:
        self._do()

    def undo(self) -> None:
        self._undo()


@dataclass
class MergeResult:
    merged: bool


class MacroCommand(Command):
    """Composite command: children execute in order, undo in reverse."""

    def __init__(self, label: str, commands: list[Command]):
        super().__init__(label)
        self.commands = list(commands)

    def do(self) -> None:
        for cmd in self.commands:
            cmd.do()

    def undo(self) -> None:
        for cmd in reversed(self.commands):
            cmd.undo()


class UndoStack:
    """Bounded undo/redo stack with change notification and coalescing support."""

    def __init__(self, capacity: int = 200) -> None:
        self._undo: List[Command] = []
        self._redo: List[Command] = []
        self._capacity = capacity
        self._last_label: Optional[str] = None
        self.changed = Signal()
        self.undone = Signal()
        self.redone = Signal()

    # ------------------------------------------------------------------ state
    def can_undo(self) -> bool:
        return bool(self._undo)

    def can_redo(self) -> bool:
        return bool(self._redo)

    def undo_label(self) -> str:
        return self._undo[-1].label if self._undo else ""

    def redo_label(self) -> str:
        return self._redo[-1].label if self._redo else ""

    def labels(self) -> list[str]:
        return [c.label for c in self._undo]

    def clear(self) -> None:
        self._undo.clear()
        self._redo.clear()
        self._last_label = None
        self.changed.emit()

    # ------------------------------------------------------------- mutations
    def push(self, command: Command, merge: bool = False) -> None:
        """Execute *command* and store it.

        When *merge* is true and the previous command shares its label, the
        new command replaces it (used for continuous drag/trim gestures).
        """
        command.do()
        if merge and self._undo and self._undo[-1].label == command.label \
                and command.merge_with(self._undo[-1]):
            # The new command absorbed the previous one; keep the older entry
            # so a single undo restores the state before the whole gesture.
            pass
        else:
            self._undo.append(command)
        if len(self._undo) > self._capacity:
            self._undo.pop(0)
        self._redo.clear()
        self._last_label = command.label
        self.changed.emit()

    def undo(self) -> None:
        if not self._undo:
            return
        cmd = self._undo.pop()
        cmd.undo()
        self._redo.append(cmd)
        self._last_label = cmd.label
        self.changed.emit()
        self.undone.emit(cmd)

    def redo(self) -> None:
        if not self._redo:
            return
        cmd = self._redo.pop()
        cmd.do()
        self._undo.append(cmd)
        self._last_label = cmd.label
        self.changed.emit()
        self.redone.emit(cmd)

    def depth(self) -> int:
        return len(self._undo)
