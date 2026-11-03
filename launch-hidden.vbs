Option Explicit
Dim shell, files, root, command, status
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
command = Chr(34) & shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe" & Chr(34) & " -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & root & "\start-hidden.ps1" & Chr(34) & " -Wait"
' Hide before creating PowerShell; wait so Task Scheduler tracks the guardian.
status = shell.Run(command, 0, True)
WScript.Quit status
