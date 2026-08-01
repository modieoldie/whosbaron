"""
Ferrari 812 Competizione — procedural model generator for Blender.

The body is a lofted skin: a set of cross-sections along the length, each one a
spline through six control points (centreline top, crown edge, fender crest,
belt line, shoulder, sill) plus a floor. Every one of those points is driven by
a longitudinal curve defined in the DATA section below, so the silhouette is
tuned by editing numbers rather than by pushing vertices.

Run inside Blender:
    P = r"O:/whosbaron-animated/tools/ferrari812.py"
    exec(compile(open(P).read(), P, "exec"))

Axes (Blender): +X = forward (nose), +Z = up, +Y = left. Origin on the ground at
mid-length, so the model drops straight onto a floor at y=0 once exported.

Where the numbers come from
---------------------------
The upper curves and most of the trim positions in this file are traced off
photographs in `rarri_812/`, not invented. The method, if you need to re-derive
or extend them:

  1. Calibrate a side photograph by fitting the two hub centres (the painted
     ring on the tyre sidewall is concentric with the wheel and easy to fit a
     circle to). Hub separation is the 2.720 m wheelbase, so that fixes metres
     per pixel; hub height plus one tyre radius fixes the ground line; the
     tilt of the hub-to-hub line is the camera roll.
  2. Warp the photo into car-metre space with that transform. `left_side.jpg`
     is the usable one — `right_side.jpg` is shot from behind the car, so its
     front overhang is foreshortened by about 0.3 m and it will lie to you.
  3. Render the model orthographically into the *same* frame and overlay the
     two. The silhouette difference is then readable directly in metres.

C_ZTOP was solved from a crest line traced that way: the side silhouette is the
fender crest over the hood and the roof centreline over the cabin, so
    C_ZTOP = traced_silhouette - (C_CREST - C_CROWN_DROP)   where that is > 0.
Change C_CREST or C_CROWN_DROP and C_ZTOP has to be re-solved with it, or the
silhouette moves.
"""

import bpy
import bmesh
import math
import os
from mathutils import Vector, Euler, Matrix

D2R = math.radians

# ─────────────────────────── dimensions (metres) ───────────────────────────
# Real 812 Competizione: 4696 x 1971 x 1276, wheelbase 2720.
LEN, WID, HGT = 4.696, 1.971, 1.276
NOSE, TAIL = LEN / 2, -LEN / 2          # +2.348 / -2.348
AX_F, AX_R = 1.308, -1.412              # wheelbase 2.720
TRACK_F, TRACK_R = 1.672, 1.645
R_TIRE_F, R_TIRE_R = 0.350, 0.349       # 275/35 ZR20, 315/30 ZR20
W_TIRE_F, W_TIRE_R = 0.275, 0.315
R_RIM = 0.254                           # 20 inch


# ────────────────────────────── interpolation ──────────────────────────────
class Curve:
    """Smooth interpolation through (x, value) keys — Hermite with
    finite-difference tangents. Flat outside the key range."""

    def __init__(self, keys):
        self.k = sorted(keys, key=lambda p: p[0])

    def __call__(self, x):
        k = self.k
        n = len(k)
        if x <= k[0][0]:
            return k[0][1]
        if x >= k[-1][0]:
            return k[-1][1]
        i = 0
        while i < n - 1 and k[i + 1][0] < x:
            i += 1
        x0, y0 = k[i]
        x1, y1 = k[i + 1]
        xm, ym = k[i - 1] if i > 0 else (x0, y0)
        x2, y2 = k[i + 2] if i + 2 < n else (x1, y1)
        m0 = (y1 - ym) / (x1 - xm) if x1 != xm else 0.0
        m1 = (y2 - y0) / (x2 - x0) if x2 != x0 else 0.0
        h = x1 - x0
        t = (x - x0) / h
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m0
                + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m1)


def _cr(p0, p1, p2, p3, t):
    """Uniform Catmull-Rom point between p1 and p2."""
    t2, t3 = t * t, t * t * t

    def f(a, b, c, d):
        return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2
                      + (-a + 3 * b - 3 * c + d) * t3)

    return (f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]))


def spline(pts, n, dense=28):
    """n+1 points evenly spaced *by arc length* along a Catmull-Rom through
    pts. Even spacing matters: it keeps the loft's quads square-ish, which is
    what makes the smooth shading read cleanly on a curved panel."""
    P = [pts[0]] + list(pts) + [pts[-1]]
    raw = []
    for i in range(len(pts) - 1):
        for j in range(dense):
            raw.append(_cr(P[i], P[i + 1], P[i + 2], P[i + 3], j / dense))
    raw.append(tuple(pts[-1]))
    cl = [0.0]
    for i in range(1, len(raw)):
        cl.append(cl[-1] + math.dist(raw[i], raw[i - 1]))
    total = cl[-1]
    out, k = [], 0
    for s in range(n + 1):
        target = total * s / n
        while k < len(cl) - 2 and cl[k + 1] < target:
            k += 1
        seg = cl[k + 1] - cl[k]
        f = 0.0 if seg <= 1e-12 else (target - cl[k]) / seg
        out.append((raw[k][0] + (raw[k + 1][0] - raw[k][0]) * f,
                    raw[k][1] + (raw[k + 1][1] - raw[k][1]) * f))
    return out


# ═══════════════════════════════ DATA: body ════════════════════════════════
# Every curve is keyed on X (nose +2.348 → tail -2.348).
#
# The upper curves are not invented: C_ZTOP was solved from the crest line
# traced off a rectified side photograph (see the note above `TRACED_CREST`),
# so the silhouette this file produces can be checked against the real car.

# Centreline height of the upper surface: nose, hood, windscreen, roof,
# fastback, ducktail. The cowl sits at x=0.46 and the header at x=-0.62 — a
# 1.08 m windscreen. That long, hard-raked screen over a nose that drops to
# 0.47 m is the proportion that reads as an 812 rather than a generic GT; the
# earlier 0.26 m cowl made the cabin sit too far back and the hood too tall.
C_ZTOP = Curve([
    (NOSE, 0.470), (2.300, 0.510), (2.250, 0.540), (2.180, 0.596),
    (2.130, 0.625), (2.080, 0.655), (2.030, 0.681), (2.000, 0.707),
    (1.940, 0.735), (1.890, 0.758), (1.840, 0.779), (1.800, 0.796),
    (1.750, 0.813), (1.700, 0.828), (1.650, 0.842), (1.600, 0.852),
    (1.550, 0.863), (1.500, 0.871), (1.420, 0.883), (1.300, 0.896),
    (1.150, 0.912), (1.000, 0.927), (0.850, 0.941), (0.700, 0.953),
    (0.580, 0.958), (0.500, 0.964), (0.460, 0.972), (0.380, 1.005),
    (0.300, 1.045), (0.220, 1.082), (0.140, 1.118), (0.060, 1.152),
    (0.000, 1.175), (-0.080, 1.205), (-0.160, 1.228), (-0.250, 1.248),
    (-0.350, 1.262), (-0.450, 1.270), (-0.550, 1.275), (-0.650, 1.276),
    (-0.750, 1.272), (-0.850, 1.263), (-0.950, 1.250), (-1.050, 1.234),
    (-1.150, 1.215), (-1.250, 1.195), (-1.350, 1.162), (-1.450, 1.135),
    (-1.550, 1.107), (-1.650, 1.074), (-1.750, 1.048), (-1.850, 1.032),
    (-1.950, 1.026), (-2.050, 1.030), (-2.150, 1.034), (-2.250, 1.036),
    (TAIL, 1.028),
])

# Centreline height of the underside. Rises at the back to clear the diffuser,
# which is bolted on under the last half-metre as its own part. At the nose it
# closes up towards C_ZTOP so the prow is a slim wedge, not a wall.
C_ZBOT = Curve([
    (NOSE, 0.255), (2.326, 0.212), (2.290, 0.176), (2.230, 0.140),
    (2.150, 0.120), (2.000, 0.108), (1.600, 0.100), (1.000, 0.106),
    (0.000, 0.108), (-1.000, 0.108), (-1.500, 0.116), (-1.800, 0.138),
    (-1.980, 0.170), (-2.140, 0.216), (-2.260, 0.252), (TAIL, 0.276),
])

# Half-width at the widest point of the section. Stays wide right to the tail:
# the 812 is a Kamm tail, not a taper. Opens fast off the prow so the bumper is
# at full width by x=2.15, where the mouth and corner ducts have to sit.
C_WIDTH = Curve([
    (NOSE, 0.235), (2.326, 0.390), (2.290, 0.545), (2.230, 0.700),
    (2.150, 0.812), (2.040, 0.888), (1.880, 0.938), (1.700, 0.962),
    (1.480, 0.978), (1.280, 0.983), (1.040, 0.972), (0.760, 0.948),
    (0.400, 0.930), (0.000, 0.922), (-0.400, 0.928), (-0.760, 0.948),
    (-1.100, 0.972), (-1.400, 0.9855), (-1.680, 0.982), (-1.940, 0.970),
    (-2.140, 0.962), (-2.260, 0.952), (-2.318, 0.936), (TAIL, 0.912),
])

# Height at which the section is widest — the car's character line.
C_SHOULDER_Z = Curve([
    (NOSE, 0.372), (2.290, 0.352), (2.150, 0.360), (2.000, 0.398),
    (1.800, 0.470), (1.560, 0.532), (1.300, 0.566), (1.000, 0.588),
    (0.700, 0.606), (0.300, 0.628), (-0.200, 0.652), (-0.600, 0.680),
    (-0.940, 0.720), (-1.280, 0.760), (-1.600, 0.780), (-1.900, 0.792),
    (-2.140, 0.804), (TAIL, 0.820),
])

# Half-width of the flat-ish top of the section (hood centre / roof panel).
# Kept narrow over the hood: a 0.58 crown made the bonnet a 1.16 m flat tray
# with the fender crests standing on it as rims. The real hood is a shallow
# dome that runs out into the crests, so the flat has to end well inboard.
C_CROWN_Y = Curve([
    (NOSE, 0.060), (2.290, 0.150), (2.150, 0.238), (2.000, 0.298),
    (1.760, 0.352), (1.420, 0.392), (1.060, 0.412), (0.700, 0.432),
    (0.380, 0.466), (0.160, 0.530), (-0.100, 0.578), (-0.420, 0.606),
    (-0.760, 0.610), (-1.120, 0.600), (-1.440, 0.590), (-1.780, 0.576),
    (-2.100, 0.538), (-2.280, 0.482), (TAIL, 0.430),
])

