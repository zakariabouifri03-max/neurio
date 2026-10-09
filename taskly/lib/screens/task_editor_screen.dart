import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/theme/app_theme.dart';
import '../core/utils/date_utils.dart';
import '../core/utils/validators.dart';
import '../data/models/task.dart';
import '../data/models/task_category.dart';
import '../data/models/task_priority.dart';
import '../state/settings_store.dart';
import '../state/tasks_store.dart';
import '../widgets/cute_button.dart';
import '../widgets/cute_card.dart';

/// Create or edit a task. Validates input, guards double submits and keeps
/// the reminder in sync with what was saved.
class TaskEditorScreen extends StatefulWidget {
  const TaskEditorScreen({super.key, this.task, this.presetDate});

  final Task? task;
  final DateTime? presetDate;

  @override
  State<TaskEditorScreen> createState() => _TaskEditorScreenState();
}

class _TaskEditorScreenState extends State<TaskEditorScreen> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  late final TextEditingController _titleController;
  late final TextEditingController _descriptionController;

  late DateTime _dueDate;
  String? _dueTime;
  late TaskPriority _priority;
  late TaskCategory _category;
  late bool _reminderEnabled;
  late int _reminderOffset;
  bool _saving = false;

  bool get _isEditing => widget.task != null;

  @override
  void initState() {
    super.initState();
    final task = widget.task;
    _titleController = TextEditingController(text: task?.title ?? '');
    _descriptionController =
        TextEditingController(text: task?.description ?? '');
    _dueDate = task?.dueDate ??
        widget.presetDate ??
        TasklyDates.dayOnly(DateTime.now());
    _dueTime = task?.dueTime;
    _priority = task?.priority ?? TaskPriority.medium;
    _category = task?.category ?? TaskCategory.personal;
    _reminderEnabled = task?.reminderEnabled ?? false;
    _reminderOffset = task?.reminderOffsetMinutes ?? 0;
  }

  @override
  void dispose() {
    _titleController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _dueDate,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
      helpText: 'Pick a due date',
    );
    if (picked != null) {
      setState(() => _dueDate = TasklyDates.dayOnly(picked));
    }
  }

  Future<void> _pickTime() async {
    final initial = _parseTime(_dueTime) ?? const TimeOfDay(hour: 9, minute: 0);
    final picked = await showTimePicker(
      context: context,
      initialTime: initial,
      helpText: 'Pick a due time',
    );
    if (picked != null) {
      setState(
          () => _dueTime = TasklyDates.encodeTime(picked.hour, picked.minute));
    }
  }

  TimeOfDay? _parseTime(String? value) {
    if (value == null) return null;
    final parts = value.split(':');
    final hour = int.tryParse(parts.first);
    final minute = parts.length > 1 ? int.tryParse(parts[1]) : null;
    if (hour == null || minute == null) return null;
    return TimeOfDay(hour: hour, minute: minute);
  }

  Future<void> _save() async {
    if (_saving) return; // guard rapid taps
    final form = _formKey.currentState;
    if (form == null || !form.validate()) return;
    setState(() => _saving = true);

    final store = context.read<TasksStore>();
    final settings = context.read<SettingsStore>();
    final now = DateTime.now();
    final reminderOn = _reminderEnabled && settings.remindersEnabled;

    final Task task;
    if (_isEditing) {
      task = widget.task!.copyWith(
        title: _titleController.text.trim(),
        description: _descriptionController.text.trim().isEmpty
            ? null
            : _descriptionController.text.trim(),
        clearDescription: _descriptionController.text.trim().isEmpty,
        dueDate: _dueDate,
        dueTime: _dueTime,
        clearDueTime: _dueTime == null,
        priority: _priority,
        category: _category,
        updatedAt: now,
        reminderEnabled: reminderOn,
        reminderOffsetMinutes: reminderOn ? _reminderOffset : 0,
      );
    } else {
      task = Task(
        title: _titleController.text.trim(),
        description: _descriptionController.text.trim().isEmpty
            ? null
            : _descriptionController.text.trim(),
        dueDate: _dueDate,
        dueTime: _dueTime,
        priority: _priority,
        category: _category,
        createdAt: now,
        updatedAt: now,
        reminderEnabled: reminderOn,
        reminderOffsetMinutes: reminderOn ? _reminderOffset : 0,
      );
    }

    final ok = _isEditing
        ? await store.updateTask(task)
        : await store.addTask(task) != null;

    if (!mounted) return;
    setState(() => _saving = false);
    if (ok) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(_isEditing
              ? 'Changes saved ✨'
              : '“${task.title}” added to your plan 💜'),
        ),
      );
      Navigator.of(context).pop(true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    final settings = context.watch<SettingsStore>();
    final theme = Theme.of(context);

    return Scaffold(
      backgroundColor: palette.cream,
      appBar: AppBar(
        title: Text(_isEditing ? 'Edit task' : 'New task'),
        leading: IconButton(
          icon: const Icon(Icons.close_rounded),
          tooltip: 'Close',
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
            children: <Widget>[
              TextFormField(
                controller: _titleController,
                textInputAction: TextInputAction.next,
                maxLength: 120,
                validator: Validators.taskTitle,
                decoration: const InputDecoration(
                  hintText: 'What needs doing?',
                  counterText: '',
                ),
                style: theme.textTheme.titleMedium,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _descriptionController,
                minLines: 2,
                maxLines: 5,
                maxLength: 500,
                decoration: const InputDecoration(
                  hintText: 'Add a few notes (optional)',
                  alignLabelWithHint: true,
                ),
                style: theme.textTheme.bodyMedium,
              ),
              const SizedBox(height: 8),
              _SectionLabel('When'),
              const SizedBox(height: 8),
              Row(
                children: <Widget>[
                  Expanded(
                    child: CuteCard(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 14, vertical: 4),
                      onTap: _pickDate,
                      child: ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: Icon(Icons.event_rounded,
                            color: theme.colorScheme.primary),
                        title: Text(
                          settings.dateFormat.formatWithWeekday(_dueDate),
                          style: theme.textTheme.titleSmall,
                        ),
                        subtitle: Text(TasklyDates.relativeDayLabel(
                            _dueDate, DateTime.now()),
                            style: theme.textTheme.bodySmall),
                        trailing: const Icon(Icons.chevron_right_rounded),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Row(
                children: <Widget>[
                  Expanded(
                    child: CuteCard(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 14, vertical: 4),
                      onTap: _pickTime,
                      child: ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: Icon(Icons.schedule_rounded,
                            color: theme.colorScheme.primary),
                        title: Text(
                          _dueTime == null
                              ? 'No time set'
                              : TasklyDates.formatTime(_dueTime!),
                          style: theme.textTheme.titleSmall,
                        ),
                        trailing: _dueTime == null
                            ? const Icon(Icons.chevron_right_rounded)
                            : IconButton(
                                tooltip: 'Remove time',
                                icon: const Icon(Icons.close_rounded, size: 18),
                                onPressed: () =>
                                    setState(() => _dueTime = null),
                              ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              _SectionLabel('Priority'),
              const SizedBox(height: 8),
              Row(
                children: <Widget>[
                  for (final priority in TaskPriority.values)
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 4),
                        child: _SelectableTile(
                          selected: _priority == priority,
                          label: priority.label,
                          icon: priority.icon,
                          selectedColor: priority.background,
                          onTap: () => setState(() => _priority = priority),
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 18),
              _SectionLabel('Category'),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: <Widget>[
                  for (final category in TaskCategory.values)
                    _CategoryChoice(
                      category: category,
                      selected: _category == category,
                      onTap: () => setState(() => _category = category),
                    ),
                ],
              ),
              const SizedBox(height: 18),
              _SectionLabel('Reminder'),
              const SizedBox(height: 8),
              CuteCard(
                padding: const EdgeInsets.fromLTRB(16, 8, 10, 8),
                child: Column(
                  children: <Widget>[
                    SwitchListTile.adaptive(
                      contentPadding: EdgeInsets.zero,
                      value: _reminderEnabled,
                      onChanged: (v) =>
                          setState(() => _reminderEnabled = v),
                      title: Text('Remind me',
                          style: theme.textTheme.titleSmall),
                      subtitle: Text(
                        settings.remindersEnabled
                            ? 'A gentle notification before the due moment'
                            : 'Reminders are turned off in Settings',
                        style: theme.textTheme.bodySmall,
                      ),
                    ),
                    if (_reminderEnabled)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: <Widget>[
                            for (final offset in Task.reminderOffsetChoices)
                              ChoiceChip(
                                label: Text(Task.reminderOffsetLabel(offset)),
                                selected: _reminderOffset == offset,
                                showCheckmark: false,
                                onSelected: (_) =>
                                    setState(() => _reminderOffset = offset),
                              ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 26),
              CuteButton(
                label: _isEditing ? 'Save changes' : 'Add task',
                icon: _isEditing
                    ? Icons.check_rounded
                    : Icons.add_rounded,
                loading: _saving,
                onPressed: _save,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    return Text(
      text.toUpperCase(),
      style: Theme.of(context)
          .textTheme
          .labelSmall
          ?.copyWith(color: palette.textSecondary, letterSpacing: 1.1),
    );
  }
}

class _SelectableTile extends StatelessWidget {
  const _SelectableTile({
    required this.selected,
    required this.label,
    required this.icon,
    required this.selectedColor,
    required this.onTap,
  });

  final bool selected;
  final String label;
  final IconData icon;
  final Color selectedColor;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: selected
              ? (isDark
                  ? selectedColor.withValues(alpha: 0.28)
                  : selectedColor)
              : palette.card,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: selected ? Colors.transparent : palette.border,
          ),
        ),
        child: Column(
          children: <Widget>[
            Icon(icon,
                size: 18,
                color: selected ? palette.textPrimary : palette.textSecondary),
            const SizedBox(height: 4),
            Text(label,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: selected ? palette.textPrimary : palette.textSecondary,
                  fontWeight: FontWeight.w800,
                )),
          ],
        ),
      ),
    );
  }
}

class _CategoryChoice extends StatelessWidget {
  const _CategoryChoice({
    required this.category,
    required this.selected,
    required this.onTap,
  });

  final TaskCategory category;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Semantics(
      button: true,
      selected: selected,
      label: category.label,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppTheme.radiusPill),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          padding:
              const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
          decoration: BoxDecoration(
            color: selected
                ? (isDark
                    ? category.background.withValues(alpha: 0.3)
                    : category.background)
                : palette.card,
            borderRadius: BorderRadius.circular(AppTheme.radiusPill),
            border: Border.all(
              color: selected ? Colors.transparent : palette.border,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(category.icon,
                  size: 15,
                  color: selected
                      ? category.foreground
                      : palette.textSecondary),
              const SizedBox(width: 6),
              Text(
                category.label,
                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                      color: selected
                          ? category.foreground
                          : palette.textSecondary,
                      fontWeight: FontWeight.w700,
                    ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
