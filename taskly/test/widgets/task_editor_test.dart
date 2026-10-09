import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

import 'package:taskly/pages/task_editor_page.dart';
import 'package:taskly/models/priority.dart';
import 'package:taskly/notifications/reminder_scheduler.dart';
import 'package:taskly/controllers/task_controller.dart';
import 'package:taskly/data/task_repository.dart';

import '../helpers/fixtures.dart';

void main() {
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  late Directory tempDir;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('taskly_editor');
  });

  tearDown(() async {
    if (await tempDir.exists()) await tempDir.delete(recursive: true);
  });

  Future<TaskController> controller() async {
    final c = TaskController(
      repository: TaskRepository(debugPath: '${tempDir.path}/tasks.db'),
      reminderScheduler: NoopReminderScheduler(),
      clock: fixedNow,
    );
    await c.load();
    return c;
  }

  testWidgets('empty title shows a friendly validation error', (tester) async {
    final c = await controller();
    final settings = await makeSettings();

    await tester.pumpWidget(
      testApp(child: const TaskEditorPage(), tasks: c, settings: settings),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Add task'));
    await tester.pumpAndSettle();

    expect(
      find.text('Give your task a name so it feels real.'),
      findsOneWidget,
    );
    expect(c.tasks, isEmpty, reason: 'nothing saved');
  });

  testWidgets('valid input saves exactly one task and pops', (tester) async {
    final c = await controller();
    final settings = await makeSettings();

    await tester.pumpWidget(
      testApp(child: const TaskEditorPage(), tasks: c, settings: settings),
    );
    await tester.pumpAndSettle();

    await tester.enterText(
      find.widgetWithText(TextFormField, 'What needs doing?'),
      'Journal for 10 minutes',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Add task'));
    await tester.pumpAndSettle();

    expect(c.tasks, hasLength(1));
    expect(c.tasks.first.title, 'Journal for 10 minutes');
    expect(find.byType(TaskEditorPage), findsNothing, reason: 'popped');
  });

  testWidgets('rapid double tap saves only once', (tester) async {
    final c = await controller();
    final settings = await makeSettings();

    await tester.pumpWidget(
      testApp(child: const TaskEditorPage(), tasks: c, settings: settings),
    );
    await tester.pumpAndSettle();

    await tester.enterText(
      find.widgetWithText(TextFormField, 'What needs doing?'),
      'Only once please',
    );
    await tester.pump();

    await tester.tap(find.text('Add task'), warnIfMissed: false);
    await tester.pump(const Duration(milliseconds: 30));
    await tester.tap(find.text('Add task'), warnIfMissed: false);
    await tester.pumpAndSettle();

    expect(c.tasks, hasLength(1), reason: 'double-submit is guarded');
  });

  testWidgets('edit mode prefills and saves changes', (tester) async {
    final c = await controller();
    final settings = await makeSettings();
    final task = await c.addTask(title: 'Original title', dueDate: fixedNow());

    await tester.pumpWidget(
      testApp(
        child: TaskEditorPage(task: task),
        tasks: c,
        settings: settings,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Edit task'), findsOneWidget);
    expect(find.text('Original title'), findsOneWidget);

    await tester.enterText(
      find.widgetWithText(TextFormField, 'What needs doing?'),
      'Updated title',
    );
    await tester.tap(find.text('Save changes'));
    await tester.pumpAndSettle();

    expect(c.tasks.first.title, 'Updated title');
    expect(c.tasks, hasLength(1));
  });

  testWidgets('priority and category selection update the draft', (
    tester,
  ) async {
    final c = await controller();
    final settings = await makeSettings();

    await tester.pumpWidget(
      testApp(child: const TaskEditorPage(), tasks: c, settings: settings),
    );
    await tester.pumpAndSettle();

    await tester.enterText(
      find.widgetWithText(TextFormField, 'What needs doing?'),
      'Study session',
    );
    await tester.tap(find.text('Study'));
    await tester.tap(find.text('High'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Add task'));
    await tester.pumpAndSettle();

    expect(c.tasks.single.category.label, 'Study');
    expect(c.tasks.single.priority, TaskPriority.high);
  });
}
