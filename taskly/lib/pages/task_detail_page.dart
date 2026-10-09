import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../controllers/settings_controller.dart';
import '../controllers/task_controller.dart';
import '../core/theme/app_colors.dart';
import '../core/utils/date_helper.dart';
import '../core/widgets/common.dart';
import '../core/widgets/progress_ring.dart';
import '../models/priority.dart';
import '../models/task.dart';
import '../app/routes.dart';
import 'task_editor_page.dart';

/// Read-only task details with complete/edit/delete actions.
class TaskDetailPage extends StatelessWidget {
  const TaskDetailPage({super.key, required this.taskId});

  final int taskId;

  Future<void> _toggle(BuildContext context, Task task) =>
      context.read<TaskController>().toggleComplete(task);

  Future<void> _delete(BuildContext context, Task task) async {
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final controller = context.read<TaskController>();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete this task?'),
        content: Text(
          '"${task.title}" will be removed. This can\'t be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep it'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
            ),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    final ok = await controller.deleteTask(task);
    if (ok) {
      if (navigator.canPop()) navigator.pop();
      messenger.showSnackBar(const SnackBar(content: Text('Task deleted')));
    } else {
      messenger.showSnackBar(
        const SnackBar(content: Text('That task was already removed.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final settings = context.watch<SettingsController>();
    final controller = context.watch<TaskController>();
    final task = controller.byId(taskId);

    if (task == null) {
      return Scaffold(
        appBar: AppBar(),
        body: const EmptyState(
          icon: Icons.search_off_rounded,
          title: 'Task not found',
          message: 'It may have been deleted.',
        ),
      );
    }

    final now = DateTime.now();
    final overdue = task.isOverdue(now);

    return Scaffold(
      appBar: AppBar(
        actions: [
          IconButton(
            tooltip: 'Edit',
            icon: const Icon(Icons.edit_outlined),
            onPressed: () => Navigator.of(context).push(
              fadeSlideRoute<void>(builder: (_) => TaskEditorPage(task: task)),
            ),
          ),
          IconButton(
            tooltip: 'Delete',
            icon: Icon(
              Icons.delete_outline_rounded,
              color: theme.colorScheme.error,
            ),
            onPressed: () => _delete(context, task),
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 32),
          children: [
            SparkleBurst(
              trigger: task.isCompleted,
              child: Center(
                child: SizedBox(
                  width: 64,
                  height: 64,
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: task.isCompleted
                          ? AppColors.mintGreen
                          : AppColors.lavender,
                      foregroundColor: AppColors.primaryText,
                      shape: const CircleBorder(),
                      elevation: 0,
                    ),
                    onPressed: () => _toggle(context, task),
                    child: AnimatedSwitcher(
                      duration: const Duration(milliseconds: 200),
                      child: Icon(
                        task.isCompleted
                            ? Icons.check_rounded
                            : Icons.radio_button_unchecked_rounded,
                        key: ValueKey(task.isCompleted),
                        size: 30,
                      ),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Center(
              child: Text(
                task.isCompleted ? 'Completed — nicely done!' : 'Mark complete',
                style: theme.textTheme.labelLarge,
              ),
            ),
            const SizedBox(height: 20),
            Text(
              task.title,
              style: theme.textTheme.headlineSmall?.copyWith(
                decoration: task.isCompleted
                    ? TextDecoration.lineThrough
                    : null,
              ),
            ),
            if (task.description.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(
                task.description,
                style: theme.textTheme.bodyLarge?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
            const SizedBox(height: 22),
            Card(
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 6,
                ),
                child: Column(
                  children: [
                    _DetailRow(
                      icon: Icons.event_outlined,
                      label: 'Due date',
                      value: DateHelper.friendlyDate(
                        task.dueDate,
                        now,
                        settings.dateFormat,
                      ),
                      valueColor: overdue ? theme.colorScheme.error : null,
                      trailing: overdue ? 'Overdue' : null,
                    ),
                    Divider(color: theme.colorScheme.outline),
                    _DetailRow(
                      icon: Icons.schedule_rounded,
                      label: 'Due time',
                      value: DateHelper.formatMinutes(task.dueMinutes),
                    ),
                    Divider(color: theme.colorScheme.outline),
                    _DetailRow(
                      icon: task.category.icon,
                      label: 'Category',
                      value: task.category.label,
                    ),
                    Divider(color: theme.colorScheme.outline),
                    _DetailRow(
                      icon: task.priority == TaskPriority.high
                          ? Icons.priority_high_rounded
                          : task.priority == TaskPriority.medium
                          ? Icons.remove_rounded
                          : Icons.arrow_downward_rounded,
                      label: 'Priority',
                      value: task.priority.label,
                    ),
                    Divider(color: theme.colorScheme.outline),
                    _DetailRow(
                      icon: Icons.alarm_rounded,
                      label: 'Reminder',
                      value: task.reminderEnabled && !task.isCompleted
                          ? 'On · ${DateHelper.formatMinutes(task.dueMinutes)}'
                          : 'Off',
                    ),
                    if (task.isCompleted) ...[
                      Divider(color: theme.colorScheme.outline),
                      _DetailRow(
                        icon: Icons.emoji_events_outlined,
                        label: 'Completed',
                        value: task.completedAt == null
                            ? 'Yes'
                            : DateHelper.formatDate(
                                task.completedAt!,
                                settings.dateFormat,
                              ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            const SizedBox(height: 26),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => Navigator.of(context).push(
                      fadeSlideRoute<void>(
                        builder: (_) => TaskEditorPage(task: task),
                      ),
                    ),
                    icon: const Icon(Icons.edit_outlined),
                    label: const Text('Edit'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton.icon(
                    style: FilledButton.styleFrom(
                      backgroundColor: theme.colorScheme.error,
                    ),
                    onPressed: () => _delete(context, task),
                    icon: const Icon(Icons.delete_outline_rounded),
                    label: const Text('Delete'),
                  ),
                ),
              ],
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
    this.valueColor,
    this.trailing,
  });

  final IconData icon;
  final String label;
  final String value;
  final Color? valueColor;
  final String? trailing;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        children: [
          Icon(icon, size: 20, color: theme.colorScheme.onSurfaceVariant),
          const SizedBox(width: 12),
          Expanded(child: Text(label, style: theme.textTheme.bodyMedium)),
          if (trailing != null)
            Container(
              margin: const EdgeInsets.only(right: 8),
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: theme.colorScheme.error.withValues(alpha: 0.13),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                trailing!,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.error,
                ),
              ),
            ),
          Text(
            value,
            style: theme.textTheme.titleMedium?.copyWith(color: valueColor),
          ),
        ],
      ),
    );
  }
}
