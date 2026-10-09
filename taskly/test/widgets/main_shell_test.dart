import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

import 'package:taskly/pages/shell.dart';

import '../helpers/fixtures.dart';

void main() {
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  late Directory tempDir;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('taskly_shell');
  });

  tearDown(() async {
    if (await tempDir.exists()) await tempDir.delete(recursive: true);
  });

  Future<TestHarness> harness() =>
      TestHarness.create(dbPath: '${tempDir.path}/tasks.db');

  testWidgets('all four destinations render and switch', (tester) async {
    final h = await harness();
    await h.controller.load();

    await tester.pumpWidget(
      testApp(
        child: const MainShell(),
        tasks: h.controller,
        settings: h.settings,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Hey, superstar! ✨'), findsOneWidget);

    await tester.tap(find.text('My Tasks'));
    await tester.pumpAndSettle();
    expect(find.text('Search tasks…'), findsOneWidget);

    await tester.tap(find.text('Calendar'));
    await tester.pumpAndSettle();
    expect(find.text('Today'), findsWidgets);

    await tester.tap(find.text('Profile'));
    await tester.pumpAndSettle();
    expect(find.text('Appearance'), findsOneWidget);
    expect(find.text('Reminders'), findsOneWidget);
  });
}
