/**
 * The ODIT 3D mark: the ODIT cursor, with the three dots folded into one cube.
 * Gradient ids are suffixed per instance because several copies can share a page.
 */

let seq = 0

export default function Logo({ size = 18 }: { size?: number }) {
  const u = 'o3d' + seq++
  return (
    <svg width={size} height={size} viewBox="0 0 2494 2494" fill="none" aria-label="ODIT 3D" style={{ display: 'block', flex: 'none' }}>
      <rect width="2494" height="2494" rx="600" fill={`url(#bg${u})`} />
      <path d="M641.1 639.0L879.6 501.3Q935.0 469.3 990.4 501.3L1228.9 639.0Q1284.3 671.0 1228.9 703.0L990.4 840.7Q935.0 872.7 879.6 840.7L641.1 703.0Q585.7 671.0 641.1 639.0Z" fill={`url(#ink${u})`} />
      <path d="M613.1 751.5L851.6 889.2Q907.0 921.2 907.0 985.2L907.0 1260.5Q907.0 1324.5 851.6 1292.5L613.1 1154.8Q557.7 1122.8 557.7 1058.8L557.7 783.5Q557.7 719.5 613.1 751.5Z" fill={`url(#ink${u})`} fillOpacity="0.84" />
      <path d="M1018.4 889.2L1256.9 751.5Q1312.3 719.5 1312.3 783.5L1312.3 1058.8Q1312.3 1122.8 1256.9 1154.8L1018.4 1292.5Q963.0 1324.5 963.0 1260.5L963.0 985.2Q963.0 921.2 1018.4 889.2Z" fill={`url(#ink${u})`} fillOpacity="0.66" />
      <path d="M1221.34 1365.75C1185.16 1276.02 1270.17 1184.85 1362.21 1214.68L1840.5 1369.68C1938.25 1401.35 1947.49 1536.01 1854.99 1580.75L1729.06 1641.65C1703.47 1654.03 1683.42 1675.53 1672.86 1701.93L1620.89 1831.79C1582.72 1927.19 1447.74 1927.36 1409.32 1832.06L1221.34 1365.75Z" fill={`url(#ink${u})`} />
      <defs>
        <linearGradient id={`bg${u}`} x1="1247" y1="0" x2="1247" y2="2494" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5EFF00" />
          <stop offset="1" stopColor="#BEFF97" />
        </linearGradient>
        <linearGradient id={`ink${u}`} x1="1271.18" y1="535" x2="1271.18" y2="1903.44" gradientUnits="userSpaceOnUse">
          <stop />
          <stop offset="1" stopOpacity="0.7" />
        </linearGradient>
      </defs>
    </svg>
  )
}
