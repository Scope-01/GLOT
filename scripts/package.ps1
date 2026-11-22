# Zips GLOT's app/ folder into an unsigned .wgt (dotfiles and *.md left out). Apps2Samsung signs it on install.
param([Parameter(Mandatory)][string]$Repo)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$root = (Resolve-Path $Repo).Path
$src = Join-Path $root 'app'
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$out = Join-Path $dist 'GlassHome.wgt'
if (Test-Path $out) { Remove-Item $out -Confirm:$false }
$zip = [IO.Compression.ZipFile]::Open($out, [IO.Compression.ZipArchiveMode]::Create)
$count = 0
try {
    Get-ChildItem $src -Recurse -File -Force | ForEach-Object {
        $rel = $_.FullName.Substring($src.Length + 1).Replace('\', '/')
        foreach ($part in $rel.Split('/')) { if ($part.StartsWith('.')) { return } }
        if ($rel -like '*.md') { return }
        [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel, [IO.Compression.CompressionLevel]::Optimal)
        $count++
    }
} finally { $zip.Dispose() }
"Built $out ($count files, $([math]::Round((Get-Item $out).Length / 1MB, 1)) MB)"
