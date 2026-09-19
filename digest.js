#!/usr/bin/env node
'use strict';

// =====================================================================
// MODEL - change this one line to switch the model. Used when the key
// in key.txt is a DeepSeek key.
const MODEL = 'deepseek-flash';
// OpenRouter needs a provider-qualified id. Used when key.txt starts
// with sk-or-.
const OPENROUTER_MODEL = 'deepseek/deepseek-flash';
// =====================================================================

// =====================================================================
// EMAIL - Composio (Gmail). Paste your Composio key into composio-key.txt
// beside this script. The key starts with ak_.
const COMPOSIO_USER_ID = 'pg-test-718bd6ee-70fb-4d5d-91bd-8f05b3722fc8'; // <-- the user_id your Gmail is connected under
const DIGEST_TO = 'azrockon456@gmail.com';        // <-- the address the digest is emailed to
// =====================================================================

const fs = require('fs');
const path = require('path');
const https = require('https');

const FOLDER = __dirname;
const KEY_FILE = path.join(FOLDER, 'key.txt');
const OUT_FILE = path.join(FOLDER, 'digest.html');

// My clients: small business owners (SMBs) in Bengaluru and online
// across India. Search words + the India edition of Google News.
const NEWS_QUERY = 'small business AI India';
const NEWS_URL =
  'https://news.google.com/rss/search?q=' +
  encodeURIComponent(NEWS_QUERY) +
  '&hl=en-IN&gl=IN&ceid=IN:en';

const TOP_N = 5;

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const COMPOSIO_URL = 'https://backend.composio.dev/api/v3/tools/execute/GMAIL_SEND_EMAIL';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtDate(value) {
  const d = new Date(value);
  if (!value || isNaN(d.getTime())) return '';
  return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}

