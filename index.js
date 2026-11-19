/**
 * Host half of the screenshot-to-composer plugin.
 *
 * The Web client cannot read the desktop, so the Host owns the capture and
 * asks this machine's own tooling for it:
 *
 * - `mode=full` grabs the whole screen;
 * - `mode=region` freezes the screen and shows a snip overlay right on the
 *   desktop (see `snip.cs`), so the area is dragged over the real screen the
 *   way every other screenshot tool does it. Only the chosen rectangle comes
 *   back, already cropped, as one PNG;
 * - `hide=1` takes this application's own windows out of the grab first and
 *   restores them afterwards.
 *
 * On Windows the overlay is a small C# WinForms class compiled once and cached
 * beside the capture script, so a capture does not pay for compilation every
 * time.
 *
 * @module dsh-screenshot-loupe
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Route the Client half fetches; a plain GET, same origin as the page. */
const CAPTURE_PATH = '/dsh-screenshot-loupe/screen.png'

/** Route the Client half reads once to learn what this platform can do. */
const PROBE_PATH = '/dsh-screenshot-loupe/probe'

/** Window-title suffix of this application; the windows `hide=1` takes out. */
const APP_WINDOW_TITLE = 'DeepSeek Harness'

/** A whole-screen grab must not outlive this. */
const FULL_TIMEOUT_MS = 25000

/**
 * A region grab waits for a human to drag a rectangle, so it may take minutes;
 * the overlay itself is the limit the user feels.
 */
const REGION_TIMEOUT_MS = 300000

/** Pause after hiding, so the desktop has repainted without our windows. */
const HIDE_SETTLE_MS = 180

/** Longest hint the overlay will draw above the screen. */
const HINT_MAX_CHARS = 90

/** First bytes of every PNG; a capture tool that wrote something else is a failure. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** The overlay source, beside this module. */
const SNIP_SOURCE_FILE = join(fileURLToPath(new URL('.', import.meta.url)), 'snip.cs')

/** Where the compiled overlay and the capture script live between captures. */
const CACHE_DIR = join(tmpdir(), 'dsh-screenshot-loupe')
const CAPTURE_SCRIPT = join(CACHE_DIR, 'capture.ps1')

/**
 * The capture script. It is plain ASCII and never changes, so it is written
 * once: load the cached overlay, compile it only when the cache is cold, grab
 * the DPI-aware virtual screen, then either save the frame or hand it to the
 * snip overlay.
 */
const SCRIPT_TEXT = [
  'param(',
  '  [Parameter(Mandatory = $true)][string]$SnipDll,',
  '  [Parameter(Mandatory = $true)][string]$SourcePath,',
  '  [string]$OutPath = "",',
  '  [string]$HideTitle = "",',
  '  [string]$Hint = "",',
  '  [switch]$Region,',
  '  [switch]$Warm',
  ')',
  '$ErrorActionPreference = "Stop"',
  'Add-Type -AssemblyName System.Windows.Forms',
  'Add-Type -AssemblyName System.Drawing',
  '$overlayLoaded = $false',
  'if (Test-Path -LiteralPath $SnipDll) {',
  '  try { Add-Type -Path $SnipDll; $overlayLoaded = $true } catch { $overlayLoaded = $false }',
  '}',
  'if (-not $overlayLoaded) {',
  '  $source = Get-Content -LiteralPath $SourcePath -Raw -Encoding UTF8',
  '  if ($Warm) {',
  '    $folder = Split-Path -Parent $SnipDll',
  '    if (-not (Test-Path -LiteralPath $folder)) { New-Item -ItemType Directory -Path $folder -Force | Out-Null }',
  '    $staging = $SnipDll + "." + $PID + ".tmp.dll"',
  '    Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms, System.Drawing, System.Core -OutputAssembly $staging',
  '    Move-Item -LiteralPath $staging -Destination $SnipDll -Force',
  '    Write-Output "ready"',
  '    return',
  '  }',
  '  Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms, System.Drawing, System.Core',
  '}',
  'if ($Warm) { Write-Output "ready"; return }',
  '[void][DshScreenSnip]::SetProcessDPIAware()',
  '$minimized = New-Object System.Collections.ArrayList',
  '$outcome = "cancel"',
  'try {',
  '  if ($HideTitle -ne "") {',
  '    foreach ($handle in [DshScreenSnip]::VisibleTitled($HideTitle)) {',
  '      [void][DshScreenSnip]::ShowWindow($handle, 6)',
  '      [void]$minimized.Add($handle)',
  '    }',
  `    if ($minimized.Count -gt 0) { Start-Sleep -Milliseconds ${HIDE_SETTLE_MS} }`,
  '  }',
  '  $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen',
  '  $frame = [DshScreenSnip]::Grab($bounds)',
  '  try {',
  '    if ($Region) {',
  '      $confirmed = $false',
  '      $shot = [DshScreenSnip]::PickArea($frame, $bounds, $Hint, [ref]$confirmed)',
  '      if ($confirmed -and $shot -ne $null) {',
  '        try { $shot.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png) }',
  '        finally { $shot.Dispose() }',
  '        $outcome = "ok"',
  '      }',
  '    }',
  '    else {',
  '      $frame.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)',
  '      $outcome = "ok"',
  '    }',
  '  }',
  '  finally { $frame.Dispose() }',
  '}',
  'finally {',
  '  foreach ($handle in $minimized) {',
  '    [void][DshScreenSnip]::ShowWindow($handle, 9)',
  '    [void][DshScreenSnip]::SetForegroundWindow($handle)',
  '  }',
  '}',
  'Write-Output $outcome',
  '',
].join('\n')

