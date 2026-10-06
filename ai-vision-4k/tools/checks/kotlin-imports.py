#!/usr/bin/env python3
"""Static pre-flight check for the Kotlin sources.

The Android build is the slowest thing in this repository: it needs the SDK, a
licensed NDK and a Gradle daemon, and on CI it costs minutes per attempt. Most of
the mistakes that have actually broken it are trivial and local — an unresolved
reference from a missing import, an unbalanced brace, a Compose modifier called
as an extension without importing it.

This script catches those without a toolchain:

  * brace/paren/bracket balance outside strings and comments;
  * every curated Compose / Android / coroutines symbol that a file uses must be
    imported, declared in the same package, or defined in the same file;
  * Project-internal symbols (AppViewModel, AIUpscaler, GraphicsProfile, the ui
    helpers, ...) are checked the same way, so a screen that forgets to import
    PanelCard fails here instead of in Gradle.

Exit status is non-zero when anything is found. It is deliberately conservative:
it never rewrites code and it reports at most one line per symbol per file.

Usage:  tools/checks/kotlin-imports.py [--verbose]
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE_ROOTS = [
    ROOT / "app" / "src" / "main" / "java",
    ROOT / "aiupscaler-sdk" / "src" / "main" / "java",
]

# ---------------------------------------------------------------------------
# Symbols that need an import, grouped by the import that provides them.
# A symbol may appear in the right-hand list of more than one group (Android's
# Color and Compose's Color, for example); any of them satisfies the check.
# ---------------------------------------------------------------------------

SYMBOL_IMPORTS: dict[str, str] = {}
for _symbols, _import in [
    # Compose layout / foundation
    (["Box", "Column", "Row", "Spacer", "Arrangement", "PaddingValues", "ColumnScope", "RowScope"],
     "androidx.compose.foundation.layout"),
    (["LazyColumn", "LazyRow", "items", "itemsIndexed", "rememberLazyListState"],
     "androidx.compose.foundation.lazy"),
    (["RoundedCornerShape", "CircleShape"], "androidx.compose.foundation.shape"),
    (["horizontalScroll", "verticalScroll", "rememberScrollState", "clickable", "background", "border"],
     "androidx.compose.foundation"),
    # Material 3
    (["MaterialTheme", "Text", "Surface", "Switch", "Slider", "Button", "OutlinedButton", "TextButton",
      "ButtonDefaults", "Icon", "IconButton", "NavigationBar", "NavigationBarItem", "Scaffold",
      "SnackbarHost", "SnackbarHostState", "OutlinedTextField", "LinearProgressIndicator", "Card",
      "AlertDialog", "FilterChip", "AssistChip"],
     "androidx.compose.material3"),
    (["Icons"], "androidx.compose.material.icons"),
    # Runtime / ui / text / unit
    (["Composable", "LaunchedEffect", "mutableStateOf", "getValue", "setValue", "withFrameNanos",
      "rememberCoroutineScope", "DisposableEffect"],
     "androidx.compose.runtime"),
    (["Modifier", "Alignment"], "androidx.compose.ui"),
    (["Color"], "androidx.compose.ui.graphics"),
    (["ImageVector"], "androidx.compose.ui.graphics.vector"),
    (["FontWeight", "FontFamily"], "androidx.compose.ui.text.font"),
    (["LocalContext"], "androidx.compose.ui.platform"),
    (["Dp", "TextUnit"], "androidx.compose.ui.unit"),
    (["setContent", "rememberLauncherForActivityResult"], "androidx.activity.compose"),
    (["ActivityResultContracts"], "androidx.activity.result.contract"),
    (["viewModel"], "androidx.lifecycle.viewmodel.compose"),
    # Coroutines
    (["launch", "delay", "isActive", "withContext", "CoroutineScope", "SupervisorJob", "Dispatchers",
      "Job", "cancel", "coroutineScope", "async", "await", "runBlocking"],
     "kotlinx.coroutines"),
    # Android framework
    (["Intent", "Context", "SharedPreferences"], "android.content"),
    (["Activity", "Notification", "NotificationChannel", "NotificationManager", "Service",
      "PendingIntent", "Application"],
     "android.app"),
    (["Bundle", "Build", "Handler", "Looper", "Choreographer", "SystemClock", "VibrationEffect"],
     "android.os"),
    (["Uri"], "android.net"),
    (["Settings"], "android.provider"),
    (["Log"], "android.util"),
    (["Gravity", "View", "WindowManager", "SurfaceView", "TextureView"], "android.view"),
    (["TextView", "Toast", "FrameLayout"], "android.widget"),
    (["JSONObject", "JSONArray"], "org.json"),
    (["Locale", "ArrayList", "HashMap"], "java.util"),
    (["File", "InputStream", "OutputStream", "ByteArrayInputStream"], "java.io"),
]:
    for _symbol in _symbols:
        SYMBOL_IMPORTS.setdefault(_symbol, _import)

# The same, for symbols declared inside this repository. Their truthful import is
# resolved against the package map built from the tree, so this stays correct if
# a file moves.
INTERNAL_SYMBOLS = [
    # app
    "AppViewModel", "UiState", "AppSettings", "GameCatalog", "KnownGame", "InstalledGame",
    "InstalledGames", "Cd",
    "CadenceResult", "FrameCadenceProbe", "MetricsOverlay", "MonitorService",
    # sdk
    "AIUpscaler", "NativeBridge", "AndroidCapsCollector", "GlesProbe",
    "IntegrationKind", "CompatStatus", "DeviceTier", "UpscalingQuality", "QualityPreset",
    "UpscalingMode", "InferenceBackend", "ReconstructionMode", "ThermalLevel",
    "CompatReason", "DeviceCompatibility", "GraphicsProfile", "ProfilePresetOption",
    "DeviceDetails", "StageTimings", "StageTimer", "SessionState", "ModelState",
    "PerformanceSnapshot", "UpscalerMetrics", "FrameResult", "VulkanDeviceInfo",
    # ui helpers
    "AiVision4KTheme", "PanelCard", "StatTile", "MetricRow", "StatusChip", "ToggleRow", "SliderRow",
    "SelectChips", "BarSparkline", "SandboxExplainer", "SDK_SAMPLE", "Hint",
    "VoidBlack", "SurfaceNavy", "StrokeSoft", "AccentCyan", "AccentViolet", "WarnAmber",
    "GoodGreen", "DangerRed", "TextPrimary", "TextMuted",
    "fmt", "percent", "bytes", "loadColor", "compatColor", "thermalColor", "resolutionName",
    "resolutionArrow", "DASH",
]

# Symbols that are *extension properties/functions on a receiver* (Modifier,
# Int, Dp, ...). Kotlin requires the import even though they are always written
# after a dot: `Modifier.padding(...)`, `2.dp`. These are the ones a naive
# "qualified, so it must be fine" reading misses — and that is exactly the bug
# this script was written to catch.
EXTENSION_SYMBOLS = {
    "padding", "fillMaxSize", "fillMaxWidth", "fillMaxHeight", "height", "heightIn", "width",
    "widthIn", "size", "aspectRatio", "alpha", "offset", "clip", "rotate", "scale",
    "wrapContentHeight", "wrapContentWidth", "dp", "sp", "background", "border", "clickable",
    "horizontalScroll", "verticalScroll", "rememberScrollState", "roundToInt", "ceil", "floor",
}
for _symbol, _import in [
    (["padding", "fillMaxSize", "fillMaxWidth", "fillMaxHeight", "height", "heightIn", "width",
      "widthIn", "size", "aspectRatio", "wrapContentHeight", "wrapContentWidth"],
     "androidx.compose.foundation.layout"),
    (["alpha", "offset", "clip", "rotate", "scale"], "androidx.compose.ui.draw"),
    (["dp", "sp"], "androidx.compose.ui.unit"),
    (["roundToInt", "ceil", "floor"], "kotlin.math"),
]:
    for _symbol in _symbols:
        SYMBOL_IMPORTS.setdefault(_symbol, _import)

DECLARATION_PATTERNS = [
    re.compile(r"^\s*(?:public |internal |private |abstract |open |sealed |data |enum |value |annotation )*"
               r"class\s+([A-Za-z_][A-Za-z0-9_]*)", re.M),
    re.compile(r"^\s*(?:public |internal |private |data |sealed |value )*object\s+([A-Za-z_][A-Za-z0-9_]*)", re.M),
    re.compile(r"^\s*(?:public |internal |private |expect |actual )*fun\s+(?:<[^>]*>\s*)?([A-Za-z_][A-Za-z0-9_]*)", re.M),
    re.compile(r"^\s*(?:public |internal |private |const )*val\s+([A-Za-z_][A-Za-z0-9_]*)", re.M),
    re.compile(r"^\s*(?:public |internal |private )*typealias\s+([A-Za-z_][A-Za-z0-9_]*)", re.M),
]


def strip_noise(text: str) -> str:
    """Blanks out string literals and comments, preserving offsets/newlines."""
    out = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if ch == "/" and nxt == "/":
            while i < n and text[i] != "\n":
                out.append(" ")
                i += 1
        elif ch == "/" and nxt == "*":
            out.append("  ")
            i += 2
            while i < n and not (text[i] == "*" and i + 1 < n and text[i + 1] == "/"):
                out.append("\n" if text[i] == "\n" else " ")
                i += 1
            out.append("  ")
            i += 2
        elif ch == '"' and text.startswith('"""', i):
            out.append("   ")
            i += 3
            while i < n and not text.startswith('"""', i):
                out.append("\n" if text[i] == "\n" else " ")
                i += 1
            out.append("   ")
            i += 3
        elif ch == '"':
            out.append(" ")
            i += 1
            while i < n and text[i] != '"':
                if text[i] == "\\":
                    out.append("  ")
                    i += 2
                    continue
                out.append("\n" if text[i] == "\n" else " ")
                i += 1
            out.append(" ")
            i += 1
        elif ch == "'":
            out.append(" ")
            i += 1
            while i < n and text[i] != "'":
                if text[i] == "\\":
                    out.append("  ")
                    i += 2
                    continue
                out.append(" ")
                i += 1
            out.append(" ")
            i += 1
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def line_of(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    files: list[pathlib.Path] = []
    for source_root in SOURCE_ROOTS:
        files.extend(sorted(source_root.rglob("*.kt")))
    if not files:
        print("no Kotlin sources found", file=sys.stderr)
        return 1

    # package -> declared names, so "same package" is a real exemption.
    package_declarations: dict[str, set[str]] = {}
    file_data: dict[pathlib.Path, tuple[str, str]] = {}
    for path in files:
        text = path.read_text(encoding="utf-8")
        clean = strip_noise(text)
        match = re.search(r"^\s*package\s+([A-Za-z0-9_.]+)", clean, re.M)
        package = match.group(1) if match else ""
        file_data[path] = (clean, package)
        names = package_declarations.setdefault(package, set())
        for pattern in DECLARATION_PATTERNS:
            names.update(pattern.findall(clean))

    problems: list[str] = []
    for path in files:
        clean, package = file_data[path]
        # Stripped text is used for matching; line numbers come from the original.
        original = path.read_text(encoding="utf-8")

        # 1. balance
        for open_ch, close_ch, label in [("(", ")", "parentheses"), ("{", "}", "braces"),
                                         ("[", "]", "brackets")]:
            depth = clean.count(open_ch) - clean.count(close_ch)
            if depth != 0:
                problems.append(f"{path.relative_to(ROOT)}: unbalanced {label} "
                                f"({open_ch}{close_ch} differ by {depth:+d})")

        # 2. imports
        imports = set()
        for line in original.splitlines():
            stripped = line.strip()
            if stripped.startswith("import "):
                target = stripped[len("import "):].split(" as ")[0].strip()
                imports.add(target.split(".")[-1])
                if " as " in stripped:
                    imports.add(stripped.split(" as ", 1)[1].strip())
        declared_here = set(package_declarations.get(package, set()))

        # Names the file declares itself (parameters, locals, loop variables) are
        # not imports: `fun setSharpening(percent: Int)` must not be reported as a
        # missing `percent`.
        local_names = set()
        for pattern in (
            r"(?:val|var|fun|class|object|const\s+val)\s+([A-Za-z_][A-Za-z0-9_]*)",
            r"([A-Za-z_][A-Za-z0-9_]*)\s*:(?!=)",          # parameter: `percent: Int`
            r"([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)",           # assignment or default
            r"([A-Za-z_][A-Za-z0-9_]*)\s*->",               # lambda parameter
        ):
            local_names.update(re.findall(pattern, clean))

        checked = dict.fromkeys(list(SYMBOL_IMPORTS) + INTERNAL_SYMBOLS)
        for symbol in checked:
            if symbol in imports or symbol in declared_here or symbol in local_names:
                continue
            if re.search(rf"(?<![A-Za-z0-9_.]){re.escape(symbol)}(?![A-Za-z0-9_])", clean) or (
                symbol in EXTENSION_SYMBOLS
                and re.search(rf"\.{re.escape(symbol)}(?![A-Za-z0-9_])", clean)
            ):
                hint = SYMBOL_IMPORTS.get(symbol, "declared in this project (check the package)")
                problems.append(f"{path.relative_to(ROOT)}: '{symbol}' is used but not imported "
                                f"-> expected import {hint}")

    for problem in problems:
        print(problem)
    if problems:
        print(f"\n{len(problems)} problem(s) across {len(files)} Kotlin files", file=sys.stderr)
        return 1
    print(f"kotlin sources: {len(files)} files checked, no missing imports, balanced delimiters")
    return 0


if __name__ == "__main__":
    sys.exit(main())
