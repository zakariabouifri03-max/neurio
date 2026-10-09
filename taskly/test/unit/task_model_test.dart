import 'package:flutter_test/flutter_test.dart';
import 'package:taskly/data/models/task.dart';
import 'package:taskly/data/models/task_category.dart';
import 'package:taskly/data/models/task_priority.dart';

Task makeTask({
  String title = 'Test task',
  DateTime? dueDate,
  String? dueTime,
  bool completed = false,
  bool reminder = false,
  int offset = 0,
}) {
  final now = DateTime(2026, 3, 5, 12, 0);
  return Task(
    id: 1,
    title: title,
    dueDate: dueDate ?? DateTime(2026, 3, 5),
    dueTime: dueTime,
    isCompleted: completed,
    createdAt: now,
    updatedAt: now,
    reminderEnabled: reminder,
    reminderOffsetMinutes: offset,
  );
}

void main() {
  group('due date logic', () {
    test('task with time is overdue only after that moment', () {
      final task = makeTask(dueTime: '14:30');
      expect(task.isOverdue(DateTime(2026, 3, 5, 14, 29)), isFalse);
      expect(task.isOverdue(DateTime(2026, 3, 5, 14, 31)), isTrue);
    });

    test('task without time is not overdue on its due day', () {
      final task = makeTask();
      expect(task.isOverdue(DateTime(2026, 3, 5, 23, 59)), isFalse);
      expect(task.isOverdue(DateTime(2026, 3, 6, 0, 1)), isTrue);
    });

    test('completed tasks are never overdue', () {
      final task = makeTask(completed: true);
      expect(task.isOverdue(DateTime(2027, 1, 1)), isFalse);
    });

    test('isDueOn matches calendar day only', () {
      final task = makeTask(dueDate: DateTime(2026, 3, 5));
      expect(task.isDueOn(DateTime(2026, 3, 5, 22, 10)), isTrue);
      expect(task.isDueOn(DateTime(2026, 3, 6, 1, 0)), isFalse);
    });

    test('upcoming means a later day', () {
      final task = makeTask(dueDate: DateTime(2026, 3, 7));
      expect(task.isUpcoming(DateTime(2026, 3, 5, 8)), isTrue);
      expect(task.isUpcoming(DateTime(2026, 3, 7, 8)), isFalse);
    });
  });

  group('reminder moments', () {
    test('reference time defaults to 9am without a due time', () {
      final task = makeTask();
      expect(task.referenceDateTime, DateTime(2026, 3, 5, 9, 0));
    });

    test('reminder offset subtracts from the due moment', () {
      final task = makeTask(dueTime: '10:00', reminder: true, offset: 60);
      expect(task.reminderAt, DateTime(2026, 3, 5, 9, 0));
    });

    test('no reminder moment when reminders are off', () {
      expect(makeTask(dueTime: '10:00').reminderAt, isNull);
    });
  });

  group('serialization', () {
    test('round-trips through map without losing data', () {
      final task = makeTask(
        title: 'Round trip',
        dueDate: DateTime(2026, 12, 31),
        dueTime: '23:59',
        reminder: true,
        offset: 30,
      );
      final restored = Task.fromMap(task.toMap());
      expect(restored.title, task.title);
      expect(restored.dueDate, task.dueDate);
      expect(restored.dueTime, '23:59');
      expect(restored.priority, TaskPriority.medium);
      expect(restored.category, TaskCategory.personal);
      expect(restored.reminderEnabled, isTrue);
      expect(restored.reminderOffsetMinutes, 30);
      expect(restored.isCompleted, isFalse);
    });

    test('fromMap tolerates missing optional columns', () {
      final restored = Task.fromMap(<String, Object?>{
        'id': 7,
        'title': 'Minimal',
        'due_date': '2026-01-02',
        'priority': 2,
        'category': 3,
        'is_completed': 1,
        'created_at': 0,
        'updated_at': 0,
      });
      expect(restored.id, 7);
      expect(restored.priority, TaskPriority.high);
      expect(restored.category, TaskCategory.health);
      expect(restored.isCompleted, isTrue);
      expect(restored.dueTime, isNull);
    });

    test('invalid stored time string is ignored safely', () {
      final restored = Task.fromMap(<String, Object?>{
        'title': 'Bad time',
        'due_date': '2026-01-02',
        'due_time': 'not-a-time',
        'created_at': 0,
        'updated_at': 0,
      });
      expect(restored.dueDateTime, isNull);
      expect(restored.referenceDateTime, DateTime(2026, 1, 2, 9, 0));
    });
  });

  group('copyWith', () {
    test('clears fields when asked', () {
      final task = makeTask(dueTime: '08:00', completed: true);
      final updated = task.copyWith(
        clearDueTime: true,
        isCompleted: false,
        clearCompletedAt: true,
      );
      expect(updated.dueTime, isNull);
      expect(updated.isCompleted, isFalse);
      expect(updated.completedAt, isNull);
      expect(updated.title, task.title);
    });
  });
}
