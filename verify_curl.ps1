# verify_curl.ps1 — Netlify/Vite production checks via curl.exe (PowerShell 5 safe)

$CURL = "$env:SystemRoot\System32\curl.exe"   # ensure real curl.exe
if (-not (Test-Path $CURL)) { Write-Host "curl.exe not found"; exit 1 }

$CURLFLAGS = @("--ssl-no-revoke","--tlsv1.2") # avoid Schannel CRL issues on Windows

$APEX    = "https://fantasycommandcentre.co.uk"
$WWW     = "https://www.fantasycommandcentre.co.uk"
$LMS     = "https://lms.fantasycommandcentre.co.uk"
$NETLIFY = "https://fantasy-command-centre.netlify.app"
$SUPABASE_URL = $env:VITE_SUPABASE_URL  # set to your real project URL to enable CORS test

function HR { Write-Host ("-"*64) }

function StatusLine([string]$url) {
  & $CURL @CURLFLAGS -sS -o NUL -w "URL:%{url_effective} code:%{http_code} redirect:%{redirect_url}`n" "$url"
}

function ShowHeaders([string]$url) {
  & $CURL @CURLFLAGS -sS -I "$url"
}

Write-Host "=== Canonical redirect checks (HTTP -> HTTPS & Netlify -> apex) ==="; HR
StatusLine "http://fantasycommandcentre.co.uk"
StatusLine "http://www.fantasycommandcentre.co.uk"
StatusLine "http://lms.fantasycommandcentre.co.uk"
StatusLine "$NETLIFY/test"
HR

Write-Host "=== HTTPS head checks (security headers present) ==="; HR
ShowHeaders "$APEX"
HR
ShowHeaders "$LMS"
HR

Write-Host "=== SPA fallback check (deep link should 200 and return HTML) ==="; HR
StatusLine "$APEX/some/missing/page"
$deep = & $CURL @CURLFLAGS -sS "$APEX/some/missing/page"
if ($deep) { $deep -split "`n" | Select-Object -First 5 | ForEach-Object { $_ } } else { Write-Host "(no body returned)" }
HR

Write-Host "=== Asset caching check (immutable, long max-age) ==="; HR
$index = & $CURL @CURLFLAGS -sS "$APEX"
if ($index) {
  $asset = [regex]::Match($index, "/assets/[A-Za-z0-9._/-]+\.js").Value
  if ($asset) {
    Write-Host "Asset: $asset"
    ShowHeaders "$APEX$asset"
  } else {
    Write-Host "No asset discovered on homepage (ensure Vite emits fingerprinted /assets/*)"
  }
} else {
  Write-Host "Homepage fetch failed (TLS or network) — try running again or in Git Bash/WSL."
}
HR

Write-Host "=== HSTS present? (Strict-Transport-Security) ==="; HR
$hstsHeaders = ShowHeaders "$APEX" | Select-String -Pattern "Strict-Transport-Security"
if ($hstsHeaders) { Write-Host $hstsHeaders } else { Write-Host "HSTS header MISSING" }
HR

if ($SUPABASE_URL -and ($SUPABASE_URL -notmatch "<your")) {
  Write-Host "=== Supabase CORS preflight (OPTIONS) ==="; HR
  & $CURL @CURLFLAGS -sS -i -X OPTIONS "$SUPABASE_URL/rest/v1/" `
    -H "Origin: $APEX" -H "Access-Control-Request-Method: GET" | Select-Object -First 40
} else {
  Write-Host "Skip Supabase CORS (set VITE_SUPABASE_URL to your real project URL to enable)"
}
HR

Write-Host "=== TLS dates (header sanity check only) ==="; HR
ShowHeaders "$LMS" | findstr /I "date server"
ShowHeaders "$APEX" | findstr /I "date server"
HR

Write-Host "Expectations:"
Write-Host " - HTTP -> HTTPS 301s (apex, www, lms) and Netlify-subdomain -> apex 301."
Write-Host " - APEX/LMS headers include: X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Strict-Transport-Security."
Write-Host " - Deep link returns index.html (SPA fallback)."
Write-Host " - /assets/* shows Cache-Control: immutable with long max-age."
Write-Host " - TLS dates look current."
Write-Host "All checks executed."
