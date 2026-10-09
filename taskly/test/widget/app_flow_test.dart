import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:taskly/app.dart';
import 'package:taskly/data/local/database_helper.dart';
import 'package:taskly/data/local/preferences_store.dart';
import 'package:taskly/data/local/task_dao.dart';
import 'package:taskly/screens/home_shell.dart';
import 'package:taskly/screens/onboarding_screen.dart';
import 'package:taskly/services/reminder_scheduler.dart';
import 'package:taskly/state/settings_store.dart';
import 'package:taskly/state/tasks_store.dart';
import 'package:taskly/widgets/cute_checkbox.dart';

Widget buildTestApp({
  required TaskDao dao,
  required ReminderScheduler scheduler,
  required PreferencesStore preferences,
}) {
  return MultiProvider(
    providers: [
      Provider<ReminderScheduler>.value(value: scheduler),
      ChangeNotifierProvider<SettingsStore>(
        create: (_) => SettingsStore(preferences),
      ),
      ChangeNotifierProvider<TasksStore>(
        create: (_) => TasksStore(dao: dao, reminders: scheduler),
      ),
    ],
    child: const TasklyApp(),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();

  late Database database;

  setUp(() async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    database = await databaseFactoryFfi.openDatabase(
      inMemoryDatabasePath,
      options: OpenDatabaseOptions(
        version: DatabaseHelper.databaseVersion,
        onCreate: (db, version) => TaskSchema.create(db),
      ),
    );
  });

  tearDown(() async => database.close());

  Future<void> pumpApp(WidgetTester tester) async {
    TasklyApp.splashDuration = Duration.zero;
    final preferences = await PreferencesStore.init();
    await tester.pumpWidget(buildTestApp(
      dao: TaskDao(database),
      scheduler: NoopReminderScheduler(),
      preferences: preferences,
    ));
    // Splash window.
    await tester.pump(const Duration(milliseconds: 1000));
    await tester.pumpAndSettle();
  }

  testWidgets('first launch shows onboarding, skip lands on empty home',
      (tester) async {
    await pumpApp(tester);
    final visibleTexts = find
        .byType(Text)
        .evaluate()
        .map((e) => (e.widget as Text).data ?? '')
        .toList();
    expect(find.byType(OnboardingScreen), findsOneWidget,
        reason: 'visible texts: $visibleTexts');
    expect(find.text('Skip'), findsOneWidget);

    await tester.tap(find.text('Skip'));
    await tester.pumpAndSettle();

    expect(find.byType(HomeShell), findsOneWidget);
    expect(find.text('Your day is a blank canvas'), findsOneWidget);
    expect(find.text('Add your first task'), findsOneWidget);
  });

  testWidgets('onboarding continue flow reaches Get started', (tester) async {
    await pumpApp(tester);
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('Get started'), findsOneWidget);
    await tester.tap(find.text('Get started'));
    await tester.pumpAndSettle();
    expect(find.byType(HomeShell), findsOneWidget);
  });

  testWidgets('create a task from the FAB and see it on Home', (tester) async {
    await pumpApp(tester);
    await tester.tap(find.text('Skip'));
    await tester.pumpAndSettle();

    await tester.tap(find.byType(FloatingActionButton));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).first, 'Water the plants');
    await tester.tap(find.text('Add task'));
    await tester.pumpAndSettle();

    expect(find.text('Water the plants'), findsOneWidget);
    expect(find.text('1 of 1 tasks done today'), findsNothing);
    expect(find.text('0 of 1 tasks done today'), findsOneWidget);
  });

  testWidgets('completing a task updates the progress card', (tester) async {
    await pumpApp(tester);
    await tester.tap(find.text('Skip'));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(FloatingActionButton));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'Stretch a little');
    await tester.tap(find.text('Add task'));
    await tester.pumpAndSettle();

    await tester.tap(find.byType(CuteCheckbox));
    await tester.pumpAndSettle();

    expect(find.text('1 of 1 tasks done today'), findsOneWidget);
    expect(find.text('All done for today! 🎉'), findsOneWidget);
  });

  testWidgets('validation blocks an empty title', (tester) async {
    await pumpApp(tester);
    await tester.tap(find.text('Skip'));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(FloatingActionButton));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Add task'));
    await tester.pumpAndSettle();

    expect(find.text('Please give your task a little name.'), findsOneWidget);
    // Still on the editor.
    expect(find.text('New task'), findsOneWidget);
  });

  testWidgets('search filters the task list live', (tester) async {
    await pumpApp(tester);
    await tester.tap(find.text('Skip'));
    await tester.pumpAndSettle();

    for (final title in <String>['Buy oats', 'Call grandma']) {
      await tester.tap(find.byType(FloatingActionButton));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).first, title);
      await tester.tap(find.text('Add task'));
      await tester.pumpAndSettle();
    }

    // Go to My Tasks tab.
    await tester.tap(find.text('My Tasks'));
    await tester.pumpAndSettle();

    final searchField = find.byType(TextField).first;
    await tester.enterText(searchField, 'grandma');
    await tester.pumpAndSettle();

    expect(find.text('Call grandma'), findsOneWidget);
    expect(find.text('Buy oats'), findsNothing);

    await tester.tap(find.byIcon(Icons.close_rounded));
    await tester.pumpAndSettle();
    expect(find.text('Buy oats'), findsOneWidget);
  });

  testWidgets('deleting a task asks for confirmation first', (tester) async {
    await pumpApp(tester);
    await tester.tap(find.text('Skip'));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(FloatingActionButton));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'Temp task');
    await tester.tap(find.text('Add task'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('My Tasks'));
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.more_horiz_rounded));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete task'));
    await tester.pumpAndSettle();

    // Confirmation dialog is visible and the task is still there.
    expect(find.text('Delete this task?'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(find.text('Temp task'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.more_horiz_rounded));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete task'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete'));
    await tester.pumpAndSettle();
    expect(find.text('Temp task'), findsNothing);
  });

  testWidgets('dark theme applies everywhere', (tester) async {
    await pumpApp(tester);
    await tester.tap(find.text('Skip'));
    await tester.pumpAndSettle();

    final settings =
        tester.element(find.byType(HomeShell)).read<SettingsStore>();
    await settings.setThemeMode(ThemeMode.dark);
    await tester.pumpAndSettle();

    final brightness = Theme.of(tester.element(find.byType(HomeShell))).brightness;
    expect(brightness, Brightness.dark);
  });
}
