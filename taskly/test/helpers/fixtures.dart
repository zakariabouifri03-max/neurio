import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:taskly/controllers/settings_controller.dart';
import 'package:taskly/controllers/task_controller.dart';
import 'package:taskly/data/settings_repository.dart';
import 'package:taskly/data/task_repository.dart';
import 'package:taskly/models/category.dart';
import 'package:taskly/models/priority.dart';
import 'package:taskly/models/task.dart';
import 'package:taskly/notifications/reminder_scheduler.dart';
import 'package:taskly/notifications/notification_service.dart';

/// Deterministic "now" for tests: a Wednesday, 10:00 local time.
DateTime fixedNow() => DateTime(2026, 10, 7, 10, 0);

/// Builds a task with sensible defaults; override anything you like.
Task makeTask({
  int id = 1,
  String title = 'Water the plants',
  String description = '',
  DateTime? due,
  int? minutes,
  TaskPriority priority = TaskPriority.medium,
  TaskCategory category = TaskCategory.personal,
  bool completed = false,
  DateTime? completedAt,
  DateTime? created,
  bool reminder = false,
}) {
  final base = due ?? fixedNow();
  final createdAt = created ?? base.subtract(const Duration(days: 1));
  return Task(
    id: id,
    title: title,
    description: description,
    dueDate: DateTime(base.year, base.month, base.day),
    dueMinutes: minutes,
    priority: priority,
    category: category,
    isCompleted: completed,
    completedAt: completedAt,
    createdAt: createdAt,
    updatedAt: createdAt,
    reminderEnabled: reminder,
  );
}

/// In-memory-ish settings backed by mock SharedPreferences.
Future<SettingsController> makeSettings({
  ThemeMode themeMode = ThemeMode.system,
  String name = '',
}) async {
  SharedPreferences.setMockInitialValues(<String, Object>{});
  final prefs = await SharedPreferences.getInstance();
  final controller = SettingsController(SettingsRepository(prefs));
  await controller.load();
  if (themeMode != ThemeMode.system) await controller.setThemeMode(themeMode);
  if (name.isNotEmpty) await controller.setPreferredName(name);
  return controller;
}

/// Standard provider wrapper used by widget tests.
Widget testApp({
  required Widget child,
  required TaskController tasks,
  required SettingsController settings,
  LocalizationsDelegate<Object>? lookupDelegate,
}) {
  final notifications = NotificationService();
  final scheduler = NoopReminderScheduler();
  return MultiProvider(
    providers: [
      Provider<NotificationService>.value(value: notifications),
      Provider<ReminderScheduler>.value(value: scheduler),
      ChangeNotifierProvider<TaskController>.value(value: tasks),
      ChangeNotifierProvider<SettingsController>.value(value: settings),
    ],
    child: MaterialApp(home: child),
  );
}

/// Convenience: controller + repo + noop scheduler wired together.
class TestHarness {
  TestHarness._(this.repository, this.controller, this.settings);

  final TaskRepository repository;
  final TaskController controller;
  final SettingsController settings;

  static Future<TestHarness> create({required String dbPath}) async {
    final repository = TaskRepository(debugPath: dbPath);
    final controller = TaskController(
      repository: repository,
      reminderScheduler: NoopReminderScheduler(),
      clock: fixedNow,
    );
    final settings = await makeSettings();
    return TestHarness._(repository, controller, settings);
  }
}
