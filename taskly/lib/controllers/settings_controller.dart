import 'package:flutter/material.dart';

import '../core/theme/app_colors.dart';
import '../core/utils/date_helper.dart';
import '../data/settings_repository.dart';

/// Holds user preferences and persists every change immediately.
class SettingsController extends ChangeNotifier {
  SettingsController(this._repository);

  final SettingsRepository _repository;

  ThemeMode _themeMode = ThemeMode.system;
  String _preferredName = '';
  WeekStart _weekStart = WeekStart.sunday;
  AppDateFormat _dateFormat = AppDateFormat.mdy;
  bool _onboardingComplete = false;
  bool _remindersEnabled = true;

  ThemeMode get themeMode => _themeMode;
  String get preferredName => _preferredName;
  WeekStart get weekStart => _weekStart;
  AppDateFormat get dateFormat => _dateFormat;
  bool get onboardingComplete => _onboardingComplete;
  bool get remindersEnabled => _remindersEnabled;

  /// Loads persisted settings. Safe to call twice.
  Future<void> load() async {
    final repo = _repository;
    _themeMode = repo.themeMode;
    _preferredName = repo.preferredName;
    _weekStart = repo.weekStart;
    _dateFormat = repo.dateFormat;
    _onboardingComplete = repo.onboardingComplete;
    _remindersEnabled = repo.remindersEnabled;
    notifyListeners();
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    if (mode == _themeMode) return;
    _themeMode = mode;
    notifyListeners();
    await _repository.setThemeMode(mode);
  }

  Future<void> setPreferredName(String name) async {
    final clean = name.trim();
    if (clean == _preferredName) return;
    _preferredName = clean;
    notifyListeners();
    await _repository.setPreferredName(clean);
  }

  Future<void> setWeekStart(WeekStart value) async {
    if (value == _weekStart) return;
    _weekStart = value;
    notifyListeners();
    await _repository.setWeekStart(value);
  }

  Future<void> setDateFormat(AppDateFormat value) async {
    if (value == _dateFormat) return;
    _dateFormat = value;
    notifyListeners();
    await _repository.setDateFormat(value);
  }

  Future<void> completeOnboarding() async {
    _onboardingComplete = true;
    notifyListeners();
    await _repository.setOnboardingComplete();
  }

  /// Toggling the master reminder switch re-syncs existing alarms; callers
  /// (Profile page) trigger [TaskController.resyncReminders] after this.
  Future<void> setRemindersEnabled(bool value) async {
    if (value == _remindersEnabled) return;
    _remindersEnabled = value;
    notifyListeners();
    await _repository.setRemindersEnabled(value);
  }

  // ---- Celebration dedup (once per day) ----

  bool shouldCelebrate(DateTime now) {
    final shown = _repository.celebrationShownOn;
    return shown != _dateKey(now);
  }

  Future<void> markCelebrated(DateTime now) =>
      _repository.setCelebrationShownOn(_dateKey(now));

  static String _dateKey(DateTime d) =>
      '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  /// Friendly greeting for the current time of day.
  static String greetingFor(DateTime now) {
    final hour = now.hour;
    if (hour < 5) return 'Still up?';
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }
}
