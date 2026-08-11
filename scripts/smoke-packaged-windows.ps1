param(
  [switch]$Installer
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$appDataRoot = $env:APPDATA

if (-not $appDataRoot -or -not (Test-Path $appDataRoot)) {
  throw 'Windows APPDATA is unavailable; packaged persistence cannot be verified safely.'
}

function Find-SwayForgeWorkspace {
  $matches = @(
    Get-ChildItem -Path $appDataRoot -Directory -ErrorAction SilentlyContinue |
      ForEach-Object {
        $candidate = Join-Path $_.FullName 'data\workspace.json'
        if (Test-Path $candidate) { Get-Item $candidate }
      }
  )
  if ($matches.Count -gt 1) {
    $paths = ($matches | ForEach-Object { $_.FullName }) -join ', '
    throw "Packaged verification found more than one app-level data/workspace.json beneath APPDATA: $paths"
  }
  if ($matches.Count -eq 1) {
    return $matches[0].FullName
  }
  return $null
}

function Start-And-VerifySwayForge([string]$Executable, [string]$Label) {
  if (-not (Test-Path $Executable)) {
    throw "$Label executable does not exist: $Executable"
  }

  $process = Start-Process -FilePath $Executable -ArgumentList '--disable-gpu' -PassThru
  $workspacePath = $null
  try {
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
      if ($process.HasExited) {
        throw "$Label exited before local workspace initialisation (exit code $($process.ExitCode))."
      }
      $workspacePath = Find-SwayForgeWorkspace
      if ($workspacePath) { break }
      Start-Sleep -Milliseconds 500
    }

    if (-not $workspacePath) {
      throw "$Label remained open but did not initialise app-level data/workspace.json beneath Windows APPDATA."
    }

    Start-Sleep -Seconds 2
    if ($process.HasExited) {
      throw "$Label exited unexpectedly after local workspace initialisation (exit code $($process.ExitCode))."
    }
    return $workspacePath
  }
  finally {
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force
      $process.WaitForExit()
    }
  }
}

try {
  if (-not $Installer) {
    $unpackedExe = Join-Path $dist 'win-unpacked\SwayForge.exe'
    $workspacePath = Start-And-VerifySwayForge $unpackedExe 'Unpacked SwayForge'
    $restartWorkspacePath = Start-And-VerifySwayForge $unpackedExe 'Restarted unpacked SwayForge'
    if ($restartWorkspacePath -ne $workspacePath) {
      throw "SwayForge restart used a different workspace path: $restartWorkspacePath"
    }

    $leakedWorkspace = Get-ChildItem -Path (Join-Path $dist 'win-unpacked') -Recurse -File -Filter 'workspace.json' -ErrorAction SilentlyContinue
    if ($leakedWorkspace) {
      throw 'Packaged application wrote workspace.json inside its installation/output directory.'
    }

    Write-Output "Unpacked Windows launch/restart smoke passed; mutable workspace is outside the package at $workspacePath"
  }
  else {
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
    $workspacePath = Start-And-VerifySwayForge $installedExe 'Installed SwayForge'

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
    if (-not (Test-Path $workspacePath)) {
      throw 'NSIS uninstall removed creator application data; this is forbidden for Issue #12.'
    }

    Write-Output "NSIS install/launch/uninstall smoke passed; application data was preserved at $workspacePath"
  }
}
catch {
  $message = $_.Exception.Message.Replace('%', '%25').Replace("`r", '%0D').Replace("`n", '%0A')
  Write-Output "::error file=scripts/smoke-packaged-windows.ps1,title=Windows packaged smoke failed::$message"
  throw
}
