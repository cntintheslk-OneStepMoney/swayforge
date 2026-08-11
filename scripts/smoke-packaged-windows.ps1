param(
  [switch]$Installer
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$originalAppData = $env:APPDATA
$runId = "swayforge-package-smoke-$PID-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
$appDataRoot = Join-Path $env:RUNNER_TEMP $runId
$expectedUserData = Join-Path $appDataRoot 'SwayForge'
$expectedWorkspace = Join-Path $expectedUserData 'data\workspace.json'

function Start-And-VerifySwayForge([string]$Executable, [string]$Label) {
  if (-not (Test-Path $Executable)) {
    throw "$Label executable does not exist: $Executable"
  }

  $process = Start-Process -FilePath $Executable -ArgumentList '--disable-gpu' -PassThru
  try {
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline -and -not (Test-Path $expectedWorkspace)) {
      if ($process.HasExited) {
        throw "$Label exited before local workspace initialisation (exit code $($process.ExitCode))."
      }
      Start-Sleep -Milliseconds 500
    }

    if (-not (Test-Path $expectedWorkspace)) {
      throw "$Label did not initialise workspace state under Electron userData."
    }
    if ($process.HasExited) {
      throw "$Label exited unexpectedly after initialisation (exit code $($process.ExitCode))."
    }
  }
  finally {
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force
      $process.WaitForExit()
    }
  }
}

try {
  New-Item -ItemType Directory -Path $appDataRoot -Force | Out-Null
  $env:APPDATA = $appDataRoot

  if (-not $Installer) {
    $unpackedExe = Join-Path $dist 'win-unpacked\SwayForge.exe'
    Start-And-VerifySwayForge $unpackedExe 'Unpacked SwayForge'
    Start-And-VerifySwayForge $unpackedExe 'Restarted unpacked SwayForge'

    $leakedWorkspace = Get-ChildItem -Path (Join-Path $dist 'win-unpacked') -Recurse -File -Filter 'workspace.json' -ErrorAction SilentlyContinue
    if ($leakedWorkspace) {
      throw 'Packaged application wrote workspace.json inside its installation/output directory.'
    }

    Write-Output "Unpacked Windows launch/restart smoke passed; mutable workspace is outside the package at $expectedWorkspace"
    exit 0
  }

  $package = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
  $expectedInstallerName = "SwayForge-$($package.version)-win-x64-setup.exe"
  $installerPath = Join-Path $dist $expectedInstallerName
  if (-not (Test-Path $installerPath)) {
    throw "Expected NSIS installer is missing: $expectedInstallerName"
  }

  $installRoot = Join-Path $env:RUNNER_TEMP "swayforge-installed-$PID"
  $installerProcess = Start-Process -FilePath $installerPath -ArgumentList @('/S', "/D=$installRoot") -Wait -PassThru
  if ($installerProcess.ExitCode -ne 0) {
    throw "NSIS installer failed with exit code $($installerProcess.ExitCode)."
  }

  $installedExe = Join-Path $installRoot 'SwayForge.exe'
  Start-And-VerifySwayForge $installedExe 'Installed SwayForge'

  $uninstaller = Get-ChildItem -Path $installRoot -File -Filter 'Uninstall*.exe' | Select-Object -First 1
  if (-not $uninstaller) {
    throw 'NSIS uninstall executable was not created.'
  }

  $uninstallProcess = Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -Wait -PassThru
  if ($uninstallProcess.ExitCode -ne 0) {
    throw "NSIS uninstaller failed with exit code $($uninstallProcess.ExitCode)."
  }

  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline -and (Test-Path $installedExe)) {
    Start-Sleep -Milliseconds 500
  }
  if (Test-Path $installedExe) {
    throw 'Installed SwayForge executable remained after uninstall.'
  }
  if (-not (Test-Path $expectedWorkspace)) {
    throw 'NSIS uninstall removed creator application data; this is forbidden for Issue #12.'
  }

  Write-Output "NSIS install/launch/uninstall smoke passed; application data was preserved at $expectedWorkspace"
}
finally {
  $env:APPDATA = $originalAppData
}
