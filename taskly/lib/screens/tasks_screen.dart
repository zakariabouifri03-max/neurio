import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/theme/app_theme.dart';
import '../data/models/task_category.dart';
import '../data/models/task_priority.dart';
import '../domain/task_query.dart';
import '../state/settings_store.dart';
import '../state/tasks_store.dart';
import '../widgets/confirm_dialog.dart';
import '../widgets/empty_state.dart';
import '../widgets/illustrations.dart';
import '../widgets/search_and_filters.dart';
import '../widgets/task_tile.dart';
import 'task_details_screen.dart';
import 'task_editor_screen.dart';

/// My Tasks: search, filter, sort and manage everything.
class TasksScreen extends StatefulWidget {
  const TasksScreen({super.key, this.pendingFilter});

  /// Set by the shell when another screen asks to open a specific filter.
  final ValueNotifier<TaskFilter?>? pendingFilter;

  @override
  State<TasksScreen> createState() => _TasksScreenState();
}

class _TasksScreenState extends State<TasksScreen> {
  final TextEditingController _searchController = TextEditingController();
  TaskQuery _query = const TaskQuery();

  @override
  void initState() {
    super.initState();
    widget.pendingFilter?.addListener(_onPendingFilter);
  }

  void _onPendingFilter() {
    final filter = widget.pendingFilter?.value;
    if (filter == null || !mounted) return;
    setState(() => _query = _query.copyWith(filter: filter));
    widget.pendingFilter?.value = null;
  }

