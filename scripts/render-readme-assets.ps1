#requires -Version 5.1
# Renders README art (hero banner + feature strip) with System.Drawing.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/render-readme-assets.ps1

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root "assets"
if (-not (Test-Path $assets)) { New-Item -ItemType Directory -Path $assets | Out-Null }

function Load-Fonts {
    $pfc = New-Object System.Drawing.Text.PrivateFontCollection
    $files = @(
        "$env:WINDIR\Fonts\seguibl.ttf",   # Segoe UI Black
        "$env:WINDIR\Fonts\segoeuib.ttf",  # Segoe UI Bold
        "$env:WINDIR\Fonts\seguisb.ttf",   # Segoe UI Semibold
        "$env:WINDIR\Fonts\segoeui.ttf",   # Segoe UI
        "$env:WINDIR\Fonts\segoeuil.ttf",  # Segoe UI Light
        "$env:WINDIR\Fonts\CascadiaCode.ttf",
        "$env:WINDIR\Fonts\CascadiaMono.ttf"
    )
    foreach ($f in $files) { if (Test-Path $f) { try { $pfc.AddFontFile($f) } catch { } } }
    return $pfc
}

$fonts = Load-Fonts
function F($name, $size, $style = [System.Drawing.FontStyle]::Regular) {
    $fam = $fonts.Families | Where-Object { $_.Name -eq $name } | Select-Object -First 1
    if (-not $fam) { $fam = New-Object System.Drawing.FontFamily("Segoe UI") }
    return New-Object System.Drawing.Font($fam, $size, $style, [System.Drawing.GraphicsUnit]::Point)
}

function New-RoundRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

function Draw-Glow($g, [System.Drawing.RectangleF]$rect, [System.Drawing.Color]$color, [int]$strength) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddEllipse($rect)
    $brush = New-Object System.Drawing.Drawing2D.PathGradientBrush($path)
    $brush.CenterColor = [System.Drawing.Color]::FromArgb($strength, $color.R, $color.G, $color.B)
    $brush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, $color.R, $color.G, $color.B))
    $g.FillPath($brush, $path)
    $brush.Dispose(); $path.Dispose()
}

function Measure-Spaced($g, [string]$text, $font, [float]$spacing) {
    $sf = [System.Drawing.StringFormat]::GenericTypographic
    $spaceW = $font.GetHeight($g) * 0.30
    $w = 0.0
    foreach ($ch in $text.ToCharArray()) {
        if ($ch -eq " ") { $w += $spaceW + $spacing }
        else { $w += $g.MeasureString([string]$ch, $font, 10000, $sf).Width + $spacing }
    }
    return [Math]::Max(0, $w - $spacing)
}

function Draw-Spaced($g, [string]$text, $font, $brush, [float]$x, [float]$y, [float]$spacing) {
    $sf = [System.Drawing.StringFormat]::GenericTypographic
    $spaceW = $font.GetHeight($g) * 0.30
    $cx = $x
    foreach ($ch in $text.ToCharArray()) {
        if ($ch -eq " ") { $cx += $spaceW + $spacing; continue }
        $g.DrawString([string]$ch, $font, $brush, $cx, $y, $sf)
        $cx += $g.MeasureString([string]$ch, $font, 10000, $sf).Width + $spacing
    }
}

function Draw-CenteredSpaced($g, [string]$text, $font, $brush, [float]$centerX, [float]$y, [float]$spacing) {
    $w = Measure-Spaced $g $text $font $spacing
    Draw-Spaced $g $text $font $brush ($centerX - $w / 2) $y $spacing
}

