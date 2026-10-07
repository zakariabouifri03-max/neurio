"""Undo / redo.

Every user visible action is wrapped in a command.  The stack is "unlimited"
in the sense that the user can configure the depth (0 = unlimited, limited by
memory); drawing commands store compressed PNG snapshots which keeps even long
sessions cheap.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from PySide6.QtCore import QObject, Signal


class Command:
    """Base class for anything that can be undone."""

    def undo(self) -> None: ...
    def redo(self) -> None: ...


@dataclass
class FuncCommand(Command):
    """Generic command built from two closures."""

    label: str = "Action"
    _undo: Callable[[], None] | None = None
    _redo: Callable[[], None] | None = None

    def undo(self) -> None:
        self._undo()

    def redo(self) -> None:
        self._redo()


class MacroCommand(Command):
    def __init__(self, label: str, commands: list[Command] | None = None):
        self.label = label
        self.commands: list[Command] = commands or []

    def add(self, cmd: Command) -> None:
        self.commands.append(cmd)

    def undo(self) -> None:
        for cmd in reversed(self.commands):
            cmd.undo()

    def redo(self) -> None:
        for cmd in self.commands:
            cmd.redo()

    def __bool__(self) -> bool:
        return bool(self.commands)


class History(QObject):
    changed = Signal()
    action_done = Signal(str, bool)      # label, is_redo

    def __init__(self, depth: int = 0, parent=None):
        super().__init__(parent)
        self.depth = depth                # 0 = unlimited
        self.undo_stack: list[Command] = []
        self.redo_stack: list[Command] = []
        self._macro: MacroCommand | None = None
        self._blocked = False

    # ------------------------------------------------------------------ api
    def block(self, blocked: bool = True) -> None:
        self._blocked = blocked

    def push(self, cmd: Command | None, merge: bool = False) -> None:
        if cmd is None or self._blocked:
            return
        if isinstance(cmd, MacroCommand) and not cmd:
            return
        if self._macro is not None:
            self._macro.add(cmd)
            return
        if merge and self.undo_stack and getattr(self.undo_stack[-1], "label", "") == cmd.label:
            # coalesce repeated identical micro edits (slider drags, colour pick)
            prev = self.undo_stack[-1]
            if isinstance(prev, FuncCommand) and isinstance(cmd, FuncCommand):
                prev._redo = cmd._redo
                self.redo_stack.clear()
                self.changed.emit()
                return
        self.undo_stack.append(cmd)
        self.redo_stack.clear()
        if self.depth and len(self.undo_stack) > self.depth:
            self.undo_stack = self.undo_stack[-self.depth:]
        self.changed.emit()

    def begin_macro(self, label: str) -> None:
        if self._macro is None:
            self._macro = MacroCommand(label)

    def end_macro(self) -> None:
        macro = self._macro
        self._macro = None
        if macro and macro:
            self.push(macro)

    def undo(self) -> str | None:
        if not self.undo_stack:
            return None
        cmd = self.undo_stack.pop()
        self._blocked = True
        try:
            cmd.undo()
        finally:
            self._blocked = False
        self.redo_stack.append(cmd)
        self.changed.emit()
        self.action_done.emit(getattr(cmd, "label", "Action"), False)
        return getattr(cmd, "label", "Action")

    def redo(self) -> str | None:
        if not self.redo_stack:
            return None
        cmd = self.redo_stack.pop()
        self._blocked = True
        try:
            cmd.redo()
        finally:
            self._blocked = False
        self.undo_stack.append(cmd)
        self.changed.emit()
        self.action_done.emit(getattr(cmd, "label", "Action"), True)
        return getattr(cmd, "label", "Action")

    def clear(self) -> None:
        self.undo_stack.clear()
        self.redo_stack.clear()
        self.changed.emit()

    @property
    def can_undo(self) -> bool:
        return bool(self.undo_stack)

    @property
    def can_redo(self) -> bool:
        return bool(self.redo_stack)

    def undo_label(self) -> str:
        return getattr(self.undo_stack[-1], "label", "") if self.undo_stack else ""

    def redo_label(self) -> str:
        return getattr(self.redo_stack[-1], "label", "") if self.redo_stack else ""

    def stack_size(self) -> tuple[int, int]:
        return len(self.undo_stack), len(self.redo_stack)
