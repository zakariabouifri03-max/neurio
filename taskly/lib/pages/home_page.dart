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
import '../models/task.dart';
import '../app/routes.dart';
import 'shell.dart';
import 'stats_page.dart';
import 'task_editor_page.dart';

/// The cozy command center: greeting, honest daily progress, today's tasks
/// and quick actions. Every number comes from real saved tasks.
class HomePage extends StatelessWidget {
  const HomePage({super.key});

  Future<void> _openPage(BuildContext context, Widget page) =>
      Navigator.of(context).push(fadeSlideRoute<void>(builder: (_) => page));

  Future<void> _openEditor(
    BuildContext context, {
    Task? task,
    DateTime? presetDate,
  }) =>
      _openPage(
        context,
        TaskEditorPage(task: task, presetDate: presetDate),
      );

  Future<void> _toggle(BuildContext context, Task task) =>
      context.read<TaskController>().toggleComplete(task);

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final settings = context.watch<SettingsController>();
    final controller = context.watch<TaskController>();
    final now = DateTime.now();

    if (controller.error != null) {
      return Scaffold(
        body: SafeArea(
          child: EmptyState(
            icon: Icons.cloud_off_rounded,
            title: 'Something went wrong',
            message: controller.error!,
            actionLabel: 'Try again',
            onAction: controller.retryLoad,
          ),
        ),
      );
    }
    if (!controller.loaded) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    final progress = controller.dailyProgress();
    final upNext = controller.todayUpNext();
    final motivational = controller.motivationalLine();
    final allDone = controller.allTodayDone;

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          color: AppColors.lavenderDeep,
          onRefresh: controller.load,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
            children: [
              _Greeting(settings: settings, now: now),
              const SizedBox(height: 18),
              _ProgressCard(progress: progress, motivational: motivational),
              const SizedBox(height: 12),
              _QuickActions(
                onAdd: () => _openEditor(context),
                onToday: () => ShellTabScope.of(context)?.goTo(1),
                onCalendar: () => ShellTabScope.of(context)?.goTo(2),
                onStats: () => _openPage(context, const StatsPage()),
              ),
              if (allDone && progress.completed > 0) const _AllDoneCard(),
              SectionHeader(
                title: "Today's tasks",
                trailingLabel: 'View all',
                onTrailing: () => ShellTabScope.of(context)?.goTo(1),
              ),
              if (upNext.isEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: EmptyState(
                    icon: Icons.wb_sunny_outlined,
                    title: allDone ? 'You finished it all!' : 'Nothing due today',
                    message: allDone
                        ? 'Everything on today\'s list is checked off. Lovely.'
                        : 'Your day is a blank canvas. Let\'s plan something wonderful!',
                    blobColor: AppColors.mintGreen,
                    actionLabel: allDone ? null : 'Add a task',
                    onAction: allDone ? null : () => _openEditor(context),
                  ),
                )
              else
                ...upNext.take(4).map(
                      (task) => TaskTile(
                        task: task,
                        now: now,
                        dateFormat: settings.dateFormat,
                        onToggle: (t) => _toggle(context, t),
                        onOpen: () => _openEditor(context, task: task),
                      ),
                    ),
              if (upNext.length > 4)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Center(
                    child: TextButton(
                      onPressed: () => ShellTabScope.of(context)?.goTo(1),
                      child: Text('+${upNext.length - 4} more for today'),
                    ),
                  ),
                ),
              SizedBox(height: theme.padding.bottom + 8),
            ],
          ),
        ),
      ),
    );
  }
}

class _Greeting extends StatelessWidget {
  const _Greeting({required this.settings, required this.now});

  final SettingsController settings;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final name = settings.preferredName;
    final greeting = SettingsController.greetingFor(now);
    final headline = name.isEmpty ? 'Hey, superstar! ✨' : '$greeting, $name! ✨';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(headline, style: theme.textTheme.headlineMedium),
        const SizedBox(height: 4),
        Text(
          DateHelper.formatDate(now, settings.dateFormat),
          style: theme.textTheme.bodySmall,
        ),
      ],
    );
  }
}

