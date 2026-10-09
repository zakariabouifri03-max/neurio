import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite/sqflite.dart';
import 'package:sqflite_common_ffi/sqflite_common_ffi.dart';

import 'package:taskly/data/task_repository.dart';
import 'package:taskly/models/category.dart';
import 'package:taskly/models/priority.dart';
import 'package:taskly/models/task.dart';

import '../helpers/fixtures.dart';

void main() {
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  late Directory tempDir;
  late String dbPath;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('taskly_test');
    dbPath = '${tempDir.path}${Platform.pathSeparator}tasks.db';
  });

  tearDown(() async {
    if (await tempDir.exists()) await tempDir.delete(recursive: true);
  });

  group('TaskRepository CRUD', () {
    test('insert assigns a stable auto-increment id', () async {
      final repo = TaskRepository(debugPath: dbPath);
      final a = await repo.insert(makeTask(title: 'One', now: fixedNow()));
      final b = await repo.insert(makeTask(title: 'Two', now: fixedNow()));
      expect(a.id, greaterThan(0));
      expect(b.id, greaterThan(a.id));
      await repo.close();
    });

    test(
      'tasks survive a full close + reopen (device restart proxy)',
      () async {
        final repo = TaskRepository(debugPath: dbPath);
        final created = await repo.insert(
          makeTask(
            title: 'Persist me',
            due: DateTime(2026, 12, 25),
            minutes: 8 * 60 + 15,
            priority: TaskPriority.high,
            category: TaskCategory.study,
            reminder: true,
          ),
        );
        await repo.close();

        final repo2 = TaskRepository(debugPath: dbPath);
        final loaded = await repo2.findById(created.id);
        expect(loaded, isNotNull);
        expect(loaded!.title, 'Persist me');
        expect(loaded.dueMinutes, 8 * 60 + 15);
        expect(loaded.priority, TaskPriority.high);
        expect(loaded.category, TaskCategory.study);
        expect(loaded.reminderEnabled, isTrue);
        await repo2.close();
      },
    );

    test('update persists edits', () async {
      final repo = TaskRepository(debugPath: dbPath);
      final created = await repo.insert(makeTask(title: 'Before'));
      await repo.update(
        created.copyWith(title: 'After', priority: TaskPriority.low),
      );
      final loaded = (await repo.getAll()).single;
      expect(loaded.title, 'After');
      expect(loaded.priority, TaskPriority.low);
      await repo.close();
    });

    test('completion toggle persists with a timestamp', () async {
      final repo = TaskRepository(debugPath: dbPath);
      final created = await repo.insert(makeTask());

      final done = created.copyWith(isCompleted: true, completedAt: fixedNow());
      await repo.update(done);
      await repo.close();

      final repo2 = TaskRepository(debugPath: dbPath);
      final loaded = await repo2.findById(created.id);
      expect(loaded!.isCompleted, isTrue);
      expect(loaded.completedAt, fixedNow());

      final reopened = loaded.copyWith(isCompleted: false, completedAt: null);
      await repo2.update(reopened);
      final cleared = await repo2.findById(created.id);
      expect(cleared!.isCompleted, isFalse);
      expect(cleared.completedAt, isNull);
      await repo2.close();
    });

    test('delete removes exactly one row and reports it', () async {
      final repo = TaskRepository(debugPath: dbPath);
      final a = await repo.insert(makeTask(title: 'A'));
      final b = await repo.insert(makeTask(title: 'B'));
      expect(await repo.delete(a.id), 1);
      expect(await repo.delete(a.id), 0, reason: 'already gone');
      expect((await repo.getAll()).map((t) => t.id), [b.id]);
      await repo.close();
    });

    test('deleteAll clears the table', () async {
      final repo = TaskRepository(debugPath: dbPath);
      await repo.insert(makeTask());
      await repo.insert(makeTask(title: 'B'));
      expect(await repo.deleteAll(), 2);
      expect(await repo.getAll(), isEmpty);
      await repo.close();
    });
  });

  group('TaskRepository migrations', () {
    test('v1 databases upgrade to v2 and keep every task', () async {
      final repo = TaskRepository(debugPath: dbPath, debugVersion: 1);
      final created = await repo.insert(makeTask(title: 'Ancient task'));
      // Simulate completion under v1 (no completedAt column existed).
      await repo.update(created.copyWith(isCompleted: true));
      await repo.close();

      final repo2 = TaskRepository(debugPath: dbPath);
      final tasks = await repo2.getAll();
      expect(tasks, hasLength(1));
      expect(tasks.single.title, 'Ancient task');
      expect(tasks.single.isCompleted, isTrue);
      // Migration backfilled completedAt for finished tasks.
      expect(tasks.single.completedAt, isNotNull);
      // New schema accepts completedAt updates.
      await repo2.update(
        tasks.single.copyWith(completedAt: DateTime(2026, 10, 7)),
      );
      final updated = await repo2.findById(created.id);
      expect(updated!.completedAt, DateTime(2026, 10, 7));
      await repo2.close();
    });

    test('fresh databases are created directly at v2', () async {
      final repo = TaskRepository(debugPath: dbPath);
      await repo.insert(makeTask());
      final db = await repo.database;
      expect(await db.getVersion(), 2);
      await repo.close();
    });
  });
}
