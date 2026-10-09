import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:taskly/data/local/database_helper.dart';
import 'package:taskly/data/local/task_dao.dart';
import 'package:taskly/data/models/task.dart';
import 'package:taskly/services/reminder_scheduler.dart';
import 'package:taskly/state/tasks_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();

  late Database database;
  late TasksStore store;
  final fixedNow = DateTime(2026, 3, 5, 12, 0);

  setUp(() async {
    database = await databaseFactoryFfi.openDatabase(
      inMemoryDatabasePath,
      options: OpenDatabaseOptions(
        version: DatabaseHelper.databaseVersion,
        onCreate: (db, version) => TaskSchema.create(db),
      ),
    );
    store = TasksStore(
      dao: TaskDao(database),
      reminders: NoopReminderScheduler(),
      clock: () => fixedNow,
    );
    await store.load();
  });

  tearDown(() async => database.close());

  Task draft(String title, {DateTime? due, bool completed = false}) => Task(
        title: title,
        dueDate: due ?? fixedNow,
        isCompleted: completed,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      );

  test('load starts empty and notifies', () {
    expect(store.tasks, isEmpty);
    expect(store.isLoading, isFalse);
  });

  test('addTask persists and exposes the saved task', () async {
    final saved = await store.addTask(draft('Write tests'));
    expect(saved, isNotNull);
    expect(saved!.id, isNotNull);
    expect(store.tasks.single.title, 'Write tests');
  });

  test('setCompleted updates progress and completedAt', () async {
    final saved = await store.addTask(draft('Complete me'));
    await store.setCompleted(saved!, true);
    final updated = store.byId(saved.id!)!;
    expect(updated.isCompleted, isTrue);
    expect(updated.completedAt, fixedNow);
    expect(store.todayProgress().completed, 1);
    expect(store.todayProgress().percent, 100);

    await store.setCompleted(updated, false);
    final reopened = store.byId(saved.id!)!;
    expect(reopened.isCompleted, isFalse);
    expect(reopened.completedAt, isNull);
    expect(store.todayProgress().completed, 0);
  });

  test('updateTask keeps a single row per id', () async {
    final saved = await store.addTask(draft('Original'));
    await store.updateTask(saved!.copyWith(
      title: 'Renamed',
      updatedAt: fixedNow.add(const Duration(minutes: 5)),
    ));
    expect(store.tasks.length, 1);
    expect(store.tasks.single.title, 'Renamed');
  });

  test('deleteTask removes from store and database', () async {
    final saved = await store.addTask(draft('Doomed'));
    await store.deleteTask(saved!);
    expect(store.tasks, isEmpty);
    final dao = TaskDao(database);
    expect(await dao.byId(saved.id!), isNull);
  });

  test('dueToday only contains same-day tasks', () async {
    await store.addTask(draft('Today'));
    await store.addTask(draft('Tomorrow', due: fixedNow.add(const Duration(days: 1))));
    expect(store.dueToday().map((t) => t.title), <String>['Today']);
  });

  test('state survives a simulated app restart', () async {
    await store.addTask(draft('Survivor'));
    await store.setCompleted(store.tasks.single, true);

    // New store instance over the same database = fresh app launch.
    final restarted = TasksStore(
      dao: TaskDao(database),
      reminders: NoopReminderScheduler(),
      clock: () => fixedNow,
    );
    await restarted.load();
    expect(restarted.tasks.single.title, 'Survivor');
    expect(restarted.tasks.single.isCompleted, isTrue);
    expect(restarted.todayProgress().percent, 100);
  });
}
