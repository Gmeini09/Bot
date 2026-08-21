const {
  Client,
  GatewayIntentBits,
  Events,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelType,
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const DEFAULT_MANAGER_ROLE = '1531994258691588177';
const MAX_LINKS_PER_MEMBER = 5;
const AUTO_CHECK_MS = 5 * 60 * 1000;

function parseIds(value) {
  return (value || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

const baseManagerRoleIds = parseIds(process.env.ADMIN_ROLE_IDS || DEFAULT_MANAGER_ROLE);

const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID || '1540161502856740914',
  guildId: process.env.GUILD_ID || '1531989453168578650',
  panelChannelId: process.env.PANEL_CHANNEL_ID || '1540162074531856474',
  auditChannelId: process.env.AUDIT_CHANNEL_ID || '',

  // Pro Command getrennte Rechte. Wenn keine Variable gesetzt ist,
  // wird die bisherige ADMIN_ROLE_IDS Rolle verwendet.
  addRoleIds: parseIds(process.env.SOCIALS_ADD_ROLE_IDS || baseManagerRoleIds.join(',')),
  editRoleIds: parseIds(process.env.SOCIALS_EDIT_ROLE_IDS || baseManagerRoleIds.join(',')),
  removeRoleIds: parseIds(process.env.SOCIALS_REMOVE_ROLE_IDS || baseManagerRoleIds.join(',')),
  deleteRoleIds: parseIds(process.env.SOCIALS_DELETE_ROLE_IDS || baseManagerRoleIds.join(',')),
  viewRoleIds: parseIds(process.env.SOCIALS_VIEW_ROLE_IDS || ''),
  selfServiceRoleIds: parseIds(process.env.MYSOCIALS_ROLE_IDS || ''),

  socialRoleOrderIds: parseIds(
    process.env.SOCIAL_ROLE_ORDER_IDS ||
      '1531994250839855234,1531994252249403572,1531994256107901150,1531994258691588177'
  ),
};

if (!config.token) {
  console.error('❌ DISCORD_TOKEN fehlt. Lege ihn bei Railway unter Variables an.');
  process.exit(1);
}

const storageDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
const dataPath = path.join(storageDir, 'data.json');

function defaultData() {
  return {
    messageId: null, // Legacy-Panel
    headerMessageId: null,
    memberMessageIds: [],
    auditChannelId: null,
    members: [],
  };
}

function loadData() {
  try {
    if (!fs.existsSync(dataPath)) return defaultData();
    const parsed = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    return {
      ...defaultData(),
      ...parsed,
      memberMessageIds: Array.isArray(parsed.memberMessageIds) ? parsed.memberMessageIds : [],
      members: Array.isArray(parsed.members) ? parsed.members : [],
    };
  } catch (error) {
    console.error('⚠️ data.json konnte nicht gelesen werden:', error);
    return defaultData();
  }
}

function saveData(data) {
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
}

function cloneMembers(members) {
  return JSON.parse(JSON.stringify(members));
}

function isValidDiscordId(value) {
  return /^\d{17,20}$/.test((value || '').trim());
}

function normalizeUrl(value) {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function platformName(urlString) {
  try {
    const host = new URL(urlString).hostname.toLowerCase().replace(/^www\./, '');

    if (host.includes('youtube.com') || host === 'youtu.be') return 'YouTube';
    if (host.includes('tiktok.com')) return 'TikTok';
    if (host.includes('twitch.tv')) return 'Twitch';
    if (host.includes('instagram.com')) return 'Instagram';
    if (host === 'x.com' || host.includes('twitter.com')) return 'X / Twitter';
    if (host.includes('spotify.com')) return 'Spotify';
    if (host.includes('soundcloud.com')) return 'SoundCloud';
    if (host.includes('kick.com')) return 'Kick';
    if (host.includes('facebook.com')) return 'Facebook';
    if (host.includes('github.com')) return 'GitHub';

    return 'Website';
  } catch {
    return 'Link';
  }
}

function platformEmoji(urlString) {
  const name = platformName(urlString);
  const map = {
    YouTube: '🎥',
    TikTok: '🎵',
    Twitch: '🟣',
    Instagram: '📸',
    'X / Twitter': '𝕏',
    Spotify: '🎧',
    SoundCloud: '☁️',
    Kick: '🟢',
    Facebook: '📘',
    GitHub: '💻',
    Website: '🌐',
    Link: '🔗',
  };
  return map[name] || '🔗';
}

function getEntryUrls(entry) {
  if (Array.isArray(entry.urls)) return entry.urls.filter(Boolean);
  if (entry.url) return [entry.url];
  return [];
}

function normalizeEntry(entry) {
  return {
    ...entry,
    urls: [...new Set(getEntryUrls(entry))].slice(0, MAX_LINKS_PER_MEMBER),
  };
}

function memberHasPermission(member, roleIds, allowEveryone = false) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (!roleIds || roleIds.length === 0) return allowEveryone;
  return roleIds.some(roleId => member.roles.cache.has(roleId));
}

function canAdd(member) {
  return memberHasPermission(member, config.addRoleIds, false);
}

function canEdit(member) {
  return memberHasPermission(member, config.editRoleIds, false);
}

function canRemoveLink(member) {
  return memberHasPermission(member, config.removeRoleIds, false);
}

function canDelete(member) {
  return memberHasPermission(member, config.deleteRoleIds, false);
}

function canView(member) {
  return memberHasPermission(member, config.viewRoleIds, true);
}

function canUseSelfService(member) {
  return memberHasPermission(member, config.selfServiceRoleIds, true);
}

function canConfigure(member) {
  return Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator));
}

