# Windows PowerShell 5.1. No downloads, flashing, formatting or driver removal.
# Phone storage is never opened or modified by this script.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = 'USB Connection Helper - diagnosis, not photo recovery'
$form.ClientSize = New-Object System.Drawing.Size(820, 610)
$form.StartPosition = 'CenterScreen'
$form.MinimumSize = $form.Size

$notice = New-Object System.Windows.Forms.Label
$notice.Location = New-Object System.Drawing.Point(16, 12)
$notice.Size = New-Object System.Drawing.Size(785, 85)
$notice.Text = "This tool checks Windows USB detection only. It cannot repair a dead phone or recover photos.`r`nIt does NOT flash, format, unlock, install drivers, or write to phone storage.`r`nIf the battery is swollen, the phone is hot, or liquid damage is suspected: unplug it.`r`nAn exposed/disassembled phone should be checked by a repair technician."
$form.Controls.Add($notice)

$scan = New-Object System.Windows.Forms.Button
$scan.Text = '1. Check connection'
$scan.Location = New-Object System.Drawing.Point(16, 104)
$scan.Size = New-Object System.Drawing.Size(185, 34)
$form.Controls.Add($scan)

$rescan = New-Object System.Windows.Forms.Button
$rescan.Text = '2. Windows hardware rescan'
$rescan.Location = New-Object System.Drawing.Point(210, 104)
$rescan.Size = New-Object System.Drawing.Size(225, 34)
$form.Controls.Add($rescan)

$save = New-Object System.Windows.Forms.Button
$save.Text = 'Save report...'
$save.Location = New-Object System.Drawing.Point(444, 104)
$save.Size = New-Object System.Drawing.Size(150, 34)
$form.Controls.Add($save)

$manager = New-Object System.Windows.Forms.Button
$manager.Text = 'Device Manager'
$manager.Location = New-Object System.Drawing.Point(603, 104)
$manager.Size = New-Object System.Drawing.Size(190, 34)
$form.Controls.Add($manager)

$output = New-Object System.Windows.Forms.TextBox
$output.Location = New-Object System.Drawing.Point(16, 150)
$output.Size = New-Object System.Drawing.Size(777, 440)
$output.Multiline = $true
$output.ReadOnly = $true
$output.ScrollBars = 'Both'
$output.WordWrap = $false
$output.Font = New-Object System.Drawing.Font('Consolas', 10)
$output.Anchor = 'Top, Bottom, Left, Right'
$form.Controls.Add($output)

