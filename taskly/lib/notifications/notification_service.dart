import 'dart:ui' show Color;

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/timezone.dart' as tz;

/// Thin, testable wrapper around flutter_local_notifications.
///
/// The app only ever shows *local task reminders* — no marketing, no noise.
class NotificationService {
  NotificationService();

  final FlutterLocalNotificationsPlugin _plugin =
      FlutterLocalNotificationsPlugin();

  static const String channelId = 'taskly_reminders';
  static const String channelName = 'Task reminders';
  static const String channelDescription =
      'Reminders for tasks you asked Taskly to remember.';

  /// Fired when the user taps a reminder notification; payload is
  /// `task:<id>`.
  final ValueNotifier<String?> lastTapPayload = ValueNotifier<String?>(null);

  bool _initialized = false;

  Future<void> initialize() async {
    if (_initialized) return;
    const settings = InitializationSettings(
      android: AndroidInitializationSettings('ic_stat_taskly'),
    );
    await _plugin.initialize(
      settings,
      onDidReceiveNotificationResponse: (response) {
        final payload = response.payload;
        if (payload != null && payload.startsWith('task:')) {
          lastTapPayload.value = payload;
        }
      },
    );
    _initialized = true;
  }

  AndroidFlutterLocalNotificationsPlugin? get _android =>
      _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin
      >();

  /// Requests POST_NOTIFICATIONS on Android 13+ (no-op earlier). Returns
  /// whether notifications are granted; null when unanswerable (tests/desktop).
  Future<bool?> requestNotificationPermission() =>
      _android?.requestNotificationsPermission();

  Future<bool?> areNotificationsEnabled() => _android?.areNotificationsEnabled();

  /// Whether the OS will let us schedule *exact* alarms right now.
  Future<bool?> canScheduleExact() => _android?.canScheduleExactNotifications();

  /// Opens the system dialog/screen for granting exact-alarm access.
  /// Returns whether the permission was granted after the request.
  Future<bool?> requestExactAlarmPermission() =>
      _android?.requestExactAlarmsPermission();

  /// Schedules a reminder. Returns false if the moment already passed.
  Future<bool> schedule({
    required int id,
    required String title,
    required String body,
    required DateTime when,
    String? payload,
  }) async {
    final target = tz.TZDateTime.from(when, tz.local);
    if (!target.isAfter(tz.TZDateTime.now(tz.local))) return false;

    await _plugin.zonedSchedule(
      id: id,
      title: title,
      body: body,
      scheduledDate: target,
      notificationDetails: const NotificationDetails(
        android: AndroidNotificationDetails(
          channelId,
          channelName,
          channelDescription: channelDescription,
          importance: Importance.high,
          priority: Priority.high,
          category: AndroidNotificationCategory.reminder,
          color: Color(0xFF7C6BC8),
        ),
      ),
      payload: payload,
      // Exact when the OS allows it; otherwise a graceful inexact fallback
      // that still fires within Android's window restrictions.
      androidScheduleMode:
          (await canScheduleExact() ?? false)
          ? AndroidScheduleMode.exactAllowWhileIdle
          : AndroidScheduleMode.inexactAllowWhileIdle,
    );
    return true;
  }

  /// Cancels a scheduled reminder (no-op when the id was never scheduled).
  Future<void> cancel(int id) => _plugin.cancel(id: id);
}
