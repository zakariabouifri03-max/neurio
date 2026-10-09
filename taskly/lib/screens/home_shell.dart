import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/theme/app_theme.dart';
import '../domain/task_query.dart';
import 'calendar_screen.dart';
import 'home_screen.dart';
import 'profile_screen.dart';
import 'task_editor_screen.dart';
import 'tasks_screen.dart';

/// Lets nested screens switch bottom-navigation tabs.
class ShellScope extends InheritedWidget {
  const ShellScope({
    super.key,
    required this.index,
    required this.onNavigate,
    required super.child,
  });

  final int index;
  final ValueChanged<int> onNavigate;

  static ShellScope of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<ShellScope>()!;

  @override
  bool updateShouldNotify(ShellScope oldWidget) => oldWidget.index != index;
}

/// Root navigation: four destinations + floating "new task" action.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;
  final ValueNotifier<TaskFilter?> _pendingTasksFilter =
      ValueNotifier<TaskFilter?>(null);

  static const List<_NavItem> _items = <_NavItem>[
    _NavItem(Icons.home_rounded, Icons.home_outlined, 'Home'),
    _NavItem(Icons.checklist_rounded, Icons.checklist_outlined, 'My Tasks'),
    _NavItem(Icons.calendar_month_rounded, Icons.calendar_month_outlined,
        'Calendar'),
    _NavItem(Icons.person_rounded, Icons.person_outline_rounded, 'Profile'),
  ];

  void _goTo(int index) => setState(() => _index = index);

  void _goToTasksWithFilter(TaskFilter filter) {
    _pendingTasksFilter.value = filter;
    _goTo(1);
  }

  Future<void> _openNewTask() async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const TaskEditorScreen()),
    );
  }

  @override
  void dispose() {
    _pendingTasksFilter.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = AppTheme.paletteOf(context);
    return ShellScope(
      index: _index,
      onNavigate: _goTo,
      child: Scaffold(
        body: IndexedStack(
          index: _index,
          children: <Widget>[
            HomeScreen(
              onOpenTasks: () => _goToTasksWithFilter(TaskFilter.today),
              onOpenCalendar: () => _goTo(2),
            ),
            TasksScreen(pendingFilter: _pendingTasksFilter),
            const CalendarScreen(),
            const ProfileScreen(),
          ],
        ),
        floatingActionButton: Semantics(
          label: 'Add a new task',
          button: true,
          child: FloatingActionButton.large(
            onPressed: _openNewTask,
            backgroundColor: theme.colorScheme.primary,
            foregroundColor: theme.colorScheme.onPrimary,
            elevation: 3,
            child: const Icon(Icons.add_rounded, size: 30),
          ),
        ),
        floatingActionButtonLocation: FloatingActionButtonLocation.endFloat,
        bottomNavigationBar: Container(
          decoration: BoxDecoration(
            color: palette.card,
            border: Border(top: BorderSide(color: palette.border)),
          ),
          child: SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
              child: Row(
                children: <Widget>[
                  for (var i = 0; i < _items.length; i++)
                    Expanded(
                      child: _NavButton(
                        item: _items[i],
                        selected: i == _index,
                        onTap: () => _goTo(i),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _NavItem {
  const _NavItem(this.selectedIcon, this.icon, this.label);

  final IconData selectedIcon;
  final IconData icon;
  final String label;
}

class _NavButton extends StatelessWidget {
  const _NavButton({
    required this.item,
    required this.selected,
    required this.onTap,
  });

  final _NavItem item;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = AppTheme.paletteOf(context);
    final color =
        selected ? theme.colorScheme.primary : palette.textSecondary;
    return Semantics(
      selected: selected,
      button: true,
      label: item.label,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            color: selected
                ? theme.colorScheme.primary.withValues(alpha: 0.12)
                : Colors.transparent,
            borderRadius: BorderRadius.circular(18),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(selected ? item.selectedIcon : item.icon,
                  size: 24, color: color),
              const SizedBox(height: 3),
              Text(
                item.label,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: color,
                  fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
