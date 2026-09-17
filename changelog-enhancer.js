'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  PermissionFlagsBits,
} = require('discord.js');

const VERSION = '5.9.4';
const storageDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || __dirname;
const statePath = path.join(storageDir, 'detailed-changelog.json');
const releaseNotesPath = path.join(__dirname, `CHANGELOG-v${VERSION}.txt`);
const DEFAULT_CHANGELOG_CHANNEL_ID = '1542411163630051358';
const MAX_BODY = 2 * 1024 * 1024;
let capturedClient = null;

function defaultState() {
  return { channelId: null, lastStartupVersion: null, lastDelivery: null };
}

function loadState() {
  try {
    if (!fs.existsSync(statePath)) return defaultState();
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return { ...defaultState(), ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch (_) {
    return defaultState();
  }
}

function saveState(state) {
  try {
    if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
    const tmp = `${statePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, statePath);
  } catch (error) {
    console.error('❌ Changelog-State konnte nicht gespeichert werden:', error?.message || error);
  }
}

function truncate(text, max) {
  const value = String(text ?? '');
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function cleanLine(text) {
  return String(text || '').replace(/[`*_#>]/g, '').replace(/\s+/g, ' ').trim();
}

function isGenericCommitMessage(message) {
  const text = cleanLine(message).toLowerCase();
  return !text || /^(files? (added|updated|changed)|update(d)? files?|changes?|fix(es|ed)?|upload(ed)?|new files?|patch|commit|test|bot update)$/i.test(text);
}

function safeEqualText(a, b) {
  try {
    const left = Buffer.from(String(a || ''));
    const right = Buffer.from(String(b || ''));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  } catch (_) {
    return false;
  }
}

function verifyGithubSignature(rawBody, signature) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET || '';
  if (!secret) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  return safeEqualText(expected, signature);
}

function repoMatches(payload) {
  const configured = String(process.env.GITHUB_REPO || 'Gmeini09/Bot').trim().toLowerCase();
  const actual = String(payload?.repository?.full_name || '').trim().toLowerCase();
  return !configured || configured === actual;
}

function normalizeChannelName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
}

async function resolveGuild(client) {
  const explicitGuildId = process.env.CHANGELOG_GUILD_ID || '';
  if (explicitGuildId) {
    const guild = client.guilds.cache.get(explicitGuildId) || await client.guilds.fetch(explicitGuildId).catch(() => null);
    if (guild) return guild;
  }
  const turbo = client.guilds.cache.find(guild => /turbo\s*design/i.test(guild.name))
    || client.guilds.cache.find(guild => /turbo/i.test(guild.name));
  return turbo || client.guilds.cache.first() || null;
}

async function resolveDetailedChannel(client, { createIfMissing = true } = {}) {
  if (!client?.isReady?.()) return null;
  const state = loadState();
  const candidates = [
    process.env.DETAILED_CHANGELOG_CHANNEL_ID,
    state.channelId,
    process.env.CHANGELOG_CHANNEL_ID,
    DEFAULT_CHANGELOG_CHANNEL_ID,
  ].filter(Boolean);

  for (const id of [...new Set(candidates)]) {
    const channel = client.channels.cache.get(id) || await client.channels.fetch(id).catch(() => null);
    if (channel?.isTextBased?.()) {
      if (state.channelId !== channel.id) {
        state.channelId = channel.id;
        saveState(state);
      }
      return channel;
    }
  }

  const guild = await resolveGuild(client);
  if (!guild) return null;
  const existing = guild.channels.cache.find(channel => {
    const name = normalizeChannelName(channel.name);
    return channel.isTextBased?.() && (name === 'changelogs' || name === 'changelog' || name.includes('changelog'));
  });
  if (existing) {
    state.channelId = existing.id;
    saveState(state);
    return existing;
  }
  if (!createIfMissing) return null;

  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!me?.permissions?.has(PermissionFlagsBits.ManageChannels)) return null;
  const channel = await guild.channels.create({
    name: '📝・changelogs',
    type: ChannelType.GuildText,
    topic: 'Automatische, ausführliche Changelogs für Turbo Designs Bot Updates.',
    reason: 'Turbo Designs: detaillierten Changelog-Channel einrichten',
  }).catch(() => null);
  if (channel) {
    state.channelId = channel.id;
    saveState(state);
  }
  return channel;
}