function getRolePriority(member) {
  if (!member) return config.socialRoleOrderIds.length;
  for (let index = 0; index < config.socialRoleOrderIds.length; index++) {
    if (member.roles.cache.has(config.socialRoleOrderIds[index])) return index;
  }
  return config.socialRoleOrderIds.length;
}

async function fetchMemberFresh(guild, userId) {
  return guild.members.fetch({ user: userId, force: true }).catch(() => null);
}

async function sortMembersByRolePriority(guild, members) {
  const decorated = [];

  for (let i = 0; i < members.length; i++) {
    const entry = normalizeEntry(members[i]);
    const member = await fetchMemberFresh(guild, entry.userId);
    decorated.push({ entry, priority: getRolePriority(member), originalIndex: i });
  }

  return decorated
    .sort((a, b) => a.priority - b.priority || a.originalIndex - b.originalIndex)
    .map(item => item.entry);
}

function parseLinks(rawLinks) {
  const submitted = (rawLinks || '')
    .split(/\r?\n/)
    .map(v => v.trim())
    .filter(Boolean);

  if (submitted.length === 0) {
    return { error: '❌ Bitte gib mindestens einen Link ein.' };
  }

  if (submitted.length > MAX_LINKS_PER_MEMBER) {
    return { error: `❌ Maximal ${MAX_LINKS_PER_MEMBER} Links pro Person.` };
  }

  const normalized = [];
  for (const raw of submitted) {
    const url = normalizeUrl(raw);
    if (!url) {
      return { error: `❌ Ungültiger Link: ${raw}\nDer Link muss mit http:// oder https:// beginnen.` };
    }
    if (!normalized.includes(url)) normalized.push(url);
  }

  return { urls: normalized };
}

function buildLinkButtons(urls) {
  const counts = new Map();
  const row = new ActionRowBuilder();

  for (const url of urls.slice(0, MAX_LINKS_PER_MEMBER)) {
    const platform = platformName(url);
    const current = (counts.get(platform) || 0) + 1;
    counts.set(platform, current);
    const label = current > 1 ? `${platform} ${current}` : platform;

    row.addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(label.slice(0, 80))
        .setEmoji(platformEmoji(url))
        .setURL(url)
    );
  }

  return row.components.length > 0 ? [row] : [];
}

async function buildMemberCard(guild, entry, index) {
  const member = await guild.members.fetch(entry.userId).catch(() => null);
  const displayName = member?.displayName || `User ${entry.userId}`;
  const urls = getEntryUrls(entry);

  const embed = new EmbedBuilder()
    .setColor(0x111111)
    .setTitle(`${index + 1}. ${displayName}`)
    .setDescription(`<@${entry.userId}>\n**${urls.length}/${MAX_LINKS_PER_MEMBER} Social-Link${urls.length === 1 ? '' : 's'}**`)
    .setFooter({ text: 'Klicke unten auf eine Plattform.' });

  if (member?.displayAvatarURL()) {
    embed.setThumbnail(member.displayAvatarURL({ size: 128 }));
  }

  return {
    embeds: [embed],
    components: buildLinkButtons(urls),
    allowedMentions: { parse: [] },
  };
}

async function getPanelChannel(guild) {
  const channel = await guild.channels.fetch(config.panelChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) throw new Error('PANEL_CHANNEL_NOT_FOUND');
  return channel;
}

async function safeDeleteMessage(channel, id) {
  if (!id) return;
  const msg = await channel.messages.fetch(id).catch(() => null);
  if (msg) await msg.delete().catch(() => {});
}