# How far the crown edge sits below the centreline: the crown of the surface.
C_CROWN_DROP = Curve([
    (NOSE, 0.014), (2.150, 0.022), (1.800, 0.026), (1.400, 0.030),
    (1.000, 0.032), (0.520, 0.030), (0.300, 0.030), (0.060, 0.050),
    (-0.240, 0.070), (-0.620, 0.076), (-1.020, 0.072), (-1.400, 0.064),
    (-1.780, 0.056), (-2.100, 0.048), (TAIL, 0.042),
])

# Lift of the fender crest above the crown edge. This is what gives the car its
# raised front fenders (hood sunk between them) and rear haunch humps. Held to
# roughly 30 mm above the centreline: any more and the surface between the
# crown edge and the ridge reads as a gutter cut into the bonnet rather than as
# a fender rising out of it.
C_CREST = Curve([
    (NOSE, 0.004), (2.290, 0.020), (2.200, 0.034), (2.040, 0.050),
    (1.800, 0.058), (1.560, 0.062), (1.320, 0.060), (1.080, 0.052),
    (0.840, 0.038), (0.600, 0.022), (0.420, 0.008), (0.300, 0.002),
    (-0.300, 0.000), (-0.640, 0.004), (-0.900, 0.020), (-1.160, 0.040),
    (-1.400, 0.050), (-1.660, 0.048), (-1.940, 0.040), (-2.180, 0.028),
    (TAIL, 0.020),
])

# Where the crest ridge sits between the crown edge (0) and the belt line (1).
# Over the front fender it runs high — the 812's fender top is broad and flat
# and then falls away steeply over the arch, which is what gives the headlight
# a ledge to sit under. A constant 0.56 put the ridge too far inboard and left
# the flank sloping the whole way from crown to shoulder.
C_CREST_F = Curve([
    (NOSE, 0.56), (2.200, 0.62), (1.950, 0.72), (1.650, 0.80), (1.350, 0.82),
    (1.050, 0.76), (0.750, 0.66), (0.450, 0.58), (-0.400, 0.56), (-0.950, 0.60),
    (-1.400, 0.66), (-1.850, 0.62), (TAIL, 0.56),
])

# Belt line: where the greenhouse meets the body side. Above the cabin this is
# the base of the glass, over the hood it is just a point on the fender flank.
C_BELT_Y = Curve([
    (NOSE, 0.150), (2.290, 0.400), (2.150, 0.610), (2.000, 0.730),
    (1.780, 0.808), (1.480, 0.848), (1.160, 0.850), (0.820, 0.848),
    (0.480, 0.854), (0.140, 0.866), (-0.300, 0.878), (-0.760, 0.892),
    (-1.140, 0.910), (-1.480, 0.918), (-1.820, 0.912), (-2.100, 0.896),
    (-2.280, 0.872), (TAIL, 0.842),
])

C_BELT_Z = Curve([
    (NOSE, 0.420), (2.290, 0.428), (2.150, 0.470), (2.000, 0.532),
    (1.780, 0.616), (1.500, 0.680), (1.200, 0.722), (0.900, 0.756),
    (0.640, 0.796), (0.400, 0.856), (0.140, 0.898), (-0.300, 0.918),
    (-0.760, 0.921), (-1.140, 0.923), (-1.520, 0.924), (-1.900, 0.920),
    (-2.180, 0.914), (TAIL, 0.912),
])

# Bottom edge of the visible side — the rocker / sill line.
C_SILL_Y = Curve([
    (NOSE, 0.190), (2.290, 0.470), (2.150, 0.680), (2.000, 0.772),
    (1.700, 0.836), (1.300, 0.852), (0.900, 0.840), (0.300, 0.826),
    (-0.300, 0.826), (-0.900, 0.840), (-1.300, 0.862), (-1.700, 0.860),
    (-2.000, 0.828), (-2.200, 0.786), (TAIL, 0.740),
])

C_SILL_Z = Curve([
    (NOSE, 0.300), (2.290, 0.196), (2.150, 0.164), (2.000, 0.150),
    (1.700, 0.148), (1.300, 0.152), (0.900, 0.148), (0.300, 0.144),
    (-0.300, 0.144), (-0.900, 0.150), (-1.400, 0.158), (-1.760, 0.186),
    (-2.020, 0.230), (-2.200, 0.286), (TAIL, 0.316),
])

BODY_CURVES = dict(
    ztop=C_ZTOP, zbot=C_ZBOT, width=C_WIDTH, shoulder=C_SHOULDER_Z,
    crown_y=C_CROWN_Y, crown_drop=C_CROWN_DROP, crest=C_CREST,
    crest_f=C_CREST_F, belt_y=C_BELT_Y, belt_z=C_BELT_Z,
    sill_y=C_SILL_Y, sill_z=C_SILL_Z,
)

N_UP = 26   # samples from centreline-top down to the sill
N_LO = 7    # samples from the sill in to the centreline-floor


def half_profile(x, n_up=N_UP, n_lo=N_LO):
    """One half-section at station x, as (y, z) from top centre to floor
    centre. y >= 0."""
    zt, zb = C_ZTOP(x), C_ZBOT(x)
    cy, cd = C_CROWN_Y(x), C_CROWN_DROP(x)
    by, bz = C_BELT_Y(x), C_BELT_Z(x)
    wy, wz = C_WIDTH(x), C_SHOULDER_Z(x)
    sy, sz = C_SILL_Y(x), C_SILL_Z(x)
    z_crown = zt - cd
    ridge_y = cy + (by - cy) * C_CREST_F(x)
    ctl = [
        (0.0, zt),
        (cy, z_crown),
        (ridge_y, z_crown + C_CREST(x)),
        (by, bz),
        (wy, wz),
        (sy, sz),
    ]
    up = spline(ctl, n_up)
    fy = sy * 0.90
    lo = spline([(sy, sz), (fy, zb + 0.014), (fy * 0.72, zb), (0.0, zb)], n_lo)
    return up + lo[1:]


def surface_point(x, v):
    """The body skin as a parametric surface. v in [0,1] runs from the
    centreline of the roof/hood (0) to the centreline of the floor (1), down
    the right-hand side. Used by the trim parts so they sit exactly on the
    paint."""
    prof = half_profile(x, 96, 24)
    t = min(max(v, 0.0), 1.0) * (len(prof) - 1)
    i = int(t)
    if i >= len(prof) - 1:
        return Vector((x, prof[-1][0], prof[-1][1]))
    f = t - i
    y = prof[i][0] + (prof[i + 1][0] - prof[i][0]) * f
    z = prof[i][1] + (prof[i + 1][1] - prof[i][1]) * f
    return Vector((x, y, z))


def surface_normal(x, v, eps=0.006):
    """Outward normal of the skin at (x, v), right-hand side."""
    du = surface_point(x + eps, v) - surface_point(x - eps, v)
    dv = surface_point(x, v + eps) - surface_point(x, v - eps)
    n = dv.cross(du)
    if n.length < 1e-9:
        return Vector((0, 1, 0))
    n.normalize()
    if n.y < 0 and abs(n.y) > abs(n.z):
        n = -n
    return n


def stations():
    """Longitudinal sampling, denser where the surface turns hard."""
    segs = [
        (NOSE, 2.30, 0.018), (2.30, 2.16, 0.028), (2.16, 1.96, 0.040),
        (1.96, 1.60, 0.052), (1.60, 1.10, 0.062), (1.10, 0.74, 0.060),
        (0.74, 0.46, 0.046), (0.46, 0.10, 0.045), (0.10, -0.40, 0.062),
        (-0.40, -0.90, 0.062), (-0.90, -1.30, 0.057), (-1.30, -1.70, 0.050),
        (-1.70, -2.00, 0.038), (-2.00, -2.22, 0.028), (-2.22, TAIL, 0.020),
    ]
    xs = []
    for a, b, step in segs:
        n = max(1, int(round(abs(b - a) / step)))
        for i in range(n):
            xs.append(a + (b - a) * i / n)
    xs.append(TAIL)
    return xs


# ═══════════════════════════════ mesh helpers ══════════════════════════════
ROOT = None
_MATS = {}


def mat(name, color, metallic=0.0, rough=0.4, coat=0.0, coat_rough=0.03,
        emit=None, emit_str=1.0, alpha=1.0, blend=False, ior=1.45):
    """A Principled material. Coat maps to KHR_materials_clearcoat on export,
    which three.js reads as MeshPhysicalMaterial.clearcoat."""
    if name in _MATS:
        return _MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]

    def setv(key, val):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = val

    setv("Base Color", (*color, 1.0))
    setv("Metallic", metallic)
    setv("Roughness", rough)
    setv("IOR", ior)
    setv("Coat Weight", coat)
    setv("Coat Roughness", coat_rough)
    setv("Alpha", alpha)
    if emit:
        setv("Emission Color", (*emit, 1.0))
        setv("Emission Strength", emit_str)
    if blend:
        m.surface_render_method = "BLENDED"
    m.use_backface_culling = False
    # Viewport/Workbench display. Solid shading reads `diffuse_color`, not the
    # Principled node, so without this every panel renders the same grey and
    # the trim is impossible to check against a reference photo.
    m.diffuse_color = (*color, alpha)
    m.metallic = metallic
    m.roughness = rough
    _MATS[name] = m
    return m


def new_mesh(name, verts, faces, material=None, parent=None, smooth=True,
             sharp_deg=38.0):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.validate(verbose=False)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if material:
        ob.data.materials.append(material)

    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if smooth:
        for f in bm.faces:
            f.smooth = True
        thresh = D2R(sharp_deg)
        for e in bm.edges:
            if len(e.link_faces) == 2:
                e.smooth = e.calc_face_angle() < thresh
            else:
                e.smooth = False
    bm.to_mesh(me)
    bm.free()
    ob.parent = parent if parent else ROOT
    return ob


def loft(rings, name, material=None, cap_first=True, cap_last=True,
         closed_ring=True, parent=None, smooth=True, sharp_deg=38.0):
    """Bridge a list of equal-length vertex rings into a skin."""
    m = len(rings[0])
    verts = [v for ring in rings for v in ring]
    faces = []
    lim = m if closed_ring else m - 1
    for j in range(len(rings) - 1):
        a, b = j * m, (j + 1) * m
        for i in range(lim):
            i2 = (i + 1) % m
            faces.append([a + i, b + i, b + i2, a + i2])
    if cap_first:
        faces.append(list(range(m - 1, -1, -1)))
    if cap_last:
        o = (len(rings) - 1) * m
        faces.append([o + i for i in range(m)])
    return new_mesh(name, verts, faces, material, parent, smooth, sharp_deg)


