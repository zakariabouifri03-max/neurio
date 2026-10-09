import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite/sqflite.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

import 'package:taskly/controllers/task_controller.dart';
import 'package:taskly/data/task_repository.dart';
import 'package:taskly/notifications/reminder_scheduler.dart';
import 'package:taskly/pages/home_page.dart';
import 'package:taskly/pages/shell.dart';

import '../helpers/fixtures.dart';

void main() {
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  late Directory tempDir;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('taskly_home');
  });

  tearDown(() async {
    if (await tempDir.exists()) await tempDir.delete(recursive: true);
  });

  Future<TestHarness> harness() =>
      TestHarness.create(dbPath: '${tempDir.path}/tasks.db');

  testWidgets('empty dashboard shows the friendly blank-canvas state', (
    tester,
  ) async {
    final h = await harness();
    await h.controller.load();

    await tester.pumpWidget(
      testApp(
        child: const HomePage(),
        tasks: h.controller,
        settings: h.settings,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Hey, superstar! ✨'), findsOneWidget);
    expect(find.text('0 of 0 done today'), findsOneWidget);
    expect(find.text("Today's tasks"), findsOneWidget);
    expect(find.byType(MainShell), findsNothing);
  });

  testWidgets('named greeting uses the preferred name', (tester) async {
    final h = await harness();
    await h.settings.setPreferredName('Aurora');
    await h.controller.load();

    await tester.pumpWidget(
      testApp(
        child: const HomePage(),
        tasks: h.controller,
        settings: h.settings,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('Aurora'), findsOneWidget);
    expect(find.text('Hey, superstar! ✨'), findsNothing);
  });

  testWidgets('progress numbers come from real tasks, not fake data', (
    tester,
  ) async {
    final h = await harness();
    await h.controller.load();
    final now = fixedNow();
    await h.controller.addTask(title: 'A', dueDate: now);
    await h.controller.addTask(title: 'B', dueDate: now);

    await tester.pumpWidget(
      testApp(
        child: const HomePage(),
        tasks: h.controller,
        settings: h.settings,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('0 of 2 done today'), findsOneWidget);

    // Complete one task via the checkbox.
    await tester.tap(find.bySemanticsLabel('Mark as done').first);
    await tester.pumpAndSettle();

    expect(find.text('1 of 2 done today'), findsOneWidget);
  });

  testWidgets('tapping Add a task opens the editor', (tester) async {
    final h = await harness();
    await h.controller.load();

    await tester.pumpWidget(
      testApp(
        child: const HomePage(),
        tasks: h.controller,
        settings: h.settings,
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Add a task').last);
    await tester.pumpAndSettle();

    expect(find.text('What needs doing?'), findsOneWidget);
  });

  testWidgets('all-done state appears only when today is complete', (
    tester,
  ) async {
    final h = await harness();
    await h.controller.load();
    final now = fixedNow();
    final task = await h.controller.addTask(title: 'Solo', dueDate: now);
    await h.controller.toggleComplete(task);

    await tester.pumpWidget(
      testApp(
        child: const HomePage(),
        tasks: h.controller,
        settings: h.settings,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('All done for today'), findsOneWidget);
  });

  testWidgets('storage errors render the retry state', (tester) async {
    // Point the repository at a directory so opening fails.
    final controller = TaskController(
      repository: TaskRepository(debugPath: tempDir.path),
      reminderScheduler: NoopReminderScheduler(),
      clock: fixedNow,
    );
    await controller.load();

    await tester.pumpWidget(
      testApp(
        child: const HomePage(),
        tasks: controller,
        settings: await makeSettings(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Something went wrong'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
  });
}
