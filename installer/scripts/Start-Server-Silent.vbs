Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
baseDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
nodeExe = baseDir & "\runtime\node.exe"
runner = baseDir & "\scripts\run-server.mjs"
sh.CurrentDirectory = baseDir & "\server"
sh.Run """" & nodeExe & """ --no-warnings """ & runner & """", 0, False
