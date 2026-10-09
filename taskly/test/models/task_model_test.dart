import 'package:flutter_test/flutter_test.dart';

import 'package:taskly/models/category.dart';
import 'package:taskly/models/priority.dart';
import 'package:taskly/models/task.dart';
import 'package:taskly/core/utils/date_helper.dart';

import '../helpers/fixtures.dart';

void main() {
  group('Task model', () {
    test('round-trips through its database map', () {
      final task = makeTask(
        id: 42,
        title: 'Buy oat milk',
        description: 'The barista one',
        due: DateTime(2026, 3, 9),
        minutes: 14 * 60 + 35,
        priority: TaskPriority.high,
        category: TaskCategory.shopping,
        completed: true,
        completedAt: DateTime(2026, 3, 9, 15, 2),
        reminder: true,
      );

      final restored = Task.fromMap(task.toMap());

      expect(restored.id, task.id);
      expect(restored.title, task.title);
      expect(restored.description, task.description);
      expect(restored.dueDate, task.dueDate);
      expect(restored.dueMinutes, task.dueMinutes);
      expect(restored.priority, task.priority);
      expect(restored.category, task.category);
      expect(restored.isCompleted, isTrue);
      expect(restored.completedAt, task.completedAt);
      expect(restored.reminderEnabled, isTrue);
    });

    test('insert map omits the id so SQLite assigns one', () {
      final task = makeTask();
      expect(task.toMap().containsKey('id'), isTrue);
      expect(task.toMap()['id'], 1);
    });

    test('copyWith can clear nullable fields with sentinels', () {
      final task = makeTask(
        minutes: 600,
        completed: true,
        completedAt: fixedNow(),
      );
      final cleared = task.copyWith(
        dueMinutes: null,
        completedAt: null,
        isCompleted: false,
      );
      expect(cleared.dueMinutes, isNull);
      expect(cleared.completedAt, isNull);
      expect(cleared.isCompleted, isFalse);
      // Untouched fields survive.
      expect(cleared.title, task.title);
      expect(cleared.dueDate, task.dueDate);
    });

    test('isOverdue only counts open past tasks', () {
      final now = fixedNow(); // Oct 7, 2026
      expect(
        makeTask(due: DateTime(2026, 10, 6)).isOverdue(now),
        isTrue,
        reason: 'yesterday + open = overdue',
      );
      expect(
        makeTask(due: DateTime(2026, 10, 6), completed: true).isOverdue(now),
        isFalse,
        reason: 'completed tasks are never overdue',
      );
      expect(
        makeTask(due: DateTime(2026, 10, 7)).isOverdue(now),
        isFalse,
        reason: 'due today is not overdue',
      );
      expect(makeTask(due: DateTime(2026, 10, 8)).isOverdue(now), isFalse);
    });

    test('dueDateTime combines date and minutes', () {
      final task = makeTask(due: DateTime(2026, 5, 4), minutes: 9 * 60 + 30);
      expect(task.dueDateTime, DateTime(2026, 5, 4, 9, 30));
      expect(
        makeTask(due: DateTime(2026, 5, 4)).dueDateTime,
        DateTime(2026, 5, 4),
      );
    });

    test('category parsing is safe for unknown keys', () {
      expect(TaskCategory.fromKey('shopping'), TaskCategory.shopping);
      expect(TaskCategory.fromKey('nonsense'), TaskCategory.other);
      expect(TaskCategory.fromKey(null), TaskCategory.other);
    });

    test('priority parsing is safe for unknown values', () {
      expect(TaskPriority.fromValue(0), TaskPriority.low);
      expect(TaskPriority.fromValue(2), TaskPriority.high);
      expect(TaskPriority.fromValue(99), TaskPriority.medium);
    });

    test('midnight storage is stable through DateHelper', () {
      final day = DateHelper.startOfDay(DateTime(2026, 11, 3, 17, 44));
      expect(day, DateTime(2026, 11, 3));
      final round = DateTime.fromMillisecondsSinceEpoch(
        day.millisecondsSinceEpoch,
      );
      expect(DateHelper.isSameDay(round, DateTime(2026, 11, 3)), isTrue);
    });
  });
}
