#!/usr/bin/env python3
"""
NexuiSans / NexuiMono font builder.
Build-time only. Output: WOFF2 files in ../fonts/
Run: python3 scripts/build-fonts.py
Requires: pip install fonttools brotli
"""

import math
import os
import sys

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fonts")
os.makedirs(OUT_DIR, exist_ok=True)

# ── Metrics ──────────────────────────────────────────────────────────────────
UPM       = 1000
CAP_H     = 680
X_H       = 490
ASCENDER  = 760
DESCENDER = -240
LINE_GAP  = 0
KAPPA     = 0.5522847498   # cubic bezier approximation for quarter circle

SW = {"Regular": 68, "Medium": 82, "Bold": 108}
PI = math.pi

# ── Drawing primitives ────────────────────────────────────────────────────────

def r(v):
    """Round to int for clean coordinates."""
    return int(round(v))


def arc_segs(cx, cy, radius, a0, a1):
    """Cubic bezier segments approximating an arc from a0 to a1 (radians).
    Returns list of (cp1x, cp1y, cp2x, cp2y, ex, ey)."""
    steps = max(1, math.ceil(abs(a1 - a0) / (PI / 2)))
    step  = (a1 - a0) / steps
    segs  = []
    for i in range(steps):
        sa = a0 + i * step
        ea = sa + step
        tan_half = math.tan((ea - sa) / 2)
        alpha = math.sin(ea - sa) * (math.sqrt(4 + 3 * tan_half**2) - 1) / 3
        sx, sy = cx + radius * math.cos(sa), cy + radius * math.sin(sa)
        ex, ey = cx + radius * math.cos(ea), cy + radius * math.sin(ea)
        cp1x = sx + alpha * (-radius * math.sin(sa))
        cp1y = sy + alpha * ( radius * math.cos(sa))
        cp2x = ex - alpha * (-radius * math.sin(ea))
        cp2y = ey - alpha * ( radius * math.cos(ea))
        segs.append((cp1x, cp1y, cp2x, cp2y, ex, ey))
    return segs


def draw_circle(pen, cx, cy, rad):
    """Filled circle."""
    pen.moveTo((r(cx), r(cy + rad)))
    for s in arc_segs(cx, cy, rad, PI/2, PI*5/2):
        pen.curveTo((r(s[0]), r(s[1])), (r(s[2]), r(s[3])), (r(s[4]), r(s[5])))
    pen.closePath()


def draw_ring(pen, cx, cy, r_out, r_in):
    """Filled ring (donut). Outer CCW, inner CW for counter-winding hole."""
    pen.moveTo((r(cx), r(cy + r_out)))
    for s in arc_segs(cx, cy, r_out, PI/2, PI*5/2):
        pen.curveTo((r(s[0]), r(s[1])), (r(s[2]), r(s[3])), (r(s[4]), r(s[5])))
    pen.closePath()
    pen.moveTo((r(cx), r(cy + r_in)))
    for s in arc_segs(cx, cy, r_in, PI/2, -PI*3/2):
        pen.curveTo((r(s[0]), r(s[1])), (r(s[2]), r(s[3])), (r(s[4]), r(s[5])))
    pen.closePath()


def draw_rect(pen, x, y, w, h):
    pen.moveTo((r(x),   r(y)))
    pen.lineTo((r(x+w), r(y)))
    pen.lineTo((r(x+w), r(y+h)))
    pen.lineTo((r(x),   r(y+h)))
    pen.closePath()


def stroke(pen, pts, sw):
    """Expand polyline to filled stroke (flat caps, miter joins)."""
    if len(pts) < 2:
        return
    half = sw / 2

    def perp(ax, ay, bx, by):
        dx, dy = bx-ax, by-ay
        ln = math.sqrt(dx*dx + dy*dy) or 1
        return -dy/ln, dx/ln

    tops, bots = [], []
    for i in range(len(pts)):
        x, y = pts[i]
        if i < len(pts)-1:
            nx, ny = perp(*pts[i], *pts[i+1])
        else:
            nx, ny = perp(*pts[-2], *pts[-1])
        tops.append((x + nx*half, y + ny*half))
        bots.append((x - nx*half, y - ny*half))

    pen.moveTo((r(tops[0][0]), r(tops[0][1])))
    for p in tops[1:]:
        pen.lineTo((r(p[0]), r(p[1])))
    for p in reversed(bots):
        pen.lineTo((r(p[0]), r(p[1])))
    pen.closePath()


def arc_stroke(pen, cx, cy, rad, a0, a1, sw):
    """Stroked arc (annular sector)."""
    r_out = rad + sw/2
    r_in  = rad - sw/2
    if r_in <= 0:
        r_in = 1
    s_out = arc_segs(cx, cy, r_out, a0, a1)
    s_in  = arc_segs(cx, cy, r_in,  a1, a0)
    sx = cx + r_out * math.cos(a0)
    sy = cy + r_out * math.sin(a0)
    pen.moveTo((r(sx), r(sy)))
    for s in s_out:
        pen.curveTo((r(s[0]), r(s[1])), (r(s[2]), r(s[3])), (r(s[4]), r(s[5])))
    ex_in = cx + r_in * math.cos(a1)
    ey_in = cy + r_in * math.sin(a1)
    pen.lineTo((r(ex_in), r(ey_in)))
    for s in s_in:
        pen.curveTo((r(s[0]), r(s[1])), (r(s[2]), r(s[3])), (r(s[4]), r(s[5])))
    pen.closePath()


