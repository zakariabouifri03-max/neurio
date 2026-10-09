import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/theme/app_theme.dart';
import '../core/utils/date_utils.dart';
import '../data/models/task.dart';
import '../state/settings_store.dart';
import '../state/tasks_store.dart';
import '../widgets/confirm_dialog.dart';
import '../widgets/cute_button.dart';
import '../widgets/cute_card.dart';
import '../widgets/cute_checkbox.dart';
import '../widgets/task_chips.dart';
import 'task_editor_screen.dart';

/// Full view of one task with complete / edit / delete actions.
class TaskDetailsScreen extends StatelessWidget {
  const TaskDetailsScreen({super.key, required this.taskId});

  final int taskId;

  Future<void> _delete(BuildContext context, Task task) async {
    final confirmed = await showCuteConfirm(
      context,
      title: 'Delete this task?',
      message: '“${task.title}” will be removed for good.',
      confirmLabel: 'Delete',
      destructive: true,
      icon: Icons.delete_outline_rounded,
    );
    if (!confirmed || !context.mounted) return;
    final ok = await context.read<TasksStore>().deleteTask(task);
    if (ok && context.mounted) {
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    final theme = Theme.of(context);
    final store = context.watch<TasksStore>();
    final settings = context.watch<SettingsStore>();
    final task = store.byId(taskId);
    final now = DateTime.now();

    if (task == null) {
      return Scaffold(
        backgroundColor: palette.cream,
        appBar: AppBar(title: const Text('Task')),
        body: Center(
          child: Text('This task no longer exists.',
              style: theme.textTheme.bodyMedium
                  ?.copyWith(color: palette.textSecondary)),
        ),
      );
    }

    final reminderAt = task.reminderAt;

    return Scaffold(
      backgroundColor: palette.cream,
      appBar: AppBar(
        title: const Text('Task details'),
        actions: <Widget>[
          IconButton(
            tooltip: 'Edit task',
            icon: const Icon(Icons.edit_outlined),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                  builder: (_) => TaskEditorScreen(task: task)),
            ),
          ),
          IconButton(
            tooltip: 'Delete task',
            icon: const Icon(Icons.delete_outline_rounded),
            onPressed: () => _delete(context, task),
          ),
          const SizedBox(width: 6),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
          children: <Widget>[
            CuteCard(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  CuteCheckbox(
                    value: task.isCompleted,
                    onChanged: (v) => store.setCompleted(task, v),
                    semanticsLabel: 'Complete task: ${task.title}',
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          task.title,
                          style: theme.textTheme.headlineSmall?.copyWith(
                            decoration: task.isCompleted
                                ? TextDecoration.lineThrough
                                : TextDecoration.none,
                          ),
                        ),
                        if (task.description != null &&
                            task.description!.isNotEmpty) ...<Widget>[
                          const SizedBox(height: 10),
                          Text(task.description!,
                              style: theme.textTheme.bodyMedium?.copyWith(
                                  color: palette.textSecondary)),
                        ],
                        const SizedBox(height: 14),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: <Widget>[
                            CategoryChip(category: task.category),
                            PriorityBadge(priority: task.priority),
                            if (task.isCompleted)
                              InfoChip(
                                  icon: Icons.check_circle_outline_rounded,
                                  label: 'Completed',
                                  color: palette.success),
                            if (task.isOverdue(now))
                              InfoChip(
                                  icon: Icons.error_outline_rounded,
                                  label: 'Overdue',
                                  color: palette.danger),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            CuteCard(
              padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 8),
              child: Column(
                children: <Widget>[
                  _DetailRow(
                    icon: Icons.event_rounded,
                    label: 'Due date',
                    value:
                        '${settings.dateFormat.formatWithWeekday(task.dueDate)}'
                        ' · ${TasklyDates.relativeDayLabel(task.dueDate, now)}',
                  ),
                  _DetailRow(
                    icon: Icons.schedule_rounded,
                    label: 'Due time',
                    value: task.dueTime == null
                        ? 'All day'
                        : TasklyDates.formatTime(task.dueTime!),
                  ),
                  _DetailRow(
                    icon: Icons.notifications_outlined,
                    label: 'Reminder',
                    value: !task.reminderEnabled
                        ? 'Off'
                        : reminderAt == null
                            ? 'On'
                            : '${settings.dateFormat.format(reminderAt)} at '
                                '${TasklyDates.formatTime(TasklyDates.encodeTime(reminderAt.hour, reminderAt.minute))}',
                  ),
                  _DetailRow(
                    icon: Icons.history_rounded,
                    label: 'Created',
                    value: settings.dateFormat.format(task.createdAt),
                    last: true,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 22),
            CuteButton(
              label: task.isCompleted ? 'Mark as not done' : 'Mark as done',
              icon: task.isCompleted
                  ? Icons.undo_rounded
                  : Icons.check_rounded,
              secondary: task.isCompleted,
              onPressed: () => store.setCompleted(task, !task.isCompleted),
            ),
          ],
        ),
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({
    required this.icon,
    required this.label,
    required this.value,
    this.last = false,
  });

  final IconData icon;
  final String label;
  final String value;
  final bool last;

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    final theme = Theme.of(context);
    return Column(
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
          child: Row(
            children: <Widget>[
              Icon(icon, size: 19, color: theme.colorScheme.primary),
              const SizedBox(width: 12),
              SizedBox(
                width: 84,
                child: Text(label,
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: palette.textSecondary)),
              ),
              Expanded(
                child: Text(value, style: theme.textTheme.titleSmall),
              ),
            ],
          ),
        ),
        if (!last) Divider(height: 1, color: palette.border),
      ],
    );
  }
}
