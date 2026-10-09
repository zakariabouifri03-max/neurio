import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../controllers/settings_controller.dart';
import '../controllers/task_controller.dart';
import '../core/theme/app_colors.dart';
import '../core/theme/app_theme.dart';
import '../core/widgets/common.dart';
import '../models/category.dart';
import '../models/priority.dart';
import '../models/task.dart';
import '../models/task_query.dart';
import '../app/routes.dart';
import '../widgets/task_tile.dart';
import 'task_detail_page.dart';
import 'task_editor_page.dart';

/// My Tasks: search, filters, sorting and the full task library.
class TasksPage extends StatefulWidget {
  const TasksPage({super.key});

  @override
  State<TasksPage> createState() => _TasksPageState();
}

class _TasksPageState extends State<TasksPage> {
  TaskQuery _query = const TaskQuery();
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _update(TaskQuery query) => setState(() => _query = query);

  Future<void> _openFilters() async {
    final result = await showModalBottomSheet<TaskQuery>(
      context: context,
      builder: (_) => _FilterSheet(query: _query),
    );
    if (result != null) _update(result);
  }

  Future<void> _openEditor({Task? task}) => Navigator.of(
    context,
  ).push(fadeSlideRoute<void>(builder: (_) => TaskEditorPage(task: task)));

  Future<void> _openDetails(Task task) => Navigator.of(
    context,
  ).push(fadeSlideRoute<void>(builder: (_) => TaskDetailPage(taskId: task.id)));

