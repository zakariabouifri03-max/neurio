"""MotionForge Studio - professional 2D animation studio for Windows.

The package is deliberately split into layers so that the animation engine can
be unit-tested head-less (no widgets, no window) while the Qt UI stays thin:

    mfs.model    - document data model (project / scene / layer / cel / rig ...)
    mfs.engine   - rendering, drawing tools, interpolation, playback, history
    mfs.ai       - pluggable AI providers + the offline animation director
    mfs.io       - .mfs project format, importers, exporters
    mfs.ui       - PySide6 desktop user interface
"""

__all__ = ["__version__", "APP_NAME", "APP_ID", "ORG_NAME", "BUILD", "FILE_EXT"]

APP_NAME = "MotionForge Studio"
APP_ID = "MotionForgeStudio"
ORG_NAME = "MotionForge"
VENDOR = "MotionForge Studio"
__version__ = "1.0.0"
BUILD = "2026.10"

FILE_EXT = ".mfs"
PROJECT_MAGIC = "MOTIONFORGE-STUDIO-PROJECT"
PROJECT_FORMAT_VERSION = 1
