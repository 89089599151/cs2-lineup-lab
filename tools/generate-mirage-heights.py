
"""Derive browser-ready 32-unit walkable height cells from a local Mirage VPK."""

import argparse
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import subprocess
import tempfile

CELL_SIZE = 32
Z_STEP = 8
SAME_FLOOR_GAP = 24
NAV_PATH = "maps/de_mirage.nav"
PHYSICS_PATH = "maps/de_mirage/world_physics.vmdl_c"
GLTF_TYPES = {5121: "B", 5123: "H", 5125: "I", 5126: "f"}
S2V_AXIS_METADATA = [0, 0, .0254, 0, .0254, 0, 0, 0, 0, .0254, 0, 0, 0, 0, 0, 1]


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def steam_build(vpk):
    for folder in vpk.parents:
        manifest = folder / "appmanifest_730.acf"
        if manifest.is_file():
            match = re.search(r'"buildid"\s+"(\d+)"', manifest.read_text(encoding="utf-8-sig"))
            if match:
                return match[1]
    raise ValueError("Steam build is unknown. Supply --game-build.")


def run_cli(cli, *args):
    result = subprocess.run([str(cli), *map(str, args)], capture_output=True, text=True, errors="replace")
    if result.returncode:
        raise ValueError(f"Source 2 Viewer failed:\n{result.stdout[-2000:]}\n{result.stderr[-2000:]}")


def read_glb(path):
    payload = path.read_bytes()
    signature, version, length = struct.unpack_from("<4sII", payload)
    if signature != b"glTF" or version != 2 or len(payload) != length:
        raise ValueError(f"Invalid GLB: {path}")
    offset = 12
    blocks = {}
    while offset < length:
        size, kind = struct.unpack_from("<I4s", payload, offset)
        offset += 8
        blocks[kind] = memoryview(payload)[offset:offset + size]
        offset += size
    return json.loads(bytes(blocks[b"JSON"])), blocks[b"BIN\0"]


def accessor(gltf, binary, index, components):
    info = gltf["accessors"][index]
    view = gltf["bufferViews"][info["bufferView"]]
    fmt = "<" + GLTF_TYPES[info["componentType"]] * components
    offset = view.get("byteOffset", 0) + info.get("byteOffset", 0)
    stride = view.get("byteStride", struct.calcsize(fmt))
    return [struct.unpack_from(fmt, binary, offset + stride * row) for row in range(info["count"])]


def mesh_triangles(document, binary, node):
    matrix = node.get("matrix", [])
    if len(matrix) != 16 or any(abs(a - b) > 1e-6 for a, b in zip(matrix, S2V_AXIS_METADATA)):
        raise ValueError("Unexpected GLB transform. Verify Source 2 Viewer's coordinate convention.")
    # The node matrix is for display in glTF; raw vertices are Hammer Z-up coordinates.
    for primitive in document["meshes"][node["mesh"]]["primitives"]:
        if primitive.get("mode", 4) != 4:
            raise ValueError("Expected triangle primitives.")
        points = accessor(document, binary, primitive["attributes"]["POSITION"], 3)
        indices = accessor(document, binary, primitive["indices"], 1)
        if len(indices) % 3:
            raise ValueError("Incomplete triangle in the mesh.")
        for i in range(0, len(indices), 3):
            yield [points[row[0]] for row in indices[i:i + 3]]


def nav_triangles(path):
    document, binary = read_glb(path)
    for node in document["nodes"]:
        if node.get("extras", {}).get("HullIndex") == 0:
            yield from mesh_triangles(document, binary, node)


def clip_edge(polygon, axis, boundary, direction):
    if not polygon:
        return []
    clipped = []
    previous = polygon[-1]
    previous_inside = direction * (previous[axis] - boundary) >= 0
    for point in polygon:
        inside = direction * (point[axis] - boundary) >= 0
        if inside != previous_inside:
            ratio = (boundary - previous[axis]) / (point[axis] - previous[axis])
            clipped.append(tuple(a + (b - a) * ratio for a, b in zip(previous, point)))
        if inside:
            clipped.append(point)
        previous = point
        previous_inside = inside
    return clipped


def sample_polygon(polygon):
    if len(polygon) < 3:
        return 0, 0
    ax, ay, az = polygon[0]
    area = height = 0
    for (bx, by, bz), (cx, cy, cz) in zip(polygon[1:], polygon[2:]):
        weight = abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2
        area += weight
        height += weight * (az + bz + cz) / 3
    return area, height


def floor_heights(samples):
    clusters = []
    previous = -math.inf
    for z, area in sorted(samples):
        if z - previous > SAME_FLOOR_GAP:
            clusters.append([0, 0])
        clusters[-1][0] += z * area
        clusters[-1][1] += area
        previous = z
    return sorted({math.floor(total / area / Z_STEP + 0.5) * Z_STEP for total, area in clusters})


def build_cells(triangles):
    cells = defaultdict(list)
    for polygon in triangles:
        x, y, _ = zip(*polygon)
        for column in range(math.floor(min(x) / CELL_SIZE), math.floor(max(x) / CELL_SIZE) + 1):
            column_poly = clip_edge(polygon, 0, column * CELL_SIZE, 1)
            column_poly = clip_edge(column_poly, 0, (column + 1) * CELL_SIZE, -1)
            for row in range(math.floor(min(y) / CELL_SIZE), math.floor(max(y) / CELL_SIZE) + 1):
                piece = clip_edge(column_poly, 1, row * CELL_SIZE, 1)
                piece = clip_edge(piece, 1, (row + 1) * CELL_SIZE, -1)
                area, weighted_z = sample_polygon(piece)
                if area >= 1:
                    cells[column, row].append((weighted_z / area, area))
    if not cells:
        raise ValueError("No walkable cells were generated.")
    return {f"{x},{y}": floor_heights(samples) for (x, y), samples in sorted(cells.items())}


