$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($env:PRISM_ICON_EXECUTABLE)
if (!$icon) { exit }
try {
    $bitmap = $icon.ToBitmap()
    try {
        $thumbnail = [System.Drawing.Bitmap]::new($bitmap, 32, 32)
        try {
            $buffer = [System.IO.MemoryStream]::new()
            try {
                $thumbnail.Save($buffer, [System.Drawing.Imaging.ImageFormat]::Png)
                [Convert]::ToBase64String($buffer.ToArray())
            } finally { $buffer.Dispose() }
        } finally { $thumbnail.Dispose() }
    } finally { $bitmap.Dispose() }
} finally { $icon.Dispose() }