/** Overlay source read once per process. */
let snipSource = null

/**
 * The overlay source, read from `snip.cs` on first use.
 * @returns the C# source.
 */
async function readSnipSource () {
  if (snipSource === null) snipSource = await readFile(SNIP_SOURCE_FILE, 'utf8')
  return snipSource
}

/**
 * Cache locations for one overlay source.
 * @param source - the C# source the assembly is built from.
 */
function cachePaths (source) {
  const digest = createHash('sha1').update(source).digest('hex').slice(0, 12)
  return { dll: join(CACHE_DIR, `snip-${digest}.dll`), script: CAPTURE_SCRIPT }
}

/**
 * Write the capture script once and return its path.
 * @returns the script path.
 */
async function ensureScript () {
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(CAPTURE_SCRIPT, SCRIPT_TEXT, 'utf8')
  return CAPTURE_SCRIPT
}

/**
 * Compile the overlay ahead of the first capture, so the first click is not the
 * one that pays for it. Failures are the capture path's problem, not this one.
 */
async function warmOverlay () {
  try {
    const source = await readSnipSource()
    const script = await ensureScript()
    const paths = cachePaths(source)
    await run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', script, '-SnipDll', paths.dll, '-SourcePath', SNIP_SOURCE_FILE, '-Warm',
    ], 120000)
  } catch {
    // A machine without the .NET compiler simply compiles inline when needed.
  }
}

/**
 * Run one command with a bounded wait.
 * @param command - Executable to start.
 * @param args - Its arguments.
 * @param timeoutMs - How long the command may run.
 * @returns stdout and stderr; rejects with a readable message on failure.
 */
function run (command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error === null) {
        resolve({ stdout, stderr })
        return
      }
      const detail = stderr.trim() === '' ? error.message : stderr.trim()
      reject(new Error(`${command}: ${detail.split('\n')[0]}`))
    })
  })
}

/**
 * Whether one path exists.
 * @param path - absolute path.
 */
async function exists (path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Reduce client-supplied overlay copy to something one short line can hold.
 * @param value - the raw query value.
 * @returns the hint, or the empty string.
 */
function cleanHint (value) {
  if (value === null) return ''
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, HINT_MAX_CHARS)
}

/**
 * Capture into one PNG file for this platform.
 * @param dir - Private directory owned by this capture.
 * @param file - Destination PNG path the platform tool writes.
 * @param options - `hide` for leaving this application's windows out, `region`
 *   for an on-screen area selection instead of the whole screen, `hint` for the
 *   one line the overlay shows.
 * @returns whether a frame was taken; `false` means the user cancelled.
 */