def write_heights(path, triangles, game_build, vpk_hash, nav_hash):
    cells = build_cells(triangles)
    rows = [f'{json.dumps(key)}:{json.dumps(heights, separators=(",", ":"))}' for key, heights in cells.items()]
    compact = ",\n".join("    " + ",".join(rows[i:i + 8]) for i in range(0, len(rows), 8))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "// Generated from the installed Mirage navigation hull by tools/generate-mirage-heights.py.\n"
        "export const mirageWalkableHeights = {\n"
        '  map: "de_mirage",\n'
        f"  gameBuild: {json.dumps(game_build)},\n"
        f"  vpkSha256: {json.dumps(vpk_hash)},\n"
        f"  navSha256: {json.dumps(nav_hash)},\n"
        f"  cellSize: {CELL_SIZE},\n"
        f"  zStep: {Z_STEP},\n"
        "  cells: {\n" + compact + "\n  },\n};\n",
        encoding="utf-8",
    )
    print(f"{path}: {len(cells)} cells, {sum(len(z) > 1 for z in cells.values())} with overlapping floors")


def z_at(x, y, triangle):
    (ax, ay, az), (bx, by, bz), (cx, cy, cz) = triangle
    if not min(ax, bx, cx) <= x <= max(ax, bx, cx) or not min(ay, by, cy) <= y <= max(ay, by, cy):
        return None
    ux, uy, vx, vy = bx - ax, by - ay, cx - ax, cy - ay
    determinant = ux * vy - uy * vx
    if abs(determinant) < 1e-7:
        return None
    dx, dy = x - ax, y - ay
    u = (dx * vy - dy * vx) / determinant
    v = (ux * dy - uy * dx) / determinant
    if u >= -1e-7 and v >= -1e-7 and u + v <= 1 + 1e-7:
        return round(az + u * (bz - az) + v * (cz - az), 4)
    return None


def probe_positions(nav_glb, physics_glb, points):
    nav = list(nav_triangles(nav_glb))
    document, binary = read_glb(physics_glb)
    world = [(node.get("extras", {}), list(mesh_triangles(document, binary, node)))
             for node in document["nodes"] if "mesh" in node]
    report = []
    for x, y, height in points:
        walkable = {z for triangle in nav if (z := z_at(x, y, triangle)) is not None}
        hits = set()
        for extra, triangles in world:
            for triangle in triangles:
                z = z_at(x, y, triangle)
                if z is not None:
                    hits.add((z, extra.get("SurfaceProperty", ""), extra.get("CollisionGroup", ""),
                              tuple(extra.get("InteractAs", []))))
        nearest = sorted(hits, key=lambda hit: (abs(hit[0] - height), hit))[:8]
        report.append({
            "point": [x, y, height],
            "walkableZAtXY": sorted(walkable),
            "nearestWorldSurfaces": [
                {"z": z, "surface": surface, "group": group, "tags": tags}
                for z, surface, group, tags in nearest
            ],
        })
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vpk", required=True, type=Path, help="Installed game/csgo/maps/de_mirage.vpk.")
    parser.add_argument("--cli", required=True, type=Path, help="Path to the Source 2 Viewer CLI binary.")
    parser.add_argument("--game-build", help="Steam build ID. Defaults to the installed appmanifest_730.acf.")
    parser.add_argument(
        "--probe", action="append", nargs=3, type=float, metavar=("X", "Y", "Z"),
        help="Report local navigation and collision heights at a point without writing the browser grid.",
    )
    parser.add_argument(
        "--output", type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "mirage-walkable-heights.js",
    )
    options = parser.parse_args()
    vpk = options.vpk.resolve()
    cli = options.cli.resolve()
    try:
        if not vpk.is_file() or vpk.name != "de_mirage.vpk" or not cli.is_file():
            raise ValueError("Pass the installed de_mirage.vpk and Source2Viewer-CLI paths.")
        build = options.game_build or steam_build(vpk)
        with tempfile.TemporaryDirectory(prefix="mirage-walkable-") as temporary:
            scratch = Path(temporary)
            run_cli(cli, "-i", vpk, "-f", NAV_PATH, "-o", scratch)
            nav = scratch / NAV_PATH
            glb = scratch / "nav.glb"
            run_cli(cli, "-i", nav, "-o", glb, "--gltf_export_format", "glb")
            if options.probe:
                if not all(math.isfinite(value) for point in options.probe for value in point):
                    raise ValueError("Probe coordinates must be finite.")
                run_cli(cli, "-i", vpk, "-f", PHYSICS_PATH, "-o", scratch, "-d",
                        "--gltf_export_format", "glb", "--gltf_export_materials")
                physics = scratch / "maps/de_mirage/world_physics_physics.glb"
                print(json.dumps({"map": "de_mirage", "gameBuild": build, "vpkSha256": sha256(vpk),
                                  "probes": probe_positions(glb, physics, options.probe)}, indent=2))
            else:
                write_heights(options.output, nav_triangles(glb), build, sha256(vpk), sha256(nav))
    except (OSError, ValueError, KeyError, struct.error) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
