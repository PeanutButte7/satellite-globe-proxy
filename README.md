# satellite-globe-proxy

A resilient proxy so a public site can show live satellite positions without
ever tripping [CelesTrak](https://celestrak.org)'s per-IP rate limit (HTTP 403
on the large feeds).

**How it stays reliable:** a GitHub Action (`.github/workflows/refresh-tle.yml`)
fetches CelesTrak **once an hour from GitHub's runners** and commits the feeds to
`/snapshots`. The edge function serves those committed snapshots (CDN-cached,
permissive CORS), so visitors never trigger a live CelesTrak request. It only
falls back to a live CelesTrak fetch if a snapshot doesn't exist yet. TLE data is
valid for days, so hourly snapshots are plenty fresh.

Built for a satellite-tracking globe (interactive 3D globe rendering ~15k live
satellites), but it's a generic CelesTrak GP-feed proxy.

## Endpoint

```
GET /api/tle?group=<group>&format=<tle|json>
```

- `group` — one of the allowlisted CelesTrak groups (default `active`):
  `active, stations, starlink, oneweb, gps-ops, galileo, glo-ops, beidou,
  science, weather, noaa, goes, geo, visual, cubesat, last-30-days`
- `format` — `tle` (default) or `json`

Response: the feed with `Access-Control-Allow-Origin: *`, cached at the edge for
30 min (`s-maxage=1800`, `stale-while-revalidate=7200`).

### Examples

```
/api/tle?group=active            # all active satellites, TLE format
/api/tle?group=starlink          # Starlink only
/api/tle?group=stations&format=json
```

## Deploy (Vercel)

```bash
npm i -g vercel      # once
vercel               # log in, accept defaults (deploys a preview)
vercel --prod        # promote to a stable production URL
```

Then open `https://<your-app>.vercel.app/api/tle?group=active` — you should see
TLE text (3 lines per satellite), not a 403.

## Notes

- Update the `User-Agent` URL in [`api/tle.js`](api/tle.js) to your real site
  once published — good citizenship lets CelesTrak contact you instead of
  hard-blocking.
- Vercel Hobby (free) tier is plenty: the edge cache means CelesTrak is hit
  ~twice an hour total, regardless of traffic.
- Data courtesy of CelesTrak / US Space Force 18th Space Defense Squadron.

## License

MIT
