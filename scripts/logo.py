import math
cx, cy, R = 935, 905, 468
gap = 28      # half the gap between faces
rad = 64      # corner rounding
s = math.sqrt(3)/2
top=(cx,cy-R); ur=(cx+R*s,cy-R/2); lr=(cx+R*s,cy+R/2); bot=(cx,cy+R); ll=(cx-R*s,cy+R/2); ul=(cx-R*s,cy-R/2); c=(cx,cy)
faces={'top':[ul,top,ur,c],'left':[ul,c,bot,ll],'right':[c,ur,lr,bot]}
def inset(poly,d):
    # offset each edge inward by d, intersect adjacent edges
    n=len(poly); lines=[]
    # orientation
    area=sum(poly[i][0]*poly[(i+1)%n][1]-poly[(i+1)%n][0]*poly[i][1] for i in range(n))
    sg=1 if area>0 else -1
    for i in range(n):
        a=poly[i]; b=poly[(i+1)%n]
        dx,dy=b[0]-a[0],b[1]-a[1]; L=math.hypot(dx,dy)
        nx,ny=-dy/L*sg, dx/L*sg
        lines.append(((a[0]+nx*d,a[1]+ny*d),(dx,dy)))
    out=[]
    for i in range(n):
        (p1,d1)=lines[i-1]; (p2,d2)=lines[i]
        den=d1[0]*d2[1]-d1[1]*d2[0]
        t=((p2[0]-p1[0])*d2[1]-(p2[1]-p1[1])*d2[0])/den
        out.append((p1[0]+d1[0]*t,p1[1]+d1[1]*t))
    return out
def rounded(poly,r):
    n=len(poly); parts=[]
    for i in range(n):
        p=poly[i]; a=poly[i-1]; b=poly[(i+1)%n]
        def tow(q):
            dx,dy=q[0]-p[0],q[1]-p[1]; L=math.hypot(dx,dy); k=min(r,L/2.2)/L
            return (p[0]+dx*k,p[1]+dy*k)
        parts.append((tow(a),p,tow(b)))
    d=f"M{parts[0][2][0]:.1f} {parts[0][2][1]:.1f}"
    for i in range(1,n+1):
        s0,p,s1=parts[i%n]
        d+=f"L{s0[0]:.1f} {s0[1]:.1f}Q{p[0]:.1f} {p[1]:.1f} {s1[0]:.1f} {s1[1]:.1f}"
    return d+"Z"
paths={k:rounded(inset(v,gap),rad) for k,v in faces.items()}
cursor="M1221.34 1365.75C1185.16 1276.02 1270.17 1184.85 1362.21 1214.68L1840.5 1369.68C1938.25 1401.35 1947.49 1536.01 1854.99 1580.75L1729.06 1641.65C1703.47 1654.03 1683.42 1675.53 1672.86 1701.93L1620.89 1831.79C1582.72 1927.19 1447.74 1927.36 1409.32 1832.06L1221.34 1365.75Z"
op={'top':1,'left':0.84,'right':0.66}
body=''.join(f'<path d="{paths[k]}" fill="url(#ink)" fill-opacity="{op[k]}"/>' for k in ['top','left','right'])
svg=f'''<svg width="2494" height="2494" viewBox="0 0 2494 2494" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="2494" height="2494" rx="600" fill="url(#bg)"/>
{body}
<path d="{cursor}" fill="url(#ink)"/>
<defs>
<linearGradient id="bg" x1="1247" y1="0" x2="1247" y2="2494" gradientUnits="userSpaceOnUse"><stop stop-color="#5EFF00"/><stop offset="1" stop-color="#BEFF97"/></linearGradient>
<linearGradient id="ink" x1="1271.18" y1="535" x2="1271.18" y2="1903.44" gradientUnits="userSpaceOnUse"><stop/><stop offset="1" stop-opacity="0.7"/></linearGradient>
</defs>
</svg>'''
open('build/logo.svg','w').write(svg)
import json; json.dump(paths,open('build/logo-paths.json','w'))
