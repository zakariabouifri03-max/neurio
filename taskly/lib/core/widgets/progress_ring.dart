import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/app_colors.dart';

/// Animated circular progress ring with a friendly rounded cap.
/// Renders its value as text (never color-only) for accessibility.
class ProgressRing extends StatelessWidget {
  const ProgressRing({
    super.key,
    required this.progress,
    required this.size,
    this.strokeWidth = 11,
    this.trackColor,
    this.progressColor,
    this.center,
    this.animate = true,
  });

  /// 0.0 – 1.0. Values outside are clamped.
  final double progress;
  final double size;
  final double strokeWidth;
  final Color? trackColor;
  final Color? progressColor;
  final Widget? center;
  final bool animate;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final clamped = progress.clamp(0.0, 1.0);

    Widget ring = CustomPaint(
      size: Size.square(size),
      painter: _RingPainter(
        progress: clamped,
        trackColor: trackColor ?? scheme.outline,
        progressColor: progressColor ?? scheme.primary,
        strokeWidth: strokeWidth,
      ),
      child: SizedBox(
        width: size,
        height: size,
        child: Center(child: center),
      ),
    );

    if (animate) {
      ring = TweenAnimationBuilder<double>(
        tween: Tween(begin: 0, end: clamped),
        duration: const Duration(milliseconds: 650),
        curve: Curves.easeOutCubic,
        builder: (context, value, _) => CustomPaint(
          size: Size.square(size),
          painter: _RingPainter(
            progress: value,
            trackColor: trackColor ?? scheme.outline,
            progressColor: progressColor ?? scheme.primary,
            strokeWidth: strokeWidth,
          ),
          child: SizedBox(
            width: size,
            height: size,
            child: Center(child: center),
          ),
        ),
      );
    }
    return Semantics(
      label: 'Progress ${(clamped * 100).round()} percent',
      child: ring,
    );
  }
}

class _RingPainter extends CustomPainter {
  _RingPainter({
    required this.progress,
    required this.trackColor,
    required this.progressColor,
    required this.strokeWidth,
  });

  final double progress;
  final Color trackColor;
  final Color progressColor;
  final double strokeWidth;

  @override
  void paint(Canvas canvas, Size size) {
    final radius = (size.shortestSide - strokeWidth) / 2;
    final center = Offset(size.width / 2, size.height / 2);
    final rect = Rect.fromCircle(center: center, radius: radius);

    final track = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..color = trackColor
      ..strokeCap = StrokeCap.round;
    canvas.drawArc(rect, 0, math.pi * 2, false, track);

    if (progress > 0) {
      final fill = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = strokeWidth
        ..color = progressColor
        ..strokeCap = StrokeCap.round;
      canvas.drawArc(rect, -math.pi / 2, math.pi * 2 * progress, false, fill);
    }
  }

  @override
  bool shouldRepaint(_RingPainter old) =>
      old.progress != progress ||
      old.trackColor != trackColor ||
      old.progressColor != progressColor ||
      old.strokeWidth != strokeWidth;
}

/// A hand-drawn style sparkle used across the brand.
class SparklePainter extends CustomPainter {
  SparklePainter({required this.progress, this.color = AppColors.sunnyYellow});

  /// 0 → 1: sparkle scales up, glows, then fades.
  final double progress;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final appear = Curves.easeOutBack.transform(progress.clamp(0.0, 1.0));
    final fade = progress < 0.7 ? 1.0 : 1.0 - ((progress - 0.7) / 0.3);
    final paint = Paint()
      ..color = color.withValues(alpha: fade.clamp(0.0, 1.0));

    final radius = size.shortestSide * 0.38 * appear;
    final path = Path()
      ..moveTo(center.dx, center.dy - radius)
      ..quadraticBezierTo(
        center.dx + radius * 0.18,
        center.dy - radius * 0.18,
        center.dx + radius,
        center.dy,
      )
      ..quadraticBezierTo(
        center.dx + radius * 0.18,
        center.dy + radius * 0.18,
        center.dx,
        center.dy + radius,
      )
      ..quadraticBezierTo(
        center.dx - radius * 0.18,
        center.dy + radius * 0.18,
        center.dx - radius,
        center.dy,
      )
      ..quadraticBezierTo(
        center.dx - radius * 0.18,
        center.dy - radius * 0.18,
        center.dx,
        center.dy - radius,
      )
      ..close();
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(SparklePainter old) => old.progress != progress;
}

/// Plays a short sparkle burst around [child] when [trigger] flips to true.
/// Respects the system "remove animations" accessibility setting.
class SparkleBurst extends StatefulWidget {
  const SparkleBurst({
    super.key,
    required this.child,
    required this.trigger,
    this.count = 6,
  });

  final Widget child;
  final bool trigger;
  final int count;

  @override
  State<SparkleBurst> createState() => _SparkleBurstState();
}

class _SparkleBurstState extends State<SparkleBurst>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 620),
  );

  @override
  void didUpdateWidget(SparkleBurst oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.trigger && !oldWidget.trigger) {
      final disabled = MediaQuery.disableAnimationsOf(context);
      if (!disabled) {
        _controller.forward(from: 0);
      }
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return Stack(
          alignment: Alignment.center,
          clipBehavior: Clip.none,
          children: [
            child!,
            if (_controller.isAnimating)
              IgnorePointer(
                child: CustomPaint(
                  size: const Size(96, 96),
                  painter: _BurstPainter(
                    progress: _controller.value,
                    count: widget.count,
                  ),
                ),
              ),
          ],
        );
      },
      child: widget.child,
    );
  }
}

class _BurstPainter extends CustomPainter {
  _BurstPainter({required this.progress, required this.count});

  final double progress;
  final int count;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final distance =
        size.shortestSide * 0.42 * Curves.easeOut.transform(progress);
    final fade = 1.0 - progress;
    for (var i = 0; i < count; i++) {
      final angle = (math.pi * 2 * i) / count - math.pi / 2;
      final position =
          center + Offset(math.cos(angle), math.sin(angle)) * distance;
      final painter = SparklePainter(
        progress: 1,
        color: AppColors.sunnyYellow.withValues(alpha: fade.clamp(0.0, 1.0)),
      );
      canvas.save();
      canvas.translate(position.dx - 9, position.dy - 9);
      painter.paint(canvas, const Size(18, 18));
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(_BurstPainter old) => old.progress != progress;
}
