import 'package:flutter_test/flutter_test.dart';
import 'package:taskly/core/utils/date_utils.dart';
import 'package:taskly/core/utils/validators.dart';
import 'package:taskly/domain/daily_progress.dart';
import 'package:taskly/domain/task_query.dart';
import 'package:taskly/domain/task_statistics.dart';
import 'package:taskly/data/models/task.dart';
import 'package:taskly/data/models/task_category.dart';
import 'package:taskly/data/models/task_priority.dart';

Task t(
  String title, {
  DateTime? due,
  String? time,
  TaskPriority priority = TaskPriority.medium,
  TaskCategory category = TaskCategory.personal,
  bool completed = false,
  DateTime? completedAt,
  int createdDay = 1,
}) {
  return Task(
    id: title.hashCode,
    title: title,
    dueDate: due ?? DateTime(2026, 3, 5),
    dueTime: time,
    priority: priority,
    category: category,
    isCompleted: completed,
    createdAt: DateTime(2026, 3, createdDay, 10),
    updatedAt: DateTime(2026, 3, createdDay, 10),
    completedAt: completedAt,
  );
}

void main() {
  final now = DateTime(2026, 3, 5, 12, 0);

  group('TaskQuery', () {
    final tasks = <Task>[
      t('Buy milk', due: DateTime(2026, 3, 5)),
      t('Old report', due: DateTime(2026, 3, 1), completed: false),
      t('Future trip', due: DateTime(2026, 3, 20)),
      t('Done thing', due: DateTime(2026, 3, 5), completed: true),
      t('Study notes', due: DateTime(2026, 3, 6), category: TaskCategory.study),
    ];

    test('filter today matches only same-day tasks', () {
      final result =
          const TaskQuery(filter: TaskFilter.today).apply(tasks, now);
      expect(result.map((e) => e.title),
          containsAll(<String>['Buy milk', 'Done thing']));
      expect(result.length, 2);
    });

    test('overdue filter excludes completed and future', () {
      final result =
          const TaskQuery(filter: TaskFilter.overdue).apply(tasks, now);
      expect(result.map((e) => e.title), <String>['Old report']);
    });

    test('search matches title and description', () {
      final withDescription = <Task>[
        t('Groceries', due: DateTime(2026, 3, 5)),
        Task(
          id: 99,
          title: 'Errand',
          description: 'pick up groceries for dinner',
          dueDate: DateTime(2026, 3, 5),
          createdAt: now,
          updatedAt: now,
        ),
      ];
      final result = const TaskQuery(search: 'grocer')
          .apply(withDescription, now);
      expect(result.length, 2);
    });

    test('category and priority refinements combine', () {
      final result = const TaskQuery(
        category: TaskCategory.study,
        priority: TaskPriority.medium,
      ).apply(tasks, now);
      expect(result.single.title, 'Study notes');
    });

    test('sorting by priority puts high first', () {
      final mixed = <Task>[
        t('low', priority: TaskPriority.low),
        t('high', priority: TaskPriority.high),
        t('med', priority: TaskPriority.medium),
      ];
      final result =
          const TaskQuery(sort: TaskSort.priority).apply(mixed, now);
      expect(result.map((e) => e.title), <String>['high', 'med', 'low']);
    });

    test('alphabetical sort is case-insensitive', () {
      final mixed = <Task>[t('banana'), t('Apple'), t('cherry')];
      final result =
          const TaskQuery(sort: TaskSort.alphabetical).apply(mixed, now);
      expect(result.map((e) => e.title), <String>['Apple', 'banana', 'cherry']);
    });

    test('clearing refinements resets the query', () {
      const query = TaskQuery(
          search: 'x',
          filter: TaskFilter.overdue,
          category: TaskCategory.work);
      final cleared = query.copyWith(
          search: '',
          filter: TaskFilter.all,
          clearCategory: true);
      expect(cleared.hasActiveRefinements, isFalse);
    });
  });

  group('DailyProgress', () {
    test('percent math is exact and clamped', () {
      const progress = DailyProgress(completed: 1, total: 4);
      expect(progress.percent, 25);
      expect(progress.fraction, 0.25);
      const empty = DailyProgress(completed: 0, total: 0);
      expect(empty.percent, 0);
      expect(empty.isAllDone, isFalse);
    });

    test('messages reflect real state', () {
      expect(const DailyProgress(completed: 0, total: 0).message,
          contains('blank canvas'));
      expect(const DailyProgress(completed: 2, total: 2).message,
          contains('amazing'));
      expect(const DailyProgress(completed: 2, total: 3).message,
          contains('progress'));
    });
  });

  group('TaskStatistics', () {
    test('counts completions by completedAt day', () {
      final tasks = <Task>[
        t('a', completed: true, completedAt: DateTime(2026, 3, 5, 9)),
        t('b', completed: true, completedAt: DateTime(2026, 3, 4, 9)),
        t('c', completed: true, completedAt: DateTime(2026, 2, 26, 9)),
        t('d'),
      ];
      final stats = TaskStatistics.from(tasks, now);
      expect(stats.completedToday, 1);
      expect(stats.completedThisWeek, 2); // Mon 2 – Sun 8 week
      expect(stats.completedLastWeek, 1);
      expect(stats.totalCompleted, 3);
      expect(stats.totalTasks, 4);
      expect(stats.weekDelta, 1);
    });

    test('empty data yields empty statistics, not fake numbers', () {
      final stats = TaskStatistics.from(<Task>[], now);
      expect(stats.isEmpty, isTrue);
      expect(stats.completedToday, 0);
      expect(stats.week.every((p) => p.count == 0), isTrue);
      expect(stats.categoryBreakdown, isEmpty);
    });

    test('category breakdown only counts completed tasks', () {
      final tasks = <Task>[
        t('a', category: TaskCategory.work, completed: true,
            completedAt: DateTime(2026, 3, 3)),
        t('b', category: TaskCategory.work),
        t('c', category: TaskCategory.health, completed: true,
            completedAt: DateTime(2026, 3, 3)),
      ];
      final stats = TaskStatistics.from(tasks, now);
      expect(stats.categoryBreakdown[TaskCategory.work], 1);
      expect(stats.categoryBreakdown[TaskCategory.health], 1);
      expect(stats.categoryBreakdown.containsKey(TaskCategory.personal),
          isFalse);
    });
  });

  group('dates', () {
    test('month grid covers whole weeks and leap years', () {
      final feb2024 = TasklyDates.monthGrid(DateTime(2024, 2, 1), DateTime.monday);
      expect(feb2024.length % 7, 0);
      expect(feb2024.any((d) => d.day == 29 && d.month == 2), isTrue);
      final feb2026 = TasklyDates.monthGrid(DateTime(2026, 2, 1), DateTime.monday);
      expect(feb2026.any((d) => d.day == 29 && d.month == 2), isFalse);
    });

    test('startOfWeek honors preference', () {
      final wednesday = DateTime(2026, 3, 4);
      expect(TasklyDates.startOfWeek(wednesday, DateTime.monday),
          DateTime(2026, 3, 2));
      expect(TasklyDates.startOfWeek(wednesday, DateTime.sunday),
          DateTime(2026, 3, 1));
    });

    test('time formatting supports 12h and 24h', () {
      expect(TasklyDates.formatTime('14:05'), '2:05 PM');
      expect(TasklyDates.formatTime('00:30'), '12:30 AM');
      expect(TasklyDates.formatTime('14:05', use24Hour: true), '14:05');
    });
  });

  group('validators', () {
    test('title required and bounded', () {
      expect(Validators.taskTitle(''), isNotNull);
      expect(Validators.taskTitle('   '), isNotNull);
      expect(Validators.taskTitle('Plan the week'), isNull);
      expect(Validators.taskTitle('x' * 121), isNotNull);
    });

    test('preferred name optional but bounded', () {
      expect(Validators.preferredName(''), isNull);
      expect(Validators.preferredName('Sam'), isNull);
      expect(Validators.preferredName('y' * 31), isNotNull);
    });
  });
}