def full_ring(x):
    """Closed cross-section ring at station x: right side then left side."""
    half = half_profile(x)
    ring = [Vector((x, y, z)) for y, z in half]
    for y, z in reversed(half[1:-1]):
        ring.append(Vector((x, -y, z)))
    return ring


def patch(rings, name, material=None, parent=None, smooth=True,
          sharp_deg=38.0):
    """An open quad grid (no wrap, no caps) — used for glass and appliques."""
    return loft(rings, name, material, cap_first=False, cap_last=False,
                closed_ring=False, parent=parent, smooth=smooth,
                sharp_deg=sharp_deg)


def lathe(profile, segs, name, material=None, parent=None, closed=True,
          smooth=True, sharp_deg=32.0, offset=(0, 0, 0)):
    """Revolve a (y, r) profile about the Y axis. Local X/Z is the wheel
    plane, +Y is outboard."""
    rings = []
    for s in range(segs):
        a = math.tau * s / segs
        ca, sa = math.cos(a), math.sin(a)
        rings.append([Vector((r * ca + offset[0], y + offset[1], r * sa + offset[2]))
                      for y, r in profile])
    # rings wrap in the revolve direction; bridge them as a closed tube
    m = len(profile)
    verts = [v for ring in rings for v in ring]
    faces = []
    for s in range(segs):
        a, b = s * m, ((s + 1) % segs) * m
        lim = m if closed else m - 1
        for i in range(lim):
            i2 = (i + 1) % m
            faces.append([a + i, b + i, b + i2, a + i2])
    return new_mesh(name, verts, faces, material, parent, smooth, sharp_deg)


def boolean(target, cutters, op="DIFFERENCE"):
    for i, c in enumerate(cutters):
        md = target.modifiers.new(f"bool{i}", "BOOLEAN")
        md.operation = op
        md.object = c
        md.solver = "EXACT"
    return target


def apply_mods(ob):
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.ops.object.convert(target="MESH")
    ob.select_set(False)


def cyl_cutter(name, center, radius, axis_len, axis="Y", segs=48, ymin=None,
               ymax=None):
    """A cylinder along Y, optionally clipped to a y range (so one side of the
    car can be cut without touching the other)."""
    cx, cy, cz = center
    y0 = ymin if ymin is not None else cy - axis_len / 2
    y1 = ymax if ymax is not None else cy + axis_len / 2
    prof = [(y0, radius), (y1, radius)]
    rings = []
    for s in range(segs):
        a = math.tau * s / segs
        ca, sa = math.cos(a), math.sin(a)
        rings.append([Vector((radius * ca + cx, yy, radius * sa + cz))
                      for yy, radius in [(y0, radius), (y1, radius)]])
    verts, faces = [], []
    for s in range(segs):
        a = math.tau * s / segs
        verts.append(Vector((cx + radius * math.cos(a), y0, cz + radius * math.sin(a))))
    for s in range(segs):
        a = math.tau * s / segs
        verts.append(Vector((cx + radius * math.cos(a), y1, cz + radius * math.sin(a))))
    for s in range(segs):
        s2 = (s + 1) % segs
        faces.append([s, segs + s, segs + s2, s2])
    faces.append(list(range(segs - 1, -1, -1)))
    faces.append([segs + i for i in range(segs)])
    ob = new_mesh(name, verts, faces, None, None, smooth=False)
    return ob


def box(name, lo, hi, material=None, parent=None, smooth=False):
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2],
         [2, 6, 7, 3], [3, 7, 4, 0]]
    return new_mesh(name, [Vector(p) for p in v], f, material, parent, smooth)


# ═══════════════════════════════ materials ════════════════════════════════
def build_materials():
    return dict(
        paint=mat("Paint", (0.902, 0.702, 0.020), 0.0, 0.165, coat=1.0,
                  coat_rough=0.022),
        carbon=mat("Carbon", (0.030, 0.031, 0.034), 0.30, 0.290, coat=0.85,
                   coat_rough=0.060),
        trim=mat("TrimBlack", (0.021, 0.021, 0.023), 0.10, 0.520),
        mesh=mat("MeshBlack", (0.010, 0.010, 0.011), 0.20, 0.700),
        # Opaque, near-black and very smooth. Car glass photographs as a dark
        # mirror anyway, and keeping it opaque avoids sorting the body's inner
        # shell through it once this is loaded into three.js.
        glass=mat("Glass", (0.026, 0.030, 0.037), 0.0, 0.055, coat=0.5,
                  coat_rough=0.02, ior=1.5),
        chrome=mat("Chrome", (0.815, 0.822, 0.835), 1.0, 0.085),
        satin=mat("SatinAlu", (0.560, 0.570, 0.588), 1.0, 0.260),
        rim=mat("RimGunmetal", (0.196, 0.202, 0.214), 1.0, 0.255),
        tire=mat("Tire", (0.0225, 0.0225, 0.0240), 0.0, 0.820),
        tire_wall=mat("TireWall", (0.030, 0.030, 0.032), 0.0, 0.660),
        caliper=mat("Caliper", (0.880, 0.660, 0.030), 0.15, 0.320, coat=0.6),
        disc=mat("BrakeDisc", (0.150, 0.152, 0.158), 1.0, 0.400),
        lens=mat("LensSmoke", (0.026, 0.027, 0.031), 0.0, 0.075, alpha=0.72,
                 blend=True),
        lens_red=mat("LensRed", (0.170, 0.010, 0.012), 0.0, 0.110,
                     emit=(0.62, 0.030, 0.030), emit_str=1.6),
        drl=mat("DRL", (0.780, 0.800, 0.860), 0.0, 0.150,
                emit=(0.86, 0.90, 1.00), emit_str=2.2),
        reflector=mat("Reflector", (0.300, 0.308, 0.324), 0.90, 0.240),
        leather=mat("Leather", (0.052, 0.053, 0.058), 0.0, 0.640),
        alcantara=mat("Alcantara", (0.034, 0.035, 0.040), 0.0, 0.880),
        accent=mat("AccentYellow", (0.880, 0.660, 0.030), 0.0, 0.400),
        shield=mat("Shield", (0.760, 0.640, 0.060), 0.55, 0.300),
    )


# ═══════════════════════════════ body shell ════════════════════════════════
def build_body(M):
    rings = [full_ring(x) for x in stations()]
    body = loft(rings, "Body", M["paint"], cap_first=True, cap_last=True,
                closed_ring=True, sharp_deg=42.0)

    cutters = []
    for tag, ax, r, yin, yout in (
        ("f", AX_F, 0.389, 0.560, 1.060),
        ("r", AX_R, 0.397, 0.540, 1.060),
    ):
        for sgn in (1, -1):
            c = cyl_cutter(f"arch_{tag}{sgn}", (ax, 0, 0.352), r, 0,
                           ymin=min(sgn * yin, sgn * yout),
                           ymax=max(sgn * yin, sgn * yout), segs=56)
            cutters.append(c)
    boolean(body, cutters)
    apply_mods(body)
    for c in cutters:
        bpy.data.objects.remove(c, do_unlink=True)
    return body


