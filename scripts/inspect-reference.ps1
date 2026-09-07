param([string]$ProcessName = 'OrcaTerm', [string]$Output = '', [switch]$ClickIsland, [switch]$FrameMain, [switch]$CaptureMain, [int]$ClickX = -1, [int]$ClickY = -1, [string]$Text = '', [switch]$Enter)
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class IslandReferenceWindows {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr parameter);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint process);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [StructLayout(LayoutKind.Sequential)] public struct KeyInput { public ushort Vk, Scan; public uint Flags, Time; public IntPtr Extra; }
  [StructLayout(LayoutKind.Explicit, Size=32)] public struct InputUnion { [FieldOffset(0)] public KeyInput Key; }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint Type; public InputUnion Data; }
  [DllImport("user32.dll")] public static extern uint SendInput(uint count, Input[] inputs, int size);
  public static void TypeText(string text) {
    foreach(char c in text) { SendKey(0,c,4); SendKey(0,c,6); }
  }
  public static void SendKey(ushort vk, ushort scan, uint flags) {
    var input = new Input { Type=1, Data=new InputUnion { Key=new KeyInput { Vk=vk, Scan=scan, Flags=flags } } };
    SendInput(1, new [] { input }, Marshal.SizeOf(typeof(Input)));
  }
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
}
'@
[IslandReferenceWindows]::SetProcessDPIAware() | Out-Null
$referenceIds = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$referenceWindows = [System.Collections.Generic.List[object]]::new()
$callback = [IslandReferenceWindows+EnumProc] {
  param($windowHandle, $parameter)
  $ownerId = [uint32]0
  [IslandReferenceWindows]::GetWindowThreadProcessId($windowHandle, [ref]$ownerId) | Out-Null
  if ($referenceIds -contains $ownerId -and [IslandReferenceWindows]::IsWindowVisible($windowHandle)) {
    $rect = [IslandReferenceWindows+Rect]::new()
    [IslandReferenceWindows]::GetWindowRect($windowHandle, [ref]$rect) | Out-Null
    $title = [System.Text.StringBuilder]::new(256)
    [IslandReferenceWindows]::GetWindowText($windowHandle, $title, 256) | Out-Null
    $referenceWindows.Add([pscustomobject]@{ Handle=$windowHandle.ToInt64(); Process=$ownerId; Title=$title.ToString(); X=$rect.Left; Y=$rect.Top; Width=$rect.Right-$rect.Left; Height=$rect.Bottom-$rect.Top })
  }
  return $true
}
[IslandReferenceWindows]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
$referenceWindows | ConvertTo-Json -Depth 3
$mainTarget = $referenceWindows | Where-Object { $_.Title -eq 'OrcaTerm' } | Select-Object -First 1
if ($FrameMain -and $mainTarget) {
  [IslandReferenceWindows]::SetWindowPos([IntPtr]$mainTarget.Handle, [IntPtr]::Zero, 650, 150, 1500, 1000, 0x0040) | Out-Null
  [IslandReferenceWindows]::SetForegroundWindow([IntPtr]$mainTarget.Handle) | Out-Null
  Start-Sleep -Milliseconds 500
}
if ($ClickIsland) {
  $islandTarget = $referenceWindows | Where-Object { $_.Title -eq 'Tauri App' -and $_.Width -ge 80 -and $_.Width -le 400 -and $_.Height -le 100 } | Select-Object -First 1
  if (!$islandTarget) { throw 'The observed compact OrcaTerm window was not found; no click was sent.' }
  [IslandReferenceWindows]::SetCursorPos(($islandTarget.X + [int]($islandTarget.Width / 2)), ($islandTarget.Y + [int]($islandTarget.Height / 2))) | Out-Null
  [IslandReferenceWindows]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  [IslandReferenceWindows]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 650
}
if ($ClickX -ge 0 -and $ClickY -ge 0) {
  $target = $referenceWindows | Where-Object { $ClickX -ge $_.X -and $ClickX -lt ($_.X+$_.Width) -and $ClickY -ge $_.Y -and $ClickY -lt ($_.Y+$_.Height) } | Select-Object -First 1
  if (!$target) { throw 'Click is outside the observed OrcaTerm windows.' }
  [IslandReferenceWindows]::SetForegroundWindow([IntPtr]$target.Handle) | Out-Null
  [IslandReferenceWindows]::SetCursorPos($ClickX, $ClickY) | Out-Null
  [IslandReferenceWindows]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  [IslandReferenceWindows]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 500
}
if ($Text -or $Enter) {
  $foregroundId=[uint32]0
  [IslandReferenceWindows]::GetWindowThreadProcessId([IslandReferenceWindows]::GetForegroundWindow(),[ref]$foregroundId) | Out-Null
  if ($referenceIds -notcontains $foregroundId) { throw 'OrcaTerm is not focused; no keyboard input was sent.' }
  if ($Text) { [IslandReferenceWindows]::TypeText($Text) }
  if ($Enter) { [IslandReferenceWindows]::SendKey(13,0,0); [IslandReferenceWindows]::SendKey(13,0,2) }
  Start-Sleep -Milliseconds 500
}
if ($Output) {
  $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $captureWidth = [Math]::Min(1000, $screen.Width)
  $captureHeight = [Math]::Min(650, $screen.Height)
  $captureX = $screen.X + [int](($screen.Width-$captureWidth)/2)
  $captureY = $screen.Y
  if ($CaptureMain -and $mainTarget) {
    $mainRect = [IslandReferenceWindows+Rect]::new()
    [IslandReferenceWindows]::GetWindowRect([IntPtr]$mainTarget.Handle, [ref]$mainRect) | Out-Null
    $captureX=$mainRect.Left; $captureY=$mainRect.Top; $captureWidth=$mainRect.Right-$mainRect.Left; $captureHeight=$mainRect.Bottom-$mainRect.Top
  }
  $bitmap = [System.Drawing.Bitmap]::new($captureWidth, $captureHeight)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($captureX, $captureY, 0, 0, $bitmap.Size)
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($Output)) | Out-Null
    $bitmap.Save($Output, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $graphics.Dispose(); $bitmap.Dispose() }
}
