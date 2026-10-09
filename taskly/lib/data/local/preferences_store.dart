import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/utils/date_utils.dart' as taskly;

/// Typed wrapper around SharedPreferences for user preferences.
class PreferencesStore {
  PreferencesStore._(this._prefs);

  final SharedPreferences _prefs;

  static const String _kTheme = 'settings.themeMode';
  static const String _kName = 'settings.preferredName';
  static const String _kWeekStart = 'settings.weekStart';
  static const String _kDateFormat = 'settings.dateFormat';
  static const String _kReminders = 'settings.remindersEnabled';
  static const String _kOnboarded = 'settings.onboardingCompleted';

  static Future<PreferencesStore> init() async =>
      PreferencesStore._(await SharedPreferences.getInstance());

  ThemeMode get themeMode {
    final raw = _prefs.getString(_kTheme);
    return ThemeMode.values.firstWhere(
      (m) => m.name == raw,
      orElse: () => ThemeMode.system,
    );
  }

  Future<void> setThemeMode(ThemeMode mode) =>
      _prefs.setString(_kTheme, mode.name);

  String get preferredName => _prefs.getString(_kName) ?? '';

  Future<void> setPreferredName(String name) =>
      _prefs.setString(_kName, name.trim());

  taskly.WeekStart get weekStart {
    final raw = _prefs.getString(_kWeekStart);
    return taskly.WeekStart.values.firstWhere(
      (w) => w.name == raw,
      orElse: () => taskly.WeekStart.system,
    );
  }

  Future<void> setWeekStart(taskly.WeekStart value) =>
      _prefs.setString(_kWeekStart, value.name);

  taskly.DateFormatPref get dateFormat {
    final raw = _prefs.getString(_kDateFormat);
    return taskly.DateFormatPref.values.firstWhere(
      (f) => f.name == raw,
      orElse: () => taskly.DateFormatPref.usLong,
    );
  }

  Future<void> setDateFormat(taskly.DateFormatPref value) =>
      _prefs.setString(_kDateFormat, value.name);

  bool get remindersEnabled => _prefs.getBool(_kReminders) ?? true;

  Future<void> setRemindersEnabled(bool value) =>
      _prefs.setBool(_kReminders, value);

  bool get onboardingCompleted => _prefs.getBool(_kOnboarded) ?? false;

  Future<void> setOnboardingCompleted(bool value) =>
      _prefs.setBool(_kOnboarded, value);
}
