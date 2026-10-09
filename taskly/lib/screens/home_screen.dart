import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../core/theme/app_theme.dart';
import '../data/models/task.dart';
import '../domain/daily_progress.dart';
import '../state/settings_store.dart';
import '../state/tasks_store.dart';
import '../widgets/cute_card.dart';
import '../widgets/empty_state.dart';
import '../widgets/illustrations.dart';
import '../widgets/progress_ring.dart';
import '../widgets/search_and_filters.dart';
import '../widgets/sparkle_burst.dart';
import '../widgets/task_tile.dart';
import 'stats_screen.dart';
import 'task_details_screen.dart';
import 'task_editor_screen.dart';

/// The heart of Taskly: greeting, real daily progress, today's tasks and
/// quick actions.
class HomeScreen extends StatelessWidget {
  const HomeScreen({
    super.key,
    required this.onOpenTasks,
    required this.onOpenCalendar,
  });

  final VoidCallback onOpenTasks;
  final VoidCallback onOpenCalendar;

  String _greeting(DateTime now) {
    final hour = now.hour;
    if (hour < 5) return 'Burning the midnight oil';
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    final settings = context.watch<SettingsStore>();
    final store = context.watch<TasksStore>();
    final now = DateTime.now();
    final progress = store.todayProgress();
    final todayTasks = store.dueToday();

    return Scaffold(
      backgroundColor: palette.cream,
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: store.load,
          child: store.isLoading && !store.hasTasks
              ? const Center(child: CircularProgressIndicator())
              : ListView(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 96),
                  children: <Widget>[
                    _Header(
                      greeting: _greeting(now),
                      name: settings.greetingName,
                      dateLabel: DateFormat('EEEE, MMMM d').format(now),
                    ),
                    const SizedBox(height: 18),
                    _ProgressCard(progress: progress),
                    const SizedBox(height: 16),
                    _QuickActions(
                      onAdd: () => _openEditor(context),
                      onToday: onOpenTasks,
                      onCalendar: onOpenCalendar,
                      onStats: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                            builder: (_) => const StatsScreen()),
                      ),
                    ),
                    const SizedBox(height: 22),
                    SectionHeader(
                      title: 'Today',
                      actionLabel: store.hasTasks ? 'View all' : null,
                      onAction: onOpenTasks,
                    ),
                    const SizedBox(height: 10),
                    _TodayList(
                      tasks: todayTasks,
                      hasAnyTasks: store.hasTasks,
                      onAddFirst: () => _openEditor(context),
                      onSeeAll: onOpenTasks,
                    ),
                  ],
                ),
        ),
      ),
    );
  }

  Future<void> _openEditor(BuildContext context, {Task? task}) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => TaskEditorScreen(task: task)),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({
    required this.greeting,
    required this.name,
    required this.dateLabel,
  });

  final String greeting;
  final String name;
  final String dateLabel;

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    final text = name.isEmpty ? 'Hey, superstar! ✨' : 'Hey, $name! ✨';
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text('$greeting,',
                  style: Theme.of(context)
                      .textTheme
                      .bodyMedium
                      ?.copyWith(color: palette.textSecondary)),
              const SizedBox(height: 2),
              Text(text, style: Theme.of(context).textTheme.headlineMedium),
              const SizedBox(height: 4),
              Text(dateLabel,
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: palette.textSecondary)),
            ],
          ),
        ),
      ],
    );
  }
}

class _ProgressCard extends StatelessWidget {
  const _ProgressCard({required this.progress});

  final DailyProgress progress;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = AppTheme.paletteOf(context);

