import 'package:flutter/material.dart';

import '../core/utils/date_utils.dart';
import '../data/local/preferences_store.dart';

/// User preferences, persisted on every change.
class SettingsStore extends ChangeNotifier {
  SettingsStore(this._prefs) {
    _themeMode = _prefs.themeMode;
    _preferredName = _prefs.preferredName;
    _weekStart = _prefs.weekStart;
    _dateFormat = _prefs.dateFormat;
    _remindersEnabled = _prefs.remindersEnabled;
    _onboardingCompleted = _prefs.onboardingCompleted;
  }

  final PreferencesStore _prefs;

  late ThemeMode _themeMode;
  late String _preferredName;
  late WeekStart _weekStart;
  late DateFormatPref _dateFormat;
  late bool _remindersEnabled;
  late bool _onboardingCompleted;

  ThemeMode get themeMode => _themeMode;
  String get preferredName => _preferredName;
  WeekStart get weekStart => _weekStart;
  DateFormatPref get dateFormat => _dateFormat;
  bool get remindersEnabled => _remindersEnabled;
  bool get onboardingCompleted => _onboardingCompleted;

  /// Weekday number (1..7) weeks start on, honoring the preference.
  int get firstWeekday => _weekStart.firstWeekday();

  String get greetingName => _preferredName.trim();

  Future<void> setThemeMode(ThemeMode mode) async {
    if (_themeMode == mode) return;
    _themeMode = mode;
    notifyListeners();
    await _prefs.setThemeMode(mode);
  }

  Future<void> setPreferredName(String name) async {
    final cleaned = name.trim();
    if (_preferredName == cleaned) return;
    _preferredName = cleaned;
    notifyListeners();
    await _prefs.setPreferredName(cleaned);
  }

  Future<void> setWeekStart(WeekStart value) async {
    if (_weekStart == value) return;
    _weekStart = value;
    notifyListeners();
    await _prefs.setWeekStart(value);
  }

  Future<void> setDateFormat(DateFormatPref value) async {
    if (_dateFormat == value) return;
    _dateFormat = value;
    notifyListeners();
    await _prefs.setDateFormat(value);
  }

  Future<void> setRemindersEnabled(bool value) async {
    if (_remindersEnabled == value) return;
    _remindersEnabled = value;
    notifyListeners();
    await _prefs.setRemindersEnabled(value);
  }

  Future<void> completeOnboarding() async {
    if (_onboardingCompleted) return;
    _onboardingCompleted = true;
    notifyListeners();
    await _prefs.setOnboardingCompleted(true);
  }
}
