import 'package:flutter/material.dart';

import '../core/theme/app_theme.dart';
import '../core/utils/motion.dart';
import 'sparkle_burst.dart';

/// Animated, accessible task checkbox with a sparkle on completion.
class CuteCheckbox extends StatefulWidget {
  const CuteCheckbox({
    super.key,
    required this.value,
    required this.onChanged,
    this.semanticsLabel,
  });

  final bool value;
  final ValueChanged<bool> onChanged;
  final String? semanticsLabel;

  @override
  State<CuteCheckbox> createState() => _CuteCheckboxState();
}

class _CuteCheckboxState extends State<CuteCheckbox> {
  bool _burst = false;

  void _toggle() {
    final next = !widget.value;
    if (next && !AppMotion.reducedMotion(context)) {
      setState(() => _burst = true);
    }
    widget.onChanged(next);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = AppTheme.paletteOf(context);
    return Semantics(
      checked: widget.value,
      label: widget.semanticsLabel ?? 'Mark task complete',
      child: GestureDetector(
        onTap: _toggle,
        behavior: HitTestBehavior.opaque,
        child: SizedBox(
          width: 44,
          height: 44,
          child: Stack(
            alignment: Alignment.center,
            children: <Widget>[
              AnimatedContainer(
                duration: AppMotion.medium,
                curve: AppMotion.springy,
                width: 26,
                height: 26,
                decoration: BoxDecoration(
                  color: widget.value
                      ? theme.colorScheme.primary
                      : palette.card,
                  borderRadius: BorderRadius.circular(9),
                  border: Border.all(
                    color: widget.value
                        ? theme.colorScheme.primary
                        : palette.textSecondary.withValues(alpha: 0.45),
                    width: 1.8,
                  ),
                ),
                child: AnimatedSwitcher(
                  duration: AppMotion.fast,
                  transitionBuilder: (child, animation) => ScaleTransition(
                    scale: animation,
                    child: child,
                  ),
                  child: widget.value
                      ? Icon(Icons.check_rounded,
                          size: 17, color: theme.colorScheme.onPrimary)
                      : const SizedBox.shrink(),
                ),
              ),
              if (_burst)
                SparkleBurst(
                  size: 44,
                  onFinished: () {
                    if (mounted) setState(() => _burst = false);
                  },
                ),
            ],
          ),
        ),
      ),
    );
  }
}