function extractPatchSignals(file) {
  const patch = String(file?.patch || '');
  const addedLines = patch.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).map(line => line.slice(1));
  const removedLines = patch.split('\n').filter(line => line.startsWith('-') && !line.startsWith('---')).map(line => line.slice(1));
  const addedText = addedLines.join('\n');
  const allText = `${addedText}\n${removedLines.join('\n')}`;

  const commands = [...new Set([
    ...[...addedText.matchAll(/\.setName\(['"]([a-z0-9_-]{2,32})['"]\)/gi)].map(match => match[1]),
    ...[...addedText.matchAll(/commandName\s*===?\s*['"]([a-z0-9_-]{2,32})['"]/gi)].map(match => match[1]),
  ])].slice(0, 8);
  const functions = [...new Set([...addedText.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(match => match[1]))].slice(0, 6);
  const envVars = [...new Set([...addedText.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map(match => match[1]))].slice(0, 8);
  const versionMatch = addedText.match(/["']version["']\s*:\s*["']([^"']+)["']/i);

  return { patch, addedText, allText, commands, functions, envVars, version: versionMatch?.[1] || null };
}

function describeFileChange(file) {
  const filename = String(file?.filename || file?.previous_filename || 'Unbekannte Datei');
  const lower = filename.toLowerCase();
  const status = String(file?.status || 'modified');
  const signals = extractPatchSignals(file);
  const details = [];

  if (lower === 'package.json') {
    if (signals.version) details.push(`Bot-Version auf **v${signals.version}** aktualisiert`);
    if (/"start"\s*:/.test(signals.addedText)) details.push('Railway-Startbefehl angepasst');
    if (/"dependencies"|discord\.js|pdfkit|sharp|qrcode/.test(signals.addedText)) details.push('Abhängigkeiten/Runtime-Konfiguration angepasst');
  } else if (lower.endsWith('selling-entry.js')) {
    if (/selling_cart_checkout|checkout/i.test(signals.allText)) details.push('Warenkorb-/Checkout-Ablauf angepasst');
    if (/FileUploadBuilder|referenceUpload|getUploadedFiles|references/i.test(signals.allText)) details.push('Referenz-Datei-Uploads im Bestellformular angepasst');
    if (/ticket|channels\.create|permissionOverwrites/i.test(signals.allText)) details.push('Bestell-Ticket-Erstellung oder Berechtigungen angepasst');
    if (/paypal|payment|paidAt/i.test(signals.allText)) details.push('Zahlungs-/PayPal-Workflow angepasst');
    if (/voucher|coupon|discount/i.test(signals.allText)) details.push('Gutschein-/Rabatt-System angepasst');
    if (/license|lizenz/i.test(signals.allText)) details.push('Lizenz-System angepasst');
  } else if (lower.endsWith('compat-fix.js')) {
    details.push('Discord.js-Kompatibilität für Modals und Datei-Uploads verbessert');
  } else if (lower.endsWith('turbo-tools.js')) {
    details.push('Erweiterte **/tools**-Verwaltung angepasst');
    if (signals.commands.length) details.push(`Commands erkannt: ${signals.commands.map(name => `/${name}`).join(', ')}`);
  } else if (lower.endsWith('changelog-enhancer.js')) {
    details.push('Detaillierte GitHub→Discord-Changelogs mit Diff-Auswertung hinzugefügt/verbessert');
  } else if (lower.endsWith('selling-entry-merged.js')) {
    details.push('Startreihenfolge der Bot-Module auf Railway angepasst');
  } else if (lower.endsWith('index.js')) {
    if (/github-webhook|changelog/i.test(signals.allText)) details.push('GitHub-Webhook/Changelog-System angepasst');
    if (/SlashCommandBuilder|buildCommands|commandName/i.test(signals.allText)) details.push('Slash-Command-/Community-Core angepasst');
    if (/ticket/i.test(signals.allText)) details.push('Ticket-System angepasst');
  } else if (/changelog.*\.(txt|md)$/i.test(lower)) {
    details.push('Ausführliche Release Notes aktualisiert');
  } else if (/readme|\.md$/i.test(lower)) {
    details.push('Dokumentation aktualisiert');
  } else if (/\.env|railway/i.test(lower)) {
    details.push('Deployment-/Konfigurationswerte angepasst');
  }

  if (!details.length && signals.functions.length) {
    details.push(`Codebereiche erweitert: ${signals.functions.map(name => `\`${name}()\``).join(', ')}`);
  }
  if (!details.length) {
    details.push(status === 'added' ? 'Neue Komponente hinzugefügt' : status === 'removed' ? 'Komponente entfernt' : status === 'renamed' ? 'Datei umbenannt/verschoben' : 'Bestehende Implementierung angepasst');
  }
  if (signals.envVars.length) details.push(`Konfiguration: ${signals.envVars.map(name => `\`${name}\``).join(', ')}`);

  const delta = [];
  if (Number(file?.additions)) delta.push(`+${file.additions}`);
  if (Number(file?.deletions)) delta.push(`-${file.deletions}`);
  const icon = status === 'added' ? '✨' : status === 'removed' ? '🗑️' : status === 'renamed' ? '🔀' : '🛠️';
  return `${icon} **${filename}**${delta.length ? ` (${delta.join(' / ')})` : ''}\n${truncate(details.join(' • '), 430)}`;
}

async function fetchCompareData(payload) {
  const repo = payload?.repository?.full_name;
  const before = payload?.before;
  const after = payload?.after;
  if (!repo || !before || !after || /^0+$/.test(before) || /^0+$/.test(after)) return null;
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/compare/${before}...${after}`, {
      headers: { 'accept': 'application/vnd.github+json', 'user-agent': 'Turbo-Designs-Bot-Changelog' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (_) {
    return null;
  }
}

async function fetchReleaseNotes(payload, files) {
  const repo = payload?.repository?.full_name;
  const ref = payload?.after || payload?.head_commit?.id;
  if (!repo || !ref) return null;
  const note = (files || []).find(file => /(^|\/)changelog[^/]*\.(txt|md)$/i.test(file.filename || ''));
  if (!note || note.status === 'removed') return null;
  try {
    const encodedPath = String(note.filename).split('/').map(encodeURIComponent).join('/');
    const response = await fetch(`https://raw.githubusercontent.com/${repo}/${ref}/${encodedPath}`, {
      headers: { 'user-agent': 'Turbo-Designs-Bot-Changelog' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const text = (await response.text()).trim();
    return text ? truncate(text, 3200) : null;
  } catch (_) {
    return null;
  }
}

function filesFromPayload(payload) {
  const map = new Map();
  for (const commit of Array.isArray(payload?.commits) ? payload.commits : []) {
    for (const filename of commit.added || []) map.set(filename, { filename, status: 'added' });
    for (const filename of commit.modified || []) if (!map.has(filename)) map.set(filename, { filename, status: 'modified' });
    for (const filename of commit.removed || []) map.set(filename, { filename, status: 'removed' });
  }
  return [...map.values()];
}

function usefulCommitMessages(payload) {
  const commits = Array.isArray(payload?.commits) ? payload.commits : [];
  const values = commits
    .map(commit => cleanLine(String(commit?.message || '').split(/\r?\n/)[0]))
    .filter(message => !isGenericCommitMessage(message));
  return [...new Set(values)].slice(0, 8);
}

function formatDate(payload) {
  const raw = payload?.head_commit?.timestamp || payload?.repository?.pushed_at || Date.now();
  const date = new Date(raw);
  return (Number.isNaN(date.getTime()) ? new Date() : date).toLocaleString('de-AT', {
    timeZone: process.env.COMMUNITY_TIMEZONE || 'Europe/Vienna',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

async function buildDetailedChangelog(payload) {
  const compare = await fetchCompareData(payload);
  const files = Array.isArray(compare?.files) && compare.files.length ? compare.files : filesFromPayload(payload);
  const releaseNotes = await fetchReleaseNotes(payload, files);
  const commits = usefulCommitMessages(payload);
  const branch = String(payload?.ref || '').replace('refs/heads/', '') || 'unbekannt';
  const repo = payload?.repository?.full_name || process.env.GITHUB_REPO || 'Repository';
  const shortSha = String(payload?.after || payload?.head_commit?.id || '').slice(0, 7) || '—';
  const author = payload?.pusher?.name || payload?.sender?.login || payload?.head_commit?.author?.name || 'GitHub';
  const fileDescriptions = files.slice(0, 12).map(describeFileChange);
  const hiddenFiles = Math.max(0, files.length - fileDescriptions.length);

  let summary;
  if (releaseNotes) {
    summary = releaseNotes;
  } else if (commits.length) {
    summary = commits.map(message => `• ${message}`).join('\n');
  } else if (fileDescriptions.length) {
    summary = 'Die Commit-Nachricht war nicht aussagekräftig. Der Bot hat deshalb die tatsächlichen Code-Änderungen ausgewertet.';
  } else {
    summary = payload?.deleted ? `Branch **${branch}** wurde gelöscht.` : payload?.created ? `Branch **${branch}** wurde erstellt.` : 'GitHub-Push erkannt.';
  }

  const detailText = fileDescriptions.length
    ? `${fileDescriptions.join('\n\n')}${hiddenFiles ? `\n\n➕ **${hiddenFiles} weitere Datei${hiddenFiles === 1 ? '' : 'en'}** geändert.` : ''}`
    : 'Keine Datei-Diffs verfügbar.';

  const stats = files.reduce((acc, file) => {
    acc.additions += Number(file.additions || 0);
    acc.deletions += Number(file.deletions || 0);
    return acc;
  }, { additions: 0, deletions: 0 });

  return {
    repo, branch, shortSha, author,
    compareUrl: payload?.compare || compare?.html_url || payload?.repository?.html_url || null,
    dateText: formatDate(payload),
    summary: truncate(summary, 3500),
    details: truncate(detailText, 3900),
    fileCount: files.length,
    commitCount: Array.isArray(payload?.commits) ? payload.commits.length : 0,
    additions: stats.additions,
    deletions: stats.deletions,
  };
}

function changelogEmbeds(info, { startup = false } = {}) {
  const first = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle(startup ? `🚀 Turbo Designs Bot v${VERSION}` : '📝 Turbo Designs • Changelog')
    .setDescription(`## ${startup ? 'Neue Version erfolgreich gestartet' : 'Was hat sich geändert?'}\n${truncate(info.summary, 3600)}`)
    .addFields(
      { name: '🌿 Branch', value: `\`${info.branch || 'main'}\``, inline: true },
      { name: '🔖 Commit', value: `\`${info.shortSha || '—'}\``, inline: true },
      { name: '👤 Push von', value: truncate(info.author || 'GitHub', 100), inline: true },
    )
    .setFooter({ text: `${info.repo || 'Turbo Designs'} • ${info.dateText || ''}` })
    .setTimestamp();
  if (info.compareUrl) first.setURL(info.compareUrl);

  const second = new EmbedBuilder()
    .setColor(0x151521)
    .setTitle('🔍 Änderungen im Detail')
    .setDescription(truncate(info.details || 'Keine Details verfügbar.', 4000))
    .addFields({
      name: '📊 Technische Übersicht',
      value: `Dateien: **${info.fileCount || 0}** • Commits: **${info.commitCount || 0}** • Code: **+${info.additions || 0} / -${info.deletions || 0}**`,
    });
  return [first, second];
}

async function sendDetailedChangelog(client, payload) {
  const channel = await resolveDetailedChannel(client, { createIfMissing: true });
  if (!channel) throw new Error('DETAILED_CHANGELOG_CHANNEL_NOT_FOUND');
  const info = await buildDetailedChangelog(payload);
  await channel.send({ embeds: changelogEmbeds(info), allowedMentions: { parse: [] } });
  const state = loadState();
  state.channelId = channel.id;
  state.lastDelivery = Date.now();
  saveState(state);
  return { channelId: channel.id, info };
}

function startupReleaseInfo() {
  let notes = `Turbo Designs Bot **v${VERSION}** wurde erfolgreich gestartet.`;
  try {
    if (fs.existsSync(releaseNotesPath)) notes = fs.readFileSync(releaseNotesPath, 'utf8').trim() || notes;
  } catch (_) {}
  return {
    repo: process.env.GITHUB_REPO || 'Gmeini09/Bot',
    branch: 'main',
    shortSha: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || 'deploy',
    author: 'Railway Deployment',
    compareUrl: process.env.RAILWAY_GIT_REPO_URL || null,
    dateText: new Date().toLocaleString('de-AT', { timeZone: process.env.COMMUNITY_TIMEZONE || 'Europe/Vienna' }),
    summary: truncate(notes, 3500),
    details: [
      '✨ **Detaillierte Changelogs:** GitHub-Diffs werden jetzt ausgewertet, statt nur Commit-Texte wie „files added“ zu übernehmen.',
      '🧠 **Automatische Erkennung:** Checkout-, Command-, Config-, Lizenz-, Ticket- und Deployment-Änderungen werden verständlich beschrieben.',
      '📄 **Release Notes:** Wird eine `CHANGELOG-*.txt/.md` geändert, verwendet der Bot deren Inhalt als Hauptbeschreibung.',
      '📝 **Channel:** Ein `📝・changelogs`-Channel wird bei Bedarf automatisch erstellt und gespeichert.',
      '🧰 **/tools changelog:** Status, Channel, Setup und Test sind direkt in Discord verfügbar.',
    ].join('\n\n'),
    fileCount: 5,
    commitCount: 1,
    additions: 0,
    deletions: 0,
  };
}

async function postStartupRelease(client, { force = false } = {}) {
  const state = loadState();
  if (!force && state.lastStartupVersion === VERSION) return { skipped: true, channelId: state.channelId };
  const channel = await resolveDetailedChannel(client, { createIfMissing: true });
  if (!channel) return { skipped: true, reason: 'NO_CHANNEL' };
  const info = startupReleaseInfo();
  await channel.send({ embeds: changelogEmbeds(info, { startup: true }), allowedMentions: { parse: [] } });
  state.channelId = channel.id;
  state.lastStartupVersion = VERSION;
  state.lastDelivery = Date.now();
  saveState(state);
  return { channelId: channel.id };
}

async function setDetailedChangelogChannel(channel) {
  if (!channel?.isTextBased?.()) throw new Error('CHANNEL_NOT_TEXT_BASED');
  const state = loadState();
  state.channelId = channel.id;
  saveState(state);
  return channel.id;
}

async function setupDetailedChangelogChannel(client, guild) {
  if (!guild) throw new Error('GUILD_REQUIRED');
  const existing = guild.channels.cache.find(channel => channel.isTextBased?.() && normalizeChannelName(channel.name).includes('changelog'));
  if (existing) {
    await setDetailedChangelogChannel(existing);
    return { channel: existing, created: false };
  }
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!me?.permissions?.has(PermissionFlagsBits.ManageChannels)) throw new Error('MISSING_MANAGE_CHANNELS');
  const channel = await guild.channels.create({
    name: '📝・changelogs',
    type: ChannelType.GuildText,
    topic: 'Automatische, ausführliche Changelogs für Turbo Designs Bot Updates.',
    reason: 'Turbo Designs Changelog Setup',
  });
  await setDetailedChangelogChannel(channel);
  return { channel, created: true };
}

async function sendChangelogTest(client, guild) {
  let channel = await resolveDetailedChannel(client, { createIfMissing: false });
  if (!channel || channel.guildId !== guild.id) {
    const result = await setupDetailedChangelogChannel(client, guild);
    channel = result.channel;
  }
  const info = {
    repo: process.env.GITHUB_REPO || 'Gmeini09/Bot', branch: 'main', shortSha: 'TEST', author: 'Turbo Bot',
    compareUrl: null, dateText: new Date().toLocaleString('de-AT', { timeZone: process.env.COMMUNITY_TIMEZONE || 'Europe/Vienna' }),
    summary: 'Das ist ein **Test des neuen ausführlichen Changelog-Systems**. Zukünftige GitHub-Pushes werden nicht mehr nur mit generischen Commit-Texten angezeigt.',
    details: '🐛 **Checkout:** Ein Fehler im Bestellformular wurde behoben.\n\n🧰 **Commands:** Die Bot-Tools wurden erweitert.\n\n⚙️ **Deployment:** Railway-Start und Discord-Kompatibilität wurden aktualisiert.',
    fileCount: 3, commitCount: 1, additions: 42, deletions: 8,
  };
  await channel.send({ embeds: changelogEmbeds(info), allowedMentions: { parse: [] } });
  return channel;
}

async function handleGithubWebhook(req, res) {
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) {
        res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'PAYLOAD_TOO_LARGE' }));
        return;
      }
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks);
    if (!process.env.GITHUB_WEBHOOK_SECRET) {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'GITHUB_WEBHOOK_SECRET_NOT_CONFIGURED' }));
      return;
    }
    if (!verifyGithubSignature(rawBody, req.headers['x-hub-signature-256'])) {
      res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'INVALID_SIGNATURE' }));
      return;
    }
    const event = String(req.headers['x-github-event'] || '');
    const payload = JSON.parse(rawBody.toString('utf8') || '{}');
    if (event === 'ping') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, pong: true, enhanced: true }));
      return;
    }
    if (event !== 'push') {
      res.writeHead(202, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, ignored: true, event }));
      return;
    }
    if (!repoMatches(payload)) {
      res.writeHead(202, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, ignored: true, reason: 'REPOSITORY_FILTER' }));
      return;
    }
    if (!capturedClient?.isReady?.()) {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'BOT_NOT_READY' }));
      return;
    }
    const result = await sendDetailedChangelog(capturedClient, payload);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, enhanced: true, channelId: result.channelId }));
  } catch (error) {
    console.error('❌ Enhanced Changelog Webhook Fehler:', error);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    if (!res.writableEnded) res.end(JSON.stringify({ ok: false, error: 'CHANGELOG_WEBHOOK_ERROR' }));
  }
}

