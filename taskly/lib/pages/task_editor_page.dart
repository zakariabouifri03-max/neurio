import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../controllers/settings_controller.dart';
import '../controllers/task_controller.dart';
import '../core/theme/app_colors.dart';
import '../core/theme/app_theme.dart';
import '../core/utils/date_helper.dart';
import '../models/category.dart';
import '../models/priority.dart';
import '../models/task.dart';
import '../notifications/notification_service.dart';

/// Create or edit a task. Validates input, prevents double submits, and
/// schedules a genuine local reminder when asked.
class TaskEditorPage extends StatefulWidget {
  const TaskEditorPage({super.key, this.task, this.presetDate});

  /// Non-null → edit mode.
  final Task? task;

  /// Date pre-selected for new tasks (e.g. picked in the calendar).
  final DateTime? presetDate;

  @override
  State<TaskEditorPage> createState() => _TaskEditorPageState();
}

class _TaskEditorPageState extends State<TaskEditorPage> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _title;
  late final TextEditingController _description;

  late DateTime _dueDate;
  int? _dueMinutes;
  late TaskPriority _priority;
  late TaskCategory _category;
  late bool _reminderEnabled;

  bool _saving = false;
  String? _reminderNotice;

  bool get _isEdit => widget.task != null;

  @override
  void initState() {
    super.initState();
    final task = widget.task;
    _title = TextEditingController(text: task?.title ?? '');
    _description = TextEditingController(text: task?.description ?? '');
    _dueDate = DateHelper.startOfDay(
      task?.dueDate ?? widget.presetDate ?? DateTime.now(),
    );
    _dueMinutes = task?.dueMinutes;
    _priority = task?.priority ?? TaskPriority.medium;
    _category = task?.category ?? TaskCategory.personal;
    _reminderEnabled = task?.reminderEnabled ?? false;
  }

  @override
  void dispose() {
    _title.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _dueDate,
      firstDate: DateTime(DateTime.now().year - 5),
      lastDate: DateTime(DateTime.now().year + 10),
      helpText: 'Due date',
    );
    if (picked != null) {
      setState(() {
        _dueDate = DateHelper.startOfDay(picked);
        if (_reminderEnabled && _dueMinutes != null && _reminderIsPast()) {
          _reminderEnabled = false;
          _reminderNotice =
              'Reminder turned off because the chosen time is in the past.';
        }
      });
    }
  }

  Future<void> _pickTime() async {
    final initial = _dueMinutes != null
        ? TimeOfDay(hour: _dueMinutes! ~/ 60, minute: _dueMinutes! % 60)
        : TimeOfDay.now();
    final picked = await showTimePicker(
      context: context,
      initialTime: initial,
      helpText: 'Due time (optional)',
    );
    if (picked != null) {
      setState(() {
        _dueMinutes = picked.hour * 60 + picked.minute;
        if (_reminderEnabled && _reminderIsPast()) {
          _reminderEnabled = false;
          _reminderNotice =
              'Reminder turned off because the chosen time is in the past.';
        }
      });
    }
  }

  bool _reminderIsPast() =>
      DateHelper.atMinutes(_dueDate, _dueMinutes).isBefore(DateTime.now());

  /// Asks for POST_NOTIFICATIONS once, honestly, when the user enables a
  /// reminder — never at first launch.
  Future<void> _onReminderToggle(bool value) async {
    setState(() => _reminderNotice = null);
    if (!value) {
      setState(() => _reminderEnabled = false);
      return;
    }
    if (_dueMinutes == null) {
      setState(() {
        _reminderNotice =
            'Pick a due time first so Taskly knows when to '
            'remind you.';
      });
      return;
    }
    if (_reminderIsPast()) {
      setState(() {
        _reminderNotice =
            'That time already passed — choose a future time '
            'to get a reminder.';
      });
      return;
    }

    final service = context.read<NotificationService>();
    final enabled = await service.areNotificationsEnabled();
    if (enabled == false) {
      if (!mounted) return;
      final granted = await service.requestNotificationPermission();
      if (granted == false) {
        setState(() {
          _reminderNotice =
              'Notifications are off for Taskly. Enable them in '
              'system settings to hear the nudge.';
        });
        return;
      }
    }
    if (mounted) setState(() => _reminderEnabled = true);
  }

  Future<void> _save() async {
    // Guard against double taps / double submits.
    if (_saving) return;
    FocusScope.of(context).unfocus();
    final valid = _formKey.currentState?.validate() ?? false;
    if (!valid) return;

    setState(() => _saving = true);
    final messenger = ScaffoldMessenger.of(context);
    final controller = context.read<TaskController>();

    try {
      if (_isEdit) {
        final updated = widget.task!.copyWith(
          title: _title.text.trim(),
          description: _description.text.trim(),
          dueDate: _dueDate,
          dueMinutes: _dueMinutes,
          priority: _priority,
          category: _category,
          reminderEnabled: _reminderEnabled,
        );
        await controller.updateTask(updated);
        messenger.showSnackBar(const SnackBar(content: Text('Task updated ✨')));
      } else {
        await controller.addTask(
          title: _title.text,
          description: _description.text,
          dueDate: _dueDate,
          dueMinutes: _dueMinutes,
          priority: _priority,
          category: _category,
          reminderEnabled: _reminderEnabled,
        );
        messenger.showSnackBar(
          const SnackBar(content: Text('Task added — tiny win unlocked!')),
        );
      }
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) {
        setState(() {
          _saving = false;
          _reminderNotice = 'Saving failed. Please try again.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final settings = context.watch<SettingsController>();

    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit task' : 'New task')),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 32),
            children: [
              TextFormField(
                controller: _title,
                textCapitalization: TextCapitalization.sentences,
                maxLength: 200,
                autofocus: !_isEdit,
                decoration: const InputDecoration(
                  labelText: 'What needs doing?',
                  hintText: 'e.g. Water the plants',
                  counterText: '',
                ),
                validator: (value) {
                  final text = value?.trim() ?? '';
                  if (text.isEmpty) {
                    return 'Give your task a name so it feels real.';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: _description,
                textCapitalization: TextCapitalization.sentences,
                maxLength: 2000,
                minLines: 2,
                maxLines: 5,
                decoration: const InputDecoration(
                  labelText: 'Notes (optional)',
                  hintText: 'Any cozy details…',
                  counterText: '',
                ),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: _PickerTile(
                      icon: Icons.event_outlined,
                      label: DateHelper.formatDate(
                        _dueDate,
                        settings.dateFormat,
                      ),
                      sublabel: 'Date',
                      onTap: _pickDate,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _PickerTile(
                      icon: Icons.schedule_rounded,
                      label: DateHelper.formatMinutes(_dueMinutes),
                      sublabel: 'Time (optional)',
                      onTap: _pickTime,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              Text('Priority', style: theme.textTheme.labelLarge),
              const SizedBox(height: 8),
              SegmentedButton<TaskPriority>(
                segments: [
                  for (final priority in TaskPriority.values)
                    ButtonSegment(
                      value: priority,
                      icon: Icon(
                        priority == TaskPriority.high
                            ? Icons.priority_high_rounded
                            : priority == TaskPriority.medium
                            ? Icons.remove_rounded
                            : Icons.arrow_downward_rounded,
                        size: 17,
                      ),
                      label: Text(priority.label),
                    ),
                ],
                selected: {_priority},
                onSelectionChanged: (selection) =>
                    setState(() => _priority = selection.first),
              ),
              const SizedBox(height: 20),
              Text('Category', style: theme.textTheme.labelLarge),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final category in TaskCategory.values)
                    ChoiceChip(
                      avatar: Icon(
                        category.icon,
                        size: 16,
                        color: _category == category
                            ? AppColors.primaryText
                            : category.deep,
                      ),
                      label: Text(category.label),
                      selected: _category == category,
                      onSelected: (_) => setState(() => _category = category),
                    ),
                ],
              ),
              const SizedBox(height: 20),
              SwitchListTile.adaptive(
                contentPadding: EdgeInsets.zero,
                title: const Text('Remind me'),
                subtitle: Text(
                  _dueMinutes == null
                      ? 'Add a due time to enable a gentle nudge'
                      : _reminderEnabled
                      ? 'Taskly will nudge you at '
                            '${DateHelper.formatMinutes(_dueMinutes)}'
                      : 'No reminder will be set',
                ),
                value: _reminderEnabled,
                onChanged: _onReminderToggle,
              ),
              if (_reminderNotice != null)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Row(
                    children: [
                      Icon(
                        Icons.info_outline_rounded,
                        size: 16,
                        color: theme.colorScheme.error,
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          _reminderNotice!,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.error,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: 26),
              FilledButton.icon(
                onPressed: _saving ? null : _save,
                icon: _saving
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.check_rounded),
                label: Text(_isEdit ? 'Save changes' : 'Add task'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PickerTile extends StatelessWidget {
  const _PickerTile({
    required this.icon,
    required this.label,
    required this.sublabel,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final String sublabel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      borderRadius: BorderRadius.circular(AppTheme.radiusM),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: theme.colorScheme.surface,
          borderRadius: BorderRadius.circular(AppTheme.radiusM),
          border: Border.all(color: theme.colorScheme.outline, width: 1.3),
        ),
        child: Row(
          children: [
            Icon(icon, size: 20, color: theme.colorScheme.onSurfaceVariant),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(sublabel, style: theme.textTheme.labelSmall),
                  const SizedBox(height: 2),
                  Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.titleMedium,
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
