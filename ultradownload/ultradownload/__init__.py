"""UltraDownload — professional parallel download manager.

A Windows desktop download manager built with PySide6 that splits large
files (up to tens of gigabytes) into up to 40 byte ranges and downloads
all ranges concurrently over separate HTTP connections, whenever the
server supports HTTP Range requests.
"""

__version__ = "1.0.0"
__app_name__ = "UltraDownload"
__author__ = "UltraDownload Project"
