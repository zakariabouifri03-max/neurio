import 'package:flutter/material.dart';

import '../core/theme/app_theme.dart';
import '../core/utils/motion.dart';
import '../core/utils/date_utils.dart';
import '../data/models/task.dart';
import 'cute_card.dart';
import 'cute_checkbox.dart';
import 'task_chips.dart';

/// One task row used in lists across Home, My Tasks and Calendar.
class TaskTile extends StatelessWidget {
  const TaskTile({
    super.key,
    required this.task,
    required this.now,
    required this.onTap,
    required this.onToggle,
    this.onEdit,
    this.onDelete,
    this.dateFormat,
  });

  final Task task;
  final DateTime now;
  final VoidCallback onTap;
  final ValueChanged<bool> onToggle;
  final VoidCallback? onEdit;
  final VoidCallback? onDelete;
  final DateFormatPref? dateFormat;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = AppTheme.paletteOf(context);
    final overdue = task.isOverdue(now);
    final time = task.dueTime;

    return CuteCard(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      color: task.isCompleted
          ? palette.card.withValues(alpha: 0.65)
          : overdue
              ? palette.dangerSoft.withValues(alpha: 0.35)
              : palette.card,
      onTap: onTap,
      child: Row(
        children: <Widget>[
          CuteCheckbox(
            value: task.isCompleted,
            onChanged: onToggle,
            semanticsLabel: 'Complete task: ${task.title}',
          ),
          const SizedBox(width: 4),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                AnimatedDefaultTextStyle(
                  duration: AppMotion.medium,
                  style: (theme.textTheme.titleMedium ?? const TextStyle())
                      .copyWith(
                    decoration: task.isCompleted
                        ? TextDecoration.lineThrough
                        : TextDecoration.none,
                    color: task.isCompleted
                        ? palette.textSecondary
                        : palette.textPrimary,
                  ),
                  child: Text(
                    task.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: <Widget>[
                    if (time != null)
                      InfoChip(
                        icon: Icons.schedule_rounded,
                        label: TasklyDates.formatTime(time),
                        color: overdue ? palette.danger : palette.textSecondary,
                      ),
                    CategoryChip(category: task.category, compact: true),
                    if (task.priority.index >= 1 || !task.isCompleted)
                      PriorityBadge(priority: task.priority, compact: true),
                    if (overdue)
                      InfoChip(
                        icon: Icons.error_outline_rounded,
                        label: 'Overdue',
                        color: palette.danger,
                      ),
                    if (task.reminderEnabled && !task.isCompleted)
                      InfoChip(
                        icon: Icons.notifications_active_outlined,
                        label: 'Reminder',
                        color: palette.textSecondary,
                      ),
                  ],
                ),
              ],
            ),
          ),
          if (onEdit != null || onDelete != null)
            PopupMenuButton<String>(
              icon: Icon(Icons.more_horiz_rounded,
                  color: palette.textSecondary, size: 20),
              tooltip: 'Task options',
              onSelected: (value) {
                if (value == 'edit') onEdit?.call();
                if (value == 'delete') onDelete?.call();
              },
              itemBuilder: (context) => <PopupMenuEntry<String>>[
                const PopupMenuItem<String>(
                    value: 'edit', child: Text('Edit task')),
                const PopupMenuItem<String>(
                    value: 'delete', child: Text('Delete task')),
              ],
            ),
        ],
      ),
    );
  }
}
