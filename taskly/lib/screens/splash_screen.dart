import 'package:flutter/material.dart';

import '../core/theme/app_theme.dart';
import '../core/utils/motion.dart';

/// Fast, warm entrance: icon scales in, name fades up. No artificial delay —
/// the gate switches as soon as the animation finishes (~0.9s).
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    return Scaffold(
      backgroundColor: palette.cream,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            _SplashLogo(),
            const SizedBox(height: 18),
            Text(
              'Taskly',
              style: Theme.of(context)
                  .textTheme
                  .displaySmall
                  ?.copyWith(color: palette.textPrimary),
            ),
            const SizedBox(height: 6),
            Text(
              'your cozy little planner',
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: palette.textSecondary),
            ),
          ],
        ),
      ),
    );
  }
}

class _SplashLogo extends StatefulWidget {
  @override
  State<_SplashLogo> createState() => _SplashLogoState();
}

class _SplashLogoState extends State<_SplashLogo>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: AppMotion.reducedMotion(context)
          ? Duration.zero
          : const Duration(milliseconds: 620),
    )..forward();
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
        final curved = Curves.easeOutBack.transform(_controller.value);
        return Transform.scale(scale: 0.6 + 0.4 * curved, child: child);
      },
      child: Container(
        width: 108,
        height: 108,
        decoration: BoxDecoration(
          color: const Color(0xFFC4B2FE),
          borderRadius: BorderRadius.circular(30),
          boxShadow: <BoxShadow>[
            BoxShadow(
              color: const Color(0xFFC4B2FE).withValues(alpha: 0.45),
              blurRadius: 30,
              offset: const Offset(0, 12),
            ),
          ],
        ),
        child: const Icon(Icons.checklist_rounded, size: 56, color: Colors.white),
      ),
    );
  }
}
