import 'package:flutter/material.dart';

import '../core/theme/app_theme.dart';
import 'cute_button.dart';

/// Friendly confirmation dialog. Returns true only on explicit confirm.
Future<bool> showCuteConfirm(
  BuildContext context, {
  required String title,
  required String message,
  required String confirmLabel,
  bool destructive = false,
  IconData icon = Icons.help_outline_rounded,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (context) {
      final palette = AppTheme.paletteOf(context);
      return Dialog(
        backgroundColor: palette.card,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppTheme.radiusCard),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 26, 24, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: destructive
                      ? palette.dangerSoft
                      : palette.lavender.withValues(alpha: 0.35),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  icon,
                  color: destructive ? palette.danger : palette.textPrimary,
                  size: 26,
                ),
              ),
              const SizedBox(height: 14),
              Text(title,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              Text(message,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: palette.textSecondary,
                      )),
              const SizedBox(height: 22),
              CuteButton(
                label: confirmLabel,
                destructive: destructive,
                onPressed: () => Navigator.of(context).pop(true),
              ),
              const SizedBox(height: 10),
              CuteButton(
                label: 'Cancel',
                secondary: true,
                onPressed: () => Navigator.of(context).pop(false),
              ),
            ],
          ),
        ),
      );
    },
  );
  return result ?? false;
}
