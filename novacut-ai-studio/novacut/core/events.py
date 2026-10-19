"""Tiny dependency-free signal/event bus (Qt-safe: just plain callbacks)."""
from __future__ import annotations

import weakref
from typing import Any, Callable


class Signal:
    """Minimal signal implementation supporting plain and weak-bound-method slots."""

    def __init__(self) -> None:
        self._slots: list[Callable] = []
        self._weak: list[weakref.WeakMethod] = []

    def connect(self, slot: Callable, weak: bool = False) -> Callable:
        if weak and hasattr(slot, "__self__"):
            self._weak.append(weakref.WeakMethod(slot))
        else:
            self._slots.append(slot)
        return slot

    def disconnect(self, slot: Callable) -> None:
        if slot in self._slots:
            self._slots.remove(slot)
        self._weak = [w for w in self._weak if w() not in (None, slot)]

    def emit(self, *args: Any, **kwargs: Any) -> None:
        for slot in list(self._slots):
            slot(*args, **kwargs)
        for ref in list(self._weak):
            slot = ref()
            if slot is not None:
                slot(*args, **kwargs)

    def __call__(self, *args: Any, **kwargs: Any) -> None:
        self.emit(*args, **kwargs)
