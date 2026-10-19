from pathlib import Path
import subprocess

import pytest

from novacut.exporter import ExportError, ExportSettings, ExportThread, FFmpegCommandBuilder
from novacut.media import ffmpeg_capabilities, find_ffmpeg
from novacut.models import MediaAsset, Project
from novacut.timeline import TimelineOperations


def project_for_builder(tmp_path: Path) -> Project:
    source = tmp_path / "source.mp4"
    source.write_bytes(b"not decoded by the command builder")
    project = Project.create("Export graph")
    project.media["video"] = MediaAsset(
        id="video", path=str(source), name="source.mp4", kind="video", duration=8,
        width=1920, height=1080, fps=30, has_video=True, has_audio=True,
    )
    clip = TimelineOperations.add_media_clip(project, "video", project.tracks[2].id, 1, 1, 7)
    clip.effects.update({
        "brightness": 0.1,
        "contrast": 1.2,
        "saturation": 0.9,
        "denoise": True,
        "crop": {"left": 0.1, "top": 0.05, "width": 0.8, "height": 0.9},
    })
    clip.fade_in = 0.2
    clip.fade_out = 0.25
    clip.volume = 0.7
    TimelineOperations.add_title(project, "NovaCut, locally edited", project.tracks[0].id, 2, 2)
    return project


def test_builder_composites_video_audio_titles_and_non_destructive_effects(tmp_path):
    project = project_for_builder(tmp_path)
    title_file = tmp_path / "titles.ass"
    settings = ExportSettings(str(tmp_path / "out.mp4"), width=1280, height=720, fps=30)
    command = FFmpegCommandBuilder.build(
        project, settings, ffmpeg_path="/not/used/ffmpeg", encoders={"libx264", "aac"},
        filters={"ass", "overlay", "afftdn"}, output_override=str(tmp_path / "render.mp4"), titles_path=title_file,
    )
    graph = command[command.index("-filter_complex") + 1]
    assert "[0:v:0]trim=start=1.000000:duration=6.000000" in graph
    assert "eq=brightness=0.10000:contrast=1.20000:saturation=0.90000" in graph
    assert "crop=w=trunc(iw*0.800000/2)*2" in graph
    assert "fade=t=in" in graph and "fade=t=out" in graph
    assert "afftdn=" in graph
    assert "amix=inputs=1" in graph
    assert "ass=filename=" in graph
    assert "[outv]" in graph
    assert command[command.index("-map") + 1] == "[outv]"
    assert "[aout]" in command
    assert title_file.is_file()
    title_script = title_file.read_text(encoding="utf-8-sig")
    assert "NovaCut, locally edited" in title_script
    assert "PlayResX: 1920" in title_script


def test_builder_reports_missing_codec_and_media(tmp_path):
    project = project_for_builder(tmp_path)
    settings = ExportSettings(str(tmp_path / "out.mp4"))
    with pytest.raises(ExportError, match="libx264"):
        FFmpegCommandBuilder.build(project, settings, "/fake/ffmpeg", encoders=set(), filters=set())

    project.media["video"].path = str(tmp_path / "gone.mp4")
    with pytest.raises(ExportError, match="missing"):
        FFmpegCommandBuilder.build(project, settings, "/fake/ffmpeg", encoders={"libx264"}, filters={"ass", "overlay"})


def test_title_sidecar_uses_ass_timing_color_and_fade(tmp_path):
    project = Project.create("Text")
    clip = TimelineOperations.add_title(project, "line one\nline two", project.tracks[0].id, 3.2, 1.5)
    clip.title_color = "#23a4ff"
    clip.title_size = 42
    clip.fade_in = 0.2
    clip.fade_out = 0.3
    path = FFmpegCommandBuilder.write_ass_titles(project, tmp_path / "captions.ass")
    contents = path.read_text(encoding="utf-8-sig")
    assert "0:00:03.20,0:00:04.70" in contents
    assert "\\1c&HFFA423&" in contents
    assert "\\fad(200,300)" in contents
    assert "line one\\Nline two" in contents


def test_actual_ffmpeg_render_and_media_validation(tmp_path):
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        pytest.skip("FFmpeg was not configured; set NOVACUT_FFMPEG to run integration rendering")
    capabilities = ffmpeg_capabilities(ffmpeg)
    if "libx264" not in capabilities["encoders"] or not {"overlay", "ass"}.issubset(capabilities["filters"]):
        pytest.skip("FFmpeg build lacks libx264, overlay, or libass integration filters")

    source = tmp_path / "synthetic-test.mp4"
    create = subprocess.run([
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=22050",
        "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(source),
    ], capture_output=True, text=True, timeout=45)
    assert create.returncode == 0, create.stderr

    project = Project.create("FFmpeg integration")
    project.media["synthetic"] = MediaAsset(
        id="synthetic", path=str(source), name=source.name, kind="video", duration=2,
        width=160, height=90, fps=10, has_video=True, has_audio=True,
    )
    first = TimelineOperations.add_media_clip(project, "synthetic", project.tracks[2].id, 0, 0, 1)
    second = TimelineOperations.add_media_clip(project, "synthetic", project.tracks[2].id, 1, 1, 2)
    first.fade_in = 0.1
    second.fade_out = 0.1
    first.effects.update({"denoise": True, "denoise_strength": 12})
    TimelineOperations.add_title(project, "Render smoke test", project.tracks[0].id, 0.2, 1.5)
    output = tmp_path / "full-project.mp4"
    settings = ExportSettings(str(output), width=320, height=180, fps=10, quality=28)
    command = FFmpegCommandBuilder.build(project, settings, ffmpeg, capabilities["encoders"], str(output),
                                         filters=capabilities["filters"], titles_path=tmp_path / "titles.ass")
    rendered = subprocess.run(command, capture_output=True, text=True, timeout=90)
    assert rendered.returncode == 0, rendered.stderr[-4000:]
    assert output.is_file() and output.stat().st_size > 10_000
    verify = subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(output), "-f", "null", "-"],
                            capture_output=True, text=True, timeout=30)
    assert verify.returncode == 0, verify.stderr

    # Exercise the asynchronous worker's FFmpeg progress and success/error signals.
    thread_output = tmp_path / "worker-render.mp4"
    worker = ExportThread(project, ExportSettings(str(thread_output), width=320, height=180, fps=10, quality=28), ffmpeg)
    completed = []
    failures = []
    progress = []
    worker.succeeded.connect(completed.append)
    worker.failed.connect(failures.append)
    worker.progress.connect(lambda value, eta: progress.append(value))
    worker.run()
    assert not failures
    assert completed == [str(thread_output)]
    assert thread_output.is_file()
    assert progress and progress[-1] == 100


def test_export_worker_reports_empty_project_error(tmp_path):
    from novacut.exporter import ExportThread
    project = Project.create("Empty")
    failures = []
    worker = ExportThread(project, ExportSettings(str(tmp_path / "empty.mp4")), ffmpeg_path="/any/ffmpeg")
    worker.failed.connect(failures.append)
    worker.run()
    assert failures and "timeline is empty" in failures[0]
