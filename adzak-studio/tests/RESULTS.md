# Automated Test Results — ADZAK CREATIVE STUDIO

Run: 2026-10-10 10:13 UTC · Python 3.11 · PySide6/Qt 6 · FFmpeg 7.0.2 (static) · offscreen Qt platform

**Result: 92 passed, 0 failed.**

Test groups:

- `test_settings / test_i18n / test_undo / test_projects` — core foundation (SQLite settings, 4-language i18n incl. RTL, undo/redo, project create/open/save/autosave/recovery)
- `test_timeline / test_presets` — NLE model operations and export preset math
- `test_image_ops / test_subtitles` — pixel pipeline and subtitle parsing/conversion
- `test_jobs / test_ai` — background job engine, capability honesty, DPAPI key store, assistant generators
- `test_converter / test_audio_ops / test_exporter` — **real FFmpeg integration**: conversion, compression (CRF + two-pass target size), GIF creation, frame extraction, metadata, batch rename, audio normalise/EQ/fade/tempo/silence-removal, and full timeline renders with speed changes, gaps and subtitle burn-in
- `test_ui_smoke` — boots the real main window offscreen, walks all 10 studio panels, drives project/timeline/photo/design/animation/assistant flows, verifies Arabic RTL switching

## Detailed log

```
tests/test_ai.py::test_capability_registry_complete PASSED
tests/test_ai.py::test_no_fake_available_flags PASSED
tests/test_ai.py::test_keystore_roundtrip PASSED
tests/test_ai.py::test_assistant_offline_answers PASSED
tests/test_ai.py::test_generators PASSED
tests/test_audio_ops.py::test_decode_and_waveform PASSED
tests/test_audio_ops.py::test_normalize PASSED
tests/test_audio_ops.py::test_fade PASSED
tests/test_audio_ops.py::test_equalize PASSED
tests/test_audio_ops.py::test_silence_detection_and_removal PASSED
tests/test_audio_ops.py::test_speed_change PASSED
tests/test_audio_ops.py::test_record_command_shape PASSED
tests/test_converter.py::test_probe PASSED
tests/test_converter.py::test_convert_video_to_mkv PASSED
tests/test_converter.py::test_convert_video_resize_and_trim PASSED
tests/test_converter.py::test_compress_video_crf PASSED
tests/test_converter.py::test_compress_video_target_size PASSED
tests/test_converter.py::test_extract_audio PASSED
tests/test_converter.py::test_extract_frames_and_thumbnail PASSED
tests/test_converter.py::test_make_gif PASSED
tests/test_converter.py::test_audio_convert PASSED
tests/test_converter.py::test_trim_audio PASSED
tests/test_converter.py::test_merge_audio PASSED
tests/test_converter.py::test_image_convert PASSED
tests/test_converter.py::test_batch_convert_images PASSED
tests/test_converter.py::test_batch_rename PASSED
tests/test_converter.py::test_metadata_reports PASSED
tests/test_converter.py::test_size_estimate PASSED
tests/test_exporter.py::test_build_args_shape PASSED
tests/test_exporter.py::test_render_produces_real_file PASSED
tests/test_exporter.py::test_render_with_gap_and_reverse PASSED
tests/test_exporter.py::test_render_burn_subtitles PASSED
tests/test_exporter.py::test_render_gif_video_only PASSED
tests/test_exporter.py::test_empty_timeline_rejected PASSED
tests/test_exporter.py::test_invalid_codec_rejected PASSED
tests/test_i18n.py::test_all_languages_have_every_string PASSED
tests/test_i18n.py::test_rtl_arabic PASSED
tests/test_i18n.py::test_translation_formatting_and_fallback PASSED
tests/test_i18n.py::test_languages_list PASSED
tests/test_image_ops.py::test_resize_crop_rotate_flip PASSED
tests/test_image_ops.py::test_adjust_changes_pixels PASSED
tests/test_image_ops.py::test_curves PASSED
tests/test_image_ops.py::test_filters_all_run PASSED
tests/test_image_ops.py::test_background_removal PASSED
tests/test_image_ops.py::test_text_shapes_composite PASSED
tests/test_image_ops.py::test_save_formats PASSED
tests/test_image_ops.py::test_checker_preview PASSED
tests/test_jobs.py::test_job_success_and_progress PASSED
tests/test_jobs.py::test_job_failure_is_reported_not_hidden PASSED
tests/test_jobs.py::test_job_cancel PASSED
tests/test_jobs.py::test_queue_runs_all PASSED
tests/test_presets.py::test_aspect_ratios PASSED
tests/test_presets.py::test_presets_have_valid_codecs PASSED
tests/test_presets.py::test_presets_for_categories PASSED
tests/test_presets.py::test_audio_presets PASSED
tests/test_projects.py::test_safe_name PASSED
tests/test_projects.py::test_create_open_save_roundtrip PASSED
tests/test_projects.py::test_recent_listing_and_delete PASSED
tests/test_projects.py::test_autosave_and_recovery PASSED
tests/test_projects.py::test_open_invalid_folder PASSED
tests/test_projects.py::test_default_state_kinds PASSED
tests/test_settings.py::test_roundtrip PASSED
tests/test_settings.py::test_defaults_exposed PASSED
tests/test_subtitles.py::test_parse_srt PASSED
tests/test_subtitles.py::test_parse_errors PASSED
tests/test_subtitles.py::test_roundtrip_srt_vtt PASSED
tests/test_subtitles.py::test_convert_file PASSED
tests/test_subtitles.py::test_shift_and_scale PASSED
tests/test_timeline.py::test_add_clip_and_duration PASSED
tests/test_timeline.py::test_overlap_pushes_forward PASSED
tests/test_timeline.py::test_split PASSED
tests/test_timeline.py::test_trim_and_move PASSED
tests/test_timeline.py::test_move_rejected_on_overlap PASSED
tests/test_timeline.py::test_speed_affects_duration PASSED
tests/test_timeline.py::test_ripple_delete PASSED
tests/test_timeline.py::test_serialisation_roundtrip PASSED
tests/test_timeline.py::test_keyframe_hold_and_bounds PASSED
tests/test_timeline.py::test_locked_track PASSED
tests/test_ui_smoke.py::test_main_window_builds PASSED
tests/test_ui_smoke.py::test_switch_all_panels PASSED
tests/test_ui_smoke.py::test_new_project_flow PASSED
tests/test_ui_smoke.py::test_video_editor_model_ops PASSED
tests/test_ui_smoke.py::test_photo_editor_ops PASSED
tests/test_ui_smoke.py::test_design_render_and_templates PASSED
tests/test_ui_smoke.py::test_animation_render_frame PASSED
tests/test_ui_smoke.py::test_assistant_panel PASSED
tests/test_ui_smoke.py::test_language_switch_and_rtl PASSED
tests/test_ui_smoke.py::test_theme_switch PASSED
tests/test_ui_smoke.py::test_ai_panels_honest_status PASSED
tests/test_undo.py::test_undo_redo_cycle PASSED
tests/test_undo.py::test_new_command_clears_redo PASSED
tests/test_undo.py::test_limit PASSED
============================== 92 passed in 4.61s ==============================
```
