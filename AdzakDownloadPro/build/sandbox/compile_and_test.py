#!/usr/bin/env python3
"""
ADZAK DOWNLOAD PRO — sandbox verification harness.

This environment has no .NET SDK and no NuGet access, so this script verifies the
Core engine and its test suite WITHOUT the SDK:

  1. Hosts a real .NET Core 3.1 runtime in-process (pythonnet + clr_loader).
  2. Loads Roslyn 4.8 (C# 12) from a set of DLLs downloaded from a public GitHub repo,
     inside a custom AssemblyLoadContext (the framework ships older
     System.Collections.Immutable / System.Reflection.Metadata versions).
  3. Compiles the SAME .cs sources that ship in the repo
     (src/AdzakDownloadPro.Core, tests/AdzakDownloadPro.Tests) against the
     .NET Core 3.1 runtime assemblies. The shipped csproj files target net8.0;
     the Core code deliberately sticks to an API surface that exists in both
     .NET Core 3.1 and .NET 8, so what is verified here is what ships.
  4. Runs the compiled test assembly with the real `dotnet` host and reports results.

The WPF application project cannot be compiled without the Windows Desktop reference
assemblies (NuGet is unreachable here); its C# sources are syntax-checked with Roslyn
instead (see --check-wpf).

Environment variables (all optional, sensible defaults for this sandbox):
  ADZAK_DOTNET_BIN   dir containing the `dotnet` muxer of a .NET Core 3.1 runtime
  ADZAK_ROSLYN_DIR   dir with Microsoft.CodeAnalysis.dll, Microsoft.CodeAnalysis.CSharp.dll,
                     System.Collections.Immutable.dll, System.Reflection.Metadata.dll
  ADZAK_OSSL_DIR     dir with libssl.so.1.1 / libcrypto.so.1.1 (OpenSSL 1.1 for the 3.1 crypto PAL)
  ADZAK_REPO         repository root (default: auto-detected from this script's location)
"""

import glob
import os
import subprocess
import sys

TOOLS = os.environ.get("ADZAK_TOOLS", "/tmp/tools")
DOTNET_BIN = os.environ.get("ADZAK_DOTNET_BIN", os.path.join(TOOLS, "dotnetcore2/dotnetcore2/bin"))
ROSLYN_DIR = os.environ.get("ADZAK_ROSLYN_DIR",
                            os.path.join(TOOLS, "roslyn4/SmartAuditor-master/Editor/Plugins/Roslyn"))
