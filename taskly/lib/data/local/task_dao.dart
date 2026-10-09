import 'package:sqflite/sqflite.dart';

import '../models/task.dart';

/// All SQL access for tasks lives here — the rest of the app only sees
/// [Task] objects.
class TaskDao {
  const TaskDao(this.db);

  final DatabaseExecutor db;

  static const String table = 'tasks';

  Future<List<Task>> all() async {
    final rows = await db.query(table, orderBy: 'due_date ASC, due_time ASC, '
        'priority DESC, created_at ASC');
    return rows.map(Task.fromMap).toList(growable: false);
  }

  Future<Task?> byId(int id) async {
    final rows = await db.query(table, where: 'id = ?', whereArgs: <Object>[id]);
    if (rows.isEmpty) return null;
    return Task.fromMap(rows.first);
  }

  Future<int> insert(Task task) async => db.insert(table, task.toMap());

  Future<int> update(Task task) async {
    final id = task.id;
    if (id == null) {
      throw ArgumentError('Cannot update a task without an id');
    }
    return db.update(table, task.toMap()..remove('id'),
        where: 'id = ?', whereArgs: <Object>[id]);
  }

  Future<int> delete(int id) =>
      db.delete(table, where: 'id = ?', whereArgs: <Object>[id]);

  Future<int> count() async {
    final rows =
        await db.rawQuery('SELECT COUNT(*) AS c FROM $table');
    return (rows.first['c'] as int?) ?? 0;
  }
}
