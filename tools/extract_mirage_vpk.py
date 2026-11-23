#!/usr/bin/env python3
"""Extract original Mirage world data from the Valve Pak V2 file.

No third-party dependencies. Extracts collision source *as compiled resources*;
it does not decompile the Source 2 PHYS mesh into triangles.
"""
import argparse
import json
import struct
import zlib
from pathlib import Path

TARGETS = (
    'maps/de_mirage.nav',
    'maps/de_mirage.vmap_c',
    'maps/de_mirage/world_physics.vmdl_c',
    'maps/de_mirage/world_physics.vrman_c',
    'maps/de_mirage/world.vwrld_c',
)
VPK_MAGIC = 0x55AA1234


def vpk_entries(fp):
    fp.seek(0)
    magic, version, tree_size = struct.unpack('<III', fp.read(12))
    if (magic, version) != (VPK_MAGIC, 2):
        raise ValueError('Expected Valve VPK version 2')
    fp.seek(0)
    header = fp.read(28)
    _, _, _, data_size, _, _, _ = struct.unpack('<7I', header)
    tree_start = 28
    tree_end = tree_start + tree_size
    fp.seek(tree_start)

    def string():
        chars = bytearray()
        while fp.tell() < tree_end:
            b = fp.read(1)
            if b == b'\0':
                return chars.decode('utf-8')
            chars.extend(b)
        raise ValueError('Truncated VPK directory tree')

    entries = {}
    while True:
        extension = string()
        if not extension:
            break
        while True:
            folder = string()
            if not folder:
                break
            while True:
                stem = string()
                if not stem:
                    break
                crc, preload, archive, offset, size, tail = struct.unpack('<IHHIIH', fp.read(18))
                if tail != 0xFFFF:
                    raise ValueError('VPK entry separator mismatch')
                path = ('' if folder == ' ' else folder + '/') + stem + ('' if extension == ' ' else '.' + extension)
                preview = fp.read(preload)
                if path in TARGETS:
                    entries[path] = dict(offset=offset, size=size, crc=crc, archive=archive, preview=preview)
    if fp.tell() != tree_end:
        raise ValueError(f'VPK directory is misaligned: {fp.tell()} != {tree_end}')
    return entries, tree_end, data_size


def extract(path, output):
    with path.open('rb') as fp:
        entries, data_start, data_size = vpk_entries(fp)
        missing = set(TARGETS) - set(entries)
        if missing:
            raise ValueError(f'VPK missing requested map resources: {sorted(missing)}')
        report = {'source': path.name, 'dataSize': data_size, 'entries': {}}
        for name in TARGETS:
            item = entries[name]
            if item['archive'] != 32767:
                raise ValueError(f'External VPK archives not supported: {name}')
            if item['offset'] + item['size'] > data_size:
                raise ValueError(f'Out-of-bounds VPK entry: {name}')
            fp.seek(data_start + item['offset'])
            raw = item['preview'] + fp.read(item['size'])
            if zlib.crc32(raw) != item['crc']:
                raise ValueError(f'VPK CRC failed: {name}')
            target = output / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
            report['entries'][name] = {'bytes': len(raw), 'crcVerified': True}
            print(name, len(raw), 'CRC OK')
        (output / 'extraction-report.json').write_text(json.dumps(report, indent=2))
    return report


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('vpk', type=Path)
    p.add_argument('destination', type=Path)
    a = p.parse_args()
    extract(a.vpk, a.destination)


if __name__ == '__main__':
    main()