function Draw-Background($g, [int]$w, [int]$h) {
    $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Point(0, 0)),
        (New-Object System.Drawing.Point($w, $h)),
        [System.Drawing.Color]::FromArgb(255, 4, 6, 12),
        [System.Drawing.Color]::FromArgb(255, 6, 14, 26))
    $g.FillRectangle($bg, 0, 0, $w, $h)
    $bg.Dispose()

    Draw-Glow $g (New-Object System.Drawing.RectangleF(($w * 0.5 - 520), -260, 1040, 760)) ([System.Drawing.Color]::FromArgb(0, 90, 200)) 90
    Draw-Glow $g (New-Object System.Drawing.RectangleF(-320, ($h - 380), 780, 640)) ([System.Drawing.Color]::FromArgb(0, 110, 240)) 55
    Draw-Glow $g (New-Object System.Drawing.RectangleF(($w - 420), ($h - 320), 720, 560)) ([System.Drawing.Color]::FromArgb(0, 150, 255)) 45

    # Perspective grid
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(16, 0, 212, 255), 1)
    $vx = $w / 2.0; $vy = $h * 0.42
    for ($i = -14; $i -le 14; $i++) {
        $g.DrawLine($pen, $vx, $vy, $vx + ($i * 190), $h)
    }
    for ($i = 1; $i -le 9; $i++) {
        $t = [Math]::Pow(1.42, $i) / [Math]::Pow(1.42, 9)
        $yy = $vy + ($h - $vy) * $t
        $g.DrawLine($pen, 0, $yy, $w, $yy)
    }
    $pen.Dispose()

    # Diagonal light streaks
    $streak = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Point(0, 0)),
        (New-Object System.Drawing.Point($w, 0)),
        [System.Drawing.Color]::FromArgb(0, 0, 220, 255),
        [System.Drawing.Color]::FromArgb(0, 0, 220, 255))
    $cb = New-Object System.Drawing.Drawing2D.ColorBlend(3)
    $cb.Colors = @(
        [System.Drawing.Color]::FromArgb(0, 0, 220, 255),
        [System.Drawing.Color]::FromArgb(26, 0, 220, 255),
        [System.Drawing.Color]::FromArgb(0, 0, 220, 255))
    $cb.Positions = @(0.0, 0.5, 1.0)
    $streak.InterpolationColors = $cb
    $sp = New-Object System.Drawing.Pen($streak, 1)
    $g.DrawLine($sp, -200, $h * 0.72, $w + 200, $h * 0.18)
    $g.DrawLine($sp, -200, $h * 0.86, $w + 200, $h * 0.32)
    $sp.Dispose(); $streak.Dispose()
}

function Add-Vignette($g, [int]$w, [int]$h) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddRectangle((New-Object System.Drawing.Rectangle(0, 0, $w, $h)))
    $pth = New-Object System.Drawing.Drawing2D.PathGradientBrush($path)
    $pth.CenterColor = [System.Drawing.Color]::FromArgb(0, 0, 0, 0)
    $pth.SurroundColors = @([System.Drawing.Color]::FromArgb(150, 0, 0, 0))
    $g.FillRectangle($pth, 0, 0, $w, $h)
    $pth.Dispose(); $path.Dispose()
}

# ---------------------------------------------------------------- HERO BANNER
$W = 1600; $H = 640
$bmp = New-Object System.Drawing.Bitmap($W, $H, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

Draw-Background $g $W $H

# Top accent hairline
$hair = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point($W, 0)),
    [System.Drawing.Color]::FromArgb(0, 0, 212, 255),
    [System.Drawing.Color]::FromArgb(0, 10, 102, 255))
$hcb = New-Object System.Drawing.Drawing2D.ColorBlend(3)
$hcb.Colors = @(
    [System.Drawing.Color]::FromArgb(0, 0, 212, 255),
    [System.Drawing.Color]::FromArgb(210, 0, 212, 255),
    [System.Drawing.Color]::FromArgb(0, 0, 212, 255))
$hcb.Positions = @(0.0, 0.5, 1.0)
$hair.InterpolationColors = $hcb
$g.FillRectangle($hair, 0, 0, $W, 3)
$hair.Dispose()

# Eyebrow label
$fEyebrow = F "Segoe UI Semibold" 12.5
$brEyebrow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(230, 120, 214, 255))
Draw-CenteredSpaced $g "UNOFFICIAL  /  FACEBOOK  MESSENGER  API" $fEyebrow $brEyebrow ($W / 2) 104 6.0

# Wordmark with glow + gradient
$fTitle = F "Segoe UI Black" 132
$titleRect = New-Object System.Drawing.RectangleF(0, 130, $W, 220)
$sfCenter = New-Object System.Drawing.StringFormat
$sfCenter.Alignment = [System.Drawing.StringAlignment]::Center
$sfCenter.LineAlignment = [System.Drawing.StringAlignment]::Center

$glowColors = @(0, 212, 255)
for ($i = 9; $i -ge 1; $i--) {
    $gbr = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb([Math]::Max(3, 7 - $i), 0, 212, 255))
    $off = $i * 0.9
    foreach ($d in @(@(-$off, 0), @($off, 0), @(0, -$off), @(0, $off))) {
        $r = New-Object System.Drawing.RectangleF(($titleRect.X + $d[0]), ($titleRect.Y + $d[1]), $titleRect.Width, $titleRect.Height)
        $g.DrawString("AL-FCA", $fTitle, $gbr, $r, $sfCenter)
        $r = $null
    }
    $gbr.Dispose()
}