async function captureTo (dir, file, options) {
  switch (process.platform) {
    case 'win32': {
      const source = await readSnipSource()
      const script = await ensureScript()
      const paths = cachePaths(source)
      const args = [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', script, '-SnipDll', paths.dll, '-SourcePath', SNIP_SOURCE_FILE, '-OutPath', file,
      ]
      if (options.region) args.push('-Region', '-Hint', options.hint)
      if (options.hide) args.push('-HideTitle', APP_WINDOW_TITLE)
      const { stdout } = await run('powershell.exe', args, options.region ? REGION_TIMEOUT_MS : FULL_TIMEOUT_MS)
      return stdout.trim() === 'ok'
    }
    case 'darwin': {
      // -i is macOS's own snip overlay; it writes nothing when cancelled.
      await run('screencapture', options.region ? ['-i', '-x', file] : ['-x', file], options.region ? REGION_TIMEOUT_MS : FULL_TIMEOUT_MS)
      return exists(file)
    }
    default: {
      // Linux has no single screenshot tool; take the first working one.
      const full = [
        ['grim', [file]],
        ['gnome-screenshot', ['-f', file]],
        ['spectacle', ['-b', '-n', '-f', '-o', file]],
        ['scrot', [file]],
        ['import', ['-window', 'root', file]],
      ]
      const region = [
        ['maim', ['-s', file]],
        ['scrot', ['-s', file]],
        ['gnome-screenshot', ['-a', '-f', file]],
        ['spectacle', ['-r', '-b', '-n', '-o', file]],
      ]
      const candidates = options.region ? region : full
      const timeoutMs = options.region ? REGION_TIMEOUT_MS : FULL_TIMEOUT_MS
      const failures = []
      for (const [command, args] of candidates) {
        try {
          await run(command, args, timeoutMs)
          return exists(file)
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error))
        }
      }
      const mode = options.region ? 'area' : 'full-screen'
      throw new Error(`no supported ${mode} screenshot tool found (${failures[0] ?? 'none'})`)
    }
  }
}

/** In-flight capture, so two rapid requests share one screen grab. */
let inFlight = null

/**
 * Capture the screen once.
 * @param options - `hide`, `region`, and `hint`, as for {@link captureTo}.
 * @returns the PNG bytes, or null when the user cancelled the area selection.
 */
function captureScreen (options) {
  if (inFlight !== null) return inFlight
  inFlight = (async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-screenshot-'))
    try {
      const file = join(dir, 'screen.png')
      const taken = await captureTo(dir, file, options)
      if (!taken) return null
      const bytes = await readFile(file)
      if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
        throw new Error('the screenshot tool produced no PNG image')
      }
      return bytes
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })().finally(() => { inFlight = null })
  return inFlight
}

/**
 * Serve one capture, or a JSON failure the client can name.
 * @param req - request of the capture route.
 * @param res - response of the capture route.
 */
async function handleCapture (req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { allow: 'GET' })
    res.end()
    return
  }
  let options = { hide: false, region: false, hint: '' }
  try {
    const { searchParams } = new URL(req.url ?? CAPTURE_PATH, 'http://localhost')
    options = {
      hide: searchParams.get('hide') === '1',
      region: searchParams.get('mode') === 'region',
      hint: cleanHint(searchParams.get('hint')),
    }
  } catch {
    options = { hide: false, region: false, hint: '' }
  }
  try {
    const bytes = await captureScreen(options)
    if (bytes === null) {
      // The user cancelled the area selection: nothing to attach.
      res.writeHead(204, { 'cache-control': 'no-store' })
      res.end()
      return
    }
    res.writeHead(200, {
      'content-type': 'image/png',
      'content-length': String(bytes.length),
      'cache-control': 'no-store, no-cache, must-revalidate',
    })
    res.end(bytes)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const body = JSON.stringify({ error: message })
    res.writeHead(500, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(Buffer.byteLength(body)),
      'cache-control': 'no-store',
    })
    res.end(body)
  }
}

/**
 * What this platform can do, so the page hides controls it cannot honour.
 * @param req - request of the probe route.
 * @param res - response of the probe route.
 */
function handleProbe (req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { allow: 'GET' })
    res.end()
    return
  }
  const body = JSON.stringify({
    platform: process.platform,
    // Every platform has an area path: the overlay on Windows, the system's
    // own interactive tool elsewhere.
    region: true,
    // Only the Windows overlay annotates before the crop is taken.
    annotate: process.platform === 'win32',
    // Only Windows can take its own windows out of the grab.
    hideWindow: process.platform === 'win32',
  })
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** Services this plugin needs to contribute the capture route. */
export const inject = ['webServer']

/**
 * Mount the capture route and warm the overlay cache.
 * @param ctx - Host root context.
 */
export function apply (ctx) {
  ctx.effect(() => { void warmOverlay() }, 'dsh-screenshot-loupe: overlay cache')
  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => scope.webServer.register({
      kind: 'exact',
      path: CAPTURE_PATH,
      handler: handleCapture,
    }), 'dsh-screenshot-loupe: capture route')
    scope.effect(() => scope.webServer.register({
      kind: 'exact',
      path: PROBE_PATH,
      handler: handleProbe,
    }), 'dsh-screenshot-loupe: probe route')
  })
}
