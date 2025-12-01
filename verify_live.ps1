# verify_live.ps1 — FCC Go/No-Go validator (PowerShell-safe)

$apex    = "https://fantasycommandcentre.co.uk"
$netlify = "https://fantasy-command-centre.netlify.app"
$lms     = "https://lms.fantasycommandcentre.co.uk"

# Use real curl with robust TLS flags
$CURL = "curl.exe"
$CF   = @("--ssl-no-revoke","--tlsv1.2","-sS","-L")  # follow redirects, quiet errors

Write-Host ""
Write-Host "=== DOMAIN AND TLS TESTS ==="
# 1) HTTP -> HTTPS
& $CURL @CF -I "http://fantasycommandcentre.co.uk"               | findstr /I "301 302 Location"
# 2) Netlify subdomain -> apex
& $CURL @CF -I "$netlify/test"                                   | findstr /I "301 302 Location"

Write-Host ""
Write-Host "=== SECURITY HEADERS (APEX) ==="
$hdr = & $CURL @CF -I "$apex"
$hdr | findstr /I "Strict-Transport-Security"
$hdr | findstr /I "X-Frame-Options"
$hdr | findstr /I "X-Content-Type-Options"
$hdr | findstr /I "Referrer-Policy"
$hdr | findstr /I "Permissions-Policy"

Write-Host ""
Write-Host "=== SPA FALLBACK AND CACHING ==="
# 3) Deep link -> index.html
& $CURL @CF -I "$apex/some/missing/path"                         | findstr /I "200 text/html"

# 4) Fetch homepage HTML; fall back to Netlify if apex fetch fails
$index = ""
try { $index = & $CURL @CF "$apex" } catch {}
if (-not $index -or $index.Length -lt 100) {
  Write-Host "Apex HTML fetch failed; falling back to Netlify subdomain"
  try { $index = & $CURL @CF "$netlify" } catch {}
}

if ($index) {
  $m = [regex]::Match($index, "/assets/[A-Za-z0-9._/\-]+\.(js|css)")
  if ($m.Success) {
    $asset = $m.Value
    Write-Host ("Asset discovered: {0}" -f $asset)
    $origin = $apex
    if ($index -like "*fantasy-command-centre.netlify.app*") {
      $origin = $netlify
    }
    & $CURL @CF -I ($origin + $asset)                            | findstr /I "Cache-Control ETag"
  } else {
    Write-Host "No /assets path found in HTML; assets may be inlined or path differs"
  }
} else {
  Write-Host "Failed to download homepage HTML from both apex and Netlify"
}

Write-Host ""
Write-Host "=== HEALTH CHECK FUNCTION ==="
& $CURL @CF -I "$netlify/.netlify/functions/health"              | findstr /I "200 application/json"

Write-Host ""
Write-Host "=== ANALYTICS TAG ==="
if (Test-Path "./index.html") {
  $pl = Select-String -Path "./index.html" -Pattern "plausible.io" -SimpleMatch -ErrorAction SilentlyContinue
  if ($pl) {
    Write-Host "Plausible: FOUND"
  } else {
    Write-Host "Plausible: NOT FOUND in index.html head"
  }
} else {
  Write-Host "index.html not found at repo root; skipping local Plausible check"
}

Write-Host ""
Write-Host "All checks executed."
Write-Host ""
