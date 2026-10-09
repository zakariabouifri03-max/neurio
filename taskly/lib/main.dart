import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'app.dart';
import 'data/local/database_helper.dart';
import 'data/local/task_dao.dart';
import 'services/reminder_scheduler.dart';
import 'state/settings_store.dart';
import 'state/tasks_store.dart';
import 'data/local/preferences_store.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final preferences = await PreferencesStore.init();
  final database = await DatabaseHelper.instance.database;
  final dao = TaskDao(database);
  final scheduler = await createReminderScheduler();

  runApp(
    MultiProvider(
      providers: <SingleChildWidget>[
        Provider<ReminderScheduler>.value(value: scheduler),
        ChangeNotifierProvider<SettingsStore>(
          create: (_) => SettingsStore(preferences),
        ),
        ChangeNotifierProvider<TasksStore>(
          create: (_) => TasksStore(dao: dao, reminders: scheduler),
        ),
      ],
      child: const TasklyApp(),
    ),
  );
}
