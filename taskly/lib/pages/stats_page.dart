import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../controllers/settings_controller.dart';
import '../controllers/task_controller.dart';
import '../core/theme/app_colors.dart';
import '../core/theme/app_theme.dart';
import '../core/utils/date_helper.dart';
import '../core/widgets/common.dart';
import '../core/widgets/progress_ring.dart';
import '../logic/stats_calculator.dart';
import '../models/category.dart';

/// Statistics & productivity insights — computed from real data only.
/// Empty states are gentle; no fake trends or invented numbers.
class StatsPage extends StatelessWidget {
  const StatsPage({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final settings = context.watch<SettingsController>();
    final controller = context.watch<TaskController>();
    final now = DateTime.now();

    if (!controller.loaded) {
      return Scaffold(
        appBar: AppBar(),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    final tasks = controller.tasks;
    final completedTotal = StatsCalculator.totalCompleted(tasks);
    final todayProgress = StatsCalculator.dailyProgress(tasks, now);
    final completedToday = StatsCalculator.completedOn(tasks, now);
    final week = StatsCalculator.weeklyCompleted(
      tasks,
      now,
      settings.weekStart,
    );
    final trend = StatsCalculator.weeklyTrend(tasks, now, settings.weekStart);
    final byCategory = StatsCalculator.completedByCategory(tasks);

    return Scaffold(
      appBar: AppBar(title: const Text('Your progress')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 32),
          children: [
            if (tasks.isEmpty) ...[
              const SizedBox(height: 12),
              EmptyState(
                icon: Icons.insights_rounded,
                title: 'No stats yet',
                message:
                    'Complete your first task and your progress will bloom here.',
                blobColor: AppColors.sunnyYellow,
              ),
            ] else ...[
              Row(
                children: [
                  Expanded(
                    child: _StatCard(
                      icon: Icons.check_circle_outline_rounded,
                      label: 'Completed today',
                      value: '$completedToday',
                      color: AppColors.mintGreen,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _StatCard(
                      icon: Icons.local_fire_department_outlined,
                      label: 'This week',
                      value: '${week.reduce((a, b) => a + b)}',
                      color: AppColors.pastelPink,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: _StatCard(
                      icon: Icons.emoji_events_outlined,
                      label: 'All-time wins',
                      value: '$completedTotal',
                      color: AppColors.sunnyYellow,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _StatCard(
                      icon: Icons.today_rounded,
                      label: "Today's ring",
                      value: '${todayProgress.percent}%',
                      color: AppColors.lavender,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              _SectionCard(
                title: 'This week',
                child: WeeklyBars(
                  values: week,
                  labels: StatsCalculator.weeklyLabels(settings.weekStart),
                ),
              ),
              const SizedBox(height: 12),
              _SectionCard(
                title: 'Daily progress',
                child: Row(
                  children: [
                    ProgressRing(
                      progress: todayProgress.ratio,
                      size: 84,
                      progressColor: AppColors.mintDeep,
                      center: Text(
                        '${todayProgress.percent}%',
                        style: theme.textTheme.titleMedium,
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Text(
                        todayProgress.total == 0
                            ? 'Nothing was due today. Rest is progress too.'
                            : '${todayProgress.completed} of '
                                  '${todayProgress.total} tasks done today.',
                        style: theme.textTheme.bodyMedium,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              _SectionCard(
                title: 'Trend',
                child: Row(
                  children: [
                    Icon(
                      trend.difference > 0
                          ? Icons.trending_up_rounded
                          : trend.difference < 0
                          ? Icons.trending_down_rounded
                          : Icons.trending_flat_rounded,
                      color: trend.difference > 0
                          ? AppColors.mintDeep
                          : trend.difference < 0
                          ? theme.colorScheme.error
                          : theme.colorScheme.onSurfaceVariant,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        trend.difference == 0
                            ? 'Same as last week (${trend.thisWeek} tasks) '
                                  '— steady is lovely.'
                            : trend.difference > 0
                            ? '${trend.difference} more task${trend.difference == 1 ? '' : 's'} '
                                  'than last week (${trend.lastWeek}). Lovely climb!'
                            : '${-trend.difference} fewer than last '
                                  'week (${trend.lastWeek}). Be kind to yourself.',
                        style: theme.textTheme.bodyMedium,
                      ),
                    ),
                  ],
                ),
              ),
              if (byCategory.isNotEmpty) ...[
                const SizedBox(height: 12),
                _SectionCard(
                  title: 'Where your wins come from',
                  child: CategoryBreakdown(counts: byCategory),
                ),
              ],
            ],
          ],
        ),
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
  });

  final IconData icon;
  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dark = theme.brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: dark ? color.withValues(alpha: 0.14) : color,
        borderRadius: BorderRadius.circular(AppTheme.radiusM),
      ),
      child: Row(
        children: [
          Icon(icon, size: 22, color: theme.colorScheme.onSurface),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(value, style: theme.textTheme.headlineSmall),
                Text(
                  label,
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: theme.colorScheme.onSurface,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: theme.textTheme.titleMedium),
            const SizedBox(height: 14),
            child,
          ],
        ),
      ),
    );
  }
}

/// Simple pastel bar chart, no chart library needed.
class WeeklyBars extends StatelessWidget {
  const WeeklyBars({super.key, required this.values, required this.labels});

  final List<int> values;
  final List<String> labels;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final max = values.fold<int>(1, (m, v) => v > m ? v : m);
    return SizedBox(
      height: 140,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var i = 0; i < values.length; i++)
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  Text('${values[i]}', style: theme.textTheme.labelSmall),
                  const SizedBox(height: 4),
                  Expanded(
                    child: Align(
                      alignment: Alignment.bottomCenter,
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 450),
                        curve: Curves.easeOutCubic,
                        width: 18,
                        height: ((values[i] / max) * 86).clamp(4.0, 86.0),
                        decoration: BoxDecoration(
                          color: values[i] == 0
                              ? theme.colorScheme.outline
                              : i >= 5
                              ? AppColors.pastelPink
                              : AppColors.lavender,
                          borderRadius: BorderRadius.circular(8),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(labels[i], style: theme.textTheme.labelSmall),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// Completed-per-category horizontal bars with labels (never color-only).
class CategoryBreakdown extends StatelessWidget {
  const CategoryBreakdown({super.key, required this.counts});

  final Map<TaskCategory, int> counts;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final entries = counts.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    final max = entries.first.value;

    return Column(
      children: [
        for (final entry in entries)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Row(
              children: [
                Icon(entry.key.icon, size: 17, color: entry.key.deep),
                const SizedBox(width: 8),
                SizedBox(
                  width: 74,
                  child: Text(
                    entry.key.label,
                    style: theme.textTheme.labelMedium,
                  ),
                ),
                Expanded(
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Container(
                      height: 12,
                      width: (entry.value / max) * 170,
                      decoration: BoxDecoration(
                        color: entry.key.pastel,
                        borderRadius: BorderRadius.circular(6),
                      ),
                    ),
                  ),
                ),
                Text('${entry.value}', style: theme.textTheme.labelMedium),
              ],
            ),
          ),
      ],
    );
  }
}