async function rebuildPanel(guild, data) {
  const channel = await getPanelChannel(guild);
  const sortedMembers = await sortMembersByRolePriority(guild, data.members);
  const newMessageIds = [];
  let newHeader = null;

  try {
    const headerEmbed = new EmbedBuilder()
      .setColor(0x111111)
      .setTitle('🌐 Socials')
      .setDescription(
        'Hier findest du die Socials unserer Mitglieder.\n' +
          'Die Reihenfolge wird automatisch nach den festgelegten Discord-Rollen sortiert.'
      )
      .setFooter({
        text: `Socials • ${sortedMembers.length} Mitglied${sortedMembers.length === 1 ? '' : 'er'}`,
      });

    newHeader = await channel.send({ embeds: [headerEmbed], allowedMentions: { parse: [] } });

    for (let i = 0; i < sortedMembers.length; i++) {
      const payload = await buildMemberCard(guild, sortedMembers[i], i);
      const msg = await channel.send(payload);
      newMessageIds.push(msg.id);
    }
  } catch (error) {
    if (newHeader) await newHeader.delete().catch(() => {});
    for (const id of newMessageIds) await safeDeleteMessage(channel, id);
    throw error;
  }

  // Erst wenn das neue Panel vollständig erstellt ist, das alte entfernen.
  const oldIds = new Set([
    data.messageId,
    data.headerMessageId,
    ...(Array.isArray(data.memberMessageIds) ? data.memberMessageIds : []),
  ].filter(Boolean));

  for (const oldId of oldIds) {
    if (oldId !== newHeader.id && !newMessageIds.includes(oldId)) {
      await safeDeleteMessage(channel, oldId);
    }
  }

  data.messageId = null;
  data.headerMessageId = newHeader.id;
  data.memberMessageIds = newMessageIds;
  data.members = sortedMembers;
  saveData(data);

  return newHeader;
}

async function panelIsHealthy(guild, data) {
  if (!data.headerMessageId) return false;
  const channel = await getPanelChannel(guild).catch(() => null);
  if (!channel) return false;

  const header = await channel.messages.fetch(data.headerMessageId).catch(() => null);
  if (!header) return false;

  const expected = data.members.length;
  const ids = Array.isArray(data.memberMessageIds) ? data.memberMessageIds : [];
  if (ids.length !== expected) return false;

  for (const id of ids) {
    const msg = await channel.messages.fetch(id).catch(() => null);
    if (!msg) return false;
  }
  return true;
}

async function pingNewMember(guild, userId) {
  const channel = await getPanelChannel(guild).catch(() => null);
  if (!channel) return;

  const ping = await channel.send({
    content: `📌 <@${userId}> wurde zu den Socials hinzugefügt.`,
    allowedMentions: { users: [userId] },
  }).catch(() => null);

  if (ping) setTimeout(() => ping.delete().catch(() => {}), 5000);
}

function resolveAuditChannelId(data) {
  return config.auditChannelId || data.auditChannelId || null;
}

async function writeAudit(guild, data, { action, actorId = null, targetId = null, details = null }) {
  const channelId = resolveAuditChannelId(data);
  if (!channelId) return;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const lines = [];
  if (actorId) lines.push(`**Ausgeführt von:** <@${actorId}>`);
  else lines.push('**Ausgeführt von:** Automatik');
  if (targetId) lines.push(`**Betroffen:** <@${targetId}>`);
  if (details) lines.push(`**Details:** ${details}`);

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(`📝 Socials Log • ${action}`)
    .setDescription(lines.join('\n'))
    .setTimestamp();

  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}

async function mutateAndRebuild(interaction, mutator) {
  const data = loadData();
  const before = cloneMembers(data.members);

  try {
    const result = await mutator(data);
    if (result?.skip) return { data, ...result };
    await rebuildPanel(interaction.guild, data);
    saveData(data);
    return { data, ...result };
  } catch (error) {
    data.members = before;
    saveData(data);
    throw error;
  }
}

async function sendSocialInfo(interaction, userId) {
  const data = loadData();
  const entry = data.members.find(e => e.userId === userId);

  if (!entry) {
    await interaction.reply({
      content: `❌ <@${userId}> ist nicht im Socials-Panel eingetragen.`,
      allowedMentions: { parse: [] },
      ephemeral: true,
    });
    return;
  }

  const urls = getEntryUrls(entry);
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  const name = member?.displayName || userId;

  const embed = new EmbedBuilder()
    .setColor(0x111111)
    .setTitle(`🌐 Socials • ${name}`)
    .setDescription(`<@${userId}>\n${urls.length}/${MAX_LINKS_PER_MEMBER} Links gespeichert.`);

  await interaction.reply({
    embeds: [embed],
    components: buildLinkButtons(urls),
    allowedMentions: { parse: [] },
    ephemeral: true,
  });
}