class _ProgressCard extends StatelessWidget {
  const _ProgressCard({required this.progress, required this.motivational});

  final DailyProgress progress;
  final String motivational;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dark = theme.brightness == Brightness.dark;
    final cardColor = dark ? AppColors.nightSurface : AppColors.white;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: cardColor,
        borderRadius: BorderRadius.circular(AppTheme.radiusL),
        border: Border.all(color: theme.colorScheme.outline),
        boxShadow: [
          BoxShadow(
            color: AppColors.primaryText.withValues(alpha: dark ? 0.3 : 0.05),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        children: [
          ProgressRing(
            progress: progress.ratio,
            size: 92,
            strokeWidth: 10,
            trackColor: theme.colorScheme.outline,
            progressColor: AppColors.lavenderDeep,
            center: Text('${progress.percent}%', style: theme.textTheme.titleLarge),
          ),
          const SizedBox(width: 18),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${progress.completed} of ${progress.total} done today',
                  style: theme.textTheme.titleMedium,
                ),
                const SizedBox(height: 6),
                Text(
                  motivational,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 10),
                TextButton.icon(
                  onPressed: () => _openStats(context),
                  icon: const Icon(Icons.insights_rounded, size: 17),
                  label: const Text('Weekly progress'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _openStats(BuildContext context) => Navigator.of(context).push(
        fadeSlideRoute<void>(builder: (_) => const StatsPage()),
      );
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
    return Row(
      children: [
        Expanded(
          child: _QuickAction(
            icon: Icons.add_rounded,
            label: 'Add task',
            color: AppColors.lavender,
            onTap: onAdd,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _QuickAction(
            icon: Icons.checklist_rounded,
            label: "Today's tasks",
            color: AppColors.pastelPink,
            onTap: onToday,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _QuickAction(
            icon: Icons.calendar_month_rounded,
            label: 'Calendar',
            color: AppColors.babyBlue,
            onTap: onCalendar,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _QuickAction(
            icon: Icons.insights_rounded,
            label: 'Progress',
            color: AppColors.mintGreen,
            onTap: onStats,
          ),
        ),
      ],
    );
  }
}

class _QuickAction extends StatelessWidget {
  const _QuickAction({
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
    final theme = Theme.of(context);
    final dark = theme.brightness == Brightness.dark;
    return Pressable(
      onTap: onTap,
      semanticLabel: label,
      child: Container(
        height: 92,
        padding: const EdgeInsets.symmetric(horizontal: 6),
        decoration: BoxDecoration(
          color: dark ? color.withValues(alpha: 0.16) : color,
          borderRadius: BorderRadius.circular(AppTheme.radiusM),
          border: Border.all(
            color: dark ? color.withValues(alpha: 0.35) : Colors.transparent,
          ),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 26, color: theme.colorScheme.onSurface),
            const SizedBox(height: 7),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 2),
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.onSurface,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AllDoneCard extends StatefulWidget {
  const _AllDoneCard();

  @override
  State<_AllDoneCard> createState() => _AllDoneCardState();
}

class _AllDoneCardState extends State<_AllDoneCard>
    with SingleTickerProviderStateMixin {
  late final AnimationController _sparkle = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  );

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && !MediaQuery.disableAnimationsOf(context)) {
        _sparkle.forward(from: 0);
      }
    });
  }

  @override
  void dispose() {
    _sparkle.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dark = theme.brightness == Brightness.dark;
    return AnimatedBuilder(
      animation: _sparkle,
      builder: (context, child) => Container(
        margin: const EdgeInsets.only(top: 10),
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
        decoration: BoxDecoration(
          color: dark
              ? AppColors.mintGreen.withValues(alpha: 0.14)
              : AppColors.mintGreen,
          borderRadius: BorderRadius.circular(AppTheme.radiusM),
        ),
        child: Row(
          children: [
            SizedBox(
              width: 34,
              height: 34,
              child: CustomPaint(
                painter: SparklePainter(progress: _sparkle.value),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                'All done for today — you earned some cozy time!',
                style: theme.textTheme.titleMedium,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
