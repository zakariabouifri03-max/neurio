import 'package:flutter_test/flutter_test.dart';

import 'package:taskly/core/utils/date_helper.dart';
import 'package:taskly/logic/motivational.dart';
import 'package:taskly/logic/stats_calculator.dart';
import 'package:taskly/models/category.dart';

import '../helpers/fixtures.dart';

void main() {
  final now = fixedNow(); // Wed Oct 7, 2026

  group('StatsCalculator.dailyProgress', () {
    test('empty day reports nothing', () {
      final progress = StatsCalculator.dailyProgress([], now);
      expect(progress.completed, 0);
      expect(progress.total, 0);
      expect(progress.ratio, 0);
      expect(progress.isAllDone, isFalse);
    });

    test('counts completed today against open due today', () {
      final tasks = [
        makeTask(id: 1, due: now, completed: true, completedAt: now),
        makeTask(id: 2, due: now),
        makeTask(id: 3, due: DateTime(2026, 10, 9)),
      ];
      final progress = StatsCalculator.dailyProgress(tasks, now);
      expect(progress.completed, 1);
      expect(progress.total, 2);
      expect(progress.percent, 50);
      expect(progress.isAllDone, isFalse);
    });

    test('all done when nothing open remains for today', () {
      final tasks = [
        makeTask(id: 1, due: now, completed: true, completedAt: now),
        makeTask(id: 2, due: now, completed: true, completedAt: now),
        makeTask(id: 3, due: DateTime(2026, 10, 9)),
      ];
      expect(StatsCalculator.dailyProgress(tasks, now).isAllDone, isTrue);
    });

    test('completion must be today to count', () {
      final tasks = [
        makeTask(
          id: 1,
          due: DateTime(2026, 10, 5),
          completed: true,
          completedAt: DateTime(2026, 10, 5),
        ),
      ];
      final progress = StatsCalculator.dailyProgress(tasks, now);
      expect(progress.completed, 0);
    });
  });

  group('StatsCalculator.weeklyCompleted', () {
    test('buckets by week start (Sunday)', () {
      final tasks = [
        makeTask(
          id: 1,
          completed: true,
          completedAt: DateTime(2026, 10, 4), // Sunday
          due: DateTime(2026, 10, 4),
        ),
        makeTask(
          id: 2,
          completed: true,
          completedAt: DateTime(2026, 10, 7), // Wednesday (today)
          due: DateTime(2026, 10, 7),
        ),
        makeTask(
          id: 3,
          completed: true,
          completedAt: DateTime(2026, 9, 30), // last week
          due: DateTime(2026, 9, 30),
        ),
      ];
      final week = StatsCalculator.weeklyCompleted(tasks, now, WeekStart.sunday);
      expect(week, [1, 0, 0, 1, 0, 0, 0]);
    });

    test('Monday start shifts the buckets', () {
      final tasks = [
        makeTask(
          id: 1,
          completed: true,
          completedAt: DateTime(2026, 10, 4), // Sunday -> last bucket
          due: DateTime(2026, 10, 4),
        ),
      ];
      final week = StatsCalculator.weeklyCompleted(tasks, now, WeekStart.monday);
      expect(week.last, 1);
      expect(week.first, 0);
    });

    test('labels align with buckets', () {
      final labels = StatsCalculator.weeklyLabels(WeekStart.saturday);
      expect(labels.first, 'Sat');
      expect(labels.last, 'Fri');
    });
  });

  group('StatsCalculator.category counts', () {
    test('completedByCategory skips empty categories', () {
      final tasks = [
        makeTask(id: 1, category: TaskCategory.work, completed: true, completedAt: now),
        makeTask(id: 2, category: TaskCategory.work, completed: true, completedAt: now),
        makeTask(id: 3, category: TaskCategory.health),
      ];
      final counts = StatsCalculator.completedByCategory(tasks);
      expect(counts.keys, [TaskCategory.work]);
      expect(counts[TaskCategory.work], 2);
    });

    test('openByCategory counts only open tasks', () {
      final tasks = [
        makeTask(id: 1, category: TaskCategory.study),
        makeTask(id: 2, category: TaskCategory.study, completed: true, completedAt: now),
      ];
      final counts = StatsCalculator.openByCategory(tasks);
      expect(counts[TaskCategory.study], 1);
    });

    test('totalCompleted', () {
      final tasks = [
        makeTask(id: 1, completed: true, completedAt: now),
        makeTask(id: 2),
      ];
      expect(StatsCalculator.totalCompleted(tasks), 1);
    });
  });

  group('StatsCalculator.weeklyTrend', () {
    test('difference is honest', () {
      final tasks = [
        // This week: 2
        makeTask(id: 1, completed: true, completedAt: DateTime(2026, 10, 5), due: DateTime(2026, 10, 5)),
        makeTask(id: 2, completed: true, completedAt: DateTime(2026, 10, 6), due: DateTime(2026, 10, 6)),
        // Last week: 1
        makeTask(id: 3, completed: true, completedAt: DateTime(2026, 10, 1), due: DateTime(2026, 10, 1)),
        // Two weeks ago: ignored
        makeTask(id: 4, completed: true, completedAt: DateTime(2026, 9, 20), due: DateTime(2026, 9, 20)),
      ];
      final trend = StatsCalculator.weeklyTrend(tasks, now, WeekStart.monday);
      expect(trend.thisWeek, 2);
      expect(trend.lastWeek, 1);
      expect(trend.difference, 1);
    });
  });

  group('Motivational lines', () {
    test('blank canvas when there is nothing scheduled', () {
      final line = Motivational.pick(
        StatsCalculator.dailyProgress([], now),
        now,
      );
      expect(line, contains('canvas'));
    });

    test('celebration when everything is done', () {
      final progress = StatsCalculator.dailyProgress(
        [makeTask(id: 1, due: now, completed: true, completedAt: now)],
        now,
      );
      final line = Motivational.pick(progress, now);
      expect(line.length, greaterThan(0));
    });

    test('line is stable within the hour (no flicker)', () {
      final tasks = [makeTask(id: 1, due: now)];
      final a = Motivational.pick(
        StatsCalculator.dailyProgress(tasks, now),
        now,
      );
      final b = Motivational.pick(
        StatsCalculator.dailyProgress(tasks, now),
        now,
      );
      expect(a, b);
    });
  });
}
