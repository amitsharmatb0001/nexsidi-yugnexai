#!/usr/bin/env python3
"""
NexuiIcons — custom geometric icon font for @yugnex/nexui
Generates fonts/NexuiIcons.woff2 using Python fonttools only (zero third-party icons).
Run from the package root: python3 scripts/build-icons.py
"""
import math, os, sys
from io import BytesIO

PI = math.pi
KAPPA = 0.5522847498

# Font metrics
UPM        = 1000
ASCENDER   =  800
DESCENDER  = -200
LINE_GAP   =    0
W          =  600   # advance width (all icons same width)
SW         =   66   # stroke width
# Icon canvas center
CX, CY = W // 2, 300   # horizontal center, vertical center

# Private Use Area codepoints → icon name
ICON_MAP = {
    "folder":        0xE001,
    "folder_open":   0xE002,
    "file":          0xE003,
    "check":         0xE004,
    "x_close":       0xE005,
    "chevron_r":     0xE006,
    "chevron_d":     0xE007,
    "chevron_l":     0xE008,
    "plus":          0xE009,
    "minus":         0xE00A,
    "trash":         0xE00B,
    "code":          0xE00C,
    "terminal":      0xE00D,
    "git_branch":    0xE00E,
    "git_commit":    0xE00F,
    "search":        0xE010,
    "eye":           0xE011,
    "copy":          0xE012,
    "clock":         0xE013,
    "warning":       0xE014,
    "info":          0xE015,
    "download":      0xE016,
    "link":          0xE017,
    "user":          0xE018,
    "dots_h":        0xE019,
    "refresh":       0xE01A,
    "arrow_r":       0xE01B,
    "arrow_u":       0xE01C,
    "settings":      0xE01D,
    "star":          0xE01E,
}

# ── Drawing helpers ────────────────────────────────────────────────────────────

def arc_segs(cx, cy, radius, a0, a1):
    """Cubic bezier segments for an arc from angle a0 to a1 (radians)."""
    steps = max(1, math.ceil(abs(a1 - a0) / (PI / 2)))
    step  = (a1 - a0) / steps
    k     = KAPPA * abs(step) / (PI / 2)
    segs  = []
    for i in range(steps):
        t0 = a0 + i * step
        t1 = t0 + step
        sx, sy = cx + radius * math.cos(t0), cy + radius * math.sin(t0)
        ex, ey = cx + radius * math.cos(t1), cy + radius * math.sin(t1)
        dx0 = -math.sin(t0) * radius * abs(step) / step
        dy0 =  math.cos(t0) * radius * abs(step) / step
        dx1 = -math.sin(t1) * radius * abs(step) / step
        dy1 =  math.cos(t1) * radius * abs(step) / step
        segs.append((
            sx + k * dx0, sy + k * dy0,
            ex - k * dx1, ey - k * dy1,
            ex, ey
        ))
    return segs

def _perp(x0, y0, x1, y1, hw):
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy)
    if L < 1e-9: return 0, hw
    return -dy / L * hw, dx / L * hw

def stroke(pen, pts, sw):
    """Filled stroke (thick line) through pts. Creates a capped rectangle."""
    if len(pts) < 2: return
    hw = sw / 2
    lefts, rights = [], []
    for i in range(len(pts) - 1):
        px, py = _perp(pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1], hw)
        lefts.append(((pts[i][0]+px, pts[i][1]+py), (pts[i+1][0]+px, pts[i+1][1]+py)))
        rights.append(((pts[i][0]-px, pts[i][1]-py), (pts[i+1][0]-px, pts[i+1][1]-py)))
    pen.moveTo(lefts[0][0])
    for seg in lefts:
        pen.lineTo(seg[1])
    pen.lineTo(rights[-1][1])
    for seg in reversed(rights):
        pen.lineTo(seg[0])
    pen.closePath()

