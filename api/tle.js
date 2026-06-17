// Vercel Edge Function: resilient CelesTrak proxy.
//
// CelesTrak rate-limits (HTTP 403) the large feeds when hit directly from many
// browsers — and even an edge proxy can get throttled when its cache misses.
// So the source of truth is an HOURLY SNAPSHOT committed to this repo by the
// "Refresh TLE snapshots" GitHub Action (which fetches CelesTrak from GitHub's
// runners, not from visitors). This function serves that snapshot (CDN-cached),
// and only falls back to a live CelesTrak fetch if no snapshot exists yet.
//
// Result: visitors never trigger CelesTrak rate limiting; the globe always has
// data. TLE data is valid for days, so an hourly snapshot is plenty fresh.
//
// Usage from the Framer globe component:
//   fetch("https://satellite-globe-proxy.vercel.app/api/tle?group=active")

export const config = { runtime: "edge" }

const ALLOWED_GROUPS = new Set([
    "active",
    "stations",
    "starlink",
    "oneweb",
    "gps-ops",
    "galileo",
    "glo-ops",
    "beidou",
    "science",
    "weather",
    "noaa",
    "goes",
    "geo",
    "visual",
    "cubesat",
    "last-30-days",
])

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
}

// Snapshot sources (committed hourly by the GitHub Action). raw = instant on
// push; jsDelivr = CDN-backed. We try raw first, then jsDelivr.
const SNAPSHOT_SOURCES = [
    "https://raw.githubusercontent.com/PeanutButte7/satellite-globe-proxy/main/snapshots",
    "https://cdn.jsdelivr.net/gh/PeanutButte7/satellite-globe-proxy@main/snapshots",
]

export default async function handler(request) {
    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS })
    }

    const { searchParams } = new URL(request.url)
    const group = (searchParams.get("group") || "active").toLowerCase()
    const format = (searchParams.get("format") || "tle").toLowerCase()

    if (!ALLOWED_GROUPS.has(group)) {
        return json({ error: "group not allowed", allowed: [...ALLOWED_GROUPS] }, 400)
    }
    if (format !== "tle" && format !== "json") {
        return json({ error: "format must be tle or json" }, 400)
    }

    // Primary path (tle): serve the committed snapshot.
    if (format === "tle") {
        for (const base of SNAPSHOT_SOURCES) {
            try {
                const r = await fetch(`${base}/${group}.tle`)
                if (r.ok) {
                    const body = await r.text()
                    if (body && body.length > 500 && body.includes("\n1 ")) {
                        return ok(body, "text/plain; charset=utf-8", "snapshot")
                    }
                }
            } catch (e) {
                /* try next source */
            }
        }
    }

    // Fallback: live CelesTrak (no snapshot yet, or json requested).
    try {
        const upstream =
            `https://celestrak.org/NORAD/elements/gp.php` +
            `?GROUP=${encodeURIComponent(group)}&FORMAT=${format}`
        const r = await fetch(upstream, {
            headers: {
                "User-Agent":
                    "satellite-globe-hackathon/1.0 (+https://github.com/PeanutButte7/satellite-globe-proxy)",
                Accept: format === "json" ? "application/json" : "text/plain",
            },
        })
        if (r.ok) {
            const body = await r.text()
            const ct =
                format === "json"
                    ? "application/json; charset=utf-8"
                    : "text/plain; charset=utf-8"
            return ok(body, ct, "live")
        }
        return json({ error: `no snapshot and upstream ${r.status}` }, 502)
    } catch (e) {
        return json({ error: "no snapshot and upstream failed", detail: String(e) }, 502)
    }
}

function ok(body, contentType, source) {
    return new Response(body, {
        status: 200,
        headers: {
            ...CORS,
            "Content-Type": contentType,
            "X-Data-Source": source,
            // 30-min edge cache; serve stale up to 2h while revalidating.
            "Cache-Control":
                "public, s-maxage=1800, max-age=600, stale-while-revalidate=7200",
        },
    })
}

function json(obj, status) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { ...CORS, "Content-Type": "application/json" },
    })
}
