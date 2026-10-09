import 'package:sqflite/sqflite.dart';

/// Owns the SQLite database file and schema migrations.
class DatabaseHelper {
  DatabaseHelper._();

  static final DatabaseHelper instance = DatabaseHelper._();

  static const String databaseName = 'taskly.db';
  static const int databaseVersion = 2;

  Database? _database;

  Future<Database> get database async => _database ??= await _open();

  Future<Database> _open() async {
    final dir = await getDatabasesPath();
    final path = '$dir/$databaseName';
    return openDatabase(
      path,
      version: databaseVersion,
      onCreate: (db, version) => TaskSchema.create(db),
      onUpgrade: (db, oldVersion, newVersion) =>
          TaskSchema.migrate(db, oldVersion, newVersion),
    );
  }

  /// Test hook: close so a fresh in-memory db can be used in tests.
  Future<void> close() async {
    await _database?.close();
    _database = null;
  }
}

/// Schema statements, shared with tests so they run against the real schema.
class TaskSchema {
  const TaskSchema._();

  static const String createTasksTable = '''
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
      completed_at INTEGER,
      reminder_enabled INTEGER NOT NULL DEFAULT 0,
      reminder_offset_minutes INTEGER
    )
  ''';

  static Future<void> create(DatabaseExecutor db) async {
    await db.execute(createTasksTable);
    await db.execute(
        'CREATE INDEX idx_tasks_due_date ON tasks (due_date, is_completed)');
    await db.execute('CREATE INDEX idx_tasks_completed ON tasks (is_completed)');
  }

  /// Defensive, idempotent migrations for older installs.
  static Future<void> migrate(
      DatabaseExecutor db, int oldVersion, int newVersion) async {
    if (oldVersion < 1) {
      await create(db);
      return;
    }
    if (oldVersion < 2) {
      final columns = await db.query('pragma_table_info(tasks)');
      final names = columns.map((c) => c['name'] as String).toSet();
      if (!names.contains('reminder_enabled')) {
        await db.execute(
            'ALTER TABLE tasks ADD COLUMN reminder_enabled INTEGER NOT NULL DEFAULT 0');
      }
      if (!names.contains('reminder_offset_minutes')) {
        await db.execute(
            'ALTER TABLE tasks ADD COLUMN reminder_offset_minutes INTEGER');
      }
    }
  }
}
