"""Launch the actual packaged EXE and fail on timeout, bad exit, or bad report."""
import json
import os
import traceback
import subprocess
import tempfile
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[1]
    exe = root / 'dist' / 'UltraDownload.exe'
    if not exe.is_file():
        raise FileNotFoundError(exe)
    report = root / 'dist' / 'exe-self-test.json'
    report.unlink(missing_ok=True)
    diagnostics = root / 'dist' / 'exe-diagnostics.txt'
    diagnostics.unlink(missing_ok=True)
    os.environ['ULTRADOWNLOAD_DIAGNOSTIC_FILE'] = str(diagnostics)
    os.environ['QT_QPA_PLATFORM'] = 'offscreen'
    with tempfile.TemporaryDirectory(prefix='UltraDownload-smoke-') as profile:
        subprocess.run([str(exe), '--smoke-test', '--data-dir', profile], check=True, timeout=60)
    subprocess.run([str(exe), '--self-test', str(report)], check=True, timeout=120)
    result = json.loads(report.read_text(encoding='utf-8'))
    if not result.get('passed') or result.get('peak_requests') != 10 or result.get('max_submitted') != 10:
        raise RuntimeError(f'EXE self-test failed: {result}')
    print('Packaged EXE launch and ten-worker exact-byte verification passed.')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        path = Path(__file__).resolve().parents[1] / 'dist' / 'exe-diagnostics.txt'
        details = path.read_text(encoding='utf-8')[-6000:] if path.exists() else 'No executable diagnostics were written.'
        message = (str(exc) + '\n' + details).replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
        print('::error title=Packaged executable diagnostic::' + message, flush=True)
        raise
