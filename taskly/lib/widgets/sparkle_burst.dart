import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../core/utils/motion.dart';

/// A tiny, short sparkle burst used to celebrate completing a task.
/// Honors the system "reduce motion" setting by finishing instantly.
class SparkleBurst extends StatefulWidget {
  const SparkleBurst({super.key, this.size = 44, this.onFinished});

  final double size;
  final VoidCallback? onFinished;

  @override
  State<SparkleBurst> createState() => _SparkleBurstState();
}

class _SparkleBurstState extends State<SparkleBurst>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    final reduced = AppMotion.reducedMotion(context);
    _controller = AnimationController(
      vsync: this,
      duration: reduced ? Duration.zero : const Duration(milliseconds: 520),
    )..forward().then((_) => widget.onFinished?.call());
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: SizedBox(
        width: widget.size,
        height: widget.size,
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, _) => CustomPaint(
            painter: _SparklePainter(_controller.value),
          ),
        ),
      ),
    );
  }
}

class _SparklePainter extends CustomPainter {
  _SparklePainter(this.t);

  final double t;

  static const List<Color> _colors = <Color>[
    Color(0xFFC9B8FF),
    Color(0xFFFFD6E7),
    Color(0xFFCDEBFF),
    Color(0xFFCFF5DF),
    Color(0xFFF6C86B),
    Color(0xFFC9B8FF),
  ];

  @override
  void paint(Canvas canvas, Size size) {
    if (t >= 1) return;
    final center = size.center(Offset.zero);
    final maxRadius = size.shortestSide / 2;
    final paint = Paint()..style = PaintingStyle.fill;
    for (var i = 0; i < _colors.length; i++) {
      final angle = (i / _colors.length) * 2 * math.pi + 0.4;
      final distance = maxRadius * (0.25 + 0.75 * t);
      final offset = Offset(
        center.dx + math.cos(angle) * distance,
        center.dy + math.sin(angle) * distance,
      );
      final sparkleSize = 3.2 * (1 - t) + 0.6;
      paint.color = _colors[i].withValues(alpha: (1 - t).clamp(0.0, 1.0));
      canvas.drawCircle(offset, sparkleSize, paint);
    }
  }

  @override
  bool shouldRepaint(_SparklePainter oldDelegate) => oldDelegate.t != t;
}
