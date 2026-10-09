import 'package:android_intent_plus/android_intent.dart';
import 'package:android_intent_plus/flag.dart';
import 'package:flutter/foundation.dart';

import '../models/task.dart';
import 'notification_service.dart';

/// What happened when the app tried to schedule a reminder.
enum ReminderOutcome {
  /// Alarm booked with the OS.
  scheduled,

  /// The reminder time already passed — nothing was booked.
  skippedPastDue,

  /// The user has notifications turned off for the app.
  notificationsDisabled,

  /// The OS or plugin refused (battery optimizers, missing channel, ...).
  failed,
}

/// Plain-language diagnostics shown in Settings so nothing is pretend.
class ReminderDiagnostics {
  const ReminderDiagnostics({
    required this.notificationsEnabled,
    required this.exactAlarmsAllowed,
    required this.initialized,
  });

  final bool notificationsEnabled;
  final bool exactAlarmsAllowed;
  final bool initialized;
}

/// Abstraction over the notification stack so task logic can be unit-tested
/// without platform channels.
abstract interface class ReminderScheduler {
  Future<ReminderOutcome> scheduleReminder(Task task, {required DateTime now});

  Future<void> cancelReminder(Task task);

  /// Re-syncs every reminder after edits, reboots or permission changes.
  /// Idempotent — scheduling with the same id replaces, never duplicates.
  Future<void> resyncAll(List<Task> tasks, {required DateTime now});

  Future<ReminderDiagnostics> diagnostics();

  /// Opens the OS notification settings for Taskly (deep link).
  Future<void> openNotificationSettings();

  /// Asks Android for exact-alarm access when supported.
  Future<void> requestExactAlarms();
}

/// Production implementation on top of [NotificationService].
class LocalReminderScheduler implements ReminderScheduler {
  LocalReminderScheduler(this._service);

  final NotificationService _service;

  @override
  Future<ReminderOutcome> scheduleReminder(
    Task task, {
    required DateTime now,
  }) async {
    if (!task.reminderEnabled || task.isCompleted) {
      await _service.cancel(task.id);
      return ReminderOutcome.scheduled; // nothing to do = success
    }
    final when = task.dueDateTime;
    if (!when.isAfter(now)) {
      await _service.cancel(task.id);
      return ReminderOutcome.skippedPastDue;
    }
    final enabled = await _service.areNotificationsEnabled();
    if (enabled == false) return ReminderOutcome.notificationsDisabled;

    try {
      final ok = await _service.schedule(
        id: task.id,
        title: 'Taskly reminder',
        body: task.title,
        when: when,
        payload: 'task:${task.id}',
      );
      return ok ? ReminderOutcome.scheduled : ReminderOutcome.skippedPastDue;
    } catch (e) {
      debugPrint('Taskly: scheduling reminder failed: $e');
      return ReminderOutcome.failed;
    }
  }

  @override
  Future<void> cancelReminder(Task task) => _service.cancel(task.id);

  @override
  Future<void> resyncAll(List<Task> tasks, {required DateTime now}) async {
    for (final task in tasks) {
      if (task.reminderEnabled && !task.isCompleted) {
        await scheduleReminder(task, now: now);
      } else {
        await _service.cancel(task.id);
      }
    }
  }

  @override
  Future<ReminderDiagnostics> diagnostics() async {
    final enabled = await _service.areNotificationsEnabled();
    final exact = await _service.canScheduleExact();
    return ReminderDiagnostics(
      notificationsEnabled: enabled ?? false,
      exactAlarmsAllowed: exact ?? false,
      initialized: true,
    );
  }

  /// Opens the Android notification settings page for Taskly.
  @override
  Future<void> openNotificationSettings() async {
    final intent = AndroidIntent(
      action: 'android.settings.APP_NOTIFICATION_SETTINGS',
      arguments: <String, Object?>{
        'android.provider.extra.APP_PACKAGE': 'com.taskly.app',
      },
      flags: <int>[Flag.FLAG_ACTIVITY_NEW_TASK],
    );
    try {
      await intent.launch();
    } catch (e) {
      debugPrint('Taskly: could not open notification settings: $e');
    }
  }

  /// Opens the system screen for granting exact-alarm access.
  @override
  Future<void> requestExactAlarms() async {
    try {
      await _service.requestExactAlarmPermission();
    } catch (e) {
      debugPrint('Taskly: could not request exact alarms: $e');
    }
  }
}

/// Test double: records intent, touches no platform channels.
class NoopReminderScheduler implements ReminderScheduler {
  final List<String> calls = [];

  int scheduledCount = 0;
  int canceledCount = 0;

  @override
  Future<ReminderOutcome> scheduleReminder(
    Task task, {
    required DateTime now,
  }) async {
    calls.add('schedule:${task.id}');
    scheduledCount++;
    return ReminderOutcome.scheduled;
  }

  @override
  Future<void> cancelReminder(Task task) async {
    calls.add('cancel:${task.id}');
    canceledCount++;
  }

  @override
  Future<void> resyncAll(List<Task> tasks, {required DateTime now}) async {
    calls.add('resync');
    for (final task in tasks) {
      if (task.reminderEnabled && !task.isCompleted) {
        await scheduleReminder(task, now: now);
      } else {
        await cancelReminder(task);
      }
    }
  }

  @override
  Future<ReminderDiagnostics> diagnostics() async => const ReminderDiagnostics(
    notificationsEnabled: true,
    exactAlarmsAllowed: true,
    initialized: true,
  );

  @override
  Future<void> openNotificationSettings() async {
    calls.add('openNotificationSettings');
  }

  @override
  Future<void> requestExactAlarms() async {
    calls.add('requestExactAlarms');
  }
}
