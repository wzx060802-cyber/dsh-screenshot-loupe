// Snip overlay for the screenshot-to-composer plugin.
//
// A borderless, top-most window over the frozen frame. Drag a rectangle and
// release to keep it, then annotate it with arrows, boxes, text, or mosaic
// before confirming. Escape or the right button cancels.
//
// While the pointer moves it shows crosshair guides and a magnifier, so the
// rectangle and every mark can be placed on the exact pixel.
//
// Compiled with the Windows PowerShell 5.1 CodeDom provider, so this file must
// stay C# 5: no string interpolation, no null-conditional operator, no tuples,
// no Math.Clamp.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

public static class DshScreenSnip
{
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc proc, IntPtr lParam);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int cmd);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")]
    public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);

    public static List<IntPtr> VisibleTitled(string suffix)
    {
        List<IntPtr> found = new List<IntPtr>();
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
        {
            if (!IsWindowVisible(hWnd)) return true;
            StringBuilder buffer = new StringBuilder(512);
            if (GetWindowText(hWnd, buffer, buffer.Capacity) <= 0) return true;
            if (buffer.ToString().EndsWith(suffix, StringComparison.Ordinal)) found.Add(hWnd);
            return true;
        }, IntPtr.Zero);
        return found;
    }

    /// One virtual-screen frame. Doing the grab here keeps the per-capture
    /// PowerShell work to a single call.
    public static Bitmap Grab(Rectangle bounds)
    {
        Bitmap frame = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppPArgb);
        using (Graphics canvas = Graphics.FromImage(frame))
        {
            canvas.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, frame.Size, CopyPixelOperation.SourceCopy);
        }
        return frame;
    }

    /// Run the overlay and return the finished image, or null when cancelled.
    public static Bitmap PickArea(Bitmap frozen, Rectangle screen, string hint, out bool confirmed)
    {
        using (SnipForm form = new SnipForm(frozen, screen, hint))
        {
            form.ShowDialog();
            confirmed = form.Confirmed;
            return form.Confirmed ? form.BuildResult() : null;
        }
    }

    public sealed class SnipForm : Form
    {
        /// A drag shorter than this is not a choice.
        private const int MinimumSide = 6;
        /// Magnifier window size and how many screen pixels it shows across.
        private const int LoupeSize = 134;
        private const int LoupeCells = 15;
        /// Annotation toolbar geometry.
        private const int ButtonSize = 26;
        private const int ButtonGap = 4;
        private const int BarPad = 6;
        /// Tool indexes, in toolbar order.
        private const int ToolArrow = 0;
        private const int ToolRect = 1;
        private const int ToolText = 2;
        private const int ToolMosaic = 3;
        private const int ToolUndo = 4;
        private const int ToolCancel = 5;
        private const int ToolConfirm = 6;
        private const int ToolCount = 7;
        /// Annotation kinds stored on a mark.
        private const int MarkArrow = 0;
        private const int MarkRect = 1;
        private const int MarkText = 2;
        private const int MarkMosaic = 3;

        private readonly Bitmap frame;
        private readonly Bitmap shaded;
        private readonly string hint;

        private readonly Pen border = new Pen(Color.FromArgb(255, 59, 110, 240), 1f);
        private readonly Pen halo = new Pen(Color.FromArgb(220, 255, 255, 255), 1f);
        private readonly Pen guideDark = new Pen(Color.FromArgb(96, 0, 0, 0), 1f);
        private readonly Pen guideLight = new Pen(Color.FromArgb(140, 255, 255, 255), 1f);
        private readonly Pen grid = new Pen(Color.FromArgb(34, 128, 132, 140), 1f);
        private readonly Pen pixelEdge = new Pen(Color.FromArgb(230, 255, 255, 255), 1f);
        private readonly Pen loupeEdge = new Pen(Color.FromArgb(70, 255, 255, 255), 1f);
        private readonly Brush loupeBack = new SolidBrush(Color.FromArgb(228, 22, 24, 28));
        private readonly Brush pillBack = new SolidBrush(Color.FromArgb(216, 22, 24, 28));
        private readonly Brush pillInk = new SolidBrush(Color.White);
        private readonly Brush barBack = new SolidBrush(Color.FromArgb(238, 20, 22, 26));
        private readonly Brush iconInk = new SolidBrush(Color.FromArgb(245, 255, 255, 255));
        private readonly Brush iconHot = new SolidBrush(Color.FromArgb(255, 59, 110, 240));
        private readonly Brush toolOn = new SolidBrush(Color.FromArgb(70, 59, 110, 240));
        private readonly Brush markInk = new SolidBrush(Color.FromArgb(255, 59, 110, 240));
        private readonly Brush markHalo = new SolidBrush(Color.FromArgb(150, 0, 0, 0));
        private readonly Font strong = new Font("Segoe UI", 9.5f, FontStyle.Bold);
        private readonly Font plain = new Font("Segoe UI", 8.5f, FontStyle.Regular);

        private readonly List<Mark> marks = new List<Mark>();

        private Point pointer;
        private Point? selA;
        private Point? selB;
        private bool editing;
        private int tool = ToolArrow;
        private bool drawingMark;
        private Point? markA;
        private Point? markB;
        private int hotButton = -1;
        private TextBox editor;

        public bool Confirmed;

        private sealed class Mark
        {
            public int Kind;
            public Point A;
            public Point B;
            public string Text;
        }

        public SnipForm(Bitmap source, Rectangle bounds, string hintText)
        {
            this.frame = source;
            this.hint = hintText == null ? "" : hintText.Trim();
            this.shaded = Shade(source, 0.45f);
            this.FormBorderStyle = FormBorderStyle.None;
            this.StartPosition = FormStartPosition.Manual;
            this.Bounds = bounds;
            this.TopMost = true;
            this.ShowInTaskbar = false;
            this.Cursor = Cursors.Cross;
            this.KeyPreview = true;
            this.DoubleBuffered = true;
            this.SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint, true);
            this.pointer = new Point(bounds.Width / 2, bounds.Height / 2);
        }

        /// A pre-darkened copy of the frame. A colour matrix is used instead of
        /// an alpha fill so the result never depends on the alpha handling of
        /// the destination bitmap.
        private static Bitmap Shade(Bitmap source, float scale)
        {
            Bitmap copy = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppPArgb);
            ColorMatrix matrix = new ColorMatrix();
            matrix.Matrix00 = scale;
            matrix.Matrix11 = scale;
            matrix.Matrix22 = scale;
            matrix.Matrix33 = 1f;
            matrix.Matrix40 = 0f;
            matrix.Matrix41 = 0f;
            matrix.Matrix42 = 0f;
            matrix.Matrix43 = 0f;
            ImageAttributes attributes = new ImageAttributes();
            attributes.SetColorMatrix(matrix, ColorMatrixFlag.Default, ColorAdjustType.Bitmap);
            using (Graphics canvas = Graphics.FromImage(copy))
            {
                Rectangle whole = new Rectangle(0, 0, source.Width, source.Height);
                canvas.DrawImage(source, whole, whole.X, whole.Y, whole.Width, whole.Height, GraphicsUnit.Pixel, attributes);
            }
            attributes.Dispose();
            return copy;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                if (this.editor != null) { this.editor.Dispose(); this.editor = null; }
                this.shaded.Dispose();
                this.border.Dispose();
                this.halo.Dispose();
                this.guideDark.Dispose();
                this.guideLight.Dispose();
                this.grid.Dispose();
                this.pixelEdge.Dispose();
                this.loupeEdge.Dispose();
                this.loupeBack.Dispose();
                this.pillBack.Dispose();
                this.pillInk.Dispose();
                this.barBack.Dispose();
                this.iconInk.Dispose();
                this.iconHot.Dispose();
                this.toolOn.Dispose();
                this.markInk.Dispose();
                this.markHalo.Dispose();
                this.strong.Dispose();
                this.plain.Dispose();
            }
            base.Dispose(disposing);
        }

        /// Hiding our own windows can hand the foreground to another app, and a
        /// window shown afterwards does not always get it back. Windows' own
        /// foreground lock is bypassed by briefly sharing input with the window
        /// that holds it, so Escape works before the first click.
        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            this.Activate();
            this.BringToFront();

            uint ignored;
            IntPtr foreground = DshScreenSnip.GetForegroundWindow();
            uint foregroundThread = foreground == IntPtr.Zero
                ? 0u
                : DshScreenSnip.GetWindowThreadProcessId(foreground, out ignored);
            uint ownThread = DshScreenSnip.GetCurrentThreadId();
            bool attached = foregroundThread != 0u
                && foregroundThread != ownThread
                && DshScreenSnip.AttachThreadInput(foregroundThread, ownThread, true);

            DshScreenSnip.SetForegroundWindow(this.Handle);
            this.Focus();

            if (attached) DshScreenSnip.AttachThreadInput(foregroundThread, ownThread, false);
        }

        /// The rectangle printed by the current drag, if it is a real one.
        private Rectangle? Selection()
        {
            if (!this.selA.HasValue || !this.selB.HasValue) return null;
            Rectangle area = From(this.selA.Value, this.selB.Value);
            area.Intersect(this.ClientRectangle);
            if (area.Width <= 0 || area.Height <= 0) return null;
            return area;
        }

        private static Rectangle From(Point a, Point b)
        {
            int left = Math.Min(a.X, b.X);
            int top = Math.Min(a.Y, b.Y);
            int right = Math.Max(a.X, b.X);
            int bottom = Math.Max(a.Y, b.Y);
            return Rectangle.FromLTRB(left, top, right, bottom);
        }

        // ---- painting -------------------------------------------------------

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.CompositingMode = CompositingMode.SourceOver;
            g.InterpolationMode = InterpolationMode.NearestNeighbor;
            g.PixelOffsetMode = PixelOffsetMode.Half;
            g.TextRenderingHint = TextRenderingHint.AntiAlias;

            Rectangle screen = this.ClientRectangle;
            Rectangle whole = new Rectangle(0, 0, this.frame.Width, this.frame.Height);
            g.DrawImage(this.shaded, whole, whole.X, whole.Y, whole.Width, whole.Height, GraphicsUnit.Pixel);

            Rectangle? selection = this.Selection();
            if (selection.HasValue)
            {
                Rectangle box = selection.Value;
                g.DrawImage(this.frame, box, box.X, box.Y, box.Width, box.Height, GraphicsUnit.Pixel);
                g.SetClip(box, CombineMode.Replace);
                for (int i = 0; i < this.marks.Count; i++) this.PaintMark(g, this.frame, this.marks[i], 0, 0);
                if (this.drawingMark && this.markA.HasValue && this.markB.HasValue)
                {
                    Mark preview = this.PendingMark();
                    if (preview != null) this.PaintMark(g, this.frame, preview, 0, 0);
                }
                g.ResetClip();
                this.DrawBorder(g, box);

                if (this.editing)
                {
                    this.DrawToolbar(g, box);
                }
                else
                {
                    this.DrawPill(g, this.strong, box.Width + " x " + box.Height, box.Left + box.Width / 2, box.Top - 10, true);
                }
            }
            else
            {
                if (this.hint.Length > 0) this.DrawPill(g, this.plain, this.hint, screen.Width / 2, 22, true);
            }

            if (!this.editing) this.DrawLoupe(g);
            else this.DrawPill(g, this.plain, this.pointer.X + ", " + this.pointer.Y, screen.Width / 2, screen.Height - 30, true);
        }

        private void DrawBorder(Graphics g, Rectangle box)
        {
            g.SmoothingMode = SmoothingMode.None;
            g.DrawRectangle(this.halo, box.X - 1, box.Y - 1, box.Width + 1, box.Height + 1);
            g.DrawRectangle(this.border, box.X, box.Y, box.Width - 1, box.Height - 1);
        }

        private void DrawGuides(Graphics g, Point at)
        {
            Rectangle screen = this.ClientRectangle;
            g.SmoothingMode = SmoothingMode.None;
            g.DrawLine(this.guideDark, 0, at.Y, screen.Width, at.Y);
            g.DrawLine(this.guideDark, at.X, 0, at.X, screen.Height);
            g.DrawLine(this.guideLight, 0, at.Y + 1, screen.Width, at.Y + 1);
            g.DrawLine(this.guideLight, at.X + 1, 0, at.X + 1, screen.Height);
        }

        /// A magnified patch of the frozen frame, its pixel grid, and the pixel
        /// under the pointer, placed beside the pointer without leaving the screen.
        private void DrawLoupe(Graphics g)
        {
            const int pad = 7;
            const int zoom = (LoupeSize - pad * 2) / LoupeCells;

            Rectangle screen = this.ClientRectangle;
            int side = LoupeCells * zoom + pad * 2;
            int x = this.pointer.X + 24;
            int y = this.pointer.Y + 24;
            if (x + side > screen.Width - 8) x = this.pointer.X - 24 - side;
            if (y + side > screen.Height - 8) y = this.pointer.Y - 24 - side;
            x = Clamp(x, 8, Math.Max(8, screen.Width - side - 8));
            y = Clamp(y, 8, Math.Max(8, screen.Height - side - 8));

            int half = LoupeCells / 2;
            int sx = Clamp(this.pointer.X - half, 0, Math.Max(0, this.frame.Width - LoupeCells));
            int sy = Clamp(this.pointer.Y - half, 0, Math.Max(0, this.frame.Height - LoupeCells));
            Rectangle source = new Rectangle(sx, sy, LoupeCells, LoupeCells);
            Rectangle body = new Rectangle(x + pad, y + pad, LoupeCells * zoom, LoupeCells * zoom);

            g.SmoothingMode = SmoothingMode.AntiAlias;
            GraphicsPath shell = Rounded(new Rectangle(x, y, side, side), 14);
            g.FillPath(this.loupeBack, shell);

            g.SetClip(body, CombineMode.Replace);
            g.DrawImage(this.frame, body, source, GraphicsUnit.Pixel);

            g.SmoothingMode = SmoothingMode.None;
            for (int i = 0; i <= LoupeCells; i++)
            {
                g.DrawLine(this.grid, body.Left + i * zoom, body.Top, body.Left + i * zoom, body.Bottom);
                g.DrawLine(this.grid, body.Left, body.Top + i * zoom, body.Right, body.Top + i * zoom);
            }
            g.ResetClip();

            // The pointer's own pixel, framed so it reads as the exact target.
            int cellX = body.Left + (this.pointer.X - sx) * zoom;
            int cellY = body.Top + (this.pointer.Y - sy) * zoom;
            g.DrawRectangle(this.pixelEdge, cellX, cellY, zoom, zoom);
            g.DrawLine(this.border, cellX, body.Top, cellX + zoom, body.Top);
            g.DrawLine(this.border, cellX, body.Bottom - 1, cellX + zoom, body.Bottom - 1);
            g.DrawLine(this.border, cellX, body.Top, cellX, body.Bottom);
            g.DrawLine(this.border, cellX + zoom - 1, body.Top, cellX + zoom - 1, body.Bottom);

            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.DrawPath(this.loupeEdge, shell);
            shell.Dispose();

            this.DrawPill(g, this.plain, this.pointer.X + ", " + this.pointer.Y, x + side / 2, y + side + 6, false);
        }

        /// Annotation toolbar under (or over) the selection.
        private void DrawToolbar(Graphics g, Rectangle box)
        {
            Rectangle bar = this.BarRect(box);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            GraphicsPath shell = Rounded(bar, 10);
            g.FillPath(this.barBack, shell);
            g.DrawPath(this.loupeEdge, shell);
            shell.Dispose();

            for (int i = 0; i < ToolCount; i++)
            {
                Rectangle slot = this.ButtonRect(bar, i);
                bool selected = (i == this.tool && i <= ToolMosaic);
                if (selected || i == this.hotButton)
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    GraphicsPath hot = Rounded(slot, 7);
                    g.FillPath(selected ? this.toolOn : this.loupeBack, hot);
                    hot.Dispose();
                }
                this.DrawIcon(g, slot, i);
            }
        }

        private void DrawIcon(Graphics g, Rectangle slot, int index)
        {
            int cx = slot.Left + slot.Width / 2;
            int cy = slot.Top + slot.Height / 2;
            g.SmoothingMode = SmoothingMode.None;
            switch (index)
            {
                case ToolArrow:
                    g.DrawLine(this.border, cx - 5, cy + 5, cx + 4, cy - 4);
                    g.FillPolygon(this.markInk, new Point[] {
                        new Point(cx + 6, cy - 6),
                        new Point(cx + 2, cy - 6),
                        new Point(cx + 6, cy - 2) });
                    break;
                case ToolRect:
                    g.DrawRectangle(this.iconInkPen(), cx - 5, cy - 4, 10, 8);
                    break;
                case ToolText:
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.DrawString("T", this.strong, this.iconInk, cx - 4, cy - 8);
                    break;
                case ToolMosaic:
                    {
                        Brush ink = this.iconInk;
                        g.FillRectangle(ink, cx - 5, cy - 4, 3, 3);
                        g.FillRectangle(ink, cx + 1, cy - 4, 3, 3);
                        g.FillRectangle(ink, cx - 2, cy, 3, 3);
                        g.FillRectangle(ink, cx + 2, cy + 1, 3, 3);
                        break;
                    }
                case ToolUndo:
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.DrawArc(this.iconPen(), cx - 5, cy - 4, 10, 8, 200, 230);
                    g.FillPolygon(this.iconInk, new Point[] {
                        new Point(cx - 6, cy - 4),
                        new Point(cx - 2, cy - 6),
                        new Point(cx - 2, cy - 1) });
                    break;
                case ToolCancel:
                    g.DrawLine(this.iconPen(), cx - 4, cy - 4, cx + 4, cy + 4);
                    g.DrawLine(this.iconPen(), cx + 4, cy - 4, cx - 4, cy + 4);
                    break;
                case ToolConfirm:
                    g.DrawLine(this.border, cx - 5, cy, cx - 1, cy + 4);
                    g.DrawLine(this.border, cx - 1, cy + 4, cx + 5, cy - 4);
                    break;
            }
        }

        private Pen iconPen()
        {
            return new Pen(Color.FromArgb(245, 255, 255, 255), 1.6f);
        }

        private Pen iconInkPen()
        {
            return new Pen(Color.FromArgb(245, 255, 255, 255), 1.6f);
        }

        /// One mark, drawn either on the overlay (shift 0) or onto the crop.
        private void PaintMark(Graphics g, Bitmap source, Mark mark, int shiftX, int shiftY)
        {
            Rectangle box = From(mark.A, mark.B);
            box.Offset(shiftX, shiftY);

            switch (mark.Kind)
            {
                case MarkArrow:
                    {
                        Point a = new Point(mark.A.X + shiftX, mark.A.Y + shiftY);
                        Point b = new Point(mark.B.X + shiftX, mark.B.Y + shiftY);
                        if (a == b) return;
                        using (Pen line = new Pen(Color.FromArgb(255, 59, 110, 240), 3f))
                        using (Pen outline = new Pen(Color.FromArgb(150, 0, 0, 0), 5f))
                        {
                            line.StartCap = LineCap.Round;
                            line.EndCap = LineCap.Round;
                            g.SmoothingMode = SmoothingMode.AntiAlias;
                            g.DrawLine(outline, a, b);
                            g.DrawLine(line, a, b);
                            double angle = Math.Atan2(b.Y - a.Y, b.X - a.X);
                            const int head = 13;
                            Point p1 = new Point(
                                b.X - (int)(head * Math.Cos(angle - 0.42)),
                                b.Y - (int)(head * Math.Sin(angle - 0.42)));
                            Point p2 = new Point(
                                b.X - (int)(head * Math.Cos(angle + 0.42)),
                                b.Y - (int)(head * Math.Sin(angle + 0.42)));
                            g.FillPolygon(this.markHalo, new Point[] { b, p1, p2 });
                            g.FillPolygon(this.markInk, new Point[] { b, p1, p2 });
                        }
                        break;
                    }
                case MarkRect:
                    {
                        if (box.Width < 2 || box.Height < 2) return;
                        g.SmoothingMode = SmoothingMode.None;
                        using (Pen line = new Pen(Color.FromArgb(255, 59, 110, 240), 3f))
                        using (Pen outline = new Pen(Color.FromArgb(150, 0, 0, 0), 5f))
                        {
                            g.DrawRectangle(outline, box);
                            g.DrawRectangle(line, box);
                        }
                        break;
                    }
                case MarkText:
                    {
                        if (string.IsNullOrEmpty(mark.Text)) return;
                        g.SmoothingMode = SmoothingMode.AntiAlias;
                        g.TextRenderingHint = TextRenderingHint.AntiAlias;
                        // Stroked outline, so the label stays readable on white
                        // and on dark content alike.
                        using (Font font = new Font("Segoe UI", 11f, FontStyle.Bold))
                        using (GraphicsPath path = new GraphicsPath())
                        using (StringFormat format = new StringFormat())
                        {
                            path.AddString(
                                mark.Text,
                                font.FontFamily,
                                (int)font.Style,
                                font.Size,
                                new PointF(box.Left, box.Top),
                                format);
                            using (Pen outline = new Pen(Color.FromArgb(215, 0, 0, 0), 3.2f))
                            {
                                outline.LineJoin = LineJoin.Round;
                                g.DrawPath(outline, path);
                            }
                            g.FillPath(this.pillInk, path);
                        }
                        break;
                    }
                case MarkMosaic:
                    {
                        Rectangle area = box;
                        Rectangle limit = new Rectangle(shiftX == 0 ? 0 : 0, 0, source.Width, source.Height);
                        area.Intersect(limit);
                        if (area.Width < 6 || area.Height < 6) return;
                        int blocks = Math.Max(2, area.Width / 10);
                        int smallW = blocks;
                        int smallH = Math.Max(2, area.Height * blocks / Math.Max(1, area.Width));
                        using (Bitmap cell = new Bitmap(smallW, smallH))
                        {
                            using (Graphics shrink = Graphics.FromImage(cell))
                            {
                                shrink.InterpolationMode = InterpolationMode.HighQualityBilinear;
                                shrink.DrawImage(source, new Rectangle(0, 0, smallW, smallH), area, GraphicsUnit.Pixel);
                            }
                            g.InterpolationMode = InterpolationMode.NearestNeighbor;
                            g.PixelOffsetMode = PixelOffsetMode.Half;
                            g.DrawImage(cell, area);
                            g.PixelOffsetMode = PixelOffsetMode.Half;
                            g.InterpolationMode = InterpolationMode.NearestNeighbor;
                        }
                        break;
                    }
            }
        }

        /// A rounded, translucent label. Centered on centerX; sits above the
        /// preferred top when room allows, otherwise below it.
        private void DrawPill(Graphics g, Font font, string text, int centerX, int preferredTop, bool above)
        {
            SizeF measured = g.MeasureString(text, font);
            int width = (int)Math.Ceiling(measured.Width) + 20;
            int height = (int)Math.Ceiling(measured.Height) + 10;
            Rectangle screen = this.ClientRectangle;

            int x = Clamp(centerX - width / 2, 8, Math.Max(8, screen.Width - width - 8));
            int y = preferredTop - height;
            if (!above) y = preferredTop;
            if (y < 8) y = preferredTop + 18;
            if (y + height > screen.Height - 8) y = screen.Height - height - 8;
            if (y < 8) y = 8;

            Rectangle box = new Rectangle(x, y, width, height);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            GraphicsPath shell = Rounded(box, 7);
            g.FillPath(this.pillBack, shell);
            g.DrawPath(this.loupeEdge, shell);
            shell.Dispose();

            g.SmoothingMode = SmoothingMode.None;
            g.DrawString(text, font, this.pillInk, box.X + 10, box.Y + 4);
        }

        private static GraphicsPath Rounded(Rectangle box, int radius)
        {
            GraphicsPath path = new GraphicsPath();
            int diameter = radius * 2;
            if (diameter > box.Width) diameter = box.Width;
            if (diameter > box.Height) diameter = box.Height;
            path.AddArc(box.X, box.Y, diameter, diameter, 180, 90);
            path.AddArc(box.Right - diameter, box.Y, diameter, diameter, 270, 90);
            path.AddArc(box.Right - diameter, box.Bottom - diameter, diameter, diameter, 0, 90);
            path.AddArc(box.X, box.Bottom - diameter, diameter, diameter, 90, 90);
            path.CloseFigure();
            return path;
        }

        private static int Clamp(int value, int low, int high)
        {
            if (value < low) return low;
            if (value > high) return high;
            return value;
        }

        // ---- toolbar geometry -------------------------------------------------

        private Rectangle BarRect(Rectangle box)
        {
            int width = ToolCount * ButtonSize + (ToolCount - 1) * ButtonGap + BarPad * 2;
            int height = ButtonSize + BarPad * 2;
            Rectangle screen = this.ClientRectangle;
            int x = Clamp(box.Left + box.Width / 2 - width / 2, 8, Math.Max(8, screen.Width - width - 8));
            int y = box.Bottom + 10;
            if (y + height > screen.Height - 8) y = box.Top - 10 - height;
            y = Clamp(y, 8, Math.Max(8, screen.Height - height - 8));
            return new Rectangle(x, y, width, height);
        }

        private Rectangle ButtonRect(Rectangle bar, int index)
        {
            return new Rectangle(
                bar.Left + BarPad + index * (ButtonSize + ButtonGap),
                bar.Top + BarPad,
                ButtonSize,
                ButtonSize);
        }

        private int HitButton(Point at)
        {
            Rectangle? selection = this.Selection();
            if (!selection.HasValue) return -1;
            Rectangle bar = this.BarRect(selection.Value);
            for (int i = 0; i < ToolCount; i++)
            {
                if (this.ButtonRect(bar, i).Contains(at)) return i;
            }
            return -1;
        }

        // ---- editing ----------------------------------------------------------

        private Mark PendingMark()
        {
            if (!this.markA.HasValue || !this.markB.HasValue) return null;
            Mark mark = new Mark();
            mark.Kind = this.tool;
            mark.A = this.markA.Value;
            mark.B = this.markB.Value;
            return mark;
        }

        private void AddMark(Mark mark)
        {
            Rectangle? selection = this.Selection();
            if (!selection.HasValue) return;
            Rectangle box = From(mark.A, mark.B);
            if (!box.IntersectsWith(selection.Value)) return;
            if (mark.Kind != MarkText && mark.Kind != MarkMosaic
                && (box.Width < 4 || box.Height < 4)) return;
            if (mark.Kind == MarkMosaic && (box.Width < 6 || box.Height < 6)) return;
            this.marks.Add(mark);
        }

        private void CommitMark()
        {
            Mark mark = this.PendingMark();
            this.drawingMark = false;
            this.markA = null;
            this.markB = null;
            if (mark != null) this.AddMark(mark);
            this.Invalidate();
        }

        private void OpenTextEditor(Point at)
        {
            this.CloseTextEditor(false);
            TextBox box = new TextBox();
            box.BorderStyle = BorderStyle.FixedSingle;
            box.Font = new Font("Segoe UI", 11f, FontStyle.Bold);
            box.BackColor = Color.White;
            box.ForeColor = Color.Black;
            box.Width = 200;
            box.Location = at;
            box.KeyDown += this.TextEditorKeyDown;
            box.LostFocus += this.TextEditorLostFocus;
            this.Controls.Add(box);
            box.Focus();
            this.editor = box;
            this.Invalidate();
        }

        private void TextEditorKeyDown(object sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; this.CloseTextEditor(true); return; }
            if (e.KeyCode == Keys.Escape) { e.SuppressKeyPress = true; this.CloseTextEditor(false); }
        }

        private void TextEditorLostFocus(object sender, EventArgs e)
        {
            this.CloseTextEditor(true);
        }

        private void CloseTextEditor(bool commit)
        {
            TextBox box = this.editor;
            if (box == null) return;
            this.editor = null;
            string text = box.Text;
            Rectangle bounds = box.Bounds;
            this.Controls.Remove(box);
            box.Dispose();
            if (commit && text != null && text.Trim().Length > 0)
            {
                Mark mark = new Mark();
                mark.Kind = MarkText;
                mark.A = bounds.Location;
                mark.B = bounds.Location;
                mark.Text = text.Trim();
                this.marks.Add(mark);
            }
            this.Invalidate();
        }

        /// Crop the selection and bake the marks at native resolution.
        public Bitmap BuildResult()
        {
            Rectangle? current = this.Selection();
            if (!current.HasValue) return null;
            Rectangle box = current.Value;
            Bitmap crop = this.frame.Clone(box, this.frame.PixelFormat);
            using (Graphics g = Graphics.FromImage(crop))
            {
                g.CompositingMode = CompositingMode.SourceOver;
                g.InterpolationMode = InterpolationMode.NearestNeighbor;
                g.PixelOffsetMode = PixelOffsetMode.Half;
                g.TextRenderingHint = TextRenderingHint.AntiAlias;
                for (int i = 0; i < this.marks.Count; i++)
                {
                    this.PaintMark(g, crop, this.marks[i], -box.X, -box.Y);
                }
            }
            return crop;
        }

        // ---- input ------------------------------------------------------------

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Button == MouseButtons.Right)
            {
                this.Confirmed = false;
                this.Close();
                return;
            }
            if (e.Button != MouseButtons.Left) return;
            this.pointer = e.Location;

            if (this.editing)
            {
                if (this.editor != null) { this.CloseTextEditor(true); return; }
                int button = this.HitButton(e.Location);
                if (button >= 0) { this.PressButton(button); return; }
                Rectangle? selection = this.Selection();
                if (!selection.HasValue || !selection.Value.Contains(e.Location)) return;
                if (e.Clicks >= 2)
                {
                    this.Confirmed = true;
                    this.Close();
                    return;
                }
                if (this.tool == ToolText)
                {
                    this.OpenTextEditor(new Point(e.Location.X, e.Location.Y - 10));
                    return;
                }
                this.drawingMark = true;
                this.markA = e.Location;
                this.markB = e.Location;
                this.Invalidate();
                return;
            }

            this.selA = e.Location;
            this.selB = e.Location;
            this.Invalidate();
        }

        private void PressButton(int index)
        {
            switch (index)
            {
                case ToolUndo:
                    if (this.marks.Count > 0)
                    {
                        this.marks.RemoveAt(this.marks.Count - 1);
                        this.Invalidate();
                    }
                    return;
                case ToolCancel:
                    this.Confirmed = false;
                    this.Close();
                    return;
                case ToolConfirm:
                    this.Confirmed = true;
                    this.Close();
                    return;
                default:
                    this.tool = index;
                    this.Invalidate();
                    return;
            }
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            this.pointer = e.Location;

            if (this.editing)
            {
                int hot = this.HitButton(e.Location);
                if (hot != this.hotButton)
                {
                    this.hotButton = hot;
                    this.Cursor = hot >= 0 ? Cursors.Hand : Cursors.Cross;
                    this.Invalidate();
                }
                if (this.drawingMark)
                {
                    this.markB = e.Location;
                    this.Invalidate();
                }
                return;
            }

            if (this.selA.HasValue && e.Button == MouseButtons.Left) this.selB = e.Location;
            this.Invalidate();
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (e.Button != MouseButtons.Left) return;

            if (this.editing)
            {
                if (!this.drawingMark) return;
                this.markB = e.Location;
                this.CommitMark();
                return;
            }

            if (!this.selA.HasValue) return;
            this.selB = e.Location;
            Rectangle? selection = this.Selection();
            if (!selection.HasValue
                || selection.Value.Width < MinimumSide
                || selection.Value.Height < MinimumSide)
            {
                // Too small to be a choice: keep the overlay for another try.
                this.selA = null;
                this.selB = null;
                this.Invalidate();
                return;
            }
            this.editing = true;
            this.Invalidate();
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            base.OnKeyDown(e);
            if (this.editor != null) return;

            if (e.KeyCode == Keys.Escape)
            {
                this.Confirmed = false;
                this.Close();
                return;
            }

            if (!this.editing) return;

            if (e.KeyCode == Keys.Enter)
            {
                this.Confirmed = true;
                this.Close();
                return;
            }
            if (e.Control && e.KeyCode == Keys.Z)
            {
                if (this.marks.Count > 0) { this.marks.RemoveAt(this.marks.Count - 1); this.Invalidate(); }
                return;
            }
            if (e.KeyCode == Keys.A) { this.tool = ToolArrow; this.Invalidate(); return; }
            if (e.KeyCode == Keys.R) { this.tool = ToolRect; this.Invalidate(); return; }
            if (e.KeyCode == Keys.T) { this.tool = ToolText; this.Invalidate(); return; }
            if (e.KeyCode == Keys.M) { this.tool = ToolMosaic; this.Invalidate(); return; }
        }
    }
}
