import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../controllers/settings_controller.dart';
import '../controllers/task_controller.dart';
import '../core/theme/app_colors.dart';
import 'onboarding_page.dart';
import 'shell.dart';

/// Brand splash: icon + name with a soft entrance, gone as soon as real
/// data is ready (or fails gracefully). No artificial delay.
class SplashPage extends StatefulWidget {
  const SplashPage({super.key});

  @override
  State<SplashPage> createState() => _SplashPageState();
}

class _SplashPageState extends State<SplashPage>
    with SingleTickerProviderStateMixin {
  late final AnimationController _entrance = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 520),
  )..forward();

  bool _navigated = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      // Ensure the first load kicked off even in widget tests that pump once.
      context.read<TaskController>().load();
    });
  }

  void _maybeNavigate() {
    if (_navigated || !mounted) return;
    final controller = context.read<TaskController>();
    if (!controller.loaded && controller.error == null) return;
    _navigated = true;

    final settings = context.read<SettingsController>();
    final destination = settings.onboardingComplete
        ? const MainShell()
        : const OnboardingPage();
    Navigator.of(context).pushReplacement(
      PageRouteBuilder<void>(
        transitionDuration: const Duration(milliseconds: 260),
        pageBuilder: (_, animation, _) => FadeTransition(
          opacity: CurvedAnimation(parent: animation, curve: Curves.easeOut),
          child: destination,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Re-evaluate whenever tasks finish loading.
    context.watch<TaskController>();
    WidgetsBinding.instance.addPostFrameCallback((_) => _maybeNavigate());

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      body: Center(
        child: ScaleTransition(
          scale: CurvedAnimation(parent: _entrance, curve: Curves.easeOutBack),
          child: FadeTransition(
            opacity: _entrance,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 108,
                  height: 108,
                  decoration: BoxDecoration(
                    color: AppColors.lavender,
                    borderRadius: BorderRadius.circular(30),
                  ),
                  child: const Icon(
                    Icons.task_alt_rounded,
                    size: 56,
                    color: AppColors.primaryText,
                  ),
                ),
                const SizedBox(height: 18),
                Text('Taskly', style: Theme.of(context).textTheme.displaySmall),
                const SizedBox(height: 6),
                Text(
                  'Little plans, big smiles',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 34),
                SizedBox(
                  width: 26,
                  height: 26,
                  child: CircularProgressIndicator(
                    strokeWidth: 3,
                    color: AppColors.lavenderDeep,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