// /github-webhook vor dem alten Core-Handler abfangen, damit keine doppelte/generische
// "files added"-Nachricht mehr gepostet wird.
if (!http.__turboDetailedChangelogPatched) {
  http.__turboDetailedChangelogPatched = true;
  const originalCreateServer = http.createServer;
  http.createServer = function turboDetailedCreateServer(options, requestListener) {
    let opts = options;
    let listener = requestListener;
    if (typeof options === 'function') {
      listener = options;
      opts = undefined;
    }
    if (typeof listener !== 'function') return opts === undefined ? originalCreateServer.call(http) : originalCreateServer.call(http, opts);
    const wrapped = function wrappedRequest(req, res) {
      let pathname = '';
      try { pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname; } catch (_) {}
      if (req.method === 'POST' && pathname === '/github-webhook') {
        handleGithubWebhook(req, res);
        return;
      }
      return listener.call(this, req, res);
    };
    return opts === undefined ? originalCreateServer.call(http, wrapped) : originalCreateServer.call(http, opts, wrapped);
  };
}

// Client merken und nach erfolgreichem Start einmalige Release-Notes posten.
if (!Client.prototype.__turboDetailedChangelogLoginPatched) {
  Client.prototype.__turboDetailedChangelogLoginPatched = true;
  const nativeLogin = Client.prototype.login;
  Client.prototype.login = function detailedChangelogLogin(token) {
    capturedClient = this;
    if (!this.__turboDetailedChangelogReadyListener) {
      this.__turboDetailedChangelogReadyListener = true;
      this.once(Events.ClientReady, () => {
        setTimeout(() => postStartupRelease(this).catch(error => console.error('❌ Startup-Changelog Fehler:', error?.message || error)), 5000).unref?.();
        console.log('✅ Detailliertes Changelog-System v5.9.4 aktiv.');
      });
    }
    return nativeLogin.call(this, token);
  };
}

module.exports = {
  VERSION,
  loadState,
  resolveDetailedChannel,
  setDetailedChangelogChannel,
  setupDetailedChangelogChannel,
  sendChangelogTest,
  postStartupRelease,
  buildDetailedChangelog,
};