# ── Glyph draw functions ──────────────────────────────────────────────────────
# Each takes (pen, sw) where sw = stroke width.

def g_notdef(pen, sw):
    draw_rect(pen, 60, 0, 380, CAP_H)
    draw_rect(pen, 60+sw, sw, 380-sw*2, CAP_H-sw*2)

def g_space(pen, sw): pass

# ── Punctuation ───────────────────────────────────────────────────────────────

def g_period(pen, sw):    draw_circle(pen, 45, sw*0.7, sw*0.7)
def g_comma(pen, sw):
    draw_circle(pen, 45, sw*0.7, sw*0.7)
    stroke(pen, [(45, sw*0.7), (22, -sw*1.8)], sw*0.65)
def g_colon(pen, sw):
    draw_circle(pen, 45, sw*0.7, sw*0.7)
    draw_circle(pen, 45, X_H - sw*0.7, sw*0.7)
def g_semicolon(pen, sw):
    draw_circle(pen, 45, X_H - sw*0.7, sw*0.7)
    draw_circle(pen, 45, sw*0.7, sw*0.7)
    stroke(pen, [(45, sw*0.7), (22, -sw*1.8)], sw*0.65)
def g_exclam(pen, sw):
    stroke(pen, [(45, CAP_H), (45, X_H*0.32)], sw)
    draw_circle(pen, 45, sw*0.7, sw*0.7)
def g_question(pen, sw):
    arc_stroke(pen, 175, CAP_H - 140, 130, PI*0.18, PI*1.25, sw)
    stroke(pen, [(175, CAP_H-270), (175, X_H*0.32)], sw)
    draw_circle(pen, 175, sw*0.7, sw*0.7)
def g_hyphen(pen, sw):    stroke(pen, [(40, X_H*0.5), (210, X_H*0.5)], sw)
def g_underscore(pen, sw):stroke(pen, [(0, -sw*0.4), (300, -sw*0.4)], sw)
def g_slash(pen, sw):     stroke(pen, [(60, 0), (220, CAP_H)], sw)
def g_backslash(pen, sw): stroke(pen, [(60, CAP_H), (220, 0)], sw)
def g_pipe(pen, sw):      stroke(pen, [(60, DESCENDER+sw), (60, ASCENDER-sw)], sw)
def g_hash(pen, sw):
    stroke(pen, [(120, r(CAP_H*0.15)), (180, r(CAP_H*0.85))], sw)
    stroke(pen, [(220, r(CAP_H*0.15)), (280, r(CAP_H*0.85))], sw)
    stroke(pen, [(70, r(CAP_H*0.37)), (330, r(CAP_H*0.37))], sw)
    stroke(pen, [(70, r(CAP_H*0.63)), (330, r(CAP_H*0.63))], sw)
def g_at(pen, sw):
    arc_stroke(pen, 220, 260, 200, PI*0.25, PI*2.05, sw)
    arc_stroke(pen, 220, 260, 85, -PI*0.5, PI*1.1, sw)
    stroke(pen, [(390, 345), (390, 80)], sw)
    arc_stroke(pen, 390, 80, sw, -PI*0.5, PI*0.5, sw*0.5)
def g_dollar(pen, sw):
    arc_stroke(pen, 200, r(CAP_H*0.71), 130, PI*0.25, PI*1.35, sw)
    arc_stroke(pen, 200, r(CAP_H*0.35), 130, PI*1.25, PI*2.35, sw)
    stroke(pen, [(200, CAP_H+sw*0.6), (200, -sw*0.6)], sw*0.75)
def g_percent(pen, sw):
    draw_ring(pen, 105, r(CAP_H*0.76), r(sw*2.4), r(sw*0.9))
    draw_ring(pen, 295, r(CAP_H*0.24), r(sw*2.4), r(sw*0.9))
    stroke(pen, [(55, 0), (345, CAP_H)], sw)
def g_ampersand(pen, sw):
    arc_stroke(pen, 170, r(CAP_H*0.74), 135, PI*0.15, PI*2, sw)
    stroke(pen, [(170, r(CAP_H*0.74) - 135), (170+135, 0)], sw)
    stroke(pen, [(170, r(CAP_H*0.74)), (390, 0)], sw)
def g_apostrophe(pen, sw): stroke(pen, [(80, CAP_H), (50, r(CAP_H*0.72))], sw)
def g_quote(pen, sw):
    stroke(pen, [(60, CAP_H), (30, r(CAP_H*0.72))], sw)
    stroke(pen, [(175, CAP_H), (145, r(CAP_H*0.72))], sw)
