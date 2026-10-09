import 'package:flutter/material.dart';

import 'calendar_page.dart';
import 'home_page.dart';
import 'profile_page.dart';
import 'tasks_page.dart';

/// Lets pages inside the shell switch tabs (Home quick actions etc.).
class ShellTabScope extends InheritedWidget {
  const ShellTabScope({
    super.key,
    required this.index,
    required this.goTo,
    required super.child,
  });

  final int index;
  final ValueChanged<int> goTo;

  static ShellTabScope? of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<ShellTabScope>();

  @override
  bool updateShouldNotify(ShellTabScope oldWidget) => oldWidget.index != index;
}

/// Bottom-navigation shell: Home · My Tasks · Calendar · Profile.
/// Statistics live behind Home's quick actions to keep the bar uncluttered.
class MainShell extends StatefulWidget {
  const MainShell({super.key});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _index = 0;

  void _goTo(int index) => setState(() => _index = index);

  @override
  Widget build(BuildContext context) {
    return ShellTabScope(
      index: _index,
      goTo: _goTo,
      child: Scaffold(
        body: IndexedStack(
          index: _index,
          children: const [
            HomePage(),
            TasksPage(),
            CalendarPage(),
            ProfilePage(),
          ],
        ),
        bottomNavigationBar: NavigationBar(
          selectedIndex: _index,
          onDestinationSelected: _goTo,
          destinations: const [
            NavigationDestination(
              icon: Icon(Icons.home_outlined),
              selectedIcon: Icon(Icons.home_rounded),
              label: 'Home',
              tooltip: 'Home',
            ),
            NavigationDestination(
              icon: Icon(Icons.checklist_outlined),
              selectedIcon: Icon(Icons.checklist_rounded),
              label: 'My Tasks',
              tooltip: 'My Tasks',
            ),
            NavigationDestination(
              icon: Icon(Icons.calendar_month_outlined),
              selectedIcon: Icon(Icons.calendar_month_rounded),
              label: 'Calendar',
              tooltip: 'Calendar',
            ),
            NavigationDestination(
              icon: Icon(Icons.person_outline_rounded),
              selectedIcon: Icon(Icons.person_rounded),
              label: 'Profile',
              tooltip: 'Profile',
            ),
          ],
        ),
      ),
    );
  }
}