$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 150)),
    (New-Object System.Drawing.Point(0, 340)),
    [System.Drawing.Color]::FromArgb(255, 235, 253, 255),
    [System.Drawing.Color]::FromArgb(255, 0, 150, 255))
$cbT = New-Object System.Drawing.Drawing2D.ColorBlend(5)
$cbT.Colors = @(
    [System.Drawing.Color]::FromArgb(255, 255, 255, 255),
    [System.Drawing.Color]::FromArgb(255, 148, 242, 255),
    [System.Drawing.Color]::FromArgb(255, 0, 212, 255),
    [System.Drawing.Color]::FromArgb(255, 10, 102, 255),
    [System.Drawing.Color]::FromArgb(255, 92, 120, 255))
$cbT.Positions = @(0.0, 0.28, 0.55, 0.8, 1.0)
$grad.InterpolationColors = $cbT
$g.DrawString("AL-FCA", $fTitle, $grad, $titleRect, $sfCenter)
$grad.Dispose()

# Subtitle
$fSub = F "Segoe UI Light" 15.5
$brSub = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(225, 168, 190, 210))
Draw-CenteredSpaced $g "FACEBOOK  CHAT  API  FOR  NODE.JS" $fSub $brSub ($W / 2) 352 5.0

# Divider line
$dline = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(($W / 2 - 260), 0)),
    (New-Object System.Drawing.Point(($W / 2 + 260), 0)),
    [System.Drawing.Color]::FromArgb(0, 0, 212, 255),
    [System.Drawing.Color]::FromArgb(0, 0, 212, 255))
$dcb = New-Object System.Drawing.Drawing2D.ColorBlend(3)
$dcb.Colors = @(
    [System.Drawing.Color]::FromArgb(0, 0, 212, 255),
    [System.Drawing.Color]::FromArgb(170, 0, 212, 255),
    [System.Drawing.Color]::FromArgb(0, 0, 212, 255))
$dcb.Positions = @(0.0, 0.5, 1.0)
$dline.InterpolationColors = $dcb
$g.FillRectangle($dline, ($W / 2 - 260), 400, 520, 1)
$dline.Dispose()

# Pills
$pills = @("E2EE", "MQTT REALTIME", "PURE JAVASCRIPT", "NODE >= 18", "61 OFFLINE TESTS")
$fPill = F "Segoe UI Semibold" 10.5
$spacing = 2.5
$gap = 14.0
$widths = @()
foreach ($p in $pills) { $widths += (Measure-Spaced $g $p $fPill $spacing) + 40 }
$total = ($widths | Measure-Object -Sum).Sum + ($gap * ($pills.Count - 1))
$cx = ($W - $total) / 2
$pillY = 434; $pillH = 38
for ($i = 0; $i -lt $pills.Count; $i++) {
    $pw = $widths[$i]
    $path = New-RoundRect $cx ($pillY) $pw $pillH ($pillH / 2)
    $fill = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(20, 0, 190, 255))
    $g.FillPath($fill, $path)
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(95, 0, 212, 255), 1)
    $g.DrawPath($pen, $path)
    $tbr = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235, 190, 232, 255))
    $tw = Measure-Spaced $g $pills[$i] $fPill $spacing
    Draw-Spaced $g $pills[$i] $fPill $tbr ($cx + ($pw - $tw) / 2) ($pillY + 11.5) $spacing
    $tbr.Dispose(); $pen.Dispose(); $fill.Dispose(); $path.Dispose()
    $cx += $pw + $gap
}

# Corner marks
$fMark = F "Cascadia Mono" 10
$brMark = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(120, 110, 150, 175))
$g.DrawString("ALAMINNNA / AL-FCA", $fMark, $brMark, 48, 42)
$g.DrawString("v2.1.0", $fMark, $brMark, ($W - 118), 42)
$g.DrawString("github.com/alaminnna/al-fca", $fMark, $brMark, 48, ($H - 62))
$g.DrawString("npm i al-fca", $fMark, $brMark, ($W - 176), ($H - 62))

Add-Vignette $g $W $H
$out = Join-Path $assets "readme-hero.png"
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Host "wrote $out"

# ------------------------------------------------------------- FEATURE STRIP
$W2 = 1600; $H2 = 380
$bmp2 = New-Object System.Drawing.Bitmap($W2, $H2, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp2)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

