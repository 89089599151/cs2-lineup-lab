#!/usr/bin/env python3
"""Extract CS2 v36 .nav walkable surfaces into an inspectable JSON file.
Based on Source 2 nav layout documented by ValveResourceFormat and Awpy.
Only walkable NAV areas; these are NOT collision meshes or a grenade-physics engine.
"""
import argparse
import json
import struct
from pathlib import Path

class Reader:
    def __init__(self, data):
        self.data, self.pos = data, 0
    def take(self, size):
        if size < 0 or self.pos + size > len(self.data):
            raise ValueError(f'Truncated NAV at {self.pos} reading {size} bytes')
        b = self.data[self.pos:self.pos+size]; self.pos += size; return b
    def read(self, fmt):
        return struct.unpack('<' + fmt, self.take(struct.calcsize('<' + fmt)))
    def u32(self): return self.read('I')[0]
    def i32(self): return self.read('i')[0]
    def align8(self): self.take((-self.pos) % 8)
    def cstring(self):
        end = self.data.find(b'\0', self.pos)
        if end == -1: raise ValueError('Invalid NAV string')
        result = self.data[self.pos:end]; self.pos = end+1; return result.decode('utf-8', 'replace')

def skip_kv3(r):
    r.align8()
    magic = r.u32()
    version = magic & 0xff
    if magic & 0xffffff00 != 0x4b563300 or not 2 <= version <= 5:
        raise ValueError(f'NAV has unsupported KV3 {magic:x} at offset {r.pos-4}')
    r.take(16) # GUID
    method = r.u32()
    r.take(4 + 16 + 4) # compression dict/frame, counters, object/array counts
    size_u, size_c, blocks, blobs = r.read('iiii')
    if version >= 4:
        _, block_bytes = r.read('Ii')
    else: block_bytes = 0
    if version >= 5:
        unc1, cmp1, unc2, cmp2 = r.read('iiii')
        r.take(32)
    else:
        unc1, cmp1, unc2, cmp2 = size_u, size_c, 0, 0
    if method not in (0, 1, 2) or blocks or blobs:
        raise ValueError(f'NAV KV3 with unsupported blocks or compression at offset {r.pos}')
    n = (unc1+unc2 if method == 0 else cmp1+cmp2) + block_bytes
    r.take(n)

def parse_nav(data):
    r = Reader(data)
    magic, version, subversion, flags = r.read('IIII')
    if magic != 0xfeedface or not 30 <= version <= 36:
        raise ValueError(f'Invalid NAV magic/version {magic:08x}/{version}')
    if version >= 36: skip_kv3(r)
    if version >= 31:
        corner_count = r.u32()
        if corner_count > 1000000: raise ValueError('Bad NAV corner count')
        corners = [list(r.read('fff')) for _ in range(corner_count)]
        polygon_count = r.u32()
        if polygon_count > 1000000: raise ValueError('Bad NAV polygon count')
        polygons = []
        for _ in range(polygon_count):
            n = r.read('B')[0]
            indexes = [r.u32() for _ in range(n)]
            if any(i >= len(corners) for i in indexes): raise ValueError('Bad corner pointer')
            polygons.append([corners[i] for i in indexes])
            if version >= 35: r.take(4)
    else: polygons = None
    if version >= 32: r.take(4)
    if version >= 35:
        markers = r.u32()
        if markers > 100000: raise ValueError('Too many markers')
        for _ in range(markers):r.cstring();r.take(48)
    if version >= 36: skip_kv3(r)
    count = r.u32()
    if count > 100000: raise ValueError('Too many areas')
    areas = []
    for _ in range(count):
        area_id, attrs, hull = r.read('IqB')
        if polygons is None:
            n = r.u32(); poly = [list(r.read('fff')) for _ in range(n)]
        else:
            idx = r.u32()
            if idx >= len(polygons): raise ValueError('Bad polygon pointer')
            poly = polygons[idx]
        r.take(4)
        neighbors = []
        for _ in range(len(poly)):
            nc = r.u32()
            if nc > 10000: raise ValueError('Bad neighbor count')
            for _ in range(nc):
                neighbor, _edge = r.read('II'); neighbors.append(neighbor)
        r.take(5)
        for _ in range(2):
            n = r.u32()
            if n > 100000: raise ValueError('Bad ladder count')
            r.take(4*n)
        if len(poly) >= 3:
            areas.append({'id':area_id,'hull':hull,'flags':attrs,'corners':poly,'neighbors':list(dict.fromkeys(neighbors))})
    return {'map':'de_mirage','kind':'navmesh','version':version,'subversion':subversion,'count':len(areas),'areas':areas,
            'disclaimer':'Navigation polygons show walkable floors only; not a full collision geometry.'}

def main():
    p=argparse.ArgumentParser()
    p.add_argument('source',type=Path)
    p.add_argument('destination',type=Path)
    a=p.parse_args()
    out=parse_nav(a.source.read_bytes())
    a.destination.parent.mkdir(parents=True,exist_ok=True)
    a.destination.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':')))
    zs=[c[2] for ar in out['areas'] for c in ar['corners']]
    print(f"NAV v{out['version']}: {out['count']} walkable areas, Z range {min(zs):.1f}..{max(zs):.1f}, bytes {a.destination.stat().st_size}")
if __name__=='__main__': main()
