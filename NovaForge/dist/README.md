# dist/ - download snapshots

`NovaForge-<version>-snapshot.zip` is a **lean archive of the engine sources**
(tracked files only: `engine/`, `tests/`, `third_party/`, `build.py`, docs -
no build output, no object files, no binaries). It is regenerated with

```
python3 build.py --snapshot
```

Direct download:

```
https://github.com/zakariabouifri03-max/neurio/raw/arena/7a4391b3-neurio/NovaForge/dist/NovaForge-0.1.0-snapshot.zip
```

Or clone just this folder without pulling the rest of the repository:

```
git clone --depth 1 --filter=blob:none --sparse \
    -b arena/7a4391b3-neurio https://github.com/zakariabouifri03-max/neurio.git
cd neurio && git sparse-checkout set NovaForge
```

Then build it (Linux/macOS/Windows, needs Python 3 and ~1 GB of disk):

```
cd NovaForge
python3 -m pip install ziglang        # the zig cc toolchain used by build.py
python3 build.py --target tests --jobs 4
./build/tests/novaforge_tests
```
