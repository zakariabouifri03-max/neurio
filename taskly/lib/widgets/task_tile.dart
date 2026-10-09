import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../../core/utils/date_helper.dart';
import '../../core/widgets/progress_ring.dart';
import '../../models/category.dart';
import '../../models/priority.dart';
import '../../models/task.dart';

/// A task row used on Home, My Tasks and Calendar.
///
/// Completion plays a tiny sparkle; reopening is instant. The whole row is
/// tappable (opens details) and the checkbox area is its own 48dp target.
class TaskTile extends StatelessWidget {
  const TaskTile({
    super.key,
    required this.task,
    required this.now,
    required this.onToggle,
    required this.onOpen,
    this.dateFormat = AppDateFormat.mdy,
    this.showDate = false,
  });

  final Task task;
  final DateTime now;
  final ValueChanged<Task> onToggle;
  final VoidCallback onOpen;
  final AppDateFormat dateFormat;
  final bool showDate;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final overdue = task.isOverdue(now);

    final dueLabel = task.dueMinutes != null
        ? DateHelper.formatMinutes(task.dueMinutes)
        : (showDate
              ? DateHelper.friendlyDate(task.dueDate, now, dateFormat)
              : 'Anytime');

    return Semantics(
      label:
          '${task.title}. ${task.isCompleted ? 'Completed' : 'Not completed'}'
          '${overdue ? '. Overdue' : ''}. ${task.priority.label} priority.'
          ' ${task.category.label}. Due $dueLabel.',
      button: true,
      child: Card(
        margin: const EdgeInsets.symmetric(vertical: 5),
        child: InkWell(
          borderRadius: BorderRadius.circular(AppTheme.radiusM),
          onTap: onOpen,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(6, 8, 14, 8),
            child: Row(
              children: [
                SparkleBurst(
                  trigger: task.isCompleted,
                  child: SizedBox(
                    width: 48,
                    height: 48,
                    child: Center(
                      child: _CuteCheckbox(
                        value: task.isCompleted,
                        onChanged: (_) => onToggle(task),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 4),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        task.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.titleMedium?.copyWith(
                          decoration: task.isCompleted
                              ? TextDecoration.lineThrough
                              : null,
                          color: task.isCompleted
                              ? scheme.onSurfaceVariant
                              : scheme.onSurface,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Wrap(
                        spacing: 8,
                        runSpacing: 4,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          _IconChip(
                            icon: Icons.access_time_rounded,
                            label: overdue ? 'Overdue · $dueLabel' : dueLabel,
                            color: overdue
                                ? scheme.error
                                : scheme.onSurfaceVariant,
                            bold: overdue,
                          ),
                          _CategoryDot(category: task.category),
                          _PriorityTag(priority: task.priority),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Icon(
                  Icons.chevron_right_rounded,
                  color: scheme.onSurfaceVariant.withValues(alpha: 0.6),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _CuteCheckbox extends StatelessWidget {
  const _CuteCheckbox({required this.value, required this.onChanged});

  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      checked: value,
      label: value ? 'Mark as not done' : 'Mark as done',
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => onChanged(!value),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOutBack,
          width: 27,
          height: 27,
          decoration: BoxDecoration(
            color: value ? scheme.primary : Colors.transparent,
            borderRadius: BorderRadius.circular(9),
            border: Border.all(
              width: 2,
              color: value ? scheme.primary : scheme.outline,
            ),
          ),
          child: value
              ? const Icon(Icons.check_rounded, size: 18, color: Colors.white)
              : const SizedBox.shrink(),
        ),
      ),
    );
  }
}

class _IconChip extends StatelessWidget {
  const _IconChip({
    required this.icon,
    required this.label,
    required this.color,
    this.bold = false,
  });

  final IconData icon;
  final String label;
  final Color color;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14.5, color: color),
        const SizedBox(width: 3),
        Text(
          label,
          style: theme.textTheme.labelSmall?.copyWith(
            color: color,
            fontWeight: bold ? FontWeight.w800 : null,
          ),
        ),
      ],
    );
  }
}

class _CategoryDot extends StatelessWidget {
  const _CategoryDot({required this.category});

  final TaskCategory category;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final fill = dark
        ? category.pastel.withValues(alpha: 0.28)
        : category.pastel;
    final fg = dark ? Colors.white.withValues(alpha: 0.9) : category.deep;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2.5),
      decoration: BoxDecoration(
        color: fill,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(category.icon, size: 11.5, color: fg),
          const SizedBox(width: 3),
          Text(
            category.label,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(color: fg),
          ),
        ],
      ),
    );
  }
}

class _PriorityTag extends StatelessWidget {
  const _PriorityTag({required this.priority});

  final TaskPriority priority;

  @override
  Widget build(BuildContext context) {
    if (priority == TaskPriority.medium) return const SizedBox.shrink();
    final color = switch (priority) {
      TaskPriority.low => AppColors.mintDeep,
      TaskPriority.high => Theme.of(context).colorScheme.error,
      TaskPriority.medium => AppColors.yellowDeep,
    };
    final icon = switch (priority) {
      TaskPriority.low => Icons.arrow_downward_rounded,
      TaskPriority.high => Icons.priority_high_rounded,
      TaskPriority.medium => Icons.remove_rounded,
    };
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 13, color: color),
        const SizedBox(width: 2),
        Text(
          priority.label,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(color: color),
        ),
      ],
    );
  }
}
