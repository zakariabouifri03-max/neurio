import 'package:flutter/material.dart';

import '../core/theme/app_theme.dart';
import '../core/utils/motion.dart';

/// Soft circular progress indicator with a label in the middle.
class ProgressRing extends StatelessWidget {
  const ProgressRing({
    super.key,
    required this.fraction,
    this.size = 92,
    this.strokeWidth = 10,
    this.center,
  });

  final double fraction;
  final double size;
  final double strokeWidth;
  final Widget? center;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = AppTheme.paletteOf(context);
    return TweenAnimationBuilder<double>(
      tween: Tween<double>(begin: 0, end: fraction.clamp(0.0, 1.0)),
      duration: AppMotion.resolve(context, AppMotion.slow),
      curve: AppMotion.curve,
      builder: (context, value, _) {
        return SizedBox(
          width: size,
          height: size,
          child: Stack(
            alignment: Alignment.center,
            children: <Widget>[
              SizedBox(
                width: size,
                height: size,
                child: CircularProgressIndicator(
                  value: value,
                  strokeWidth: strokeWidth,
                  backgroundColor: palette.border,
                  valueColor:
                      AlwaysStoppedAnimation<Color>(theme.colorScheme.primary),
                ),
              ),
              if (center != null) center!,
            ],
          ),
        );
      },
    );
  }
}
