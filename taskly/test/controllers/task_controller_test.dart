import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite/sqflite.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

import 'package:taskly/controllers/task_controller.dart';
import 'package:taskly/data/task_repository.dart';
import 'package:taskly/models/category.dart';
import 'package:taskly/models/priority.dart';
import 'package:taskly/models/task_query.dart';
import 'package:taskly/notifications/reminder_scheduler.dart';

import '../helpers/fixtures.dart';

void main() {
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  late Directory tempDir;
  late String dbPath;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('taskly_ctrl');
    dbPath = '${tempDir.path}${Platform.pathSeparator}tasks.db';
  });

  tearDown(() async {
    if (await tempDir.exists()) await tempDir.delete(recursive: true);
  });

  group('TaskController', () {
    test('addTask stores and exposes the task, syncs reminders', () async {
      final scheduler = NoopReminderScheduler();
      final controller = TaskController(
        repository: TaskRepository(debugPath: dbPath),
        reminderScheduler: scheduler,
        clock: fixedNow,
      );
      await controller.load();
      expect(controller.loaded, isTrue);
      expect(controller.tasks, isEmpty);

      final task = await controller.addTask(
        title: '  Stretch  ',
        description: ' shoulders ',
        dueDate: fixedNow(),
        dueMinutes: 11 * 60,
        priority: TaskPriority.high,
        category: TaskCategory.health,
        reminderEnabled: true,
      );
      expect(task.id, greaterThan(0));
      expect(task.title, 'Stretch', reason: 'title is trimmed');
      expect(controller.tasks, hasLength(1));

      expect(scheduler.calls, contains('schedule:${task.id}'));

      // And it survives a repository round-trip.
      final repoTask = await controller.refreshAndFind(task.id);
      expect(repoTask!.title, 'Stretch');
    });

    test('toggleComplete flips state and updates honest stats', () async {
      final controller = TaskController(
        repository: TaskRepository(debugPath: dbPath),
        reminderScheduler: NoopReminderScheduler(),
        clock: fixedNow,
      );
      await controller.load();
      final task = await controller.addTask(
        title: 'Today thing',
        dueDate: fixedNow(),
        dueMinutes: 9 * 60,
      );

      expect(controller.dailyProgress().completed, 0);
      expect(controller.dailyProgress().total, 1);

      final done = await controller.toggleComplete(task);
      expect(done.isCompleted, isTrue);
      expect(done.completedAt, fixedNow());
      expect(controller.dailyProgress().completed, 1);
      expect(controller.allTodayDone, isTrue);

      final reopened = await controller.toggleComplete(done);
      expect(reopened.isCompleted, isFalse);
      expect(reopened.completedAt, isNull);
      expect(controller.dailyProgress().completed, 0);
      expect(controller.allTodayDone, isFalse);
    });

    test('updateTask persists edits and keeps reminders in sync', () async {
      final scheduler = NoopReminderScheduler();
      final controller = TaskController(
        repository: TaskRepository(debugPath: dbPath),
        reminderScheduler: scheduler,
        clock: fixedNow,
      );
      await controller.load();
      final task = await controller.addTask(
        title: 'Original',
        dueDate: fixedNow(),
      );

      final edited = await controller.updateTask(
        task.copyWith(
          title: 'Renamed',
          priority: TaskPriority.low,
          reminderEnabled: true,
        ),
      );
      expect(edited.title, 'Renamed');
      final loaded = await controller.refreshAndFind(task.id);
      expect(loaded!.title, 'Renamed');
      expect(loaded.priority, TaskPriority.low);
      // Reminder got scheduled after the edit enabled it.
      expect(scheduler.calls.contains('schedule:${task.id}'), isTrue);
    });

    test('deleteTask removes and cancels the reminder', () async {
      final scheduler = NoopReminderScheduler();
      final controller = TaskController(
        repository: TaskRepository(debugPath: dbPath),
        reminderScheduler: scheduler,
        clock: fixedNow,
      );
      await controller.load();
      final task = await controller.addTask(
        title: 'Doomed',
        dueDate: fixedNow(),
        reminderEnabled: true,
      );
      expect(controller.tasks, hasLength(1));

      final ok = await controller.deleteTask(task);
      expect(ok, isTrue);
      expect(controller.tasks, isEmpty);
      expect(scheduler.calls, contains('cancel:${task.id}'));

      final again = await controller.deleteTask(task);
      expect(again, isFalse, reason: 'deleting twice is a no-op');
    });

    test('todayUpNext orders overdue first, then by time', () async {
      final controller = TaskController(
        repository: TaskRepository(debugPath: dbPath),
        reminderScheduler: NoopReminderScheduler(),
        clock: fixedNow,
      );
      await controller.load();
      await controller.addTask(
        title: 'Later today',
        dueDate: fixedNow(),
        dueMinutes: 18 * 60,
      );
      await controller.addTask(
        title: 'Yesterday',
        dueDate: fixedNow().subtract(const Duration(days: 1)),
        dueMinutes: 9 * 60,
      );
      await controller.addTask(
        title: 'This morning',
        dueDate: fixedNow(),
        dueMinutes: 8 * 60,
      );

      final next = controller.todayUpNext().map((t) => t.title).toList();
      expect(next, ['Yesterday', 'This morning', 'Later today']);
    });

    test('query applies search/filter/sort over stored data', () async {
      final controller = TaskController(
        repository: TaskRepository(debugPath: dbPath),
        reminderScheduler: NoopReminderScheduler(),
        clock: fixedNow,
      );
      await controller.load();
      await controller.addTask(title: 'Alpha', dueDate: fixedNow());
      await controller.addTask(
        title: 'Beta',
        dueDate: fixedNow().add(const Duration(days: 3)),
      );

      final today = controller.applyQuery(
        const TaskQuery(filter: TaskFilter.today),
      );
      expect(today.map((t) => t.title), ['Alpha']);

      final search = controller.applyQuery(const TaskQuery(search: 'bet'));
      expect(search.map((t) => t.title), ['Beta']);
    });

    test('double load is safe (no duplicate work)', () async {
      final controller = TaskController(
        repository: TaskRepository(debugPath: dbPath),
        reminderScheduler: NoopReminderScheduler(),
        clock: fixedNow,
      );
      await Future.wait([controller.load(), controller.load()]);
      expect(controller.loaded, isTrue);
      expect(controller.tasks, isEmpty);
    });

    test('repository failure surfaces a friendly error, not a crash',
        () async {
      // A repository pointing at a directory path will fail to open.
      final controller = TaskController(
        repository: TaskRepository(debugPath: tempDir.path),
        reminderScheduler: NoopReminderScheduler(),
        clock: fixedNow,
      );
      await controller.load();
      expect(controller.loaded, isFalse);
      expect(controller.error, isNotNull);
      expect(controller.error, contains('try again'));
    });
  });
}