# ═══════════════════════════════ wheels ════════════════════════════════════
def build_wheel(M, r_tire, w_tire, name, spokes=5):
    hw = w_tire / 2
    parent = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(parent)
    parent.parent = ROOT

    # ---- tyre: closed lathe profile, inner bead → sidewall → tread → back
    # Radii must climb monotonically from the bead to the tread: an earlier
    # sidewall key sat at R_RIM + 0.150 = 0.404 m on a 0.350 m tyre, which put
    # a 54 mm bulge outside the tread and sank the car into the floor.
    R = r_tire
    tp = [
        (-hw * 0.58, R_RIM - 0.004),
        (-hw * 0.64, R_RIM + 0.008),
        (-hw * 0.88, R_RIM + 0.040),
        (-hw * 1.00, R - 0.046),
        (-hw * 0.98, R - 0.016),
        (-hw * 0.86, R - 0.004),
        (-hw * 0.60, R - 0.001),
        (0.0, R),
        (hw * 0.60, R - 0.001),
        (hw * 0.86, R - 0.004),
        (hw * 0.98, R - 0.016),
        (hw * 1.00, R - 0.046),
        (hw * 0.88, R_RIM + 0.040),
        (hw * 0.64, R_RIM + 0.008),
        (hw * 0.58, R_RIM - 0.004),
    ]
    lathe(tp, 64, name + "_Tire", M["tire"], parent, sharp_deg=44.0)

    # ---- rim barrel
    bp = [
        (hw * 0.60, R_RIM + 0.008),
        (hw * 0.56, R_RIM - 0.004),
        (hw * 0.10, R_RIM - 0.020),
        (-hw * 0.34, R_RIM - 0.024),
        (-hw * 0.56, R_RIM - 0.004),
        (-hw * 0.62, R_RIM + 0.008),
        (-hw * 0.62, R_RIM + 0.001),
        (-hw * 0.58, R_RIM - 0.012),
        (-hw * 0.34, R_RIM - 0.032),
        (hw * 0.10, R_RIM - 0.028),
        (hw * 0.56, R_RIM - 0.012),
        (hw * 0.60, R_RIM + 0.001),
    ]
    lathe(bp, 64, name + "_Rim", M["rim"], parent, sharp_deg=30.0)

    # ---- 5 double spokes
    r_hub, r_out = 0.062, R_RIM - 0.012
    y_hub, y_out = hw * 0.06, hw * 0.46
    verts, faces = [], []
    K = 9
    for i in range(spokes):
        base = math.tau * i / spokes
        for side in (-1, 1):
            a0 = base + side * D2R(3.4)
            a1 = base + side * D2R(23.0)
            rings = []
            for k in range(K):
                t = k / (K - 1)
                te = t * t * (3 - 2 * t)
                r = r_hub + (r_out - r_hub) * t
                a = a0 + (a1 - a0) * te
                y = y_hub + (y_out - y_hub) * (t ** 0.75)
                halfw = (0.0400 - 0.0125 * t) * (1.0 + 0.30 * (1 - t) ** 2)
                th = 0.0195 - 0.0070 * t
                ta = a + (a1 - a0) * 0.5 / (K - 1)
                # cross-section: along the tangential direction, extruded in y
                tx, tz = -math.sin(a), math.cos(a)
                px, pz = math.cos(a) * r, math.sin(a) * r
                ring = [
                    Vector((px + tx * halfw, y + th, pz + tz * halfw)),
                    Vector((px - tx * halfw, y + th, pz - tz * halfw)),
                    Vector((px - tx * halfw * 0.86, y - th, pz - tz * halfw * 0.86)),
                    Vector((px + tx * halfw * 0.86, y - th, pz + tz * halfw * 0.86)),
                ]
                rings.append(ring)
            o = len(verts)
            for ring in rings:
                verts.extend(ring)
            for j in range(K - 1):
                a_, b_ = o + j * 4, o + (j + 1) * 4
                for q in range(4):
                    q2 = (q + 1) % 4
                    faces.append([a_ + q, b_ + q, b_ + q2, a_ + q2])
            faces.append([o + 3, o + 2, o + 1, o + 0])
            e = o + (K - 1) * 4
            faces.append([e + 0, e + 1, e + 2, e + 3])
    new_mesh(name + "_Spokes", verts, faces, M["rim"], parent, sharp_deg=34.0)

    # ---- hub / centre lock
    lathe([(y_hub - 0.006, 0.0), (y_hub - 0.006, 0.072),
           (y_hub + 0.026, 0.070), (y_hub + 0.030, 0.044),
           (y_hub + 0.030, 0.0)], 40, name + "_Hub", M["rim"], parent,
          sharp_deg=30.0)
    lathe([(y_hub + 0.030, 0.0), (y_hub + 0.030, 0.036),
           (y_hub + 0.034, 0.034), (y_hub + 0.034, 0.0)], 32,
          name + "_Cap", M["accent"], parent, sharp_deg=30.0)

    # ---- brake disc + caliper
    lathe([(-0.017, 0.088), (-0.017, 0.198), (0.017, 0.198), (0.017, 0.088)],
          52, name + "_Disc", M["disc"], parent, sharp_deg=30.0)
    lathe([(-0.030, 0.058), (-0.030, 0.092), (0.030, 0.092), (0.030, 0.058)],
          32, name + "_Bell", M["rim"], parent, sharp_deg=30.0)

    # caliper: trailing side of the wheel, a block hugging the disc edge
    cal_v, cal_f = [], []
    a_lo, a_hi = D2R(150), D2R(214)
    NC = 10
    for k in range(NC + 1):
        a = a_lo + (a_hi - a_lo) * k / NC
        ca, sa = math.cos(a), math.sin(a)
        ri, ro = 0.150, 0.212
        ring = []
        for (rr, yy) in ((ri, -0.046), (ro, -0.040), (ro, 0.040), (ri, 0.046)):
            ring.append(Vector((rr * ca, yy, rr * sa)))
        o = len(cal_v)
        cal_v.extend(ring)
        if k:
            p = o - 4
            for q in range(4):
                q2 = (q + 1) % 4
                cal_f.append([p + q, o + q, o + q2, p + q2])
    cal_f.append([3, 2, 1, 0])
    e = NC * 4
    cal_f.append([e, e + 1, e + 2, e + 3])
    new_mesh(name + "_Caliper", cal_v, cal_f, M["caliper"], parent,
             sharp_deg=30.0)
    return parent


def place_wheels(M):
    out = []
    for tag, ax, track, rt, wt in (
        ("FL", AX_F, TRACK_F, R_TIRE_F, W_TIRE_F),
        ("FR", AX_F, TRACK_F, R_TIRE_F, W_TIRE_F),
        ("RL", AX_R, TRACK_R, R_TIRE_R, W_TIRE_R),
        ("RR", AX_R, TRACK_R, R_TIRE_R, W_TIRE_R),
    ):
        left = tag.endswith("L")
        w = build_wheel(M, rt, wt, "Wheel_" + tag)
        w.location = (ax, (track / 2) * (1 if left else -1), rt)
        w.rotation_euler = (0, 0, 0 if left else math.pi)
        out.append(w)
    return out


# ═════════════════════ skin queries, for the trim parts ═══════════════════
# Every applique — lights, vents, grilles, skirts — is placed by asking the
# body surface where it is, so trim always lies exactly on the paint.

_PROF = {}
_N_UP = 150                 # `prof` samples this many steps centre → sill
N_SKIN = _N_UP + 1          # so entries [0:N_SKIN] are the outer side skin


def prof(x):
    k = round(x, 5)
    p = _PROF.get(k)
    if p is None:
        p = half_profile(k, _N_UP, 34)
        _PROF[k] = p
    return p


def skin_z(x, z):
    """Outermost point on the right-hand side skin at station x and height z.

    Outermost, not first-down-from-the-centreline: over the fenders the profile
    doubles back — it climbs from the crown edge out to the crest and only then
    falls to the belt — so the first crossing at crest height is the *inboard*
    wall of the crest, facing the hood. Trim has to lie on the flank, which is
    always the crossing with the largest y. Below the crown edge the two agree,
    so nothing that used to work moves.
    """
    p = prof(x)
    best = None
    for i in range(1, N_SKIN):
        z0, z1 = p[i - 1][1], p[i][1]
        if (z0 - z) * (z1 - z) <= 0:
            if abs(z1 - z0) < 1e-12:
                y = max(p[i - 1][0], p[i][0])
            else:
                f = (z - z0) / (z1 - z0)
                y = p[i - 1][0] + (p[i][0] - p[i - 1][0]) * f
            if best is None or y > best:
                best = y
    if best is None:
        # No crossing: z is off the top or bottom of the flank. Clamp to the
        # nearest skin point by height, preferring the outermost on a tie.
        # Returning the centreline point here instead — which is what an
        # `if z > top` test does, since the roof centre is the tallest point of
        # the whole profile — drags trim that overshoots the crest by a
        # millimetre all the way to y=0 and smears it across the bonnet.
        j = min(range(N_SKIN), key=lambda i: (abs(p[i][1] - z), -p[i][0]))
        return Vector((x, p[j][0], z))
    return Vector((x, best, z))


def skin_y(x, y):
    """Point on the *upper* skin at station x where the half-width is y."""
    p = prof(x)
    ay = abs(y)
    for i in range(1, len(p)):
        y0, y1 = p[i - 1][0], p[i][0]
        if (y0 - ay) * (y1 - ay) <= 0 and abs(y1 - y0) > 1e-12:
            f = (ay - y0) / (y1 - y0)
            return Vector((x, y, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * f))
    return Vector((x, y, p[0][1]))


def skin_x(y, z, x_hi=NOSE, x_lo=1.50, iters=20):
    """Station x at which the skin at height z reaches half-width |y|. Used to
    lay panels onto the front end, where the surface turns through 90°."""
    ay = abs(y)
    a, b = x_hi, x_lo
    fa = skin_z(a, z).y - ay
    fb = skin_z(b, z).y - ay
    if fa * fb > 0:
        return a if abs(fa) < abs(fb) else b
    for _ in range(iters):
        m = (a + b) * 0.5
        fm = skin_z(m, z).y - ay
        if fa * fm <= 0:
            b, fb = m, fm
        else:
            a, fa = m, fm
    return (a + b) * 0.5


def skin_n(x, z=None, y=None, eps=0.012):
    """Outward normal of the skin, queried either at a height or a half-width."""
    if z is not None:
        p = skin_z(x, z)
        a, b = skin_z(x - eps, z), skin_z(x + eps, z)
        c, d = skin_z(x, z + 0.009), skin_z(x, z - 0.009)
    else:
        p = skin_y(x, y)
        a, b = skin_y(x - eps, y), skin_y(x + eps, y)
        c, d = skin_y(x, abs(y) - 0.009), skin_y(x, abs(y) + 0.009)
        if y < 0:
            c = Vector((c.x, -c.y, c.z))
            d = Vector((d.x, -d.y, d.z))
    n = (b - a).cross(d - c)
    if n.length < 1e-9:
        return Vector((0.0, 0.0, 1.0))
    n.normalize()
    zm = (C_ZTOP(x) + C_ZBOT(x)) * 0.5
    ref = Vector((0.0, p.y, p.z - zm))
    if ref.length > 1e-9 and n.dot(ref) < 0:
        n = -n
    return n


def crown_z(x):
    """Height of the crown edge at station x — where the upper surface turns
    over into the flank."""
    return C_ZTOP(x) - C_CROWN_DROP(x)


def crest_z(x):
    """Height of the fender crest at station x: the top of the flank, and the
    ceiling for anything `skin_z` is asked to place on the side of the car."""
    return crown_z(x) + C_CREST(x)


def crest_y(x):
    """Half-width of the fender crest — the ridge line down the top of each
    fender. `half_profile` places the crest control point here."""
    cy, by = C_CROWN_Y(x), C_BELT_Y(x)
    return cy + (by - cy) * C_CREST_F(x)


def _c(f, x):
    return f(x) if callable(f) else f


def lerp_fn(a, b):
    """A callable that ramps a→b as its argument runs 0→1 (used for edges)."""
    return lambda t: a + (b - a) * t


# ─────────────────── appliques: panels, lips and slots ────────────────────
def side_panel(name, x0, x1, z_hi, z_lo, off, material, nx=18, nz=5,
               mirror=True, parent=None, sharp=44.0, smooth=True):
    """A quad grid laid on the flank, bounded by two height curves."""
    out = []
    for sgn in ((1, -1) if mirror else (1,)):
        rings = []
        for i in range(nx + 1):
            x = x0 + (x1 - x0) * i / nx
            zt, zb = _c(z_hi, x), _c(z_lo, x)
            ring = []
            for j in range(nz + 1):
                z = zt + (zb - zt) * j / nz
                p = skin_z(x, z) + skin_n(x, z=z) * _c(off, x)
                ring.append(Vector((p.x, p.y * sgn, p.z)))
            rings.append(ring)
        out.append(patch(rings, name if sgn > 0 else name + "_L", material,
                         parent, smooth, sharp))
    return out


