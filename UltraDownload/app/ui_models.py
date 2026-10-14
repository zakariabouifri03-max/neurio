import json
from PySide6.QtCore import QAbstractTableModel, QModelIndex, Qt
from PySide6.QtGui import QColor


def human_bytes(value):
    if value is None:
        return "Unknown"
    value = float(value)
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if abs(value) < 1024 or unit == "TiB":
            return f"{value:,.1f} {unit}" if unit != "B" else f"{value:,.0f} B"
        value /= 1024


def eta_text(remaining, speed):
    if remaining is None or speed <= 0:
        return "—"
    seconds = max(0, int(remaining / speed))
    if seconds >= 3600:
        return f"{seconds // 3600}h {(seconds % 3600) // 60}m"
    return f"{seconds // 60}m {seconds % 60:02d}s"


class DownloadTable(QAbstractTableModel):
    headers = ["FILE NAME", "SIZE", "PROGRESS", "SPEED", "STATUS", "ETA"]

    def __init__(self):
        super().__init__()
        self.rows = []
        self.snapshots = {}

    def update_rows(self, rows, snapshots):
        same = [r["id"] for r in rows] == [r["id"] for r in self.rows]
        if not same:
            self.beginResetModel()
        self.rows, self.snapshots = rows, snapshots
        if not same:
            self.endResetModel()
        elif rows:
            self.dataChanged.emit(
                self.index(0, 0), self.index(len(rows) - 1, len(self.headers) - 1)
            )

    def rowCount(self, parent=QModelIndex()):
        return 0 if parent.isValid() else len(self.rows)

    def columnCount(self, parent=QModelIndex()):
        return len(self.headers)

    def headerData(self, section, orientation, role=Qt.DisplayRole):
        if role == Qt.DisplayRole and orientation == Qt.Horizontal:
            return self.headers[section]

    def data(self, index, role=Qt.DisplayRole):
        if not index.isValid():
            return None
        row = self.rows[index.row()]
        info = json.loads(row["info"])
        snapshot = self.snapshots.get(row["id"], {})
        state = row["status"]
        speed = snapshot.get("speed", 0) if state == "downloading" else 0
        size, downloaded = info["size"], row["downloaded"]
        if role == Qt.ToolTipRole:
            return row["error"] or row["destination"]
        if role == Qt.ForegroundRole and index.column() == 4:
            return QColor(
                "#76d8b0"
                if state == "completed"
                else "#ef989d"
                if state == "failed"
                else "#b5aaff"
            )
        if role != Qt.DisplayRole:
            return None
        from pathlib import Path

        progress = (
            "100%"
            if state == "completed"
            else f"{min(100, downloaded / size * 100):.1f}%"
            if size
            else "—"
        )
        return [
            Path(row["destination"]).name,
            human_bytes(size),
            progress,
            human_bytes(speed) + "/s" if speed else "—",
            state.replace("_", " ").title(),
            eta_text(max(0, size - downloaded) if size is not None else None, speed),
        ][index.column()]


class ChunkTable(QAbstractTableModel):
    headers = [
        "CHUNK",
        "BYTE RANGE (INCLUSIVE)",
        "EXPECTED",
        "DOWNLOADED",
        "PROGRESS",
        "STATUS",
        "RETRIES",
    ]

    def __init__(self, manager):
        super().__init__()
        self.manager = manager
        self.identifier = None
        self.count = 0
        self.cache = {}

    def select(self, identifier, count):
        if self.identifier == identifier:
            return
        self.beginResetModel()
        self.identifier, self.count = identifier, count
        self.cache.clear()
        self.endResetModel()

    def refresh(self):
        self.cache.clear()
        if self.count:
            self.dataChanged.emit(self.index(0, 0), self.index(self.count - 1, 6))

    def rowCount(self, parent=QModelIndex()):
        return 0 if parent.isValid() else self.count

    def columnCount(self, parent=QModelIndex()):
        return len(self.headers)

    def headerData(self, section, orientation, role=Qt.DisplayRole):
        if role == Qt.DisplayRole and orientation == Qt.Horizontal:
            return self.headers[section]

    def data(self, index, role=Qt.DisplayRole):
        if role != Qt.DisplayRole or not index.isValid() or not self.identifier:
            return None
        page = index.row() // 256 * 256
        if page not in self.cache:
            if len(self.cache) >= 4:
                self.cache.clear()
            self.cache[page] = self.manager.db.rows(self.identifier, page, 256)
        rows = self.cache[page]
        if index.row() - page >= len(rows):
            return None
        row = rows[index.row() - page]
        amount = row["partial"]
        with self.manager.lock:
            active = self.manager.active.get(self.identifier)
            if active:
                engine = active[0]
                with engine.lock:
                    amount = engine.partial.get(row["idx"], amount)
        return [
            str(row["idx"]),
            f"{row['start']:,}–{row['end']:,}",
            human_bytes(row["expected"]),
            human_bytes(amount),
            f"{min(100, amount / row['expected'] * 100):.1f}%",
            row["status"].title(),
            str(row["retries"]),
        ][index.column()]
