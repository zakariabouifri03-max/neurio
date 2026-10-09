import 'package:flutter/material.dart';

import '../core/theme/app_theme.dart';

/// The standard soft card used across every screen.
class CuteCard extends StatelessWidget {
  const CuteCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(18),
    this.color,
    this.border,
    this.onTap,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final Color? color;
  final Color? border;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    return Material(
      color: color ?? palette.card,
      borderRadius: BorderRadius.circular(AppTheme.radiusCard),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppTheme.radiusCard),
        child: Container(
          padding: padding,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppTheme.radiusCard),
            border: Border.all(color: border ?? palette.border),
            boxShadow: onTap == null
                ? null
                : <BoxShadow>[
                    BoxShadow(
                      color: palette.shadow,
                      blurRadius: 14,
                      offset: const Offset(0, 6),
                    ),
                  ],
          ),
          child: child,
        ),
      ),
    );
  }
}