def top_panel(name, x0, x1, y_a, y_b, off, material, nx=18, ny=5,
              parent=None, sharp=44.0, smooth=True, mirror=False):
    """A quad grid laid on the upper surface, bounded by two half-width
    curves. y_a/y_b may be negative, so one patch can span the centreline."""
    out = []
    for sgn in ((1, -1) if mirror else (1,)):
        rings = []
        for i in range(nx + 1):
            x = x0 + (x1 - x0) * i / nx
            ya, yb = _c(y_a, x), _c(y_b, x)
            ring = []
            for j in range(ny + 1):
                y = (ya + (yb - ya) * j / ny) * sgn
                p = skin_y(x, y) + skin_n(x, y=y) * _c(off, x)
                ring.append(p)
            rings.append(ring)
        out.append(patch(rings, name if sgn > 0 else name + "_L", material,
                         parent, smooth, sharp))
    return out


def outline_rect(x0, x1, z_hi, z_lo, nx=18, nz=5):
    """Closed (x, z) outline of a panel region, curved top and bottom edges."""
    pts = []
    for i in range(nx + 1):
        x = x0 + (x1 - x0) * i / nx
        pts.append((x, _c(z_hi, x)))
    zt, zb = _c(z_hi, x1), _c(z_lo, x1)
    for j in range(1, nz):
        pts.append((x1, zt + (zb - zt) * j / nz))
    for i in range(nx, -1, -1):
        x = x0 + (x1 - x0) * i / nx
        pts.append((x, _c(z_lo, x)))
    zt, zb = _c(z_hi, x0), _c(z_lo, x0)
    for j in range(nz - 1, 0, -1):
        pts.append((x0, zt + (zb - zt) * j / nz))
    return pts


def _outline_normals(pts):
    n = len(pts)
    out = []
    for i in range(n):
        a, b = pts[(i - 1) % n], pts[(i + 1) % n]
        tx, tz = b[0] - a[0], b[1] - a[1]
        L = math.hypot(tx, tz) or 1.0
        out.append((tz / L, -tx / L))
    cx = sum(p[0] for p in pts) / n
    cz = sum(p[1] for p in pts) / n
    s = sum((p[0] - cx) * q[0] + (p[1] - cz) * q[1] for p, q in zip(pts, out))
    if s < 0:
        out = [(-a, -b) for a, b in out]
    return out


def lip(name, pts, steps, material, mirror=True, parent=None, sharp=52.0):
    """A raised bead following an (x, z) outline. `steps` is a list of
    (grow, offset) pairs walked outward from the outline — the thing that makes
    a flat dark panel read as a panel sunk into the bodywork."""
    ns = _outline_normals(pts)
    out = []
    for sgn in ((1, -1) if mirror else (1,)):
        rings = []
        for (x, z), (dx, dz) in zip(pts, ns):
            col = []
            for grow, off in steps:
                xx, zz = x + dx * grow, z + dz * grow
                p = skin_z(xx, zz) + skin_n(xx, z=zz) * off
                col.append(Vector((p.x, p.y * sgn, p.z)))
            rings.append(col)
        m = len(steps)
        verts = [v for r in rings for v in r]
        faces = []
        nr = len(rings)
        for i in range(nr):
            a, b = i * m, ((i + 1) % nr) * m
            for j in range(m - 1):
                faces.append([a + j, b + j, b + j + 1, a + j + 1])
        out.append(new_mesh(name if sgn > 0 else name + "_L", verts, faces,
                            material, parent, True, sharp))
    return out


def slots(name, n, x0, x1, z_hi, z_lo, gap, depth, material, lip_mat=None,
          mirror=True, parent=None, skew=0.0):
    """A run of n louvre slots between x0 and x1: a dark face flush with the
    paint, each with a proud blade over its top edge."""
    span = (x1 - x0) / n
    made = []
    for k in range(n):
        a = x0 + span * k + span * gap * 0.5
        b = a + span * (1.0 - gap)
        # each slot further back sits a little lower, so the run rakes
        drop = skew * (k / max(1, n - 1))
        zh = lambda x, d=drop: _c(z_hi, x) - d
        zl = lambda x, d=drop: _c(z_lo, x) - d
        made += side_panel(f"{name}{k}", a, b, zh, zl, 0.0025, material,
                           nx=3, nz=3, mirror=mirror, parent=parent,
                           sharp=20.0)
        if lip_mat:
            made += side_panel(
                f"{name}{k}_blade", a, b,
                lambda x, f=zh: f(x) + depth * 0.9,
                lambda x, f=zh: f(x) - depth * 0.15,
                depth, lip_mat, nx=3, nz=2, mirror=mirror, parent=parent,
                sharp=20.0)
    return made


def top_slots(name, n, x0, x1, y_a, y_b, gap, depth, material, lip_mat=None,
              parent=None, mirror=True):
    """Transverse louvres on an upper surface (rear deck, hood)."""
    span = (x1 - x0) / n
    made = []
    for k in range(n):
        a = x0 + span * k + span * gap * 0.5
        b = a + span * (1.0 - gap)
        made += top_panel(f"{name}{k}", a, b, y_a, y_b, 0.0025, material,
                          nx=3, ny=4, parent=parent, sharp=20.0, mirror=mirror)
        if lip_mat:
            made += top_panel(f"{name}{k}_blade", a, b, y_a, y_b, depth,
                              lip_mat, nx=2, ny=4, parent=parent, sharp=20.0,
                              mirror=mirror)
    return made


# ───────────────── flat primitives for the nose and tail faces ─────────────
def lathe_x(profile, segs, name, material=None, parent=None, closed=True,
            center=(0, 0, 0), sharp=32.0):
    """Revolve an (x, r) profile about the X axis — exhaust tips, lamp
    bezels, anything round on the front or rear face."""
    cx, cy, cz = center
    verts, faces = [], []
    m = len(profile)
    for s in range(segs):
        a = math.tau * s / segs
        ca, sa = math.cos(a), math.sin(a)
        for px, r in profile:
            verts.append(Vector((px + cx, r * ca + cy, r * sa + cz)))
    for s in range(segs):
        a, b = s * m, ((s + 1) % segs) * m
        lim = m if closed else m - 1
        for i in range(lim):
            i2 = (i + 1) % m
            faces.append([a + i, b + i, b + i2, a + i2])
    return new_mesh(name, verts, faces, material, parent, True, sharp)


def plate(name, x, y0, y1, z0, z1, material, parent=None, r=0.0, segs=6):
    """A flat quad in the Y/Z plane at station x, optionally round-cornered."""
    if r <= 0:
        v = [Vector((x, y0, z0)), Vector((x, y1, z0)),
             Vector((x, y1, z1)), Vector((x, y0, z1))]
        return new_mesh(name, v, [[0, 1, 2, 3]], material, parent, False)
    pts = []
    corners = [(y1 - r, z1 - r, 0), (y0 + r, z1 - r, 1),
               (y0 + r, z0 + r, 2), (y1 - r, z0 + r, 3)]
    for cy, cz, q in corners:
        for s in range(segs + 1):
            a = math.pi * 0.5 * (q + s / segs)
            pts.append(Vector((x, cy + r * math.cos(a), cz + r * math.sin(a))))
    return new_mesh(name, pts, [list(range(len(pts)))], material, parent, False)


def pipe_x(name, x0, x1, cy, cz, w, h, material, parent=None, n=32, p=3.4,
           sharp=34.0, cap_first=True, cap_last=True):
    """A tube along X with a superellipse section — a rounded rectangle.

    The Competizione's exhaust tips are squared-off ovals, not circles, so
    `lathe_x` cannot make them; `p` sets how square the section is (2 is an
    ellipse, large is a rectangle)."""
    ring = []
    for i in range(n):
        a = math.tau * i / n
        ca, sa = math.cos(a), math.sin(a)
        ring.append((cy + w * math.copysign(abs(ca) ** (2.0 / p), ca),
                     cz + h * math.copysign(abs(sa) ** (2.0 / p), sa)))
    rings = [[Vector((x, y, z)) for y, z in ring] for x in (x0, x1)]
    return loft(rings, name, material, cap_first, cap_last, True, parent, True,
                sharp)


def face_grid(ya, yb, top, bot, ny, nz, off, pad=0.0):
    """A quad grid on the front end, parametrised by y instead of x.

    The nose turns through 90°, so a panel there cannot be laid out along x —
    for every (y, z) this solves for the station where the skin reaches that
    half-width and offsets along the local normal. That is what makes the mouth
    and the corner ducts wrap the bumper instead of slicing through it.
    """
    rings = []
    for i in range(ny + 1):
        y = ya + (yb - ya) * i / ny
        zt, zb = _c(top, y) - pad, _c(bot, y) + pad
        ring = []
        for j in range(nz + 1):
            z = zt + (zb - zt) * j / nz
            x = skin_x(y, z)
            n = skin_n(x, z=z)
            nn = Vector((n.x, n.y * (1 if y >= 0 else -1), n.z))
            ring.append(Vector((x, y, z)) + nn * _c(off, y))
        rings.append(ring)
    return rings


def face_lip(name, ya, yb, top, bot, steps, material, parent=None, ny=28,
             sharp=52.0):
    """The bead around a front-end opening: walks `steps` outward from the
    opening's outline, following the skin the whole way round."""
    rim = [(ya + (yb - ya) * i / ny, 1) for i in range(ny + 1)]
    rim += [(ya + (yb - ya) * i / ny, -1) for i in range(ny, -1, -1)]
    rows = []
    for y, up in rim:
        z0 = _c(top, y) if up > 0 else _c(bot, y)
        col = []
        for grow, off in steps:
            zz = z0 + up * grow
            x = skin_x(y, zz)
            n = skin_n(x, z=zz)
            nn = Vector((n.x, n.y * (1 if y >= 0 else -1), n.z))
            col.append(Vector((x, y, zz)) + nn * off)
        rows.append(col)
    rows.append(rows[0])
    return loft(rows, name, material, cap_first=False, cap_last=False,
                closed_ring=False, parent=parent, sharp_deg=sharp)


# ═══════════════════════════ front-end features ════════════════════════════
# Headlight: an almond lens tucked directly under the fender crest, running
# from the crest's front end back over the wheel. Traced tips (2.272, 0.586)
# and (1.798, 0.728), 0.081 m deep at x=2.04 — so its top edge *is* the crest
# line, which is why `skin_z` had to learn to return the outermost crossing.
HL_FRONT, HL_REAR = 2.272, 1.798
HL_DEPTH = 0.072


def hl_top(x):
    # Left far enough under the crest that the surround's outward growth still
    # lands on the flank rather than running over the top of the fender.
    return crest_z(x) - 0.013


def hl_depth(x):
    """Lens depth: an almond, pointed at both ends, widest a third back."""
    t = min(max((x - HL_REAR) / (HL_FRONT - HL_REAR), 0.0), 1.0)
    u = t ** 0.78
    return max(0.007, HL_DEPTH * (4.0 * u * (1.0 - u)) ** 0.52)


