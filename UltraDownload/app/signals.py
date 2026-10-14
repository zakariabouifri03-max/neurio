from PySide6.QtCore import QObject, Signal


class Signals(QObject):
    progress = Signal(dict)
    changed = Signal()
    inspected = Signal(object, str)
    error = Signal(str)
