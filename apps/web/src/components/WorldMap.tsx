import { useMemo } from 'react';
import { COUNTRIES } from '@flatland/core';
import { LAND_PATH } from '../land';
import { flag } from '../lib/format';

const x = (lon: number) => lon + 180;
const y = (lat: number) => 90 - lat;

/** Equirectangular "flat world" map. Pins = wallets that opted in to share ONLY their country. Rings = fresh activity. */
export function WorldMap({ counts, pulses = [], height }: { counts: Record<string, number>; pulses?: string[]; height?: number }) {
  const entries = useMemo(() => Object.entries(counts).filter(([cc]) => COUNTRIES[cc]).sort((a, b) => b[1] - a[1]), [counts]);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  const grat = useMemo(() => {
    let d = '';
    for (let lon = 0; lon <= 360; lon += 30) d += `M${lon} 0V180`;
    for (let lat = 0; lat <= 180; lat += 30) d += `M0 ${lat}H360`;
    return d;
  }, []);
  return (
    <div>
      <svg className="map" viewBox="0 0 360 180" role="img" aria-label="Map of voters who chose to share their country" style={height ? { height } : undefined} preserveAspectRatio="xMidYMid slice">
        <path className="grat" d={grat} />
        <path className="land" d={LAND_PATH} />
        {entries.map(([cc, n]) => {
          const [, lat, lon] = COUNTRIES[cc];
          const r = 1.6 + 4.2 * Math.sqrt(n / max);
          return (
            <g key={cc}>
              <circle className="pin" cx={x(lon)} cy={y(lat)} r={r}><title>{`${COUNTRIES[cc][0]} — ${n} wallet${n === 1 ? '' : 's'}`}</title></circle>
              {pulses.includes(cc) ? <circle className="ring" cx={x(lon)} cy={y(lat)} r={r + 1} /> : null}
            </g>
          );
        })}
      </svg>
      <div className="row small muted" style={{ marginTop: 8 }}>
        {entries.length === 0 ? <span>No one has shared a country yet — it's opt-in, country-level only, and revocable.</span> : entries.slice(0, 8).map(([cc, n]) => <span key={cc}>{flag(cc)} {n}</span>)}
      </div>
    </div>
  );
}
