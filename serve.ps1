$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 5175
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Output "Serving $root on http://localhost:$port/"

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".png"  = "image/png"
  ".ico"  = "image/x-icon"
}

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $req = $context.Request
  $res = $context.Response
  try {
    $path = $req.Url.LocalPath
    if ($path -eq "/") { $path = "/index.html" }
    $filePath = Join-Path $root ($path.TrimStart("/"))
    $fullRoot = [System.IO.Path]::GetFullPath($root)
    $fullFile = [System.IO.Path]::GetFullPath($filePath)
    if (-not $fullFile.StartsWith($fullRoot) -or -not (Test-Path $fullFile -PathType Leaf)) {
      $res.StatusCode = 404
      $bytes = [System.Text.Encoding]::UTF8.GetBytes("Not found")
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ext = [System.IO.Path]::GetExtension($fullFile).ToLower()
      $contentType = $mime[$ext]
      if (-not $contentType) { $contentType = "application/octet-stream" }
      $res.ContentType = $contentType
      $bytes = [System.IO.File]::ReadAllBytes($fullFile)
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    }
  } catch {
    $res.StatusCode = 500
  } finally {
    $res.OutputStream.Close()
  }
}
