// XT Transcribe - Netlify Function (v2)
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
        clientVersion: "20.44.38",
        androidSdkVersion: 30,
        osName: "Android",
        osVersion: "11",
        hl: "en",
        gl: "US",
      },
    },
    headers: {
      "User-Agent": "com.google.android.youtube/20.44.38 (Linux; U; Android 11) gzip",
      "X-YouTube-Client-Name": "3",
      "X-YouTube-Client-Version": "20.44.38",
    },
  },
  {
    name: "ANDROID_VR",
    context: {
      client: {
        clientName: "ANDROID_VR",
        clientVersion: "1.62.27",
        deviceMake: "Oculus",
        deviceModel: "Quest 3",
        androidSdkVersion: 32,
        osName: "Android",
        osVersion: "12L",
        hl: "en",
        gl: "US",
      },
    },
    headers: {
      "User-Agent":
        "com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
      "X-YouTube-Client-Name": "28",
      "X-YouTube-Client-Version": "1.62.27",
    },
  },
  {
    name: "IOS",
    context: {
      client: {
        clientName: "IOS",
        clientVersion: "20.10.4",
        deviceMake: "Apple",
        deviceModel: "iPhone16,2",
        osName: "iPhone",
        osVersion: "18.3.2.22D82",
        hl: "en",
        gl: "US",
      },
    },
    headers: {
      "User-Agent": "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
      "X-YouTube-Client-Name": "5",
      "X-YouTube-Client-Version": "20.10.4",
    },
  },
  {
    name: "WEB_EMBEDDED",
    context: {
      client: {
        clientName: "WEB_EMBEDDED_PLAYER",
        clientVersion: "1.20250310.01.00",
        hl: "en",
        gl: "US",
      },
      thirdParty: { embedUrl: "https://www.google.com" },
    },
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "X-YouTube-Client-Name": "56",
      "X-YouTube-Client-Version": "1.20250310.01.00",
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

function parseCaptionJson(text) {
  try {
    const data = JSON.parse(text);
    const segments = [];
    (data.events || []).forEach((ev) => {
      if (!ev.segs) return;
      const t = ev.segs.map((s) => s.utf8 || "").join("").replace(/\s*\n\s*/g, " ").trim();
      if (t) segments.push({ start: (ev.tStartMs || 0) / 1000, text: t });
    });
    return segments;
  } catch (e) {
    return [];
  }
}

async function callPlayer(videoId, client) {
  const context = JSON.parse(JSON.stringify(client.context));
  const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "CONSENT=YES+1", ...client.headers },
    body: JSON.stringify({ context, videoId, contentCheckOk: true, racyCheckOk: true }),
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) return { note: client.name + ":HTTP" + res.status, player: null };
  const player = await res.json();
  const status = (player.playabilityStatus && player.playabilityStatus.status) || "?";
  return { note: client.name + ":" + status, player, client };
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

async function fetchSegments(track, client) {
  const base = track.baseUrl.replace(/&fmt=[^&]*/, "");
  const headers = {
    "User-Agent": client.headers["User-Agent"],
    "Accept-Language": "en-US,en;q=0.9",
    Cookie: "CONSENT=YES+1",
  };
  const res = await fetch(base, { headers, signal: AbortSignal.timeout(7000) });
  const body = await res.text();
  let segs = parseCaptionXml(body);
  if (segs.length) return segs;
  const res2 = await fetch(base + "&fmt=json3", { headers, signal: AbortSignal.timeout(7000) });
  return parseCaptionJson(await res2.text());
}

exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const videoId = getVideoId(params.url);
    if (!videoId) {
      return reply(400, { error: "That doesn't look like a valid YouTube link. Check it and try again." });
    }

    const settled = await Promise.all(
      CLIENTS.map((c) => callPlayer(videoId, c).catch((e) => ({ note: c.name + ":ERR", player: null })))
    );
    const notes = settled.map((s) => s.note);

    let sawOk = false;
    let reason = "";
    for (const s of settled) {
      const p = s.player;
      if (!p) continue;
      const st = p.playabilityStatus && p.playabilityStatus.status;
      if (st === "OK") sawOk = true;
      else if (!reason && p.playabilityStatus && p.playabilityStatus.reason) {
        reason = String(p.playabilityStatus.reason).slice(0, 140);
      }
      const tracks = tracksOf(p);
      if (!tracks.length) continue;
      const track = pickTrack(tracks, params.lang);
      let segments = [];
      try {
        segments = await fetchSegments(track, s.client);
      } catch (e) {
        notes.push(s.client.name + ":CAPFAIL");
      }
      if (!segments.length) {
        notes.push(s.client.name + ":EMPTY");
        continue;
      }
      return reply(200, {
        videoId,
        title: (p.videoDetails && p.videoDetails.title) || "YouTube video",
        language: track.languageCode,
        languages: tracks.map((t) => ({
          code: t.languageCode,
          name: trackName(t) + (t.kind === "asr" ? " (auto)" : ""),
        })),
        segments,
      });
    }

    const debug = " [" + notes.join(", ") + "]";
    if (sawOk && !notes.some((n) => /EMPTY|CAPFAIL/.test(n))) {
      return reply(404, { error: "This video has no captions, so there's nothing to transcribe." + debug });
    }
    if (reason) {
      return reply(422, { error: "Couldn't open this video. " + reason + debug });
    }
    return reply(502, { error: "Couldn't get captions from YouTube right now. Try again in a minute." + debug });
  } catch (err) {
    return reply(500, { error: "Something went wrong on our side. Try again in a moment." });
  }
};

exports._test = { getVideoId, parseCaptionXml, parseCaptionJson, decodeEntities };
