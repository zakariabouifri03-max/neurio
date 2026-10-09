import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/theme/app_theme.dart';
import '../services/reminder_scheduler.dart';
import '../state/settings_store.dart';
import '../widgets/cute_button.dart';
import '../widgets/cute_card.dart';

/// Honest reminder controls: real permission status, real test notification,
/// and a plain explanation of Android's battery-related limitations.
class NotificationSettingsScreen extends StatefulWidget {
  const NotificationSettingsScreen({super.key});

  @override
  State<NotificationSettingsScreen> createState() =>
      _NotificationSettingsScreenState();
}

class _NotificationSettingsScreenState
    extends State<NotificationSettingsScreen> {
  bool _enabled = false;
  bool _checking = true;
  String? _note;
  late final ReminderScheduler _scheduler;

  @override
  void initState() {
    super.initState();
    _scheduler = context.read<ReminderScheduler>();
    _refresh();
  }

  Future<void> _refresh() async {
    final enabled = await _scheduler.areNotificationsEnabled();
    if (!mounted) return;
    setState(() {
      _enabled = enabled;
      _checking = false;
      if (!enabled) {
        _note = 'Notifications are blocked for Taskly in your device '
            'settings, so reminders can\u2019t arrive. You can enable them in '
            'Settings → Apps → Taskly → Notifications.';
      } else {
        _note = null;
      }
    });
  }

  Future<void> _toggleReminders(bool value) async {
    final settings = context.read<SettingsStore>();
    // `settings` is captured before any await below.
    if (value) {
      final permission = await _scheduler.requestPermission();
      if (permission == ReminderPermission.denied) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Notifications are turned off for Taskly in your '
                'device settings. Reminders will stay paused until you '
                'allow them.'),
          ),
        );
        await _refresh();
        return;
      }
    }
    await settings.setRemindersEnabled(value);
    await _refresh();
  }

  Future<void> _sendTest() async {
    await _scheduler.sendTestNotification();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(_scheduler.lastError == null
            ? 'Test notification sent — check your shade! 🔔'
            : 'Couldn\u2019t send a test notification: '
                '${_scheduler.lastError}'),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final palette = AppTheme.paletteOf(context);
    final theme = Theme.of(context);
    final settings = context.watch<SettingsStore>();

    return Scaffold(
      backgroundColor: palette.cream,
      appBar: AppBar(title: const Text('Notifications')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
          children: <Widget>[
            CuteCard(
              padding: const EdgeInsets.fromLTRB(16, 8, 10, 8),
              child: SwitchListTile.adaptive(
                contentPadding: EdgeInsets.zero,
                value: settings.remindersEnabled,
                onChanged: _toggleReminders,
                title: Text('Task reminders',
                    style: theme.textTheme.titleMedium),
                subtitle: const Text(
                    'Let Taskly send a gentle nudge for tasks with reminders'),
              ),
            ),
            const SizedBox(height: 14),
            CuteCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text('Device permission',
                      style: theme.textTheme.titleLarge),
                  const SizedBox(height: 8),
                  Row(
                    children: <Widget>[
                      Icon(
                        _checking
                            ? Icons.hourglass_bottom_rounded
                            : _enabled
                                ? Icons.check_circle_rounded
                                : Icons.block_rounded,
                        size: 19,
                        color: _checking
                            ? palette.textSecondary
                            : _enabled
                                ? palette.success
                                : palette.danger,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          _checking
                              ? 'Checking…'
                              : _enabled
                                  ? 'Notifications allowed for Taskly'
                                  : 'Notifications blocked for Taskly',
                          style: theme.textTheme.bodyMedium,
                        ),
                      ),
                    ],
                  ),
                  if (_note != null) ...<Widget>[
                    const SizedBox(height: 10),
                    Text(_note!,
                        style: theme.textTheme.bodySmall
                            ?.copyWith(color: palette.textSecondary)),
                  ],
                  const SizedBox(height: 14),
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: CuteButton(
                          label: 'Re-check status',
                          icon: Icons.refresh_rounded,
                          secondary: true,
                          onPressed: _refresh,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: CuteButton(
                          label: 'Send test',
                          icon: Icons.notifications_active_outlined,
                          onPressed: _enabled ? _sendTest : null,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            CuteCard(
              color: palette.babyBlue.withValues(alpha: 0.3),
              border: Colors.transparent,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text('A friendly note about timing',
                      style: theme.textTheme.titleMedium),
                  const SizedBox(height: 8),
                  Text(
                    'Android may delay reminders a little on some devices to '
                    'save battery (Do Not Disturb, battery optimization, '
                    'manufacturer restrictions). Taskly asks for exact alarm '
                    'permission where available and falls back to '
                    'battery-friendly scheduling otherwise, so a reminder may '
                    'arrive a few minutes late on heavily optimized phones.',
                    style: theme.textTheme.bodySmall
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
}
