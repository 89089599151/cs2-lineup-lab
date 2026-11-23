#!/usr/bin/env python3
"""Pre-screen CS2 Smoke Solver landings against actual Mirage NAV floors.

Important: NAV contains walkable surfaces, not roof/wall collision geometry.
'plausible' means floor-aligned only; it is NOT game verification.
"""
import gzip,json,math,collections,statistics,argparse
from pathlib import Path

CELL=128
MAX_FLOOR_DELTA=28

def cross(ax,ay,bx,by):return ax*by-ay*bx

def sample_z(poly,x,y):
    # Triangulate fan; barycentrically interpolate walkable floor Z.
    a=poly[0]
    for i in range(1,len(poly)-1):
        b=poly[i];c=poly[i+1]
        det=cross(b[0]-a[0],b[1]-a[1],c[0]-a[0],c[1]-a[1])
        if abs(det)<1e-7:continue
        s=cross(x-a[0],y-a[1],c[0]-a[0],c[1]-a[1])/det
        t=cross(b[0]-a[0],b[1]-a[1],x-a[0],y-a[1])/det
        if s>=-0.0001 and t>=-0.0001 and s+t<=1.0001:
            return a[2]+s*(b[2]-a[2])+t*(c[2]-a[2])
    return None

def index_nav(nav):
    grid=collections.defaultdict(list)
    for i,ar in enumerate(nav['areas']):
        if ar['hull'] != 0: continue # standard CS2 player nav hull only
        vertices=ar['corners'];xs=[v[0] for v in vertices];ys=[v[1] for v in vertices]
        for ix in range(math.floor(min(xs)/CELL),math.floor(max(xs)/CELL)+1):
            for iy in range(math.floor(min(ys)/CELL),math.floor(max(ys)/CELL)+1):
                grid[(ix,iy)].append(i)
    return grid

def candidate_levels(nav, grid, x,y):
    # Test walkable areas containing XY. We do not infer roof geometry from NAV.
    return [floor for i in grid.get((math.floor(x/CELL),math.floor(y/CELL)),())
            if (floor := sample_z(nav['areas'][i]['corners'],x,y)) is not None]

def main():
    p=argparse.ArgumentParser();p.add_argument('nav',type=Path);p.add_argument('atlas',type=Path);p.add_argument('output',type=Path)
    args=p.parse_args();nav=json.loads(args.nav.read_text());grid=index_nav(nav)
    with gzip.open(args.atlas,'rt') as fh: atlas=json.load(fh)
    counts=collections.Counter();examples={};quality=bytearray();deltas=[]
    for i,row in enumerate(atlas['rows']):
        _,_,_,_,_,x,y,z,time,bounces=row
        levels=candidate_levels(nav,grid,x,y)
        if levels:
            error=min(abs(z-h) for h in levels)
            if error<=MAX_FLOOR_DELTA:
                status=1 # floor-aligned but not physically verified
                deltas.append(error)
            else:
                status=2 # known navigable surface(s) on another level
        else:
            status=0 # unknown/no walkable surface (e.g. roof, obstacle, edge)
        # Bounce counts are not an error signal: valid smokes often include settling contacts.
        quality.append(status)
        counts[status]+=1
        examples.setdefault(status,[])
        if len(examples[status])<3: examples[status].append({'row':i,'landing':[x,y,z],'time':time,'bounces':bounces,'knownFloors':levels[:8]})
    metadata={
     'map':'de_mirage','atlasBuild':atlas['build'],'source':'de_mirage.nav (VPK)',
     'navVersion':nav['version'],'navAreas':nav['count'],'rowCount':len(quality),
     'classification':{'0':'offNavUnknown','1':'floorAlignedCandidate','2':'wrongLevel'},
     'floorZTolerance':MAX_FLOOR_DELTA,
     'counts':dict(sorted(counts.items())),
     'limitations':['NAV is not grenade collision geometry; landing floor alignment cannot prove a path misses roofs or walls.',
                    'Off-mesh smokes may be valid (boxes/ledges), but should not be advertised without game testing.',
                    'A trajectory that ends on a walkable floor may still obstruct the smoke effect.'],
     'sampleRows':examples}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_bytes(quality)
    args.output.with_suffix('.report.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2))
    print('STATUS COUNTS',counts)
    print('floor errors p50/p90', statistics.median(deltas) if deltas else '?', sorted(deltas)[int(len(deltas)*0.9)] if deltas else '?')
    print('examples',json.dumps(examples,indent=1))
    print('bytes',len(quality))
if __name__=='__main__':main()
