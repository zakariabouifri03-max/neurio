import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite/sqflite.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

import 'package:taskly/pages/calendar_page.dart';

import '../helpers/fixtures.dart';

void main() {
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  late Directory tempDir;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('taskly_cal');
  });

  tearDown(() async {
    if (await tempDir.exists()) await tempDir.delete(recursive: true);
  });

  Future<TestHarness> harness() =>
      TestHarness.create(dbPath: '${tempDir.path}/tasks.db');

  testWidgets('renders the current month with correct day count', (
    tester,
  ) async {
    final h = await harness();
    await h.controller.load();

    await tester.pumpWidget(
      testApp(
        child: const CalendarPage(),
        tasks: h.controller,
        settings: h.settings,
      ),
    );
    await tester.pumpAndSettle();

    // fixedNow is October 2026.
    expect(find.textContaining('October 2026'), findsOneWidget);
    expect(find.text('31'), findsOneWidget, reason: 'October has 31 days');
    expect(find.text('32'), findsNothing);
  });

  testWidgets('navigating to February 2028 shows 29 days (leap year)', (
    tester,
  ) async {
    final h = await harness();
    await h.controller.load();

    await tester.pumpWidget(
      testApp(
        child: const CalendarPage(),
        tasks: h.controller,
        settings: h.settings,
      ),
    );
    await tester.pumpAndSettle();

    // Move forward from Oct 2026 to Feb 2028 (16 months).
    for (var i = 0; i < 16; i++) {
      await tester.tap(find.byTooltip('Next month'));
      await tester.pumpAndSettle();
    }
    expect(find.textContaining('February 2028'), findsOneWidget);
    expect(find.text('29'), findsOneWidget, reason: '2028 is a leap year');
    expect(find.text('30'), findsNothing);
  });

  testWidgets('tasks appear under the day they are due', (tester) async {
    final h = await harness();
    await h.controller.load();

    final dayA = DateTime(2026, 10, 7);
    final dayB = DateTime(2026, 10, 9);
    await h.controller.addTask(title: 'Wednesday task', dueDate: dayA);
    await h.controller.addTask(title: 'Friday task', dueDate: dayB);

    await tester.pumpWidget(
      testApp(
        child: const CalendarPage(),
        tasks: h.controller,
        settings: h.settings,
      ),
    );
    await tester.pumpAndSettle();

    // Today (Oct 7) is selected by default.
    expect(find.text('Wednesday task'), findsOneWidget);
    expect(find.text('Friday task'), findsNothing);

    // Select Oct 9.
    await tester.tap(find.text('9'));
    await tester.pumpAndSettle();
    expect(find.text('Friday task'), findsOneWidget);
    expect(find.text('Wednesday task'), findsNothing);
  });

  testWidgets('jump-to-today button returns to the current month', (
    tester,
  ) async {
    final h = await harness();
    await h.controller.load();

    await tester.pumpWidget(
      testApp(
        child: const CalendarPage(),
        tasks: h.controller,
        settings: h.settings,
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byTooltip('Next month'));
    await tester.pumpAndSettle();
    expect(find.textContaining('November 2026'), findsOneWidget);

    await tester.tap(find.byTooltip('Jump to today'));
    await tester.pumpAndSettle();
    expect(find.textContaining('October 2026'), findsOneWidget);
  });

  testWidgets('add-for-this-day prefills the picked date', (tester) async {
    final h = await harness();
    await h.controller.load();

    await tester.pumpWidget(
      testApp(
        child: const CalendarPage(),
        tasks: h.controller,
        settings: h.settings,
      ),
    );
    await tester.pumpAndSettle();

    // Select Oct 12, then Add.
    await tester.tap(find.text('12'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Add'));
    await tester.pumpAndSettle();

    expect(find.text('New task'), findsOneWidget);
    // The date picker tile shows Oct 12 in the user's format.
    expect(find.text('Oct 12, 2026'), findsOneWidget);
  });
}
