import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import '../models/task.dart';

/// SQLite-backed task storage. Offline-first: the database lives entirely on
/// the device and never leaves it.
class TaskRepository {
  TaskRepository({String? debugPath, int? debugVersion})
    : _debugPath = debugPath,
      _initialVersion = debugVersion;

  /// Tests inject an explicit file path so host VMs can run real SQL.
  final String? _debugPath;

  /// Tests may create an old schema version to exercise migrations.
  final int? _initialVersion;

  Database? _db;

  /// Direct escape hatch for tests.
  Database? get debugDatabase => _db;

  Future<Database> get database async {
    final existing = _db;
    if (existing != null && existing.isOpen) return existing;
    _db = await _open();
    return _db!;
  }

  Future<Database> _open() async {
    final path = _debugPath ?? await _defaultPath();
    return openDatabase(
      path,
      version: _schemaVersion,
      onConfigure: (db) => db.execute('PRAGMA foreign_keys = ON'),
      onCreate: (db, version) async {
        // Tests can simulate starting from an older schema.
        final simulated = _initialVersion;
        if (simulated != null && simulated < version) {
          await db.execute(_schemaV1);
          await _upgradeV1ToV2(db);
          return;
        }
        await db.execute(_schemaV2);
      },
      onUpgrade: (db, oldVersion, newVersion) async {
        if (oldVersion < 2) await _upgradeV1ToV2(db);
      },
    );
  }

  Future<String> _defaultPath() async {
    final dir = await getDatabasesPath();
    return p.join(dir, 'taskly.db');
  }

  /// Schema v1 (shipped to early internal testers): no completedAt column.
  static const String _schemaV1 = '''
    CREATE TABLE tasks(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      dueDate INTEGER NOT NULL,
      dueMinutes INTEGER,
      priority INTEGER NOT NULL DEFAULT 1,
      category TEXT NOT NULL DEFAULT 'other',
      isCompleted INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      reminderEnabled INTEGER NOT NULL DEFAULT 0
    )
  ''';

  /// Schema v2: adds completedAt so statistics can report *when* work was
  /// finished. Migration backfills completedAt from updatedAt for finished
  /// tasks — close enough for aggregate stats, and never invents data for
  /// open tasks.
  static const String _schemaV2 = '''
    CREATE TABLE tasks(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      dueDate INTEGER NOT NULL,
      dueMinutes INTEGER,
      priority INTEGER NOT NULL DEFAULT 1,
      category TEXT NOT NULL DEFAULT 'other',
      isCompleted INTEGER NOT NULL DEFAULT 0,
      completedAt INTEGER,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      reminderEnabled INTEGER NOT NULL DEFAULT 0
    )
  ''';

  static const int _schemaVersion = 2;

  static Future<void> _upgradeV1ToV2(Database db) async {
    await db.execute('ALTER TABLE tasks ADD COLUMN completedAt INTEGER');
    await db.execute(
      'UPDATE tasks SET completedAt = updatedAt WHERE isCompleted = 1 '
      'AND completedAt IS NULL',
    );
  }

  // ---------------- CRUD ----------------

  /// Inserts [task] and returns it with its database id.
  Future<Task> insert(Task task) async {
    final db = await database;
    final map = task.toMap()..remove('id');
    final id = await db.insert('tasks', map);
    return task.copyWith(id: id);
  }

  Future<Task> update(Task task) async {
    final db = await database;
    await db.update(
      'tasks',
      task.toMap(),
      where: 'id = ?',
      whereArgs: [task.id],
    );
    return task;
  }

  /// Returns the number of rows removed (0 means the task was already gone).
  Future<int> delete(int id) async {
    final db = await database;
    return db.delete('tasks', where: 'id = ?', whereArgs: [id]);
  }

  Future<Task?> findById(int id) async {
    final db = await database;
    final rows = await db.query(
      'tasks',
      where: 'id = ?',
      whereArgs: [id],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return Task.fromMap(rows.first);
  }

  /// All tasks, newest creations first. Callers apply query/sort logic.
  Future<List<Task>> getAll() async {
    final db = await database;
    final rows = await db.query('tasks', orderBy: 'createdAt DESC, id DESC');
    return rows.map(Task.fromMap).toList();
  }

  /// Deletes every task. Exposed through Settings → Danger zone with a
  /// double confirmation; useful for starting fresh.
  Future<int> deleteAll() async {
    final db = await database;
    return db.delete('tasks');
  }

  Future<void> close() async {
    await _db?.close();
    _db = null;
  }
}
