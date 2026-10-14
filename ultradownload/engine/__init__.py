"""UltraDownload parallel download engine (no Qt dependencies)."""

from .bandwidth import BandwidthLimiter, TokenBucket
from .errors import *  # noqa: F401,F403
from .inspector import URLInfo, inspect_url, validate_url
from .merger import assemble_file, verify_checksum
from .parts import PartState, PartStatus
from .ranges import ByteRange, compute_ranges, validate_coverage
from .speed import SpeedMeter
from .task import DownloadTask, TaskListener, TaskStatus, parse_content_range

__all__ = [
    "BandwidthLimiter", "TokenBucket", "URLInfo", "inspect_url", "validate_url",
    "assemble_file", "verify_checksum", "PartState", "PartStatus", "ByteRange",
    "compute_ranges", "validate_coverage", "SpeedMeter", "DownloadTask",
    "TaskListener", "TaskStatus", "parse_content_range",
]
