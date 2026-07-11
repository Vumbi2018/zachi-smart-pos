
Add-Type -AssemblyName System.Drawing

$image = [System.Drawing.Bitmap]::FromFile("c:\zachi\public\logo.jpg")
$colors = @{}

for ($x = 0; $x -lt $image.Width; $x+=10) {
    for ($y = 0; $y -lt $image.Height; $y+=10) {
        $pixel = $image.GetPixel($x, $y)
        if ($pixel.A -lt 50) { continue }
        if ($pixel.R -gt 240 -and $pixel.G -gt 240 -and $pixel.B -gt 240) { continue }
        
        $hex = "#{0:X2}{1:X2}{2:X2}" -f $pixel.R, $pixel.G, $pixel.B
        if ($colors[$hex]) { $colors[$hex]++ } else { $colors[$hex] = 1 }
    }
}

$sorted = $colors.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 3
$sorted | ForEach-Object { Write-Output $_.Key }
