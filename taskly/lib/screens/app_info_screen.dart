import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../core/theme/app_theme.dart';
import '../widgets/cute_card.dart';

/// App information + the actual privacy policy (matching the real
/// implementation: everything stays on device, no analytics, no ads).
class AppInfoScreen extends StatefulWidget {
  const AppInfoScreen({super.key});

  @override
  State<AppInfoScreen> createState() => _AppInfoScreenState();
}

class _AppInfoScreenState extends State<AppInfoScreen> {
  String _version = '1.0.0';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final info = await PackageInfo.fromPlatform();
      if (!mounted) return;
      setState(() => _version = '${info.version} (${info.buildNumber})');
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    final theme = Theme.of(context);

    return Scaffold(
      backgroundColor: palette.cream,
      appBar: AppBar(title: const Text('About & privacy')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
          children: <Widget>[
            Center(
              child: Column(
                children: <Widget>[
                  Container(
                    width: 84,
                    height: 84,
                    decoration: BoxDecoration(
                      color: const Color(0xFFC4B2FE),
                      borderRadius: BorderRadius.circular(24),
                    ),
                    child: const Icon(Icons.checklist_rounded,
                        size: 44, color: Colors.white),
                  ),
                  const SizedBox(height: 10),
                  Text('Taskly', style: theme.textTheme.headlineSmall),
                  Text('Version $_version',
                      style: theme.textTheme.bodySmall
                          ?.copyWith(color: palette.textSecondary)),
                ],
              ),
            ),
            const SizedBox(height: 18),
            CuteCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text('About Taskly', style: theme.textTheme.titleLarge),
                  const SizedBox(height: 8),
                  Text(
                    'Taskly is a cozy, offline-first planner. Your tasks, '
                    'notes and preferences live in a private database on '
                    'your device. There is no account, no sync server and '
                    'no advertising in this build.',
                    style: theme.textTheme.bodyMedium
                        ?.copyWith(color: palette.textSecondary),
                  ),
                  const SizedBox(height: 14),
                  FilledButton.icon(
                    onPressed: () => showLicensePage(
                      context: context,
                      applicationName: 'Taskly',
                      applicationVersion: _version,
                      applicationLegalese:
                          '© 2026 Taskly. Made with care for calm, colorful days.',
                    ),
                    icon: const Icon(Icons.description_outlined, size: 18),
                    label: const Text('Open-source licenses'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            CuteCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text('Privacy policy', style: theme.textTheme.titleLarge),
                  const SizedBox(height: 4),
                  Text('Last updated: October 2026',
                      style: theme.textTheme.bodySmall
                          ?.copyWith(color: palette.textSecondary)),
                  const SizedBox(height: 10),
                  for (final section in _policySections) ...<Widget>[
                    Text(section.$1, style: theme.textTheme.titleMedium),
                    const SizedBox(height: 6),
                    Text(section.$2,
                        style: theme.textTheme.bodyMedium
                            ?.copyWith(color: palette.textSecondary)),
                    const SizedBox(height: 12),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 14),
            CuteCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text('Third-party software', style: theme.textTheme.titleLarge),
                  const SizedBox(height: 8),
                  Text(
                    'Taskly is built with Flutter and uses these open-source '
                    'libraries: sqflite (SQLite), shared_preferences, '
                    'provider, intl, flutter_local_notifications, timezone, '
                    'package_info_plus. The Nunito typeface is licensed under '
                    'the SIL Open Font License 1.1. Each library processes '
                    'data only on your device; none of them transmit your '
                    'task content anywhere.',
                    style: theme.textTheme.bodyMedium
                        ?.copyWith(color: palette.textSecondary),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  static const List<(String, String)> _policySections = <(String, String)>[
    (
      'What we collect',
      'Nothing leaves your device. Taskly stores your tasks, notes, '
          'reminder choices and app preferences (theme, name, date format) '
          'in local storage on your phone. We do not collect personal data, '
          'we do not run analytics, and we do not show ads.'
    ),
    (
      'Permissions and why we ask',
      'Notifications (POST_NOTIFICATIONS): only to deliver task reminders '
          'you created. Exact alarms (SCHEDULE_EXACT_ALARM): to fire '
          'reminders at the time you chose; if unavailable, Taskly falls '
          'back to battery-friendly scheduling. Boot completed: so '
          'pending reminders survive a device restart. No other '
          'permissions are requested.'
    ),
    (
      'Where your data lives',
      'All data is stored in a SQLite database inside Taskly\u2019s private '
          'app storage, plus a small preferences file. Uninstalling Taskly '
          'removes everything permanently.'
    ),
    (
      'Children\u2019s privacy',
      'Taskly is a general-audience productivity app and does not '
          'knowingly collect data from anyone, including children.'
    ),
    (
      'Changes to this policy',
      'If Taskly\u2019s data practices ever change, this in-app policy and '
          'the Play Store listing will be updated before the change '
          'ships, and new permissions will always be requested explicitly.'
    ),
    (
      'Contact',
      'Questions about privacy? Reach the developer through the contact '
          'email published on the Taskly Play Store listing.'
    ),
  ];
}
