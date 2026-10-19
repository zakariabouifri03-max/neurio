import pytest

from novacut.models import MediaAsset, Project
from novacut.timeline import ProjectHistory, TimelineError, TimelineOperations


def project_with_media(duration=20.0):
    project = Project.create("Timeline tests")
    project.media["video"] = MediaAsset(
        id="video", path="/tmp/source.mp4", name="source.mp4", kind="video",
        duration=duration, width=1280, height=720, fps=30, has_video=True, has_audio=True,
    )
    return project


def test_split_and_duplicate_keep_source_ranges_editable():
    project = project_with_media()
    track_id = project.tracks[2].id
    clip = TimelineOperations.add_media_clip(project, "video", track_id, 2.0, 1.0, 9.0)
    clip.playback_rate = 2.0

    right = TimelineOperations.split(project, clip.id, 4.0)
    assert clip.source_in == 1.0
    assert clip.source_out == 5.0
    assert right.source_in == 5.0
    assert right.source_out == 9.0
    assert right.start == 4.0
    assert clip.duration == pytest.approx(2.0)
    assert right.duration == pytest.approx(2.0)

    duplicate = TimelineOperations.duplicate(project, right.id)
    assert duplicate.id != right.id
    assert duplicate.start == pytest.approx(right.end)
    assert duplicate.source_in == right.source_in


def test_trim_and_snap_respect_frame_minimum_and_nearby_edges():
    project = project_with_media()
    track_id = project.tracks[2].id
    first = TimelineOperations.add_media_clip(project, "video", track_id, 0.0, 0.0, 5.0)
    second = TimelineOperations.add_media_clip(project, "video", track_id, 6.0, 5.0, 10.0)
    snapped = TimelineOperations.snap_time(project, 5.96, first.id, pixels_per_second=100)
    assert snapped == pytest.approx(second.start)

    TimelineOperations.trim(project, first.id, "end", 4.0)
    assert first.source_out == pytest.approx(4.0)
    TimelineOperations.trim(project, first.id, "start", 1.0)
    assert first.start == pytest.approx(1.0)
    assert first.source_in == pytest.approx(1.0)
    with pytest.raises(TimelineError):
        TimelineOperations.trim(project, first.id, "right", 1.0)


def test_ripple_delete_closes_only_the_selected_track_gap():
    project = project_with_media()
    video_track = project.tracks[2].id
    audio_track = project.tracks[3].id
    project.media["audio"] = MediaAsset(
        id="audio", path="/tmp/music.wav", name="music.wav", kind="audio",
        duration=30, has_audio=True,
    )
    first = TimelineOperations.add_media_clip(project, "video", video_track, 0, 0, 4)
    removed = TimelineOperations.add_media_clip(project, "video", video_track, 4, 4, 7)
    later = TimelineOperations.add_media_clip(project, "video", video_track, 7, 7, 10)
    music = TimelineOperations.add_media_clip(project, "audio", audio_track, 7, 0, 10)
    TimelineOperations.delete(project, removed.id, ripple=True)
    assert project.clip(first.id)
    assert later.start == pytest.approx(4.0)
    assert music.start == pytest.approx(7.0)


def test_silence_cuts_become_separate_clips_and_ripple_next_clip():
    project = project_with_media()
    track_id = project.tracks[2].id
    clip = TimelineOperations.add_media_clip(project, "video", track_id, 2, 0, 10)
    next_clip = TimelineOperations.add_media_clip(project, "video", track_id, 12, 10, 15)

    segments = TimelineOperations.apply_silence_cuts(project, clip.id, [(2, 4), (6, 7)])
    assert len(segments) == 3
    assert [(item.source_in, item.source_out) for item in segments] == [(0, 2), (4, 6), (7, 10)]
    assert [item.start for item in segments] == pytest.approx([2, 4, 6])
    assert next_clip.start == pytest.approx(9.0)
    assert project.duration == pytest.approx(14.0)


def test_silence_cut_that_removes_everything_is_rejected_without_mutation():
    project = project_with_media()
    clip = TimelineOperations.add_media_clip(project, "video", project.tracks[2].id, 0, 0, 4)
    before = project.to_dict()
    with pytest.raises(TimelineError, match="entire clip"):
        TimelineOperations.apply_silence_cuts(project, clip.id, [(0, 4)])
    assert project.to_dict() == before


def test_locked_tracks_block_edits():
    project = project_with_media()
    track = project.tracks[2]
    clip = TimelineOperations.add_media_clip(project, "video", track.id, 0, 0, 4)
    track.locked = True
    with pytest.raises(TimelineError, match="locked"):
        TimelineOperations.move(project, clip.id, 3)


def test_snapshot_history_undo_redo_restores_project_data():
    project = project_with_media()
    history = ProjectHistory()
    before = project.to_dict()
    clip = TimelineOperations.add_media_clip(project, "video", project.tracks[2].id, 0, 0, 3)
    after = project.to_dict()
    history.record(before, after)
    assert history.can_undo

    undone = history.undo(project)
    assert not undone.clips
    redone = history.redo(undone)
    assert len(redone.clips) == 1
    assert redone.clips[0].id == clip.id
