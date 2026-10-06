# NovaForge Engine - convenience Makefile wrapper around tools/build.py
#
#   make            - native debug build (engine + tests + tool)
#   make test       - build and run the automated test suite
#   make windows    - cross-compile the real Windows editor + game runtime
#   make sim        - head-less simulation of the sample project
#   make samples    - regenerate the bundled sample projects
#   make clean

PY ?= python3
BUILD := build

.PHONY: all native test windows samples sim clean docs

all: native

native:
	$(PY) tools/build.py --target native --config release

debug:
	$(PY) tools/build.py --target native --config debug

test: native
	$(BUILD)/native/release/nftests/nftests

windows:
	$(PY) tools/build.py --target windows --config release

windows-debug:
	$(PY) tools/build.py --target windows --config debug

tools:
	$(PY) tools/make_samples.py

sim: native
	$(BUILD)/native/release/nftool/nftool sim samples/SampleIsland --frames 240

render: native
	$(BUILD)/native/release/nftool/nftool render samples/SampleIsland --frames 60

clean:
	rm -rf $(BUILD)