  Future<void> _deleteWithConfirm(Task task) async {
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
    if (confirmed == true && mounted) {
      final messenger = ScaffoldMessenger.of(context);
      await context.read<TaskController>().deleteTask(task);
      messenger.showSnackBar(const SnackBar(content: Text('Task deleted')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final settings = context.watch<SettingsController>();
    final controller = context.watch<TaskController>();
    final now = DateTime.now();

    if (controller.error != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('My Tasks')),
        body: SafeArea(
          child: EmptyState(
            icon: Icons.cloud_off_rounded,
            title: 'Something went wrong',
            message: controller.error!,
            actionLabel: 'Try again',
            onAction: controller.retryLoad,
          ),
        ),
      );
    }

    final visible = controller.applyQuery(_query);
    final counts = <TaskFilter, int>{
      for (final f in TaskFilter.values)
        f: controller
            .applyQuery(
              _query.copyWith(
                filter: f,
                // Category/priority still apply to chips' counts.
              ),
            )
            .length,
    };

    return Scaffold(
      appBar: AppBar(
        title: const Text('My Tasks'),
        actions: [
          IconButton(
            tooltip: 'Sort',
            onPressed: () async {
              final picked = await showMenu<TaskSort>(
                context: context,
                position: RelativeRect.fromLTRB(
                  MediaQuery.sizeOf(context).width,
                  kToolbarHeight + 8,
                  12,
                  0,
                ),
                items: [
                  for (final s in TaskSort.values)
                    CheckedPopupMenuItem(
                      value: s,
                      checked: _query.sort == s,
                      child: Text(s.label),
                    ),
                ],
              );
              if (picked != null) _update(_query.copyWith(sort: picked));
            },
            icon: const Icon(Icons.sort_rounded),
          ),
          IconButton(
            tooltip: 'Filters',
            onPressed: _openFilters,
            icon: Badge(
              isLabelVisible:
                  (_query.category != null || _query.priority != null),
              child: const Icon(Icons.filter_alt_outlined),
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'tasks-fab',
        onPressed: () => _openEditor(),
        backgroundColor: AppColors.lavender,
        foregroundColor: AppColors.primaryText,
        icon: const Icon(Icons.add_rounded),
        label: const Text('New task'),
      ),
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
              child: TextField(
                controller: _searchController,
                onChanged: (value) => _update(_query.copyWith(search: value)),
                decoration: InputDecoration(
                  hintText: 'Search tasks…',
                  prefixIcon: const Icon(Icons.search_rounded),
                  suffixIcon: _query.search.isEmpty
                      ? null
                      : IconButton(
                          tooltip: 'Clear search',
                          icon: const Icon(Icons.close_rounded),
                          onPressed: () {
                            _searchController.clear();
                            _update(_query.copyWith(search: ''));
                          },
                        ),
                ),
              ),
            ),
            SizedBox(
              height: 44,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 20),
                children: [
                  for (final filter in TaskFilter.values)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: FilterChip(
                        selected: _query.filter == filter,
                        onSelected: (_) =>
                            _update(_query.copyWith(filter: filter)),
                        label: Text(
                          counts[filter] == 0 && filter != TaskFilter.all
                              ? filter.label
                              : '${filter.label} · ${counts[filter]}',
                        ),
                        showCheckmark: false,
                        avatar:
                            filter == TaskFilter.overdue &&
                                (counts[filter] ?? 0) > 0
                            ? Icon(
                                Icons.warning_amber_rounded,
                                size: 15,
                                color: theme.colorScheme.error,
                              )
                            : null,
                      ),
                    ),
                ],
              ),
            ),
            Expanded(
              child: visible.isEmpty
                  ? EmptyState(
                      icon: _query.hasActiveFilters
                          ? Icons.search_off_rounded
                          : Icons.task_outlined,
                      title: _query.hasActiveFilters
                          ? 'No matches'
                          : 'No tasks yet',
                      message: _query.hasActiveFilters
                          ? 'Try a different search or clear some filters.'
                          : 'Your day is a blank canvas. Let\'s plan something wonderful!',
                      blobColor: AppColors.babyBlue,
                      actionLabel: _query.hasActiveFilters
                          ? 'Clear filters'
                          : 'Add your first task',
                      onAction: _query.hasActiveFilters
                          ? () {
                              _searchController.clear();
                              _update(const TaskQuery());
                            }
                          : () => _openEditor(),
                    )
                  : ListView.builder(
                      padding: EdgeInsets.fromLTRB(
                        20,
                        8,
                        20,
                        _fabHeight + MediaQuery.paddingOf(context).bottom + 24,
                      ),
                      itemCount: visible.length,
                      itemBuilder: (context, index) {
                        final task = visible[index];
                        return Dismissible(
                          key: ValueKey('task-${task.id}'),
                          direction: DismissDirection.endToStart,
                          background: Container(
                            alignment: Alignment.centerRight,
                            padding: const EdgeInsets.only(right: 22),
                            margin: const EdgeInsets.symmetric(vertical: 5),
                            decoration: BoxDecoration(
                              color: theme.colorScheme.error.withValues(
                                alpha: 0.14,
                              ),
                              borderRadius: BorderRadius.circular(
                                AppTheme.radiusM,
                              ),
                            ),
                            child: Icon(
                              Icons.delete_outline_rounded,
                              color: theme.colorScheme.error,
                            ),
                          ),
                          confirmDismiss: (_) async {
                            await _deleteWithConfirm(task);
                            return false; // row stays; controller updates list
                          },
                          child: TaskTile(
                            task: task,
                            now: now,
                            dateFormat: settings.dateFormat,
                            showDate: true,
                            onToggle: (t) => context
                                .read<TaskController>()
                                .toggleComplete(t),
                            onOpen: () => _openDetails(task),
                          ),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }

  static const double _fabHeight = 56;
}

/// Bottom sheet for category & priority filters.
class _FilterSheet extends StatelessWidget {
  const _FilterSheet({required this.query});

  final TaskQuery query;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    TaskQuery draft = query;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
      child: StatefulBuilder(
        builder: (context, setSheet) => Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Filter tasks', style: theme.textTheme.titleLarge),
            const SizedBox(height: 14),
            Text('Category', style: theme.textTheme.labelLarge),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                ChoiceChip(
                  label: const Text('Any'),
                  selected: draft.category == null,
                  onSelected: (_) =>
                      setSheet(() => draft = draft.copyWith(category: null)),
                ),
                for (final category in TaskCategory.values)
                  ChoiceChip(
                    avatar: Icon(
                      category.icon,
                      size: 15,
                      color: draft.category == category
                          ? AppColors.primaryText
                          : category.deep,
                    ),
                    label: Text(category.label),
                    selected: draft.category == category,
                    onSelected: (_) => setSheet(
                      () => draft = draft.copyWith(category: category),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            Text('Priority', style: theme.textTheme.labelLarge),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                ChoiceChip(
                  label: const Text('Any'),
                  selected: draft.priority == null,
                  onSelected: (_) =>
                      setSheet(() => draft = draft.copyWith(priority: null)),
                ),
                for (final priority in TaskPriority.values)
                  ChoiceChip(
                    avatar: Icon(
                      priority == TaskPriority.high
                          ? Icons.priority_high_rounded
                          : priority == TaskPriority.medium
                          ? Icons.remove_rounded
                          : Icons.arrow_downward_rounded,
                      size: 15,
                    ),
                    label: Text(priority.label),
                    selected: draft.priority == priority,
                    onSelected: (_) => setSheet(
                      () => draft = draft.copyWith(priority: priority),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 22),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(
                      context,
                    ).pop(const TaskQuery(filter: TaskFilter.all)),
                    child: const Text('Clear all'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton(
                    onPressed: () => Navigator.of(context).pop(draft),
                    child: const Text('Apply'),
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
