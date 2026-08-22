const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  Partials,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const fs = require('fs');
const path = require('path');

// ============================================================
// KONFIGURATION
// ============================================================

function idsFromEnv(name, fallback = []) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(',').map(v => v.trim()).filter(Boolean);
}

const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID || '1540161502856740914',
  fallbackSocialsChannelId: process.env.PANEL_CHANNEL_ID || '1540162074531856474',
  adminRoleIds: idsFromEnv('ADMIN_ROLE_IDS', ['1531994258691588177']),
  socialAdminRoleIds: idsFromEnv('SOCIAL_ADMIN_ROLE_IDS', ['1531994258691588177']),
  socialDeleteRoleIds: idsFromEnv('SOCIAL_DELETE_ROLE_IDS', ['1531994258691588177']),
  modRoleIds: idsFromEnv('MOD_ROLE_IDS', []),
  socialSortRoleIds: idsFromEnv('SOCIAL_SORT_ROLE_IDS', [
    '1531994250839855234',
    '1531994252249403572',
    '1531994256107901150',
    '1531994258691588177',
  ]),
};

if (!config.token) {
  console.error('❌ DISCORD_TOKEN fehlt. Trage den Token bei Railway unter Variables ein.');
  process.exit(1);
}

const storageDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || __dirname;
if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
const dataPath = path.join(storageDir, 'data.json');

const MAX_SOCIAL_LINKS = 5;
const SOCIALS_PER_PAGE = 5;
const SOCIAL_PANEL_COLOR = 0x8b5cf6;
const VERIFY_TTL_MS = 5 * 60 * 1000;
const XP_COOLDOWN_MS = 60 * 1000;
const EVENT_CHECK_INTERVAL_MS = 30 * 1000;
const verifyChallenges = new Map();
const refreshRunningGuilds = new Set();
const suggestionSourceDeletes = new Set();
const messageRateLimits = new Map();
const joinBursts = new Map();
const inviteCache = new Map();

function defaultData() {
  return {
    version: 5,
    config: {
      welcomeChannelId: null,
      leaveChannelId: null,
      logChannelId: null,
      suggestionsChannelId: null,
      giveawayChannelId: null,
      socialsChannelId: config.fallbackSocialsChannelId || null,
      socialAuditChannelId: null,
      ticketCategoryId: null,
      verifiedRoleId: null,
      unverifiedRoleId: null,
      supportRoleId: null,
      moderatorRoleId: null,
      announcementRoleId: null,
      socialAdminRoleId: null,
      socialDeleteRoleId: null,
      applicationReviewChannelId: null,
      applicationAcceptedRoleId: null,
      ticketTranscriptChannelId: null,
      automodLogChannelId: null,
      tempVoiceLobbyId: null,
      tempVoiceCategoryId: null,
      tempVoiceUserLimit: 0,
      levelSystemEnabled: true,
      customCommandPrefix: '!',
    },
    socials: {
      messageIds: [],
      members: [],
    },
    warnings: {},
    giveaways: {},
    applications: {},
    automod: {
      enabled: false,
      blockInvites: true,
      maxMentions: 5,
      maxMessages: 6,
      spamWindowMs: 8000,
      minAccountAgeHours: 24,
      raidJoinLimit: 8,
      raidWindowMs: 20000,
      raidModeUntil: 0,
    },
    tempVoices: {},
    levels: {},
    levelRoles: {},
    inviteStats: {},
    inviteMembers: {},
    events: {},
    duty: {
      active: {},
      totals: {},
    },
    customCommands: {},
  };
}

function normalizeData(raw) {
  const base = defaultData();

  // Migration alter Socials-Versionen.
  if (Array.isArray(raw?.members)) {
    base.socials.members = raw.members.map(entry => ({
      userId: entry.userId,
      links: Array.isArray(entry.links)
        ? entry.links
        : entry.url
          ? [entry.url]
          : [],
      addedAt: entry.addedAt || new Date().toISOString(),
    }));
    if (raw.messageId) base.socials.messageIds = [raw.messageId];
  }

  if (raw?.socials) {
    base.socials.messageIds = Array.isArray(raw.socials.messageIds)
      ? raw.socials.messageIds
      : raw.socials.messageId
        ? [raw.socials.messageId]
        : base.socials.messageIds;
    base.socials.members = Array.isArray(raw.socials.members)
      ? raw.socials.members.map(entry => ({
          userId: entry.userId,
          links: Array.isArray(entry.links)
            ? entry.links
            : entry.url
              ? [entry.url]
              : [],
          addedAt: entry.addedAt || new Date().toISOString(),
        }))
      : base.socials.members;
  }

  base.config = { ...base.config, ...(raw?.config || {}) };
  base.warnings = raw?.warnings && typeof raw.warnings === 'object' ? raw.warnings : {};
  base.giveaways = raw?.giveaways && typeof raw.giveaways === 'object' ? raw.giveaways : {};
  base.applications = raw?.applications && typeof raw.applications === 'object' ? raw.applications : {};
  base.automod = { ...base.automod, ...(raw?.automod && typeof raw.automod === 'object' ? raw.automod : {}) };
  base.tempVoices = raw?.tempVoices && typeof raw.tempVoices === 'object' ? raw.tempVoices : {};
  base.levels = raw?.levels && typeof raw.levels === 'object' ? raw.levels : {};
  base.levelRoles = raw?.levelRoles && typeof raw.levelRoles === 'object' ? raw.levelRoles : {};
  base.inviteStats = raw?.inviteStats && typeof raw.inviteStats === 'object' ? raw.inviteStats : {};
  base.inviteMembers = raw?.inviteMembers && typeof raw.inviteMembers === 'object' ? raw.inviteMembers : {};
  base.events = raw?.events && typeof raw.events === 'object' ? raw.events : {};
  base.duty = {
    active: raw?.duty?.active && typeof raw.duty.active === 'object' ? raw.duty.active : {},
    totals: raw?.duty?.totals && typeof raw.duty.totals === 'object' ? raw.duty.totals : {},
  };
  base.customCommands = raw?.customCommands && typeof raw.customCommands === 'object' ? raw.customCommands : {};
  base.version = 5;
  return base;
}

function loadData() {
  try {
    if (!fs.existsSync(dataPath)) return defaultData();
    return normalizeData(JSON.parse(fs.readFileSync(dataPath, 'utf8')));
  } catch (error) {
    console.error('⚠️ data.json konnte nicht gelesen werden:', error);
    return defaultData();
  }
}

