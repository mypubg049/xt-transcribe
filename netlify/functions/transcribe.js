// XT Transcribe - Netlify Function (v3, uses Supadata API)
// The API key is NOT in this file. It is stored in Netlify as SUPADATA_API_KEY.

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function reply(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

function getVideoId(input) {
  if (!input) return null;
  const text = String(input).trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : "https://" + text);
  } catch (e) {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/")[1];
    return /^[\w-]{11}$/.test(id || "") ? id : null;
  }
  if (host === "youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
    const v = url.searchParams.get("v");
    if (v && /^[\w-]{11}$/.test(v)) return v;
    const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/);
    if (m) return m[1];
  }
  return null;
}

function langName(code) {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) || code;
  } catch (e) {
    return code;
  }
}

async function getTitle(videoId) {
  try {
    const res = await fetch(
      "https://www.youtube.com/oembed?format=json&url=" +
        encodeURIComponent("https://www.youtube.com/watch?v=" + videoId),
      { signal: AbortSignal.timeout(3500) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.title || null;
  } catch (e) {
    return null;
  }
}

exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const videoId = getVideoId(params.url);
    if (!videoId) {
      return reply(400, { error: "That doesn't look like a valid YouTube link. Check it and try again." });
    }

    const apiKey = process.env.SUPADATA_API_KEY;
    if (!apiKey) {
      return reply(500, { error: "The site isn't fully set up yet (API key missing)." });
    }

    let endpoint =
      "https://api.supadata.ai/v1/youtube/transcript?text=false&videoId=" + encodeURIComponent(videoId);
    if (params.lang) endpoint += "&lang=" + encodeURIComponent(params.lang);

    const [res, title] = await Promise.all([
      fetch(endpoint, { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(8500) }),
      getTitle(videoId),
    ]);

    const raw = await res.text();
    let data = {};
    try {
      data = JSON.parse(raw);
    } catch (e) {
      /* ignore */
    }

    if (!res.ok) {
      const code = " [Supadata " + res.status + "]";
      const blob = (raw || "").toLowerCase();
      if (res.status === 404 || blob.indexOf("unavailable") !== -1) {
        return reply(404, { error: "This video has no captions, so there's nothing to transcribe." + code });
      }
      if (res.status === 401 || res.status === 403) {
        return reply(502, { error: "The transcript service rejected our key. The site owner needs to check it." + code });
      }
      if (res.status === 402 || res.status === 429) {
        return reply(503, { error: "We've hit our transcript limit for now. Please try again later." + code });
      }
      return reply(502, { error: "Couldn't get the transcript right now. Try again in a minute." + code });
    }

    let segments = [];
    if (Array.isArray(data.content)) {
      segments = data.content
        .map((c) => ({ start: (Number(c.offset) || 0) / 1000, text: String(c.text || "").replace(/\s+/g, " ").trim() }))
        .filter((s) => s.text);
    } else if (typeof data.content === "string" && data.content.trim()) {
      segments = [{ start: 0, text: data.content.trim() }];
    }
    if (!segments.length) {
      return reply(404, { error: "This video has no captions, so there's nothing to transcribe." });
    }

    const codes = Array.isArray(data.availableLangs) && data.availableLangs.length ? data.availableLangs : [data.lang || "en"];
    return reply(200, {
      videoId,
      title: title || "YouTube video",
      language: data.lang || codes[0],
      languages: codes.map((c) => ({ code: c, name: langName(c) })),
      segments,
    });
  } catch (err) {
    return reply(500, { error: "Something went wrong on our side. Try again in a moment." });
  }
};

exports._test = { getVideoId };