Draw-Background $g $W2 $H2

$cards = @(
    @("LOCK",   "E2EE SECURE",     "Signal Protocol + Noise"),
    @("SIGNAL", "MQTT REALTIME",   "Persistent event socket"),
    @("REFRESH","AUTO RECONNECT",  "Backoff + jitter, bounded"),
    @("CHECK",  "61 OFFLINE TESTS","npm test never hits Facebook")
)
$cardW = 342.0; $cardH = 232.0
$gapC = 26.0
$totalC = ($cardW * 4) + ($gapC * 3)
$startX = ($W2 - $totalC) / 2
$cardY = ($H2 - $cardH) / 2

$fLabel = F "Segoe UI Bold" 14
$fDesc = F "Segoe UI" 10.5
$fMono = F "Cascadia Mono" 9

for ($i = 0; $i -lt $cards.Count; $i++) {
    $c = $cards[$i]
    $x = $startX + ($cardW + $gapC) * $i
    $path = New-RoundRect $x $cardY $cardW $cardH 18
    $cardFill = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Point($x, $cardY)),
        (New-Object System.Drawing.Point($x, ($cardY + $cardH))),
        [System.Drawing.Color]::FromArgb(38, 14, 34, 56),
        [System.Drawing.Color]::FromArgb(18, 6, 16, 28))
    $g.FillPath($cardFill, $path)
    $cardPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(60, 0, 200, 255), 1)
    $g.DrawPath($cardPen, $path)
    $cardPen.Dispose(); $cardFill.Dispose()

    # Icon plate
    $ip = New-RoundRect ($x + 26) ($cardY + 26) 54 54 14
    $ipFill = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(30, 0, 200, 255))
    $g.FillPath($ipFill, $ip)
    $ipPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(110, 0, 212, 255), 1.2)
    $g.DrawPath($ipPen, $ip)
    $ipFill.Dispose(); $ipPen.Dispose()

    $iconPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 120, 232, 255), 2.2)
    $iconPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $iconPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $ix = $x + 26; $iy = $cardY + 26
    switch ($c[0]) {
        "LOCK" {
            $g.DrawArc($iconPen, ($ix + 18), ($iy + 14), 18, 18, 180, 180)
            $body = New-RoundRect ($ix + 14) ($iy + 24) 26 20 4
            $g.DrawPath($iconPen, $body); $body.Dispose()
        }
        "SIGNAL" {
            $g.DrawArc($iconPen, ($ix + 11), ($iy + 14), 32, 28, 205, 130)
            $g.DrawArc($iconPen, ($ix + 17), ($iy + 21), 20, 18, 205, 130)
            $dot = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 120, 232, 255))
            $g.FillEllipse($dot, ($ix + 25), ($iy + 33), 5, 5)
            $dot.Dispose()
        }
        "REFRESH" {
            $g.DrawArc($iconPen, ($ix + 16), ($iy + 16), 24, 24, 40, 260)
            $g.DrawLine($iconPen, ($ix + 38), ($iy + 17), ($ix + 40), ($iy + 24))
            $g.DrawLine($iconPen, ($ix + 38), ($iy + 17), ($ix + 31), ($iy + 18))
        }
        "CHECK" {
            $g.DrawEllipse($iconPen, ($ix + 15), ($iy + 15), 26, 26)
            $g.DrawLine($iconPen, ($ix + 22), ($iy + 28), ($ix + 27), ($iy + 33))
            $g.DrawLine($iconPen, ($ix + 27), ($iy + 33), ($ix + 35), ($iy + 23))
        }
    }
    $iconPen.Dispose(); $ip.Dispose()

    $labelBr = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 240, 250, 255))
    Draw-Spaced $g $c[1] $fLabel $labelBr ($x + 26) ($cardY + 104) 1.4
    $descBr = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(200, 146, 174, 196))
    $g.DrawString($c[2], $fDesc, $descBr, ($x + 26), ($cardY + 132))

    $idxBr = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(105, 0, 212, 255))
    $g.DrawString(("0" + ($i + 1)), $fMono, $idxBr, ($x + $cardW - 44), ($cardY + $cardH - 42))

    $labelBr.Dispose(); $descBr.Dispose(); $idxBr.Dispose(); $path.Dispose()
}

Add-Vignette $g $W2 $H2
$out2 = Join-Path $assets "readme-features.png"
$bmp2.Save($out2, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp2.Dispose()
Write-Host "wrote $out2"
