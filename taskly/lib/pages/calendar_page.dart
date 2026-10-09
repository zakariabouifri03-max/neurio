import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../controllers/settings_controller.dart';
import '../controllers/task_controller.dart';
import '../core/theme/app_colors.dart';
import '../core/theme/app_theme.dart';
import '../core/utils/date_helper.dart';
import '../core/widgets/common.dart';
import '../models/task.dart';
import '../app/routes.dart';
import '../widgets/task_tile.dart';
import 'task_detail_page.dart';
import 'task_editor_page.dart';

/// Monthly calendar with dot indicators and a real task list for the
/// selected day. All math is local-date based (DST & leap-year safe).
class CalendarPage extends StatefulWidget {
  const CalendarPage({super.key});

  @override
  State<CalendarPage> createState() => _CalendarPageState();
}

class _CalendarPageState extends State<CalendarPage> {
  late DateTime _visibleMonth;
  late DateTime _selectedDay;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _visibleMonth = DateTime(now.year, now.month);
    _selectedDay = DateHelper.startOfDay(now);
  }

  void _shiftMonth(int delta) {
    setState(() {
      _visibleMonth = DateHelper.addMonths(_visibleMonth, delta);
    });
  }

  Future<void> _openEditor({DateTime? presetDate}) => Navigator.of(context).push(
        fadeSlideRoute<void>(
          builder: (_) => TaskEditorPage(presetDate: presetDate ?? _selectedDay),
        ),
      );

  Future<void> _openDetails(Task task) => Navigator.of(context).push(
        fadeSlideRoute<void>(
          builder: (_) => TaskDetailPage(taskId: task.id),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final settings = context.watch<SettingsController>();
    final controller = context.watch<TaskController>();
    final now = DateTime.now();
    final today = DateHelper.startOfDay(now);

    final tasksForSelected = controller.tasksForDay(_selectedDay);
    final tasksByDay = <int, List<Task>>{};
    for (final task in controller.tasks) {
      if (task.dueDate.year == _visibleMonth.year &&
          task.dueDate.month == _visibleMonth.month) {
        (tasksByDay[task.dueDate.day] ??= []).add(task);
      }
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(
          '${DateHelper.monthName(_visibleMonth.month)} ${_visibleMonth.year}',
        ),
        actions: [
          IconButton(
            tooltip: 'Previous month',
            onPressed: () => _shiftMonth(-1),
            icon: const Icon(Icons.chevron_left_rounded),
          ),
          IconButton(
            tooltip: 'Next month',
            onPressed: () => _shiftMonth(1),
            icon: const Icon(Icons.chevron_right_rounded),
          ),
          IconButton(
            tooltip: 'Jump to today',
            onPressed: () => setState(() {
              _visibleMonth = DateTime(today.year, today.month);
              _selectedDay = today;
            }),
            icon: const Icon(Icons.today_outlined),
          ),
        ],
      ),
      body: SafeArea(
        bottom: false,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
          children: [
            _MonthGrid(
              month: _visibleMonth,
              today: today,
              selectedDay: _selectedDay,
              weekStart: settings.weekStart,
              tasksByDay: tasksByDay,
              onSelect: (day) => setState(() => _selectedDay = day),
            ),
            const SizedBox(height: 10),
            SectionHeader(
              title: DateHelper.isSameDay(_selectedDay, today)
                  ? 'Today'
                  : DateHelper.formatDate(_selectedDay, settings.dateFormat),
              trailingLabel: 'Add',
              trailingIcon: Icons.add_rounded,
              onTrailing: () => _openEditor(),
            ),
            if (tasksForSelected.isEmpty)
              EmptyState(
                icon: Icons.event_available_rounded,
                title: 'Nothing planned',
                message: 'A perfectly open day. Add a task if you like!',
                blobColor: AppColors.babyBlue,
                actionLabel: 'Add for this day',
                onAction: () => _openEditor(),
              )
            else
              ...tasksForSelected.map(
                (task) => TaskTile(
                  task: task,
                  now: now,
                  dateFormat: settings.dateFormat,
                  onToggle: (t) =>
                      context.read<TaskController>().toggleComplete(t),
                  onOpen: () => _openDetails(task),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _MonthGrid extends StatelessWidget {
  const _MonthGrid({
    required this.month,
    required this.today,
    required this.selectedDay,
    required this.weekStart,
    required this.tasksByDay,
    required this.onSelect,
  });

  final DateTime month;
  final DateTime today;
  final DateTime selectedDay;
  final WeekStart weekStart;
  final Map<int, List<Task>> tasksByDay;
  final ValueChanged<DateTime> onSelect;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final labels = DateHelper.weekdayLabels(weekStart);
    final blanks = DateHelper.leadingBlanks(month.year, month.month, weekStart);
    final days = DateHelper.daysInMonth(month.year, month.month);

    return Container(
      padding: const EdgeInsets.fromLTRB(10, 14, 10, 16),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(AppTheme.radiusL),
        border: Border.all(color: theme.colorScheme.outline),
      ),
      child: Column(
        children: [
          Row(
            children: [
              for (final label in labels)
                Expanded(
                  child: Center(
                    child: Text(
                      label,
                      style: theme.textTheme.labelSmall,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),
          ...List.generate((blanks + days + 6) ~/ 7, (weekIndex) {
            return Row(
              children: [
                for (var col = 0; col < 7; col++)
                  Expanded(
                    child: _buildCell(
                      context,
                      cellIndex: weekIndex * 7 + col,
                      blanks: blanks,
                      days: days,
                    ),
                  ),
              ],
            );
          }),
        ],
      ),
    );
  }

  Widget _buildCell(
    BuildContext context, {
    required int cellIndex,
    required int blanks,
    required int days,
  }) {
    final dayNumber = cellIndex - blanks + 1;
    if (dayNumber < 1 || dayNumber > days) {
      return const SizedBox(height: 44);
    }
    final theme = Theme.of(context);
    final date = DateTime(month.year, month.month, dayNumber);
    final isToday = DateHelper.isSameDay(date, today);
    final isSelected = DateHelper.isSameDay(date, selectedDay);
    final dayTasks = tasksByDay[dayNumber] ?? const <Task>[];
    final dark = theme.brightness == Brightness.dark;

    final background = isSelected
        ? AppColors.lavenderDeep
        : isToday
            ? (dark
                ? AppColors.lavender.withValues(alpha: 0.18)
                : AppColors.lavender.withValues(alpha: 0.55))
            : Colors.transparent;
    final foreground = isSelected
        ? Colors.white
        : isToday
            ? AppColors.primaryText
            : theme.colorScheme.onSurface;

    return Semantics(
      label: 'Day $dayNumber, '
          '${DateHelper.monthName(month.month)}, '
          '${dayTasks.length} tasks',
      button: true,
      selected: isSelected,
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => onSelect(date),
        child: Container(
          height: 44,
          margin: const EdgeInsets.all(1.5),
          decoration: BoxDecoration(
            color: background,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                '$dayNumber',
                style: theme.textTheme.labelLarge?.copyWith(color: foreground),
              ),
              const SizedBox(height: 3),
              SizedBox(
                height: 5,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    for (final task in dayTasks.take(3))
                      Container(
                        width: 5,
                        height: 5,
                        margin: const EdgeInsets.symmetric(horizontal: 1),
                        decoration: BoxDecoration(
                          color: isSelected
                              ? Colors.white.withValues(alpha: 0.9)
                              : task.isCompleted
                                  ? theme.colorScheme.outline
                                  : task.category.deep,
                          shape: BoxShape.circle,
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
