import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:taskly/controllers/settings_controller.dart';
import 'package:taskly/core/utils/date_helper.dart';
import 'package:taskly/data/settings_repository.dart';

void main() {
  group('SettingsController', () {
    test('defaults are sensible', () async {
      SharedPreferences.setMockInitialValues({});
      final settings = SettingsController(
        SettingsRepository(await SharedPreferences.getInstance()),
      );
      await settings.load();
      expect(settings.themeMode, ThemeMode.system);
      expect(settings.preferredName, '');
      expect(settings.weekStart, WeekStart.sunday);
      expect(settings.dateFormat, AppDateFormat.mdy);
      expect(settings.onboardingComplete, isFalse);
      expect(settings.remindersEnabled, isTrue);
    });

    test('theme mode persists across controller restarts', () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();

      final first = SettingsController(SettingsRepository(prefs));
      await first.load();
      await first.setThemeMode(ThemeMode.dark);
      expect(first.themeMode, ThemeMode.dark);

      // Simulate an app restart with the same backing storage.
      final second = SettingsController(SettingsRepository(prefs));
      await second.load();
      expect(second.themeMode, ThemeMode.dark);
    });

    test('name is trimmed when persisted', () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final settings = SettingsController(SettingsRepository(prefs));
      await settings.load();
      await settings.setPreferredName('  Aurora  ');
      expect(settings.preferredName, 'Aurora');
    });

    test('onboarding completion persists', () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final settings = SettingsController(SettingsRepository(prefs));
      await settings.load();
      await settings.completeOnboarding();

      final second = SettingsController(SettingsRepository(prefs));
      await second.load();
      expect(second.onboardingComplete, isTrue);
    });

    test('week start and date format persist', () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final settings = SettingsController(SettingsRepository(prefs));
      await settings.load();
      await settings.setWeekStart(WeekStart.monday);
      await settings.setDateFormat(AppDateFormat.ymd);

      final second = SettingsController(SettingsRepository(prefs));
      await second.load();
      expect(second.weekStart, WeekStart.monday);
      expect(second.dateFormat, AppDateFormat.ymd);
    });

    test('greeting changes with the time of day', () {
      expect(
        SettingsController.greetingFor(DateTime(2026, 1, 1, 7)),
        'Good morning',
      );
      expect(
        SettingsController.greetingFor(DateTime(2026, 1, 1, 14)),
        'Good afternoon',
      );
      expect(
        SettingsController.greetingFor(DateTime(2026, 1, 1, 20)),
        'Good evening',
      );
      expect(
        SettingsController.greetingFor(DateTime(2026, 1, 1, 3)),
        'Still up?',
      );
    });

    test('celebration dedupes within a day', () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final settings = SettingsController(SettingsRepository(prefs));
      await settings.load();

      final now = DateTime(2026, 5, 5, 9);
      expect(settings.shouldCelebrate(now), isTrue);
      await settings.markCelebrated(now);
      expect(settings.shouldCelebrate(now), isFalse);
      expect(
        settings.shouldCelebrate(now.add(const Duration(days: 1))),
        isTrue,
      );
    });
  });
}
