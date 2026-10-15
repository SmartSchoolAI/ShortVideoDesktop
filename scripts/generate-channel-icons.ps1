Add-Type -AssemblyName System.Drawing

function Generate-BadgeIcon {
    param(
        [string]$SrcPath,
        [string]$DstPng,
        [string]$DstIco,
        [string]$Letter,
        [System.Drawing.Color]$BgColor
    )

    $src = [System.Drawing.Bitmap]::FromFile($SrcPath)
    $bmp = New-Object System.Drawing.Bitmap($src.Width, $src.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    $g.DrawImage($src, 0, 0, $src.Width, $src.Height)

    # 在右下角绘制圆点 Badge (中心在 405, 405，半径 56)
    $cx = 405
    $cy = 405
    $r = 54
    $rect = New-Object System.Drawing.RectangleF(($cx - $r), ($cy - $r), ($r * 2), ($r * 2))

    # 外圈深色投影阴影
    $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(140, 0, 0, 0))
    $shadowRect = New-Object System.Drawing.RectangleF(($cx - $r + 2), ($cy - $r + 4), ($r * 2), ($r * 2))
    $g.FillEllipse($shadowBrush, $shadowRect)

    # 填充彩色圆点
    $brush = New-Object System.Drawing.SolidBrush($BgColor)
    $g.FillEllipse($brush, $rect)

    # 纯白精致边框
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(235, 255, 255, 255), 5)
    $g.DrawEllipse($pen, $rect)

    # 绘制字母
    $font = New-Object System.Drawing.Font('Arial', 54, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $g.DrawString($Letter, $font, $textBrush, (New-Object System.Drawing.RectangleF(($cx - $r), ($cy - $r + 2), ($r * 2), ($r * 2))), $sf)

    $g.Dispose()
    $src.Dispose()

    # 写入 PNG
    $bmp.Save($DstPng, [System.Drawing.Imaging.ImageFormat]::Png)

    # 生成 256x256 图标以保证高清且符合 Windows ICO 规范
    $bmp256 = New-Object System.Drawing.Bitmap(256, 256, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g256 = [System.Drawing.Graphics]::FromImage($bmp256)
    $g256.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g256.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g256.DrawImage($bmp, 0, 0, 256, 256)
    $g256.Dispose()

    $hIcon = $bmp256.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($hIcon)
    $fs = [System.IO.File]::OpenWrite($DstIco)
    $icon.Save($fs)
    $fs.Close()
    $icon.Dispose()
    $bmp256.Dispose()
    $bmp.Dispose()
}

$buildDir = Join-Path $PSScriptRoot '..\build'
$srcPng = Join-Path $buildDir 'icon.png'

# A 版本：翡翠绿 (Emerald Green)
Generate-BadgeIcon $srcPng (Join-Path $buildDir 'icon-a.png') (Join-Path $buildDir 'icon-a.ico') 'A' ([System.Drawing.Color]::FromArgb(16, 185, 129))

# B 版本：琥珀金 (Amber Gold)
Generate-BadgeIcon $srcPng (Join-Path $buildDir 'icon-b.png') (Join-Path $buildDir 'icon-b.ico') 'B' ([System.Drawing.Color]::FromArgb(245, 158, 11))

# C 版本：电光洋红 (Vibrant Magenta)
Generate-BadgeIcon $srcPng (Join-Path $buildDir 'icon-c.png') (Join-Path $buildDir 'icon-c.ico') 'C' ([System.Drawing.Color]::FromArgb(236, 72, 153))

Write-Output 'Generated icon-a, icon-b, icon-c successfully!'
