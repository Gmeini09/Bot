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
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID || '1540161502856740914',
  guildId: process.env.GUILD_ID || '1531989453168578650',
  panelChannelId: process.env.PANEL_CHANNEL_ID || '1540162074531856474',
  adminRoleIds: (process.env.ADMIN_ROLE_IDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
  socialRoleOrderIds: (process.env.SOCIAL_ROLE_ORDER_IDS ||
    '1531994250839855234,1531994252249403572,1531994256107901150,1531994258691588177')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
};

if (!config.token) {
  console.error('❌ DISCORD_TOKEN fehlt. Lege ihn beim Hoster als geheime Variable an.');
  process.exit(1);
}

const storageDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
const dataPath = path.join(storageDir, 'data.json');

function loadData() {
  try {
    if (!fs.existsSync(dataPath)) return { messageId: null, members: [] };
    const parsed = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    return {
      messageId: parsed.messageId ?? null,
      members: Array.isArray(parsed.members) ? parsed.members : [],
    };
  } catch {
    return { messageId: null, members: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
}

function isValidDiscordId(value) {
  return /^\d{17,20}$/.test(value.trim());
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

    return 'Social Link';
  } catch {
    return 'Social Link';
  }
}

function canManageSocials(member) {
  if (!member) return false;

  if (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  ) {
    return true;
  }

  const allowedRoleIds = Array.isArray(config.adminRoleIds) ? config.adminRoleIds : [];
  return allowedRoleIds.some(roleId => member.roles.cache.has(roleId));
}

function getRolePriority(member) {
  if (!member) return config.socialRoleOrderIds.length;

  for (let index = 0; index < config.socialRoleOrderIds.length; index++) {
    if (member.roles.cache.has(config.socialRoleOrderIds[index])) {
      return index;
    }
  }

  // Mitglieder ohne eine der Sortier-Rollen kommen ganz nach unten.
  return config.socialRoleOrderIds.length;
}

async function sortMembersByRolePriority(guild, members) {
  const entriesWithPriority = await Promise.all(
    members.map(async (entry, originalIndex) => {
      const member = await guild.members.fetch(entry.userId).catch(() => null);

      return {
        entry,
        originalIndex,
        priority: getRolePriority(member),
      };
    })
  );

  // Erst nach der festgelegten Rollen-Hierarchie sortieren.
  // Innerhalb derselben Rolle bleibt die bisherige Reihenfolge erhalten.
  return entriesWithPriority
    .sort((a, b) => a.priority - b.priority || a.originalIndex - b.originalIndex)
    .map(item => item.entry);
}

function getEntryUrls(entry) {
  if (Array.isArray(entry.urls)) {
    return entry.urls.filter(Boolean);
  }

  // Alte data.json-Versionen automatisch weiter unterstützen.
  if (entry.url) {
    return [entry.url];
  }

  return [];
}

function buildPanelEmbeds(members) {
  const lines = members.map((entry, index) => {
    const urls = getEntryUrls(entry);

    const socialLines = urls.map((url, urlIndex) => {
      const platform = platformName(url);
      const prefix = urlIndex === urls.length - 1 ? '└' : '├';
      return `${prefix} [${platform}](${url})`;
    });

    return `**${index + 1}.** <@${entry.userId}>\n${socialLines.join('\n')}`;
  });

  const chunks = [];
  let current = '';

  for (const line of lines) {
    const next = current ? `${current}\n\n${line}` : line;
    if (next.length > 3800) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  if (chunks.length === 0) chunks.push('*Noch keine Socials eingetragen.*');

  if (chunks.length > 10) {
    throw new Error('PANEL_TOO_LARGE');
  }

  return chunks.map((description, pageIndex) => {
    const embed = new EmbedBuilder()
      .setColor(0x111111)
      .setDescription(description)
      .setFooter({ text: `Socials • ${members.length} Mitglied${members.length === 1 ? '' : 'er'}` });

    if (pageIndex === 0) {
      embed
        .setTitle('🌐 Socials')
        .setDescription(
          `Hier findest du die Socials unserer Mitglieder.\n\n${description}`
        );
    }

    return embed;
  });
}

async function updatePanel(guild, data) {
  const channel = await guild.channels.fetch(config.panelChannelId).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    throw new Error('PANEL_CHANNEL_NOT_FOUND');
  }

  const sortedMembers = await sortMembersByRolePriority(guild, data.members);
  const embeds = buildPanelEmbeds(sortedMembers);
  let message = null;

  if (data.messageId) {
    // Immer direkt bei Discord prüfen. So wird keine bereits gelöschte
    // Panel-Nachricht aus dem lokalen Cache verwendet.
    message = await channel.messages
      .fetch(data.messageId, { force: true })
      .catch(() => null);
  }

  if (message) {
    try {
      await message.edit({ embeds });
      return message;
    } catch (error) {
      // Discord 10008 = Unknown Message: Das alte Panel wurde gelöscht.
      // In diesem Fall unten automatisch ein neues Panel erstellen.
      if (error?.code !== 10008) throw error;
      data.messageId = null;
    }
  }

  message = await channel.send({ embeds });
  data.messageId = message.id;
  saveData(data);
  return message;
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, async readyClient => {
  console.log(`✅ Eingeloggt als ${readyClient.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName('socials')
      .setDescription('Fügt Social-Links zu einer Discord-ID hinzu.')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('deletesocials')
      .setDescription('Entfernt eine Person komplett aus dem Socials-Panel.')
      .addStringOption(option =>
        option
          .setName('discord_id')
          .setDescription('Discord-ID der Person, die entfernt werden soll.')
          .setRequired(true)
      )
      .toJSON(),
  ];

  const rest = new REST({ version: '10' }).setToken(config.token);
  const applicationId = readyClient.application.id;
  const guilds = [...readyClient.guilds.cache.values()];

  if (guilds.length === 0) {
    console.error('❌ Der Bot ist auf keinem Discord-Server installiert. Lade ihn zuerst auf deinen Server ein.');
    return;
  }

  for (const guild of guilds) {
    try {
      await rest.put(
        Routes.applicationGuildCommands(applicationId, guild.id),
        { body: commands },
      );
      console.log(`✅ /socials und /deletesocials registriert auf ${guild.name} (${guild.id}).`);
    } catch (error) {
      console.error(`❌ Slash-Commands konnten auf ${guild.name} (${guild.id}) nicht registriert werden:`, error);
    }
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'deletesocials') {
      if (!interaction.inGuild()) {
        await interaction.reply({ content: '❌ Dieser Befehl funktioniert nur auf einem Server.', ephemeral: true });
        return;
      }

      if (!canManageSocials(interaction.member)) {
        await interaction.reply({ content: '❌ Du darfst das Socials-Panel nicht bearbeiten.', ephemeral: true });
        return;
      }

      const userId = interaction.options.getString('discord_id', true).trim();

      if (!isValidDiscordId(userId)) {
        await interaction.reply({ content: '❌ Die Discord-ID ist ungültig.', ephemeral: true });
        return;
      }

      const data = loadData();
      const existingIndex = data.members.findIndex(entry => entry.userId === userId);

      if (existingIndex === -1) {
        await interaction.reply({
          content: `❌ <@${userId}> ist nicht im Socials-Panel eingetragen.`,
          allowedMentions: { parse: [] },
          ephemeral: true,
        });
        return;
      }

      const previousMembers = JSON.parse(JSON.stringify(data.members));
      data.members.splice(existingIndex, 1);

      try {
        await updatePanel(interaction.guild, data);
        saveData(data);
      } catch (error) {
        data.members = previousMembers;
        saveData(data);

        if (error.message === 'PANEL_CHANNEL_NOT_FOUND') {
          await interaction.reply({ content: '❌ Der konfigurierte Panel-Channel wurde nicht gefunden.', ephemeral: true });
          return;
        }

        throw error;
      }

      await interaction.reply({
        content: `✅ <@${userId}> wurde komplett aus dem Socials-Panel entfernt.`,
        allowedMentions: { parse: [] },
        ephemeral: true,
      });
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'socials') {
      if (!interaction.inGuild()) {
        await interaction.reply({ content: '❌ Dieser Befehl funktioniert nur auf einem Server.', ephemeral: true });
        return;
      }

      if (!canManageSocials(interaction.member)) {
        await interaction.reply({ content: '❌ Du darfst das Socials-Panel nicht bearbeiten.', ephemeral: true });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId('socials_add_modal')
        .setTitle('Social hinzufügen');

      const discordIdInput = new TextInputBuilder()
        .setCustomId('discord_id')
        .setLabel('Discord ID')
        .setPlaceholder('z. B. 123456789012345678')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(17)
        .setMaxLength(20);

      const linkInput = new TextInputBuilder()
        .setCustomId('social_link')
        .setLabel('Social-Links (einer pro Zeile)')
        .setPlaceholder('https://youtube.com/@name\nhttps://tiktok.com/@name\nhttps://instagram.com/name')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(3000);

      modal.addComponents(
        new ActionRowBuilder().addComponents(discordIdInput),
        new ActionRowBuilder().addComponents(linkInput),
      );

      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'socials_add_modal') {
      if (!interaction.inGuild()) return;

      if (!canManageSocials(interaction.member)) {
        await interaction.reply({ content: '❌ Du darfst das Socials-Panel nicht bearbeiten.', ephemeral: true });
        return;
      }

      const userId = interaction.fields.getTextInputValue('discord_id').trim();
      const rawLinks = interaction.fields.getTextInputValue('social_link').trim();

      if (!isValidDiscordId(userId)) {
        await interaction.reply({ content: '❌ Die Discord-ID ist ungültig.', ephemeral: true });
        return;
      }

      const submittedLinks = rawLinks
        .split(/\r?\n/)
        .map(value => value.trim())
        .filter(Boolean);

      if (submittedLinks.length === 0) {
        await interaction.reply({ content: '❌ Bitte gib mindestens einen Link ein.', ephemeral: true });
        return;
      }

      if (submittedLinks.length > 10) {
        await interaction.reply({ content: '❌ Du kannst pro Vorgang maximal 10 Links hinzufügen.', ephemeral: true });
        return;
      }

      const normalizedLinks = [];
      for (const rawLink of submittedLinks) {
        const normalized = normalizeUrl(rawLink);
        if (!normalized) {
          await interaction.reply({
            content: `❌ Ungültiger Link: ${rawLink}\nJeder Link muss mit http:// oder https:// beginnen.`,
            ephemeral: true,
          });
          return;
        }

        if (!normalizedLinks.includes(normalized)) {
          normalizedLinks.push(normalized);
        }
      }

      const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
      if (!targetMember) {
        await interaction.reply({ content: '❌ Diese Discord-ID gehört zu keinem Mitglied auf diesem Server.', ephemeral: true });
        return;
      }

      const data = loadData();
      const existingIndex = data.members.findIndex(entry => entry.userId === userId);
      const isNewMember = existingIndex === -1;

      // Snapshot für Rollback, falls das Panel nicht aktualisiert werden kann.
      const previousMembers = JSON.parse(JSON.stringify(data.members));

      let addedCount = 0;

      if (isNewMember) {
        data.members.push({
          userId,
          urls: normalizedLinks,
          addedAt: new Date().toISOString(),
        });
        addedCount = normalizedLinks.length;
      } else {
        const entry = data.members[existingIndex];
        const existingUrls = getEntryUrls(entry);
        const linksToAdd = normalizedLinks.filter(url => !existingUrls.includes(url));

        if (linksToAdd.length === 0) {
          await interaction.reply({
            content: `ℹ️ Alle angegebenen Links sind bei <@${userId}> bereits eingetragen.`,
            allowedMentions: { parse: [] },
            ephemeral: true,
          });
          return;
        }

        entry.urls = [...existingUrls, ...linksToAdd];
        delete entry.url;
        addedCount = linksToAdd.length;
      }

      try {
        await updatePanel(interaction.guild, data);
        saveData(data);
      } catch (error) {
        data.members = previousMembers;
        saveData(data);

        if (error.message === 'PANEL_CHANNEL_NOT_FOUND') {
          await interaction.reply({ content: '❌ Der konfigurierte Panel-Channel wurde nicht gefunden.', ephemeral: true });
          return;
        }

        if (error.message === 'PANEL_TOO_LARGE') {
          await interaction.reply({ content: '❌ Das Socials-Panel ist voll. Es passen keine weiteren Einträge in eine Discord-Nachricht.', ephemeral: true });
          return;
        }

        throw error;
      }

      // Nur bei einem komplett neuen Mitglied kurz pingen.
      if (isNewMember) {
        const channel = await interaction.guild.channels.fetch(config.panelChannelId).catch(() => null);
        if (channel && channel.isTextBased()) {
          const pingMessage = await channel.send({
            content: `📌 <@${userId}> wurde zu den Socials hinzugefügt.`,
            allowedMentions: { users: [userId] },
          }).catch(() => null);

          if (pingMessage) {
            setTimeout(() => pingMessage.delete().catch(() => {}), 5000);
          }
        }
      }

      await interaction.reply({
        content: isNewMember
          ? `✅ <@${userId}> wurde mit ${addedCount} Link${addedCount === 1 ? '' : 's'} zum Socials-Panel hinzugefügt und nach Rolle einsortiert.`
          : `✅ ${addedCount} weitere${addedCount === 1 ? 'r Link' : ' Links'} wurden bei <@${userId}> hinzugefügt.`,
        allowedMentions: { parse: [] },
        ephemeral: true,
      });
    }
  } catch (error) {
    console.error(error);

    const message = '❌ Es ist ein Fehler aufgetreten. Prüfe die Bot-Konsole und die Berechtigungen.';

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  }
});

client.login(config.token);
