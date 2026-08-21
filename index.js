const {
  ActionRowBuilder,
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
const VERIFY_TTL_MS = 5 * 60 * 1000;
const verifyChallenges = new Map();
const refreshRunningGuilds = new Set();
const suggestionSourceDeletes = new Set();

function defaultData() {
  return {
    version: 4,
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
    },
    socials: {
      messageIds: [],
      members: [],
    },
    warnings: {},
    giveaways: {},
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
  base.version = 4;
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

function buildSocialPage(entries, pageIndex, pageCount, totalCount) {
  const embed = new EmbedBuilder()
    .setColor(0x111111)
    .setTitle(pageIndex === 0 ? '🌐 Community Socials' : `🌐 Community Socials • Seite ${pageIndex + 1}`)
    .setFooter({ text: `${totalCount} Mitglied${totalCount === 1 ? '' : 'er'} • Seite ${pageIndex + 1}/${pageCount}` });
  if (pageIndex === 0) embed.setDescription('Hier findest du die Socials unserer Community.');

  const rows = [];

  entries.forEach((entry, localIndex) => {
    const globalIndex = pageIndex * 5 + localIndex + 1;
    const linksText = entry.links
      .map(link => {
        const p = platformInfo(link);
        return `${p.emoji} [${p.label}](${link})`;
      })
      .join(' • ');

    embed.addFields({
      name: `${globalIndex}. <@${entry.userId}>`,
      value: linksText || '*Keine Links*',
      inline: false,
    });

    if (entry.links.length) {
      const row = new ActionRowBuilder();
      entry.links.slice(0, 5).forEach(link => {
        const p = platformInfo(link);
        row.addComponents(
          new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel(`${globalIndex} • ${p.label}`.slice(0, 80))
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
    for (let i = 0; i < data.socials.members.length; i += 5) {
      chunks.push(data.socials.members.slice(i, i + 5));
    }

    const newMessageIds = [];
    for (let i = 0; i < chunks.length; i++) {
      const entries = chunks[i];
      let payload;
      if (entries.length === 0) {
        payload = {
          embeds: [
            new EmbedBuilder()
              .setColor(0x111111)
              .setTitle('🌐 Community Socials')
              .setDescription('*Noch keine Socials eingetragen.*'),
          ],
          components: [],
        };
      } else {
        const built = buildSocialPage(entries, i, chunks.length, data.socials.members.length);
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
    .setColor(0x111111)
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
      .setName('purge')
      .setDescription('Löscht mehrere Nachrichten.')
      .addIntegerOption(o => o.setName('anzahl').setDescription('1 bis 100').setRequired(true).setMinValue(1).setMaxValue(100)),
    new SlashCommandBuilder()
      .setName('slowmode')
      .setDescription('Setzt den Slowmode im Channel.')
      .addIntegerOption(o => o.setName('sekunden').setDescription('0 bis 21600').setRequired(true).setMinValue(0).setMaxValue(21600)),
    new SlashCommandBuilder().setName('lock').setDescription('Sperrt den aktuellen Channel für @everyone.'),
    new SlashCommandBuilder().setName('unlock').setDescription('Entsperrt den aktuellen Channel.'),

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
});

// ============================================================
// MEMBER EVENTS
// ============================================================

client.on(Events.GuildMemberAdd, async member => {
  const data = loadData();

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

// ============================================================
// VORSCHLÄGE AUS NORMALEN NACHRICHTEN
// ============================================================

client.on(Events.MessageCreate, async message => {
  if (!message.guild || message.author.bot) return;

  const data = loadData();
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
        await logEvent(interaction.guild, data, '🔒 Ticket geschlossen', `<#${interaction.channel.id}> wurde von <@${interaction.user.id}> geschlossen.`);
        setTimeout(() => interaction.channel.delete(`Ticket geschlossen von ${interaction.user.tag}`).catch(() => {}), 5000);
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
          { name: '🛡️ Moderation', value: '`/warn` `/warnings` `/clearwarnings` `/timeout` `/untimeout` `/kick` `/ban` `/unban` `/purge` `/slowmode` `/lock` `/unlock`' },
          { name: '📣 Community', value: '`/announce` `/poll` `/suggest` `/giveaway`' },
          { name: 'ℹ️ Info', value: '`/serverinfo` `/userinfo` `/avatar` `/ping`' },
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
          { name: 'Channels', value: `Welcome: ${fmtCh(c.welcomeChannelId)}\nLeave: ${fmtCh(c.leaveChannelId)}\nLogs: ${fmtCh(c.logChannelId)}\nSuggestions: ${fmtCh(c.suggestionsChannelId)}\nGiveaways: ${fmtCh(c.giveawayChannelId)}\nSocials: ${fmtCh(c.socialsChannelId)}\nSocial Audit: ${fmtCh(c.socialAuditChannelId)}` },
          { name: 'Rollen', value: `Verified: ${fmtRole(c.verifiedRoleId)}\nUnverified: ${fmtRole(c.unverifiedRoleId)}\nSupport: ${fmtRole(c.supportRoleId)}\nModerator: ${fmtRole(c.moderatorRoleId)}\nAnnouncements: ${fmtRole(c.announcementRoleId)}\nSocial Admin: ${fmtRole(c.socialAdminRoleId)}\nSocial Delete: ${fmtRole(c.socialDeleteRoleId)}` },
          { name: 'Tickets', value: `Kategorie: ${c.ticketCategoryId ? `<#${c.ticketCategoryId}>` : 'Nicht gesetzt'}` },
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
    const moderationCommands = new Set(['warn', 'warnings', 'clearwarnings', 'timeout', 'untimeout', 'kick', 'ban', 'unban', 'purge', 'slowmode', 'lock', 'unlock']);
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
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x111111).setTitle('🌐 Socials Übersicht').setDescription(text)], ephemeral: true, allowedMentions: { parse: [] } });
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