def hl_bot(x):
    return hl_top(x) - hl_depth(x)


# Lower intake, measured off the rectified front elevation: mesh from z=0.262
# to 0.458, out to |y| = 0.646, with the corner ducts taking over outboard.
MOUTH_Y = 0.646
CD_Y0, CD_Y1 = 0.668, 0.878


def mz_t(y):
    return 0.458 - 0.026 * (abs(y) / MOUTH_Y) ** 2.4


def mz_b(y):
    return 0.262 + 0.030 * (abs(y) / MOUTH_Y) ** 2.2


def cd_t(y):
    return min(max((abs(y) - CD_Y0) / (CD_Y1 - CD_Y0), 0.0), 1.0)


def cd_top(y):
    return 0.462 - 0.030 * cd_t(y) ** 1.6


def cd_bot(y):
    return 0.268 + 0.020 * cd_t(y) ** 2.0


def build_front(M, P):
    # ---- headlights
    side_panel("Headlight", HL_REAR, HL_FRONT, hl_top, hl_bot, 0.0022,
               M["lens"], nx=26, nz=4, parent=P, sharp=30.0)
    lip("HeadlightLip", outline_rect(HL_REAR, HL_FRONT, hl_top, hl_bot, 26, 4),
        [(0.0, 0.002), (0.002, 0.004), (0.006, 0.002), (0.010, 0.0)],
        M["trim"], parent=P)
    # The bright element is a light guide along the *bottom* edge of the lens,
    # not the top — the top edge is the body-colour crest.
    side_panel("DRL", HL_REAR + 0.030, HL_FRONT - 0.026,
               lambda x: hl_bot(x) + 0.017,
               lambda x: hl_bot(x) + 0.003,
               0.005, M["drl"], nx=22, nz=2, parent=P, sharp=24.0)
    # one round projector per side, plus a small squared element inboard of it
    for xc, rr, mat_ in ((2.108, 0.030, M["reflector"]), (2.022, 0.015, M["drl"])):
        zc = (hl_top(xc) + hl_bot(xc)) * 0.5
        p = skin_z(xc, zc)
        n = skin_n(xc, z=zc)
        for sgn in (1, -1):
            c = Vector((p.x, p.y * sgn, p.z)) + Vector((n.x, n.y * sgn, n.z)) * 0.004
            d = Vector((n.x, n.y * sgn, n.z))
            o = lathe_x([(0.0, 0.0), (0.0, rr), (-0.013, rr * 1.06)], 22,
                        f"Projector{int(xc*1000)}{sgn}", mat_, P)
            o.rotation_euler = d.to_track_quat("X", "Z").to_euler()
            o.location = c

    # ---- the mouth, and the two corner brake ducts flanking it
    # 0.003 rather than a hair's breadth: at the bumper the skin turns fast
    # enough that a 1.5 mm offset lets the grille z-fight with the paint.
    patch(face_grid(-MOUTH_Y, MOUTH_Y, mz_t, mz_b, 30, 5, 0.003), "Mouth",
          M["mesh"], P, True, 26.0)
    for k, f in enumerate((0.34, 0.68)):
        patch(face_grid(-MOUTH_Y + 0.010, MOUTH_Y - 0.010,
                        lambda y, f=f: mz_t(y) + (mz_b(y) - mz_t(y)) * f + 0.012,
                        lambda y, f=f: mz_t(y) + (mz_b(y) - mz_t(y)) * f - 0.012,
                        30, 1, 0.011), f"MouthBar{k}", M["trim"], P, True, 26.0)
    face_lip("MouthLip", -MOUTH_Y, MOUTH_Y, mz_t, mz_b,
             ((0.0, 0.003), (0.007, 0.013), (0.018, 0.008), (0.032, 0.0)),
             M["carbon"], P, ny=30)
    # The prancing horse sits on the centre of the grille. Queried at y=0.030
    # rather than y=0: `skin_x` solves for the station at a given half-width,
    # which is degenerate on the centreline and falls back to the nose tip.
    plate("MouthShield", skin_x(0.030, 0.392) + 0.006, -0.026, 0.026, 0.366,
          0.418, M["shield"], P, r=0.008)

    for sgn in (1, -1):
        y0, y1 = sorted((sgn * CD_Y0, sgn * CD_Y1))
        patch(face_grid(y0, y1, cd_top, cd_bot, 8, 6, 0.003),
              f"CornerDuct{sgn}", M["mesh"], P, True, 24.0)
        face_lip(f"CornerDuctLip{sgn}", y0, y1, cd_top, cd_bot,
                 ((0.0, 0.004), (0.008, 0.024), (0.022, 0.015), (0.040, 0.0)),
                 M["carbon"], P, ny=8)
        # two carbon blades standing in the duct, as on the real bumper
        for yy in (CD_Y0 + 0.062, CD_Y0 + 0.132):
            patch(face_grid(sgn * (yy - 0.007), sgn * (yy + 0.007),
                            cd_top, cd_bot, 1, 5, 0.021, pad=0.010),
                  f"DuctBlade{sgn}{int(yy*1000)}", M["carbon"], P, True, 24.0)

    # ---- splitter: a carbon blade under the bumper, swept back at the corners,
    # with a row of short fences hanging below it
    def spl_x(a):
        """Leading edge of the blade at |y| = 0.9a, kept inside x=2.316 so it
        never breaks the nose's silhouette."""
        return 2.316 - 0.290 * a ** 2.2

    spl_rows = []
    for i in range(33):
        a = abs(-1.0 + 2.0 * i / 32)
        sign = 1.0 if i * 2 >= 32 else -1.0
        xf = spl_x(a)
        xb = 2.040 - 0.110 * a
        y = sign * min(0.900 * a, C_SILL_Y(xf) + 0.030)
        z = 0.126 + 0.028 * a ** 2.0
        spl_rows.append([
            Vector((xf, y, z + 0.015)),
            Vector((xf, y, z - 0.004)),
            Vector((xb, y, z - 0.004)),
            Vector((xb, y, z + 0.015)),
        ])
    loft(spl_rows, "Splitter", M["carbon"], cap_first=True, cap_last=True,
         closed_ring=True, parent=P, sharp_deg=40.0)
    # Fences hang under the blade, set back from its leading edge: in profile
    # they have to stay inside the bumper rather than saw-tooth past it.
    for sgn in (1, -1):
        for k in range(4):
            a = (0.086 + k * 0.146) / 0.9
            xf, yy = spl_x(a), sgn * 0.9 * a
            box(f"SplitterFence{sgn}{k}", (xf - 0.118, yy - 0.005, 0.106),
                (xf - 0.034, yy + 0.005, 0.126), M["carbon"], P)

    # ---- hood: the Competizione's six louvres and its centre fin
    for sgn in (1, -1):
        for k, (ya, yb, x0, x1) in enumerate((
            (0.150, 0.238, 0.600, 1.020),
            (0.266, 0.354, 0.622, 1.062),
            (0.382, 0.470, 0.664, 1.084),
        )):
            top_panel(f"HoodVent{sgn}{k}", x0, x1, sgn * ya, sgn * yb,
                      0.0015, M["mesh"], nx=10, ny=3, parent=P, sharp=20.0)
            # a blade over the leading edge, so each slot reads as a louvre
            top_panel(f"HoodVentBlade{sgn}{k}", x1 - 0.036, x1 + 0.010,
                      sgn * ya, sgn * yb, 0.017, M["paint"], nx=3, ny=3,
                      parent=P, sharp=20.0)
    top_panel("HoodFin", 0.560, 0.720, -0.013, 0.013, 0.026, M["carbon"],
              nx=6, ny=1, parent=P, sharp=20.0)
    top_panel("HoodShield", 1.508, 1.612, -0.029, 0.029, 0.004, M["shield"],
              nx=2, ny=2, parent=P, sharp=20.0)

    # ---- cowl vent across the trailing edge of the hood
    top_panel("CowlVent", 0.352, 0.428, -0.400, 0.400, 0.0015, M["mesh"],
              nx=5, ny=16, parent=P, sharp=22.0)
    top_panel("CowlVentBlade", 0.412, 0.444, -0.404, 0.404, 0.013,
              M["trim"], nx=3, ny=16, parent=P, sharp=22.0)


# ════════════════════════════ rear-end features ════════════════════════════
# The tail closes on a large, near-flat vertical panel, so everything here is
# built as thin slabs standing just *behind* it — x decreasing, away from the
# car. Panels take their width from the panel's own outline so nothing can
# overhang the silhouette.
TAILX = TAIL - 0.004


def tail_w(z):
    return skin_z(TAIL, z).y


def tail_slab(name, z0, z1, margin, depth, material, nz=12, parent=None,
              inset=0.0):
    rings = []
    for i in range(nz + 1):
        z = z0 + (z1 - z0) * i / nz
        w = max(tail_w(z) - margin, 0.01)
        xf = TAILX - inset
        xb = xf + depth
        rings.append([Vector((xf, -w, z)), Vector((xf, w, z)),
                      Vector((xb, w, z)), Vector((xb, -w, z))])
    return loft(rings, name, material, True, True, True, parent, True, 50.0)