function buildRemoveSelect(userId, requesterId, urls, selfMode = false) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${selfMode ? 'mysocials_remove_select' : 'removesocial_select'}:${userId}:${requesterId}`)
    .setPlaceholder('Welchen Link möchtest du entfernen?')
    .addOptions(
      urls.map((url, index) => {
        let description = url;
        try {
          const u = new URL(url);
          description = `${u.hostname}${u.pathname}`;
        } catch {}

        return new StringSelectMenuOptionBuilder()
          .setLabel(`${platformName(url)} ${index + 1}`.slice(0, 100))
          .setDescription(description.slice(0, 100))
          .setValue(String(index));
      })
    );

  return new ActionRowBuilder().addComponents(menu);
}

function createLinksModal(customId, title, userId, currentLinks = '', mode = 'add') {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);

  if (userId) {
    const discordIdInput = new TextInputBuilder()
      .setCustomId('discord_id')
      .setLabel('Discord ID')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(17)
      .setMaxLength(20)
      .setValue(userId);
    modal.addComponents(new ActionRowBuilder().addComponents(discordIdInput));
  }

  const linksInput = new TextInputBuilder()
    .setCustomId('social_links')
    .setLabel(mode === 'replace' ? `Alle Links (max. ${MAX_LINKS_PER_MEMBER})` : `Neue Links (max. ${MAX_LINKS_PER_MEMBER})`)
    .setPlaceholder('https://youtube.com/@name\nhttps://tiktok.com/@name')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(3000);

  if (currentLinks) linksInput.setValue(currentLinks.slice(0, 3000));
  modal.addComponents(new ActionRowBuilder().addComponents(linksInput));
  return modal;
}

async function handleAddLinks(interaction, userId, rawLinks, selfMode = false) {
  if (!isValidDiscordId(userId)) {
    await interaction.reply({ content: '❌ Die Discord-ID ist ungültig.', ephemeral: true });
    return;
  }

  const parsed = parseLinks(rawLinks);
  if (parsed.error) {
    await interaction.reply({ content: parsed.error, ephemeral: true });
    return;
  }

  const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: '❌ Diese Discord-ID gehört zu keinem Mitglied auf diesem Server.', ephemeral: true });
    return;
  }

  const result = await mutateAndRebuild(interaction, async data => {
    const existingIndex = data.members.findIndex(e => e.userId === userId);
    const isNewMember = existingIndex === -1;

    if (isNewMember) {
      data.members.push({ userId, urls: parsed.urls, addedAt: new Date().toISOString() });
      return { isNewMember, addedCount: parsed.urls.length };
    }

    const entry = normalizeEntry(data.members[existingIndex]);
    const existingUrls = getEntryUrls(entry);
    const linksToAdd = parsed.urls.filter(url => !existingUrls.includes(url));

    if (linksToAdd.length === 0) {
      return { skip: true, duplicateOnly: true, isNewMember: false, addedCount: 0 };
    }

    if (existingUrls.length + linksToAdd.length > MAX_LINKS_PER_MEMBER) {
      return {
        skip: true,
        limitReached: true,
        isNewMember: false,
        addedCount: 0,
        currentCount: existingUrls.length,
      };
    }

    data.members[existingIndex] = {
      ...entry,
      urls: [...existingUrls, ...linksToAdd],
    };
    delete data.members[existingIndex].url;
    return { isNewMember: false, addedCount: linksToAdd.length };
  });

  if (result.duplicateOnly) {
    await interaction.reply({
      content: 'ℹ️ Diese Links sind bereits eingetragen.',
      ephemeral: true,
    });
    return;
  }

  if (result.limitReached) {
    await interaction.reply({
      content: `❌ Diese Person hat bereits ${result.currentCount} Links. Insgesamt sind maximal ${MAX_LINKS_PER_MEMBER} erlaubt.`,
      ephemeral: true,
    });
    return;
  }

  if (result.isNewMember) await pingNewMember(interaction.guild, userId);

  await writeAudit(interaction.guild, result.data, {
    action: selfMode ? 'Eigene Links hinzugefügt' : 'Links hinzugefügt',
    actorId: interaction.user.id,
    targetId: userId,
    details: `${result.addedCount} Link${result.addedCount === 1 ? '' : 's'} hinzugefügt.`,
  });

  await interaction.reply({
    content: result.isNewMember
      ? `✅ <@${userId}> wurde mit ${result.addedCount} Link${result.addedCount === 1 ? '' : 's'} hinzugefügt.`
      : `✅ ${result.addedCount} neue${result.addedCount === 1 ? 'r Link' : ' Links'} wurden bei <@${userId}> ergänzt.`,
    allowedMentions: { parse: [] },
    ephemeral: true,
  });
}

async function handleReplaceLinks(interaction, userId, rawLinks, selfMode = false) {
  const parsed = parseLinks(rawLinks);
  if (parsed.error) {
    await interaction.reply({ content: parsed.error, ephemeral: true });
    return;
  }

  const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: '❌ Dieses Mitglied ist nicht mehr auf dem Server.', ephemeral: true });
    return;
  }

  const result = await mutateAndRebuild(interaction, async data => {
    const index = data.members.findIndex(e => e.userId === userId);
    if (index === -1) {
      data.members.push({ userId, urls: parsed.urls, addedAt: new Date().toISOString() });
      return { created: true };
    }

    const entry = normalizeEntry(data.members[index]);
    data.members[index] = { ...entry, urls: parsed.urls };
    delete data.members[index].url;
    return { created: false };
  });

  if (result.created) await pingNewMember(interaction.guild, userId);

  await writeAudit(interaction.guild, result.data, {
    action: selfMode ? 'Eigene Links ersetzt' : 'Links bearbeitet',
    actorId: interaction.user.id,
    targetId: userId,
    details: `Jetzt ${parsed.urls.length}/${MAX_LINKS_PER_MEMBER} Links gespeichert.`,
  });

  await interaction.reply({
    content: `✅ Die Social-Links von <@${userId}> wurden gespeichert.`,
    allowedMentions: { parse: [] },
    ephemeral: true,
  });
}

async function reconcileGuildSocials(guild) {
  const data = loadData();
  let changed = false;
  const kept = [];
  const removed = [];

  for (const rawEntry of data.members) {
    const entry = normalizeEntry(rawEntry);
    try {
      const member = await guild.members.fetch({ user: entry.userId, force: true });
      if (member) kept.push(entry);
    } catch (error) {
      // Nur bei einem echten "Unknown Member" entfernen, nicht bei temporären API-Fehlern.
      if (error?.code === 10007 || error?.status === 404) {
        removed.push(entry.userId);
        changed = true;
      } else {
        kept.push(entry);
      }
    }
  }

  const sorted = await sortMembersByRolePriority(guild, kept);
  const oldOrder = data.members.map(e => e.userId).join(',');
  const newOrder = sorted.map(e => e.userId).join(',');
  if (oldOrder !== newOrder) changed = true;

  data.members = sorted;

  let healthy = false;
  try {
    healthy = await panelIsHealthy(guild, data);
  } catch {
    healthy = false;
  }

  if (changed || !healthy || data.messageId) {
    await rebuildPanel(guild, data);
  }

  for (const userId of removed) {
    await writeAudit(guild, data, {
      action: 'Automatisch entfernt',
      targetId: userId,
      details: 'Mitglied hat den Discord-Server verlassen.',
    });
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async readyClient => {
  console.log(`✅ Eingeloggt als ${readyClient.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName('socials')
      .setDescription('Fügt Social-Links zu einer Discord-ID hinzu.'),

    new SlashCommandBuilder()
      .setName('editsocials')
      .setDescription('Bearbeitet/ersetzt alle Social-Links einer Person.')
      .addStringOption(o =>
        o.setName('discord_id').setDescription('Discord-ID der Person.').setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('removesocial')
      .setDescription('Entfernt einen einzelnen Social-Link einer Person.')
      .addStringOption(o =>
        o.setName('discord_id').setDescription('Discord-ID der Person.').setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('deletesocials')
      .setDescription('Entfernt eine Person komplett aus dem Socials-Panel.')
      .addStringOption(o =>
        o.setName('discord_id').setDescription('Discord-ID der Person.').setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('socialinfo')
      .setDescription('Zeigt alle gespeicherten Socials einer Person.')
      .addStringOption(o =>
        o.setName('discord_id').setDescription('Discord-ID der Person.').setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('sociallist')
      .setDescription('Zeigt eine Übersicht aller eingetragenen Personen.'),

    new SlashCommandBuilder()
      .setName('mysocials')
      .setDescription('Verwalte deine eigenen Social-Links.'),

    new SlashCommandBuilder()
      .setName('refreshsocials')
      .setDescription('Sortiert und aktualisiert das Socials-Panel sofort.'),

    new SlashCommandBuilder()
      .setName('setsocialaudit')
      .setDescription('Legt den Channel für Socials-Audit-Logs fest.')
      .addChannelOption(o =>
        o
          .setName('channel')
          .setDescription('Channel für die Socials-Logs.')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true)
      ),
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(config.token);
  const applicationId = readyClient.application.id;
  const guilds = [...readyClient.guilds.cache.values()];

  if (guilds.length === 0) {
    console.error('❌ Der Bot ist auf keinem Discord-Server installiert.');
    return;
  }

  for (const guild of guilds) {
    try {
      await rest.put(Routes.applicationGuildCommands(applicationId, guild.id), { body: commands });
      console.log(`✅ Socials-Commands registriert auf ${guild.name} (${guild.id}).`);
    } catch (error) {
      console.error(`❌ Commands konnten auf ${guild.name} nicht registriert werden:`, error);
    }
  }

  // Alte Ein-Nachrichten-Panels werden automatisch in die neue Button-Version migriert.
  setTimeout(async () => {
    for (const guild of guilds) {
      await reconcileGuildSocials(guild).catch(error =>
        console.error(`❌ Automatische Socials-Prüfung auf ${guild.name}:`, error)
      );
    }
  }, 5000);

  setInterval(async () => {
    for (const guild of [...readyClient.guilds.cache.values()]) {
      await reconcileGuildSocials(guild).catch(error =>
        console.error(`❌ Automatische Socials-Prüfung auf ${guild.name}:`, error)
      );
    }
  }, AUTO_CHECK_MS);
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    // -------------------- SLASH COMMANDS --------------------
    if (interaction.isChatInputCommand()) {
      if (!interaction.inGuild()) {
        await interaction.reply({ content: '❌ Dieser Befehl funktioniert nur auf einem Server.', ephemeral: true });
        return;
      }

      if (interaction.commandName === 'socials') {
        if (!canAdd(interaction.member)) {
          await interaction.reply({ content: '❌ Du darfst `/socials` nicht benutzen.', ephemeral: true });
          return;
        }

        const modal = new ModalBuilder().setCustomId('socials_add_modal').setTitle('Socials hinzufügen');
        const discordIdInput = new TextInputBuilder()
          .setCustomId('discord_id')
          .setLabel('Discord ID')
          .setPlaceholder('z. B. 123456789012345678')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(17)
          .setMaxLength(20);
        const linksInput = new TextInputBuilder()
          .setCustomId('social_links')
          .setLabel(`Social-Links (max. ${MAX_LINKS_PER_MEMBER})`)
          .setPlaceholder('Ein Link pro Zeile')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(3000);
        modal.addComponents(
          new ActionRowBuilder().addComponents(discordIdInput),
          new ActionRowBuilder().addComponents(linksInput)
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.commandName === 'editsocials') {
        if (!canEdit(interaction.member)) {
          await interaction.reply({ content: '❌ Du darfst `/editsocials` nicht benutzen.', ephemeral: true });
          return;
        }

        const userId = interaction.options.getString('discord_id', true).trim();
        if (!isValidDiscordId(userId)) {
          await interaction.reply({ content: '❌ Ungültige Discord-ID.', ephemeral: true });
          return;
        }

        const data = loadData();
        const entry = data.members.find(e => e.userId === userId);
        if (!entry) {
          await interaction.reply({ content: '❌ Diese Person ist nicht eingetragen.', ephemeral: true });
          return;
        }

        const modal = createLinksModal(
          `socials_edit_modal:${userId}`,
          'Socials bearbeiten',
          null,
          getEntryUrls(entry).join('\n'),
          'replace'
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.commandName === 'removesocial') {
        if (!canRemoveLink(interaction.member)) {
          await interaction.reply({ content: '❌ Du darfst `/removesocial` nicht benutzen.', ephemeral: true });
          return;
        }

        const userId = interaction.options.getString('discord_id', true).trim();
        if (!isValidDiscordId(userId)) {
          await interaction.reply({ content: '❌ Ungültige Discord-ID.', ephemeral: true });
          return;
        }

        const data = loadData();
        const entry = data.members.find(e => e.userId === userId);
        const urls = entry ? getEntryUrls(entry) : [];
        if (!entry || urls.length === 0) {
          await interaction.reply({ content: '❌ Für diese Person wurden keine Links gefunden.', ephemeral: true });
          return;
        }

        await interaction.reply({
          content: `Welchen Link möchtest du bei <@${userId}> entfernen?`,
          components: [buildRemoveSelect(userId, interaction.user.id, urls, false)],
          allowedMentions: { parse: [] },
          ephemeral: true,
        });
        return;
      }

      if (interaction.commandName === 'deletesocials') {
        if (!canDelete(interaction.member)) {
          await interaction.reply({ content: '❌ Du darfst `/deletesocials` nicht benutzen.', ephemeral: true });
          return;
        }

        const userId = interaction.options.getString('discord_id', true).trim();
        if (!isValidDiscordId(userId)) {
          await interaction.reply({ content: '❌ Ungültige Discord-ID.', ephemeral: true });
          return;
        }

        const data = loadData();
        if (!data.members.some(e => e.userId === userId)) {
          await interaction.reply({ content: '❌ Diese Person ist nicht eingetragen.', ephemeral: true });
          return;
        }

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`delete_social_confirm:${userId}:${interaction.user.id}`)
            .setLabel('Wirklich löschen')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🗑️'),
          new ButtonBuilder()
            .setCustomId(`delete_social_cancel:${userId}:${interaction.user.id}`)
            .setLabel('Abbrechen')
            .setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({
          content: `⚠️ Soll <@${userId}> wirklich **komplett** aus dem Socials-Panel gelöscht werden?`,
          components: [row],
          allowedMentions: { parse: [] },
          ephemeral: true,
        });
        return;
      }

      if (interaction.commandName === 'socialinfo') {
        if (!canView(interaction.member)) {
          await interaction.reply({ content: '❌ Du darfst `/socialinfo` nicht benutzen.', ephemeral: true });
          return;
        }
        const userId = interaction.options.getString('discord_id', true).trim();
        if (!isValidDiscordId(userId)) {
          await interaction.reply({ content: '❌ Ungültige Discord-ID.', ephemeral: true });
          return;
        }
        await sendSocialInfo(interaction, userId);
        return;
      }

      if (interaction.commandName === 'sociallist') {
        if (!canView(interaction.member)) {
          await interaction.reply({ content: '❌ Du darfst `/sociallist` nicht benutzen.', ephemeral: true });
          return;
        }

        const data = loadData();
        const sorted = await sortMembersByRolePriority(interaction.guild, data.members);
        const lines = sorted.map((entry, i) =>
          `**${i + 1}.** <@${entry.userId}> — ${getEntryUrls(entry).length}/${MAX_LINKS_PER_MEMBER} Links`
        );

        const chunks = [];
        let current = '';
        for (const line of lines.length ? lines : ['*Noch niemand eingetragen.*']) {
          const next = current ? `${current}\n${line}` : line;
          if (next.length > 3800) {
            chunks.push(current);
            current = line;
          } else current = next;
        }
        if (current) chunks.push(current);

        const embeds = chunks.slice(0, 10).map((description, i) => {
          const e = new EmbedBuilder().setColor(0x111111).setDescription(description);
          if (i === 0) e.setTitle(`🌐 Social-Liste • ${sorted.length} Mitglieder`);
          return e;
        });

        await interaction.reply({ embeds, allowedMentions: { parse: [] }, ephemeral: true });
        return;
      }

      if (interaction.commandName === 'mysocials') {
        if (!canUseSelfService(interaction.member)) {
          await interaction.reply({ content: '❌ Du darfst `/mysocials` nicht benutzen.', ephemeral: true });
          return;
        }

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('mysocials_add').setLabel('Links hinzufügen').setEmoji('➕').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('mysocials_replace').setLabel('Alle bearbeiten').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('mysocials_remove').setLabel('Link entfernen').setEmoji('🗑️').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('mysocials_view').setLabel('Anzeigen').setEmoji('👁️').setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({
          content: '**🌐 Meine Socials**\nHier kannst du ausschließlich deine eigenen Links verwalten.',
          components: [row],
          ephemeral: true,
        });
        return;
      }

      if (interaction.commandName === 'refreshsocials') {
        if (!canEdit(interaction.member)) {
          await interaction.reply({ content: '❌ Du darfst das Panel nicht aktualisieren.', ephemeral: true });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        const data = loadData();
        await rebuildPanel(interaction.guild, data);
        await interaction.editReply('✅ Socials-Panel wurde neu sortiert und aktualisiert.');
        return;
      }

      if (interaction.commandName === 'setsocialaudit') {
        if (!canConfigure(interaction.member)) {
          await interaction.reply({ content: '❌ Nur Administratoren können den Audit-Channel ändern.', ephemeral: true });
          return;
        }

        const channel = interaction.options.getChannel('channel', true);
        if (channel.id === config.panelChannelId) {
          await interaction.reply({
            content: '❌ Nimm für Audit-Logs bitte einen anderen Channel als den Socials-Panel-Channel.',
            ephemeral: true,
          });
          return;
        }

        const data = loadData();
        data.auditChannelId = channel.id;
        saveData(data);
        await interaction.reply({ content: `✅ Socials-Audit-Logs gehen ab jetzt in <#${channel.id}>.`, ephemeral: true });
        return;
      }
    }

    // -------------------- BUTTONS --------------------
    if (interaction.isButton()) {
      if (!interaction.inGuild()) return;

      if (interaction.customId === 'mysocials_add') {
        if (!canUseSelfService(interaction.member)) {
          await interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
          return;
        }
        const modal = createLinksModal('mysocials_add_modal', 'Meine Socials hinzufügen', null, '', 'add');
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === 'mysocials_replace') {
        if (!canUseSelfService(interaction.member)) {
          await interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
          return;
        }
        const data = loadData();
        const entry = data.members.find(e => e.userId === interaction.user.id);
        const current = entry ? getEntryUrls(entry).join('\n') : '';
        const modal = createLinksModal('mysocials_replace_modal', 'Meine Socials bearbeiten', null, current, 'replace');
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === 'mysocials_remove') {
        if (!canUseSelfService(interaction.member)) {
          await interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
          return;
        }
        const data = loadData();
        const entry = data.members.find(e => e.userId === interaction.user.id);
        const urls = entry ? getEntryUrls(entry) : [];
        if (!entry || urls.length === 0) {
          await interaction.reply({ content: 'ℹ️ Du hast aktuell keine Social-Links eingetragen.', ephemeral: true });
          return;
        }
        await interaction.reply({
          content: 'Welchen deiner Links möchtest du entfernen?',
          components: [buildRemoveSelect(interaction.user.id, interaction.user.id, urls, true)],
          ephemeral: true,
        });
        return;
      }

      if (interaction.customId === 'mysocials_view') {
        if (!canUseSelfService(interaction.member)) {
          await interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
          return;
        }
        await sendSocialInfo(interaction, interaction.user.id);
        return;
      }

      if (interaction.customId.startsWith('delete_social_cancel:')) {
        const [, userId, requesterId] = interaction.customId.split(':');
        if (interaction.user.id !== requesterId) {
          await interaction.reply({ content: '❌ Diese Bestätigung gehört nicht dir.', ephemeral: true });
          return;
        }
        await interaction.update({ content: `❎ Löschen von <@${userId}> abgebrochen.`, components: [], allowedMentions: { parse: [] } });
        return;
      }

      if (interaction.customId.startsWith('delete_social_confirm:')) {
        const [, userId, requesterId] = interaction.customId.split(':');
        if (interaction.user.id !== requesterId) {
          await interaction.reply({ content: '❌ Diese Bestätigung gehört nicht dir.', ephemeral: true });
          return;
        }
        if (!canDelete(interaction.member)) {
          await interaction.reply({ content: '❌ Du darfst diese Person nicht löschen.', ephemeral: true });
          return;
        }

        await interaction.deferUpdate();
        const data = loadData();
        const index = data.members.findIndex(e => e.userId === userId);
        if (index === -1) {
          await interaction.editReply({ content: 'ℹ️ Diese Person wurde bereits entfernt.', components: [] });
          return;
        }

        data.members.splice(index, 1);
        await rebuildPanel(interaction.guild, data);
        await writeAudit(interaction.guild, data, {
          action: 'Person komplett gelöscht',
          actorId: interaction.user.id,
          targetId: userId,
        });
        await interaction.editReply({
          content: `✅ <@${userId}> wurde komplett aus dem Socials-Panel entfernt.`,
          components: [],
          allowedMentions: { parse: [] },
        });
        return;
      }
    }

    // -------------------- SELECT MENUS --------------------
    if (interaction.isStringSelectMenu()) {
      if (!interaction.inGuild()) return;

      if (interaction.customId.startsWith('removesocial_select:') || interaction.customId.startsWith('mysocials_remove_select:')) {
        const [type, userId, requesterId] = interaction.customId.split(':');
        const selfMode = type === 'mysocials_remove_select';

        if (interaction.user.id !== requesterId) {
          await interaction.reply({ content: '❌ Diese Auswahl gehört nicht dir.', ephemeral: true });
          return;
        }

        if (selfMode) {
          if (userId !== interaction.user.id || !canUseSelfService(interaction.member)) {
            await interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
            return;
          }
        } else if (!canRemoveLink(interaction.member)) {
          await interaction.reply({ content: '❌ Du darfst keine Links entfernen.', ephemeral: true });
          return;
        }

        const selectedIndex = Number(interaction.values[0]);
        const data = loadData();
        const entryIndex = data.members.findIndex(e => e.userId === userId);
        if (entryIndex === -1) {
          await interaction.update({ content: '❌ Person nicht mehr gefunden.', components: [] });
          return;
        }

        const entry = normalizeEntry(data.members[entryIndex]);
        const urls = getEntryUrls(entry);
        if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= urls.length) {
          await interaction.update({ content: '❌ Dieser Link existiert nicht mehr.', components: [] });
          return;
        }

        const removedUrl = urls[selectedIndex];
        urls.splice(selectedIndex, 1);

        if (urls.length === 0) {
          data.members.splice(entryIndex, 1);
        } else {
          data.members[entryIndex] = { ...entry, urls };
        }

        await interaction.deferUpdate();
        await rebuildPanel(interaction.guild, data);
        await writeAudit(interaction.guild, data, {
          action: selfMode ? 'Eigener Link entfernt' : 'Einzelnen Link entfernt',
          actorId: interaction.user.id,
          targetId: userId,
          details: platformName(removedUrl),
        });

        await interaction.editReply({
          content: urls.length === 0
            ? `✅ Der letzte Link wurde entfernt. <@${userId}> wurde deshalb aus dem Panel genommen.`
            : `✅ ${platformName(removedUrl)} wurde bei <@${userId}> entfernt.`,
          components: [],
          allowedMentions: { parse: [] },
        });
        return;
      }
    }

    // -------------------- MODALS --------------------
    if (interaction.isModalSubmit()) {
      if (!interaction.inGuild()) return;

      if (interaction.customId === 'socials_add_modal') {
        if (!canAdd(interaction.member)) {
          await interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
          return;
        }
        const userId = interaction.fields.getTextInputValue('discord_id').trim();
        const links = interaction.fields.getTextInputValue('social_links');
        await handleAddLinks(interaction, userId, links, false);
        return;
      }

      if (interaction.customId.startsWith('socials_edit_modal:')) {
        if (!canEdit(interaction.member)) {
          await interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
          return;
        }
        const userId = interaction.customId.split(':')[1];
        const links = interaction.fields.getTextInputValue('social_links');
        await handleReplaceLinks(interaction, userId, links, false);
        return;
      }

      if (interaction.customId === 'mysocials_add_modal') {
        if (!canUseSelfService(interaction.member)) {
          await interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
          return;
        }
        const links = interaction.fields.getTextInputValue('social_links');
        await handleAddLinks(interaction, interaction.user.id, links, true);
        return;
      }

      if (interaction.customId === 'mysocials_replace_modal') {
        if (!canUseSelfService(interaction.member)) {
          await interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
          return;
        }
        const links = interaction.fields.getTextInputValue('social_links');
        await handleReplaceLinks(interaction, interaction.user.id, links, true);
        return;
      }
    }
  } catch (error) {
    console.error('❌ Interaction-Fehler:', error);

    let message = '❌ Es ist ein Fehler aufgetreten. Prüfe die Railway-Logs.';
    if (error?.message === 'PANEL_CHANNEL_NOT_FOUND') {
      message = '❌ Der konfigurierte Socials-Channel wurde nicht gefunden oder ist kein Text-Channel.';
    }

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  }
});

client.login(config.token);
