# Downloads Apple's aerial catalogue and writes app/js/aerials.js (video addresses
# plus Apple's own captions in English and Arabic). Apple's content stays on
# Apple's servers and in your local copy only; it is not part of this repository.
# Usage: powershell -File scripts/fetch-aerials.ps1   (needs Node.js and tar)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$work = Join-Path ([IO.Path]::GetTempPath()) ('glot-aerials-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $work | Out-Null
try {
    Invoke-WebRequest 'http://sylvan.apple.com/Aerials/resources-16.tar' -OutFile (Join-Path $work 'r.tar') -UseBasicParsing
    tar -xf (Join-Path $work 'r.tar') -C $work
    node (Join-Path $PSScriptRoot 'gen-aerials.js') $work (Join-Path $root 'app/js/aerials.js')
} finally {
    Remove-Item $work -Recurse -Force -Confirm:$false
}