def build_rear(M, P):
    # ---- the black band the lamps sit in, with the shield at its centre.
    # Measured off the rear three-quarter shots: a thin strip at lamp height,
    # body colour above it up to the deck and below it down to the valance.
    tail_slab("RearBand", 0.828, 0.906, 0.052, 0.014, M["trim"], 10, P)
    # Sunk into the band, so these run *forward* of TAILX. A negative inset
    # here would stand them proud of the tail instead of letting them in.
    box("RearShield", (TAILX + 0.002, -0.034, 0.836),
        (TAILX + 0.008, 0.034, 0.900), M["shield"], P)

    # ---- lower valance, plate recess and a short run of fins each side
    tail_slab("RearLower", 0.318, 0.586, 0.086, 0.014, M["trim"], 12, P)
    box("PlateRecess", (TAILX + 0.002, -0.205, 0.406),
        (TAILX + 0.007, 0.205, 0.520), M["mesh"], P)
    for sgn in (1, -1):
        for k in range(3):
            y = sgn * (0.408 + k * 0.094)
            box(f"RearFin{sgn}{k}", (TAILX - 0.008, y - 0.007, 0.348),
                (TAILX + 0.012, y + 0.007, 0.572), M["carbon"], P)

    # ---- four round lamps, in a close pair each side. Traced span z
    # 0.815-0.925, so 0.11 m across the lens with the bezel a little wider.
    for sgn in (1, -1):
        for k, yy in enumerate((0.360, 0.566)):
            c = (0.0, sgn * yy, 0.870)
            r = 0.072
            lathe_x([(TAILX - 0.010, 0.0), (TAILX - 0.010, r * 1.06),
                     (TAILX + 0.002, r * 1.06), (TAILX + 0.002, 0.0)],
                    30, f"LampBezel{sgn}{k}", M["trim"], P, center=c)
            lathe_x([(TAILX - 0.014, r * 0.62), (TAILX - 0.014, r * 0.92),
                     (TAILX - 0.008, r * 0.92), (TAILX - 0.008, r * 0.62)],
                    30, f"LampRing{sgn}{k}", M["lens_red"], P, center=c)
            lathe_x([(TAILX - 0.012, 0.0), (TAILX - 0.012, r * 0.62),
                     (TAILX - 0.006, r * 0.62), (TAILX - 0.006, 0.0)],
                    30, f"LampLens{sgn}{k}", M["lens"], P, center=c)

    # ---- two squared exhaust tips, low and well outboard of the diffuser.
    # The Superfast's four round pipes became a single big oval each side on the
    # Competizione, sitting in the outer corner of the valance.
    for sgn in (1, -1):
        pipe_x(f"Exhaust{sgn}", TAILX - 0.014, TAILX + 0.046, sgn * 0.512,
               0.262, 0.058, 0.044, M["satin"], P)
        pipe_x(f"ExhaustBore{sgn}", TAILX + 0.034, TAILX + 0.041, sgn * 0.512,
               0.262, 0.047, 0.034, M["mesh"], P)

    # ---- diffuser: a carbon ramp under the tail. Its roof is the reference
    # surface the strakes hang from, so nothing pokes out below the car.
    DX0, DX1 = -1.930, TAILX + 0.006
    DZ0, DZ1 = 0.138, 0.302

    def ramp_z(x, y):
        t = (x - DX0) / (DX1 - DX0)
        arch = 0.140 * (1.0 - (abs(y) / 0.755) ** 2.4)
        return DZ0 + (DZ1 - DZ0) * t ** 1.25 + arch * t

    dif_rows = []
    for i in range(23):
        # 0.755 keeps the ramp inside the sill line all the way to the tail
        y = -0.755 + 1.510 * i / 22
        dif_rows.append([
            Vector((DX1, y, ramp_z(DX1, y))),
            Vector((DX1, y, ramp_z(DX1, y) - 0.026)),
            Vector((DX0, y, DZ0 - 0.024)),
            Vector((DX0, y, DZ0)),
        ])
    loft(dif_rows, "Diffuser", M["carbon"], cap_first=True, cap_last=True,
         closed_ring=True, parent=P, sharp_deg=40.0)
    for sgn in (1, -1):
        for k in range(3):
            y = sgn * (0.148 + k * 0.212)
            rows = []
            for i in range(9):
                x = DX0 + (DX1 - DX0) * i / 8
                zf = ramp_z(x, y)
                zt = min(zf + 0.104, 0.410)
                rows.append([Vector((x, y - 0.009, zf)),
                             Vector((x, y + 0.009, zf)),
                             Vector((x, y + 0.009, zt)),
                             Vector((x, y - 0.009, zt))])
            loft(rows, f"Strake{sgn}{k}", M["carbon"], cap_first=True,
                 cap_last=True, closed_ring=True, parent=P, sharp_deg=44.0)
    lathe_x([(TAILX + 0.002, 0.0), (TAILX + 0.002, 0.030),
             (TAILX + 0.012, 0.030), (TAILX + 0.012, 0.0)], 20, "FogLamp",
            M["lens_red"], P, center=(0.0, 0.0, 0.372))

    # ---- ducktail: a raised blade over the trailing edge of the deck, with a
    # sharp undercut lip and a turned-up fin at each end. It stands only about
    # 20 mm above the deck line but the undercut is what makes it read as a
    # spoiler rather than as a rolled edge.
    # DT1 stops short of the tail: near the trailing edge the surface normal
    # points mostly backwards, so a blade offset along it there would push the
    # car's overall length out past 4.696 m.
    DT0, DT1, DT_Y = -2.075, TAIL + 0.014, 0.784

    def dt_thick(x):
        t = min(max((x - DT0) / (DT1 - DT0), 0.0), 1.0)
        return 0.012 + 0.020 * t ** 1.4

    dt_rows = []
    for i in range(13):
        x = DT0 + (DT1 - DT0) * i / 12
        th = dt_thick(x)
        row_hi, row_lo = [], []
        for j in range(23):
            y = -DT_Y + 2 * DT_Y * j / 22
            p = skin_y(x, y)
            n = skin_n(x, y=y)
            row_hi.append(p + n * (th + 0.004))
            row_lo.append(p + n * 0.002)
        dt_rows.append(row_hi + list(reversed(row_lo)))
    loft(dt_rows, "Ducktail", M["carbon"], cap_first=False, cap_last=True,
         closed_ring=True, parent=P, sharp_deg=46.0)
    for sgn in (1, -1):
        fin = []
        for i in range(7):
            x = DT0 + (DT1 - DT0) * (0.30 + 0.70 * i / 6)
            p = skin_y(x, sgn * DT_Y)
            n = skin_n(x, y=sgn * DT_Y)
            fin.append([p + n * 0.004, p + n * (dt_thick(x) + 0.042),
                        p + Vector((0, sgn * 0.016, 0)) + n * (dt_thick(x) + 0.042),
                        p + Vector((0, sgn * 0.016, 0)) + n * 0.004])
        loft(fin, f"DucktailFin{sgn}", M["carbon"], cap_first=True,
             cap_last=True, closed_ring=True, parent=P, sharp_deg=46.0)

    # ---- the Competizione's blanked rear screen: a panel where the rear glass
    # would be, carrying five raised aero blades along its length.
    BP0, BP1 = -1.048, -1.628

    def bl_out(x):
        t = (x - BP0) / (BP1 - BP0)
        return 0.372 + 0.128 * t

    top_panel("BladePanel", BP0, BP1, lambda x: -bl_out(x), bl_out,
              0.0015, M["carbon"], nx=16, ny=12, parent=P, sharp=26.0)
    # Five raised body-colour blades almost filling the panel, so what shows
    # between them is a narrow dark slot rather than the other way round.
    for k in range(5):
        f = (k + 0.5) / 5
        top_panel(f"BladeRib{k}", BP0 + 0.010, BP1 - 0.010,
                  lambda x, f=f: bl_out(x) * (2 * f - 1) - bl_out(x) * 0.168,
                  lambda x, f=f: bl_out(x) * (2 * f - 1) + bl_out(x) * 0.168,
                  0.014, M["paint"], nx=14, ny=3, parent=P, sharp=26.0)

    # ---- the comb of louvres in each rear quarter, behind the arch
    slots("QuarterVent", 5, -1.918, -1.606,
          lambda x: 0.606, lambda x: 0.404, 0.30,
          0.010, M["mesh"], M["carbon"], parent=P, skew=0.040)
    # ---- a short run of louvres on top of each rear haunch
    for sgn in (1, -1):
        top_slots("DeckVent" + ("R" if sgn > 0 else "L"), 5, -1.472, -1.742,
                  lambda x, s=sgn: s * (crest_y(x) - 0.058),
                  lambda x, s=sgn: s * (crest_y(x) + 0.048), 0.34, 0.010,
                  M["mesh"], M["trim"], parent=P, mirror=False)


