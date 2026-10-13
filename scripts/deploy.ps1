[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9.-]+$')]
    [string]$Server,

    [Parameter(Mandatory = $true)]
    [string]$IdentityFile,

    [ValidatePattern('^[a-z_][a-z0-9_-]*$')]
    [string]$RemoteUser = 'ubuntu',

    [ValidateRange(1, 65535)]
    [int]$SshPort = 22,

    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')]
    [string]$Revision,

    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$identityPath = (Resolve-Path -LiteralPath $IdentityFile).Path
if (-not (Test-Path -LiteralPath $identityPath -PathType Leaf)) {
    throw 'SSH identity must be a local file.'
}
$repositoryPrefix = [IO.Path]::GetFullPath($repositoryRoot).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
if ($identityPath.StartsWith($repositoryPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'SSH identity files must be stored outside the repository.'
}

function Find-NativeTool {
    param([string]$Name, [string]$Fallback)
    $foundTool = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($foundTool) { return $foundTool.Source }
    if ($Fallback -and (Test-Path -LiteralPath $Fallback -PathType Leaf)) { return $Fallback }
    throw "Required executable is unavailable: $Name"
}

function Invoke-NativeTool {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code ${LASTEXITCODE}: $Executable" }
}

$sshExecutable = Find-NativeTool 'ssh.exe' (Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe')
$scpExecutable = Find-NativeTool 'scp.exe' (Join-Path $env:WINDIR 'System32\OpenSSH\scp.exe')
$tarExecutable = Find-NativeTool 'tar.exe' (Join-Path $env:WINDIR 'System32\tar.exe')
$npmExecutable = Find-NativeTool 'npm.cmd' ''
$gitExecutable = Find-NativeTool 'git.exe' ''
$sshOptions = @('-i', $identityPath, '-p', "$SshPort", '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new')
$scpOptions = @('-i', $identityPath, '-P', "$SshPort", '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new')
$destination = "${RemoteUser}@${Server}"
$packageDirectory = Join-Path ([IO.Path]::GetTempPath()) ('robot-blog-package-' + [Guid]::NewGuid().ToString('N'))
$archivePath = $null

try {
    Push-Location $repositoryRoot
    try {
        if (-not $SkipInstall) { Invoke-NativeTool $npmExecutable @('ci') }
        Invoke-NativeTool $npmExecutable @('run', 'build')
        Invoke-NativeTool $npmExecutable @('run', 'verify')
        if (-not $Revision) {
            $commit = (& $gitExecutable rev-parse --short=12 HEAD | Select-Object -First 1).Trim()
            if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[a-f0-9]{12}$') {
                throw 'Commit the site before publishing, or provide an explicit release identifier.'
            }
            $Revision = $commit + '-' + [DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
        }
    } finally {
        Pop-Location
    }
    New-Item -ItemType Directory -Path $packageDirectory | Out-Null
    Copy-Item -LiteralPath (Join-Path $repositoryRoot 'dist') -Destination (Join-Path $packageDirectory 'dist') -Recurse
    New-Item -ItemType Directory -Path (Join-Path $packageDirectory 'deploy') | Out-Null
    foreach ($deploymentFile in @('nginx.conf', 'robot-blog.service', 'install.sh', 'README.md')) {
        Copy-Item -LiteralPath (Join-Path $repositoryRoot "deploy\$deploymentFile") -Destination (Join-Path $packageDirectory "deploy\$deploymentFile")
    }
    # Git may check text files out with CRLF on Windows. Linux configs need LF.
    foreach ($linuxTextFile in @('nginx.conf', 'robot-blog.service', 'install.sh')) {
        $linuxTextPath = Join-Path $packageDirectory "deploy\$linuxTextFile"
        $linuxText = [IO.File]::ReadAllText($linuxTextPath).Replace("`r`n", "`n").Replace("`r", "`n")
        [IO.File]::WriteAllText($linuxTextPath, $linuxText, [Text.UTF8Encoding]::new($false))
    }
    [IO.File]::WriteAllText((Join-Path $packageDirectory 'REVISION'), "$Revision`n", [Text.UTF8Encoding]::new($false))
    $archivePath = Join-Path ([IO.Path]::GetTempPath()) ("robot-blog-$Revision-" + [Guid]::NewGuid().ToString('N') + '.tar.gz')
    Invoke-NativeTool $tarExecutable @('-czf', $archivePath, '-C', $packageDirectory, 'dist', 'deploy', 'REVISION')
    $archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $remoteArchive = "/tmp/robot-blog-$Revision.tar.gz"
    Invoke-NativeTool $scpExecutable ($scpOptions + @($archivePath, "${destination}:$remoteArchive"))

    $remoteHashOutput = & $sshExecutable @sshOptions $destination "sha256sum $remoteArchive"
    if ($LASTEXITCODE -ne 0 -or ($remoteHashOutput -join '').Split(' ')[0] -ne $archiveHash) {
        throw 'The uploaded archive failed SHA-256 verification.'
    }
    # Both remote path and revision are restricted to safe characters above.
    $installCommand = 'bash -o pipefail -c "tar -xOf {0} deploy/install.sh | sudo -n bash -s -- {0} {1}"' -f $remoteArchive, $Revision
    Invoke-NativeTool $sshExecutable ($sshOptions + @($destination, $installCommand))
    Write-Host "Server installed release $Revision. Verify public access at http://${Server}:8088/"
} finally {
    # Only remove the temporary package directory created by this invocation.
    $resolvedTemporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    $resolvedPackageDirectory = [IO.Path]::GetFullPath($packageDirectory)
    if ($resolvedPackageDirectory.StartsWith($resolvedTemporaryRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedPackageDirectory) -match '^robot-blog-package-[a-f0-9]{32}$') {
        if (Test-Path -LiteralPath $resolvedPackageDirectory) {
            Remove-Item -LiteralPath $resolvedPackageDirectory -Recurse -Force
        }
    }
    if ($archivePath -and (Test-Path -LiteralPath $archivePath)) {
        $resolvedArchivePath = [IO.Path]::GetFullPath($archivePath)
        if ($resolvedArchivePath.StartsWith($resolvedTemporaryRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedArchivePath) -match '^robot-blog-[A-Za-z0-9_-]+\.tar\.gz$') {
            Remove-Item -LiteralPath $resolvedArchivePath -Force
        }
    }
}
