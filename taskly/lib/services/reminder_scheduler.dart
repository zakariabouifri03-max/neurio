import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

import '../data/models/task.dart';

/// Outcome of a permission request.
enum ReminderPermission { granted, denied, unsupported }

/// Abstraction over the notification backend so the app (and tests) can run
/// with a real scheduler or a no-op one.
abstract class ReminderScheduler {
  /// Whether the OS currently allows notifications for this app.
  Future<bool> areNotificationsEnabled();

  Future<ReminderPermission> requestPermission();

  /// Schedules (or replaces) the reminder for [task]. No-ops when the task
  /// has no id, reminders are off, or the moment already passed.
  Future<void> scheduleFor(Task task);

  Future<void> cancelFor(Task task);

  Future<void> cancelId(int id);

  /// Sends an immediate sample notification (used by the settings screen).
  Future<void> sendTestNotification();

  /// True when exact alarms are unavailable (battery optimization etc.).
  bool get usesInexactAlarms;

  String? get lastError;
}

/// Production implementation backed by `flutter_local_notifications`.
class FlutterLocalReminderScheduler implements ReminderScheduler {
  FlutterLocalReminderScheduler(this._plugin);

  static const String channelId = 'taskly_reminders';
  static const String channelName = 'Task reminders';
  static const String channelDescription =
      'Gentle nudges for tasks you asked Taskly to remind you about.';
  static const int testNotificationId = 999999;

  final FlutterLocalNotificationsPlugin _plugin;
  bool _initialized = false;
  bool _usesInexactAlarms = false;
  String? _lastError;

  @override
  bool get usesInexactAlarms => _usesInexactAlarms;

  @override
  String? get lastError => _lastError;

  Future<void> init() async {
    if (_initialized) return;
    tzdata.initializeTimeZones();
    const settings = InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
    );
    await _plugin.initialize(settings);
    _initialized = true;
  }

  NotificationDetails get _details => const NotificationDetails(
        android: AndroidNotificationDetails(
          channelId,
          channelName,
          channelDescription: channelDescription,
          importance: Importance.defaultImportance,
          priority: Priority.defaultPriority,
          category: AndroidNotificationCategory.reminder,
          styleInformation: BigTextStyleInformation(''),
        ),
      );

  /// Converts a local [DateTime] to an absolute instant. Converting through
  /// UTC lets the OS/DST database resolve the correct offset for the target
  /// date, which keeps reminders correct across daylight-saving changes.
  tz.TZDateTime _toUtcAnchored(DateTime local) =>
      tz.TZDateTime.from(local.toUtc(), tz.UTC);

  @override
  Future<bool> areNotificationsEnabled() async {
    try {
      final enabled = await _plugin.areNotificationsEnabled();
      return enabled;
    } catch (e) {
      _lastError = '$e';
      return false;
    }
  }

  @override
  Future<ReminderPermission> requestPermission() async {
    try {
      final android =
          _plugin.resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>();
      if (android == null) return ReminderPermission.granted;
      final granted = await android.requestNotificationsPermission();
      return granted == true
          ? ReminderPermission.granted
          : ReminderPermission.denied;
    } catch (e) {
      _lastError = '$e';
      return ReminderPermission.denied;
    }
  }

  @override
  Future<void> scheduleFor(Task task) async {
    final id = task.id;
    final moment = task.reminderAt;
    if (id == null || moment == null) return;
    await cancelId(id);
    if (moment.isBefore(DateTime.now())) return; // never fire in the past
    try {
      await _plugin.zonedSchedule(
        id,
        'Taskly reminder 💜',
        task.title,
        _toUtcAnchored(moment),
        _details,
        androidScheduleMode: AndroidScheduleMode.exactAllowWhileIdle,
        uiLocalNotificationDateInterpretation:
            UILocalNotificationDateInterpretation.absoluteTime,
        payload: 'task:$id',
      );
    } catch (e) {
      // Exact alarms can be blocked by OEM battery policies — degrade
      // gracefully to inexact alarms instead of losing the reminder.
      _usesInexactAlarms = true;
      try {
        await _plugin.zonedSchedule(
          id,
          'Taskly reminder 💜',
          task.title,
          _toUtcAnchored(moment),
          _details,
          androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
          uiLocalNotificationDateInterpretation:
              UILocalNotificationDateInterpretation.absoluteTime,
          payload: 'task:$id',
        );
      } catch (e2) {
        _lastError = '$e2';
        debugPrint('Taskly: unable to schedule reminder for task $id: $e2');
      }
    }
  }

  @override
  Future<void> cancelFor(Task task) async {
    final id = task.id;
    if (id == null) return;
    await cancelId(id);
  }

  @override
  Future<void> cancelId(int id) async {
    try {
      await _plugin.cancel(id);
    } catch (e) {
      _lastError = '$e';
    }
  }

  @override
  Future<void> sendTestNotification() async {
    try {
      await _plugin.show(
        testNotificationId,
        'Taskly 💜',
        'Reminders are set up and working nicely.',
        _details,
      );
    } catch (e) {
      _lastError = '$e';
    }
  }
}

/// Used in tests and whenever the plugin cannot initialize, so reminder
/// features degrade gracefully instead of crashing.
class NoopReminderScheduler implements ReminderScheduler {
  @override
  bool get usesInexactAlarms => false;

  @override
  String? get lastError => null;

  @override
  Future<bool> areNotificationsEnabled() async => false;

  @override
  Future<void> cancelFor(Task task) async {}

  @override
  Future<void> cancelId(int id) async {}

  @override
  Future<ReminderPermission> requestPermission() async =>
      ReminderPermission.unsupported;

  @override
  Future<void> scheduleFor(Task task) async {}

  @override
  Future<void> sendTestNotification() async {}
}

/// Builds the real scheduler, falling back to [NoopReminderScheduler] when
/// the plugin cannot start (e.g. unusual environments or unit tests).
Future<ReminderScheduler> createReminderScheduler() async {
  try {
    final scheduler =
        FlutterLocalReminderScheduler(FlutterLocalNotificationsPlugin());
    await scheduler.init();
    return scheduler;
  } catch (e) {
    debugPrint('Taskly: notifications unavailable, running without them ($e)');
    return NoopReminderScheduler();
  }
}