# ══════════════════════════════ side features ══════════════════════════════
def build_sides(M, P):
    # ---- the long louvre let into the top of each front fender, straddling
    # the crest. Traced from (2.038, 0.803) back to (1.665, 0.833), so it is on
    # the upper surface rather than the flank and has to be built with
    # `top_panel`; the y band follows the crest ridge.
    # One long opening with three fins in it, not a run of separate slots —
    # that is how it reads in the photographs.
    FV0, FV1 = 1.664, 2.036
    for sgn in (1, -1):
        top_panel(f"FenderVent{sgn}", FV0, FV1,
                  lambda x, s=sgn: s * (crest_y(x) - 0.072),
                  lambda x, s=sgn: s * (crest_y(x) + 0.026),
                  0.0012, M["mesh"], nx=14, ny=4, parent=P, sharp=22.0)
        for k in range(3):
            f = (k + 1) / 4.0
            top_panel(f"FenderVentFin{sgn}{k}", FV0 + 0.014, FV1 - 0.014,
                      lambda x, s=sgn, f=f: s * (crest_y(x) - 0.072 + 0.098 * f
                                                 - 0.006),
                      lambda x, s=sgn, f=f: s * (crest_y(x) - 0.072 + 0.098 * f
                                                 + 0.006),
                      0.008, M["satin"], nx=12, ny=1, parent=P, sharp=22.0)

    # ---- vertical louvres on the fender flank behind the front wheel
    slots("FenderLouvre", 4, 0.845, 1.040,
          lambda x: min(0.786, crest_z(x) - 0.020), lambda x: 0.658, 0.30,
          0.010, M["mesh"], M["satin"], parent=P, skew=0.030)

    # ---- intake ahead of the rear wheel
    # Stops short of x=-1.02, where the rear arch cut-out begins at this
    # height — a panel laid over the opening has no bodywork to sit on.
    SI0, SI1 = -1.012, -0.842

    def si_hi(x):
        return 0.512 - 0.044 * (x - SI0) / (SI1 - SI0)

    def si_lo(x):
        return 0.296 + 0.026 * (x - SI0) / (SI1 - SI0)

    # Two slats rather than one panel: a single dark rectangle this size reads
    # as a box stuck on the door, not an intake let into it.
    slots("SideIntake", 2, SI0, SI1 + 0.076, si_hi, si_lo, 0.26, 0.010,
          M["mesh"], M["carbon"], parent=P)

    # ---- side skirt: carbon strip along the rocker. Both edges stay strictly
    # above the sill line — below it the skin query wraps onto the underside
    # and the strip flips into a horizontal shelf.
    # Runs between the two arch cut-outs, not into them.
    side_panel("Skirt", 0.900, -1.060,
               lambda x: C_SILL_Z(x) + 0.068 + 0.026 * (x / 1.3) ** 2,
               lambda x: C_SILL_Z(x) + 0.002, 0.0035, M["carbon"],
               nx=24, nz=4, parent=P, sharp=40.0)

    # ---- a slim body-colour flare round each arch, over a dark liner. The
    # liner hides the paint on the faces the arch boolean cut open.
    for ax, r, nm in ((AX_F, 0.389, "ArchF"), (AX_R, 0.397, "ArchR")):
        for sgn in (1, -1):
            rows = []
            for i in range(25):
                a = math.pi * (0.03 + 0.94 * i / 24)
                x = ax - r * math.cos(a)
                z = 0.352 + r * math.sin(a)
                p = skin_z(x, z)
                n = skin_n(x, z=z)
                pp = Vector((p.x, p.y * sgn, p.z))
                nn = Vector((n.x, n.y * sgn, n.z))
                rows.append([pp + nn * 0.0015, pp + nn * 0.0042])
            patch(rows, f"{nm}{sgn}", M["paint"], P, True, 40.0)
        for sgn in (1, -1):
            # Wheel house: a dark liner over the cut, capped at its inboard end
            # — without the cap you see straight through the spokes into the
            # body's inner shell, which reads as paint. Only the upper arc is
            # built: a full revolution put a tube under the car that reached
            # 38 mm below the ground plane, and it reached out to y = 1.060 on
            # a body 0.986 wide, so it showed as a ring around the tyre.
            yi, yo = sgn * 0.548, sgn * 0.986
            rows = []
            for i in range(29):
                a = math.pi * (0.02 + 0.96 * i / 28)
                xr = ax - (r - 0.007) * math.cos(a)
                zr = 0.352 + (r - 0.007) * math.sin(a)
                ring = [Vector((ax, yi, 0.352)), Vector((xr, yi, zr)),
                        Vector((xr, yo, zr))]
                rows.append(ring if sgn > 0 else list(reversed(ring)))
            patch(rows, f"{nm}House{sgn}", M["mesh"], P, True, 50.0)

    # ---- door shut lines. Traced at x=+0.345 and x=-1.005, near vertical with
    # a slight bow; the old +0.815 put the front cut through the fender.
    for sgn in (1, -1):
        for xc in (0.345, -1.005):
            rows = []
            for i in range(15):
                t = i / 14
                z = 0.906 - 0.744 * t
                x = xc + 0.022 * math.sin(math.pi * t) * (1 if xc > 0 else -1)
                p = skin_z(x, z)
                n = skin_n(x, z=z)
                pp = Vector((p.x, p.y * sgn, p.z))
                nn = Vector((n.x, n.y * sgn, n.z))
                rows.append([pp + Vector((0.006, 0, 0)) + nn * 0.0012,
                             pp - Vector((0.006, 0, 0)) + nn * 0.0012])
            patch(rows, f"Shut{sgn}{xc}", M["trim"], P, False, 20.0)

    # ---- handle and fender shield, both traced off the rectified side view
    side_panel("Handle", -0.852, -0.758, 0.792, 0.752, 0.006, M["trim"],
               nx=3, nz=2, parent=P, sharp=20.0)
    side_panel("FenderShield", 0.500, 0.572, 0.764, 0.664, 0.004, M["shield"],
               nx=3, nz=3, parent=P, sharp=20.0)

    # ---- mirrors: a slim stalk off the shoulder carrying an aero head. The
    # front elevation puts the heads at z 0.99-1.13 and |y| 0.84-0.92, well
    # outboard of the body side and above the belt, not tucked against it.
    for sgn in (1, -1):
        base = skin_z(0.190, 0.905)
        bx, by, bz = base.x, base.y * sgn, base.z
        cy = by + sgn * 0.096
        y0, y1 = sorted((by, cy))
        box(f"MirrorStalk{sgn}", (bx - 0.014, y0, bz + 0.038),
            (bx + 0.024, y1, bz + 0.070), M["carbon"], P)
        box(f"MirrorHead{sgn}", (bx - 0.056, cy - 0.032, bz + 0.056),
            (bx + 0.062, cy + 0.032, bz + 0.130), M["carbon"], P)
        plate(f"MirrorGlass{sgn}", bx - 0.058, cy - 0.026, cy + 0.026,
              bz + 0.064, bz + 0.124, M["chrome"], P)


# ════════════════════════════════ glazing ══════════════════════════════════
def build_glass(M, P):
    # Windscreen. One patch spanning the centreline, from cowl to header. The
    # cowl is at x=0.455 and the header at -0.560: a 1.02 m screen, which is
    # the rake the traced roof line demands.
    def ws(x):
        # Half-width of the screen: 0.665 at the cowl closing to 0.470 at the
        # header. It has to stay inboard of the crest ridge — any wider and the
        # panel wraps down the fender flank instead of stopping at the pillar.
        t = (x - 0.455) / (-0.560 - 0.455)
        return min(0.665 - 0.195 * t ** 1.15, crest_y(x) - 0.020)
    top_panel("Windscreen", 0.455, -0.560, lambda x: -ws(x), ws, 0.004,
              M["glass"], nx=16, ny=18, parent=P, sharp=40.0)

    # Side glass. The top edge closes down onto the belt line at both ends, so
    # the opening comes to a point fore and aft — that leaf shape, with a hard
    # rake at the A-pillar and a long sweep at the C-pillar, is what makes the
    # greenhouse read as an 812 rather than a generic coupe.
    SG0, SG1 = -0.245, -1.310
    BELT = 0.922
    _sg = Curve([
        (SG0, BELT), (-0.312, 1.036), (-0.396, 1.106), (-0.520, 1.152),
        (-0.700, 1.178), (-0.880, 1.176), (-1.030, 1.142), (-1.150, 1.082),
        (-1.250, 0.996), (SG1, BELT),
    ])

    def sg_hi(x):
        return min(max(_sg(x), BELT + 0.004), crest_z(x) - 0.026)

    side_panel("SideGlass", SG0, SG1, sg_hi, BELT, 0.0025, M["glass"],
               nx=24, nz=4, parent=P, sharp=40.0)
    lip("SideGlassLip", outline_rect(SG0, SG1, sg_hi, BELT, 24, 4),
        [(0.0, 0.004), (0.005, 0.011), (0.015, 0.006), (0.028, 0.0)],
        M["trim"], parent=P)

    # Roof-rail blackout above the glass, so the greenhouse reads as one graphic.
    side_panel("PillarTrim", -0.310, -1.250,
               lambda x: sg_hi(x) + 0.017, sg_hi, 0.004, M["trim"],
               nx=20, nz=2, parent=P, sharp=30.0)


# ═══════════════════════════════ assembly ══════════════════════════════════
def scene_reset():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.curves,
                 bpy.data.images, bpy.data.node_groups):
        for item in list(coll):
            if item.users == 0:
                coll.remove(item)
    _MATS.clear()


def build():
    global ROOT
    scene_reset()
    bpy.context.scene.unit_settings.system = "METRIC"
    ROOT = bpy.data.objects.new("Ferrari812", None)
    bpy.context.collection.objects.link(ROOT)

    M = build_materials()
    build_body(M)
    _PROF.clear()          # the skin queries cache profiles; body is final now
    build_glass(M, ROOT)
    build_front(M, ROOT)
    build_rear(M, ROOT)
    build_sides(M, ROOT)
    place_wheels(M)
    return ROOT


# ─────────────────────────── viewport + export ────────────────────────────
def view(az=52, el=16, dist=8.4, target=(0, 0, 0.62), shading="SOLID"):
    for win in bpy.context.window_manager.windows:
        for area in win.screen.areas:
            if area.type != "VIEW_3D":
                continue
            sp = area.spaces[0]
            r3d = sp.region_3d
            r3d.view_perspective = "PERSP"
            r3d.view_rotation = Euler((D2R(90 - el), 0, D2R(az)),
                                      "XYZ").to_quaternion()
            r3d.view_location = Vector(target)
            r3d.view_distance = dist
            sp.shading.type = shading
            sp.overlay.show_overlays = False
            area.tag_redraw()


def car_objects(root):
    out = []
    stack = list(root.children)
    while stack:
        ob = stack.pop()
        out.append(ob)
        stack.extend(ob.children)
    return out


def merge_for_export(root):
    """Collapse the ~200 authoring objects down to a handful of meshes so the
    GLB costs a few dozen draw calls instead of a few hundred. Parts are
    grouped by material, except wheel parts, which are grouped per wheel so
    each wheel stays one addressable (and spinnable) object."""
    groups = {}
    for ob in car_objects(root):
        if ob.type != "MESH":
            continue
        wheel = None
        p = ob.parent
        while p is not None and p is not root:
            if p.name.startswith("Wheel_"):
                wheel = p.name
                break
            p = p.parent
        if wheel:
            key = wheel
        else:
            m = ob.data.materials[0].name if ob.data.materials else "None"
            key = "Car_" + m
        groups.setdefault(key, []).append(ob)

    for ob in bpy.data.objects:
        ob.select_set(False)
    made = []
    for key, obs in sorted(groups.items()):
        target = obs[0]
        for ob in obs:
            ob.select_set(True)
        bpy.context.view_layer.objects.active = target
        if len(obs) > 1:
            bpy.ops.object.join()
        # the wheel pivots already own the bare `Wheel_*` names
        target.name = key + "_Mesh" if key.startswith("Wheel_") else key
        target.data.name = target.name
        for ob in bpy.context.selected_objects:
            ob.select_set(False)
        made.append(target)
    return made


def export(path=None, merge=True):
    """Write the car — and only the car — to GLB. The studio floor, lights and
    camera live in the same scene, so the export is driven off an explicit
    selection of the ROOT hierarchy."""
    path = path or r"O:/whosbaron-animated/public/models/car.glb"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    root = bpy.data.objects.get("Ferrari812")
    if merge:
        merge_for_export(root)
    for ob in bpy.data.objects:          # the operator form is context-fragile
        ob.select_set(False)
    root.select_set(True)
    for ob in car_objects(root):
        ob.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True,
        export_apply=True, export_yup=True, export_normals=True,
        export_materials="EXPORT", export_cameras=False, export_lights=False,
        export_extras=False,
    )
    tris = 0
    for ob in bpy.context.selected_objects:
        if ob.type == "MESH":
            me = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
            tris += sum(len(p.vertices) - 2 for p in me.polygons)
            ob.to_mesh_clear()
    return path, os.path.getsize(path), tris


if __name__ == "__main__":
    build()
    view()