def g_lparen(pen, sw):    arc_stroke(pen, 240, r(CAP_H*0.5), 290, PI*0.58, PI*1.42, sw)
def g_rparen(pen, sw):    arc_stroke(pen, 60, r(CAP_H*0.5), 290, -PI*0.42, PI*0.42, sw)
def g_lbracket(pen, sw):
    stroke(pen, [(170, CAP_H), (80, CAP_H), (80, 0), (170, 0)], sw)
def g_rbracket(pen, sw):
    stroke(pen, [(80, CAP_H), (170, CAP_H), (170, 0), (80, 0)], sw)
def g_lbrace(pen, sw):
    arc_stroke(pen, 200-sw*1.5, CAP_H-sw*1.5, sw*1.5, PI*0.5, PI, sw*0.8)
    stroke(pen, [(200, CAP_H), (200-sw*1.5, CAP_H)], sw)
    stroke(pen, [(200-sw*3, CAP_H-sw*1.5), (200-sw*3, r(CAP_H*0.5)+sw*1.5)], sw)
    arc_stroke(pen, 200-sw*4.5, r(CAP_H*0.5)+sw*1.5, sw*1.5, 0, PI*0.5, sw*0.8)
    arc_stroke(pen, 200-sw*4.5, r(CAP_H*0.5)-sw*1.5, sw*1.5, PI*1.5, PI*2, sw*0.8)
    stroke(pen, [(200-sw*3, r(CAP_H*0.5)-sw*1.5), (200-sw*3, sw*1.5)], sw)
    arc_stroke(pen, 200-sw*1.5, sw*1.5, sw*1.5, PI, PI*1.5, sw*0.8)
    stroke(pen, [(200-sw*1.5, 0), (200, 0)], sw)
def g_rbrace(pen, sw):
    arc_stroke(pen, sw*1.5, CAP_H-sw*1.5, sw*1.5, 0, PI*0.5, sw*0.8)
    stroke(pen, [(0, CAP_H), (sw*1.5, CAP_H)], sw)
    stroke(pen, [(sw*3, CAP_H-sw*1.5), (sw*3, r(CAP_H*0.5)+sw*1.5)], sw)
    arc_stroke(pen, sw*4.5, r(CAP_H*0.5)+sw*1.5, sw*1.5, PI*0.5, PI, sw*0.8)
    arc_stroke(pen, sw*4.5, r(CAP_H*0.5)-sw*1.5, sw*1.5, PI, PI*1.5, sw*0.8)
    stroke(pen, [(sw*3, r(CAP_H*0.5)-sw*1.5), (sw*3, sw*1.5)], sw)
    arc_stroke(pen, sw*1.5, sw*1.5, sw*1.5, PI*1.5, PI*2, sw*0.8)
    stroke(pen, [(sw*1.5, 0), (0, 0)], sw)
def g_plus(pen, sw):
    stroke(pen, [(50, r(CAP_H*0.5)), (330, r(CAP_H*0.5))], sw)
    stroke(pen, [(190, r(CAP_H*0.2)), (190, r(CAP_H*0.8))], sw)
def g_equal(pen, sw):
    stroke(pen, [(50, r(CAP_H*0.42)), (330, r(CAP_H*0.42))], sw)
    stroke(pen, [(50, r(CAP_H*0.62)), (330, r(CAP_H*0.62))], sw)
def g_lt(pen, sw):  stroke(pen, [(300, r(CAP_H*0.8)), (80, r(CAP_H*0.5)), (300, r(CAP_H*0.2))], sw)
def g_gt(pen, sw):  stroke(pen, [(80, r(CAP_H*0.8)), (300, r(CAP_H*0.5)), (80, r(CAP_H*0.2))], sw)
def g_caret(pen, sw): stroke(pen, [(60, r(CAP_H*0.5)), (190, r(CAP_H*0.85)), (320, r(CAP_H*0.5))], sw)
def g_tilde(pen, sw):
    arc_stroke(pen, 110, r(X_H*0.5), 60, PI, PI*2, sw)
    arc_stroke(pen, 270, r(X_H*0.5), 60, 0, PI, sw)
def g_grave(pen, sw): stroke(pen, [(55, CAP_H), (105, r(CAP_H*0.72))], sw)
def g_asterisk(pen, sw):
    cx, cy = 185, r(CAP_H*0.6)
    for deg in [90, 30, 150]:
        ra = deg * PI / 180
        stroke(pen, [(r(cx + math.cos(ra)*sw*2.8), r(cy + math.sin(ra)*sw*2.8)),
                     (r(cx - math.cos(ra)*sw*2.8), r(cy - math.sin(ra)*sw*2.8))], sw)


# ── Uppercase ─────────────────────────────────────────────────────────────────

def g_A(pen, sw):
    stroke(pen, [(0, 0), (310, CAP_H)], sw)
    stroke(pen, [(310, CAP_H), (620, 0)], sw)
    stroke(pen, [(r(620*0.18), r(CAP_H*0.42)), (r(620*0.82), r(CAP_H*0.42))], sw)

