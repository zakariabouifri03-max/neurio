from PySide6.QtCore import QAbstractTableModel, Qt, QModelIndex, QRectF
from PySide6.QtGui import QColor, QPainter
from PySide6.QtWidgets import QStyledItemDelegate, QStyle
from .models import CHUNK_SIZE, chunk_range


def human_bytes(value):
    if value is None:
        return 'Unknown'
    for unit in ('B', 'KiB', 'MiB', 'GiB', 'TiB'):
        if abs(value) < 1024 or unit == 'TiB':
            return f'{value:,.1f} {unit}' if unit != 'B' else f'{value:,.0f} B'
        value /= 1024


def eta_text(seconds):
    if seconds is None:
        return '—'
    seconds = int(seconds)
    if seconds >= 3600:
        return f'{seconds//3600}h {seconds%3600//60}m'
    return f'{seconds//60}m {seconds%60}s'


class DownloadTableModel(QAbstractTableModel):
    headers = ['FILE', 'SIZE', 'PROGRESS', 'SPEED', 'STATUS']
    def __init__(self, manager):
        super().__init__()
        self.manager, self.rows = manager, []
        self.filter = 'All downloads'

    def refresh(self):
        rows = sorted(self.manager.db.downloads(), key=lambda d: -d.priority)
        groups = {'Active': ('downloading', 'verifying', 'assembling'), 'Queue': ('queued', 'paused', 'interrupted'),
                  'Completed': ('completed',), 'Failed': ('failed', 'cancelled')}
        if self.filter in groups:
            rows = [d for d in rows if d.status in groups[self.filter]]
        if [d.id for d in rows] != [d.id for d in self.rows]:
            self.beginResetModel()
            self.rows = rows
            self.endResetModel()
        else:
            self.rows = rows
            if rows:
                self.dataChanged.emit(self.index(0, 0), self.index(len(rows)-1, 4))

    def rowCount(self, parent=QModelIndex()):
        return 0 if parent.isValid() else len(self.rows)

    def columnCount(self, parent=QModelIndex()):
        return 5

    def headerData(self, section, orientation, role=Qt.DisplayRole):
        if role == Qt.DisplayRole and orientation == Qt.Horizontal:
            return self.headers[section]

    def data(self, index, role=Qt.DisplayRole):
        if not index.isValid():
            return None
        d = self.rows[index.row()]
        s = self.manager.snapshots.get(d.id, {})
        percent = s.get('percent', 100 if d.status == 'completed' else 0)
        if role == Qt.UserRole:
            return percent if index.column() == 2 else d.id
        if role == Qt.ToolTipRole:
            return d.error or d.destination
        if role == Qt.ForegroundRole and index.column() == 4:
            return QColor('#6cd5b0' if d.status == 'completed' else '#ff929f' if d.status == 'failed' else '#a899ff')
        if role == Qt.DisplayRole:
            return [d.filename, human_bytes(d.size), f'{percent:.1f}%',
                    human_bytes(s.get('speed', 0))+'/s' if d.status == 'downloading' else '—', d.status.capitalize()][index.column()]


class ProgressDelegate(QStyledItemDelegate):
    def paint(self, painter, option, index):
        if index.column() != 2:
            return super().paint(painter, option, index)
        painter.save()
        self.initStyleOption(option, index)
        option.text = ''
        option.widget.style().drawControl(QStyle.CE_ItemViewItem,
                                          option, painter, option.widget)
        rect = option.rect.adjusted(12, 0, -12, 0)
        percent = index.data(Qt.UserRole) or 0
        painter.setPen(QColor('#e0dafa'))
        painter.drawText(rect.adjusted(0, -7, 0, 0), Qt.AlignVCenter, f'{percent:.1f}%')
        track = QRectF(rect.left(), rect.center().y()+10, rect.width(), 4)
        painter.setRenderHint(QPainter.Antialiasing)
        painter.setPen(Qt.NoPen)
        painter.setBrush(QColor('#303548'))
        painter.drawRoundedRect(track, 2, 2)
        track.setWidth(track.width()*min(100, percent)/100)
        painter.setBrush(QColor('#9381ff'))
        painter.drawRoundedRect(track, 2, 2)
        painter.restore()


class ChunkTableModel(QAbstractTableModel):
    """Virtual rows, bounded 128-row database pages; never creates per-chunk widgets."""
    headers = ['CHUNK', 'BYTE RANGE', 'EXPECTED', 'RECEIVED', 'PROGRESS', 'STATUS', 'RETRIES']
    def __init__(self, manager):
        super().__init__()
        self.manager, self.download, self.pages = manager, None, {}

    def select(self, download):
        self.beginResetModel()
        self.download, self.pages = download, {}
        self.endResetModel()

    def refresh(self):
        self.pages.clear()
        if self.rowCount():
            self.dataChanged.emit(self.index(0, 0), self.index(self.rowCount()-1, 6))

    def rowCount(self, parent=QModelIndex()):
        return 0 if parent.isValid() or not self.download else self.download.count

    def columnCount(self, parent=QModelIndex()):
        return 7

    def headerData(self, section, orientation, role=Qt.DisplayRole):
        if role == Qt.DisplayRole and orientation == Qt.Horizontal:
            return self.headers[section]

    def data(self, index, role=Qt.DisplayRole):
        if not index.isValid() or role != Qt.DisplayRole:
            return None
        d, i = self.download, index.row()
        page = i//128
        if page not in self.pages:
            if len(self.pages) > 8:
                self.pages.clear()
            self.pages[page] = {r['idx']: r for r in self.manager.db.chunks(d.id, page*128, 128)}
        row = self.pages[page].get(i, {})
        size, status = row.get('bytes', 0), row.get('status', 'pending')
        running = self.manager.running.get(d.id)
        if running:
            with running[0].lock:
                size = running[0].progress.get(i, size)
        start, end = chunk_range(d.size, i) if d.ranges else (0, d.size-1 if d.size else None)
        expected = end-start+1 if end is not None else None
        return [str(i), f'{start:,}–{end:,}' if end is not None else 'Single stream', human_bytes(expected),
                human_bytes(size), f'{100*size/expected:.1f}%' if expected else '—', status, str(row.get('retries', 0))][index.column()]
