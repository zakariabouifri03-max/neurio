"""Optional CI-only diagnostics for a windowed executable (no console attached)."""
import os
import sys
import traceback

path = os.environ.get('ULTRADOWNLOAD_DIAGNOSTIC_FILE')
if path:
    stream = open(path, 'a', encoding='utf-8', buffering=1)
    sys.stdout = sys.stderr = stream

    def report(kind, value, tb):
        traceback.print_exception(kind, value, tb, file=stream)
        stream.flush()
        os._exit(1)

    sys.excepthook = report
