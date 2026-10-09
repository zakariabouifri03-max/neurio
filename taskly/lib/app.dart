import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'core/theme/app_theme.dart';
import 'core/utils/motion.dart';
import 'screens/home_shell.dart';
import 'screens/onboarding_screen.dart';
import 'screens/splash_screen.dart';
import 'state/settings_store.dart';
import 'state/tasks_store.dart';

/// Root widget: theme, providers and the splash → onboarding → shell gate.
class TasklyApp extends StatelessWidget {
  const TasklyApp({super.key});

  /// Overridable so tests (and reduced-motion users) can skip the splash
  /// wait entirely.
  static Duration splashDuration = const Duration(milliseconds: 950);

  @override
  Widget build(BuildContext context) {
    final settings = context.watch<SettingsStore>();
    return MaterialApp(
      title: 'Taskly',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: settings.themeMode,
      home: const _RootGate(),
      builder: (context, child) {
        // Respect user font-size settings, capped so layouts stay usable.
        final scaler = MediaQuery.of(context).textScaler;
        return MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: scaler.clamp(maxScaleFactor: 1.35),
          ),
          child: child ?? const SizedBox.shrink(),
        );
      },
    );
  }
}

/// Shows the splash briefly, then routes to onboarding or the main shell.
class _RootGate extends StatefulWidget {
  const _RootGate();

  @override
  State<_RootGate> createState() => _RootGateState();
}

class _RootGateState extends State<_RootGate> {
  bool _splashDone = false;

  @override
  void initState() {
    super.initState();
    final reduced = AppMotion.reducedMotion(context);
    final wait = reduced ? Duration.zero : TasklyApp.splashDuration;
    Future<void>.delayed(wait, () {
      if (mounted) setState(() => _splashDone = true);
    });
    // Load tasks right after the first frame so no listener is
    // notified while the tree is still building.
    final store = context.read<TasksStore>();
    WidgetsBinding.instance.addPostFrameCallback((_) => store.load());
  }

  @override
  Widget build(BuildContext context) {
    final onboarded = context.watch<SettingsStore>().onboardingCompleted;
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 320),
      switchInCurve: Curves.easeOut,
      switchOutCurve: Curves.easeIn,
      child: !_splashDone
          ? const SplashScreen(key: ValueKey('splash'))
          : onboarded
              ? const HomeShell(key: ValueKey('shell'))
              : const OnboardingScreen(key: ValueKey('onboarding')),
    );
  }
}