function saveData(data) {
  const temp = `${dataPath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(temp, dataPath);
}

// ============================================================
// HILFSFUNKTIONEN
// ============================================================

function isValidDiscordId(value) {
  return /^\d{17,20}$/.test(String(value || '').trim());
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function parseEmbedColor(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0x111111;

  const named = {
    schwarz: 0x111111,
    black: 0x111111,
    rot: 0xe74c3c,
    red: 0xe74c3c,
    gruen: 0x2ecc71,
    'grün': 0x2ecc71,
    green: 0x2ecc71,
    blau: 0x3498db,
    blue: 0x3498db,
    lila: 0x9b59b6,
    purple: 0x9b59b6,
    gelb: 0xf1c40f,
    yellow: 0xf1c40f,
    orange: 0xe67e22,
    weiss: 0xffffff,
    'weiß': 0xffffff,
    white: 0xffffff,
  };

  const lower = raw.toLowerCase();
  if (named[lower] !== undefined) return named[lower];

  const hex = lower.replace(/^#/, '').replace(/^0x/, '');
  if (/^[0-9a-f]{6}$/.test(hex)) return parseInt(hex, 16);
  return null;
}

function parseLinks(raw) {
  const items = String(raw || '')
    .split(/\s+/)
    .map(normalizeUrl)
    .filter(Boolean);
  return [...new Set(items)].slice(0, MAX_SOCIAL_LINKS);
}

function platformInfo(urlString) {
  try {
    const host = new URL(urlString).hostname.toLowerCase().replace(/^www\./, '');
    if (host.includes('youtube.com') || host === 'youtu.be') return { label: 'YouTube', emoji: '▶️' };
    if (host.includes('tiktok.com')) return { label: 'TikTok', emoji: '🎵' };
    if (host.includes('twitch.tv')) return { label: 'Twitch', emoji: '🟣' };
    if (host.includes('instagram.com')) return { label: 'Instagram', emoji: '📸' };
    if (host === 'discord.gg' || host.includes('discord.com')) return { label: 'Discord', emoji: '💬' };
    if (host === 'x.com' || host.includes('twitter.com')) return { label: 'X', emoji: '✖️' };
    if (host.includes('spotify.com')) return { label: 'Spotify', emoji: '🎧' };
    if (host.includes('soundcloud.com')) return { label: 'SoundCloud', emoji: '☁️' };
    if (host.includes('kick.com')) return { label: 'Kick', emoji: '🟢' };
    if (host.includes('github.com')) return { label: 'GitHub', emoji: '💻' };
    if (host.includes('facebook.com')) return { label: 'Facebook', emoji: '🔵' };
    return { label: 'Link', emoji: '🔗' };
  } catch {
    return { label: 'Link', emoji: '🔗' };
  }
}

function hasAnyRole(member, roleIds) {
  if (!member || !Array.isArray(roleIds)) return false;
  return roleIds.some(id => id && member.roles.cache.has(id));
}

function isAdministrator(member) {
  return Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator));
}

function canSetup(member) {
  return isAdministrator(member) || Boolean(member?.permissions?.has(PermissionFlagsBits.ManageGuild));
}

function canModerate(member, data) {
  if (!member) return false;
  if (isAdministrator(member) || member.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
  const ids = [...config.modRoleIds, data.config.moderatorRoleId].filter(Boolean);
  return hasAnyRole(member, ids);
}

function canManageSocials(member, data) {
  if (!member) return false;
  if (isAdministrator(member) || member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  const ids = [...config.adminRoleIds, ...config.socialAdminRoleIds, data.config.socialAdminRoleId].filter(Boolean);
  return hasAnyRole(member, ids);
}

function canDeleteSocials(member, data) {
  if (!member) return false;
  if (isAdministrator(member) || member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  const ids = [...config.socialDeleteRoleIds, data.config.socialDeleteRoleId].filter(Boolean);
  return hasAnyRole(member, ids);
}

function canAnnounce(member, data) {
  if (!member) return false;
  if (isAdministrator(member) || member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  return data.config.announcementRoleId && member.roles.cache.has(data.config.announcementRoleId);
}

function canManageTickets(member, data) {
  if (!member) return false;
  if (isAdministrator(member) || member.permissions.has(PermissionFlagsBits.ManageChannels)) return true;
  return data.config.supportRoleId && member.roles.cache.has(data.config.supportRoleId);
}

async function sendEmbedToChannel(guild, channelId, embed) {
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return null;
  return channel.send({ embeds: [embed] }).catch(() => null);
}

async function logEvent(guild, data, title, description) {
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
  await sendEmbedToChannel(guild, data.config.logChannelId, embed);
}

async function socialAudit(guild, data, title, description) {
  const channelId = data.config.socialAuditChannelId || data.config.logChannelId;
  const embed = new EmbedBuilder()
    .setColor(0x111111)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
  await sendEmbedToChannel(guild, channelId, embed);
}

function socialPriority(member) {
  if (!member) return Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < config.socialSortRoleIds.length; i++) {
    if (member.roles.cache.has(config.socialSortRoleIds[i])) return i;
  }
  return Number.MAX_SAFE_INTEGER;
}

async function sortedSocialMembers(guild, members) {
  const enriched = await Promise.all(
    members.map(async (entry, originalIndex) => {
      const member = await guild.members.fetch(entry.userId).catch(() => null);
      return { entry, member, originalIndex, priority: socialPriority(member) };
    }),
  );

  enriched.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const aTime = Date.parse(a.entry.addedAt || 0) || 0;
    const bTime = Date.parse(b.entry.addedAt || 0) || 0;
    if (aTime !== bTime) return aTime - bTime;
    return a.originalIndex - b.originalIndex;
  });

  return enriched.map(x => x.entry);
}

function socialPanelBaseEmbed(guild) {
  const embed = new EmbedBuilder().setColor(SOCIAL_PANEL_COLOR);
  const iconURL = guild.iconURL({ size: 256 });
  const author = { name: `${guild.name} • SOCIAL HUB` };

  if (iconURL) {
    author.iconURL = iconURL;
    embed.setThumbnail(iconURL);
  }

  return embed.setAuthor(author);
}

function socialProfileLabel(count) {
  return `${count} ${count === 1 ? 'Profil' : 'Profile'}`;
}

function buildSocialPage(guild, entries, pageIndex, pageCount, totalCount) {
  const embed = socialPanelBaseEmbed(guild)
    .setTitle(pageIndex === 0 ? '🌐 Entdecke unsere Community' : `🌐 Weitere Socials • Seite ${pageIndex + 1}`)
    .setDescription(
      pageIndex === 0
        ? [
            '**Alle Creator, Kanäle und Profile auf einen Blick.**',
            'Wähle unten einfach die gewünschte Plattform aus.',
            '',
            '✦ Mit `/mysocials` kannst du deine eigenen Links verwalten.',
          ].join('\n')
        : 'Weitere Profile aus unserer Community. Wähle unten die gewünschte Plattform aus.',
    )
    .setFooter({
      text: `${socialProfileLabel(totalCount)}  •  Seite ${pageIndex + 1} von ${pageCount}`,
    });

  const rows = [];

  entries.forEach((entry, localIndex) => {
    const globalIndex = pageIndex * SOCIALS_PER_PAGE + localIndex + 1;
    const profileNumber = String(globalIndex).padStart(2, '0');
    const linksText = entry.links
      .map(link => {
        const p = platformInfo(link);
        return `${p.emoji} [${p.label}](${link})`;
      })
      .join('  •  ');

    embed.addFields({
      name: `👤  PROFIL ${profileNumber}`,
      value: [
        `<@${entry.userId}>`,
        linksText ? `> ${linksText}` : '> *Keine Links hinterlegt*',
      ].join('\n'),
      inline: false,
    });

    if (entry.links.length) {
      const row = new ActionRowBuilder();
      entry.links.slice(0, 5).forEach(link => {
        const p = platformInfo(link);
        row.addComponents(
          new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel(`${profileNumber}  •  ${p.label}`.slice(0, 80))
            .setEmoji(p.emoji)
            .setURL(link),
        );
      });
      rows.push(row);
    }
  });

  return { embed, rows };
}

async function updateSocialPanel(guild, data) {
  if (refreshRunningGuilds.has(guild.id)) return;
  refreshRunningGuilds.add(guild.id);
  try {
    const channelId = data.config.socialsChannelId || config.fallbackSocialsChannelId;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) throw new Error('PANEL_CHANNEL_NOT_FOUND');

    data.socials.members = await sortedSocialMembers(guild, data.socials.members);
    const chunks = [];
    if (data.socials.members.length === 0) chunks.push([]);
    for (let i = 0; i < data.socials.members.length; i += SOCIALS_PER_PAGE) {
      chunks.push(data.socials.members.slice(i, i + SOCIALS_PER_PAGE));
    }

    const newMessageIds = [];
    for (let i = 0; i < chunks.length; i++) {
      const entries = chunks[i];
      let payload;
      if (entries.length === 0) {
        payload = {
          embeds: [
            socialPanelBaseEmbed(guild)
              .setTitle('🌐 Community Socials')
              .setDescription([
                '**Hier ist noch Platz für das erste Profil.**',
                'Trage deine Socials mit `/mysocials add` ein und zeig der Community, wo man dich findet.',
              ].join('\n'))
              .setFooter({ text: '0 Profile  •  Bereit für deinen ersten Eintrag' }),
          ],
          components: [],
        };
      } else {
        const built = buildSocialPage(guild, entries, i, chunks.length, data.socials.members.length);
        payload = { embeds: [built.embed], components: built.rows };
      }

      let message = null;
      const existingId = data.socials.messageIds[i];
      if (existingId) message = await channel.messages.fetch(existingId).catch(() => null);
      if (message) {
        await message.edit(payload);
      } else {
        message = await channel.send(payload);
      }
      newMessageIds.push(message.id);
    }

    for (const oldId of data.socials.messageIds.slice(chunks.length)) {
      const old = await channel.messages.fetch(oldId).catch(() => null);
      if (old) await old.delete().catch(() => {});
    }

    data.socials.messageIds = newMessageIds;
    saveData(data);
  } finally {
    refreshRunningGuilds.delete(guild.id);
  }
}

function findSocial(data, userId) {
  return data.socials.members.find(entry => entry.userId === userId);
}

function socialInfoPayload(entry, title = '🌐 Socials') {
  const embed = new EmbedBuilder()
    .setColor(SOCIAL_PANEL_COLOR)
    .setTitle(title)
    .setDescription(
      entry?.links?.length
        ? entry.links.map((link, index) => {
            const p = platformInfo(link);
            return `**${index + 1}.** ${p.emoji} [${p.label}](${link})`;
          }).join('\n')
        : '*Keine Socials gespeichert.*',
    );
  const rows = [];
  if (entry?.links?.length) {
    const row = new ActionRowBuilder();
    entry.links.slice(0, 5).forEach(link => {
      const p = platformInfo(link);
      row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(p.label).setEmoji(p.emoji).setURL(link));
    });
    rows.push(row);
  }
  return { embeds: [embed], components: rows };
}


function parseDuration(value) {
  const match = String(value || '').trim().toLowerCase().match(/^(\d+)\s*(s|m|h|d|w)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[match[2]];
  const ms = amount * unitMs;
  if (ms < 10_000 || ms > 30 * 86_400_000) return null;
  return ms;
}

function canManageGiveaways(member, data) {
  return canAnnounce(member, data) || canSetup(member);
}

function giveawayPayload(giveaway, disabled = false) {
  const ended = giveaway.ended || disabled;
  const endTs = Math.floor(giveaway.endAt / 1000);
  const participantCount = Array.isArray(giveaway.participants) ? giveaway.participants.length : 0;
  const winnerText = giveaway.ended
    ? (giveaway.winners?.length ? giveaway.winners.map(id => `<@${id}>`).join(', ') : 'Keine gültigen Teilnehmer')
    : `${giveaway.winnerCount} Gewinner`;

  const embed = new EmbedBuilder()
    .setColor(ended ? 0x2b2d31 : 0xf1c40f)
    .setTitle(ended ? `🎉 Giveaway beendet • ${giveaway.prize}` : `🎉 Giveaway • ${giveaway.prize}`)
    .setDescription(giveaway.description || 'Drücke unten auf **🎉 Teilnehmen**, um mitzumachen!')
    .addFields(
      { name: ended ? 'Gewinner' : 'Endet', value: ended ? winnerText : `<t:${endTs}:R>\n<t:${endTs}:F>`, inline: false },
      { name: 'Teilnehmer', value: String(participantCount), inline: true },
      { name: 'Gewinneranzahl', value: String(giveaway.winnerCount), inline: true },
      { name: 'Veranstalter', value: `<@${giveaway.hostId}>`, inline: true },
    )
    .setTimestamp();

  if (giveaway.requiredRoleId) {
    embed.addFields({ name: 'Benötigte Rolle', value: `<@&${giveaway.requiredRoleId}>`, inline: false });
  }

  const button = new ButtonBuilder()
    .setCustomId(`giveaway_join:${giveaway.messageId}`)
    .setLabel(ended ? 'Giveaway beendet' : 'Teilnehmen')
    .setEmoji('🎉')
    .setStyle(ended ? ButtonStyle.Secondary : ButtonStyle.Success)
    .setDisabled(ended);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(button)],
    allowedMentions: { parse: [] },
  };
}

function pickRandomWinners(ids, count) {
  const pool = [...new Set(ids)];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(0, Math.min(count, pool.length)));
}

async function eligibleGiveawayParticipants(guild, giveaway) {
  const eligible = [];
  for (const userId of giveaway.participants || []) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member || member.user.bot) continue;
    if (giveaway.requiredRoleId && !member.roles.cache.has(giveaway.requiredRoleId)) continue;
    eligible.push(userId);
  }
  return eligible;
}

async function finishGiveaway(guild, data, messageId, endedBy = null) {
  const giveaway = data.giveaways?.[messageId];
  if (!giveaway || giveaway.ended) return false;

  const eligible = await eligibleGiveawayParticipants(guild, giveaway);
  giveaway.winners = pickRandomWinners(eligible, giveaway.winnerCount);
  giveaway.ended = true;
  giveaway.endedAt = Date.now();
  giveaway.endedBy = endedBy;
  saveData(data);

  const channel = await guild.channels.fetch(giveaway.channelId).catch(() => null);
  if (!channel?.isTextBased()) return true;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (message) await message.edit(giveawayPayload(giveaway, true)).catch(() => {});

  if (giveaway.winners.length) {
    await channel.send({
      content: `🎉 Glückwunsch ${giveaway.winners.map(id => `<@${id}>`).join(', ')}! Ihr habt **${giveaway.prize}** gewonnen!`,
      allowedMentions: { users: giveaway.winners },
    }).catch(() => {});
  } else {
    await channel.send({ content: `🎉 Das Giveaway für **${giveaway.prize}** ist beendet. Es gab keine gültigen Teilnehmer.` }).catch(() => {});
  }
  return true;
}

async function checkExpiredGiveaways(clientInstance) {
  const data = loadData();
  let changed = false;
  for (const [messageId, giveaway] of Object.entries(data.giveaways || {})) {
    if (giveaway.ended || giveaway.endAt > Date.now()) continue;
    const guild = clientInstance.guilds.cache.get(giveaway.guildId);
    if (!guild) continue;
    const ended = await finishGiveaway(guild, data, messageId, null).catch(error => {
      console.error('❌ Giveaway konnte nicht automatisch beendet werden:', error);
      return false;
    });
    if (ended) changed = true;
  }
  if (changed) saveData(data);
}

function sanitizeChannelName(name) {
  return String(name || 'ticket')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 70);
}

function isTicketChannel(channel) {
  return Boolean(channel?.topic?.startsWith('ticket-owner:'));
}

function ticketOwnerId(channel) {
  if (!isTicketChannel(channel)) return null;
  return channel.topic.split('|')[0].replace('ticket-owner:', '').trim();
}

function canUseTeamTools(member, data) {
  if (!member) return false;
  if (isAdministrator(member) || member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  return hasAnyRole(member, [data.config.supportRoleId, data.config.moderatorRoleId].filter(Boolean));
}

function formatLongDuration(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return [days ? `${days}d` : null, hours ? `${hours}h` : null, minutes || (!days && !hours) ? `${minutes}m` : null]
    .filter(Boolean)
    .join(' ');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;')
    .replace(/\"/g, '&quot;');
}

async function fetchTicketMessages(channel, maximum = 1000) {
  const messages = [];
  let before;

  while (messages.length < maximum) {
    const batch = await channel.messages.fetch({
      limit: Math.min(100, maximum - messages.length),
      before,
    });
    if (!batch.size) break;
    messages.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }

  return messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

async function buildTicketTranscript(channel, closedById) {
  const messages = await fetchTicketMessages(channel);
  const rows = messages.map(message => {
    const attachments = [...message.attachments.values()]
      .map(file => `<a href='${escapeHtml(file.url)}'>${escapeHtml(file.name || 'Anhang')}</a>`)
      .join(' · ');
    const body = escapeHtml(message.content || '').replace(/\n/g, '<br>') || '<em>Keine Textnachricht</em>';
    return `<article><header><strong>${escapeHtml(message.author?.tag || 'Unbekannt')}</strong><span>${new Date(message.createdTimestamp).toLocaleString('de-DE')}</span></header><p>${body}</p>${attachments ? `<p class='attachments'>${attachments}</p>` : ''}</article>`;
  }).join('\n');

  const html = `<!doctype html><html lang='de'><head><meta charset='utf-8'><title>${escapeHtml(channel.name)} – Transcript</title><style>body{font-family:Arial,sans-serif;background:#111318;color:#e7e9ee;max-width:980px;margin:0 auto;padding:32px}h1{color:#8b5cf6}article{background:#1d2027;border-left:4px solid #8b5cf6;border-radius:8px;margin:12px 0;padding:14px 16px}header{display:flex;justify-content:space-between;gap:20px;color:#b8bdc7}p{line-height:1.5;word-break:break-word}.attachments a{color:#a78bfa}small{color:#8d93a0}</style></head><body><h1>Ticket-Transcript</h1><small>Channel: ${escapeHtml(channel.name)} · Geschlossen von ${escapeHtml(closedById)} · ${new Date().toLocaleString('de-DE')}</small>${rows || '<p>Keine Nachrichten gefunden.</p>'}</body></html>`;
  return {
    buffer: Buffer.from(html, 'utf8'),
    fileName: `transcript-${sanitizeChannelName(channel.name)}-${Date.now()}.html`,
    messageCount: messages.length,
  };
}

async function deliverTicketTranscript(channel, data, closedById) {
  const transcript = await buildTicketTranscript(channel, closedById);
  const targetId = data.config.ticketTranscriptChannelId || data.config.logChannelId;
  const target = targetId ? await channel.guild.channels.fetch(targetId).catch(() => null) : null;
  if (!target?.isTextBased()) return transcript;

  await target.send({
    embeds: [new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle('📄 Ticket-Transcript')
      .setDescription(`**Ticket:** ${channel.name}\n**Geschlossen von:** <@${closedById}>\n**Nachrichten:** ${transcript.messageCount}`)
      .setTimestamp()],
    files: [new AttachmentBuilder(transcript.buffer, { name: transcript.fileName })],
    allowedMentions: { parse: [] },
  });
  return null;
}

const APPLICATION_TYPES = {
  team: 'Team-Bewerbung',
  partner: 'Partner-Bewerbung',
  fraktion: 'Fraktionsbewerbung',
  sonstiges: 'Allgemeine Bewerbung',
};

function applicationReviewPayload(application) {
  const decided = application.status !== 'open';
  const statusText = application.status === 'accepted'
    ? `✅ Angenommen von <@${application.reviewedBy}>`
    : application.status === 'rejected'
      ? `❌ Abgelehnt von <@${application.reviewedBy}>`
      : '⏳ Offen';
  const embed = new EmbedBuilder()
    .setColor(application.status === 'accepted' ? 0x2ecc71 : application.status === 'rejected' ? 0xe74c3c : 0x8b5cf6)
    .setTitle(`📨 ${APPLICATION_TYPES[application.type] || 'Bewerbung'}`)
    .setDescription(`**Bewerber:** <@${application.userId}>\n**Status:** ${statusText}`)
    .addFields(
      { name: 'Alter', value: application.age || '—', inline: true },
      { name: 'Erfahrung', value: application.experience || '—' },
      { name: 'Motivation', value: application.motivation || '—' },
      { name: 'Über mich / Zusatz', value: application.about || '—' },
    )
    .setFooter({ text: `Bewerbungs-ID: ${application.id}` })
    .setTimestamp(application.createdAt);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`application_decide:accepted:${application.id}`).setLabel('Annehmen').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(decided),
    new ButtonBuilder().setCustomId(`application_decide:rejected:${application.id}`).setLabel('Ablehnen').setEmoji('❌').setStyle(ButtonStyle.Danger).setDisabled(decided),
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

function createShortId(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function sendAutomodAlert(guild, data, title, description) {
  const channelId = data.config.automodLogChannelId || data.config.logChannelId;
  if (!channelId) return;
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
  await sendEmbedToChannel(guild, channelId, embed);
}

async function handleAutomodMessage(message, data) {
  const settings = data.automod;
  if (!settings.enabled || canModerate(message.member, data)) return false;

  const now = Date.now();
  const key = `${message.guild.id}:${message.author.id}`;
  const previous = (messageRateLimits.get(key) || []).filter(timestamp => now - timestamp <= settings.spamWindowMs);
  previous.push(now);
  messageRateLimits.set(key, previous);

  const mentionCount = message.mentions.users.size + message.mentions.roles.size;
  const hasInvite = /(?:discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/i.test(message.content || '');
  let reason = null;
  let timeout = false;

  if (previous.length > settings.maxMessages) {
    reason = `Spam erkannt: mehr als ${settings.maxMessages} Nachrichten in ${Math.round(settings.spamWindowMs / 1000)} Sekunden.`;
    timeout = true;
  } else if (mentionCount > settings.maxMentions) {
    reason = `Mention-Spam erkannt: ${mentionCount} Erwähnungen.`;
    timeout = true;
  } else if (settings.blockInvites && hasInvite) {
    reason = 'Nicht erlaubter Discord-Einladungslink.';
  }

  if (!reason) return false;
  if (message.deletable) await message.delete().catch(() => {});
  if (timeout && message.member?.moderatable) {
    await message.member.timeout(5 * 60 * 1000, `AutoMod: ${reason}`).catch(() => {});
  }
  await sendAutomodAlert(
    message.guild,
    data,
    '🛡️ AutoMod ausgelöst',
    `**Nutzer:** <@${message.author.id}>\n**Channel:** <#${message.channel.id}>\n**Grund:** ${reason}`,
  );
  return true;
}

async function handleRaidJoin(member, data) {
  if (!data.automod.enabled) return;
  const now = Date.now();
  const recent = (joinBursts.get(member.guild.id) || []).filter(timestamp => now - timestamp <= data.automod.raidWindowMs);
  recent.push(now);
  joinBursts.set(member.guild.id, recent);

  const accountAgeHours = (now - member.user.createdTimestamp) / 3_600_000;
  let changed = false;
  if (recent.length >= data.automod.raidJoinLimit && data.automod.raidModeUntil < now) {
    data.automod.raidModeUntil = now + 10 * 60 * 1000;
    changed = true;
    await sendAutomodAlert(
      member.guild,
      data,
      '🚨 Möglicher Raid erkannt',
      `**${recent.length} Beitritte** innerhalb von ${Math.round(data.automod.raidWindowMs / 1000)} Sekunden. Schutzmodus ist für 10 Minuten aktiv.`,
    );
  }

  if (accountAgeHours < data.automod.minAccountAgeHours) {
    await sendAutomodAlert(
      member.guild,
      data,
      '⚠️ Sehr neuer Account',
      `<@${member.id}> ist erst **${Math.max(0, Math.floor(accountAgeHours))} Stunden** alt.`,
    );
  }

  if (data.automod.raidModeUntil > now && accountAgeHours < 7 * 24 && member.moderatable) {
    await member.timeout(10 * 60 * 1000, 'AutoMod: Schutzmodus bei möglichem Raid').catch(() => {});
    await sendAutomodAlert(
      member.guild,
      data,
      '🔒 Raid-Schutz angewendet',
      `<@${member.id}> wurde wegen eines jungen Accounts im aktiven Schutzmodus für 10 Minuten eingeschränkt.`,
    );
  }

  if (changed) saveData(data);
}

function xpThresholdForLevel(level) {
  return 100 * Math.pow(level + 1, 2);
}

function calculateLevel(xp) {
  let level = 0;
  while (level < 100 && xp >= xpThresholdForLevel(level)) level++;
  return level;
}

function levelProgressBar(current, required) {
  const filled = Math.max(0, Math.min(10, Math.floor((current / Math.max(1, required)) * 10)));
  return `${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)}`;
}

async function awardMessageXp(message, data) {
  if (!data.config.levelSystemEnabled) return;
  const record = data.levels[message.author.id] || { xp: 0, level: 0, lastXpAt: 0 };
  if (Date.now() - (record.lastXpAt || 0) < XP_COOLDOWN_MS) return;

  const oldLevel = calculateLevel(record.xp || 0);
  record.xp = (record.xp || 0) + Math.floor(Math.random() * 11) + 15;
  record.level = calculateLevel(record.xp);
  record.lastXpAt = Date.now();
  data.levels[message.author.id] = record;

  if (record.level > oldLevel) {
    const earnedRoleIds = Object.entries(data.levelRoles)
      .filter(([level]) => Number(level) <= record.level)
      .map(([, roleId]) => roleId)
      .filter(Boolean);
    for (const roleId of earnedRoleIds) {
      if (!message.member.roles.cache.has(roleId)) await message.member.roles.add(roleId).catch(() => {});
    }
    await message.channel.send({
      content: `🎉 <@${message.author.id}> hat **Level ${record.level}** erreicht!`,
      allowedMentions: { users: [message.author.id] },
    }).catch(() => {});
  }
  saveData(data);
}

function rankEmbed(user, data) {
  const record = data.levels[user.id] || { xp: 0, level: 0 };
  const level = calculateLevel(record.xp || 0);
  const previousThreshold = level === 0 ? 0 : xpThresholdForLevel(level - 1);
  const nextThreshold = xpThresholdForLevel(level);
  const current = (record.xp || 0) - previousThreshold;
  const required = nextThreshold - previousThreshold;
  return new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle(`🏆 Rang • ${user.username}`)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setDescription(`**Level ${level}**\n${levelProgressBar(current, required)}\n${current} / ${required} XP`)
    .setFooter({ text: `Gesamt-XP: ${record.xp || 0}` });
}

async function cacheGuildInvites(guild) {
  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return null;
  inviteCache.set(guild.id, new Map(invites.map(invite => [invite.code, invite.uses || 0])));
  return invites;
}

async function detectUsedInvite(guild) {
  const previous = inviteCache.get(guild.id) || new Map();
  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return null;
  const used = invites.find(invite => (invite.uses || 0) > (previous.get(invite.code) || 0)) || null;
  inviteCache.set(guild.id, new Map(invites.map(invite => [invite.code, invite.uses || 0])));
  return used;
}

function communityEventPayload(event, disabled = false) {
  const participants = Array.isArray(event.participants) ? event.participants : [];
  const status = event.cancelled ? '❌ Abgesagt' : event.started ? '🟢 Gestartet' : '📅 Geplant';
  const participantText = participants.length
    ? participants.slice(0, 20).map(id => `<@${id}>`).join(', ') + (participants.length > 20 ? ` und ${participants.length - 20} weitere` : '')
    : '*Noch keine Teilnehmer.*';
  const embed = new EmbedBuilder()
    .setColor(event.cancelled ? 0xe74c3c : event.started ? 0x2ecc71 : 0x8b5cf6)
    .setTitle(`📅 ${event.name}`)
    .setDescription(event.description || 'Kein zusätzlicher Text.')
    .addFields(
      { name: 'Start', value: `<t:${Math.floor(event.startAt / 1000)}:F>\n<t:${Math.floor(event.startAt / 1000)}:R>`, inline: true },
      { name: 'Status', value: status, inline: true },
      { name: `Teilnehmer (${participants.length})`, value: participantText },
    )
    .setFooter({ text: `Event-ID: ${event.id}` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`community_event_join:${event.id}`)
      .setLabel(disabled || event.started || event.cancelled ? 'Teilnahme geschlossen' : 'Teilnehmen')
      .setEmoji('🙋')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || event.started || event.cancelled),
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

async function checkCommunityEvents(clientInstance) {
  const data = loadData();
  const now = Date.now();
  let changed = false;

  for (const event of Object.values(data.events || {})) {
    if (event.cancelled || event.started) continue;
    if (!event.reminders) event.reminders = {};
    const guild = clientInstance.guilds.cache.get(event.guildId);
    const channel = guild ? await guild.channels.fetch(event.channelId).catch(() => null) : null;
    if (!channel?.isTextBased()) continue;
    const remaining = event.startAt - now;

    if (remaining <= 0) {
      event.started = true;
      changed = true;
      const participantMentions = (event.participants || []).slice(0, 50);
      await channel.send({
        content: `🔔 **${event.name}** startet jetzt! ${participantMentions.map(id => `<@${id}>`).join(' ')}`,
        allowedMentions: { users: participantMentions },
      }).catch(() => {});
      const message = await channel.messages.fetch(event.messageId).catch(() => null);
      if (message) await message.edit(communityEventPayload(event, true)).catch(() => {});
      continue;
    }

    if (remaining <= 60 * 60 * 1000 && remaining > 10 * 60 * 1000 && !event.reminders.hour) {
      event.reminders.hour = true;
      changed = true;
      await channel.send(`⏰ **${event.name}** startet in weniger als einer Stunde.`).catch(() => {});
    }
    if (remaining <= 10 * 60 * 1000 && !event.reminders.tenMinutes) {
      event.reminders.tenMinutes = true;
      changed = true;
      await channel.send(`⏰ **${event.name}** startet in weniger als 10 Minuten.`).catch(() => {});
    }
  }
  if (changed) saveData(data);
}

function renderCustomCommand(text, messageOrInteraction) {
  const user = messageOrInteraction.user || messageOrInteraction.author;
  const guild = messageOrInteraction.guild;
  return String(text || '')
    .replace(/\{user\}/gi, `<@${user.id}>`)
    .replace(/\{username\}/gi, user.username)
    .replace(/\{server\}/gi, guild?.name || 'Server')
    .replace(/\{membercount\}/gi, String(guild?.memberCount || 0));
}

// ============================================================
// SLASH COMMANDS
// ============================================================

function buildCommands() {
  return [
    new SlashCommandBuilder().setName('help').setDescription('Zeigt alle Funktionen des Community-Bots.'),
    new SlashCommandBuilder().setName('ping').setDescription('Zeigt die Bot-Latenz.'),
    new SlashCommandBuilder().setName('serverinfo').setDescription('Zeigt Informationen über den Server.'),
    new SlashCommandBuilder()
      .setName('userinfo')
      .setDescription('Zeigt Informationen über ein Mitglied.')
      .addUserOption(o => o.setName('user').setDescription('Mitglied').setRequired(false)),
    new SlashCommandBuilder()
      .setName('avatar')
      .setDescription('Zeigt das Profilbild eines Mitglieds.')
      .addUserOption(o => o.setName('user').setDescription('Mitglied').setRequired(false)),

    new SlashCommandBuilder()
      .setName('setup')
      .setDescription('Richtet den Community-Bot ein.')
      .addSubcommand(s => s
        .setName('channel')
        .setDescription('Setzt einen Community-Channel.')
        .addStringOption(o => o.setName('typ').setDescription('Channel-Typ').setRequired(true).addChoices(
          { name: 'Welcome', value: 'welcome' },
          { name: 'Leave', value: 'leave' },
          { name: 'Logs', value: 'logs' },
          { name: 'Suggestions', value: 'suggestions' },
          { name: 'Giveaways', value: 'giveaways' },
          { name: 'Socials', value: 'socials' },
          { name: 'Social Audit', value: 'socialaudit' },
          { name: 'Bewerbungs-Auswertung', value: 'applications' },
          { name: 'Ticket-Transkripte', value: 'transcripts' },
          { name: 'AutoMod-Logs', value: 'automodlogs' },
        ))
        .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true).addChannelTypes(ChannelType.GuildText)))
      .addSubcommand(s => s
        .setName('role')
        .setDescription('Setzt eine Community-Rolle.')
        .addStringOption(o => o.setName('typ').setDescription('Rollen-Typ').setRequired(true).addChoices(
          { name: 'Verified', value: 'verified' },
          { name: 'Unverified', value: 'unverified' },
          { name: 'Support', value: 'support' },
          { name: 'Moderator', value: 'moderator' },
          { name: 'Announcements', value: 'announcement' },
          { name: 'Socials Admin', value: 'socialadmin' },
          { name: 'Socials Löschen', value: 'socialdelete' },
          { name: 'Bewerbung angenommen', value: 'applicationaccepted' },
        ))
        .addRoleOption(o => o.setName('rolle').setDescription('Rolle').setRequired(true)))
      .addSubcommand(s => s
        .setName('tickets')
        .setDescription('Richtet Tickets ein.')
        .addChannelOption(o => o.setName('kategorie').setDescription('Ticket-Kategorie').setRequired(true).addChannelTypes(ChannelType.GuildCategory))
        .addRoleOption(o => o.setName('support_rolle').setDescription('Support-Rolle').setRequired(true)))
      .addSubcommand(s => s.setName('show').setDescription('Zeigt die aktuelle Konfiguration.')),

    new SlashCommandBuilder().setName('verificationpanel').setDescription('Erstellt das Verifizierungs-Panel.'),
    new SlashCommandBuilder().setName('ticketpanel').setDescription('Erstellt das Ticket-Panel.'),
    new SlashCommandBuilder()
      .setName('ticket')
      .setDescription('Verwaltet ein Ticket.')
      .addSubcommand(s => s.setName('add').setDescription('Fügt ein Mitglied zum Ticket hinzu.').addUserOption(o => o.setName('user').setDescription('Mitglied').setRequired(true)))
      .addSubcommand(s => s.setName('remove').setDescription('Entfernt ein Mitglied aus dem Ticket.').addUserOption(o => o.setName('user').setDescription('Mitglied').setRequired(true)))
      .addSubcommand(s => s.setName('close').setDescription('Schließt das aktuelle Ticket.')),

    new SlashCommandBuilder()
      .setName('announce')
      .setDescription('Sendet eine Ankündigung als Embed.')
      .addStringOption(o => o.setName('titel').setDescription('Titel').setRequired(true).setMaxLength(100))
      .addStringOption(o => o.setName('text').setDescription('Text').setRequired(true).setMaxLength(1800))
      .addChannelOption(o => o.setName('channel').setDescription('Ziel-Channel').setRequired(false).addChannelTypes(ChannelType.GuildText))
      .addBooleanOption(o => o.setName('everyone').setDescription('@everyone erwähnen?').setRequired(false)),

    new SlashCommandBuilder()
      .setName('embed')
      .setDescription('Erstellt eine eigene Embed-Nachricht über ein Formular.')
      .addChannelOption(o => o.setName('channel').setDescription('Ziel-Channel (sonst aktueller Channel)').setRequired(false).addChannelTypes(ChannelType.GuildText))
      .addBooleanOption(o => o.setName('everyone').setDescription('@everyone erwähnen?').setRequired(false)),

    new SlashCommandBuilder()
      .setName('poll')
      .setDescription('Erstellt eine Abstimmung.')
      .addStringOption(o => o.setName('frage').setDescription('Frage').setRequired(true).setMaxLength(200))
      .addStringOption(o => o.setName('option1').setDescription('Option 1').setRequired(true).setMaxLength(100))
      .addStringOption(o => o.setName('option2').setDescription('Option 2').setRequired(true).setMaxLength(100))
      .addStringOption(o => o.setName('option3').setDescription('Option 3').setRequired(false).setMaxLength(100))
      .addStringOption(o => o.setName('option4').setDescription('Option 4').setRequired(false).setMaxLength(100))
      .addStringOption(o => o.setName('option5').setDescription('Option 5').setRequired(false).setMaxLength(100)),

    new SlashCommandBuilder()
      .setName('suggest')
      .setDescription('Sendet einen Vorschlag.')
      .addStringOption(o => o.setName('text').setDescription('Dein Vorschlag').setRequired(true).setMaxLength(1500)),

    new SlashCommandBuilder()
      .setName('giveaway')
      .setDescription('Verwaltet Giveaways.')
      .addSubcommand(s => s
        .setName('start')
        .setDescription('Startet ein Giveaway.')
        .addStringOption(o => o.setName('preis').setDescription('Was wird verlost?').setRequired(true).setMaxLength(200))
        .addStringOption(o => o.setName('dauer').setDescription('z. B. 10m, 2h, 1d').setRequired(true).setMaxLength(20))
        .addIntegerOption(o => o.setName('gewinner').setDescription('Anzahl der Gewinner').setRequired(false).setMinValue(1).setMaxValue(10))
        .addStringOption(o => o.setName('beschreibung').setDescription('Zusätzliche Beschreibung').setRequired(false).setMaxLength(1000))
        .addChannelOption(o => o.setName('channel').setDescription('Giveaway-Channel').setRequired(false).addChannelTypes(ChannelType.GuildText))
        .addRoleOption(o => o.setName('rolle').setDescription('Optional benötigte Rolle').setRequired(false))
        .addBooleanOption(o => o.setName('everyone').setDescription('@everyone beim Start erwähnen?').setRequired(false)))
      .addSubcommand(s => s
        .setName('end')
        .setDescription('Beendet ein Giveaway sofort.')
        .addStringOption(o => o.setName('message_id').setDescription('Nachrichten-ID des Giveaways').setRequired(true)))
      .addSubcommand(s => s
        .setName('reroll')
        .setDescription('Lost Gewinner eines beendeten Giveaways neu aus.')
        .addStringOption(o => o.setName('message_id').setDescription('Nachrichten-ID des Giveaways').setRequired(true))
        .addIntegerOption(o => o.setName('gewinner').setDescription('Neue Gewinneranzahl').setRequired(false).setMinValue(1).setMaxValue(10)))
      .addSubcommand(s => s.setName('list').setDescription('Zeigt laufende Giveaways.')),

    new SlashCommandBuilder()
      .setName('warn')
      .setDescription('Verwarnt ein Mitglied.')
      .addUserOption(o => o.setName('user').setDescription('Mitglied').setRequired(true))
      .addStringOption(o => o.setName('grund').setDescription('Grund').setRequired(true).setMaxLength(500)),
    new SlashCommandBuilder()
      .setName('warnings')
      .setDescription('Zeigt Verwarnungen eines Mitglieds.')
      .addUserOption(o => o.setName('user').setDescription('Mitglied').setRequired(true)),
    new SlashCommandBuilder()
      .setName('clearwarnings')
      .setDescription('Löscht alle Verwarnungen eines Mitglieds.')
      .addUserOption(o => o.setName('user').setDescription('Mitglied').setRequired(true)),
    new SlashCommandBuilder()
      .setName('timeout')
      .setDescription('Gibt einem Mitglied einen Timeout.')
      .addUserOption(o => o.setName('user').setDescription('Mitglied').setRequired(true))
      .addIntegerOption(o => o.setName('minuten').setDescription('Dauer in Minuten').setRequired(true).setMinValue(1).setMaxValue(40320))
      .addStringOption(o => o.setName('grund').setDescription('Grund').setRequired(false).setMaxLength(500)),
    new SlashCommandBuilder()
      .setName('untimeout')
      .setDescription('Entfernt einen Timeout.')
      .addUserOption(o => o.setName('user').setDescription('Mitglied').setRequired(true)),
    new SlashCommandBuilder()
      .setName('kick')
      .setDescription('Kickt ein Mitglied.')
      .addUserOption(o => o.setName('user').setDescription('Mitglied').setRequired(true))
      .addStringOption(o => o.setName('grund').setDescription('Grund').setRequired(false).setMaxLength(500)),
    new SlashCommandBuilder()
      .setName('ban')
      .setDescription('Bannt ein Mitglied.')
      .addUserOption(o => o.setName('user').setDescription('Mitglied').setRequired(true))
      .addStringOption(o => o.setName('grund').setDescription('Grund').setRequired(false).setMaxLength(500)),
    new SlashCommandBuilder()
      .setName('unban')
      .setDescription('Entbannt eine Discord-ID.')
      .addStringOption(o => o.setName('discord_id').setDescription('Discord-ID').setRequired(true)),
    new SlashCommandBuilder()
      .setName('unbanall')
      .setDescription('Entbannt alle gebannten Nutzer vom Server.')
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    new SlashCommandBuilder()
      .setName('purge')
      .setDescription('Löscht mehrere Nachrichten.')
      .addIntegerOption(o => o.setName('anzahl').setDescription('1 bis 100').setRequired(true).setMinValue(1).setMaxValue(100)),
    new SlashCommandBuilder()
      .setName('slowmode')
      .setDescription('Setzt den Slowmode im Channel.')
      .addIntegerOption(o => o.setName('sekunden').setDescription('0 bis 21600').setRequired(true).setMinValue(0).setMaxValue(21600)),
    new SlashCommandBuilder().setName('lock').setDescription('Sperrt den aktuellen Channel für @everyone.'),
    new SlashCommandBuilder().setName('unlock').setDescription('Entsperrt den aktuellen Channel.'),

    // Bewerbungen
    new SlashCommandBuilder()
      .setName('applicationpanel')
      .setDescription('Erstellt ein Bewerbungs-Panel.')
      .addStringOption(o => o.setName('typ').setDescription('Bewerbungsart').setRequired(true).addChoices(
        { name: 'Team', value: 'team' },
        { name: 'Partner', value: 'partner' },
        { name: 'Fraktion', value: 'fraktion' },
        { name: 'Sonstiges', value: 'sonstiges' },
      ))
      .addChannelOption(o => o.setName('auswertung').setDescription('Channel für neue Bewerbungen').setRequired(true).addChannelTypes(ChannelType.GuildText)),
    new SlashCommandBuilder().setName('applicationlist').setDescription('Zeigt die offenen Bewerbungen.'),

    // Rollen-Panel
    new SlashCommandBuilder()
      .setName('rolepanel')
      .setDescription('Erstellt ein Rollen-Panel mit bis zu fünf Rollen.')
      .addStringOption(o => o.setName('titel').setDescription('Titel des Panels').setRequired(true).setMaxLength(100))
      .addRoleOption(o => o.setName('rolle1').setDescription('Erste Rolle').setRequired(true))
      .addRoleOption(o => o.setName('rolle2').setDescription('Zweite Rolle').setRequired(false))
      .addRoleOption(o => o.setName('rolle3').setDescription('Dritte Rolle').setRequired(false))
      .addRoleOption(o => o.setName('rolle4').setDescription('Vierte Rolle').setRequired(false))
      .addRoleOption(o => o.setName('rolle5').setDescription('Fünfte Rolle').setRequired(false)),

    // AutoMod / Anti-Raid
    new SlashCommandBuilder()
      .setName('automod')
      .setDescription('Richtet Anti-Spam und Anti-Raid ein.')
      .addSubcommand(s => s
        .setName('enable')
        .setDescription('Aktiviert den Schutz.')
        .addChannelOption(o => o.setName('log_channel').setDescription('Channel für Warnungen').setRequired(false).addChannelTypes(ChannelType.GuildText))
        .addBooleanOption(o => o.setName('block_invites').setDescription('Discord-Einladungen blockieren?').setRequired(false))
        .addIntegerOption(o => o.setName('max_mentions').setDescription('Erlaubte Erwähnungen je Nachricht').setRequired(false).setMinValue(1).setMaxValue(20))
        .addIntegerOption(o => o.setName('max_messages').setDescription('Nachrichten je 8 Sekunden').setRequired(false).setMinValue(3).setMaxValue(15))
        .addIntegerOption(o => o.setName('account_age').setDescription('Warnung unter X Account-Stunden').setRequired(false).setMinValue(1).setMaxValue(720)))
      .addSubcommand(s => s.setName('disable').setDescription('Deaktiviert den Schutz.'))
      .addSubcommand(s => s.setName('status').setDescription('Zeigt die Schutz-Einstellungen.')),

    // Temporäre Voice-Channels
    new SlashCommandBuilder()
      .setName('tempvoice')
      .setDescription('Richtet temporäre Sprachkanäle ein.')
      .addSubcommand(s => s
        .setName('setup')
        .setDescription('Legt Lobby und Kategorie fest.')
        .addChannelOption(o => o.setName('lobby').setDescription('Beitreten, um einen Raum zu erstellen').setRequired(true).addChannelTypes(ChannelType.GuildVoice))
        .addChannelOption(o => o.setName('kategorie').setDescription('Kategorie für die Räume').setRequired(true).addChannelTypes(ChannelType.GuildCategory))
        .addIntegerOption(o => o.setName('limit').setDescription('Standard-Limit, 0 = unbegrenzt').setRequired(false).setMinValue(0).setMaxValue(99)))
      .addSubcommand(s => s.setName('disable').setDescription('Deaktiviert temporäre Sprachkanäle.'))
      .addSubcommand(s => s.setName('status').setDescription('Zeigt die aktuelle Einrichtung.')),
    new SlashCommandBuilder()
      .setName('voice')
      .setDescription('Verwaltet deinen temporären Sprachkanal.')
      .addSubcommand(s => s.setName('name').setDescription('Benennt deinen Raum um.').addStringOption(o => o.setName('name').setDescription('Neuer Name').setRequired(true).setMaxLength(80)))
      .addSubcommand(s => s.setName('limit').setDescription('Ändert das Nutzerlimit.').addIntegerOption(o => o.setName('anzahl').setDescription('0 bis 99').setRequired(true).setMinValue(0).setMaxValue(99)))
      .addSubcommand(s => s.setName('lock').setDescription('Sperrt deinen Raum.'))
      .addSubcommand(s => s.setName('unlock').setDescription('Öffnet deinen Raum.'))
      .addSubcommand(s => s.setName('permit').setDescription('Erlaubt einer Person den Zutritt.').addUserOption(o => o.setName('user').setDescription('Person').setRequired(true)))
      .addSubcommand(s => s.setName('reject').setDescription('Entfernt und sperrt eine Person.').addUserOption(o => o.setName('user').setDescription('Person').setRequired(true))),

    // Level und Einladungen
    new SlashCommandBuilder().setName('rank').setDescription('Zeigt den Level-Rang.').addUserOption(o => o.setName('user').setDescription('Mitglied').setRequired(false)),
    new SlashCommandBuilder().setName('leaderboard').setDescription('Zeigt die Level-Bestenliste.'),
    new SlashCommandBuilder()
      .setName('levelrole')
      .setDescription('Verwaltet automatische Level-Rollen.')
      .addSubcommand(s => s.setName('set').setDescription('Setzt eine Rolle für ein Level.').addIntegerOption(o => o.setName('level').setDescription('Level').setRequired(true).setMinValue(1).setMaxValue(100)).addRoleOption(o => o.setName('rolle').setDescription('Rolle').setRequired(true)))
      .addSubcommand(s => s.setName('remove').setDescription('Entfernt eine Level-Rolle.').addIntegerOption(o => o.setName('level').setDescription('Level').setRequired(true).setMinValue(1).setMaxValue(100)))
      .addSubcommand(s => s.setName('list').setDescription('Zeigt alle Level-Rollen.')),
    new SlashCommandBuilder()
      .setName('levelsystem')
      .setDescription('Schaltet das Level-System.')
      .addSubcommand(s => s.setName('enable').setDescription('Aktiviert das Level-System.'))
      .addSubcommand(s => s.setName('disable').setDescription('Deaktiviert das Level-System.'))
      .addSubcommand(s => s.setName('status').setDescription('Zeigt den Status.')),
    new SlashCommandBuilder().setName('invites').setDescription('Zeigt die Einladungs-Statistik.').addUserOption(o => o.setName('user').setDescription('Mitglied').setRequired(false)),
    new SlashCommandBuilder().setName('inviteleaderboard').setDescription('Zeigt die Invite-Bestenliste.'),

    // Community-Events
    new SlashCommandBuilder()
      .setName('event')
      .setDescription('Plant Community-Events mit Erinnerungen.')
      .addSubcommand(s => s
        .setName('create')
        .setDescription('Erstellt ein Event.')
        .addStringOption(o => o.setName('name').setDescription('Name des Events').setRequired(true).setMaxLength(100))
        .addStringOption(o => o.setName('in').setDescription('Start in z. B. 30m, 2h oder 3d').setRequired(true).setMaxLength(20))
        .addStringOption(o => o.setName('beschreibung').setDescription('Beschreibung').setRequired(false).setMaxLength(1000))
        .addChannelOption(o => o.setName('channel').setDescription('Event-Channel').setRequired(false).addChannelTypes(ChannelType.GuildText)))
      .addSubcommand(s => s.setName('list').setDescription('Zeigt geplante Events.'))
      .addSubcommand(s => s.setName('cancel').setDescription('Sagt ein Event ab.').addStringOption(o => o.setName('event_id').setDescription('Event-ID').setRequired(true))),

    // Team-Dienst
    new SlashCommandBuilder()
      .setName('duty')
      .setDescription('Verwaltet den Team-Dienst.')
      .addSubcommand(s => s.setName('start').setDescription('Startet deinen Dienst.'))
      .addSubcommand(s => s.setName('stop').setDescription('Beendet deinen Dienst.'))
      .addSubcommand(s => s.setName('status').setDescription('Zeigt deinen Dienststatus.')),
    new SlashCommandBuilder().setName('dutystats').setDescription('Zeigt die Dienstzeit.').addUserOption(o => o.setName('user').setDescription('Teammitglied').setRequired(false)),
    new SlashCommandBuilder().setName('dutyleaderboard').setDescription('Zeigt die längsten Dienstzeiten.'),

    // Eigene Commands
    new SlashCommandBuilder()
      .setName('customcommand')
      .setDescription('Verwaltet eigene Text-Commands.')
      .addSubcommand(s => s.setName('add').setDescription('Erstellt oder ändert einen Command.').addStringOption(o => o.setName('name').setDescription('Name ohne !').setRequired(true).setMaxLength(32)).addStringOption(o => o.setName('antwort').setDescription('Antworttext').setRequired(true).setMaxLength(1800)))
      .addSubcommand(s => s.setName('remove').setDescription('Löscht einen Command.').addStringOption(o => o.setName('name').setDescription('Name ohne !').setRequired(true).setMaxLength(32)))
      .addSubcommand(s => s.setName('list').setDescription('Zeigt alle eigenen Commands.'))
      .addSubcommand(s => s.setName('run').setDescription('Führt einen eigenen Command aus.').addStringOption(o => o.setName('name').setDescription('Command-Name').setRequired(true).setMaxLength(32))),

    // Socials
    new SlashCommandBuilder().setName('socials').setDescription('Fügt Socials über Discord-ID hinzu.'),
    new SlashCommandBuilder().setName('editsocials').setDescription('Ersetzt die Socials einer Discord-ID.'),
    new SlashCommandBuilder()
      .setName('removesocial')
      .setDescription('Entfernt einen einzelnen Social-Link.')
      .addStringOption(o => o.setName('discord_id').setDescription('Discord-ID').setRequired(true))
      .addStringOption(o => o.setName('link').setDescription('Genauer Link').setRequired(true)),
    new SlashCommandBuilder()
      .setName('deletesocials')
      .setDescription('Entfernt eine Person vollständig aus den Socials.')
      .addStringOption(o => o.setName('discord_id').setDescription('Discord-ID').setRequired(true)),
    new SlashCommandBuilder()
      .setName('socialinfo')
      .setDescription('Zeigt die Socials einer Person.')
      .addUserOption(o => o.setName('user').setDescription('Mitglied').setRequired(true)),
    new SlashCommandBuilder().setName('sociallist').setDescription('Zeigt alle eingetragenen Socials-Mitglieder.'),
    new SlashCommandBuilder()
      .setName('mysocials')
      .setDescription('Verwalte deine eigenen Socials.')
      .addSubcommand(s => s
        .setName('add')
        .setDescription('Fügt Links hinzu.')
        .addStringOption(o => o.setName('links').setDescription('Links mit Leerzeichen trennen').setRequired(true).setMaxLength(1500)))
      .addSubcommand(s => s
        .setName('set')
        .setDescription('Ersetzt alle deine Links.')
        .addStringOption(o => o.setName('links').setDescription('Links mit Leerzeichen trennen').setRequired(true).setMaxLength(1500)))
      .addSubcommand(s => s
        .setName('remove')
        .setDescription('Entfernt einen Link.')
        .addStringOption(o => o.setName('link').setDescription('Genauer Link').setRequired(true)))
      .addSubcommand(s => s.setName('view').setDescription('Zeigt deine Socials.')),
    new SlashCommandBuilder().setName('refreshsocials').setDescription('Sortiert und aktualisiert das Socials-Panel.'),
    new SlashCommandBuilder()
      .setName('setsocialaudit')
      .setDescription('Setzt den Social-Audit-Channel.')
      .addChannelOption(o => o.setName('channel').setDescription('Audit-Channel').setRequired(true).addChannelTypes(ChannelType.GuildText)),
  ].map(command => command.toJSON());
}

// ============================================================
// CLIENT / READY
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildInvites,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});

