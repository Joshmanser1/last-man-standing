# verify_min.ps1 — HTTPS/redirect/header sanity checks (Windows + real curl.exe)
$ErrorActionPreference = "Stop"

# Use Windows' curl.exe explicitly
$CURL = "$env:SystemRoot\System32\curl.exe"
$F = @("--ssl-no-revoke", "--tlsv1.2", "-sS")
# If your local machine throws Schannel errors, uncomment this next line temporarily:
# $F += "--insecure"

function Status($msg, $ok) {
  if ($ok) { Write-Host "[PASS] $msg" -ForegroundColor Green }
  else     { Write-Host "[FAIL] $msg" -ForegroundColor Red }
}

function CurlHeaders([string]$url) {
  & $CURL @F -I $url
}

function CurlStatus([string]$url) {
  & $CURL @F -o NUL -w "URL:%{url_effective} code:%{http_code} redir:%{redirect_url}`n" $url
}

function AssertRedirect([string]$from, [string]$expectTo, [string]$expectCode = "301") {
  $out  = & $CURL @F -I $from
  $code = ($out | Select-String -Pattern '^HTTP/.* (\d{3})' -AllMatches).Matches |
          Select-Object -Last 1 | ForEach-Object { $_.Groups[1].Value }
  $loc  = ($out | Select-String -Pattern '^location:\s*(.+)$' -CaseSensitive:$false | Select-Object -Last 1)
  $to   = if ($loc) { ($loc.Matches[0].Groups[1].Value).Trim() } else { "" }

  $ok = ($code -eq $expectCode) -and ($to -like "$expectTo*")
  Status "Redirect $from → $expectTo ($expectCode) [got: $code → $to]" $ok
  if (-not $ok) { Write-Host $out }
}

function RequireHeadersPresence([string]$url, [string[]]$headers) {
  $out = CurlHeaders $url
  foreach ($h in $headers) {
    $pattern = "^{0}:\s*" -f ([regex]::Escape($h))
    $found = $out | Select-String -Pattern $pattern -CaseSensitive:$false
    Status "$url has header: $h" ([bool]$found)
  }
}

Write-Host "== Redirects ==" -ForegroundColor Cyan
AssertRedirect "http://fantasycommandcentre.co.uk"              "https://fantasycommandcentre.co.uk" "301"
AssertRedirect "https://www.fantasycommandcentre.co.uk/test"    "https://fantasycommandcentre.co.uk" "301"
AssertRedirect "https://fantasy-command-centre.netlify.app/abc" "https://fantasycommandcentre.co.uk" "301"
AssertRedirect "https://fantasycommandcentre.co.uk/lms"         "https://lms.fantasycommandcentre.co.uk" "301"

Write-Host "`n== Security headers (apex) ==" -ForegroundColor Cyan
$mustHave = @(
  "Strict-Transport-Security",
  "X-Frame-Options",
  "X-Content-Type-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "Content-Security-Policy"  # recommended
)
RequireHeadersPresence "https://fantasycommandcentre.co.uk" $mustHave

Write-Host "`n== Security headers (lms) ==" -ForegroundColor Cyan
RequireHeadersPresence "https://lms.fantasycommandcentre.co.uk" $mustHave

Write-Host "`n== SPA deep link (should 200 app shell or friendly 404) ==" -ForegroundColor Cyan
CurlStatus "https://fantasycommandcentre.co.uk/some/missing/path"
