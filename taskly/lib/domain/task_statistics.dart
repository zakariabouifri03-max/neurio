import 'package:intl/intl.dart';

import '../core/utils/date_utils.dart';
import '../data/models/task.dart';
import '../data/models/task_category.dart';

/// A single bar of the weekly completion chart.
class WeekPoint {
  const WeekPoint({required this.day, required this.count});

  final DateTime day;
  final int count;

  String get shortLabel => DateFormat('E').format(day).substring(0, 2);
}

/// All statistics are derived from saved tasks. Empty data produces empty
/// (but valid) statistics — never invented numbers.
class TaskStatistics {
  const TaskStatistics({
    required this.completedToday,
    required this.completedThisWeek,
    required this.completedLastWeek,
    required this.totalCompleted,
    required this.totalTasks,
    required this.week,
    required this.categoryBreakdown,
  });

  final int completedToday;
  final int completedThisWeek;
  final int completedLastWeek;
  final int totalCompleted;
  final int totalTasks;
  final List<WeekPoint> week;
  final Map<TaskCategory, int> categoryBreakdown;

  /// Completions this week minus last week (real trend, can be negative).
  int get weekDelta => completedThisWeek - completedLastWeek;

  String get trendLabel {
    if (completedThisWeek == 0 && completedLastWeek == 0) {
      return 'Complete a task to start your trend.';
    }
    if (weekDelta > 0) {
      return 'Up $weekDelta completion${weekDelta == 1 ? '' : 's'} vs last week. Lovely momentum!';
    }
    if (weekDelta < 0) {
      return 'A quieter week than last — that\u2019s okay, progress isn\u2019t linear.';
    }
    return 'Steady as last week. Consistency is its own kind of win.';
  }

  bool get isEmpty => totalTasks == 0;

  static TaskStatistics from(List<Task> tasks, DateTime now,
      {int firstWeekday = DateTime.monday}) {
    final today = TasklyDates.dayOnly(now);
    final thisWeekStart = TasklyDates.startOfWeek(now, firstWeekday);
    final lastWeekStart = thisWeekStart.subtract(const Duration(days: 7));

    var completedToday = 0;
    var completedThisWeek = 0;
    var completedLastWeek = 0;
    var totalCompleted = 0;

    final weekDays = TasklyDates.weekDays(now, firstWeekday);
    final counts = List<int>.filled(7, 0);
    final categories = <TaskCategory, int>{};

    for (final task in tasks) {
      final done = task.completedAt;
      if (done != null && task.isCompleted) {
        totalCompleted++;
        final day = TasklyDates.dayOnly(done);
        if (day == today) completedToday++;
        if (!day.isBefore(thisWeekStart) && day.isBefore(thisWeekStart.add(const Duration(days: 7)))) {
          completedThisWeek++;
        }
        if (!day.isBefore(lastWeekStart) && day.isBefore(thisWeekStart)) {
          completedLastWeek++;
        }
        for (var i = 0; i < 7; i++) {
          if (weekDays[i] == day) {
            counts[i]++;
            break;
          }
        }
      }
      if (task.isCompleted) {
        categories[task.category] = (categories[task.category] ?? 0) + 1;
      }
    }

    final week = <WeekPoint>[
      for (var i = 0; i < 7; i++) WeekPoint(day: weekDays[i], count: counts[i])
    ];

    final sortedCategories = Map<TaskCategory, int>.fromEntries(
      categories.entries.toList()
        ..sort((a, b) => b.value.compareTo(a.value)),
    );

    return TaskStatistics(
      completedToday: completedToday,
      completedThisWeek: completedThisWeek,
      completedLastWeek: completedLastWeek,
      totalCompleted: totalCompleted,
      totalTasks: tasks.length,
      week: week,
      categoryBreakdown: sortedCategories,
    );
  }
}