def arc_stroke(pen, cx, cy, rad, a0, a1, sw):
    """Filled arc stroke (annular sector)."""
    ro, ri = rad + sw / 2, rad - sw / 2
    out_segs = arc_segs(cx, cy, ro, a0, a1)
    in_segs  = arc_segs(cx, cy, ri, a1, a0)
    pen.moveTo((cx + ro * math.cos(a0), cy + ro * math.sin(a0)))
    for s in out_segs:
        pen.curveTo((s[0], s[1]), (s[2], s[3]), (s[4], s[5]))
    pen.lineTo((cx + ri * math.cos(a1), cy + ri * math.sin(a1)))
    for s in in_segs:
        pen.curveTo((s[0], s[1]), (s[2], s[3]), (s[4], s[5]))
    pen.closePath()

def circle_ring(pen, cx, cy, r_out, r_in):
    """Ring (donut) shape — outer CCW, inner CW for non-zero winding."""
    out = arc_segs(cx, cy, r_out,    0, 2 * PI)
    inn = arc_segs(cx, cy, r_in,  2*PI,     0)
    pen.moveTo((out[0][4], out[0][5]))
    for s in out: pen.curveTo((s[0],s[1]),(s[2],s[3]),(s[4],s[5]))
    pen.closePath()
    pen.moveTo((inn[0][4], inn[0][5]))
    for s in inn: pen.curveTo((s[0],s[1]),(s[2],s[3]),(s[4],s[5]))
    pen.closePath()

def disk(pen, cx, cy, r):
    """Filled circle disk."""
    segs = arc_segs(cx, cy, r, 0, 2 * PI)
    pen.moveTo((segs[0][4], segs[0][5]))
    for s in segs: pen.curveTo((s[0],s[1]),(s[2],s[3]),(s[4],s[5]))
    pen.closePath()

def filled_rect(pen, x0, y0, x1, y1):
    """Solid filled rectangle."""
    pen.moveTo((x0, y0))
    pen.lineTo((x0, y1))
    pen.lineTo((x1, y1))
    pen.lineTo((x1, y0))
    pen.closePath()

def rect_ring(pen, x0, y0, x1, y1, sw):
    """Rectangular ring (outlined rectangle). Outer CCW, inner CW."""
    # Outer CCW
    pen.moveTo((x0, y0))
    pen.lineTo((x0, y1))
    pen.lineTo((x1, y1))
    pen.lineTo((x1, y0))
    pen.closePath()
    # Inner hole CW
    ix0, iy0, ix1, iy1 = x0+sw, y0+sw, x1-sw, y1-sw
    if ix0 < ix1 and iy0 < iy1:
        pen.moveTo((ix0, iy0))
        pen.lineTo((ix1, iy0))
        pen.lineTo((ix1, iy1))
        pen.lineTo((ix0, iy1))
        pen.closePath()

# ── Icon drawing functions ─────────────────────────────────────────────────────

def draw_folder(pen, sw=SW):
    # Body outline (L-shape: bottom rect + tab on top-left)
    # Tab: x=60..240, y=430..510
    stroke(pen, [(60,510),(60,430),(240,430),(240,510)], sw)  # tab left+top+right
    stroke(pen, [(240,475),(540,475),(540,510),(60,510)], sw)  # full bottom
    # Body: x=60..540, y=80..475 (open top for tab area)
    stroke(pen, [(60,475),(60,80)], sw)   # left
    stroke(pen, [(60,80),(540,80)], sw)   # bottom
    stroke(pen, [(540,80),(540,475)], sw) # right
    stroke(pen, [(540,475),(240,475)], sw) # top-right section

