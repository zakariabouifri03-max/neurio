import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_timezone/flutter_timezone.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:timezone/data/latest.dart' as tz;
import 'package:timezone/timezone.dart' as tz;

import 'app/app.dart';
import 'controllers/settings_controller.dart';
import 'controllers/task_controller.dart';
import 'data/settings_repository.dart';
import 'data/task_repository.dart';
import 'notifications/notification_service.dart';
import 'notifications/reminder_scheduler.dart';

/// Composes real implementations; tests swap these via providers.
class TasklyBootstrap {
  static Future<Widget> buildApp() async {
    WidgetsFlutterBinding.ensureInitialized();

    // Cozy edge-to-edge drawing; colors come from the app themes.
    await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);

    // Local time-zone data for genuine reminders.
    await _initTimeZones();

    final prefs = await SharedPreferences.getInstance();
    final settings = SettingsController(SettingsRepository(prefs));
    await settings.load();

    final notifications = NotificationService();
    await notifications.initialize();

    final scheduler = LocalReminderScheduler(notifications);
    final taskController = TaskController(
      repository: TaskRepository(),
      reminderScheduler: scheduler,
    );

    return MultiProvider(
      providers: [
        Provider<NotificationService>.value(value: notifications),
        Provider<ReminderScheduler>.value(value: scheduler),
        ChangeNotifierProvider<SettingsController>.value(value: settings),
        ChangeNotifierProvider<TaskController>.value(value: taskController),
      ],
      child: const TasklyApp(),
    );
  }

  static Future<void> _initTimeZones() async {
    tz.initializeTimeZones();
    try {
      final info = await FlutterTimezone.getLocalTimezone();
      tz.setLocalLocation(tz.getLocation(info.identifier));
    } catch (e) {
      // Fall back to UTC rather than crash; reminders still fire, just
      // without local DST precision.
      debugPrint('Taskly: could not detect time zone ($e); using UTC.');
    }
  }
}

Future<void> main() async {
  final app = await TasklyBootstrap.buildApp();
  runApp(app);
}
