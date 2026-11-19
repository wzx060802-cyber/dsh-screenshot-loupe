# Screenshot to composer

Adds screen capture to the message composer, the way a chat app's own screenshot
tool works: the screen freezes, an overlay covers the desktop, the area is
dragged **on the screen itself**, and the result is attached to the message.

## Where it appears

- **A camera button in the composer tool row**, beside the `+` control and the
  permission chip. One click starts the area snip immediately.
- **`+` menu → Screenshot** (also `/screenshot`) opens the options panel:

| Choice | Effect |
|---|---|
| 选区截屏 / Snip an area | Freezes the screen and shows the snip overlay |
| 整屏截屏 / Take the whole screen | Captures everything at once, no overlay |
| 截屏时隐藏本窗口 / Hide this window | Takes this window out of the shot; remembered for later captures |

The result is attached as an ordinary image draft: it appears in the composer's
attachment rail with its own thumbnail and remove control, waits until the next
message is sent, and is sent with that message.

## The snip overlay

The Host freezes the current screen and draws a full-screen overlay over it:

- **drag** a rectangle and **release** — the rectangle stays, and an annotation
  toolbar appears under it;
- **Esc** or a **right click** — cancel, nothing is attached;
- a drag smaller than 6 × 6 pixels is ignored instead of producing a sliver.

While the pointer moves the overlay shows thin **crosshair guides** across the
screen and a **magnifier** beside it: a 10× view of the pixels around the
pointer with a one-pixel grid, the target pixel framed, and the pointer's
coordinates in a label under it. During the drag the same magnifier follows the
corner being placed, so the edge can be set on the exact pixel.

The selection is drawn as a bright cut-out in the dimmed frame, edged with a
white hairline under a 1 px brand line. The chosen rectangle is cropped from the
captured frame itself, so the file matches what the overlay showed, pixel for
pixel.

### Annotating the selection

Once the rectangle is released, the toolbar under it offers:

| Tool | Use |
|---|---|
| Arrow (`A`) | Drag from tail to head; the head is filled and outlined so it reads on any background |
| Box (`R`) | Drag to frame a region with a 3 px brand outline |
| Text (`T`) | Click inside, type, `Enter` commits; the label is drawn white with a dark outline so it stays readable |
| Mosaic (`M`) | Drag to pixelate a region — useful for names, tokens, and phone numbers |
| Undo (`Ctrl+Z`) | Drops the last mark |
| Cancel / Confirm | Same as `Esc` / `Enter`; a double click inside the selection also confirms |

Marks are vector at draw time and baked into the cropped PNG at native
resolution when the selection is confirmed, so nothing is lost to the overlay's
own scaling.

Because the overlay works on a frozen frame of the real screen, the selection is
pixel-exact, spans every monitor, and never depends on how large the chat window
is. A capture is one frame: there is no live viewfinder behind the selection.

## Leaving the chat window out

With the checkbox on, the Host minimizes every window of this application
(matched by the `DeepSeek Harness` title suffix) before the frame is taken and
restores them in a `finally`, so a cancel or a failure cannot leave the window
minimized. The window flashes away and back for about a second, which is also
what makes the freeze feel like a screenshot tool rather than a chat overlay.

## How it works

The browser page cannot read the desktop, so the **Host** half owns the capture
and serves one PNG at `GET /dsh-screenshot-loupe/screen.png`:

- `?mode=region` — freeze, snip overlay, crop, return only the chosen rectangle;
- `?mode=full` — the whole screen;
- `?hide=1` — leave this application's windows out;
- `204` — the user cancelled, and nothing should be attached.

The **Client** half only asks for a frame and hands it to the composer through
the document paste route the composer already owns, so image limits, upload
state, and the rail stay the shipped behaviors rather than a second
implementation.

Capture tooling by platform:

| Platform | Full screen | Area (and annotation) |
|---|---|---|
| Windows | PowerShell + .NET drawing stack, DPI-aware, whole virtual screen | the plugin's own snip overlay (compiled once and cached) |
| macOS | `screencapture -x` | `screencapture -i` |
| Linux | first of `grim`, `gnome-screenshot`, `spectacle`, `scrot`, `import` | first of `maim -s`, `scrot -s`, `gnome-screenshot -a`, `spectacle -r` |

On Windows the overlay class is compiled once into a cached assembly beside the
capture script, so the wait before the overlay appears is about a second instead
of several.

## Behavior

- A second invocation while a capture is still running joins the one in flight,
  so the entry points can never attach the same capture twice.
- The camera button shows a spinner while the Host prepares the frame.
- A failure the composer cannot explain itself — no screenshot tool, a refused
  screen-recording permission, a message editor that will not take the image —
  is reported in a notice just above the composer.

## Limitations

- Capture happens on the **Host machine**, which is the computer running DeepSeek
  Harness. A Web page opened on another device captures the Host's screen.
- Leaving the window out and annotating inside the selection are Windows-only;
  macOS and Linux keep the window in the shot and return the system tool's
  finished crop.
- On macOS the first capture needs Screen Recording permission for the DeepSeek
  Harness app; macOS asks once, and until it is granted the capture fails with a
  notice.
- On Linux an area capture needs one of the four listed tools installed.
- There is no scrolling capture and no window picker: a capture
  is one frame of the screen, cropped to the chosen rectangle.
- The route is a plain same-origin GET with no extra credential: it is served
  only on the loopback address the Web GUI already listens on, so it adds no
  reach beyond that interface.
