import 'package:flutter/material.dart';

import '../core/theme/app_colors.dart';

/// The privacy policy, exactly as published (see docs/PRIVACY_POLICY.md).
/// Kept as a first-class page so the in-app copy can never drift from the
/// store listing.
class PrivacyPolicyPage extends StatelessWidget {
  const PrivacyPolicyPage({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Privacy policy')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
          children: [
            Text('Taskly privacy policy', style: theme.textTheme.headlineSmall),
            const SizedBox(height: 4),
            Text(
              'Last updated: October 9, 2026',
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: 16),
            const _P(
              'Taskly is built to be private by default. Your tasks, notes, '
              'reminders and preferences are stored locally on your device '
              'and are never transmitted to Taskly servers, because Taskly '
              'does not operate any servers.',
            ),
            _H('What data Taskly stores'),
            const _P(
              'Tasks, descriptions, due dates, times, priorities, categories '
              'and reminder settings are saved in an app-private database on '
              'your device. Your display name (if you choose to add one), '
              'theme and formatting preferences are saved in app-private '
              'preferences on your device. Uninstalling the app deletes all '
              'of this data.',
            ),
            _H('Permissions Taskly asks for'),
            const _Bullets([
              'Notifications — requested only when you set your first task '
              'reminder, so Taskly can show it at the right time.',
              'Exact alarms — an optional Android permission you may grant so '
              'reminders are not delayed by a few minutes. Taskly works '
              'without it.',
            ]),
            _H('What Taskly never does'),
            const _Bullets([
              'No account or sign-up required.',
              'No analytics or tracking SDKs.',
              'No advertising SDKs.',
              'No task content ever leaves your device.',
              'No collection of personal, financial or sensitive data.',
            ]),
            _H('Third-party software'),
            const _P(
              'Taskly uses open-source libraries (listed under Settings → '
              'Open-source licenses) to provide local storage and local '
              'notifications. These libraries run on your device and do not '
              'send your data anywhere.',
            ),
            _H('Children'),
            const _P(
              'Taskly does not knowingly collect any personal information '
              'from anyone, including children under 13, because no data '
              'ever leaves the device.',
            ),
            _H('Changes'),
            const _P(
              'If this policy changes, the updated version will appear here '
              'and in the app store listing before the related update ships.',
            ),
            _H('Contact'),
            const _P(
              'Questions about privacy? Reach the developer through the '
              'email listed on the Google Play store listing.',
            ),
          ],
        ),
      ),
    );
  }
}

class _H extends StatelessWidget {
  const _H(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 18, bottom: 6),
    child: Text(text, style: Theme.of(context).textTheme.titleMedium),
  );
}

class _P extends StatelessWidget {
  const _P(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Text(
    text,
    style: Theme.of(context).textTheme.bodyMedium?.copyWith(height: 1.55),
  );
}

class _Bullets extends StatelessWidget {
  const _Bullets(this.items);

  final List<String> items;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      for (final item in items)
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.only(top: 3, right: 8),
                child: Icon(
                  Icons.circle,
                  size: 6,
                  color: AppColors.lavenderDeep,
                ),
              ),
              Expanded(
                child: Text(
                  item,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    height: 1.5,
                  ),
                ),
              ),
            ],
          ),
        ),
    ],
  );
}
