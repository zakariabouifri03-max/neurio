import '../core/utils/date_helper.dart';
import '../models/category.dart';
import '../models/task.dart';

/// Aggregated, honest statistics computed from real task data.
class DailyProgress {
  const DailyProgress({
    required this.completed,
    required this.total,
  });

  /// Tasks completed today (by completion timestamp).
  final int completed;

  /// Open tasks due today, plus everything completed today.
  final int total;

  double get ratio => total == 0 ? 0 : (completed / total).clamp(0.0, 1.0);

  int get percent => (ratio * 100).round();

  bool get isAllDone => total > 0 && completed >= total;
}

class WeeklyTrend {
  const WeeklyTrend({required this.thisWeek, required this.lastWeek});
  final int thisWeek;
  final int lastWeek;

  int get difference => thisWeek - lastWeek;
}

abstract final class StatsCalculator {
  /// Tasks completed on the calendar day of [day].
  static int completedOn(List<Task> tasks, DateTime day) => tasks
      .where((t) => t.isCompleted && DateHelper.isSameDay(t.completedAt, day))
      .length;

  /// Progress for "today": completed today vs. open tasks due today.
  ///
  /// If nothing is due today, falls back to completed-today so the ring can
  /// still celebrate finished work without inventing totals.
  static DailyProgress dailyProgress(List<Task> tasks, DateTime now) {
    final completed = completedOn(tasks, now);
    final openDueToday = tasks
        .where(
          (t) =>
              !t.isCompleted &&
              DateHelper.isSameDay(DateHelper.startOfDay(t.dueDate), now),
        )
        .length;
    final total = completed + openDueToday;
    return DailyProgress(completed: completed, total: total);
  }

  /// Tasks completed per day for the 7 days of the week containing [now].
  ///
  /// Returns buckets in display order of the user's preferred week start.
  static List<int> weeklyCompleted(
    List<Task> tasks,
    DateTime now,
    WeekStart weekStart,
  ) {
    final weekStartDay = DateHelper.startOfWeek(now, weekStart);
    return List.generate(7, (i) {
      final day = weekStartDay.add(Duration(days: i));
      return completedOn(tasks, day);
    });
  }

  /// Labels (Mon/Tue/... in week-start order) matching [weeklyCompleted].
  static List<String> weeklyLabels(WeekStart weekStart) =>
      DateHelper.weekdayLabels(weekStart);

  /// Completed task count per category, only including categories that have
  /// at least one completed task (keeps charts meaningful).
  static Map<TaskCategory, int> completedByCategory(List<Task> tasks) {
    final counts = <TaskCategory, int>{};
    for (final task in tasks.where((t) => t.isCompleted)) {
      counts[task.category] = (counts[task.category] ?? 0) + 1;
    }
    return counts;
  }

  /// Open task count per category (upcoming workload).
  static Map<TaskCategory, int> openByCategory(List<Task> tasks) {
    final counts = <TaskCategory, int>{};
    for (final task in tasks.where((t) => !t.isCompleted)) {
      counts[task.category] = (counts[task.category] ?? 0) + 1;
    }
    return counts;
  }

  static int totalCompleted(List<Task> tasks) =>
      tasks.where((t) => t.isCompleted).length;

  /// This week vs. last week completion, for a gentle honest trend.
  static WeeklyTrend weeklyTrend(
    List<Task> tasks,
    DateTime now,
    WeekStart weekStart,
  ) {
    final thisWeekStart = DateHelper.startOfWeek(now, weekStart);
    final lastWeekStart = thisWeekStart.subtract(const Duration(days: 7));
    var thisWeek = 0;
    var lastWeek = 0;
    for (final task in tasks.where((t) => t.isCompleted)) {
      final day = DateHelper.startOfDay(task.completedAt ?? task.dueDate);
      if (!day.isBefore(thisWeekStart)) {
        thisWeek++;
      } else if (!day.isBefore(lastWeekStart)) {
        lastWeek++;
      }
    }
    return WeeklyTrend(thisWeek: thisWeek, lastWeek: lastWeek);
  }
}
