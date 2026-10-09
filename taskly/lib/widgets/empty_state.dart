import 'package:flutter/material.dart';

import '../core/theme/app_theme.dart';
import 'cute_button.dart';

/// Centered, gentle empty / error state.
class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.illustration,
    required this.title,
    this.message,
    this.actionLabel,
    this.actionIcon,
    this.onAction,
  });

  final Widget illustration;
  final String title;
  final String? message;
  final String? actionLabel;
  final IconData? actionIcon;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            illustration,
            const SizedBox(height: 18),
            Text(title,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineSmall),
            if (message != null) ...<Widget>[
              const SizedBox(height: 8),
              Text(
                message!,
                textAlign: TextAlign.center,
                style: Theme.of(context)
                    .textTheme
                    .bodyMedium
                    ?.copyWith(color: palette.textSecondary),
              ),
            ],
            if (actionLabel != null) ...<Widget>[
              const SizedBox(height: 22),
              CuteButton(
                label: actionLabel!,
                icon: actionIcon,
                onPressed: onAction,
                expanded: false,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
