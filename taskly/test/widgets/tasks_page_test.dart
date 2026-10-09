import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

import 'package:taskly/pages/tasks_page.dart';

import '../helpers/fixtures.dart';

void main() {
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  late Directory tempDir;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('taskly_tasks');
  });

  tearDown(() async {
    if (await tempDir.exists()) await tempDir.delete(recursive: true);
  });

  Future<TestHarness> harness() =>
      TestHarness.create(dbPath: '${tempDir.path}/tasks.db');

  testWidgets('empty state offers to add the first task', (tester) async {
    final h = await harness();
    await h.controller.load();

    await tester.pumpWidget(
      testApp(
        child: const TasksPage(),
        tasks: h.controller,
        settings: h.settings,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('No tasks yet'), findsOneWidget);
    expect(find.text('Add your first task'), findsOneWidget);
  });

  testWidgets('search narrows results immediately', (tester) async {
    final h = await harness();
    await h.controller.load();
    final now = fixedNow();
    await h.controller.addTask(title: 'Groceries', dueDate: now);
    await h.controller.addTask(
      title: 'Laundry',
      dueDate: now.add(const Duration(days: 2)),
    );

    await tester.pumpWidget(
      testApp(
        child: const TasksPage(),
        tasks: h.controller,
        settings: h.settings,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Groceries'), findsOneWidget);
    expect(find.text('Laundry'), findsOneWidget);

    await tester.enterText(find.byType(TextField).first, 'laund');
    await tester.pumpAndSettle();

    expect(find.text('Laundry'), findsOneWidget);
    expect(find.text('Groceries'), findsNothing);
  });

  testWidgets('filter chips show live counts and filter the list', (
    tester,
  ) async {
    final h = await harness();
    await h.controller.load();
    final now = fixedNow();
    await h.controller.addTask(title: 'Today item', dueDate: now);
    await h.controller.addTask(
      title: 'Future item',
      dueDate: now.add(const Duration(days: 3)),
    );

    await tester.pumpWidget(
      testApp(
        child: const TasksPage(),
        tasks: h.controller,
        settings: h.settings,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Today · 1'), findsOneWidget);
    expect(find.text('Upcoming · 1'), findsOneWidget);

    await tester.tap(find.text('Upcoming · 1'));
    await tester.pumpAndSettle();

    expect(find.text('Future item'), findsOneWidget);
    expect(find.text('Today item'), findsNothing);
  });

  testWidgets('completed chip lists finished tasks', (tester) async {
    final h = await harness();
    await h.controller.load();
    final now = fixedNow();
    final task = await h.controller.addTask(title: 'Finish me', dueDate: now);
    await h.controller.toggleComplete(task);

    await tester.pumpWidget(
      testApp(
        child: const TasksPage(),
        tasks: h.controller,
        settings: h.settings,
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.textContaining('Completed ·'));
    await tester.pumpAndSettle();

    expect(find.text('Finish me'), findsOneWidget);
  });

  testWidgets('no-match search shows a clear-filters escape hatch', (
    tester,
  ) async {
    final h = await harness();
    await h.controller.load();
    await h.controller.addTask(title: 'Only task', dueDate: fixedNow());

    await tester.pumpWidget(
      testApp(
        child: const TasksPage(),
        tasks: h.controller,
        settings: h.settings,
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).first, 'zzz-nothing');
    await tester.pumpAndSettle();

    expect(find.text('No matches'), findsOneWidget);
    expect(find.text('Clear filters'), findsOneWidget);

    await tester.tap(find.text('Clear filters'));
    await tester.pumpAndSettle();
    expect(find.text('Only task'), findsOneWidget);
  });
}