client.once(Events.ClientReady, async readyClient => {
  console.log(`✅ Eingeloggt als ${readyClient.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(config.token);
  const commands = buildCommands();

  for (const guild of readyClient.guilds.cache.values()) {
    try {
      await rest.put(Routes.applicationGuildCommands(readyClient.application.id, guild.id), { body: commands });
      console.log(`✅ ${commands.length} Commands registriert auf ${guild.name} (${guild.id}).`);
    } catch (error) {
      console.error(`❌ Commands konnten auf ${guild.name} nicht registriert werden:`, error);
    }
  }

  // Regelmäßige Socials-Neusortierung.
  setInterval(async () => {
    const data = loadData();
    for (const guild of readyClient.guilds.cache.values()) {
      if (!data.config.socialsChannelId && !config.fallbackSocialsChannelId) continue;
      await updateSocialPanel(guild, data).catch(() => {});
    }
  }, 5 * 60 * 1000);

  // Laufende Giveaways nach Neustarts weiterführen und automatisch beenden.
  await checkExpiredGiveaways(readyClient);
  setInterval(() => checkExpiredGiveaways(readyClient).catch(() => {}), 10_000);

  // Invite-Zähler vorbereiten.
  for (const guild of readyClient.guilds.cache.values()) {
    await cacheGuildInvites(guild).catch(() => {});
  }

  // Geplante Community-Events und Erinnerungen fortsetzen.
  await checkCommunityEvents(readyClient);
  setInterval(() => checkCommunityEvents(readyClient).catch(() => {}), EVENT_CHECK_INTERVAL_MS);
});

// ============================================================
// MEMBER EVENTS
// ============================================================

client.on(Events.GuildMemberAdd, async member => {
  const data = loadData();

  const usedInvite = await detectUsedInvite(member.guild).catch(() => null);
  if (usedInvite?.inviter?.id) {
    const inviterId = usedInvite.inviter.id;
    const stats = data.inviteStats[inviterId] || { total: 0, active: 0, leaves: 0 };
    stats.total++;
    stats.active++;
    data.inviteStats[inviterId] = stats;
    data.inviteMembers[member.id] = inviterId;
    saveData(data);
  }

  await handleRaidJoin(member, data).catch(error => console.error('❌ Raid-Schutz Fehler:', error));

  if (data.config.unverifiedRoleId) {
    await member.roles.add(data.config.unverifiedRoleId).catch(() => {});
  }

  if (data.config.welcomeChannelId) {
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('👋 Willkommen!')
      .setDescription(`Willkommen <@${member.id}> auf **${member.guild.name}**!`)
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .addFields({ name: 'Mitglieder', value: String(member.guild.memberCount), inline: true })
      .setTimestamp();
    await sendEmbedToChannel(member.guild, data.config.welcomeChannelId, embed);
  }

  await logEvent(member.guild, data, '📥 Member Join', `<@${member.id}> (${member.user.tag}) ist dem Server beigetreten.`);
});

client.on(Events.GuildMemberRemove, async member => {
  const data = loadData();

  const inviterId = data.inviteMembers[member.id];
  if (inviterId) {
    const stats = data.inviteStats[inviterId] || { total: 0, active: 0, leaves: 0 };
    stats.active = Math.max(0, (stats.active || 0) - 1);
    stats.leaves = (stats.leaves || 0) + 1;
    data.inviteStats[inviterId] = stats;
    delete data.inviteMembers[member.id];
    saveData(data);
  }

  if (data.config.leaveChannelId) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('👋 Auf Wiedersehen')
      .setDescription(`**${member.user.tag}** hat **${member.guild.name}** verlassen.`)
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .setTimestamp();
    await sendEmbedToChannel(member.guild, data.config.leaveChannelId, embed);
  }

  const before = data.socials.members.length;
  data.socials.members = data.socials.members.filter(x => x.userId !== member.id);
  if (data.socials.members.length !== before) {
    saveData(data);
    await updateSocialPanel(member.guild, data).catch(() => {});
    await socialAudit(member.guild, data, '🗑️ Socials automatisch entfernt', `<@${member.id}> hat den Server verlassen und wurde aus dem Panel entfernt.`);
  }

  await logEvent(member.guild, data, '📤 Member Leave', `**${member.user.tag}** (${member.id}) hat den Server verlassen.`);
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const roleChanged = oldMember.roles.cache.size !== newMember.roles.cache.size ||
    config.socialSortRoleIds.some(id => oldMember.roles.cache.has(id) !== newMember.roles.cache.has(id));
  if (!roleChanged) return;
  const data = loadData();
  if (!findSocial(data, newMember.id)) return;
  await updateSocialPanel(newMember.guild, data).catch(() => {});
});

client.on(Events.InviteCreate, async invite => {
  if (invite.guild) await cacheGuildInvites(invite.guild).catch(() => {});
});

client.on(Events.InviteDelete, async invite => {
  if (invite.guild) await cacheGuildInvites(invite.guild).catch(() => {});
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const data = loadData();
  const lobbyId = data.config.tempVoiceLobbyId;

  if (lobbyId && newState.channelId === lobbyId && oldState.channelId !== lobbyId) {
    const member = newState.member;
    const channel = await newState.guild.channels.create({
      name: `🎧 ${member.displayName}`.slice(0, 90),
      type: ChannelType.GuildVoice,
      parent: data.config.tempVoiceCategoryId || newState.channel?.parentId || undefined,
      userLimit: Number(data.config.tempVoiceUserLimit) || 0,
      permissionOverwrites: [
        {
          id: member.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.MoveMembers,
          ],
        },
      ],
      reason: `Temporärer Raum für ${member.user.tag}`,
    }).catch(() => null);

    if (channel) {
      data.tempVoices[channel.id] = { ownerId: member.id, createdAt: Date.now() };
      saveData(data);
      const moved = await member.voice.setChannel(channel).then(() => true).catch(() => false);
      if (!moved) {
        delete data.tempVoices[channel.id];
        saveData(data);
        await channel.delete('Mitglied konnte nicht verschoben werden').catch(() => {});
      }
    }
  }

  if (oldState.channelId && data.tempVoices[oldState.channelId]) {
    const oldChannel = oldState.channel || await oldState.guild.channels.fetch(oldState.channelId).catch(() => null);
    if (oldChannel?.isVoiceBased() && oldChannel.members.size === 0) {
      delete data.tempVoices[oldState.channelId];
      saveData(data);
      await oldChannel.delete('Temporärer Raum ist leer').catch(() => {});
    }
  }
});

// ============================================================
// VORSCHLÄGE AUS NORMALEN NACHRICHTEN
// ============================================================

client.on(Events.MessageCreate, async message => {
  if (!message.guild || message.author.bot) return;

  const data = loadData();
  if (await handleAutomodMessage(message, data)) return;

  await awardMessageXp(message, data).catch(error => console.error('❌ Level-System Fehler:', error));

  const prefix = data.config.customCommandPrefix || '!';
  if (message.content?.startsWith(prefix)) {
    const name = message.content.slice(prefix.length).trim().split(/\s+/)[0]?.toLowerCase();
    const custom = name ? data.customCommands[name] : null;
    if (custom?.response) {
      await message.reply({
        content: renderCustomCommand(custom.response, message).slice(0, 2000),
        allowedMentions: { users: [message.author.id], roles: [], parse: [] },
      });
      return;
    }
  }

  const suggestionsChannelId = data.config.suggestionsChannelId;
  if (!suggestionsChannelId || message.channel.id !== suggestionsChannelId) return;

  const text = message.content?.trim();
  const attachment = message.attachments.first();
  if (!text && !attachment) return;

  try {
    const embed = new EmbedBuilder()
      .setColor(0x111111)
      .setTitle('💡 Vorschlag')
      .setDescription(text || '*Kein Text – siehe Anhang.*')
      .setAuthor({
        name: message.member?.displayName || message.author.username,
        iconURL: message.author.displayAvatarURL(),
      })
      .addFields({
        name: 'Abstimmung',
        value: '✅ **Dafür**\n❌ **Dagegen**',
      })
      .setFooter({ text: `Vorschlag von ${message.author.username}` })
      .setTimestamp();

    if (attachment?.contentType?.startsWith('image/')) {
      embed.setImage(attachment.url);
    } else if (attachment) {
      embed.addFields({ name: 'Anhang', value: `[Datei öffnen](${attachment.url})` });
    }

    const panel = await message.channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });

    await panel.react('✅');
    await panel.react('❌');

    if (message.deletable) {
      suggestionSourceDeletes.add(message.id);
      await message.delete().catch(() => suggestionSourceDeletes.delete(message.id));
      setTimeout(() => suggestionSourceDeletes.delete(message.id), 10_000);
    }
  } catch (error) {
    console.error('❌ Vorschlag konnte nicht in ein Panel umgewandelt werden:', error);
  }
});

// ============================================================
// MESSAGE LOGS
// ============================================================

client.on(Events.MessageDelete, async message => {
  if (suggestionSourceDeletes.has(message.id)) {
    suggestionSourceDeletes.delete(message.id);
    return;
  }
  if (!message.guild || message.author?.bot) return;
  const data = loadData();
  if (!data.config.logChannelId || message.channel.id === data.config.logChannelId) return;
  const text = message.content ? `\n**Inhalt:** ${message.content.slice(0, 1000)}` : '';
  await logEvent(message.guild, data, '🗑️ Nachricht gelöscht', `**Channel:** <#${message.channel.id}>\n**Autor:** ${message.author ? `<@${message.author.id}>` : 'Unbekannt'}${text}`);
});

client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (!newMessage.guild || newMessage.author?.bot) return;
  if (!oldMessage.content || !newMessage.content || oldMessage.content === newMessage.content) return;
  const data = loadData();
  if (!data.config.logChannelId || newMessage.channel.id === data.config.logChannelId) return;
  await logEvent(
    newMessage.guild,
    data,
    '✏️ Nachricht bearbeitet',
    `**Channel:** <#${newMessage.channel.id}>\n**Autor:** <@${newMessage.author.id}>\n**Vorher:** ${oldMessage.content.slice(0, 700)}\n**Nachher:** ${newMessage.content.slice(0, 700)}`,
  );
});

