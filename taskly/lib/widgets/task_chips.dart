import 'package:flutter/material.dart';

import '../core/theme/app_theme.dart';
import '../data/models/task_category.dart';
import '../data/models/task_priority.dart';

/// Small pastel pill showing a task category.
class CategoryChip extends StatelessWidget {
  const CategoryChip({super.key, required this.category, this.compact = false});

  final TaskCategory category;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final background = isDark
        ? category.background.withValues(alpha: 0.22)
        : category.background;
    return Container(
      padding: EdgeInsets.symmetric(
          horizontal: compact ? 8 : 10, vertical: compact ? 3 : 5),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(AppTheme.radiusPill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(category.icon, size: compact ? 11 : 13, color: category.foreground),
          const SizedBox(width: 5),
          Text(
            category.label,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: isDark
                      ? category.background
                      : category.foreground,
                  fontWeight: FontWeight.w700,
                ),
          ),
        ],
      ),
    );
  }
}

/// Priority indicator: icon + label, never color alone.
class PriorityBadge extends StatelessWidget {
  const PriorityBadge({super.key, required this.priority, this.compact = false});

  final TaskPriority priority;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final background = isDark
        ? priority.background.withValues(alpha: 0.22)
        : priority.background;
    final ink = isDark ? _darkInk(priority) : priority.foreground;
    return Semantics(
      label: 'Priority: ${priority.label}',
      child: Container(
        padding: EdgeInsets.symmetric(
            horizontal: compact ? 7 : 9, vertical: compact ? 3 : 4),
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(AppTheme.radiusPill),
          border: Border.all(color: palette.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(priority.icon, size: compact ? 11 : 13, color: ink),
            const SizedBox(width: 4),
            Text(
              priority.label,
              style: Theme.of(context)
                  .textTheme
                  .labelSmall
                  ?.copyWith(color: ink, fontWeight: FontWeight.w700),
            ),
          ],
        ),
      ),
    );
  }

  Color _darkInk(TaskPriority priority) {
    switch (priority) {
      case TaskPriority.low:
        return const Color(0xFF7EDCB4);
      case TaskPriority.medium:
        return const Color(0xFFEFC078);
      case TaskPriority.high:
        return const Color(0xFFF08D9D);
    }
  }
}

/// Neutral info chip (time, date, counts).
class InfoChip extends StatelessWidget {
  const InfoChip({super.key, required this.icon, required this.label, this.color});

  final IconData icon;
  final String label;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    final ink = color ?? palette.textSecondary;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(icon, size: 13, color: ink),
        const SizedBox(width: 4),
        Flexible(
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context)
                .textTheme
                .labelSmall
                ?.copyWith(color: ink, fontWeight: FontWeight.w600),
          ),
        ),
      ],
    );
  }
}
