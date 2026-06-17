// Vercel Edge Function: cached CelesTrak proxy.
//
// Why this exists: CelesTrak rate-limits (HTTP 403) when its large feeds are
// fetched directly from many browsers. This proxy fetches CelesTrak ONCE per
// ~30 min per edge region (server-side, with a polite User-Agent), caches the
// result on Vercel's edge network, and serves every site visitor from cache
// with permissive CORS. CelesTrak sees ~2 requests/hour total instead of one
// per visitor.
//
// Usage from the Framer globe component:
//   fetch("https://<your-app>.vercel.app/api/tle?group=active")
//   fetch("https://<your-app>.vercel.app/api/tle?group=starlink")

export const config = { runtime: "edge" }

// Allowlist of CelesTrak GP groups we expose (prevents open-proxy abuse).
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

    const upstream =
        `https://celestrak.org/NORAD/elements/gp.php` +
        `?GROUP=${encodeURIComponent(group)}&FORMAT=${format}`

    let res
    try {
        res = await fetch(upstream, {
            headers: {
                // Identify the app so CelesTrak can reach us if needed (good citizenship).
                // TODO: replace with your real published Framer site URL.
                "User-Agent":
                    "satellite-globe-hackathon/1.0 (+https://your-site.framer.website)",
                Accept: format === "json" ? "application/json" : "text/plain",
            },
        })
    } catch (e) {
        return json({ error: "upstream fetch failed", detail: String(e) }, 502)
    }

    if (!res.ok) {
        // Don't cache upstream errors.
        return json({ error: `upstream ${res.status}` }, 502)
    }

    const body = await res.text()
    return new Response(body, {
        status: 200,
        headers: {
            ...CORS,
            "Content-Type":
                format === "json"
                    ? "application/json; charset=utf-8"
                    : "text/plain; charset=utf-8",
            // Edge caches this for 30 min; serves stale up to 2h while revalidating.
            // This is what shields CelesTrak from per-visitor load.
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
