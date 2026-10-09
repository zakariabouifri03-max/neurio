import 'package:flutter/material.dart';

import '../core/theme/app_theme.dart';
import '../state/settings_store.dart';
import '../widgets/cute_button.dart';
import '../widgets/illustrations.dart';
import 'package:provider/provider.dart';

class _OnboardingPage {
  const _OnboardingPage({
    required this.title,
    required this.message,
    required this.illustration,
  });

  final String title;
  final String message;
  final Widget illustration;
}

/// Short, skippable onboarding. No account, no friction.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final PageController _controller = PageController();
  int _page = 0;

  static final List<_OnboardingPage> _pages = <_OnboardingPage>[
    _OnboardingPage(
      title: 'Everything in one cozy place',
      message:
          'Capture tasks the moment they pop into your head — personal, work, study or that grocery run.',
      illustration: _Illustration.planner,
    ),
    _OnboardingPage(
      title: 'Priorities & gentle reminders',
      message:
          'Set a priority, pick a due date and let a soft nudge find you at the right moment.',
      illustration: _Illustration.reminder,
    ),
    _OnboardingPage(
      title: 'Celebrate every little win',
      message:
          'Watch your progress grow day by day. Small steps really do add up.',
      illustration: _Illustration.progress,
    ),
  ];

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _finish() async {
    await context.read<SettingsStore>().completeOnboarding();
  }

  void _next() {
    if (_page == _pages.length - 1) {
      _finish();
      return;
    }
    _controller.nextPage(
        duration: const Duration(milliseconds: 320), curve: Curves.easeOutCubic);
  }

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    final isLast = _page == _pages.length - 1;
    return Scaffold(
      backgroundColor: palette.cream,
      body: SafeArea(
        child: Column(
          children: <Widget>[
            Align(
              alignment: Alignment.centerRight,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                child: TextButton(
                  onPressed: _finish,
                  child: Text('Skip',
                      style: Theme.of(context)
                          .textTheme
                          .labelLarge
                          ?.copyWith(color: palette.textSecondary)),
                ),
              ),
            ),
            Expanded(
              child: PageView.builder(
                controller: _controller,
                itemCount: _pages.length,
                onPageChanged: (i) => setState(() => _page = i),
                itemBuilder: (context, index) {
                  final page = _pages[index];
                  return Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 32),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: <Widget>[
                        page.illustration,
                        const SizedBox(height: 30),
                        Text(page.title,
                            textAlign: TextAlign.center,
                            style:
                                Theme.of(context).textTheme.headlineMedium),
                        const SizedBox(height: 12),
                        Text(
                          page.message,
                          textAlign: TextAlign.center,
                          style: Theme.of(context)
                              .textTheme
                              .bodyLarge
                              ?.copyWith(color: palette.textSecondary),
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: <Widget>[
                for (var i = 0; i < _pages.length; i++)
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 220),
                    margin: const EdgeInsets.symmetric(horizontal: 4),
                    width: i == _page ? 22 : 8,
                    height: 8,
                    decoration: BoxDecoration(
                      color: i == _page
                          ? Theme.of(context).colorScheme.primary
                          : palette.border,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 22, 24, 24),
              child: CuteButton(
                label: isLast ? 'Get started' : 'Continue',
                icon: isLast
                    ? Icons.favorite_rounded
                    : Icons.arrow_forward_rounded,
                onPressed: _next,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Illustration {
  const _Illustration._();

  static Widget get planner => Illustrations.planner(size: 190);
  static Widget get reminder => Illustrations.reminder(size: 190);
  static Widget get progress => Illustrations.progress(size: 190);
}
