import 'package:flutter/material.dart';

import '../core/theme/app_theme.dart';
import '../core/utils/motion.dart';

/// Rounded, friendly button with gentle press feedback and a built-in
/// guard against double submission (`loading` disables further taps).
class CuteButton extends StatefulWidget {
  const CuteButton({
    super.key,
    required this.label,
    this.icon,
    this.onPressed,
    this.loading = false,
    this.secondary = false,
    this.destructive = false,
    this.expanded = true,
  });

  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final bool loading;
  final bool secondary;
  final bool destructive;
  final bool expanded;

  @override
  State<CuteButton> createState() => _CuteButtonState();
}

class _CuteButtonState extends State<CuteButton> {
  bool _pressed = false;

  bool get _enabled => widget.onPressed != null && !widget.loading;

  void _setPressed(bool value) {
    if (!mounted || _pressed == value) return;
    setState(() => _pressed = value);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final palette = AppTheme.paletteOf(context);
    final background = widget.destructive
        ? palette.danger
        : widget.secondary
            ? palette.card
            : theme.colorScheme.primary;
    final foreground = widget.destructive
        ? Colors.white
        : widget.secondary
            ? palette.textPrimary
            : theme.colorScheme.onPrimary;

    final child = AnimatedScale(
      scale: _pressed ? 0.965 : 1,
      duration: AppMotion.fast,
      curve: AppMotion.curve,
      child: AnimatedOpacity(
        opacity: _enabled ? 1 : 0.55,
        duration: AppMotion.fast,
        child: Container(
          height: 52,
          padding: const EdgeInsets.symmetric(horizontal: 22),
          decoration: BoxDecoration(
            color: background,
            borderRadius: BorderRadius.circular(AppTheme.radiusPill),
            border: widget.secondary
                ? Border.all(color: palette.border)
                : null,
            boxShadow: _enabled && !widget.secondary
                ? <BoxShadow>[
                    BoxShadow(
                      color: background.withValues(alpha: 0.35),
                      blurRadius: 16,
                      offset: const Offset(0, 7),
                    ),
                  ]
                : null,
          ),
          child: Row(
            mainAxisSize: widget.expanded ? MainAxisSize.max : MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              if (widget.loading)
                SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.4,
                    color: foreground,
                  ),
                )
              else if (widget.icon != null)
                Icon(widget.icon, size: 20, color: foreground),
              if (widget.icon != null || widget.loading)
                const SizedBox(width: 10),
              Flexible(
                child: Text(
                  widget.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelLarge
                      ?.copyWith(color: foreground, fontSize: 15.5),
                ),
              ),
            ],
          ),
        ),
      ),
    );

    return Semantics(
      button: true,
      enabled: _enabled,
      label: widget.label,
      child: GestureDetector(
        onTap: _enabled ? widget.onPressed : null,
        onTapDown: (_) => _setPressed(true),
        onTapUp: (_) => _setPressed(false),
        onTapCancel: () => _setPressed(false),
        child: widget.expanded ? SizedBox(width: double.infinity, child: child) : child,
      ),
    );
  }
}