  @override
  void dispose() {
    widget.pendingFilter?.removeListener(_onPendingFilter);
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _delete(Task task) async {
    final confirmed = await showCuteConfirm(
      context,
      title: 'Delete this task?',
      message: '“${task.title}” will be removed for good.',
      confirmLabel: 'Delete',
      destructive: true,
      icon: Icons.delete_outline_rounded,
    );
    if (!confirmed || !mounted) return;
    final ok = await context.read<TasksStore>().deleteTask(task);
    if (ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Task deleted. Bye bye, clutter!')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    final store = context.watch<TasksStore>();
    final settings = context.watch<SettingsStore>();
    final now = DateTime.now();
    final results = _query.apply(store.tasks, now);

    return Scaffold(
      backgroundColor: palette.cream,
      body: SafeArea(
        child: Column(
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
              child: Column(
                children: <Widget>[
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: Text('My Tasks',
                            style: Theme.of(context).textTheme.headlineMedium),
                      ),
                      _SortMenu(
                        sort: _query.sort,
                        onSelected: (s) =>
                            setState(() => _query = _query.copyWith(sort: s)),
                      ),
                      _RefineMenu(
                        query: _query,
                        onChanged: (q) => setState(() => _query = q),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  SearchField(
                    controller: _searchController,
                    onChanged: (v) =>
                        setState(() => _query = _query.copyWith(search: v)),
                  ),
                  const SizedBox(height: 10),
                  FilterBar(
                    selected: _query.filter,
                    onSelected: (f) =>
                        setState(() => _query = _query.copyWith(filter: f)),
                  ),
                  const SizedBox(height: 6),
                  if (_query.hasActiveRefinements)
                    Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton.icon(
                        onPressed: () {
                          _searchController.clear();
                          setState(() => _query = const TaskQuery(sort: _query.sort));
                        },
                        icon: const Icon(Icons.filter_alt_off_outlined,
                            size: 16),
                        label: Text('Clear filters (${results.length} shown)'),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 6),
            Expanded(
              child: store.isLoading && !store.hasTasks
                  ? const Center(child: CircularProgressIndicator())
                  : results.isEmpty
                      ? EmptyState(
                          illustration: Illustrations.planner(size: 140),
                          title: store.hasTasks
                              ? 'No tasks match'
                              : 'No tasks yet',
                          message: store.hasTasks
                              ? 'Try a different search or clear the filters.'
                              : 'Your list is waiting for its very first task.',
                        )
                      : ListView.separated(
                          padding:
                              const EdgeInsets.fromLTRB(20, 8, 20, 110),
                          itemCount: results.length,
                          separatorBuilder: (_, __) =>
                              const SizedBox(height: 10),
                          itemBuilder: (context, index) {
                            final task = results[index];
                            return TaskTile(
                              task: task,
                              now: now,
                              dateFormat: settings.dateFormat,
                              onTap: () => Navigator.of(context).push(
                                MaterialPageRoute<void>(
                                  builder: (_) =>
                                      TaskDetailsScreen(taskId: task.id!),
                                ),
                              ),
                              onToggle: (v) =>
                                  store.setCompleted(task, v),
                              onEdit: () => Navigator.of(context).push(
                                MaterialPageRoute<void>(
                                  builder: (_) =>
                                      TaskEditorScreen(task: task),
                                ),
                              ),
                              onDelete: () => _delete(task),
                            );
                          },
                        ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SortMenu extends StatelessWidget {
  const _SortMenu({required this.sort, required this.onSelected});

  final TaskSort sort;
  final ValueChanged<TaskSort> onSelected;

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    return PopupMenuButton<TaskSort>(
      tooltip: 'Sort tasks',
      icon: Icon(Icons.sort_rounded, color: palette.textSecondary),
      onSelected: onSelected,
      itemBuilder: (context) => <PopupMenuEntry<TaskSort>>[
        for (final s in TaskSort.values)
          PopupMenuItem<TaskSort>(
            value: s,
            child: Row(
              children: <Widget>[
                Icon(
                  s == sort
                      ? Icons.radio_button_checked_rounded
                      : Icons.radio_button_off_rounded,
                  size: 16,
                  color: s == sort
                      ? Theme.of(context).colorScheme.primary
                      : palette.textSecondary,
                ),
                const SizedBox(width: 8),
                Text(s.label),
              ],
            ),
          ),
      ],
    );
  }
}

class _RefineMenu extends StatelessWidget {
  const _RefineMenu({required this.query, required this.onChanged});

  final TaskQuery query;
  final ValueChanged<TaskQuery> onChanged;

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    final active = query.category != null || query.priority != null;
    return PopupMenuButton<String>(
      tooltip: 'Filter by category or priority',
      icon: Icon(
        active ? Icons.tune_rounded : Icons.tune_outlined,
        color: active
            ? Theme.of(context).colorScheme.primary
            : palette.textSecondary,
      ),
      onSelected: (value) {
        if (value == 'clear') {
          onChanged(query.copyWith(clearCategory: true, clearPriority: true));
          return;
        }
        if (value.startsWith('c:')) {
          final category = TaskCategory.values
              .firstWhere((c) => c.name == value.substring(2));
          onChanged(query.copyWith(
            category: query.category == category ? null : category,
            clearCategory: query.category == category,
          ));
          return;
        }
        if (value.startsWith('p:')) {
          final priority = TaskPriority.values
              .firstWhere((p) => p.name == value.substring(2));
          onChanged(query.copyWith(
            priority: query.priority == priority ? null : priority,
            clearPriority: query.priority == priority,
          ));
        }
      },
      itemBuilder: (context) => <PopupMenuEntry<String>>[
        const PopupMenuItem<String>(
            enabled: false, child: Text('Category', style: TextStyle(fontWeight: FontWeight.w800))),
        for (final c in TaskCategory.values)
          PopupMenuItem<String>(
            value: 'c:${c.name}',
            child: Row(
              children: <Widget>[
                Icon(
                  query.category == c
                      ? Icons.check_circle_rounded
                      : c.icon,
                  size: 16,
                  color: c.foreground,
                ),
                const SizedBox(width: 8),
                Text(c.label),
              ],
            ),
          ),
        const PopupMenuDivider(),
        const PopupMenuItem<String>(
            enabled: false, child: Text('Priority', style: TextStyle(fontWeight: FontWeight.w800))),
        for (final p in TaskPriority.values)
          PopupMenuItem<String>(
            value: 'p:${p.name}',
            child: Row(
              children: <Widget>[
                Icon(
                  query.priority == p
                      ? Icons.check_circle_rounded
                      : p.icon,
                  size: 16,
                  color: p.foreground,
                ),
                const SizedBox(width: 8),
                Text(p.label),
              ],
            ),
          ),
        const PopupMenuDivider(),
        const PopupMenuItem<String>(
            value: 'clear', child: Text('Clear category & priority')),
      ],
    );
  }
}
