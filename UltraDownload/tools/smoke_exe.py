"""Launch the actual bundled application, enforce a deadline, record its hash."""
from pathlib import Path
import hashlib
import subprocess
import sys


def main():
    exe = Path(sys.argv[1]).resolve()
    try:
        result = subprocess.run([str(exe), '--smoke-test'], timeout=60, check=True)
    except (OSError, subprocess.SubprocessError) as error:
        print(f'Packaged executable smoke test FAILED: {error}', file=sys.stderr)
        return 1
    digest = hashlib.sha256()
    with exe.open('rb') as source:
        while block := source.read(1024*1024):
            digest.update(block)
    checksum = digest.hexdigest()
    exe.with_suffix('.exe.sha256').write_text(f'{checksum}  {exe.name}\n', encoding='ascii')
    print(f'Packaged EXE smoke test passed: exit code {result.returncode}')
    print(f'EXE size: {exe.stat().st_size:,} bytes')
    print(f'SHA-256: {checksum}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
