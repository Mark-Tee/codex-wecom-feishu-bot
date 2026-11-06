param([Parameter(Mandatory=$true)][string]$ImagePath,[Parameter(Mandatory=$true)][string]$PlanPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$image = [System.Drawing.Image]::FromFile($ImagePath)
try {
  if ($image.Width * $image.Height -gt 32000000) { throw 'Image dimensions too large' }
  $regions = Get-Content -Raw -Encoding UTF8 -LiteralPath $PlanPath | ConvertFrom-Json
  if ($regions.Count -gt 2) { throw 'Too many regions' }
  foreach ($region in $regions) {
    $x = [Math]::Max(0,[Math]::Min([int]$region.x,$image.Width-1))
    $y = [Math]::Max(0,[Math]::Min([int]$region.y,$image.Height-1))
    $width = [Math]::Min([int]$region.width,$image.Width-$x)
    $height = [Math]::Min([int]$region.height,$image.Height-$y)
    if ($width -lt 1 -or $height -lt 1) { continue }
    if (Test-Path -LiteralPath $region.output) { continue }
    $scale = [Math]::Min(3,1800/$width)
    $bitmap = [System.Drawing.Bitmap]::new([int]($width*$scale),[int]($height*$scale))
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.DrawImage($image,[System.Drawing.Rectangle]::new(0,0,$bitmap.Width,$bitmap.Height),[System.Drawing.Rectangle]::new($x,$y,$width,$height),[System.Drawing.GraphicsUnit]::Pixel)
      $temporary = $region.output + '.tmp'
      $bitmap.Save($temporary,[System.Drawing.Imaging.ImageFormat]::Png)
      [System.IO.File]::Move($temporary,$region.output)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
  }
} finally { $image.Dispose() }