function Show-UsbReport {
    $scan.Enabled = $false
    $form.UseWaitCursor = $true
    try {
        $lines = New-Object 'System.Collections.Generic.List[string]'
        $lines.Add('USB CONNECTION REPORT - ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
        $lines.Add('Only devices currently reported present by Windows are listed.')
        $lines.Add('These may include PC hardware, not just the phone.')
        $lines.Add('Unplug the phone, check; reconnect, check again; compare the lists.')
        $lines.Add('')
        $devices = @(Get-PnpDevice -PresentOnly -ErrorAction Stop | Where-Object {
            $_.InstanceId -like 'USB\*' -or
            $_.Class -in @('WPD', 'AndroidUsbDeviceClass') -or
            $_.FriendlyName -match 'ADB|MediaTek|Preloader|Infinix'
        } | Sort-Object Class, FriendlyName)
        $descriptorFailure = $false
        $possiblePhoneInterface = $false
        foreach ($device in $devices) {
            $name = [string]$device.FriendlyName
            if ([string]::IsNullOrWhiteSpace($name)) { $name = '(unnamed device)' }
            $lines.Add(('[{0}] {1} | Class: {2}' -f $device.Status, $name, $device.Class))
            # Only VID/PID is shown, never the full instance ID or device serial number.
            $match = [regex]::Match([string]$device.InstanceId, 'VID_[0-9A-F]{4}&PID_[0-9A-F]{4}', 'IgnoreCase')
            if ($match.Success) { $lines.Add('  USB identifier: ' + $match.Value) }
            try {
                $problem = Get-PnpDeviceProperty -InstanceId $device.InstanceId -KeyName 'DEVPKEY_Device_ProblemCode' -ErrorAction Stop
                if ($null -ne $problem.Data -and [int]$problem.Data -ne 0) {
                    $lines.Add('  Windows problem code: ' + [string]$problem.Data)
                }
            } catch { $lines.Add('  Windows problem code unavailable.') }
            if ($name -match 'Device Descriptor Request Failed' -or
                $device.InstanceId -match 'VID_0000&PID_0002|DEVICE_DESCRIPTOR_FAILURE') {
                $descriptorFailure = $true
            }
            if ($name -match 'ADB|MediaTek|Preloader|Infinix') { $possiblePhoneInterface = $true }
        }
        if ($devices.Count -eq 0) { $lines.Add('No matching present devices found.') }
        $lines.Add('')
        $lines.Add('WHAT THIS MEANS')
        if ($descriptorFailure) {
            $lines.Add('- A USB descriptor failure is present. This does NOT prove photos are lost.')
            $lines.Add('- Confirm that this entry disappears when you unplug the phone.')
            $lines.Add('- Try a known-good DATA cable and another direct USB port / another PC.')
            $lines.Add('- A Windows hardware rescan may help a temporary detection issue only.')
            $lines.Add('- If unchanged, have the original phone board, battery and USB port checked.')
        }
        if ($possiblePhoneInterface) {
            $lines.Add('- A possible Android/MediaTek interface is listed; it may be another device.')
            $lines.Add('- This does NOT establish access to photos, ADB authorization, or recovery.')
            $lines.Add('- Do not flash firmware, format storage, or unlock the bootloader.')
        }
        if (-not $descriptorFailure -and -not $possiblePhoneInterface) {
            $lines.Add('- No recognized Android/MediaTek interface was identified by name.')
            $lines.Add('- This is not proof of a dead board; compare unplugged/plugged lists.')
            $lines.Add('- A device named MTP/WPD also does not guarantee accessible files.')
        }
        $lines.Add('')
        $lines.Add('PHOTO RECOVERY')
        $lines.Add('- Check an existing Google Photos backup or a removable microSD card first.')
        $lines.Add('- Never accept a prompt to format a card containing wanted photos.')
        $lines.Add('- Internal files usually require a working, unlocked phone and File Transfer.')
        $lines.Add('- With no screen, a technician can test a compatible temporary screen/battery.')
        $lines.Add('- Preserve the ORIGINAL board. No factory reset, flash or board replacement.')
        $lines.Add('- Specialist recovery depends on memory health and encryption; no guarantee.')
        $output.Text = $lines -join "`r`n"
    } catch {
        $output.Text = "Windows device query failed:`r`n" + $_.Exception.Message + "`r`n`r`nOpen Device Manager instead. No phone data was changed."
    } finally {
        $scan.Enabled = $true
        $form.UseWaitCursor = $false
    }
}

$scan.Add_Click({ Show-UsbReport })
$manager.Add_Click({
    try { Start-Process -FilePath 'mmc.exe' -ArgumentList 'devmgmt.msc' -ErrorAction Stop }
    catch { [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Cannot open Device Manager') }
})
$rescan.Add_Click({
    $answer = [System.Windows.Forms.MessageBox]::Show(
        "Ask Windows to rescan ALL hardware? This requires administrator approval.`r`nIt does not flash or format the phone and cannot fix physical damage.`r`nRequires Windows 10 version 2004 or newer. Other connected hardware may also be detected.",
        'Confirm Windows hardware rescan',
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Question)
    if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { return }
    $rescan.Enabled = $false
    $form.UseWaitCursor = $true
    try {
        $process = Start-Process -FilePath "$env:SystemRoot\System32\pnputil.exe" -ArgumentList '/scan-devices' -Verb RunAs -PassThru -Wait -ErrorAction Stop
        if ($process.ExitCode -eq 0) {
            [void][System.Windows.Forms.MessageBox]::Show('Windows completed its hardware rescan. This does NOT mean the phone is repaired. Click Check connection to compare.', 'Rescan completed')
        } else {
            [void][System.Windows.Forms.MessageBox]::Show(('Rescan did not report success. Exit code: {0}. Use Device Manager > Action > Scan for hardware changes instead.' -f $process.ExitCode), 'Rescan result')
        }
    } catch {
        [void][System.Windows.Forms.MessageBox]::Show(('Rescan cancelled or unavailable. No recovery was performed.' + "`r`n" + $_.Exception.Message), 'Rescan not completed')
    } finally {
        $rescan.Enabled = $true
        $form.UseWaitCursor = $false
    }
})
$save.Add_Click({
    $dialog = New-Object System.Windows.Forms.SaveFileDialog
    $dialog.Filter = 'Text report (*.txt)|*.txt'
    $dialog.FileName = 'USB-report.txt'
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        try { [System.IO.File]::WriteAllText($dialog.FileName, $output.Text, [System.Text.Encoding]::UTF8) }
        catch { [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Could not save report') }
    }
    $dialog.Dispose()
})
$form.Add_Shown({ Show-UsbReport })
[void]$form.ShowDialog()
$form.Dispose()