    return CuteCard(
      color: palette.lavender.withValues(alpha: 0.22),
      border: Colors.transparent,
      padding: const EdgeInsets.all(20),
      child: Row(
        children: <Widget>[
          Stack(
            alignment: Alignment.center,
            children: <Widget>[
              ProgressRing(
                fraction: progress.fraction,
                size: 86,
                strokeWidth: 9,
                center: Text(
                  '${progress.percent}%',
                  style: theme.textTheme.titleMedium
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
              if (progress.isAllDone) const SparkleBurst(size: 96),
            ],
          ),
          const SizedBox(width: 18),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  progress.isAllDone
                      ? 'All done for today! 🎉'
                      : '${progress.completed} of ${progress.total} tasks done today',
                  style: theme.textTheme.titleLarge,
                ),
                const SizedBox(height: 6),
                Text(
                  progress.message,
                  style: theme.textTheme.bodyMedium
                      ?.copyWith(color: palette.textSecondary),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _QuickActions extends StatelessWidget {
  const _QuickActions({
    required this.onAdd,
    required this.onToday,
    required this.onCalendar,
    required this.onStats,
  });

  final VoidCallback onAdd;
  final VoidCallback onToday;
  final VoidCallback onCalendar;
  final VoidCallback onStats;

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    return Row(
      children: <Widget>[
        _ActionTile(
          icon: Icons.add_rounded,
          label: 'Add task',
          color: palette.lavender,
          onTap: onAdd,
        ),
        _ActionTile(
          icon: Icons.today_outlined,
          label: 'Today',
          color: palette.pink,
          onTap: onToday,
        ),
        _ActionTile(
          icon: Icons.calendar_month_outlined,
          label: 'Calendar',
          color: palette.babyBlue,
          onTap: onCalendar,
        ),
        _ActionTile(
          icon: Icons.insights_outlined,
          label: 'Progress',
          color: palette.mint,
          onTap: onStats,
        ),
      ],
    );
  }
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final background = isDark ? color.withValues(alpha: 0.2) : color;
    final ink = isDark
        ? AppTheme.paletteOf(context).textPrimary
        : const Color(0xFF4A4460);
    return Expanded(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(18),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 14),
            decoration: BoxDecoration(
              color: background,
              borderRadius: BorderRadius.circular(18),
            ),
            child: Column(
              children: <Widget>[
                Icon(icon, size: 22, color: ink),
                const SizedBox(height: 6),
                Text(label,
                    style: Theme.of(context)
                        .textTheme
                        .labelSmall
                        ?.copyWith(color: ink, fontWeight: FontWeight.w800)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _TodayList extends StatelessWidget {
  const _TodayList({
    required this.tasks,
    required this.hasAnyTasks,
    required this.onAddFirst,
    required this.onSeeAll,
  });

  final List<Task> tasks;
  final bool hasAnyTasks;
  final VoidCallback onAddFirst;
  final VoidCallback onSeeAll;

  @override
  Widget build(BuildContext context) {
    final store = context.read<TasksStore>();
    final now = DateTime.now();
    if (tasks.isEmpty && !hasAnyTasks) {
      return EmptyState(
        illustration: Illustrations.blankCanvas(),
        title: 'Your day is a blank canvas',
        message: 'Let\u2019s plan something wonderful!',
        actionLabel: 'Add your first task',
        actionIcon: Icons.add_rounded,
        onAction: onAddFirst,
      );
    }
    if (tasks.isEmpty) {
      return EmptyState(
        illustration: Illustrations.planner(size: 130),
        title: 'Nothing due today',
        message: 'Enjoy the breathing room, or peek at what\u2019s ahead.',
        actionLabel: 'See all tasks',
        onAction: onSeeAll,
      );
    }
    final sorted = <Task>[...tasks]
      ..sort((a, b) => a.referenceDateTime.compareTo(b.referenceDateTime));
    return Column(
      children: <Widget>[
        for (final task in sorted)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: TaskTile(
              task: task,
              now: now,
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                    builder: (_) => TaskDetailsScreen(taskId: task.id!)),
              ),
              onToggle: (value) => store.setCompleted(task, value),
            ),
          ),
      ],
    );
  }
}
