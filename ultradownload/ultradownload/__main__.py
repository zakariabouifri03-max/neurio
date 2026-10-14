"""Allow ``python -m ultradownload``."""

from .main import main

if __name__ == "__main__":
    raise SystemExit(main())
