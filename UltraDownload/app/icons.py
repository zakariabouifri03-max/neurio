"""Small, original line icons rendered at device-independent resolution."""

from PySide6.QtCore import QByteArray, QRectF
from PySide6.QtGui import QIcon, QImage, QPainter, QPixmap
from PySide6.QtSvg import QSvgRenderer
from PySide6.QtWidgets import QStyle

PATHS = {
    QStyle.SP_DirHomeIcon: '<path d="M3 10l9-7 9 7M5 9v12h5v-7h4v7h5V9"/>',
    QStyle.SP_ArrowDown: '<path d="M12 3v13M7 11l5 5 5-5M4 18v3h16v-3"/>',
    QStyle.SP_FileDialogListView: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    QStyle.SP_DialogApplyButton: '<circle cx="12" cy="12" r="9"/><path d="M7 12l3 3 7-7"/>',
    QStyle.SP_MessageBoxWarning: '<path d="M12 3L2 21h20L12 3zM12 9v5M12 17h.01"/>',
    QStyle.SP_FileDialogDetailedView: '<path d="M3 6h18M3 12h18M3 18h18"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="9" cy="18" r="2"/>',
    QStyle.SP_DialogOpenButton: '<path d="M12 5v14M5 12h14"/>',
    QStyle.SP_MediaPause: '<path d="M8 5v14M16 5v14"/>',
    QStyle.SP_MediaPlay: '<path d="M7 4l14 8-14 8V4z"/>',
    QStyle.SP_BrowserReload: '<path d="M20 10a8 8 0 10-1 7M20 4v6h-6"/>',
    QStyle.SP_DialogCancelButton: '<path d="M6 6l12 12M18 6L6 18"/>',
    QStyle.SP_DirOpenIcon: '<path d="M3 8V5h6l2 3h10v12H3V8zM3 11h18"/>',
}


def line_icon(kind, color="#c6c2dc"):
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="{color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">{PATHS.get(kind, PATHS[QStyle.SP_ArrowDown])}</g></svg>'
    image = QImage(40, 40, QImage.Format_ARGB32)
    image.fill(0)
    painter = QPainter(image)
    QSvgRenderer(QByteArray(svg.encode())).render(painter, QRectF(0, 0, 40, 40))
    painter.end()
    pixmap = QPixmap.fromImage(image)
    pixmap.setDevicePixelRatio(2)
    return QIcon(pixmap)
