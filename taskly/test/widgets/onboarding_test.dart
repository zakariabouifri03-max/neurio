import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite/sqflite.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

import 'package:taskly/controllers/task_controller.dart';
import 'package:taskly/data/task_repository.dart';
import 'package:taskly/notifications/reminder_scheduler.dart';
import 'package:taskly/pages/onboarding_page.dart';

import '../helpers/fixtures.dart';

void main() {
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  late Directory tempDir;
  late TaskController tasks;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('taskly_onboarding');
    tasks = TaskController(
      repository: TaskRepository(debugPath: '${tempDir.path}/tasks.db'),
      reminderScheduler: NoopReminderScheduler(),
      clock: fixedNow,
    );
    await tasks.load();
  });

  tearDown(() async {
    if (await tempDir.exists()) await tempDir.delete(recursive: true);
  });

  testWidgets('Skip completes onboarding immediately', (tester) async {
    final settings = await makeSettings();
    expect(settings.onboardingComplete, isFalse);

    await tester.pumpWidget(
      testApp(
        child: const OnboardingPage(),
        tasks: tasks,
        settings: settings,
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Skip'));
    await tester.pumpAndSettle();

    expect(settings.onboardingComplete, isTrue);
  });

  testWidgets('Continue advances pages; last page shows Get Started',
      (tester) async {
    final settings = await makeSettings();

    await tester.pumpWidget(
      testApp(
        child: const OnboardingPage(),
        tasks: tasks,
        settings: settings,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Organize your day'), findsOneWidget);
    expect(find.text('Continue'), findsOneWidget);

    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('Priorities & reminders'), findsOneWidget);

    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('Celebrate small wins'), findsOneWidget);
    expect(find.text('Get Started'), findsOneWidget);

    await tester.tap(find.text('Get Started'));
    await tester.pumpAndSettle();
    expect(settings.onboardingComplete, isTrue);
  });
}