def draw_folder_open(pen, sw=SW):
    # Same as folder but body sides open at top
    stroke(pen, [(60,510),(60,430),(240,430),(240,510)], sw)
    stroke(pen, [(240,475),(540,475),(540,510),(60,510)], sw)
    stroke(pen, [(60,475),(60,80)], sw)
    stroke(pen, [(60,80),(540,80)], sw)
    stroke(pen, [(540,80),(540,380)], sw)   # shorter right side
    stroke(pen, [(60,380),(60,475)], sw)    # left visible
    # Opening slash lines (3 lines suggesting open container)
    stroke(pen, [(120,340),(480,340)], sw//2)
    stroke(pen, [(120,260),(480,260)], sw//2)
    stroke(pen, [(120,180),(480,180)], sw//2)

def draw_file(pen, sw=SW):
    # Page outline with folded top-right corner
    # Main body: 80,80 to 460,620 minus top-right corner
    fold = 110  # fold size
    stroke(pen, [(80,80),(80,620),(460,620),(460,80+fold)], sw)   # left+bottom+right (up to fold)
    stroke(pen, [(460,80+fold),(460-fold,80),(80,80)], sw)         # folded top
    # Fold crease
    stroke(pen, [(460-fold,80),(460-fold,80+fold),(460,80+fold)], sw)

def draw_check(pen, sw=SW):
    stroke(pen, [(80,310),(220,470),(530,120)], sw)

def draw_x_close(pen, sw=SW):
    stroke(pen, [(100,540),(500,100)], sw)
    stroke(pen, [(500,540),(100,100)], sw)

def draw_chevron_r(pen, sw=SW):
    stroke(pen, [(160,100),(460,320),(160,540)], sw)

def draw_chevron_d(pen, sw=SW):
    stroke(pen, [(80,160),(300,430),(520,160)], sw)

def draw_chevron_l(pen, sw=SW):
    stroke(pen, [(440,100),(140,320),(440,540)], sw)

def draw_plus(pen, sw=SW):
    stroke(pen, [(300,80),(300,560)], sw)
    stroke(pen, [(60,320),(540,320)], sw)

def draw_minus(pen, sw=SW):
    stroke(pen, [(60,300),(540,300)], sw)

def draw_trash(pen, sw=SW):
    # Body rectangle
    rect_ring(pen, 90, 80, 510, 500, sw)
    # Lid
    stroke(pen, [(30,500),(570,500)], sw)
    # Handle arc on top
    arc_stroke(pen, 300, 500, 100, 0, PI, sw)
    # Three vertical lines inside
    for x in [200, 300, 400]:
        stroke(pen, [(x, 140),(x, 440)], sw//2)

def draw_code(pen, sw=SW):
    # < bracket
    stroke(pen, [(240,100),(60,320),(240,540)], sw)
    # > bracket
    stroke(pen, [(360,100),(540,320),(360,540)], sw)

def draw_terminal(pen, sw=SW):
    # > prompt
    stroke(pen, [(60,180),(220,320),(60,460)], sw)
    # underline cursor
    stroke(pen, [(260,460),(520,460)], sw)

def draw_git_branch(pen, sw=SW):
    # Main vertical line
    stroke(pen, [(200,80),(200,560)], sw)
    # Branch line going right
    stroke(pen, [(200,420),(420,260)], sw)
    # Dots at nodes
    disk(pen, 200, 80,  sw*0.9)   # top
    disk(pen, 200, 560, sw*0.9)   # bottom
    disk(pen, 420, 220, sw*0.9)   # branch end

def draw_git_commit(pen, sw=SW):
    # Horizontal line through center
    stroke(pen, [(60, 320),(540,320)], sw)
    # Circle in the middle (ring)
    circle_ring(pen, 300, 320, 90, 50)

def draw_search(pen, sw=SW):
    # Circle (ring)
    circle_ring(pen, 240, 360, 180, 120)
    # Handle diagonal (bottom-right)
    stroke(pen, [(370,240),(530,80)], sw)

def draw_eye(pen, sw=SW):
    # Outer eye shape — two arcs
    arc_stroke(pen, 300, 320, 220, PI*0.05, PI*0.95, sw)   # bottom arc
    arc_stroke(pen, 300, 320, 220, PI*1.05, PI*1.95, sw)   # top arc
    # Pupil
    disk(pen, 300, 320, 70)

def draw_copy(pen, sw=SW):
    # Back page (offset up-right)
    rect_ring(pen, 160, 200, 540, 600, sw)
    # Front page (offset down-left) — filled white to mask back
    filled_rect(pen, 60, 80, 420, 480)
    rect_ring(pen, 60, 80, 420, 480, sw)

def draw_clock(pen, sw=SW):
    # Circle outline
    circle_ring(pen, 300, 320, 220, 160)
    # Hour hand (pointing up-right)
    stroke(pen, [(300,320),(420,460)], sw)
    # Minute hand (pointing up)
    stroke(pen, [(300,320),(300,160)], sw)
    # Center dot
    disk(pen, 300, 320, sw*0.6)

def draw_warning(pen, sw=SW):
    # Triangle outline
    stroke(pen, [(300,80),(60,570),(540,570),(300,80)], sw)
    # ! exclamation
    stroke(pen, [(300,240),(300,430)], sw)
    disk(pen, 300, 510, sw*0.55)

def draw_info(pen, sw=SW):
    # Circle
    circle_ring(pen, 300, 320, 220, 160)
    # i dot
    disk(pen, 300, 470, sw*0.55)
    # i stem
    stroke(pen, [(300,400),(300,180)], sw)

def draw_download(pen, sw=SW):
    # Arrow stem + head
    stroke(pen, [(300,80),(300,420)], sw)
    stroke(pen, [(100,260),(300,460),(500,260)], sw)
    # Horizontal bar at bottom
    stroke(pen, [(80,540),(520,540)], sw)

def draw_link(pen, sw=SW):
    # Square with outward arrow (external link)
    # Box
    stroke(pen, [(80,80),(80,540),(520,540),(520,260)], sw)
    stroke(pen, [(520,260),(520,80),(300,80)], sw)
    # Arrow
    stroke(pen, [(300,80),(540,80)], sw)
    stroke(pen, [(540,80),(540,320)], sw)
    stroke(pen, [(380,200),(540,80)], sw)

def draw_user(pen, sw=SW):
    # Head circle
    circle_ring(pen, 300, 500, 120, 60)
    # Shoulders arc (below head)
    arc_stroke(pen, 300, 110, 230, 0, PI, sw)

def draw_dots_h(pen, sw=SW):
    # Three horizontal dots
    for x in [140, 300, 460]:
        disk(pen, x, 320, sw*0.85)

def draw_refresh(pen, sw=SW):
    # Partial arc
    arc_stroke(pen, 300, 320, 200, PI*0.15, PI*1.85, sw)
    # Arrow head at end (top-right)
    stroke(pen, [(480,480),(500,320),(340,300)], sw)

def draw_arrow_r(pen, sw=SW):
    stroke(pen, [(60,320),(520,320)], sw)
    stroke(pen, [(320,100),(540,320),(320,540)], sw)

def draw_arrow_u(pen, sw=SW):
    stroke(pen, [(300,60),(300,560)], sw)
    stroke(pen, [(80,280),(300,60),(520,280)], sw)

def draw_settings(pen, sw=SW):
    # Gear: circle + 8 rectangular teeth
    circle_ring(pen, 300, 320, 130, 80)
    for i in range(8):
        a = i * PI / 4
        x0 = 300 + 130 * math.cos(a)
        y0 = 320 + 130 * math.sin(a)
        x1 = 300 + 210 * math.cos(a)
        y1 = 320 + 210 * math.sin(a)
        stroke(pen, [(x0, y0),(x1, y1)], sw)

def draw_star(pen, sw=SW):
    # Five-point star outline
    pts = []
    for i in range(10):
        a = PI/2 + i * PI / 5
        r = 220 if i % 2 == 0 else 90
        pts.append((300 + r * math.cos(a), 320 + r * math.sin(a)))
    pts.append(pts[0])
    stroke(pen, pts, sw)

# Map icon names to drawing functions
DRAW_FNS = {
    "folder":       draw_folder,
    "folder_open":  draw_folder_open,
    "file":         draw_file,
    "check":        draw_check,
    "x_close":      draw_x_close,
    "chevron_r":    draw_chevron_r,
    "chevron_d":    draw_chevron_d,
    "chevron_l":    draw_chevron_l,
    "plus":         draw_plus,
    "minus":        draw_minus,
    "trash":        draw_trash,
    "code":         draw_code,
    "terminal":     draw_terminal,
    "git_branch":   draw_git_branch,
    "git_commit":   draw_git_commit,
    "search":       draw_search,
    "eye":          draw_eye,
    "copy":         draw_copy,
    "clock":        draw_clock,
    "warning":      draw_warning,
    "info":         draw_info,
    "download":     draw_download,
    "link":         draw_link,
    "user":         draw_user,
    "dots_h":       draw_dots_h,
    "refresh":      draw_refresh,
    "arrow_r":      draw_arrow_r,
    "arrow_u":      draw_arrow_u,
    "settings":     draw_settings,
    "star":         draw_star,
}

# ── Font builder ───────────────────────────────────────────────────────────────

def build_icon_font():
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.t2CharStringPen import T2CharStringPen

    glyph_order = [".notdef", "space"] + list(ICON_MAP.keys())
    cmap = {cp: name for name, cp in ICON_MAP.items()}
    cmap[0x0020] = "space"

    char_strings = {}

    # .notdef — empty box
    pen = T2CharStringPen(W, {})
    rect_ring(pen, 80, 80, 520, 560, SW)
    char_strings[".notdef"] = pen.getCharString()

    # space — blank glyph (endPath only)
    pen = T2CharStringPen(W, {})
    pen.endPath()
    char_strings["space"] = pen.getCharString()

    # All icons
    for name, draw_fn in DRAW_FNS.items():
        pen = T2CharStringPen(W, {})
        draw_fn(pen)
        char_strings[name] = pen.getCharString()

    fb = FontBuilder(UPM, isTTF=False)
    fb.setupGlyphOrder(glyph_order)
    fb.setupCharacterMap(cmap)

    metrics = {g: (W, 0) for g in glyph_order}
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ASCENDER, descent=DESCENDER, lineGap=LINE_GAP)

    fb.setupNameTable({
        "familyName":   "NexuiIcons",
        "styleName":    "Regular",
        "fullName":     "NexuiIcons Regular",
        "version":      "Version 2.0.0",
        "psName":       "NexuiIcons-Regular",
        "manufacturer": "YugNex Technology (OPC) Private Limited",
        "copyright":    "Copyright 2026 YugNex Technology OPC Pvt Ltd",
    })

    fb.setupOS2(
        sTypoAscender=ASCENDER, sTypoDescender=DESCENDER, sTypoLineGap=LINE_GAP,
        usWinAscent=ASCENDER, usWinDescent=abs(DESCENDER),
        fsType=0x0004, achVendID="YNGX",
        fsSelection=0x40,
        ulUnicodeRange1=0x00000001,
        ulCodePageRange1=0x00000001,
    )

    fb.setupPost(isFixedPitch=True)
    fb.setupHead(unitsPerEm=UPM)

    fb.setupCFF(
        psName="NexuiIcons-Regular",
        fontInfo={"FullName": "NexuiIcons Regular", "FamilyName": "NexuiIcons",
                  "Weight": "Regular", "isFixedPitch": False,
                  "UnderlinePosition": -100, "UnderlineThickness": 50},
        charStringsDict=char_strings,
        privateDict={"defaultWidthX": W, "nominalWidthX": 0},
    )

    return fb.font

def save_woff2(font, filename):
    from fontTools.ttLib.woff2 import compress
    out_dir = os.path.join(os.path.dirname(__file__), "..", "fonts")
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, filename)
    otf_buf = BytesIO()
    font.save(otf_buf)
    otf_buf.seek(0)
    woff2_buf = BytesIO()
    compress(otf_buf, woff2_buf)
    with open(path, "wb") as f:
        f.write(woff2_buf.getvalue())
    print(f"  ✓ {filename} ({len(woff2_buf.getvalue()):,} bytes)")

if __name__ == "__main__":
    print("Building NexuiIcons...")
    font = build_icon_font()
    save_woff2(font, "NexuiIcons.woff2")
    print(f"Done — {len(ICON_MAP)} icons")
