import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../core/theme/app_theme.dart';
import '../core/utils/date_utils.dart';
import '../state/settings_store.dart';
import '../state/tasks_store.dart';
import '../widgets/cute_button.dart';
import '../widgets/cute_card.dart';
import '../widgets/empty_state.dart';
import '../widgets/illustrations.dart';
import '../widgets/task_tile.dart';
import 'task_details_screen.dart';
import 'task_editor_screen.dart';

/// Monthly calendar with a per-day task list. Uses real saved tasks only.
class CalendarScreen extends StatefulWidget {
  const CalendarScreen({super.key});

  @override
  State<CalendarScreen> createState() => _CalendarScreenState();
}

class _CalendarScreenState extends State<CalendarScreen> {
  late DateTime _month;
  late DateTime _selected;

  @override
  void initState() {
    super.initState();
    final now = TasklyDates.dayOnly(DateTime.now());
    _month = DateTime(now.year, now.month, 1);
    _selected = now;
  }

  void _changeMonth(int delta) {
    setState(() {
      _month = DateTime(_month.year, _month.month + delta, 1);
    });
  }

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    final theme = Theme.of(context);
    final store = context.watch<TasksStore>();
    final settings = context.watch<SettingsStore>();
    final now = DateTime.now();
    final grid = TasklyDates.monthGrid(_month, settings.firstWeekday);
    final dayTasks = store.dueOn(_selected)
      ..sort((a, b) => a.referenceDateTime.compareTo(b.referenceDateTime));

    return Scaffold(
      backgroundColor: palette.cream,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 100),
          children: <Widget>[
            Text('Calendar', style: theme.textTheme.headlineMedium),
            const SizedBox(height: 14),
            CuteCard(
              padding: const EdgeInsets.fromLTRB(12, 14, 12, 14),
              child: Column(
                children: <Widget>[
                  Row(
                    children: <Widget>[
                      IconButton(
                        tooltip: 'Previous month',
                        icon: const Icon(Icons.chevron_left_rounded),
                        onPressed: () => _changeMonth(-1),
                      ),
                      Expanded(
                        child: Text(
                          DateFormat('MMMM yyyy').format(_month),
                          textAlign: TextAlign.center,
                          style: theme.textTheme.titleLarge,
                        ),
                      ),
                      IconButton(
                        tooltip: 'Next month',
                        icon: const Icon(Icons.chevron_right_rounded),
                        onPressed: () => _changeMonth(1),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  _WeekdayRow(firstWeekday: settings.firstWeekday),
                  const SizedBox(height: 4),
                  GridView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    gridDelegate:
                        const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 7,
                      mainAxisExtent: 46,
                    ),
                    itemCount: grid.length,
                    itemBuilder: (context, index) {
                      final day = grid[index];
                      final inMonth = day.month == _month.month;
                      final tasksOnDay = store.dueOn(day);
                      return _DayCell(
                        day: day,
                        inMonth: inMonth,
                        isToday: TasklyDates.isSameDay(day, now),
                        isSelected: TasklyDates.isSameDay(day, _selected),
                        taskCount: tasksOnDay.length,
                        completedCount: tasksOnDay
                            .where((t) => t.isCompleted)
                            .length,
                        onTap: () => setState(() => _selected = day),
                      );
                    },
                  ),
                ],
              ),
            ),
            const SizedBox(height: 18),
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    '${TasklyDates.relativeDayLabel(_selected, now)} · '
                    '${settings.dateFormat.format(_selected)}',
                    style: theme.textTheme.titleLarge,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            if (dayTasks.isEmpty)
              EmptyState(
                illustration: Illustrations.blankCanvas(size: 130),
                title: 'Nothing planned',
                message: 'This day is wide open. Add something small and kind '
                    'to future-you.',
                actionLabel: 'Add a task for this day',
                actionIcon: Icons.add_rounded,
                onAction: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) =>
                        TaskEditorScreen(presetDate: _selected),
                  ),
                ),
              )
            else
              Column(
                children: <Widget>[
                  for (final task in dayTasks)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: TaskTile(
                        task: task,
                        now: now,
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) =>
                                TaskDetailsScreen(taskId: task.id!),
                          ),
                        ),
                        onToggle: (v) => store.setCompleted(task, v),
                      ),
                    ),
                  const SizedBox(height: 4),
                  CuteButton(
                    label: 'Add a task for this day',
                    icon: Icons.add_rounded,
                    secondary: true,
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) =>
                            TaskEditorScreen(presetDate: _selected),
                      ),
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

class _WeekdayRow extends StatelessWidget {
  const _WeekdayRow({required this.firstWeekday});

  final int firstWeekday;

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    final labels = <String>[];
    for (var i = 0; i < 7; i++) {
      final weekday = ((firstWeekday - 1 + i) % 7) + 1;
      labels.add(DateFormat.E().format(DateTime(2024, 1, weekday)));
    }
    return Row(
      children: <Widget>[
        for (final label in labels)
          Expanded(
            child: Center(
              child: Text(
                label,
                style: Theme.of(context)
                    .textTheme
                    .labelSmall
                    ?.copyWith(color: palette.textSecondary),
              ),
            ),
          ),
      ],
    );
  }
}

class _DayCell extends StatelessWidget {
  const _DayCell({
    required this.day,
    required this.inMonth,
    required this.isToday,
    required this.isSelected,
    required this.taskCount,
    required this.completedCount,
    required this.onTap,
  });

  final DateTime day;
  final bool inMonth;
  final bool isToday;
  final bool isSelected;
  final int taskCount;
  final int completedCount;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = AppTheme.paletteOf(context);
    final allDone = taskCount > 0 && completedCount == taskCount;
    return Semantics(
      button: true,
      selected: isSelected,
      label: '${DateFormat.yMMMd().format(day)}, '
          '$taskCount task${taskCount == 1 ? '' : 's'}',
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          margin: const EdgeInsets.all(2),
          decoration: BoxDecoration(
            color: isSelected
                ? theme.colorScheme.primary.withValues(alpha: 0.16)
                : Colors.transparent,
            borderRadius: BorderRadius.circular(14),
            border: isSelected
                ? Border.all(color: theme.colorScheme.primary, width: 1.4)
                : null,
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              Container(
                width: 30,
                height: 30,
                decoration: BoxDecoration(
                  color: isToday ? theme.colorScheme.primary : null,
                  shape: BoxShape.circle,
                ),
                child: Center(
                  child: Text(
                    '${day.day}',
                    style: theme.textTheme.titleSmall?.copyWith(
                      color: isToday
                          ? theme.colorScheme.onPrimary
                          : inMonth
                              ? palette.textPrimary
                              : palette.textSecondary.withValues(alpha: 0.5),
                      fontWeight:
                          isToday || isSelected ? FontWeight.w800 : FontWeight.w600,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 3),
              SizedBox(
                height: 5,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: <Widget>[
                    for (var i = 0; i < taskCount && i < 3; i++)
                      Container(
                        margin: const EdgeInsets.symmetric(horizontal: 1.2),
                        width: 5,
                        height: 5,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: allDone ? palette.success : palette.lavender,
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