OSSL_DIR = os.environ.get("ADZAK_OSSL_DIR", os.path.join(TOOLS, "ossl11"))
VENV_PYTHON = os.environ.get("ADZAK_VENV_PYTHON", os.path.join(TOOLS, "venv/bin/python"))
RUNTIMECONFIG = os.environ.get("ADZAK_RUNTIMECONFIG", os.path.join(TOOLS, "runtimeconfig.json"))

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("ADZAK_REPO", os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..")))

OUT_DIR = os.path.join(SCRIPT_DIR, "out")

CHECK_WPF = "--check-wpf" in sys.argv


def log(msg):
    print(msg, flush=True)


def die(msg):
    print("ERROR: " + msg, file=sys.stderr, flush=True)
    sys.exit(1)


def ensure_ld_library_path():
    """The dynamic loader reads LD_LIBRARY_PATH only at process start, and the .NET Core 3.1
    crypto PAL needs OpenSSL 1.1 (libssl.so.1.1). If it is missing, re-exec ourselves with it."""
    if not (OSSL_DIR and os.path.isdir(OSSL_DIR)):
        return
    current = os.environ.get("LD_LIBRARY_PATH", "")
    if OSSL_DIR in current.split(os.pathsep):
        return
    env = dict(os.environ)
    env["LD_LIBRARY_PATH"] = OSSL_DIR + (os.pathsep + current if current else "")
    log("Re-exec with LD_LIBRARY_PATH=" + env["LD_LIBRARY_PATH"])
    os.execve(sys.executable, [sys.executable] + sys.argv, env)


def host_clr():
    os.environ["DOTNET_ROOT"] = DOTNET_BIN
    os.environ["DOTNET_SYSTEM_GLOBALIZATION_INVARIANT"] = "1"

    from pythonnet import set_runtime
    from clr_loader import get_coreclr
    set_runtime(get_coreclr(runtime_config=RUNTIMECONFIG))
    import clr  # noqa: F401
    import System
    log("Hosted CLR: " + System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription)


def load_roslyn():
    """Loads Roslyn into a custom AssemblyLoadContext (the Default context rejects the
    newer System.Collections.Immutable / System.Reflection.Metadata versions)."""
    import clr
    import System
    from System.Reflection import Assembly
    from System.Runtime.Loader import AssemblyLoadContext

    preload = [
        "System.Collections.Immutable.dll",
        "System.Reflection.Metadata.dll",
        "Microsoft.CodeAnalysis.dll",
        "Microsoft.CodeAnalysis.CSharp.dll",
    ]

    class RoslynLoadContext(AssemblyLoadContext):
        def __init__(self, name, preload_dir):
            super().__init__(name, False)
            self._preload_dir = preload_dir
            self._map = {}

        def Load(self, assemblyName):
            n = assemblyName.Name
            if n in self._map:
                return self._map[n]
            p = os.path.join(self._preload_dir, n + ".dll")
            if os.path.exists(p):
                asm = self.LoadFromAssemblyPath(p)
                self._map[n] = asm
                return asm
            return None

    alc = RoslynLoadContext("roslyn", ROSLYN_DIR)
    for name in preload:
        p = os.path.join(ROSLYN_DIR, name)
        if not os.path.exists(p):
            die("Roslyn DLL not found: " + p)
        asm = alc.LoadFromAssemblyPath(p)
        alc._map[name[:-4]] = asm
        log("  loaded " + name + " " + str(asm.GetName().Version))

    def resolve_default(sender, args):
        n = args.Name.split(",")[0]
        if n in alc._map:
            return alc._map[n]
        return None

    System.AppDomain.CurrentDomain.AssemblyResolve += System.ResolveEventHandler(resolve_default)

    clr.AddReference("Microsoft.CodeAnalysis")
    clr.AddReference("Microsoft.CodeAnalysis.CSharp")

    csa = alc._map["Microsoft.CodeAnalysis.CSharp"]
    log("Roslyn CSharp assembly version: " + str(csa.GetName().Version))
    return alc


def framework_references():
    rt = glob.glob(os.path.join(DOTNET_BIN, "shared", "Microsoft.NETCore.App", "*"))
    if not rt:
        die("No Microsoft.NETCore.App shared framework under " + DOTNET_BIN)
    rt_dir = sorted(rt)[-1]
    dlls = sorted(glob.glob(os.path.join(rt_dir, "*.dll")))
    log("Runtime framework dir: " + rt_dir + " (" + str(len(dlls)) + " assemblies)")
    from Microsoft.CodeAnalysis import MetadataReference
    refs = []
    for dll in dlls:
        refs.append(MetadataReference.CreateFromFile(dll))
    return refs


def compile_project(name, source_dirs, references, output_dll, output_kind, assembly_name=None):
    from System.Collections.Generic import List
    from System.IO import Directory, File, FileStream, Path, FileMode, FileAccess
    from Microsoft.CodeAnalysis import MetadataReference, SyntaxTree, OutputKind, NullableContextOptions, OptimizationLevel
    from Microsoft.CodeAnalysis.CSharp import (
        CSharpCompilation, CSharpCompilationOptions, CSharpParseOptions,
        CSharpSyntaxTree, LanguageVersion,
    )

    parse_options = CSharpParseOptions.Default.WithLanguageVersion(LanguageVersion.Latest)
    trees = List[SyntaxTree]()
    total_files = 0
    for src_dir in source_dirs:
        for cs in sorted(glob.glob(os.path.join(src_dir, "**", "*.cs"), recursive=True)):
            with open(cs, "r", encoding="utf-8-sig") as f:
                text = f.read()
            tree = CSharpSyntaxTree.ParseText(text, parse_options, cs)
            trees.Add(tree)
            total_files += 1
    log("  {0}: {1} source files".format(name, total_files))

    options = CSharpCompilationOptions(output_kind)
    options = options.WithNullableContextOptions(NullableContextOptions.Enable)
    options = options.WithOptimizationLevel(OptimizationLevel.Release)
    options = options.WithDeterministic(True)

    refs = List[MetadataReference]()
    for r in references:
        refs.Add(r)

    compilation = CSharpCompilation.Create(
        assembly_name or name,
        trees,
        refs,
        options,
    )

    Directory.CreateDirectory(os.path.dirname(output_dll))
    errors = 0
    warnings = 0
    with FileStream(output_dll, FileMode.Create, FileAccess.Write) as fs:
        result = compilation.Emit(fs)
        for d in result.Diagnostics:
            sev = str(d.Severity)
            if sev == "Error":
                errors += 1
                log("  ERROR " + str(d))
            elif sev == "Warning":
                warnings += 1
                log("  warning " + str(d))
        if not result.Success:
            die("Compilation of {0} failed with {1} error(s).".format(name, errors))
    log("  {0}: compiled -> {1} ({2} warnings)".format(name, output_dll, warnings))
    return output_dll


def syntax_check_dir(source_dir):
    """Parses every .cs file and reports syntax errors (used for the WPF project,
    which cannot be fully compiled without the Windows Desktop reference assemblies)."""
    from Microsoft.CodeAnalysis.CSharp import CSharpSyntaxTree, LanguageVersion
    from Microsoft.CodeAnalysis.CSharp import CSharpParseOptions

    parse_options = CSharpParseOptions.Default.WithLanguageVersion(LanguageVersion.Latest)
    files = sorted(glob.glob(os.path.join(source_dir, "**", "*.cs"), recursive=True))
    errors = 0
    for cs in files:
        with open(cs, "r", encoding="utf-8-sig") as f:
            text = f.read()
        tree = CSharpSyntaxTree.ParseText(text, parse_options, cs)
        diags = tree.GetDiagnostics()
        for d in diags:
            if str(d.Severity) == "Error":
                errors += 1
                log("  SYNTAX ERROR " + cs + ": " + str(d))
    log("  syntax-checked {0} file(s) in {1}: {2} error(s)".format(len(files), source_dir, errors))
    return errors


def main():
    log("Repo: " + REPO)
    core_dir = os.path.join(REPO, "src", "AdzakDownloadPro.Core")
    tests_dir = os.path.join(REPO, "tests", "AdzakDownloadPro.Tests")
    wpf_dir = os.path.join(REPO, "src", "AdzakDownloadPro")
    for d in (core_dir, tests_dir):
        if not os.path.isdir(d):
            die("Missing project directory: " + d)

    os.makedirs(OUT_DIR, exist_ok=True)

    host_clr()
    load_roslyn()

    from Microsoft.CodeAnalysis import MetadataReference, OutputKind

    log("Compiling AdzakDownloadPro.Core ...")
    refs = framework_references()
    core_dll = compile_project(
        "AdzakDownloadPro.Core",
        [core_dir],
        refs,
        os.path.join(OUT_DIR, "AdzakDownloadPro.Core.dll"),
        OutputKind.DynamicallyLinkedLibrary,
        assembly_name="AdzakDownloadPro.Core",
    )

    log("Compiling AdzakDownloadPro.Tests ...")
    test_refs = list(refs)
    test_refs.append(MetadataReference.CreateFromFile(core_dll))
    tests_dll = compile_project(
        "AdzakDownloadPro.Tests",
        [tests_dir],
        test_refs,
        os.path.join(OUT_DIR, "AdzakDownloadPro.Tests.dll"),
        OutputKind.ConsoleApplication,
        assembly_name="AdzakDownloadPro.Tests",
    )

    if CHECK_WPF:
        log("Syntax-checking the WPF application sources (full compile needs the Windows Desktop ref pack) ...")
        wpf_errors = syntax_check_dir(wpf_dir)
        if wpf_errors:
            die("WPF syntax check failed with {0} error(s).".format(wpf_errors))
        log("WPF syntax check passed.")

    # runtimeconfig for running the tests with the 3.1 host
    runtimeconfig = os.path.join(OUT_DIR, "AdzakDownloadPro.Tests.runtimeconfig.json")
    with open(runtimeconfig, "w") as f:
        f.write("""{
  "runtimeOptions": {
    "tfm": "netcoreapp3.1",
    "framework": {
      "name": "Microsoft.NETCore.App",
      "version": "3.1.23"
    },
    "configProperties": {
      "System.Globalization.Invariant": true
    }
  }
}
""")

    dotnet = os.path.join(DOTNET_BIN, "dotnet")
    env = dict(os.environ)
    env["DOTNET_SYSTEM_GLOBALIZATION_INVARIANT"] = "1"
    if OSSL_DIR and os.path.isdir(OSSL_DIR):
        env["LD_LIBRARY_PATH"] = OSSL_DIR + (os.pathsep + env["LD_LIBRARY_PATH"]
                                            if env.get("LD_LIBRARY_PATH") else "")

    log("Running test suite ...")
    log("=" * 72)
    proc = subprocess.run([dotnet, tests_dll, "--timeout=180"], env=env, cwd=OUT_DIR)
    log("=" * 72)
    if proc.returncode == 0:
        log("SANDBOX VERIFICATION: ALL TESTS PASSED")
        return 0
    log("SANDBOX VERIFICATION: FAILED (exit code {0})".format(proc.returncode))
    return proc.returncode


if __name__ == "__main__":
    ensure_ld_library_path()
    sys.exit(main())