function decodeEntities(text) {
  return String(text)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function request(url, options, body) {
  return new Promise(function (resolve, reject) {
    const req = https.request(url, options || {}, function (res) {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', function (chunk) {
        data += chunk;
      });
      res.on('end', function () {
        resolve({ status: res.statusCode, headers: res.headers, body: data });
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, function () {
      req.destroy(new Error('request timed out after 30s'));
    });
    if (body) req.write(body);
    req.end();
  });
}

function get(url, redirectsLeft) {
  return request(url, { method: 'GET', headers: { 'User-Agent': 'fwai-daily-digest/1.0' } }).then(
    function (res) {
      if (res.status >= 300 && res.status < 400 && res.headers.location) {
        if (redirectsLeft <= 0) throw new Error('too many redirects');
        const next = new URL(res.headers.location, url).toString();
        return get(next, redirectsLeft - 1);
      }
      if (res.status !== 200) throw new Error('feed returned HTTP ' + res.status);
      return res.body;
    }
  );
}

function readKey() {
  if (!fs.existsSync(KEY_FILE)) return null;
  const raw = fs.readFileSync(KEY_FILE, 'utf8').trim().replace(/^"|"$/g, '').trim();
  return raw.length ? raw : null;
}

function parseItems(xml) {
  const items = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const block of blocks) {
    const title = decodeEntities((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
    const link = decodeEntities((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '');
    const pubDate = decodeEntities((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '');
    const source = decodeEntities((block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '');
    if (title) items.push({ title: title, link: link, pubDate: pubDate, source: source });
  }
  return items;
}

// Google News titles are "Headline - Source"; drop the trailing source.
function stripSourceSuffix(title, source) {
  if (!source) return title;
  const suffix = ' - ' + source;
  return title.endsWith(suffix) ? title.slice(0, title.length - suffix.length).trim() : title;
}

function dedupe(items) {
  const seenTitles = new Set();
  const seenLinks = new Set();
  const unique = [];
  for (const item of items) {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seenTitles.has(key) || (item.link && seenLinks.has(item.link))) continue;
    seenTitles.add(key);
    if (item.link) seenLinks.add(item.link);
    unique.push(item);
  }
  return unique;
}

function parseTwoLines(text) {
  // Collapse every line break to a space first: models often wrap a
  // sentence, and matching line-by-line would cut it in half.
  const cleaned = String(text)
    .replace(/\r/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const match = cleaned.match(/what happened\s*:\s*(.*?)\s*what it means[^:]*:\s*(.*)$/i);
  if (!match) return null;
  const happened = match[1].replace(/^[-\s]+/, '').trim();
  const means = match[2].replace(/^[-\s]+/, '').trim();
  if (!happened || !means) return null;
  return { happened: happened, means: means };
}

function askAI(item, provider, key) {
  const url = provider === 'openrouter' ? OPENROUTER_URL : DEEPSEEK_URL;
  const model = provider === 'openrouter' ? OPENROUTER_MODEL : MODEL;
  const prompt =
    'You are briefing the owner of a business that builds custom AI tools and small web apps ' +
    'for small business owners (SMBs) in Bengaluru and across India.\n\n' +
    'Headline: ' + item.title + '\n' +
    'Source: ' + (item.source || 'unknown') + '\n' +
    'Date: ' + (fmtDate(item.pubDate) || 'unknown') + '\n\n' +
    'Reply with exactly two lines and nothing else. No preamble, no bullets:\n' +
    'What happened: <one short sentence>\n' +
    'What it means for my clients: <one short sentence>';

  const payload = JSON.stringify({
    model: model,
    messages: [
      { role: 'system', content: 'You write tight, factual two-line market briefings.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.3,
    max_tokens: 400
  });

  return request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      Authorization: 'Bearer ' + key
    }
  }, payload).then(function (res) {
    let json;
    try {
      json = JSON.parse(res.body);
    } catch (e) {
      throw new Error('AI returned non-JSON (HTTP ' + res.status + ')');
    }
    if (json.error) {
      throw new Error(json.error.message || ('AI error HTTP ' + res.status));
    }
    if (res.status !== 200) {
      throw new Error('AI returned HTTP ' + res.status);
    }
    const content = json.choices && json.choices[0] && json.choices[0].message
      ? json.choices[0].message.content
      : '';
    const two = parseTwoLines(content);
    if (!two) throw new Error('AI reply was not in the two-line format');
    return two;
  });
}

function buildHtml(items, banner, generatedAt) {
  const cards = items
    .map(function (item, i) {
      const title = escapeHtml(item.title);
      const link = item.link ? escapeHtml(item.link) : '';
      const heading = link
        ? '<a href="' + link + '" target="_blank" rel="noopener">' + title + '</a>'
        : title;
      const meta = [item.source, fmtDate(item.pubDate)].filter(Boolean).map(escapeHtml).join(' &middot; ');
      const body = item.summary
        ? '<p class="line"><span class="tag">What happened:</span> ' + escapeHtml(item.summary.happened) + '</p>' +
          '<p class="line"><span class="tag">What it means for my clients:</span> ' + escapeHtml(item.summary.means) + '</p>'
        : '<p class="line missing">Summary unavailable for this story.</p>';
      return (
        '<article class="card">' +
        '<div class="num">' + (i + 1) + '</div>' +
        '<h2>' + heading + '</h2>' +
        '<p class="meta">' + meta + '</p>' +
        body +
        '</article>'
      );
    })
    .join('\n');

  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>Daily Digest - small business AI India</title>\n' +
    '<style>\n' +
    '  :root { --bg:#f6f5f2; --ink:#1c1b1a; --muted:#6b6660; --accent:#b4451f; --line:#e2ded7; }\n' +
    '  * { box-sizing:border-box; }\n' +
    '  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.6 "Segoe UI",system-ui,sans-serif; }\n' +
    '  main { max-width:760px; margin:0 auto; padding:56px 24px; }\n' +
    '  header h1 { font-size:2rem; line-height:1.2; margin:0 0 6px; letter-spacing:-0.02em; }\n' +
    '  header p { color:var(--muted); margin:0 0 28px; }\n' +
    '  .banner { border-left:4px solid var(--accent); background:#fff3ec; padding:12px 16px; margin:0 0 28px; }\n' +
    '  .card { background:#fff; border:1px solid var(--line); border-radius:10px; padding:20px 22px; margin:0 0 16px; }\n' +
    '  .num { color:var(--accent); font-weight:700; font-size:.8rem; letter-spacing:.12em; }\n' +
    '  h2 { font-size:1.25rem; line-height:1.35; margin:6px 0 4px; }\n' +
    '  h2 a { color:var(--ink); text-decoration:none; }\n' +
    '  h2 a:hover { color:var(--accent); }\n' +
    '  .meta { color:var(--muted); font-size:.85rem; margin:0 0 12px; }\n' +
    '  .line { margin:0 0 6px; }\n' +
    '  .tag { color:var(--accent); font-weight:600; }\n' +
    '  .missing { color:var(--muted); font-style:italic; }\n' +
    '  footer { color:var(--muted); font-size:.85rem; margin-top:32px; }\n' +
    '</style>\n</head>\n<body>\n<main>\n' +
    '<header>\n<h1>Daily Digest &mdash; small business AI India</h1>\n' +
    '<p>Google News, India edition &middot; generated ' + escapeHtml(generatedAt) + '</p>\n</header>\n' +
    (banner ? '<div class="banner">' + escapeHtml(banner) + '</div>\n' : '') +
    cards + '\n' +
    '<footer>Query: ' + escapeHtml(NEWS_QUERY) + ' &middot; top ' + items.length + ' unique stories, newest first.</footer>\n' +
    '</main>\n</body>\n</html>\n';
}

function printDigest(items, banner, generatedAt) {
  const out = [];
  out.push('Daily Digest - small business AI India');
  out.push('Google News, India edition - generated ' + generatedAt);
  if (banner) out.push('NOTE: ' + banner);
  out.push('');
  items.forEach(function (item, i) {
    out.push((i + 1) + '. ' + item.title);
    out.push('   ' + [item.source, fmtDate(item.pubDate)].filter(Boolean).join(' | '));
    if (item.summary) {
      out.push('   What happened: ' + item.summary.happened);
      out.push('   What it means for my clients: ' + item.summary.means);
    } else {
      out.push('   Summary unavailable for this story.');
    }
    out.push('');
  });
  process.stdout.write(out.join('\n') + '\n');
}

async function emailDigest(html, subject) {
  const keyFile = path.join(FOLDER, 'composio-key.txt');

  if (!fs.existsSync(keyFile)) {
    return { ok: false, stopped: false, reason: 'Email is off: no composio-key.txt beside the script. Paste your Composio key (starts with ak_) into ' + keyFile + '.' };
  }
  const key = fs.readFileSync(keyFile, 'utf8').trim().replace(/^"|"$/g, '').trim();
  if (!key) {
    return { ok: false, stopped: false, reason: 'Email is off: composio-key.txt is empty. Paste your Composio key (starts with ak_) into it.' };
  }
  if (!COMPOSIO_USER_ID) {
    return { ok: false, stopped: false, reason: 'Email is off: COMPOSIO_USER_ID is not set in the script.' };
  }
  if (!DIGEST_TO) {
    return { ok: false, stopped: false, reason: 'Email is off: DIGEST_TO is not set in the script.' };
  }

  const payload = JSON.stringify({
    user_id: COMPOSIO_USER_ID,
    version: 'latest',
    arguments: {
      recipient_email: DIGEST_TO,
      subject: subject,
      body: html,
      is_html: true
    }
  });

  let res;
  let text;
  try {
    res = await fetch(COMPOSIO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: payload
    });
    text = await res.text();
  } catch (err) {
    return { ok: false, stopped: true, reason: 'Email failed: could not reach Composio (' + err.message + ').' };
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, stopped: true, reason: 'Email failed: Composio returned non-JSON (HTTP ' + res.status + '): ' + text.slice(0, 500) };
  }

  if (json.successful === true) {
    return { ok: true, to: DIGEST_TO };
  }

  // Checked the successful field; it was not true. Print the error field as it came back and stop.
  return { ok: false, stopped: true, reason: 'Email failed. Composio error field: ' + JSON.stringify(json.error) };
}

async function main() {
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  const xml = await get(NEWS_URL, 5);
  const items = dedupe(parseItems(xml).map(function (item) {
    return {
      title: stripSourceSuffix(item.title, item.source),
      link: item.link,
      pubDate: item.pubDate,
      source: item.source
    };
  }));

  items.sort(function (a, b) {
    return new Date(b.pubDate || 0) - new Date(a.pubDate || 0);
  });

  const top = items.slice(0, TOP_N);
  if (!top.length) throw new Error('no stories found in the feed');

  const key = readKey();
  let provider = null;
  let summariesMissingReason = null;

  if (!key) {
    summariesMissingReason = 'no key.txt found in ' + FOLDER;
  } else {
    provider = key.startsWith('sk-or-') ? 'openrouter' : 'deepseek';
  }

  let failures = 0;
  for (const item of top) {
    if (!provider) continue;
    try {
      item.summary = await askAI(item, provider, key);
    } catch (err) {
      item.summary = null;
      failures += 1;
      if (!summariesMissingReason) {
        summariesMissingReason = provider + ' AI request failed: ' + err.message;
      }
    }
  }

  let banner = null;
  if (!provider) {
    banner = 'Summaries are missing because there is no key.txt in this folder. ' +
      'Paste your DeepSeek or OpenRouter key into ' + path.join(FOLDER, 'key.txt') + ' and run again.';
  } else if (failures === top.length) {
    banner = 'Summaries are missing: every ' + provider + ' request failed (' + summariesMissingReason + '). ' +
      'Headlines, sources and dates are below.';
  } else if (failures > 0) {
    banner = 'Summaries are missing for ' + failures + ' of ' + top.length + ' stories (' + summariesMissingReason + ').';
  }

  const html = buildHtml(top, banner, generatedAt);
  fs.writeFileSync(OUT_FILE, html, 'utf8');

  printDigest(top, banner, generatedAt);
  process.stdout.write('Saved: ' + OUT_FILE + '\n');

  const subject = 'Daily Digest - ' + NEWS_QUERY + ' - ' + fmtDate(new Date().toISOString());
  const email = await emailDigest(html, subject);
  if (email.ok) {
    process.stdout.write('Emailed the digest to ' + email.to + ' via Composio (Gmail).\n');
  } else {
    process.stdout.write(email.reason + '\n');
    if (email.stopped) process.exitCode = 1;
  }
}

main().catch(function (err) {
  process.stderr.write('Digest failed: ' + (err && err.message ? err.message : String(err)) + '\n');
  process.exitCode = 1;
});
