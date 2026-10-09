import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:taskly/data/local/database_helper.dart';
import 'package:taskly/data/local/task_dao.dart';
import 'package:taskly/data/models/task.dart';
import 'package:taskly/data/models/task_priority.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();

  late Database database;
  late TaskDao dao;

  setUp(() async {
    database = await databaseFactoryFfi.openDatabase(
      inMemoryDatabasePath,
      options: OpenDatabaseOptions(
        version: DatabaseHelper.databaseVersion,
        onCreate: (db, version) => TaskSchema.create(db),
        onUpgrade: (db, oldV, newV) => TaskSchema.migrate(db, oldV, newV),
      ),
    );
    dao = TaskDao(database);
  });

  tearDown(() async => database.close());

  Task sample(String title) => Task(
        title: title,
        dueDate: DateTime(2026, 4, 1),
        createdAt: DateTime(2026, 3, 1),
        updatedAt: DateTime(2026, 3, 1),
      );

  test('insert assigns an id and persists every field', () async {
    final id = await dao.insert(sample('Persist me'));
    expect(id, greaterThan(0));
    final stored = await dao.byId(id);
    expect(stored, isNotNull);
    expect(stored!.title, 'Persist me');
    expect(stored.dueDate, DateTime(2026, 4, 1));
    expect(stored.priority, TaskPriority.medium);
  });

  test('update changes only the provided row', () async {
    final idA = await dao.insert(sample('A'));
    final idB = await dao.insert(sample('B'));
    final taskA = (await dao.byId(idA))!;
    await dao.update(taskA.copyWith(
      title: 'A renamed',
      priority: TaskPriority.high,
      isCompleted: true,
      updatedAt: DateTime(2026, 3, 2),
    ));
    expect((await dao.byId(idA))!.title, 'A renamed');
    expect((await dao.byId(idA))!.priority, TaskPriority.high);
    expect((await dao.byId(idA))!.isCompleted, isTrue);
    expect((await dao.byId(idB))!.title, 'B');
  });

  test('delete removes the row', () async {
    final id = await dao.insert(sample('Gone soon'));
    await dao.delete(id);
    expect(await dao.byId(id), isNull);
    expect(await dao.count(), 0);
  });

  test('data survives close and reopen (persistence)', () async {
    final dir = await databaseFactoryFfi.getDatabasesPath();
    final path = '$dir/taskly_test_persist.db';
    await databaseFactoryFfi.deleteDatabase(path);
    var db = await databaseFactoryFfi.openDatabase(
      path,
      options: OpenDatabaseOptions(
        version: DatabaseHelper.databaseVersion,
        onCreate: (d, v) => TaskSchema.create(d),
      ),
    );
    await TaskDao(db).insert(sample('Survivor'));
    await db.close();

    db = await databaseFactoryFfi.openDatabase(
      path,
      options: OpenDatabaseOptions(
        version: DatabaseHelper.databaseVersion,
        onCreate: (d, v) => TaskSchema.create(d),
      ),
    );
    final rows = await TaskDao(db).all();
    expect(rows.single.title, 'Survivor');
    await db.close();
    await databaseFactoryFfi.deleteDatabase(path);
  });

  test('schema migration v1 → v2 adds reminder columns', () async {
    final dir = await databaseFactoryFfi.getDatabasesPath();
    final path = '$dir/taskly_test_migration.db';
    await databaseFactoryFfi.deleteDatabase(path);

    // 1. Create a legacy (v1) database without reminder columns.
    var db = await databaseFactoryFfi.openDatabase(
      path,
      options: OpenDatabaseOptions(
        version: 1,
        onCreate: (database, version) async {
          await database.execute('''
            CREATE TABLE tasks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              title TEXT NOT NULL,
              description TEXT,
              due_date TEXT NOT NULL,
              due_time TEXT,
              priority INTEGER NOT NULL DEFAULT 1,
              category INTEGER NOT NULL DEFAULT 0,
              is_completed INTEGER NOT NULL DEFAULT 0,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              completed_at INTEGER
            )
          ''');
        },
      ),
    );
    await db.execute(
        'INSERT INTO tasks (title, due_date, priority, category, '
        'is_completed, created_at, updated_at) '
        'VALUES (?, ?, 1, 0, 0, 0, 0)', <Object>['Legacy task', '2026-01-01']);
    await db.close();

    // 2. Reopen at v2: onUpgrade must add the missing columns.
    db = await databaseFactoryFfi.openDatabase(
      path,
      options: OpenDatabaseOptions(
        version: DatabaseHelper.databaseVersion,
        onCreate: (database, version) => TaskSchema.create(database),
        onUpgrade: (database, oldV, newV) =>
            TaskSchema.migrate(database, oldV, newV),
      ),
    );
    final rows = await TaskDao(db).all();
    expect(rows.single.title, 'Legacy task');
    expect(rows.single.reminderEnabled, isFalse);
    await TaskDao(db).update(rows.single.copyWith(reminderEnabled: true));
    expect((await TaskDao(db).byId(rows.single.id!))!.reminderEnabled, isTrue);
    await db.close();
    await databaseFactoryFfi.deleteDatabase(path);
  });

  test('update without id throws a clear error', () async {
    expect(() => dao.update(sample('no id')), throwsArgumentError);
  });
}