// ============================================================
// INTERACTIONS
// ============================================================

client.on(Events.InteractionCreate, async interaction => {
  try {
    const data = loadData();

    // ---------- BUTTONS ----------
    if (interaction.isButton()) {
      if (interaction.customId === 'verify_start') {
        const a = Math.floor(Math.random() * 20) + 1;
        const b = Math.floor(Math.random() * 20) + 1;
        verifyChallenges.set(`${interaction.guildId}:${interaction.user.id}`, { answer: a + b, expiresAt: Date.now() + VERIFY_TTL_MS });

        const modal = new ModalBuilder().setCustomId('verify_math_modal').setTitle('Verifizierung');
        const input = new TextInputBuilder()
          .setCustomId('answer')
          .setLabel(`Wie viel ist ${a} + ${b}?`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(5);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === 'ticket_create') {
        if (!interaction.inGuild()) return;
        const existing = interaction.guild.channels.cache.find(ch => ch.topic?.startsWith(`ticket-owner:${interaction.user.id}`));
        if (existing) {
          await interaction.reply({ content: `❌ Du hast bereits ein Ticket: <#${existing.id}>`, ephemeral: true });
          return;
        }

        const overwrites = [
          { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
        ];
        if (data.config.supportRoleId) {
          overwrites.push({ id: data.config.supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] });
        }

        const channel = await interaction.guild.channels.create({
          name: `ticket-${sanitizeChannelName(interaction.user.username)}`,
          type: ChannelType.GuildText,
          parent: data.config.ticketCategoryId || undefined,
          topic: `ticket-owner:${interaction.user.id}|created:${Date.now()}`,
          permissionOverwrites: overwrites,
        });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('ticket_claim').setLabel('Übernehmen').setEmoji('🙋').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('ticket_close').setLabel('Schließen').setEmoji('🔒').setStyle(ButtonStyle.Danger),
        );
        await channel.send({
          content: `<@${interaction.user.id}>${data.config.supportRoleId ? ` • <@&${data.config.supportRoleId}>` : ''}`,
          embeds: [new EmbedBuilder().setColor(0x111111).setTitle('🎫 Support Ticket').setDescription('Beschreibe hier dein Anliegen. Das Team kümmert sich darum.')],
          components: [row],
          allowedMentions: { users: [interaction.user.id], roles: data.config.supportRoleId ? [data.config.supportRoleId] : [] },
        });
        await interaction.reply({ content: `✅ Ticket erstellt: <#${channel.id}>`, ephemeral: true });
        await logEvent(interaction.guild, data, '🎫 Ticket erstellt', `<@${interaction.user.id}> hat <#${channel.id}> erstellt.`);
        return;
      }

      if (interaction.customId === 'ticket_claim') {
        if (!canManageTickets(interaction.member, data)) {
          await interaction.reply({ content: '❌ Du darfst keine Tickets übernehmen.', ephemeral: true });
          return;
        }
        await interaction.update({
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ticket_claim').setLabel(`Übernommen von ${interaction.user.username}`.slice(0, 80)).setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(true),
            new ButtonBuilder().setCustomId('ticket_close').setLabel('Schließen').setEmoji('🔒').setStyle(ButtonStyle.Danger),
          )],
        });
        await interaction.followUp({ content: `✅ <@${interaction.user.id}> hat das Ticket übernommen.` });
        return;
      }

      if (interaction.customId === 'ticket_close') {
        const ownerId = ticketOwnerId(interaction.channel);
        const allowed = ownerId === interaction.user.id || canManageTickets(interaction.member, data);
        if (!allowed) {
          await interaction.reply({ content: '❌ Du darfst dieses Ticket nicht schließen.', ephemeral: true });
          return;
        }
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('ticket_close_confirm').setLabel('Ja, schließen').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('ticket_close_cancel').setLabel('Abbrechen').setStyle(ButtonStyle.Secondary),
        );
        await interaction.reply({ content: 'Ticket wirklich schließen?', components: [row], ephemeral: true });
        return;
      }

      if (interaction.customId === 'ticket_close_cancel') {
        await interaction.update({ content: '✅ Abgebrochen.', components: [] });
        return;
      }

      if (interaction.customId === 'ticket_close_confirm') {
        const ownerId = ticketOwnerId(interaction.channel);
        const allowed = ownerId === interaction.user.id || canManageTickets(interaction.member, data);
        if (!allowed) {
          await interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
          return;
        }
        await interaction.update({ content: '🔒 Ticket wird in 5 Sekunden geschlossen.', components: [] });
        const fallbackTranscript = await deliverTicketTranscript(interaction.channel, data, interaction.user.id).catch(error => {
          console.error('❌ Ticket-Transcript Fehler:', error);
          return null;
        });
        if (fallbackTranscript) {
          await interaction.followUp({
            content: '📄 Es ist kein Transcript-Channel eingerichtet. Hier ist das Transcript:',
            files: [new AttachmentBuilder(fallbackTranscript.buffer, { name: fallbackTranscript.fileName })],
            ephemeral: true,
          }).catch(() => {});
        }
        await logEvent(interaction.guild, data, '🔒 Ticket geschlossen', `<#${interaction.channel.id}> wurde von <@${interaction.user.id}> geschlossen.`);
        setTimeout(() => interaction.channel.delete(`Ticket geschlossen von ${interaction.user.tag}`).catch(() => {}), 5000);
        return;
      }

      if (interaction.customId.startsWith('unbanall_confirm:')) {
        const [, requesterId] = interaction.customId.split(':');

        if (interaction.user.id !== requesterId) {
          await interaction.reply({ content: '❌ Diese Bestätigung gehört nicht dir.', ephemeral: true });
          return;
        }

        if (
          !interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
          !interaction.member.permissions.has(PermissionFlagsBits.BanMembers)
        ) {
          await interaction.update({ content: '❌ Du hast keine Berechtigung, alle Bans aufzuheben.', components: [] });
          return;
        }

        await interaction.update({ content: '⏳ Alle gebannten Nutzer werden entbannt ...', components: [] });

        const bans = await interaction.guild.bans.fetch();
        let success = 0;
        let failed = 0;

        for (const ban of bans.values()) {
          try {
            await interaction.guild.members.unban(
              ban.user.id,
              `Unban All ausgeführt von ${interaction.user.tag}`,
            );
            success++;
          } catch (error) {
            failed++;
            console.error(`❌ Unban fehlgeschlagen für ${ban.user.id}:`, error);
          }
        }

        const result = failed
          ? `✅ **${success}** Nutzer entbannt. ❌ **${failed}** konnten nicht entbannt werden.`
          : `✅ **${success}** gebannte Nutzer wurden erfolgreich entbannt.`;

        await interaction.editReply({ content: result, components: [] }).catch(() => {});
        await logEvent(
          interaction.guild,
          data,
          '🔓 Unban All',
          `<@${interaction.user.id}> hat **${success}** Nutzer entbannt.${failed ? `\n**Fehlgeschlagen:** ${failed}` : ''}`,
        );
        return;
      }

      if (interaction.customId === 'unbanall_cancel') {
        await interaction.update({ content: '✅ Unban All wurde abgebrochen.', components: [] });
        return;
      }

      if (interaction.customId.startsWith('giveaway_join:')) {
        if (!interaction.inGuild()) return;
        const messageId = interaction.customId.split(':')[1];
        const giveaway = data.giveaways?.[messageId];
        if (!giveaway || giveaway.ended || giveaway.endAt <= Date.now()) {
          await interaction.reply({ content: '❌ Dieses Giveaway ist bereits beendet.', ephemeral: true });
          if (giveaway && !giveaway.ended) await finishGiveaway(interaction.guild, data, messageId).catch(() => {});
          return;
        }
        if (giveaway.requiredRoleId && !interaction.member.roles.cache.has(giveaway.requiredRoleId)) {
          await interaction.reply({ content: `❌ Du brauchst <@&${giveaway.requiredRoleId}>, um teilzunehmen.`, ephemeral: true, allowedMentions: { parse: [] } });
          return;
        }
        if (!Array.isArray(giveaway.participants)) giveaway.participants = [];
        const already = giveaway.participants.includes(interaction.user.id);
        giveaway.participants = already
          ? giveaway.participants.filter(id => id !== interaction.user.id)
          : [...giveaway.participants, interaction.user.id];
        saveData(data);
        await interaction.update(giveawayPayload(giveaway));
        await interaction.followUp({ content: already ? '✅ Du nimmst nicht mehr am Giveaway teil.' : '🎉 Du nimmst jetzt am Giveaway teil!', ephemeral: true });
        return;
      }

      if (interaction.customId.startsWith('application_open:')) {
        const type = interaction.customId.split(':')[1];
        if (!APPLICATION_TYPES[type]) {
          await interaction.reply({ content: '❌ Unbekannte Bewerbungsart.', ephemeral: true });
          return;
        }
        const duplicate = Object.values(data.applications).find(application => application.userId === interaction.user.id && application.type === type && application.status === 'open');
        if (duplicate) {
          await interaction.reply({ content: `❌ Du hast bereits eine offene Bewerbung dieser Art. ID: \`${duplicate.id}\``, ephemeral: true });
          return;
        }

        const modal = new ModalBuilder()
          .setCustomId(`application_submit:${type}`)
          .setTitle(APPLICATION_TYPES[type].slice(0, 45));
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('application_age').setLabel('Dein Alter').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(3)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('application_experience').setLabel('Deine Erfahrung').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('application_motivation').setLabel('Warum möchtest du dich bewerben?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('application_about').setLabel('Über dich / zusätzliche Informationen').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)),
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId.startsWith('application_decide:')) {
        if (!canUseTeamTools(interaction.member, data)) {
          await interaction.reply({ content: '❌ Du darfst Bewerbungen nicht auswerten.', ephemeral: true });
          return;
        }
        const [, decision, applicationId] = interaction.customId.split(':');
        const application = data.applications[applicationId];
        if (!application || !['accepted', 'rejected'].includes(decision)) {
          await interaction.reply({ content: '❌ Bewerbung nicht gefunden.', ephemeral: true });
          return;
        }
        if (application.status !== 'open') {
          await interaction.reply({ content: '❌ Diese Bewerbung wurde bereits ausgewertet.', ephemeral: true });
          return;
        }

        application.status = decision;
        application.reviewedBy = interaction.user.id;
        application.reviewedAt = Date.now();
        saveData(data);

        if (decision === 'accepted' && data.config.applicationAcceptedRoleId) {
          const applicantMember = await interaction.guild.members.fetch(application.userId).catch(() => null);
          if (applicantMember) await applicantMember.roles.add(data.config.applicationAcceptedRoleId).catch(() => {});
        }

        await interaction.update(applicationReviewPayload(application));
        const applicant = await client.users.fetch(application.userId).catch(() => null);
        if (applicant) {
          await applicant.send(`Deine **${APPLICATION_TYPES[application.type]}** auf **${interaction.guild.name}** wurde ${decision === 'accepted' ? '✅ angenommen' : '❌ abgelehnt'}.`).catch(() => {});
        }
        await logEvent(interaction.guild, data, '📨 Bewerbung ausgewertet', `<@${interaction.user.id}> hat die Bewerbung von <@${application.userId}> ${decision === 'accepted' ? 'angenommen' : 'abgelehnt'}.`);
        return;
      }

      if (interaction.customId.startsWith('selfrole:')) {
        const roleId = interaction.customId.split(':')[1];
        const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
        const botMember = interaction.guild.members.me;
        if (!role || role.id === interaction.guild.id || role.managed || !botMember || botMember.roles.highest.comparePositionTo(role) <= 0) {
          await interaction.reply({ content: '❌ Diese Rolle kann der Bot nicht vergeben. Prüfe die Rollen-Reihenfolge.', ephemeral: true });
          return;
        }
        const hasRole = interaction.member.roles.cache.has(role.id);
        if (hasRole) await interaction.member.roles.remove(role);
        else await interaction.member.roles.add(role);
        await interaction.reply({ content: hasRole ? `➖ <@&${role.id}> wurde entfernt.` : `✅ <@&${role.id}> wurde hinzugefügt.`, ephemeral: true, allowedMentions: { parse: [] } });
        return;
      }

      if (interaction.customId.startsWith('community_event_join:')) {
        const eventId = interaction.customId.split(':')[1];
        const event = data.events[eventId];
        if (!event || event.cancelled || event.started || event.startAt <= Date.now()) {
          await interaction.reply({ content: '❌ Die Teilnahme an diesem Event ist geschlossen.', ephemeral: true });
          return;
        }
        if (!Array.isArray(event.participants)) event.participants = [];
        const joined = event.participants.includes(interaction.user.id);
        event.participants = joined
          ? event.participants.filter(id => id !== interaction.user.id)
          : [...event.participants, interaction.user.id];
        saveData(data);
        await interaction.update(communityEventPayload(event));
        await interaction.followUp({ content: joined ? '✅ Du nimmst nicht mehr teil.' : '🙋 Du nimmst am Event teil!', ephemeral: true });
        return;
      }

      if (interaction.customId.startsWith('social_delete_yes:')) {
        const [, userId, requesterId] = interaction.customId.split(':');
        if (interaction.user.id !== requesterId) {
          await interaction.reply({ content: '❌ Diese Bestätigung gehört nicht dir.', ephemeral: true });
          return;
        }
        if (!canDeleteSocials(interaction.member, data)) {
          await interaction.update({ content: '❌ Du darfst keine Socials löschen.', components: [] });
          return;
        }
        const before = data.socials.members.length;
        data.socials.members = data.socials.members.filter(x => x.userId !== userId);
        if (before === data.socials.members.length) {
          await interaction.update({ content: '❌ Diese Person ist nicht eingetragen.', components: [] });
          return;
        }
        saveData(data);
        await updateSocialPanel(interaction.guild, data);
        await socialAudit(interaction.guild, data, '🗑️ Socials gelöscht', `<@${interaction.user.id}> hat <@${userId}> vollständig entfernt.`);
        await interaction.update({ content: `✅ <@${userId}> wurde aus den Socials entfernt.`, components: [], allowedMentions: { parse: [] } });
        return;
      }

      if (interaction.customId === 'social_delete_no') {
        await interaction.update({ content: '✅ Löschen abgebrochen.', components: [] });
        return;
      }
    }

    // ---------- MODALS ----------
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'verify_math_modal') {
        const key = `${interaction.guildId}:${interaction.user.id}`;
        const challenge = verifyChallenges.get(key);
        verifyChallenges.delete(key);
        if (!challenge || challenge.expiresAt < Date.now()) {
          await interaction.reply({ content: '❌ Die Aufgabe ist abgelaufen. Bitte erneut auf Verifizieren drücken.', ephemeral: true });
          return;
        }
        const answer = Number(interaction.fields.getTextInputValue('answer').trim());
        if (answer !== challenge.answer) {
          await interaction.reply({ content: '❌ Falsche Antwort. Versuch es erneut.', ephemeral: true });
          return;
        }
        if (!data.config.verifiedRoleId) {
          await interaction.reply({ content: '❌ Es wurde noch keine Verified-Rolle eingerichtet.', ephemeral: true });
          return;
        }
        await interaction.member.roles.add(data.config.verifiedRoleId);
        if (data.config.unverifiedRoleId) await interaction.member.roles.remove(data.config.unverifiedRoleId).catch(() => {});
        await interaction.reply({ content: '✅ Du wurdest erfolgreich verifiziert!', ephemeral: true });
        await logEvent(interaction.guild, data, '✅ Verifizierung', `<@${interaction.user.id}> wurde verifiziert.`);
        return;
      }

      if (interaction.customId.startsWith('custom_embed_modal:')) {
        if (!canAnnounce(interaction.member, data)) {
          await interaction.reply({ content: '❌ Du darfst keine Embed-Nachrichten erstellen.', ephemeral: true });
          return;
        }

        const [, channelId, everyoneFlag, requesterId] = interaction.customId.split(':');
        if (interaction.user.id !== requesterId) {
          await interaction.reply({ content: '❌ Dieses Formular gehört nicht dir.', ephemeral: true });
          return;
        }

        const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased()) {
          await interaction.reply({ content: '❌ Der Ziel-Channel wurde nicht gefunden.', ephemeral: true });
          return;
        }

        const title = interaction.fields.getTextInputValue('embed_title').trim();
        const text = interaction.fields.getTextInputValue('embed_text').trim();
        const colorRaw = interaction.fields.getTextInputValue('embed_color').trim();
        const footer = interaction.fields.getTextInputValue('embed_footer').trim();
        const imageRaw = interaction.fields.getTextInputValue('embed_image').trim();

        const color = parseEmbedColor(colorRaw);
        if (color === null) {
          await interaction.reply({ content: '❌ Ungültige Farbe. Nutze z. B. `schwarz`, `rot`, `lila` oder `#5865F2`.', ephemeral: true });
          return;
        }

        let imageUrl = null;
        if (imageRaw) {
          imageUrl = normalizeUrl(imageRaw);
          if (!imageUrl) {
            await interaction.reply({ content: '❌ Die Bild-URL ist ungültig.', ephemeral: true });
            return;
          }
        }

        const embed = new EmbedBuilder()
          .setColor(color)
          .setTitle(title)
          .setDescription(text)
          .setTimestamp();
        if (footer) embed.setFooter({ text: footer });
        if (imageUrl) embed.setImage(imageUrl);

        const everyone = everyoneFlag === '1';
        await channel.send({
          content: everyone ? '@everyone' : undefined,
          embeds: [embed],
          allowedMentions: everyone ? { parse: ['everyone'] } : { parse: [] },
        });

        await interaction.reply({ content: `✅ Embed wurde in <#${channel.id}> gesendet.`, ephemeral: true });
        await logEvent(interaction.guild, data, '📝 Embed gesendet', `<@${interaction.user.id}> hat ein Embed in <#${channel.id}> gesendet.`);
        return;
      }

      if (interaction.customId.startsWith('application_submit:')) {
        const type = interaction.customId.split(':')[1];
        if (!APPLICATION_TYPES[type]) {
          await interaction.reply({ content: '❌ Unbekannte Bewerbungsart.', ephemeral: true });
          return;
        }
        const reviewChannel = data.config.applicationReviewChannelId
          ? await interaction.guild.channels.fetch(data.config.applicationReviewChannelId).catch(() => null)
          : null;
        if (!reviewChannel?.isTextBased()) {
          await interaction.reply({ content: '❌ Der Auswertungs-Channel wurde nicht gefunden. Bitte das Bewerbungs-Panel neu erstellen.', ephemeral: true });
          return;
        }

        const application = {
          id: createShortId('a'),
          guildId: interaction.guild.id,
          userId: interaction.user.id,
          type,
          age: interaction.fields.getTextInputValue('application_age').trim(),
          experience: interaction.fields.getTextInputValue('application_experience').trim(),
          motivation: interaction.fields.getTextInputValue('application_motivation').trim(),
          about: interaction.fields.getTextInputValue('application_about').trim(),
          status: 'open',
          createdAt: Date.now(),
        };
        const reviewMessage = await reviewChannel.send(applicationReviewPayload(application));
        application.channelId = reviewChannel.id;
        application.messageId = reviewMessage.id;
        data.applications[application.id] = application;
        saveData(data);
        await interaction.reply({ content: `✅ Deine Bewerbung wurde gesendet. **ID:** \`${application.id}\``, ephemeral: true });
        await logEvent(interaction.guild, data, '📨 Neue Bewerbung', `<@${interaction.user.id}> hat eine **${APPLICATION_TYPES[type]}** eingereicht.`);
        return;
      }

      if (interaction.customId === 'socials_add_modal' || interaction.customId === 'socials_edit_modal') {
        if (!canManageSocials(interaction.member, data)) {
          await interaction.reply({ content: '❌ Du darfst die Socials nicht verwalten.', ephemeral: true });
          return;
        }
        const userId = interaction.fields.getTextInputValue('discord_id').trim();
        const links = parseLinks(interaction.fields.getTextInputValue('links'));
        if (!isValidDiscordId(userId)) {
          await interaction.reply({ content: '❌ Ungültige Discord-ID.', ephemeral: true });
          return;
        }
        if (!links.length) {
          await interaction.reply({ content: '❌ Kein gültiger http/https-Link gefunden.', ephemeral: true });
          return;
        }
        const member = await interaction.guild.members.fetch(userId).catch(() => null);
        if (!member) {
          await interaction.reply({ content: '❌ Diese Discord-ID gehört zu keinem Mitglied auf dem Server.', ephemeral: true });
          return;
        }
        let entry = findSocial(data, userId);
        if (interaction.customId === 'socials_add_modal') {
          if (!entry) {
            entry = { userId, links: [], addedAt: new Date().toISOString() };
            data.socials.members.push(entry);
          }
          entry.links = [...new Set([...entry.links, ...links])].slice(0, MAX_SOCIAL_LINKS);
        } else {
          if (!entry) {
            entry = { userId, links: [], addedAt: new Date().toISOString() };
            data.socials.members.push(entry);
          }
          entry.links = links.slice(0, MAX_SOCIAL_LINKS);
        }
        saveData(data);
        await updateSocialPanel(interaction.guild, data);
        await socialAudit(interaction.guild, data, interaction.customId === 'socials_add_modal' ? '➕ Socials hinzugefügt' : '✏️ Socials bearbeitet', `<@${interaction.user.id}> hat die Socials von <@${userId}> geändert.`);
        await interaction.reply({ content: `✅ Socials von <@${userId}> aktualisiert.`, ephemeral: true, allowedMentions: { parse: [] } });
        return;
      }
    }

    // ---------- SLASH COMMANDS ----------
    if (!interaction.isChatInputCommand()) return;
    if (!interaction.inGuild()) {
      await interaction.reply({ content: '❌ Dieser Befehl funktioniert nur auf einem Server.', ephemeral: true });
      return;
    }

    const command = interaction.commandName;

    if (command === 'help') {
      const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setTitle('🤖 Community Bot • Hilfe')
        .setDescription('Die wichtigsten Funktionen des Bots:')
        .addFields(
          { name: '🌐 Socials', value: '`/socials` `/editsocials` `/removesocial` `/deletesocials` `/socialinfo` `/sociallist` `/mysocials` `/refreshsocials`' },
          { name: '🎫 Tickets & Verify', value: '`/ticketpanel` `/ticket` `/verificationpanel`' },
          { name: '🛡️ Moderation', value: '`/warn` `/warnings` `/clearwarnings` `/timeout` `/untimeout` `/kick` `/ban` `/unban` `/unbanall` `/purge` `/slowmode` `/lock` `/unlock`' },
          { name: '📣 Community', value: '`/announce` `/embed` `/poll` `/suggest` `/giveaway`' },
          { name: 'ℹ️ Info', value: '`/serverinfo` `/userinfo` `/avatar` `/ping`' },
          { name: '📨 Bewerbungen & Rollen', value: '`/applicationpanel` `/applicationlist` `/rolepanel`' },
          { name: '🛡️ Schutz & Voice', value: '`/automod` `/tempvoice` `/voice`' },
          { name: '🏆 Level & Invites', value: '`/rank` `/leaderboard` `/levelrole` `/levelsystem` `/invites` `/inviteleaderboard`' },
          { name: '📅 Events & Team', value: '`/event` `/duty` `/dutystats` `/dutyleaderboard`' },
          { name: '🧩 Eigene Commands', value: '`/customcommand` oder gespeicherte Befehle mit `!name`' },
          { name: '⚙️ Einrichtung', value: '`/setup channel` `/setup role` `/setup tickets` `/setup show`' },
        );
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (command === 'ping') {
      await interaction.reply({ content: `🏓 Pong! **${Math.round(client.ws.ping)} ms**`, ephemeral: true });
      return;
    }

    if (command === 'serverinfo') {
      const guild = interaction.guild;
      const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setTitle(`ℹ️ ${guild.name}`)
        .setThumbnail(guild.iconURL({ size: 256 }))
        .addFields(
          { name: 'Mitglieder', value: String(guild.memberCount), inline: true },
          { name: 'Channels', value: String(guild.channels.cache.size), inline: true },
          { name: 'Rollen', value: String(guild.roles.cache.size), inline: true },
          { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
          { name: 'Server-ID', value: guild.id, inline: true },
          { name: 'Erstellt', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>` },
        );
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (command === 'userinfo') {
      const user = interaction.options.getUser('user') || interaction.user;
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      const roles = member ? member.roles.cache.filter(r => r.id !== interaction.guild.id).sort((a, b) => b.position - a.position).first(10).map(r => `<@&${r.id}>`).join(' ') : '—';
      const embed = new EmbedBuilder()
        .setColor(0x111111)
        .setTitle(`👤 ${user.tag}`)
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: 'User-ID', value: user.id, inline: true },
          { name: 'Account erstellt', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>` },
          { name: 'Server beigetreten', value: member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : '—' },
          { name: 'Rollen', value: roles || 'Keine' },
        );
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (command === 'avatar') {
      const user = interaction.options.getUser('user') || interaction.user;
      const url = user.displayAvatarURL({ size: 1024, extension: 'png' });
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x111111).setTitle(`🖼️ Avatar • ${user.username}`).setImage(url)] });
      return;
    }

    if (command === 'setup') {
      if (!canSetup(interaction.member)) {
        await interaction.reply({ content: '❌ Du brauchst **Server verwalten** oder Administrator.', ephemeral: true });
        return;
      }
      const sub = interaction.options.getSubcommand();
      if (sub === 'channel') {
        const type = interaction.options.getString('typ');
        const channel = interaction.options.getChannel('channel');
        const map = {
          welcome: 'welcomeChannelId',
          leave: 'leaveChannelId',
          logs: 'logChannelId',
          suggestions: 'suggestionsChannelId',
          giveaways: 'giveawayChannelId',
          socials: 'socialsChannelId',
          socialaudit: 'socialAuditChannelId',
          applications: 'applicationReviewChannelId',
          transcripts: 'ticketTranscriptChannelId',
          automodlogs: 'automodLogChannelId',
        };
        data.config[map[type]] = channel.id;
        saveData(data);
        if (type === 'socials') await updateSocialPanel(interaction.guild, data).catch(() => {});
        await interaction.reply({ content: `✅ **${type}** wurde auf <#${channel.id}> gesetzt.`, ephemeral: true });
        return;
      }
      if (sub === 'role') {
        const type = interaction.options.getString('typ');
        const role = interaction.options.getRole('rolle');
        const map = {
          verified: 'verifiedRoleId',
          unverified: 'unverifiedRoleId',
          support: 'supportRoleId',
          moderator: 'moderatorRoleId',
          announcement: 'announcementRoleId',
          socialadmin: 'socialAdminRoleId',
          socialdelete: 'socialDeleteRoleId',
          applicationaccepted: 'applicationAcceptedRoleId',
        };
        data.config[map[type]] = role.id;
        saveData(data);
        await interaction.reply({ content: `✅ **${type}** wurde auf <@&${role.id}> gesetzt.`, ephemeral: true, allowedMentions: { parse: [] } });
        return;
      }
      if (sub === 'tickets') {
        const category = interaction.options.getChannel('kategorie');
        const role = interaction.options.getRole('support_rolle');
        data.config.ticketCategoryId = category.id;
        data.config.supportRoleId = role.id;
        saveData(data);
        await interaction.reply({ content: `✅ Tickets: Kategorie **${category.name}**, Support <@&${role.id}>.`, ephemeral: true, allowedMentions: { parse: [] } });
        return;
      }
      if (sub === 'show') {
        const c = data.config;
        const fmtCh = id => id ? `<#${id}>` : 'Nicht gesetzt';
        const fmtRole = id => id ? `<@&${id}>` : 'Nicht gesetzt';
        const embed = new EmbedBuilder().setColor(0x111111).setTitle('⚙️ Bot-Konfiguration').addFields(
          { name: 'Channels', value: `Welcome: ${fmtCh(c.welcomeChannelId)}\nLeave: ${fmtCh(c.leaveChannelId)}\nLogs: ${fmtCh(c.logChannelId)}\nSuggestions: ${fmtCh(c.suggestionsChannelId)}\nGiveaways: ${fmtCh(c.giveawayChannelId)}\nSocials: ${fmtCh(c.socialsChannelId)}\nSocial Audit: ${fmtCh(c.socialAuditChannelId)}\nBewerbungen: ${fmtCh(c.applicationReviewChannelId)}\nTranskripte: ${fmtCh(c.ticketTranscriptChannelId)}\nAutoMod: ${fmtCh(c.automodLogChannelId)}` },
          { name: 'Rollen', value: `Verified: ${fmtRole(c.verifiedRoleId)}\nUnverified: ${fmtRole(c.unverifiedRoleId)}\nSupport: ${fmtRole(c.supportRoleId)}\nModerator: ${fmtRole(c.moderatorRoleId)}\nAnnouncements: ${fmtRole(c.announcementRoleId)}\nSocial Admin: ${fmtRole(c.socialAdminRoleId)}\nSocial Delete: ${fmtRole(c.socialDeleteRoleId)}\nBewerbung angenommen: ${fmtRole(c.applicationAcceptedRoleId)}` },
          { name: 'Tickets & Temp Voice', value: `Ticket-Kategorie: ${c.ticketCategoryId ? `<#${c.ticketCategoryId}>` : 'Nicht gesetzt'}\nVoice-Lobby: ${fmtCh(c.tempVoiceLobbyId)}\nVoice-Kategorie: ${fmtCh(c.tempVoiceCategoryId)}` },
        );
        await interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: { parse: [] } });
        return;
      }
    }

    if (command === 'verificationpanel') {
      if (!canSetup(interaction.member)) {
        await interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
        return;
      }
      if (!data.config.verifiedRoleId) {
        await interaction.reply({ content: '❌ Erst `/setup role typ:Verified` ausführen.', ephemeral: true });
        return;
      }
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify_start').setLabel('Verifizieren').setEmoji('✅').setStyle(ButtonStyle.Success));
      await interaction.channel.send({ embeds: [new EmbedBuilder().setColor(0x111111).setTitle('✅ Verifizierung').setDescription('Drücke auf **Verifizieren** und löse die kleine Rechenaufgabe.')], components: [row] });
      await interaction.reply({ content: '✅ Verifizierungs-Panel erstellt.', ephemeral: true });
      return;
    }

    if (command === 'ticketpanel') {
      if (!canSetup(interaction.member)) {
        await interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
        return;
      }
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_create').setLabel('Ticket erstellen').setEmoji('🎫').setStyle(ButtonStyle.Primary));
      await interaction.channel.send({ embeds: [new EmbedBuilder().setColor(0x111111).setTitle('🎫 Support').setDescription('Benötigst du Hilfe? Drücke unten auf **Ticket erstellen**.')], components: [row] });
      await interaction.reply({ content: '✅ Ticket-Panel erstellt.', ephemeral: true });
      return;
    }

    if (command === 'applicationpanel') {
      if (!canSetup(interaction.member)) {
        await interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
        return;
      }
      const type = interaction.options.getString('typ');
      const reviewChannel = interaction.options.getChannel('auswertung');
      data.config.applicationReviewChannelId = reviewChannel.id;
      saveData(data);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`application_open:${type}`).setLabel('Jetzt bewerben').setEmoji('📨').setStyle(ButtonStyle.Primary),
      );
      const embed = new EmbedBuilder()
        .setColor(0x8b5cf6)
        .setTitle(`📨 ${APPLICATION_TYPES[type]}`)
        .setDescription('Drücke unten auf **Jetzt bewerben** und fülle das Formular vollständig aus. Das Team erhält deine Bewerbung anschließend automatisch.')
        .setFooter({ text: interaction.guild.name });
      await interaction.channel.send({ embeds: [embed], components: [row] });
      await interaction.reply({ content: `✅ Bewerbungs-Panel erstellt. Auswertung in <#${reviewChannel.id}>.`, ephemeral: true });
      return;
    }

    if (command === 'applicationlist') {
      if (!canUseTeamTools(interaction.member, data)) {
        await interaction.reply({ content: '❌ Du darfst Bewerbungen nicht sehen.', ephemeral: true });
        return;
      }
      const open = Object.values(data.applications)
        .filter(application => application.guildId === interaction.guild.id && application.status === 'open')
        .sort((a, b) => a.createdAt - b.createdAt);
      const text = open.length
        ? open.slice(0, 25).map(application => `• \`${application.id}\` • <@${application.userId}> • **${APPLICATION_TYPES[application.type]}** • <t:${Math.floor(application.createdAt / 1000)}:R>`).join('\n')
        : '*Keine offenen Bewerbungen.*';
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle('📨 Offene Bewerbungen').setDescription(text)], ephemeral: true, allowedMentions: { parse: [] } });
      return;
    }

    if (command === 'rolepanel') {
      if (!canSetup(interaction.member)) {
        await interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
        return;
      }
      const roles = ['rolle1', 'rolle2', 'rolle3', 'rolle4', 'rolle5']
        .map(name => interaction.options.getRole(name))
        .filter(Boolean);
      const botMember = interaction.guild.members.me;
      const invalid = roles.find(role => role.id === interaction.guild.id || role.managed || !botMember || botMember.roles.highest.comparePositionTo(role) <= 0);
      if (invalid) {
        await interaction.reply({ content: `❌ Die Rolle **${invalid.name}** kann der Bot nicht vergeben. Schiebe die Bot-Rolle weiter nach oben.`, ephemeral: true });
        return;
      }
      const row = new ActionRowBuilder();
      for (const role of roles) {
        row.addComponents(new ButtonBuilder().setCustomId(`selfrole:${role.id}`).setLabel(role.name.slice(0, 80)).setEmoji('🏷️').setStyle(ButtonStyle.Secondary));
      }
      const title = interaction.options.getString('titel');
      await interaction.channel.send({
        embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle(`🏷️ ${title}`).setDescription('Klicke auf eine Rolle, um sie hinzuzufügen oder wieder zu entfernen.')],
        components: [row],
      });
      await interaction.reply({ content: '✅ Rollen-Panel erstellt.', ephemeral: true });
      return;
    }

    if (command === 'ticket') {
      if (!isTicketChannel(interaction.channel)) {
        await interaction.reply({ content: '❌ Dieser Befehl funktioniert nur in einem Ticket.', ephemeral: true });
        return;
      }
      if (!canManageTickets(interaction.member, data)) {
        await interaction.reply({ content: '❌ Du darfst Tickets nicht verwalten.', ephemeral: true });
        return;
      }
      const sub = interaction.options.getSubcommand();
      if (sub === 'add') {
        const user = interaction.options.getUser('user');
        await interaction.channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
        await interaction.reply({ content: `✅ <@${user.id}> wurde hinzugefügt.` });
        return;
      }
      if (sub === 'remove') {
        const user = interaction.options.getUser('user');
        await interaction.channel.permissionOverwrites.delete(user.id).catch(() => {});
        await interaction.reply({ content: `✅ <@${user.id}> wurde entfernt.` });
        return;
      }
      if (sub === 'close') {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('ticket_close_confirm').setLabel('Ja, schließen').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('ticket_close_cancel').setLabel('Abbrechen').setStyle(ButtonStyle.Secondary),
        );
        await interaction.reply({ content: 'Ticket wirklich schließen?', components: [row], ephemeral: true });
        return;
      }
    }

    if (command === 'automod') {
      if (!canSetup(interaction.member)) {
        await interaction.reply({ content: '❌ Du brauchst **Server verwalten** oder Administrator.', ephemeral: true });
        return;
      }
      const sub = interaction.options.getSubcommand();
      if (sub === 'enable') {
        const logChannel = interaction.options.getChannel('log_channel');
        const blockInvites = interaction.options.getBoolean('block_invites');
        const maxMentions = interaction.options.getInteger('max_mentions');
        const maxMessages = interaction.options.getInteger('max_messages');
        const accountAge = interaction.options.getInteger('account_age');
        data.automod.enabled = true;
        if (logChannel) data.config.automodLogChannelId = logChannel.id;
        if (blockInvites !== null) data.automod.blockInvites = blockInvites;
        if (maxMentions !== null) data.automod.maxMentions = maxMentions;
        if (maxMessages !== null) data.automod.maxMessages = maxMessages;
        if (accountAge !== null) data.automod.minAccountAgeHours = accountAge;
        saveData(data);
        await interaction.reply({ content: '✅ Anti-Spam und Anti-Raid wurden aktiviert.', ephemeral: true });
        return;
      }
      if (sub === 'disable') {
        data.automod.enabled = false;
        data.automod.raidModeUntil = 0;
        saveData(data);
        await interaction.reply({ content: '✅ AutoMod wurde deaktiviert.', ephemeral: true });
        return;
      }
      const settings = data.automod;
      const embed = new EmbedBuilder().setColor(settings.enabled ? 0x2ecc71 : 0xe74c3c).setTitle('🛡️ AutoMod-Status').addFields(
        { name: 'Status', value: settings.enabled ? '✅ Aktiv' : '❌ Inaktiv', inline: true },
        { name: 'Invite-Filter', value: settings.blockInvites ? 'Aktiv' : 'Inaktiv', inline: true },
        { name: 'Mention-Limit', value: String(settings.maxMentions), inline: true },
        { name: 'Spam-Limit', value: `${settings.maxMessages} Nachrichten / ${Math.round(settings.spamWindowMs / 1000)}s`, inline: true },
        { name: 'Account-Warnung', value: `Unter ${settings.minAccountAgeHours} Stunden`, inline: true },
        { name: 'Log-Channel', value: data.config.automodLogChannelId ? `<#${data.config.automodLogChannelId}>` : 'Normaler Log-Channel', inline: true },
      );
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (command === 'tempvoice') {
      if (!canSetup(interaction.member)) {
        await interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
        return;
      }
      const sub = interaction.options.getSubcommand();
      if (sub === 'setup') {
        const lobby = interaction.options.getChannel('lobby');
        const category = interaction.options.getChannel('kategorie');
        data.config.tempVoiceLobbyId = lobby.id;
        data.config.tempVoiceCategoryId = category.id;
        data.config.tempVoiceUserLimit = interaction.options.getInteger('limit') || 0;
        saveData(data);
        await interaction.reply({ content: `✅ Temp Voice eingerichtet: <#${lobby.id}> → **${category.name}**.`, ephemeral: true });
        return;
      }
      if (sub === 'disable') {
        data.config.tempVoiceLobbyId = null;
        data.config.tempVoiceCategoryId = null;
        saveData(data);
        await interaction.reply({ content: '✅ Temp Voice wurde deaktiviert. Bestehende Räume bleiben bis sie leer sind.', ephemeral: true });
        return;
      }
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle('🎧 Temp-Voice-Status').setDescription(
          `**Lobby:** ${data.config.tempVoiceLobbyId ? `<#${data.config.tempVoiceLobbyId}>` : 'Nicht gesetzt'}\n**Kategorie:** ${data.config.tempVoiceCategoryId ? `<#${data.config.tempVoiceCategoryId}>` : 'Nicht gesetzt'}\n**Standard-Limit:** ${data.config.tempVoiceUserLimit || 'Unbegrenzt'}`,
        )],
        ephemeral: true,
      });
      return;
    }

    if (command === 'voice') {
      const voiceChannel = interaction.member.voice.channel;
      const tempEntry = voiceChannel ? data.tempVoices[voiceChannel.id] : null;
      if (!voiceChannel || !tempEntry || tempEntry.ownerId !== interaction.user.id) {
        await interaction.reply({ content: '❌ Du musst Besitzer eines temporären Sprachkanals sein.', ephemeral: true });
        return;
      }
      const sub = interaction.options.getSubcommand();
      if (sub === 'name') {
        const name = interaction.options.getString('name').trim();
        await voiceChannel.setName(name, `Temp Voice geändert von ${interaction.user.tag}`);
        await interaction.reply({ content: `✅ Raum umbenannt in **${name}**.`, ephemeral: true });
        return;
      }
      if (sub === 'limit') {
        const limit = interaction.options.getInteger('anzahl');
        await voiceChannel.setUserLimit(limit, `Temp Voice geändert von ${interaction.user.tag}`);
        await interaction.reply({ content: `✅ Nutzerlimit: **${limit || 'Unbegrenzt'}**.`, ephemeral: true });
        return;
      }
      if (sub === 'lock' || sub === 'unlock') {
        await voiceChannel.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: sub === 'lock' ? false : null });
        await interaction.reply({ content: sub === 'lock' ? '🔒 Dein Raum wurde gesperrt.' : '🔓 Dein Raum wurde geöffnet.', ephemeral: true });
        return;
      }
      const user = interaction.options.getUser('user');
      if (sub === 'permit') {
        await voiceChannel.permissionOverwrites.edit(user.id, { ViewChannel: true, Connect: true });
        await interaction.reply({ content: `✅ <@${user.id}> darf deinen Raum betreten.`, ephemeral: true });
        return;
      }
      if (sub === 'reject') {
        await voiceChannel.permissionOverwrites.edit(user.id, { Connect: false });
        const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (targetMember?.voice.channelId === voiceChannel.id) await targetMember.voice.setChannel(null).catch(() => {});
        await interaction.reply({ content: `✅ <@${user.id}> wurde aus deinem Raum entfernt und gesperrt.`, ephemeral: true });
        return;
      }
    }

    if (command === 'rank') {
      const user = interaction.options.getUser('user') || interaction.user;
      await interaction.reply({ embeds: [rankEmbed(user, data)] });
      return;
    }

    if (command === 'leaderboard') {
      const top = Object.entries(data.levels)
        .sort(([, a], [, b]) => (b.xp || 0) - (a.xp || 0))
        .slice(0, 10);
      const text = top.length
        ? top.map(([userId, record], index) => `**${index + 1}.** <@${userId}> • Level **${calculateLevel(record.xp || 0)}** • ${record.xp || 0} XP`).join('\n')
        : '*Noch keine XP gesammelt.*';
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle('🏆 Level-Bestenliste').setDescription(text)], allowedMentions: { parse: [] } });
      return;
    }

    if (command === 'levelrole') {
      if (!canSetup(interaction.member)) {
        await interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
        return;
      }
      const sub = interaction.options.getSubcommand();
      if (sub === 'set') {
        const level = interaction.options.getInteger('level');
        const role = interaction.options.getRole('rolle');
        const botMember = interaction.guild.members.me;
        if (role.managed || role.id === interaction.guild.id || !botMember || botMember.roles.highest.comparePositionTo(role) <= 0) {
          await interaction.reply({ content: '❌ Diese Rolle kann der Bot nicht vergeben. Prüfe die Rollen-Reihenfolge.', ephemeral: true });
          return;
        }
        data.levelRoles[String(level)] = role.id;
        saveData(data);
        await interaction.reply({ content: `✅ Auf Level **${level}** wird <@&${role.id}> vergeben.`, ephemeral: true, allowedMentions: { parse: [] } });
        return;
      }
      if (sub === 'remove') {
        const level = interaction.options.getInteger('level');
        delete data.levelRoles[String(level)];
        saveData(data);
        await interaction.reply({ content: `✅ Level-Rolle für Level **${level}** entfernt.`, ephemeral: true });
        return;
      }
      const entries = Object.entries(data.levelRoles).sort((a, b) => Number(a[0]) - Number(b[0]));
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle('🏷️ Level-Rollen').setDescription(entries.length ? entries.map(([level, roleId]) => `Level **${level}** → <@&${roleId}>`).join('\n') : '*Keine Level-Rollen eingerichtet.*')],
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (command === 'levelsystem') {
      if (!canSetup(interaction.member)) {
        await interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
        return;
      }
      const sub = interaction.options.getSubcommand();
      if (sub === 'enable' || sub === 'disable') {
        data.config.levelSystemEnabled = sub === 'enable';
        saveData(data);
      }
      await interaction.reply({ content: `🏆 Level-System ist **${data.config.levelSystemEnabled ? 'aktiv' : 'inaktiv'}**.`, ephemeral: true });
      return;
    }

    if (command === 'invites') {
      const user = interaction.options.getUser('user') || interaction.user;
      const stats = data.inviteStats[user.id] || { total: 0, active: 0, leaves: 0 };
      const embed = new EmbedBuilder()
        .setColor(0x8b5cf6)
        .setTitle(`🔗 Einladungen • ${user.username}`)
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: 'Gesamt', value: String(stats.total || 0), inline: true },
          { name: 'Aktiv', value: String(stats.active || 0), inline: true },
          { name: 'Verlassen', value: String(stats.leaves || 0), inline: true },
        );
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (command === 'inviteleaderboard') {
      const top = Object.entries(data.inviteStats)
        .sort(([, a], [, b]) => (b.active || 0) - (a.active || 0))
        .slice(0, 10);
      const text = top.length
        ? top.map(([userId, stats], index) => `**${index + 1}.** <@${userId}> • **${stats.active || 0} aktiv** • ${stats.total || 0} gesamt`).join('\n')
        : '*Noch keine Einladungen erfasst.*';
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle('🔗 Invite-Bestenliste').setDescription(text)], allowedMentions: { parse: [] } });
      return;
    }

    if (command === 'event') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'create') {
        if (!canAnnounce(interaction.member, data)) {
          await interaction.reply({ content: '❌ Du darfst keine Events erstellen.', ephemeral: true });
          return;
        }
        const duration = parseDuration(interaction.options.getString('in'));
        if (!duration) {
          await interaction.reply({ content: '❌ Ungültige Zeit. Nutze zum Beispiel `30m`, `2h` oder `3d`.', ephemeral: true });
          return;
        }
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const event = {
          id: createShortId('e'),
          guildId: interaction.guild.id,
          channelId: channel.id,
          name: interaction.options.getString('name').trim(),
          description: interaction.options.getString('beschreibung') || null,
          creatorId: interaction.user.id,
          createdAt: Date.now(),
          startAt: Date.now() + duration,
          participants: [interaction.user.id],
          reminders: {},
          started: false,
          cancelled: false,
        };
        const message = await channel.send({ embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle('📅 Event wird erstellt …')] });
        event.messageId = message.id;
        data.events[event.id] = event;
        saveData(data);
        await message.edit(communityEventPayload(event));
        await interaction.reply({ content: `✅ Event erstellt: ${message.url}\n**Event-ID:** \`${event.id}\``, ephemeral: true });
        return;
      }
      if (sub === 'list') {
        const events = Object.values(data.events)
          .filter(event => event.guildId === interaction.guild.id && !event.cancelled && !event.started)
          .sort((a, b) => a.startAt - b.startAt);
        const text = events.length
          ? events.slice(0, 20).map(event => `• \`${event.id}\` • **${event.name}** • <t:${Math.floor(event.startAt / 1000)}:R> • ${event.participants?.length || 0} Teilnehmer`).join('\n')
          : '*Keine geplanten Events.*';
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle('📅 Geplante Events').setDescription(text)] });
        return;
      }
      if (sub === 'cancel') {
        const eventId = interaction.options.getString('event_id').trim();
        const event = data.events[eventId];
        if (!event || event.guildId !== interaction.guild.id) {
          await interaction.reply({ content: '❌ Event nicht gefunden.', ephemeral: true });
          return;
        }
        if (event.creatorId !== interaction.user.id && !canAnnounce(interaction.member, data)) {
          await interaction.reply({ content: '❌ Du darfst dieses Event nicht absagen.', ephemeral: true });
          return;
        }
        event.cancelled = true;
        event.cancelledBy = interaction.user.id;
        saveData(data);
        const channel = await interaction.guild.channels.fetch(event.channelId).catch(() => null);
        const message = channel?.isTextBased() ? await channel.messages.fetch(event.messageId).catch(() => null) : null;
        if (message) await message.edit(communityEventPayload(event, true)).catch(() => {});
        if (channel?.isTextBased()) await channel.send(`❌ Das Event **${event.name}** wurde abgesagt.`).catch(() => {});
        await interaction.reply({ content: '✅ Event wurde abgesagt.', ephemeral: true });
        return;
      }
    }

    if (command === 'duty') {
      if (!canUseTeamTools(interaction.member, data)) {
        await interaction.reply({ content: '❌ Dieser Befehl ist nur für das Team.', ephemeral: true });
        return;
      }
      const sub = interaction.options.getSubcommand();
      const active = data.duty.active[interaction.user.id];
      if (sub === 'start') {
        if (active) {
          await interaction.reply({ content: `❌ Du bist bereits seit <t:${Math.floor(active.startedAt / 1000)}:R> im Dienst.`, ephemeral: true });
          return;
        }
        data.duty.active[interaction.user.id] = { startedAt: Date.now() };
        saveData(data);
        await interaction.reply({ content: '🟢 Dein Team-Dienst wurde gestartet.', ephemeral: true });
        return;
      }
      if (sub === 'stop') {
        if (!active) {
          await interaction.reply({ content: '❌ Du bist aktuell nicht im Dienst.', ephemeral: true });
          return;
        }
        const session = Date.now() - active.startedAt;
        data.duty.totals[interaction.user.id] = (data.duty.totals[interaction.user.id] || 0) + session;
        delete data.duty.active[interaction.user.id];
        saveData(data);
        await interaction.reply({ content: `🔴 Dienst beendet. Diese Sitzung: **${formatLongDuration(session)}**.`, ephemeral: true });
        return;
      }
      await interaction.reply({
        content: active
          ? `🟢 Du bist seit <t:${Math.floor(active.startedAt / 1000)}:R> im Dienst. Gesamt: **${formatLongDuration((data.duty.totals[interaction.user.id] || 0) + Date.now() - active.startedAt)}**.`
          : `🔴 Du bist nicht im Dienst. Gesamt: **${formatLongDuration(data.duty.totals[interaction.user.id] || 0)}**.`,
        ephemeral: true,
      });
      return;
    }

    if (command === 'dutystats') {
      const user = interaction.options.getUser('user') || interaction.user;
      if (user.id !== interaction.user.id && !canUseTeamTools(interaction.member, data)) {
        await interaction.reply({ content: '❌ Du darfst fremde Dienstzeiten nicht sehen.', ephemeral: true });
        return;
      }
      const active = data.duty.active[user.id];
      const total = (data.duty.totals[user.id] || 0) + (active ? Date.now() - active.startedAt : 0);
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(active ? 0x2ecc71 : 0x8b5cf6).setTitle(`⏱️ Dienstzeit • ${user.username}`).addFields(
          { name: 'Gesamtzeit', value: formatLongDuration(total), inline: true },
          { name: 'Status', value: active ? `🟢 Seit <t:${Math.floor(active.startedAt / 1000)}:R>` : '🔴 Nicht im Dienst', inline: true },
        )],
        ephemeral: true,
      });
      return;
    }

    if (command === 'dutyleaderboard') {
      if (!canUseTeamTools(interaction.member, data)) {
        await interaction.reply({ content: '❌ Dieser Befehl ist nur für das Team.', ephemeral: true });
        return;
      }
      const userIds = new Set([...Object.keys(data.duty.totals), ...Object.keys(data.duty.active)]);
      const top = [...userIds]
        .map(userId => [userId, (data.duty.totals[userId] || 0) + (data.duty.active[userId] ? Date.now() - data.duty.active[userId].startedAt : 0)])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      const text = top.length ? top.map(([userId, duration], index) => `**${index + 1}.** <@${userId}> • **${formatLongDuration(duration)}**`).join('\n') : '*Noch keine Dienstzeiten.*';
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle('⏱️ Team-Dienst Bestenliste').setDescription(text)], ephemeral: true, allowedMentions: { parse: [] } });
      return;
    }

    if (command === 'customcommand') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'add' || sub === 'remove') {
        if (!canSetup(interaction.member)) {
          await interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
          return;
        }
        const name = interaction.options.getString('name').trim().toLowerCase();
        if (!/^[a-z0-9_-]{1,32}$/.test(name)) {
          await interaction.reply({ content: '❌ Der Name darf nur Buchstaben, Zahlen, `_` und `-` enthalten.', ephemeral: true });
          return;
        }
        if (sub === 'add') {
          data.customCommands[name] = {
            response: interaction.options.getString('antwort'),
            updatedBy: interaction.user.id,
            updatedAt: Date.now(),
          };
          saveData(data);
          await interaction.reply({ content: `✅ Eigener Command **!${name}** gespeichert.`, ephemeral: true });
          return;
        }
        if (!data.customCommands[name]) {
          await interaction.reply({ content: '❌ Dieser Command existiert nicht.', ephemeral: true });
          return;
        }
        delete data.customCommands[name];
        saveData(data);
        await interaction.reply({ content: `✅ **!${name}** wurde gelöscht.`, ephemeral: true });
        return;
      }
      if (sub === 'list') {
        const names = Object.keys(data.customCommands).sort();
        await interaction.reply({
          embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle('🧩 Eigene Commands').setDescription(names.length ? names.map(name => `\`!${name}\``).join(' ') : '*Keine eigenen Commands gespeichert.*')],
          ephemeral: true,
        });
        return;
      }
      const name = interaction.options.getString('name').trim().toLowerCase();
      const custom = data.customCommands[name];
      if (!custom) {
        await interaction.reply({ content: '❌ Dieser Command existiert nicht.', ephemeral: true });
        return;
      }
      await interaction.reply({ content: renderCustomCommand(custom.response, interaction).slice(0, 2000), allowedMentions: { parse: [] } });
      return;
    }

    if (command === 'embed') {
      if (!canAnnounce(interaction.member, data)) {
        await interaction.reply({ content: '❌ Du darfst keine Embed-Nachrichten erstellen.', ephemeral: true });
        return;
      }

      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const everyone = interaction.options.getBoolean('everyone') || false;

      const modal = new ModalBuilder()
        .setCustomId(`custom_embed_modal:${channel.id}:${everyone ? '1' : '0'}:${interaction.user.id}`)
        .setTitle('Embed erstellen');

      const titleInput = new TextInputBuilder()
        .setCustomId('embed_title')
        .setLabel('Titel')
        .setPlaceholder('z. B. 📢 Information')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(256);

      const textInput = new TextInputBuilder()
        .setCustomId('embed_text')
        .setLabel('Nachricht')
        .setPlaceholder('Schreibe hier deine Nachricht ...')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(4000);

      const colorInput = new TextInputBuilder()
        .setCustomId('embed_color')
        .setLabel('Farbe (optional)')
        .setPlaceholder('schwarz, rot, lila oder #5865F2')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(20);

      const footerInput = new TextInputBuilder()
        .setCustomId('embed_footer')
        .setLabel('Footer (optional)')
        .setPlaceholder('z. B. Unfug Community')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(200);

      const imageInput = new TextInputBuilder()
        .setCustomId('embed_image')
        .setLabel('Bild-URL (optional)')
        .setPlaceholder('https://.../bild.png')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(1000);

      modal.addComponents(
        new ActionRowBuilder().addComponents(titleInput),
        new ActionRowBuilder().addComponents(textInput),
        new ActionRowBuilder().addComponents(colorInput),
        new ActionRowBuilder().addComponents(footerInput),
        new ActionRowBuilder().addComponents(imageInput),
      );

      await interaction.showModal(modal);
      return;
    }

    if (command === 'announce') {
      if (!canAnnounce(interaction.member, data)) {
        await interaction.reply({ content: '❌ Du darfst keine Ankündigungen senden.', ephemeral: true });
        return;
      }
      const title = interaction.options.getString('titel');
      const text = interaction.options.getString('text');
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const everyone = interaction.options.getBoolean('everyone') || false;
      await channel.send({
        content: everyone ? '@everyone' : undefined,
        embeds: [new EmbedBuilder().setColor(0x111111).setTitle(`📢 ${title}`).setDescription(text).setFooter({ text: `Von ${interaction.user.username}` }).setTimestamp()],
        allowedMentions: everyone ? { parse: ['everyone'] } : { parse: [] },
      });
      await interaction.reply({ content: `✅ Ankündigung in <#${channel.id}> gesendet.`, ephemeral: true });
      return;
    }

    if (command === 'poll') {
      const question = interaction.options.getString('frage');
      const options = ['option1', 'option2', 'option3', 'option4', 'option5'].map(n => interaction.options.getString(n)).filter(Boolean);
      const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
      const embed = new EmbedBuilder().setColor(0x111111).setTitle(`📊 ${question}`).setDescription(options.map((o, i) => `${emojis[i]} ${o}`).join('\n')).setFooter({ text: `Abstimmung von ${interaction.user.username}` });
      const message = await interaction.channel.send({ embeds: [embed] });
      for (let i = 0; i < options.length; i++) await message.react(emojis[i]);
      await interaction.reply({ content: '✅ Abstimmung erstellt.', ephemeral: true });
      return;
    }

    if (command === 'suggest') {
      const text = interaction.options.getString('text');
      const channelId = data.config.suggestionsChannelId;
      const channel = channelId ? await interaction.guild.channels.fetch(channelId).catch(() => null) : interaction.channel;
      if (!channel?.isTextBased()) {
        await interaction.reply({ content: '❌ Suggestions-Channel nicht gefunden.', ephemeral: true });
        return;
      }
      const embed = new EmbedBuilder().setColor(0x111111).setTitle('💡 Community Vorschlag').setDescription(text).setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() }).setTimestamp();
      const msg = await channel.send({ embeds: [embed] });
      await msg.react('✅');
      await msg.react('❌');
      await interaction.reply({ content: `✅ Vorschlag gesendet${channel.id !== interaction.channel.id ? `: <#${channel.id}>` : '.'}`, ephemeral: true });
      return;
    }

    if (command === 'giveaway') {
      if (!canManageGiveaways(interaction.member, data)) {
        await interaction.reply({ content: '❌ Du darfst keine Giveaways verwalten.', ephemeral: true });
        return;
      }

      const sub = interaction.options.getSubcommand();

      if (sub === 'start') {
        const prize = interaction.options.getString('preis').trim();
        const durationRaw = interaction.options.getString('dauer');
        const durationMs = parseDuration(durationRaw);
        if (!durationMs) {
          await interaction.reply({ content: '❌ Ungültige Dauer. Nutze z. B. `10m`, `2h` oder `1d` (mindestens 10 Sekunden, maximal 30 Tage).', ephemeral: true });
          return;
        }
        const winnerCount = interaction.options.getInteger('gewinner') || 1;
        const description = interaction.options.getString('beschreibung') || null;
        const requiredRole = interaction.options.getRole('rolle');
        const everyone = interaction.options.getBoolean('everyone') || false;
        let channel = interaction.options.getChannel('channel');
        if (!channel && data.config.giveawayChannelId) channel = await interaction.guild.channels.fetch(data.config.giveawayChannelId).catch(() => null);
        if (!channel) channel = interaction.channel;
        if (!channel?.isTextBased()) {
          await interaction.reply({ content: '❌ Giveaway-Channel nicht gefunden.', ephemeral: true });
          return;
        }

        const placeholder = new EmbedBuilder().setColor(0xf1c40f).setTitle('🎉 Giveaway wird erstellt …');
        const message = await channel.send({
          content: everyone ? '@everyone' : undefined,
          embeds: [placeholder],
          allowedMentions: everyone ? { parse: ['everyone'] } : { parse: [] },
        });
        const giveaway = {
          guildId: interaction.guild.id,
          channelId: channel.id,
          messageId: message.id,
          prize,
          description,
          hostId: interaction.user.id,
          winnerCount,
          requiredRoleId: requiredRole?.id || null,
          createdAt: Date.now(),
          endAt: Date.now() + durationMs,
          ended: false,
          participants: [],
          winners: [],
        };
        if (!data.giveaways) data.giveaways = {};
        data.giveaways[message.id] = giveaway;
        saveData(data);
        await message.edit(giveawayPayload(giveaway));
        await interaction.reply({ content: `✅ Giveaway erstellt: ${message.url}\n**Nachrichten-ID:** \`${message.id}\``, ephemeral: true });
        return;
      }

      if (sub === 'end') {
        const messageId = interaction.options.getString('message_id').trim();
        const giveaway = data.giveaways?.[messageId];
        if (!giveaway) {
          await interaction.reply({ content: '❌ Giveaway mit dieser Nachrichten-ID nicht gefunden.', ephemeral: true });
          return;
        }
        if (giveaway.ended) {
          await interaction.reply({ content: '❌ Dieses Giveaway ist bereits beendet.', ephemeral: true });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        await finishGiveaway(interaction.guild, data, messageId, interaction.user.id);
        await interaction.editReply('✅ Giveaway wurde beendet und die Gewinner wurden ausgelost.');
        return;
      }

      if (sub === 'reroll') {
        const messageId = interaction.options.getString('message_id').trim();
        const giveaway = data.giveaways?.[messageId];
        if (!giveaway || !giveaway.ended) {
          await interaction.reply({ content: '❌ Es wurde kein beendetes Giveaway mit dieser Nachrichten-ID gefunden.', ephemeral: true });
          return;
        }
        const eligible = await eligibleGiveawayParticipants(interaction.guild, giveaway);
        const count = interaction.options.getInteger('gewinner') || giveaway.winnerCount || 1;
        const winners = pickRandomWinners(eligible, count);
        giveaway.winners = winners;
        giveaway.rerolledAt = Date.now();
        saveData(data);
        const channel = await interaction.guild.channels.fetch(giveaway.channelId).catch(() => null);
        const oldMessage = channel?.isTextBased() ? await channel.messages.fetch(messageId).catch(() => null) : null;
        if (oldMessage) await oldMessage.edit(giveawayPayload(giveaway, true)).catch(() => {});
        if (channel?.isTextBased()) {
          await channel.send({
            content: winners.length
              ? `🔄 Neue Gewinner für **${giveaway.prize}**: ${winners.map(id => `<@${id}>`).join(', ')}`
              : `🔄 Für **${giveaway.prize}** konnten keine gültigen Gewinner ausgelost werden.`,
            allowedMentions: { users: winners },
          });
        }
        await interaction.reply({ content: winners.length ? '✅ Gewinner wurden neu ausgelost.' : '⚠️ Keine gültigen Teilnehmer für einen Reroll.', ephemeral: true });
        return;
      }

      if (sub === 'list') {
        const active = Object.values(data.giveaways || {}).filter(g => g.guildId === interaction.guild.id && !g.ended);
        const text = active.length
          ? active.slice(0, 20).map(g => `• **${g.prize}** • <#${g.channelId}> • <t:${Math.floor(g.endAt / 1000)}:R> • \`${g.messageId}\``).join('\n')
          : '*Keine laufenden Giveaways.*';
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle('🎉 Laufende Giveaways').setDescription(text)], ephemeral: true });
        return;
      }
    }

    // ---------- MODERATION ----------
    const moderationCommands = new Set(['warn', 'warnings', 'clearwarnings', 'timeout', 'untimeout', 'kick', 'ban', 'unban', 'unbanall', 'purge', 'slowmode', 'lock', 'unlock']);
    if (moderationCommands.has(command) && !canModerate(interaction.member, data)) {
      await interaction.reply({ content: '❌ Du darfst diese Moderationsfunktion nicht verwenden.', ephemeral: true });
      return;
    }

    if (command === 'warn') {
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('grund');
      if (!data.warnings[user.id]) data.warnings[user.id] = [];
      data.warnings[user.id].push({ reason, moderatorId: interaction.user.id, createdAt: new Date().toISOString() });
      saveData(data);
      await interaction.reply({ content: `⚠️ <@${user.id}> wurde verwarnt. **Grund:** ${reason}` });
      await logEvent(interaction.guild, data, '⚠️ Verwarnung', `<@${user.id}> wurde von <@${interaction.user.id}> verwarnt.\n**Grund:** ${reason}`);
      return;
    }

    if (command === 'warnings') {
      const user = interaction.options.getUser('user');
      const warns = data.warnings[user.id] || [];
      const text = warns.length ? warns.slice(-10).map((w, i) => `**${i + 1}.** ${w.reason} • <@${w.moderatorId}> • <t:${Math.floor(Date.parse(w.createdAt) / 1000)}:d>`).join('\n') : '*Keine Verwarnungen.*';
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle(`⚠️ Verwarnungen • ${user.tag}`).setDescription(text)], ephemeral: true });
      return;
    }

    if (command === 'clearwarnings') {
      const user = interaction.options.getUser('user');
      data.warnings[user.id] = [];
      saveData(data);
      await interaction.reply({ content: `✅ Alle Verwarnungen von <@${user.id}> wurden gelöscht.` });
      await logEvent(interaction.guild, data, '🧹 Verwarnungen gelöscht', `<@${interaction.user.id}> hat alle Verwarnungen von <@${user.id}> gelöscht.`);
      return;
    }

    if (command === 'timeout') {
      const user = interaction.options.getUser('user');
      const minutes = interaction.options.getInteger('minuten');
      const reason = interaction.options.getString('grund') || 'Kein Grund angegeben';
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member?.moderatable) {
        await interaction.reply({ content: '❌ Dieses Mitglied kann ich nicht timeouten. Prüfe die Rollen-Hierarchie.', ephemeral: true });
        return;
      }
      await member.timeout(minutes * 60 * 1000, reason);
      await interaction.reply({ content: `⏳ <@${user.id}> hat **${minutes} Minuten** Timeout.` });
      await logEvent(interaction.guild, data, '⏳ Timeout', `<@${user.id}> • ${minutes} Minuten • ${reason}`);
      return;
    }

    if (command === 'untimeout') {
      const user = interaction.options.getUser('user');
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member?.moderatable) {
        await interaction.reply({ content: '❌ Dieses Mitglied kann ich nicht bearbeiten.', ephemeral: true });
        return;
      }
      await member.timeout(null, `Timeout entfernt von ${interaction.user.tag}`);
      await interaction.reply({ content: `✅ Timeout von <@${user.id}> entfernt.` });
      return;
    }

    if (command === 'kick') {
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('grund') || 'Kein Grund angegeben';
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member?.kickable) {
        await interaction.reply({ content: '❌ Dieses Mitglied kann ich nicht kicken. Prüfe die Rollen-Hierarchie.', ephemeral: true });
        return;
      }
      await member.kick(reason);
      await interaction.reply({ content: `👢 **${user.tag}** wurde gekickt.` });
      await logEvent(interaction.guild, data, '👢 Kick', `**${user.tag}** wurde von <@${interaction.user.id}> gekickt.\n**Grund:** ${reason}`);
      return;
    }

    if (command === 'ban') {
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('grund') || 'Kein Grund angegeben';
      await interaction.guild.members.ban(user.id, { reason });
      await interaction.reply({ content: `🔨 **${user.tag}** wurde gebannt.` });
      await logEvent(interaction.guild, data, '🔨 Ban', `**${user.tag}** (${user.id}) wurde von <@${interaction.user.id}> gebannt.\n**Grund:** ${reason}`);
      return;
    }

    if (command === 'unban') {
      const userId = interaction.options.getString('discord_id').trim();
      if (!isValidDiscordId(userId)) {
        await interaction.reply({ content: '❌ Ungültige Discord-ID.', ephemeral: true });
        return;
      }
      await interaction.guild.members.unban(userId, `Unban von ${interaction.user.tag}`);
      await interaction.reply({ content: `✅ **${userId}** wurde entbannt.` });
      await logEvent(interaction.guild, data, '✅ Unban', `${userId} wurde von <@${interaction.user.id}> entbannt.`);
      return;
    }

    if (command === 'unbanall') {
      if (
        !interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
        !interaction.member.permissions.has(PermissionFlagsBits.BanMembers)
      ) {
        await interaction.reply({ content: '❌ Du brauchst die Berechtigung **Mitglieder bannen**.', ephemeral: true });
        return;
      }

      const bans = await interaction.guild.bans.fetch();
      if (bans.size === 0) {
        await interaction.reply({ content: '✅ Auf diesem Server ist aktuell niemand gebannt.', ephemeral: true });
        return;
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`unbanall_confirm:${interaction.user.id}`)
          .setLabel('Ja, alle entbannen')
          .setEmoji('🔓')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('unbanall_cancel')
          .setLabel('Abbrechen')
          .setStyle(ButtonStyle.Secondary),
      );

      await interaction.reply({
        content: `⚠️ Wirklich **alle ${bans.size} gebannten Nutzer** entbannen?`,
        components: [row],
        ephemeral: true,
      });
      return;
    }

    if (command === 'purge') {
      const amount = interaction.options.getInteger('anzahl');
      const deleted = await interaction.channel.bulkDelete(amount, true);
      await interaction.reply({ content: `🧹 **${deleted.size}** Nachrichten gelöscht.`, ephemeral: true });
      return;
    }

    if (command === 'slowmode') {
      const seconds = interaction.options.getInteger('sekunden');
      if (!interaction.channel.setRateLimitPerUser) {
        await interaction.reply({ content: '❌ In diesem Channel nicht möglich.', ephemeral: true });
        return;
      }
      await interaction.channel.setRateLimitPerUser(seconds, `Von ${interaction.user.tag}`);
      await interaction.reply({ content: `✅ Slowmode auf **${seconds}s** gesetzt.` });
      return;
    }

    if (command === 'lock' || command === 'unlock') {
      const deny = command === 'lock';
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: deny ? false : null });
      await interaction.reply({ content: deny ? '🔒 Channel wurde gesperrt.' : '🔓 Channel wurde entsperrt.' });
      return;
    }

    // ---------- SOCIALS ----------
    if (command === 'socials' || command === 'editsocials') {
      if (!canManageSocials(interaction.member, data)) {
        await interaction.reply({ content: '❌ Du darfst die Socials nicht verwalten.', ephemeral: true });
        return;
      }
      const edit = command === 'editsocials';
      const modal = new ModalBuilder().setCustomId(edit ? 'socials_edit_modal' : 'socials_add_modal').setTitle(edit ? 'Socials bearbeiten' : 'Socials hinzufügen');
      const idInput = new TextInputBuilder().setCustomId('discord_id').setLabel('Discord ID').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(17).setMaxLength(20);
      const linksInput = new TextInputBuilder().setCustomId('links').setLabel(edit ? 'Alle neuen Links (max. 5)' : 'Links hinzufügen (max. 5)').setPlaceholder('https://youtube.com/...\nhttps://tiktok.com/...').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1500);
      modal.addComponents(new ActionRowBuilder().addComponents(idInput), new ActionRowBuilder().addComponents(linksInput));
      await interaction.showModal(modal);
      return;
    }

    if (command === 'removesocial') {
      if (!canManageSocials(interaction.member, data)) {
        await interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
        return;
      }
      const userId = interaction.options.getString('discord_id').trim();
      const url = normalizeUrl(interaction.options.getString('link'));
      const entry = findSocial(data, userId);
      if (!entry || !url || !entry.links.includes(url)) {
        await interaction.reply({ content: '❌ Person oder Link wurde nicht gefunden.', ephemeral: true });
        return;
      }
      entry.links = entry.links.filter(x => x !== url);
      if (!entry.links.length) data.socials.members = data.socials.members.filter(x => x.userId !== userId);
      saveData(data);
      await updateSocialPanel(interaction.guild, data);
      await socialAudit(interaction.guild, data, '➖ Social-Link entfernt', `<@${interaction.user.id}> hat einen Link von <@${userId}> entfernt.`);
      await interaction.reply({ content: '✅ Link entfernt.', ephemeral: true });
      return;
    }

    if (command === 'deletesocials') {
      if (!canDeleteSocials(interaction.member, data)) {
        await interaction.reply({ content: '❌ Du darfst keine Socials löschen.', ephemeral: true });
        return;
      }
      const userId = interaction.options.getString('discord_id').trim();
      if (!findSocial(data, userId)) {
        await interaction.reply({ content: '❌ Diese Discord-ID ist nicht eingetragen.', ephemeral: true });
        return;
      }
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`social_delete_yes:${userId}:${interaction.user.id}`).setLabel('Ja, komplett löschen').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('social_delete_no').setLabel('Abbrechen').setStyle(ButtonStyle.Secondary),
      );
      await interaction.reply({ content: `⚠️ <@${userId}> wirklich inklusive aller Links löschen?`, components: [row], ephemeral: true, allowedMentions: { parse: [] } });
      return;
    }

    if (command === 'socialinfo') {
      const user = interaction.options.getUser('user');
      const entry = findSocial(data, user.id);
      await interaction.reply({ ...socialInfoPayload(entry, `🌐 Socials • ${user.username}`), ephemeral: true });
      return;
    }

    if (command === 'sociallist') {
      const sorted = await sortedSocialMembers(interaction.guild, data.socials.members);
      const text = sorted.length ? sorted.map((entry, i) => `**${i + 1}.** <@${entry.userId}> • ${entry.links.length} Link${entry.links.length === 1 ? '' : 's'}`).join('\n').slice(0, 3900) : '*Niemand eingetragen.*';
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(SOCIAL_PANEL_COLOR).setTitle('🌐 Socials Übersicht').setDescription(text)], ephemeral: true, allowedMentions: { parse: [] } });
      return;
    }

    if (command === 'mysocials') {
      const sub = interaction.options.getSubcommand();
      let entry = findSocial(data, interaction.user.id);
      if (sub === 'view') {
        await interaction.reply({ ...socialInfoPayload(entry, '🌐 Meine Socials'), ephemeral: true });
        return;
      }
      if (sub === 'add' || sub === 'set') {
        const links = parseLinks(interaction.options.getString('links'));
        if (!links.length) {
          await interaction.reply({ content: '❌ Kein gültiger Link gefunden.', ephemeral: true });
          return;
        }
        if (!entry) {
          entry = { userId: interaction.user.id, links: [], addedAt: new Date().toISOString() };
          data.socials.members.push(entry);
        }
        entry.links = sub === 'set' ? links : [...new Set([...entry.links, ...links])].slice(0, MAX_SOCIAL_LINKS);
        saveData(data);
        await updateSocialPanel(interaction.guild, data);
        await socialAudit(interaction.guild, data, '👤 Eigene Socials geändert', `<@${interaction.user.id}> hat seine eigenen Socials geändert.`);
        await interaction.reply({ content: `✅ Deine Socials wurden ${sub === 'set' ? 'ersetzt' : 'ergänzt'}.`, ephemeral: true });
        return;
      }
      if (sub === 'remove') {
        const url = normalizeUrl(interaction.options.getString('link'));
        if (!entry || !url || !entry.links.includes(url)) {
          await interaction.reply({ content: '❌ Dieser Link ist bei dir nicht gespeichert.', ephemeral: true });
          return;
        }
        entry.links = entry.links.filter(x => x !== url);
        if (!entry.links.length) data.socials.members = data.socials.members.filter(x => x.userId !== interaction.user.id);
        saveData(data);
        await updateSocialPanel(interaction.guild, data);
        await interaction.reply({ content: '✅ Link entfernt.', ephemeral: true });
        return;
      }
    }

    if (command === 'refreshsocials') {
      if (!canManageSocials(interaction.member, data)) {
        await interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      await updateSocialPanel(interaction.guild, data);
      await interaction.editReply('✅ Socials-Panel wurde neu sortiert und aktualisiert.');
      return;
    }

    if (command === 'setsocialaudit') {
      if (!canSetup(interaction.member)) {
        await interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
        return;
      }
      const channel = interaction.options.getChannel('channel');
      data.config.socialAuditChannelId = channel.id;
      saveData(data);
      await interaction.reply({ content: `✅ Social-Audit-Channel ist jetzt <#${channel.id}>.`, ephemeral: true });
      return;
    }
  } catch (error) {
    console.error('❌ Interaction Error:', error);
    const message = '❌ Es ist ein Fehler aufgetreten. Prüfe Railway → Logs und die Bot-Berechtigungen.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  }
});

client.login(config.token);
