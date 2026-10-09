import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../controllers/settings_controller.dart';
import '../core/theme/app_colors.dart';
import '../core/widgets/common.dart';
import 'shell.dart';

/// Short, skippable onboarding: three pastel panels explaining the app.
/// No account, no permissions requested here.
class OnboardingPage extends StatefulWidget {
  const OnboardingPage({super.key});

  static const int pageCount = 3;

  @override
  State<OnboardingPage> createState() => _OnboardingPageState();
}

class _OnboardingPageState extends State<OnboardingPage> {
  final PageController _pageController = PageController();
  int _page = 0;

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  Future<void> _finish() async {
    await context.read<SettingsController>().completeOnboarding();
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      PageRouteBuilder<void>(
        transitionDuration: const Duration(milliseconds: 260),
        pageBuilder: (_, animation, _) => FadeTransition(
          opacity: CurvedAnimation(parent: animation, curve: Curves.easeOut),
          child: const MainShell(),
        ),
      ),
    );
  }

  Future<void> _next() async {
    if (_page < OnboardingPage.pageCount - 1) {
      await _pageController.nextPage(
        duration: const Duration(milliseconds: 260),
        curve: Curves.easeOutCubic,
      );
    } else {
      await _finish();
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isLast = _page == OnboardingPage.pageCount - 1;

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Align(
              alignment: Alignment.topRight,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                child: TextButton(
                  onPressed: _finish,
                  child: const Text('Skip'),
                ),
              ),
            ),
            Expanded(
              child: PageView(
                controller: _pageController,
                onPageChanged: (i) => setState(() => _page = i),
                children: const [
                  _Panel(
                    color: AppColors.lavender,
                    icon: Icons.checklist_rounded,
                    title: 'Organize your day',
                    message:
                        'Keep personal, work, study and everyday tasks in one '
                        'cozy little place.',
                  ),
                  _Panel(
                    color: AppColors.pastelPink,
                    icon: Icons.alarm_rounded,
                    title: 'Priorities & reminders',
                    message:
                        'Mark what matters most and let Taskly nudge you at '
                        'the right moment.',
                  ),
                  _Panel(
                    color: AppColors.mintGreen,
                    icon: Icons.emoji_events_outlined,
                    title: 'Celebrate small wins',
                    message:
                        'Watch your progress grow, one satisfying checkmark '
                        'at a time.',
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(24),
              child: Row(
                children: [
                  Row(
                    children: List.generate(
                      OnboardingPage.pageCount,
                      (i) => AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        margin: const EdgeInsets.only(right: 6),
                        width: i == _page ? 22 : 8,
                        height: 8,
                        decoration: BoxDecoration(
                          color: i == _page
                              ? AppColors.lavenderDeep
                              : theme.colorScheme.outline,
                          borderRadius: BorderRadius.circular(4),
                        ),
                      ),
                    ),
                  ),
                  const Spacer(),
                  FilledButton(
                    onPressed: _next,
                    child: Text(isLast ? 'Get Started' : 'Continue'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({
    required this.color,
    required this.icon,
    required this.title,
    required this.message,
  });

  final Color color;
  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dark = theme.brightness == Brightness.dark;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Stack(
            alignment: Alignment.center,
            children: [
              PastelBlob(
                icon: icon,
                color: dark ? color.withValues(alpha: 0.2) : color,
                size: 168,
                iconSize: 72,
              ),
              Positioned(
                top: 4,
                right: 10,
                child: Icon(
                  Icons.star_rounded,
                  size: 26,
                  color: AppColors.sunnyYellow,
                ),
              ),
              Positioned(
                bottom: 10,
                left: 6,
                child: Icon(
                  Icons.auto_awesome,
                  size: 20,
                  color: AppColors.lavenderDeep.withValues(alpha: 0.7),
                ),
              ),
            ],
          ),
          const SizedBox(height: 36),
          Text(
            title,
            textAlign: TextAlign.center,
            style: theme.textTheme.headlineMedium,
          ),
          const SizedBox(height: 12),
          Text(
            message,
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyLarge?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}
