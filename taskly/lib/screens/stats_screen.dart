import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/theme/app_theme.dart';
import '../domain/task_statistics.dart';
import '../state/settings_store.dart';
import '../state/tasks_store.dart';
import '../widgets/charts.dart';
import '../widgets/cute_card.dart';
import '../widgets/empty_state.dart';
import '../widgets/illustrations.dart';
import '../widgets/progress_ring.dart';
import '../widgets/search_and_filters.dart';

/// Productivity insights computed from real saved data only.
class StatsScreen extends StatelessWidget {
  const StatsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    final theme = Theme.of(context);
    final store = context.watch<TasksStore>();
    final settings = context.watch<SettingsStore>();
    final stats = TaskStatistics.from(
      store.tasks,
      DateTime.now(),
      firstWeekday: settings.firstWeekday,
    );
    final progress = store.todayProgress();

    return Scaffold(
      backgroundColor: palette.cream,
      appBar: AppBar(title: const Text('Your progress')),
      body: SafeArea(
        child: stats.isEmpty
            ? EmptyState(
                illustration: Illustrations.progress(size: 150),
                title: 'No insights yet',
                message: 'As soon as you create and complete tasks, your '
                    'story shows up here.',
              )
            : ListView(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
                children: <Widget>[
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: _StatCard(
                          label: 'Done today',
                          value: '${stats.completedToday}',
                          icon: Icons.wb_sunny_outlined,
                          tint: palette.lavender,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _StatCard(
                          label: 'This week',
                          value: '${stats.completedThisWeek}',
                          icon: Icons.calendar_view_week_outlined,
                          tint: palette.pink,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _StatCard(
                          label: 'All time',
                          value: '${stats.totalCompleted}',
                          icon: Icons.emoji_events_outlined,
                          tint: palette.mint,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  CuteCard(
                    child: Row(
                      children: <Widget>[
                        ProgressRing(
                          fraction: progress.fraction,
                          size: 74,
                          strokeWidth: 8,
                          center: Text('${progress.percent}%',
                              style: theme.textTheme.titleSmall
                                  ?.copyWith(fontWeight: FontWeight.w800)),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Text('Today\u2019s progress',
                                  style: theme.textTheme.titleLarge),
                              const SizedBox(height: 4),
                              Text(
                                progress.total == 0
                                    ? 'No tasks due today yet.'
                                    : '${progress.completed} of ${progress.total} done. ${progress.message}',
                                style: theme.textTheme.bodySmall,
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  CuteCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        SectionHeader(title: 'This week'),
                        const SizedBox(height: 8),
                        WeeklyBarChart(points: stats.week),
                        const SizedBox(height: 10),
                        _TrendRow(stats: stats),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  CuteCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        SectionHeader(title: 'By category'),
                        const SizedBox(height: 12),
                        CategoryBreakdownBars(
                          breakdown: stats.categoryBreakdown,
                          total: stats.totalCompleted,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.label,
    required this.value,
    required this.icon,
    required this.tint,
  });

  final String label;
  final String value;
  final IconData icon;
  final Color tint;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    return CuteCard(
      color: isDark ? tint.withValues(alpha: 0.18) : tint.withValues(alpha: 0.4),
      border: Colors.transparent,
      padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 10),
      child: Column(
        children: <Widget>[
          Icon(icon, size: 20, color: theme.colorScheme.primary),
          const SizedBox(height: 6),
          Text(value,
              style: theme.textTheme.headlineSmall
                  ?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 2),
          Text(label,
              textAlign: TextAlign.center,
              style: theme.textTheme.labelSmall),
        ],
      ),
    );
  }
}

class _TrendRow extends StatelessWidget {
  const _TrendRow({required this.stats});

  final TaskStatistics stats;

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    final icon = stats.weekDelta > 0
        ? Icons.trending_up_rounded
        : stats.weekDelta < 0
            ? Icons.trending_down_rounded
            : Icons.trending_flat_rounded;
    final color = stats.weekDelta > 0
        ? palette.success
        : stats.weekDelta < 0
            ? palette.warning
            : palette.textSecondary;
    return Row(
      children: <Widget>[
        Icon(icon, size: 18, color: color),
        const SizedBox(width: 8),
        Expanded(
          child: Text(stats.trendLabel,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: palette.textSecondary)),
        ),
      ],
    );
  }
}
