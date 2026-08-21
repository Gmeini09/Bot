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

function buildPanelEmbeds(members) {
  const lines = members.map((entry, index) => {
    const platform = platformName(entry.url);
    return `**${index + 1}.** <@${entry.userId}>\n└ [${platform}](${entry.url})`;
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

  const embeds = buildPanelEmbeds(data.members);
  let message = null;

  if (data.messageId) {
    message = await channel.messages.fetch(data.messageId).catch(() => null);
  }

  if (message) {
    await message.edit({ embeds });
    return message;
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

  try {
    const commands = [
      new SlashCommandBuilder()
        .setName('socials')
        .setDescription('Fügt eine Person mit Social-Link zum Socials-Panel hinzu.')
        .toJSON(),
    ];

    const rest = new REST({ version: '10' }).setToken(config.token);
    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commands },
    );
    console.log('✅ /socials wurde automatisch registriert.');
  } catch (error) {
    console.error('❌ Slash-Command konnte nicht registriert werden:', error);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
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
        .setLabel('YouTube / TikTok / anderer Link')
        .setPlaceholder('https://youtube.com/@name')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(500);

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
      const rawUrl = interaction.fields.getTextInputValue('social_link').trim();

      if (!isValidDiscordId(userId)) {
        await interaction.reply({ content: '❌ Die Discord-ID ist ungültig.', ephemeral: true });
        return;
      }

      const url = normalizeUrl(rawUrl);
      if (!url) {
        await interaction.reply({ content: '❌ Bitte gib einen gültigen http:// oder https:// Link ein.', ephemeral: true });
        return;
      }

      const targetMember = await interaction.guild.members.fetch(userId).catch(() => null);
      if (!targetMember) {
        await interaction.reply({ content: '❌ Diese Discord-ID gehört zu keinem Mitglied auf diesem Server.', ephemeral: true });
        return;
      }

      const data = loadData();
      const existingIndex = data.members.findIndex(entry => entry.userId === userId);

      if (existingIndex !== -1) {
        await interaction.reply({
          content: `❌ <@${userId}> ist bereits im Socials-Panel eingetragen.`,
          allowedMentions: { parse: [] },
          ephemeral: true,
        });
        return;
      }

      const newEntry = {
        userId,
        url,
        addedAt: new Date().toISOString(),
      };

      data.members.push(newEntry);

      try {
        await updatePanel(interaction.guild, data);
        saveData(data);
      } catch (error) {
        data.members = data.members.filter(entry => entry !== newEntry);
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

      // Sichtbarer Eintrag im Panel + echte kurze Benachrichtigung im Panel-Channel.
      // Dadurch wird die Person beim Hinzufügen tatsächlich @-gepingt.
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

      await interaction.reply({
        content: `✅ <@${userId}> wurde unten zum Socials-Panel hinzugefügt.`,
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
