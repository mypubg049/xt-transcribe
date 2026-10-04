// XT Transcribe - Netlify Function
// Fetches the caption track of a YouTube video and returns it as JSON.
// No npm packages needed (uses the built-in fetch of Node 18+).

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const CLIENTS = [
  {
    name: "ANDROID",
    context: {
      client: {
        clientName: "ANDROID",
        clientVersion: "20.10.38",
        androidSdkVersion: 34,
        hl: "en",
        gl: "US",
      },
    },
    headers: {
      "User-Agent": "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
      "X-YouTube-Client-Name": "3",
      "X-YouTube-Client-Version": "20.10.38",
    },
  },
  {
    name: "TV_EMBED",
    context: {
      client: {
        clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
        clientVersion: "2.0",
        hl: "en",
        gl: "US",
      },
      thirdParty: { embedUrl: "https://www.google.com" },
    },
    headers: {
      "User-Agent":
        "Mozilla/5.0 (SMART-TV; Linux; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) 85.0.4183.93/6.5 TV Safari/537.36",
      "X-YouTube-Client-Name": "85",
      "X-YouTube-Client-Version": "2.0",
    },
  },
];

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

function decodeEntities(str) {
  const once = (s) =>
    s
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  return once(once(str));
}

function cleanText(raw) {
  return decodeEntities(raw.replace(/<[^>]+>/g, ""))
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function parseCaptionXml(xml) {
  const segments = [];
  let m;
  if (/<p\s+t="/.test(xml)) {
    const re = /<p\s+t="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
    while ((m = re.exec(xml))) {
      const text = cleanText(m[2]);
      if (text) segments.push({ start: Number(m[1]) / 1000, text });
    }
  } else {
    const re = /<text\s+start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
    while ((m = re.exec(xml))) {
      const text = cleanText(m[2]);
      if (text) segments.push({ start: Number(m[1]), text });
    }
  }
  return segments;
}

async function getApiKey() {
  try {
    const res = await fetch("https://www.youtube.com/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        Cookie: "CONSENT=YES+1",
      },
    });
    const html = await res.text();
    const m = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

async function callPlayer(videoId, client, apiKey) {
  const endpoint =
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false" + (apiKey ? "&key=" + apiKey : "");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "CONSENT=YES+1", ...client.headers },
    body: JSON.stringify({
      context: client.context,
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    }),
  });
  if (!res.ok) return null;
  return res.json();
}

function tracksOf(player) {
  return (
    (player &&
      player.captions &&
      player.captions.playerCaptionsTracklistRenderer &&
      player.captions.playerCaptionsTracklistRenderer.captionTracks) ||
    []
  );
}

function trackName(track) {
  const n = track.name || {};
  if (n.simpleText) return n.simpleText;
  if (n.runs && n.runs[0]) return n.runs.map((r) => r.text).join("");
  return track.languageCode;
}

async function loadPlayer(videoId) {
  let lastPlayer = null;
  let apiKey = null;
  for (let round = 0; round < 2; round++) {
    for (const client of CLIENTS) {
      try {
        const player = await callPlayer(videoId, client, apiKey);
        if (player) lastPlayer = lastPlayer || player;
        if (tracksOf(player).length) return { player, tracks: tracksOf(player) };
        if (player) lastPlayer = player;
      } catch (e) {
        /* try next client */
      }
    }
    if (round === 0) apiKey = await getApiKey();
  }
  return { player: lastPlayer, tracks: [] };
}

function pickTrack(tracks, lang) {
  if (lang) {
    const exact = tracks.find((t) => t.languageCode === lang);
    if (exact) return exact;
  }
  const manualEn = tracks.find((t) => /^en/.test(t.languageCode) && t.kind !== "asr");
  if (manualEn) return manualEn;
  const anyEn = tracks.find((t) => /^en/.test(t.languageCode));
  if (anyEn) return anyEn;
  const manual = tracks.find((t) => t.kind !== "asr");
  return manual || tracks[0];
}

exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const videoId = getVideoId(params.url);
    if (!videoId) {
      return reply(400, { error: "That doesn't look like a valid YouTube link. Check it and try again." });
    }

    const { player, tracks } = await loadPlayer(videoId);

    const status = player && player.playabilityStatus && player.playabilityStatus.status;
    if (!tracks.length) {
      if (status && status !== "OK") {
        const reason =
          (player.playabilityStatus.reason || "").toString().slice(0, 140) || "This video can't be accessed.";
        return reply(422, { error: "Couldn't open this video. " + reason });
      }
      if (player) {
        return reply(404, { error: "This video has no captions, so there's nothing to transcribe." });
      }
      return reply(502, { error: "Couldn't reach YouTube right now. Try again in a minute." });
    }

    const track = pickTrack(tracks, params.lang);
    const captionUrl = track.baseUrl.replace(/&fmt=[^&]*/, "");
    const capRes = await fetch(captionUrl, {
      headers: { "User-Agent": CLIENTS[0].headers["User-Agent"], "Accept-Language": "en-US,en;q=0.9" },
    });
    const xml = await capRes.text();
    const segments = parseCaptionXml(xml);

    if (!segments.length) {
      return reply(502, { error: "YouTube didn't return caption text for this video. Try again in a minute." });
    }

    return reply(200, {
      videoId,
      title: (player.videoDetails && player.videoDetails.title) || "YouTube video",
      language: track.languageCode,
      languages: tracks.map((t) => ({
        code: t.languageCode,
        name: trackName(t) + (t.kind === "asr" ? " (auto)" : ""),
      })),
      segments,
    });
  } catch (err) {
    return reply(500, { error: "Something went wrong on our side. Try again in a moment." });
  }
};

exports._test = { getVideoId, parseCaptionXml, decodeEntities };
