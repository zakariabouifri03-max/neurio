import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:taskly/app.dart';
import 'package:taskly/data/local/database_helper.dart';
import 'package:taskly/data/local/preferences_store.dart';
import 'package:taskly/data/local/task_dao.dart';
import 'package:taskly/services/reminder_scheduler.dart';
import 'package:taskly/state/settings_store.dart';
import 'package:taskly/state/tasks_store.dart';
import 'package:taskly/widgets/cute_checkbox.dart';

/// Critical user journey on a real device/emulator:
/// onboarding → create → complete → edit → delete.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('full task lifecycle journey', (tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'settings.onboardingCompleted': true,
    });

    final database = await DatabaseHelper.instance.database;
    final dao = TaskDao(database);
    final preferences = await PreferencesStore.init();
    final scheduler = NoopReminderScheduler();

    await tester.pumpWidget(MultiProvider(
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
    ));
    await tester.pumpAndSettle(const Duration(seconds: 2));

    // Create.
    await tester.tap(find.byType(FloatingActionButton));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'Journey task');
    await tester.tap(find.text('Add task'));
    await tester.pumpAndSettle();
    expect(find.text('Journey task'), findsOneWidget);

    // Complete.
    await tester.tap(find.byType(CuteCheckbox));
    await tester.pumpAndSettle();
    expect(find.text('1 of 1 tasks done today'), findsOneWidget);

    // Edit.
    await tester.tap(find.text('Journey task'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Edit task'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'Journey task v2');
    await tester.tap(find.text('Save changes'));
    await tester.pumpAndSettle();
    expect(find.text('Journey task v2'), findsOneWidget);

    // Delete (from details).
    await tester.tap(find.text('Journey task v2'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Delete task'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete'));
    await tester.pumpAndSettle();
    expect(find.text('Journey task v2'), findsNothing);
  });
}