def g_B(pen, sw):
    stroke(pen, [(80, 0), (80, CAP_H)], sw)
    stroke(pen, [(80, CAP_H), (330, CAP_H)], sw)
    arc_stroke(pen, 330, CAP_H - 140, 140, -PI*0.5, PI*0.5, sw)
    stroke(pen, [(330, CAP_H-280), (80, CAP_H-280)], sw)
    stroke(pen, [(80, CAP_H//2), (350, CAP_H//2)], sw)
    arc_stroke(pen, 350, CAP_H//2 - 140, 140, -PI*0.5, PI*0.5, sw)
    stroke(pen, [(350, CAP_H//2-280), (80, CAP_H//2-280)], sw)

def g_C(pen, sw):
    arc_stroke(pen, 235, CAP_H//2, 220, PI*0.28, PI*1.72, sw)

def g_D(pen, sw):
    stroke(pen, [(80, 0), (80, CAP_H)], sw)
    stroke(pen, [(80, CAP_H), (270, CAP_H)], sw)
    arc_stroke(pen, 270, CAP_H//2, CAP_H//2, -PI*0.5, PI*0.5, sw)
    stroke(pen, [(270, 0), (80, 0)], sw)

def g_E(pen, sw):
    stroke(pen, [(80, 0), (80, CAP_H)], sw)
    stroke(pen, [(80, CAP_H), (420, CAP_H)], sw)
    stroke(pen, [(80, CAP_H//2), (370, CAP_H//2)], sw)
    stroke(pen, [(80, 0), (420, 0)], sw)

def g_F(pen, sw):
    stroke(pen, [(80, 0), (80, CAP_H)], sw)
    stroke(pen, [(80, CAP_H), (400, CAP_H)], sw)
    stroke(pen, [(80, CAP_H//2), (360, CAP_H//2)], sw)

def g_G(pen, sw):
    arc_stroke(pen, 235, CAP_H//2, 220, PI*0.28, PI*1.72, sw)
    stroke(pen, [(455, CAP_H//2), (235, CAP_H//2)], sw)
    stroke(pen, [(455, CAP_H//2), (455, sw*0.5)], sw)

def g_H(pen, sw):
    stroke(pen, [(80, 0), (80, CAP_H)], sw)
    stroke(pen, [(500, 0), (500, CAP_H)], sw)
    stroke(pen, [(80, CAP_H//2), (500, CAP_H//2)], sw)

def g_I(pen, sw):
    stroke(pen, [(90, 0), (90, CAP_H)], sw)
    stroke(pen, [(0, 0), (180, 0)], sw)
    stroke(pen, [(0, CAP_H), (180, CAP_H)], sw)

def g_J(pen, sw):
    stroke(pen, [(270, CAP_H), (270, sw*2)], sw)
    arc_stroke(pen, 150, sw*2, 120, 0, PI, sw)
    stroke(pen, [(30, sw*2), (30, r(CAP_H*0.4))], sw)
    stroke(pen, [(0, CAP_H), (360, CAP_H)], sw)

def g_K(pen, sw):
    stroke(pen, [(80, 0), (80, CAP_H)], sw)
    stroke(pen, [(80, r(CAP_H*0.45)), (450, CAP_H)], sw)
    stroke(pen, [(80, r(CAP_H*0.45)), (450, 0)], sw)

def g_L(pen, sw):
    stroke(pen, [(80, CAP_H), (80, 0)], sw)
    stroke(pen, [(80, 0), (440, 0)], sw)

def g_M(pen, sw):
    stroke(pen, [(60, 0), (60, CAP_H)], sw)
    stroke(pen, [(60, CAP_H), (280, r(CAP_H*0.35))], sw)
    stroke(pen, [(280, r(CAP_H*0.35)), (500, CAP_H)], sw)
    stroke(pen, [(500, CAP_H), (500, 0)], sw)

def g_N(pen, sw):
    stroke(pen, [(80, 0), (80, CAP_H)], sw)
    stroke(pen, [(80, CAP_H), (480, 0)], sw)
    stroke(pen, [(480, 0), (480, CAP_H)], sw)

def g_O(pen, sw):
    draw_ring(pen, 255, CAP_H//2, 245, 245 - sw)

def g_P(pen, sw):
    stroke(pen, [(80, 0), (80, CAP_H)], sw)
    stroke(pen, [(80, CAP_H), (330, CAP_H)], sw)
    arc_stroke(pen, 330, CAP_H - 155, 155, -PI*0.5, PI*0.5, sw)
    stroke(pen, [(330, CAP_H-310), (80, CAP_H-310)], sw)

def g_Q(pen, sw):
    draw_ring(pen, 255, CAP_H//2, 245, 245 - sw)
    stroke(pen, [(310, CAP_H//2 - 80), (470, -60)], sw)

def g_R(pen, sw):
    stroke(pen, [(80, 0), (80, CAP_H)], sw)
    stroke(pen, [(80, CAP_H), (310, CAP_H)], sw)
    arc_stroke(pen, 310, CAP_H - 150, 150, -PI*0.5, PI*0.5, sw)
    stroke(pen, [(310, CAP_H-300), (80, CAP_H-300)], sw)
    stroke(pen, [(265, CAP_H-300), (460, 0)], sw)

def g_S(pen, sw):
    arc_stroke(pen, 215, r(CAP_H*0.72), 165, PI*0.2, PI*1.5, sw)
    arc_stroke(pen, 215, r(CAP_H*0.32), 165, PI*1.2, PI*2.5, sw)

def g_T(pen, sw):
    stroke(pen, [(0, CAP_H), (500, CAP_H)], sw)
    stroke(pen, [(250, CAP_H), (250, 0)], sw)

def g_U(pen, sw):
    stroke(pen, [(80, CAP_H), (80, sw*2)], sw)
    arc_stroke(pen, 240, sw*2, 160, PI, PI*2, sw)
    stroke(pen, [(400, sw*2), (400, CAP_H)], sw)

def g_V(pen, sw):
    stroke(pen, [(0, CAP_H), (250, 0)], sw)
    stroke(pen, [(250, 0), (500, CAP_H)], sw)

def g_W(pen, sw):
    stroke(pen, [(0, CAP_H), (140, 0)], sw)
    stroke(pen, [(140, 0), (280, r(CAP_H*0.5))], sw)
    stroke(pen, [(280, r(CAP_H*0.5)), (420, 0)], sw)
    stroke(pen, [(420, 0), (560, CAP_H)], sw)

def g_X(pen, sw):
    stroke(pen, [(0, CAP_H), (460, 0)], sw)
    stroke(pen, [(0, 0), (460, CAP_H)], sw)

def g_Y(pen, sw):
    stroke(pen, [(0, CAP_H), (240, r(CAP_H*0.45))], sw)
    stroke(pen, [(480, CAP_H), (240, r(CAP_H*0.45))], sw)
    stroke(pen, [(240, r(CAP_H*0.45)), (240, 0)], sw)

def g_Z(pen, sw):
    stroke(pen, [(40, CAP_H), (440, CAP_H)], sw)
    stroke(pen, [(440, CAP_H), (40, 0)], sw)
    stroke(pen, [(40, 0), (440, 0)], sw)


# ── Lowercase ──────────────────────────────────────────────────────────────────

def g_a(pen, sw):
    arc_stroke(pen, 195, X_H//2, X_H//2 - sw, -PI*0.08, PI*1.95, sw)
    stroke(pen, [(375, X_H), (375, 0)], sw)

def g_b(pen, sw):
    stroke(pen, [(80, 0), (80, CAP_H)], sw)
    arc_stroke(pen, 235, X_H//2, X_H//2 - sw, -PI*0.5, PI*1.5, sw)
    stroke(pen, [(80, X_H//2), (235, X_H//2)], sw)

def g_c(pen, sw):
    arc_stroke(pen, 205, X_H//2, X_H//2 - sw, PI*0.28, PI*1.72, sw)

def g_d(pen, sw):
    arc_stroke(pen, 195, X_H//2, X_H//2 - sw, -PI*0.5, PI*1.5, sw)
    stroke(pen, [(370, 0), (370, CAP_H)], sw)
    stroke(pen, [(195, X_H//2), (370, X_H//2)], sw)

def g_e(pen, sw):
    arc_stroke(pen, 205, X_H//2, X_H//2 - sw, PI*0.05, PI*1.88, sw)
    stroke(pen, [(55, X_H//2), (360, X_H//2)], sw)

def g_f(pen, sw):
    arc_stroke(pen, 230, CAP_H - sw*2, sw*2, PI*0.5, PI, sw)
    stroke(pen, [(152, CAP_H - sw*2), (152, 0)], sw)
    stroke(pen, [(55, r(X_H*0.68)), (300, r(X_H*0.68))], sw)

def g_g(pen, sw):
    arc_stroke(pen, 200, X_H//2, X_H//2 - sw, -PI*0.05, PI*1.95, sw)
    stroke(pen, [(380, X_H), (380, DESCENDER + sw*2)], sw)
    arc_stroke(pen, 260, DESCENDER + sw*2, 120, 0, PI, sw)

def g_h(pen, sw):
    stroke(pen, [(80, 0), (80, CAP_H)], sw)
    arc_stroke(pen, 245, X_H - sw*2, sw*2, PI*0.5, PI, sw)
    stroke(pen, [(245, X_H - sw*2), (245, 0)], sw)

def g_i(pen, sw):
    draw_circle(pen, 80, r(CAP_H*0.83), r(sw*0.75))
    stroke(pen, [(80, 0), (80, X_H)], sw)
    stroke(pen, [(0, 0), (160, 0)], sw)

def g_j(pen, sw):
    draw_circle(pen, 120, r(CAP_H*0.83), r(sw*0.75))
    stroke(pen, [(120, X_H), (120, DESCENDER + sw*2)], sw)
    arc_stroke(pen, 0, DESCENDER + sw*2, 120, 0, PI*0.5, sw)

def g_k(pen, sw):
    stroke(pen, [(80, 0), (80, CAP_H)], sw)
    stroke(pen, [(80, r(X_H*0.45)), (370, X_H)], sw)
    stroke(pen, [(80, r(X_H*0.45)), (370, 0)], sw)

def g_l(pen, sw):
    stroke(pen, [(80, CAP_H), (80, sw*1.5)], sw)
    arc_stroke(pen, 160, sw*1.5, 80, PI, PI*2, sw*0.7)

def g_m(pen, sw):
    stroke(pen, [(60, 0), (60, X_H)], sw)
    arc_stroke(pen, 190, X_H - sw*2, sw*2, PI*0.5, PI, sw)
    stroke(pen, [(190, X_H - sw*2), (190, 0)], sw)
    arc_stroke(pen, 320, X_H - sw*2, sw*2, PI*0.5, PI, sw)
    stroke(pen, [(320, X_H - sw*2), (320, 0)], sw)

def g_n(pen, sw):
    stroke(pen, [(80, 0), (80, X_H)], sw)
    arc_stroke(pen, 245, X_H - sw*2, sw*2, PI*0.5, PI, sw)
    stroke(pen, [(245, X_H - sw*2), (245, 0)], sw)

def g_o(pen, sw):
    draw_ring(pen, 205, X_H//2, X_H//2, X_H//2 - sw)

def g_p(pen, sw):
    stroke(pen, [(80, DESCENDER + sw), (80, X_H)], sw)
    arc_stroke(pen, 235, X_H//2, X_H//2 - sw, -PI*0.5, PI*1.5, sw)
    stroke(pen, [(80, X_H//2), (235, X_H//2)], sw)

def g_q(pen, sw):
    arc_stroke(pen, 200, X_H//2, X_H//2 - sw, -PI*0.5, PI*1.5, sw)
    stroke(pen, [(375, X_H), (375, DESCENDER + sw)], sw)
    stroke(pen, [(200, X_H//2), (375, X_H//2)], sw)

def g_r(pen, sw):
    stroke(pen, [(80, 0), (80, X_H)], sw)
    arc_stroke(pen, 245, X_H - sw*2, sw*2, PI*0.5, PI, sw)
    stroke(pen, [(245, X_H - sw*2), (390, X_H - sw*2)], sw)

def g_s(pen, sw):
    arc_stroke(pen, 190, r(X_H*0.72), 140, PI*0.2, PI*1.5, sw)
    arc_stroke(pen, 190, r(X_H*0.32), 140, PI*1.2, PI*2.5, sw)

def g_t(pen, sw):
    stroke(pen, [(130, r(CAP_H*0.8)), (130, sw*1.5)], sw)
    arc_stroke(pen, 258, sw*1.5, 128, PI, PI*2, sw*0.72)
    stroke(pen, [(30, r(X_H*0.75)), (280, r(X_H*0.75))], sw)

def g_u(pen, sw):
    stroke(pen, [(80, X_H), (80, sw*2)], sw)
    arc_stroke(pen, 210, sw*2, 130, PI, PI*2, sw)
    stroke(pen, [(340, sw*2), (340, X_H)], sw)

def g_v(pen, sw):
    stroke(pen, [(0, X_H), (200, 0)], sw)
    stroke(pen, [(200, 0), (400, X_H)], sw)

def g_w(pen, sw):
    stroke(pen, [(0, X_H), (110, 0)], sw)
    stroke(pen, [(110, 0), (220, r(X_H*0.5))], sw)
    stroke(pen, [(220, r(X_H*0.5)), (330, 0)], sw)
    stroke(pen, [(330, 0), (440, X_H)], sw)

def g_x(pen, sw):
    stroke(pen, [(0, X_H), (360, 0)], sw)
    stroke(pen, [(0, 0), (360, X_H)], sw)

def g_y(pen, sw):
    stroke(pen, [(0, X_H), (195, 0)], sw)
    stroke(pen, [(390, X_H), (195, 0)], sw)
    stroke(pen, [(195, 0), (70, DESCENDER + sw)], sw)

def g_z(pen, sw):
    stroke(pen, [(30, X_H), (370, X_H)], sw)
    stroke(pen, [(370, X_H), (30, 0)], sw)
    stroke(pen, [(30, 0), (370, 0)], sw)


# ── Digits ────────────────────────────────────────────────────────────────────

def g_0(pen, sw):
    draw_ring(pen, 245, CAP_H//2, 235, 235 - sw)
    stroke(pen, [(90, r(CAP_H*0.2)), (400, r(CAP_H*0.8))], sw)

def g_1(pen, sw):
    stroke(pen, [(100, r(CAP_H*0.75)), (245, CAP_H)], sw)
    stroke(pen, [(245, CAP_H), (245, 0)], sw)
    stroke(pen, [(80, 0), (400, 0)], sw)

def g_2(pen, sw):
    arc_stroke(pen, 225, CAP_H - 155, 155, PI*0.85, PI*2, sw)
    stroke(pen, [(55, 0), (420, 0)], sw)
    stroke(pen, [(415, CAP_H-155), (55, 0)], sw)

def g_3(pen, sw):
    arc_stroke(pen, 215, r(CAP_H*0.72), 162, PI*0.85, PI*1.85, sw)
    arc_stroke(pen, 215, r(CAP_H*0.3), 162, PI*1.15, PI*2.15, sw)

def g_4(pen, sw):
    stroke(pen, [(320, 0), (320, CAP_H)], sw)
    stroke(pen, [(320, CAP_H), (30, r(CAP_H*0.38))], sw)
    stroke(pen, [(30, r(CAP_H*0.38)), (430, r(CAP_H*0.38))], sw)

def g_5(pen, sw):
    stroke(pen, [(370, CAP_H), (85, CAP_H)], sw)
    stroke(pen, [(85, CAP_H), (85, r(CAP_H*0.55))], sw)
    arc_stroke(pen, 225, r(CAP_H*0.34), 162, PI*0.9, PI*2.1, sw)
    stroke(pen, [(85, r(CAP_H*0.55)), (225, r(CAP_H*0.55))], sw)

def g_6(pen, sw):
    arc_stroke(pen, 225, r(CAP_H*0.31), 195, -PI*0.5, PI*1.5, sw)
    stroke(pen, [(30, r(CAP_H*0.31)), (225, CAP_H)], sw)

def g_7(pen, sw):
    stroke(pen, [(60, CAP_H), (440, CAP_H)], sw)
    stroke(pen, [(440, CAP_H), (160, 0)], sw)
    stroke(pen, [(175, r(CAP_H*0.45)), (370, r(CAP_H*0.45))], sw)

def g_8(pen, sw):
    arc_stroke(pen, 220, r(CAP_H*0.71), 152, -PI*0.5, PI*1.5, sw)
    arc_stroke(pen, 220, r(CAP_H*0.30), 162, -PI*0.5, PI*1.5, sw)

def g_9(pen, sw):
    arc_stroke(pen, 215, r(CAP_H*0.69), 192, -PI*0.5, PI*1.5, sw)
    stroke(pen, [(405, r(CAP_H*0.69)), (200, 0)], sw)


# ── Glyph registry ────────────────────────────────────────────────────────────
# (char, advance_width, draw_fn)

GLYPHS = [
    (" ",  250, g_space),
    ("!",  180, g_exclam),
    ('"',  270, g_quote),
    ("#",  440, g_hash),
    ("$",  440, g_dollar),
    ("%",  460, g_percent),
    ("&",  500, g_ampersand),
    ("'",  160, g_apostrophe),
    ("(",  280, g_lparen),
    (")",  280, g_rparen),
    ("*",  400, g_asterisk),
    ("+",  440, g_plus),
    (",",  180, g_comma),
    ("-",  300, g_hyphen),
    (".",  180, g_period),
    ("/",  320, g_slash),
    ("0",  520, g_0),
    ("1",  520, g_1),
    ("2",  520, g_2),
    ("3",  520, g_3),
    ("4",  520, g_4),
    ("5",  520, g_5),
    ("6",  520, g_6),
    ("7",  520, g_7),
    ("8",  520, g_8),
    ("9",  520, g_9),
    (":",  180, g_colon),
    (";",  180, g_semicolon),
    ("<",  400, g_lt),
    ("=",  440, g_equal),
    (">",  400, g_gt),
    ("?",  380, g_question),
    ("@",  560, g_at),
    ("A",  620, g_A),
    ("B",  580, g_B),
    ("C",  540, g_C),
    ("D",  580, g_D),
    ("E",  520, g_E),
    ("F",  480, g_F),
    ("G",  580, g_G),
    ("H",  620, g_H),
    ("I",  240, g_I),
    ("J",  440, g_J),
    ("K",  580, g_K),
    ("L",  520, g_L),
    ("M",  660, g_M),
    ("N",  620, g_N),
    ("O",  580, g_O),
    ("P",  540, g_P),
    ("Q",  580, g_Q),
    ("R",  580, g_R),
    ("S",  500, g_S),
    ("T",  520, g_T),
    ("U",  580, g_U),
    ("V",  560, g_V),
    ("W",  720, g_W),
    ("X",  540, g_X),
    ("Y",  540, g_Y),
    ("Z",  520, g_Z),
    ("[",  260, g_lbracket),
    ("\\", 320, g_backslash),
    ("]",  260, g_rbracket),
    ("^",  440, g_caret),
    ("_",  380, g_underscore),
    ("`",  200, g_grave),
    ("a",  460, g_a),
    ("b",  480, g_b),
    ("c",  420, g_c),
    ("d",  480, g_d),
    ("e",  440, g_e),
    ("f",  320, g_f),
    ("g",  480, g_g),
    ("h",  480, g_h),
    ("i",  200, g_i),
    ("j",  240, g_j),
    ("k",  460, g_k),
    ("l",  240, g_l),
    ("m",  700, g_m),
    ("n",  480, g_n),
    ("o",  480, g_o),
    ("p",  480, g_p),
    ("q",  480, g_q),
    ("r",  340, g_r),
    ("s",  420, g_s),
    ("t",  340, g_t),
    ("u",  480, g_u),
    ("v",  440, g_v),
    ("w",  580, g_w),
    ("x",  420, g_x),
    ("y",  440, g_y),
    ("z",  420, g_z),
    ("{",  280, g_lbrace),
    ("|",  180, g_pipe),
    ("}",  280, g_rbrace),
    ("~",  400, g_tilde),
]

MONO_WIDTH = 600

# ── Font builder ──────────────────────────────────────────────────────────────

def build_font(family, style, weight_int, sw, mono=False):
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.t2CharStringPen import T2CharStringPen

    ps_name = f"{family.replace(' ', '')}-{style}"

    def gname(ch):
        return "space" if ch == " " else f"uni{ord(ch):04X}"

    glyph_order = [".notdef"] + [gname(ch) for ch, _, _ in GLYPHS]
    cmap        = {ord(ch): gname(ch) for ch, _, _ in GLYPHS}
    metrics     = {gname(ch): (MONO_WIDTH if mono else adv, 0)
                   for ch, adv, _ in GLYPHS}
    metrics[".notdef"] = (MONO_WIDTH if mono else 500, 0)

    fb = FontBuilder(UPM, isTTF=False)
    fb.setupGlyphOrder(glyph_order)
    fb.setupCharacterMap(cmap)
    fb.setupHorizontalMetrics(metrics)
    fb.setupNameTable({
        "familyName": family,
        "styleName":  style,
        "psName":     ps_name,
    })
    fb.setupHorizontalHeader(ascent=ASCENDER, descent=DESCENDER, lineGap=LINE_GAP)
    fb.setupOS2(
        sTypoAscender   = ASCENDER,
        sTypoDescender  = DESCENDER,
        sTypoLineGap    = LINE_GAP,
        usWinAscent     = ASCENDER,
        usWinDescent    = abs(DESCENDER),
        sxHeight        = X_H,
        sCapHeight      = CAP_H,
        fsType          = 0x0004,
        usWeightClass   = weight_int,
        fsSelection     = 0x40 if weight_int >= 700 else (0x20 if weight_int >= 600 else 0x00),
        achVendID       = "YNGX",
    )
    fb.setupPost(isFixedPitch=1 if mono else 0)
    fb.setupHead(unitsPerEm=UPM)

    # Build CFF charstrings via T2CharStringPen
    char_strings = {}

    # .notdef
    ndadv = MONO_WIDTH if mono else 500
    pen = T2CharStringPen(ndadv, {})
    g_notdef(pen, sw)
    char_strings[".notdef"] = pen.getCharString()

    for ch, adv, draw_fn in GLYPHS:
        name  = gname(ch)
        w     = MONO_WIDTH if mono else adv
        pen   = T2CharStringPen(w, {})
        try:
            draw_fn(pen, sw)
        except Exception as e:
            print(f"    ! glyph '{ch}' skipped: {e}")
        char_strings[name] = pen.getCharString()

    fb.setupCFF(
        psName       = ps_name,
        fontInfo     = {"FullName": f"{family} {style}", "FamilyName": family},
        charStringsDict = char_strings,
        privateDict  = {"defaultWidthX": 0, "nominalWidthX": 0},
    )

    return fb.font


def save_woff2(font, filename):
    from fontTools.ttLib.woff2 import compress
    from io import BytesIO
    path = os.path.join(OUT_DIR, filename)
    # Save OTF to BytesIO, then compress that buffer to WOFF2
    otf_buf = BytesIO()
    font.save(otf_buf)
    otf_buf.seek(0)
    woff2_buf = BytesIO()
    compress(otf_buf, woff2_buf)
    with open(path, "wb") as f:
        f.write(woff2_buf.getvalue())
    size_kb = len(woff2_buf.getvalue()) // 1024
    print(f"  {filename}  ({size_kb} KB)")


def save_otf(font, filename):
    """Fallback: save as OTF if WOFF2 conversion fails."""
    path = os.path.join(OUT_DIR, filename)
    font.save(path)
    size_kb = os.path.getsize(path) // 1024
    print(f"  {filename} (OTF)  ({size_kb} KB)")


# ── Main ──────────────────────────────────────────────────────────────────────

BUILDS = [
    ("NexuiSans", "Regular",  400, "Regular",  False),
    ("NexuiSans", "Medium",   500, "Medium",   False),
    ("NexuiSans", "Bold",     700, "Bold",     False),
    ("NexuiMono", "Regular",  400, "Regular",  True),
]

def main():
    print(f"Building NexUI fonts → {OUT_DIR}\n")
    errors = []

    for family, style, weight_int, sw_key, mono in BUILDS:
        sw = SW[sw_key]
        print(f"{family} {style}  (stroke={sw}, mono={mono})")
        try:
            font = build_font(family, style, weight_int, sw, mono)
            woff2_name = f"{family}-{style}.woff2"
            try:
                save_woff2(font, woff2_name)
            except Exception as e2:
                print(f"  WOFF2 failed ({e2}), saving OTF...")
                save_otf(font, woff2_name.replace(".woff2", ".otf"))
        except Exception as e:
            import traceback
            msg = f"{family} {style}: {e}"
            errors.append(msg)
            print(f"  ERROR: {e}")
            traceback.print_exc()

    print()
    if errors:
        print(f"Completed with {len(errors)} error(s):")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("All fonts built successfully.")


if __name__ == "__main__":
    main()
