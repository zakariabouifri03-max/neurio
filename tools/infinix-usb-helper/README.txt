USB Connection Helper (Windows 10/11)
====================================
This is a portable Windows diagnostic helper, NOT a photo recovery program,
NOT a firmware repair tool, and NOT an executable (.exe).
It cannot make internal phone storage behave like a USB stick while the
phone is dead. It cannot fix a broken battery, USB port, screen or board.

HOW TO RUN
1. Extract the entire ZIP into a folder (do not run inside the ZIP).
2. Double-click Start.cmd. Windows PowerShell 5.1 is required (built in on
   normal Windows 10/11 installations).
3. Read the report. Check once with the phone unplugged, then again plugged
   in, to identify which entry belongs to the phone.
4. Optionally choose Windows hardware rescan. It requests administrator
   approval and runs only: pnputil.exe /scan-devices
   This operation needs Windows 10 version 2004 or newer. It asks Windows
   to rediscover hardware, not repair the phone. If unavailable, use
   Device Manager > Action > Scan for hardware changes.
5. Save report saves a text file wherever you choose. You may share it for
   diagnosis after checking its contents.

PRIVACY AND SAFETY
No internet requests, downloads, telemetry, driver installs/removals,
firmware commands, storage writes to the phone, or registry edits.
The report lists relevant currently connected PC devices; these are NOT
necessarily phones. Full USB instance IDs / serial numbers are not saved.
The launcher uses ExecutionPolicy Bypass only for this PowerShell process;
it does not change the computer's persistent execution policy. You can read
all the source in USB-Helper.ps1 before running it. Do not disable antivirus
or computer security policy if execution is blocked.
Normal checking does not request administrator privileges. The optional
hardware rescan requires explicit confirmation and Windows UAC approval.

WHAT RESULTS DO NOT MEAN
Device Descriptor Request Failed: Windows cannot identify a connected USB
device. It does not prove the phone's photos are erased. Check a known-good
data cable and another direct port / PC before paying for software.
ADB / MediaTek / Preloader detection: an interface may exist, but this does
not establish access to user data or guarantee recovery.
A successful hardware rescan does not mean the phone is repaired.

YOUR INFINIX X559C
With the screen removed and no known signs of life, have a technician test
a compatible temporary screen, battery, USB port and the ORIGINAL board.
Do not charge a swollen/hot/liquid-damaged battery. Do not bridge contacts
or connect exposed wires. Keep the original board and memory.
Ask for data-preserving diagnosis: no format, factory reset, flashing,
bootloader unlocking, or replacement of the original board without consent.
Specialist recovery depends on storage health and encryption, not just age.
Check old Google Photos backups and removable microSD storage first.
Never accept a format prompt for a card containing wanted photos.

LIMITATIONS / TESTING
Created on Linux. The archive and source were checked here, but Windows
PowerShell, the graphical UI, hardware detection and UAC rescan have NOT
been run on a Windows machine. No successful repair or recovery is claimed.

B DARIJA (Latin letters)
Hadi outil dyal diagnostic USB, machi logiciel kayrjja3 tsawar mn telephone
mayet. Extract ZIP kamel, 7ell Start.cmd, klik Check connection.
Save report bach tsift natija. Windows hardware rescan ghir kay3awed
lba7t 3la hardware; ma kayformatich telephone, w ma kaydamanch ytsla7.
Ila ba9i nafs l'erreur b cable akhor, khasso technicien ychouf l'appareil.
Ma dir la format la flash, w 7afed 3la carte mere l'asliya.
