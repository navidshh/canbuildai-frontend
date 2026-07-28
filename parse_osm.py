"""
parse_osm.py — Convert OpenStudio .osm files into compact geometry JSON
for the surrogate wizard's 3D viewer.

Reads:  frontend/Building osm/*.osm
Writes: frontend/geometry/<archetype>.json

Output schema (per building):
{
  "archetype": "SmallOffice",
  "name": "ASHRAE 90.1 Small Office prototype",
  "bbox": {"min": [x,y,z], "max": [x,y,z], "size": [w,d,h]},
  "stories": [{"name": "Story 1", "nominal_z": 0.0}],
  "zones":   [{"name": "Core_ZN", "color_index": 0}],
  "surfaces": [
    {
      "name": "Perimeter_ZN_1_wall_south",
      "type": "Wall|RoofCeiling|Floor",
      "boundary": "Outdoors|Surface|Ground|...",
      "space": "Core_ZN",         // resolved to Space name
      "zone": "Core_ZN",          // resolved to ThermalZone name
      "story": "Story 1",         // resolved via Space -> BuildingStory
      "vertices": [[x,y,z], ...]
    }, ...
  ],
  "subsurfaces": [
    {
      "name": "...",
      "type": "FixedWindow|Door|...",
      "parent": "<parent surface name>",
      "vertices": [[x,y,z], ...]
    }, ...
  ]
}

Ignores loads, HVAC, schedules, materials — only geometry + topology.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).parent
OSM_DIR = ROOT / "Building osm"
OUT_DIR = ROOT / "geometry"
OUT_DIR.mkdir(exist_ok=True)

# Map OSM file -> archetype key used by the frontend
ARCHETYPE_MAP = {
    "Highrise.osm":       "HighRise",
    "Midrise.osm":        "MidRise",
    "Lowrise.osm":        "LowRise",
    "Large_Office.osm":   "LargeOffice",
    "Medium_Office.osm":  "MediumOffice",
    "Small_Office.osm":   "SmallOffice",
}


# -------------------------------------------------------------------------
# OSM block parser
# -------------------------------------------------------------------------

_HANDLE_RE = re.compile(r"\{[0-9a-f\-]+\}")


def strip_comment(field: str) -> str:
    """Drop the `!- description` comment and surrounding whitespace."""
    idx = field.find("!-")
    if idx >= 0:
        field = field[:idx]
    return field.strip()


def parse_osm(path: Path):
    """Yield (object_type, [fields]) tuples in file order.

    A block starts on a line beginning with `OS:<type>,` and ends when we
    hit a line whose last non-space char is `;`. Fields are joined by
    stripping the trailing `,`/`;` and any `!- ...` comment.
    """
    text = path.read_text(encoding="utf-8", errors="ignore")
    lines = text.splitlines()

    i = 0
    n = len(lines)
    while i < n:
        line = lines[i].strip()
        # Object header: `OS:<Type>,`
        m = re.match(r"^OS:([A-Za-z0-9_]+),\s*$", line)
        if not m:
            i += 1
            continue
        obj_type = m.group(1)
        fields: list[str] = []
        i += 1
        while i < n:
            raw = lines[i]
            stripped = raw.rstrip()
            i += 1
            if not stripped.strip():
                continue
            # Split off the field value from the trailing terminator.
            # A field ends with `,` or `;`, followed by optional comment.
            # Handle multi-value fields (e.g. vertex lines with commas
            # inside — but the terminator is still the last `,` or `;`
            # BEFORE the `!-` comment).
            content = stripped
            comment_idx = content.find("!-")
            if comment_idx >= 0:
                value_part = content[:comment_idx].rstrip()
                comment_part = content[comment_idx:]
            else:
                value_part = content.rstrip()
                comment_part = ""

            # Determine terminator by looking at trailing char of value_part.
            if not value_part:
                # blank content line
                continue
            terminator = value_part[-1]
            if terminator not in (",", ";"):
                # Value continues on next line — this shouldn't happen in
                # a well-formed OSM but be safe.
                fields.append(value_part.strip())
                continue

            value = value_part[:-1].strip()
            # A single OSM "field line" may contain multiple comma-separated
            # values (e.g. vertex triplets: `0, 0, 3.05,` is one line but
            # three numeric fields). Split on `,` so the caller can index
            # them individually.
            if "," in value:
                parts = [p.strip() for p in value.split(",")]
                fields.extend(parts)
            else:
                fields.append(value)
            if terminator == ";":
                break
        yield obj_type, fields


# -------------------------------------------------------------------------
# Domain-specific extraction
# -------------------------------------------------------------------------

def _parse_vertices(fields: list[str], start: int) -> list[list[float]]:
    """Vertex fields are `X, Y, Z` triplets appearing as three consecutive
    fields per vertex."""
    verts: list[list[float]] = []
    j = start
    while j + 2 < len(fields):
        try:
            x = float(fields[j])
            y = float(fields[j + 1])
            z = float(fields[j + 2])
        except ValueError:
            break
        verts.append([x, y, z])
        j += 3
    return verts


def _get(fields: list[str], idx: int, default: str = "") -> str:
    return fields[idx] if idx < len(fields) else default


def parse_building(path: Path) -> dict:
    """Parse one OSM file into the geometry JSON structure."""
    # First pass: collect every relevant object indexed by handle where
    # relevant. Handles look like `{uuid}` and appear as the first field
    # in each object.
    surfaces_raw = []       # list of dicts with raw fields
    subsurfaces_raw = []
    spaces = {}             # handle -> {name, story_handle, thermal_zone_handle}
    zones = {}              # handle -> name
    stories = {}            # handle -> {name, nominal_z}
    building_name = None

    for obj_type, fields in parse_osm(path):
        if obj_type == "Building":
            # fields: handle, name, ...
            building_name = _get(fields, 1)
        elif obj_type == "BuildingStory":
            # handle, name, nominal_z, ...
            h = _get(fields, 0)
            name = _get(fields, 1)
            try:
                z = float(_get(fields, 2))
            except ValueError:
                z = 0.0
            stories[h] = {"name": name, "nominal_z": z}
        elif obj_type == "ThermalZone":
            # OS:ThermalZone schema: 0 handle, 1 name, 2 multiplier, ...
            h = _get(fields, 0)
            name = _get(fields, 1)
            try:
                mult = int(_get(fields, 2) or 1)
                if mult < 1:
                    mult = 1
            except ValueError:
                mult = 1
            zones[h] = {"name": name, "multiplier": mult}
        elif obj_type == "Space":
            # OS 3.9 OS:Space schema:
            #  0 handle, 1 name, 2 space_type, 3 default_construction_set,
            #  4 default_schedule_set, 5 direction_of_relative_north,
            #  6 x_origin, 7 y_origin, 8 z_origin,
            #  9 building_story_handle, 10 thermal_zone_handle, ...
            h = _get(fields, 0)
            name = _get(fields, 1)
            try:
                x0 = float(_get(fields, 6) or 0)
                y0 = float(_get(fields, 7) or 0)
                z0 = float(_get(fields, 8) or 0)
            except ValueError:
                x0, y0, z0 = 0.0, 0.0, 0.0
            story_h = _get(fields, 9)
            zone_h = _get(fields, 10)
            spaces[h] = {
                "name": name,
                "story_handle": story_h,
                "zone_handle": zone_h,
                "origin": [x0, y0, z0],
            }
        elif obj_type == "Surface":
            # handle, name, surface_type, construction, space_handle,
            # boundary, boundary_object, sun, wind, vf, nverts, then vertices.
            surfaces_raw.append({
                "handle": _get(fields, 0),
                "name": _get(fields, 1),
                "type": _get(fields, 2),
                "space_handle": _get(fields, 4),
                "boundary": _get(fields, 5) or "Outdoors",
                "vertices": _parse_vertices(fields, 11),
            })
        elif obj_type == "SubSurface":
            # OS:SubSurface schema:
            #  0 handle, 1 name, 2 sub_surface_type, 3 construction,
            #  4 parent_surface_handle, 5 boundary_object, 6 vf_to_ground,
            #  7 frame_and_divider, 8 multiplier, 9 nverts, 10+ vertices.
            subsurfaces_raw.append({
                "handle": _get(fields, 0),
                "name": _get(fields, 1),
                "type": _get(fields, 2),
                "parent_handle": _get(fields, 4),
                "vertices": _parse_vertices(fields, 10),
            })

    # Resolve handles -> names
    # Surface.space_handle -> space name, then space.zone_handle -> zone name.
    surface_by_handle = {s["handle"]: s for s in surfaces_raw}

    def resolve_space(space_h: str):
        sp = spaces.get(space_h)
        if not sp:
            return None, None, None, [0.0, 0.0, 0.0], 1
        zone = zones.get(sp["zone_handle"])
        zone_name = zone["name"] if zone else sp["zone_handle"]
        multiplier = zone["multiplier"] if zone else 1
        story = stories.get(sp["story_handle"])
        story_name = story["name"] if story else None
        return sp["name"], zone_name, story_name, sp["origin"], multiplier

    # Precompute per-story physical floor heights and placement so we can
    # vertically duplicate multiplied floors. DOE prototypes use two
    # inconsistent conventions:
    #   * MidRise: Story 2 nominal_z is the FIRST copy of the multiplied set.
    #   * LargeOffice: Story 2 nominal_z is a MIDDLE copy of the multiplied set.
    #
    # To handle both robustly we stack every story contiguously from the
    # bottom of the OSM's Z range, using a uniform physical floor height
    # derived from bbox_height / total_physical_floor_count. This produces
    # the correct visual — one storey band per physical floor, no gaps —
    # even when the OSM's story origins don't sit where you'd expect.
    stories_by_z = sorted(
        (v for v in stories.values()),
        key=lambda s: s["nominal_z"],
    )

    # First pass: per-story max multiplier + Z range of any surface in it
    # (to work out the drawn story height when we can't infer it from
    # bbox math).
    story_max_mult = {}
    for sp in spaces.values():
        story = stories.get(sp["story_handle"])
        zone = zones.get(sp["zone_handle"])
        if not story or not zone:
            continue
        cur = story_max_mult.get(story["name"], 1)
        story_max_mult[story["name"]] = max(cur, zone["multiplier"])

    # Physical floor count = sum of story multipliers
    total_phys_floors = sum(
        story_max_mult.get(s["name"], 1) for s in stories_by_z
    ) or 1

    # Full Z extent of the raw OSM geometry (before duplication).
    # Compute from raw surfaces + their space origins so we don't need a
    # duplication pass first.
    raw_z_lo = float("inf")
    raw_z_hi = float("-inf")
    for s in surfaces_raw:
        sp = spaces.get(s["space_handle"])
        origin_z = sp["origin"][2] if sp else 0.0
        for v in s["vertices"]:
            z = v[2] + origin_z
            if z < raw_z_lo:
                raw_z_lo = z
            if z > raw_z_hi:
                raw_z_hi = z
    if raw_z_lo == float("inf"):
        raw_z_lo, raw_z_hi = 0.0, 3.05

    # Uniform physical floor height (approximate).
    uniform_h = (raw_z_hi - raw_z_lo) / total_phys_floors
    if uniform_h <= 0.1:
        uniform_h = 3.05

    # Compute per-story placement: target bottom-Z where the FIRST copy of
    # that story's surfaces should sit, plus the physical floor height.
    story_placement = {}
    stack_z = raw_z_lo
    for story in stories_by_z:
        mult = story_max_mult.get(story["name"], 1)
        story_placement[story["name"]] = {
            "target_bottom_z": stack_z,
            "phys_h": uniform_h,
            "multiplier": mult,
        }
        stack_z += mult * uniform_h

    # For each STORY, compute the drawn bottom Z (lowest vertex among any
    # surface of any space on that story). We shift the whole story
    # together so plena stacked above occupied spaces stay above them
    # after re-stacking.
    story_drawn_bottom = {}
    for s in surfaces_raw:
        sp = spaces.get(s["space_handle"])
        if not sp:
            continue
        story = stories.get(sp["story_handle"])
        story_name = story["name"] if story else None
        if story_name is None:
            continue
        origin_z = sp["origin"][2]
        for v in s["vertices"]:
            z = v[2] + origin_z
            cur = story_drawn_bottom.get(story_name, float("inf"))
            if z < cur:
                story_drawn_bottom[story_name] = z

    surfaces_out = []
    # Track handle -> (base_verts, mult, phys_h, z_shift_to_target) so
    # subsurfaces can be duplicated the same way as their parent.
    parent_dupe_meta = {}
    xs, ys, zs = [], [], []
    for s in surfaces_raw:
        space_name, zone_name, story_name, origin, mult = resolve_space(s["space_handle"])
        # Apply space origin to vertices (OSM convention: surface verts are
        # in the space's local coordinate system).
        base_verts = [
            [v[0] + origin[0], v[1] + origin[1], v[2] + origin[2]]
            for v in s["vertices"]
        ]

        placement = story_placement.get(story_name, {
            "target_bottom_z": raw_z_lo,
            "phys_h": uniform_h,
        })
        phys_h = placement["phys_h"]
        drawn_bottom = story_drawn_bottom.get(story_name, raw_z_lo)
        z_shift = placement["target_bottom_z"] - drawn_bottom

        parent_dupe_meta[s["handle"]] = (base_verts, mult, phys_h, z_shift)

        for k in range(mult):
            dz = z_shift + k * phys_h
            verts = [[v[0], v[1], v[2] + dz] for v in base_verts]
            for v in verts:
                xs.append(v[0]); ys.append(v[1]); zs.append(v[2])
            surfaces_out.append({
                "name": s["name"] if k == 0 else f"{s['name']}#{k+1}",
                "type": s["type"],
                "boundary": s["boundary"],
                "space": space_name,
                "zone": zone_name,
                "story": story_name,
                "vertices": verts,
            })

    # Subsurfaces: duplicate the same way their parent surface was.
    subsurfaces_out = []
    for ss in subsurfaces_raw:
        parent = surface_by_handle.get(ss["parent_handle"])
        if parent is None:
            continue
        meta = parent_dupe_meta.get(parent["handle"])
        if meta is None:
            continue
        _base_parent_verts, mult, phys_h, z_shift = meta
        _, _, _, origin, _ = resolve_space(parent["space_handle"])
        base_verts = [
            [v[0] + origin[0], v[1] + origin[1], v[2] + origin[2]]
            for v in ss["vertices"]
        ]
        for k in range(mult):
            dz = z_shift + k * phys_h
            verts = [[v[0], v[1], v[2] + dz] for v in base_verts]
            subsurfaces_out.append({
                "name": ss["name"] if k == 0 else f"{ss['name']}#{k+1}",
                "type": ss["type"],
                "parent": parent["name"] if k == 0 else f"{parent['name']}#{k+1}",
                "vertices": verts,
            })

    # Ordered zone list. Some BTAP-generated OSMs have ugly auto-generated
    # ThermalZone names (e.g. "ALL_ST=Office enclosed <= 25 m2_FL=Building
    # Story 1_SCH=A 4"). In those cases the containing Space name (like
    # "Perimeter_ZN_1" or "Core_ZN") is what modelers recognise, so we
    # colour and legend by the space name and stash the raw zone name on
    # each surface for reference.
    #
    # For coloring purposes we use `zone_display` on surfaces, which is
    # `zone` unless it matches the BTAP auto-generated pattern, in which
    # case we fall back to the containing Space name.
    def friendly_zone_name(zone_raw: str, space_name: str | None) -> str:
        if not zone_raw:
            return space_name or "(unassigned)"
        if zone_raw.startswith("ALL_ST=") or zone_raw.startswith("BTAP") \
                or "SCH=" in zone_raw:
            return space_name or zone_raw
        return zone_raw

    for s in surfaces_out:
        s["zone_display"] = friendly_zone_name(s["zone"], s["space"])

    zone_names_ordered = []
    seen = set()
    for s in surfaces_out:
        z = s["zone_display"]
        if z and z not in seen:
            seen.add(z)
            zone_names_ordered.append(z)

    stories_ordered = sorted(
        ({"name": v["name"], "nominal_z": v["nominal_z"]} for v in stories.values()),
        key=lambda s: s["nominal_z"],
    )

    bbox = None
    if xs:
        bbox = {
            "min": [min(xs), min(ys), min(zs)],
            "max": [max(xs), max(ys), max(zs)],
            "size": [max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)],
        }

    archetype = ARCHETYPE_MAP.get(path.name, path.stem)
    return {
        "archetype": archetype,
        "name": building_name or archetype,
        "bbox": bbox,
        "stories": stories_ordered,
        "zones": [
            {"name": z, "color_index": i}
            for i, z in enumerate(zone_names_ordered)
        ],
        "surfaces": surfaces_out,
        "subsurfaces": subsurfaces_out,
    }


def main():
    if not OSM_DIR.exists():
        raise SystemExit(f"OSM directory not found: {OSM_DIR}")

    print(f"Reading OSMs from {OSM_DIR}")
    print(f"Writing JSON to  {OUT_DIR}")
    print()

    total = 0
    for osm_path in sorted(OSM_DIR.glob("*.osm")):
        archetype = ARCHETYPE_MAP.get(osm_path.name, osm_path.stem)
        print(f"  Parsing {osm_path.name} -> {archetype}...", flush=True)
        data = parse_building(osm_path)
        out_path = OUT_DIR / f"{archetype}.json"
        out_path.write_text(
            json.dumps(data, separators=(",", ":")),
            encoding="utf-8",
        )
        n_surf = len(data["surfaces"])
        n_zones = len(data["zones"])
        n_stories = len(data["stories"])
        size_kb = out_path.stat().st_size / 1024
        bbox = data["bbox"]
        dims = f"{bbox['size'][0]:.1f}x{bbox['size'][1]:.1f}x{bbox['size'][2]:.1f} m" if bbox else "n/a"
        print(f"     surfaces={n_surf}  zones={n_zones}  stories={n_stories}"
              f"  bbox={dims}  ({size_kb:.0f} KB)")
        total += 1
    print(f"\n{total} files written.")


if __name__ == "__main__":
    main()
