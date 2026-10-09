import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/utils/date_helper.dart';

/// Persistent user preferences, backed by SharedPreferences.
class SettingsRepository {
  SettingsRepository(this._prefs);

  final SharedPreferences _prefs;

  static const _keyThemeMode = 'themeMode';
  static const _keyPreferredName = 'preferredName';
  static const _keyWeekStart = 'weekStart';
  static const _keyDateFormat = 'dateFormat';
  static const _keyOnboardingComplete = 'onboardingComplete';
  static const _keyRemindersEnabled = 'remindersEnabled';
  static const _keyCelebrationShownOn = 'celebrationShownOn';

  ThemeMode get themeMode {
    final raw = _prefs.getString(_keyThemeMode);
    return ThemeMode.values.firstWhere(
      (m) => m.name == raw,
      orElse: () => ThemeMode.system,
    );
  }

  Future<void> setThemeMode(ThemeMode mode) =>
      _prefs.setString(_keyThemeMode, mode.name);

  String get preferredName => _prefs.getString(_keyPreferredName) ?? '';

  Future<void> setPreferredName(String name) =>
      _prefs.setString(_keyPreferredName, name.trim());

  WeekStart get weekStart {
    final raw = _prefs.getString(_keyWeekStart);
    return WeekStart.values.firstWhere(
      (w) => w.name == raw,
      orElse: () => WeekStart.sunday,
    );
  }

  Future<void> setWeekStart(WeekStart value) =>
      _prefs.setString(_keyWeekStart, value.name);

  AppDateFormat get dateFormat {
    final raw = _prefs.getString(_keyDateFormat);
    return AppDateFormat.values.firstWhere(
      (f) => f.name == raw,
      orElse: () => AppDateFormat.mdy,
    );
  }

  Future<void> setDateFormat(AppDateFormat value) =>
      _prefs.setString(_keyDateFormat, value.name);

  bool get onboardingComplete => _prefs.getBool(_keyOnboardingComplete) ?? false;

  Future<void> setOnboardingComplete() =>
      _prefs.setBool(_keyOnboardingComplete, true);

  /// Master switch for reminders (user preference in Settings).
  bool get remindersEnabled => _prefs.getBool(_keyRemindersEnabled) ?? true;

  Future<void> setRemindersEnabled(bool value) =>
      _prefs.setBool(_keyRemindersEnabled, value);

  /// Date string (yyyy-mm-dd) marking the last day the "all done" home
  /// celebration played, so it never nags more than once a day.
  String? get celebrationShownOn => _prefs.getString(_keyCelebrationShownOn);

  Future<void> setCelebrationShownOn(String dateKey) =>
      _prefs.setString(_keyCelebrationShownOn, dateKey);
}
