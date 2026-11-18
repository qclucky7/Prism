$ErrorActionPreference = 'Stop'

if (-not $env:VSCMD_VER) {
    $vswherePath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
    if (-not (Test-Path -LiteralPath $vswherePath)) {
        throw 'Install the Visual Studio C++ desktop build tools before building Prism.'
    }
    $installation = & $vswherePath -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (-not $installation) {
        throw 'Visual Studio C++ desktop build tools were not found.'
    }
    $modulePath = Join-Path $installation 'Common7/Tools/Microsoft.VisualStudio.DevShell.dll'
    Import-Module $modulePath
    $architecture = if ([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -eq 'Arm64') { 'arm64' } else { 'x64' }
    Enter-VsDevShell -VsInstallPath $installation -SkipAutomaticLocation -DevCmdArguments "-arch=$architecture"
}

& cargo @args
exit $LASTEXITCODE
