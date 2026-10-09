import 'package:flutter/material.dart';

import '../core/theme/app_theme.dart';
import '../domain/task_query.dart';

/// Rounded search field with a clear button.
class SearchField extends StatelessWidget {
  const SearchField({
    super.key,
    required this.controller,
    required this.onChanged,
    this.hint = 'Search tasks',
  });

  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final String hint;

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    return ValueListenableBuilder<TextEditingValue>(
      valueListenable: controller,
      builder: (context, value, _) {
        return TextField(
          controller: controller,
          onChanged: onChanged,
          textInputAction: TextInputAction.search,
          style: Theme.of(context).textTheme.bodyMedium,
          decoration: InputDecoration(
            hintText: hint,
            prefixIcon: Icon(Icons.search_rounded,
                color: palette.textSecondary, size: 22),
            suffixIcon: value.text.isEmpty
                ? null
                : IconButton(
                    icon: Icon(Icons.close_rounded,
                        color: palette.textSecondary, size: 20),
                    tooltip: 'Clear search',
                    onPressed: () {
                      controller.clear();
                      onChanged('');
                    },
                  ),
          ),
        );
      },
    );
  }
}

/// Horizontally scrollable status filter chips.
class FilterBar extends StatelessWidget {
  const FilterBar({
    super.key,
    required this.selected,
    required this.onSelected,
  });

  final TaskFilter selected;
  final ValueChanged<TaskFilter> onSelected;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = AppTheme.paletteOf(context);
    return SizedBox(
      height: 40,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: EdgeInsets.zero,
        itemCount: TaskFilter.values.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final filter = TaskFilter.values[index];
          final isSelected = filter == selected;
          return FilterChip(
            label: Text(filter.label),
            selected: isSelected,
            onSelected: (_) => onSelected(filter),
            showCheckmark: false,
            labelStyle: theme.textTheme.labelMedium?.copyWith(
              color: isSelected
                  ? theme.colorScheme.onPrimary
                  : palette.textSecondary,
              fontWeight: FontWeight.w700,
            ),
            selectedColor: theme.colorScheme.primary,
            backgroundColor: palette.card,
            side: BorderSide(color: isSelected ? Colors.transparent : palette.border),
            padding: const EdgeInsets.symmetric(horizontal: 6),
            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
          );
        },
      ),
    );
  }
}

/// Small titled row header with optional trailing action.
class SectionHeader extends StatelessWidget {
  const SectionHeader({
    super.key,
    required this.title,
    this.actionLabel,
    this.onAction,
  });

  final String title;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    return Row(
      children: <Widget>[
        Expanded(
          child: Text(title, style: Theme.of(context).textTheme.titleLarge),
        ),
        if (actionLabel != null)
          TextButton(
            onPressed: onAction,
            child: Text(
              actionLabel!,
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    color: Theme.of(context).colorScheme.primary,
                    fontWeight: FontWeight.w700,
                  ),
            ),
          ),
      ],
    );
  }
}
