'use strict';

const fs = require('fs');
const {
  Client,
  Events,
  REST,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const { Pool } = require('pg');

const TURBO_GUARD_VERSION = '5.13.2';
const startedAt = Date.now();
const recentErrors = [];
const MAX_ERRORS = 30;

let activeClient = null;
let crashReportBusy = false;

const actionStats = {
  seen: 0,
  autoDeferred: 0,
  failures: 0,
  lastAction: null,
  lastActionAt: null,
};

function turboErrorId() {
  return `TG-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(16).slice(2, 6).toUpperCase()}`;
}

function cleanError(error) {
  return {
    message: String(error?.message || error || 'Unbekannter Fehler').slice(0, 1200),
    stack: String(error?.stack || error || '').slice(0, 4500),
    code: error?.code ?? null,
  };
}

function rememberError(kind, error, context = {}) {
  const normalized = cleanError(error);
  const entry = {
    id: turboErrorId(),
    kind,
    at: Date.now(),
    message: normalized.message,
    stack: normalized.stack,
    code: normalized.code,
    context,
  };

  recentErrors.unshift(entry);
  if (recentErrors.length > MAX_ERRORS) recentErrors.length = MAX_ERRORS;
  return entry;
}

async function sendGuardErrorToDiscord(entry) {
  if (!activeClient?.isReady?.() || crashReportBusy) return;

  crashReportBusy = true;
  try {
    for (const guild of activeClient.guilds.cache.values()) {
      const channel =
        guild.channels.cache.find(ch => ch?.name === '📋・logs' && ch.isTextBased?.())
        || guild.channels.cache.find(ch => ch?.name === '🤖・automation-log' && ch.isTextBased?.());

      if (!channel) continue;

      const contextText = Object.entries(entry.context || {})
        .map(([key, value]) => `${key}=${String(value).slice(0, 120)}`)
        .join(' | ');

      await channel.send({
        embeds: [{
          title: `🚨 Turbo Guard • ${entry.id}`,
          description: [
            `**Typ:** ${entry.kind}`,
            `**Fehler:** ${entry.message}`,
            contextText ? `**Kontext:** ${contextText}` : null,
            '',
            '```',
            entry.stack.slice(0, 3000) || 'Kein Stacktrace verfügbar.',
            '```',
          ].filter(Boolean).join('\n').slice(0, 3900),
          color: 0xed4245,
          timestamp: new Date(entry.at).toISOString(),
          footer: { text: `Turbo Designs Guard v${TURBO_GUARD_VERSION}` },
        }],
        allowedMentions: { parse: [] },
      }).catch(() => {});
    }
  } finally {
    crashReportBusy = false;
  }
}

function logGuardError(kind, error, context = {}) {
  const entry = rememberError(kind, error, context);
  console.error(`❌ [${entry.id}] ${kind}:`, error);
  void sendGuardErrorToDiscord(entry);
  return entry;
}

// CRASH GUARD
process.on('unhandledRejection', (reason, promise) => {
  logGuardError('unhandledRejection', reason, {
    promise: String(promise).slice(0, 180),
  });
});

process.on('uncaughtException', (error, origin) => {
  const entry = logGuardError('uncaughtException', error, { origin });

  setTimeout(() => {
    console.error(`🛑 [${entry.id}] Fataler Fehler – sauberer Railway-Neustart.`);
    process.exit(1);
  }, 1500).unref?.();
});

// /DIAGNOSE + COMMAND LIMIT GUARD
const diagnoseCommand = {
  name: 'diagnose',
  description: 'Prüft Bot, Datenbank, Speicher und Discord-Berechtigungen.',
  type: 1,
  default_member_permissions: PermissionFlagsBits.ManageGuild.toString(),
  dm_permission: false,
};

const realRestPut = REST.prototype.put;
REST.prototype.put = function turboGuardRestPut(route, options = {}) {
  if (Array.isArray(options?.body)) {
    const looksLikeCommandList = options.body.some(command =>
      ['setup', 'sell', 'paypal', 'help', 'command'].includes(command?.name),
    );

    if (looksLikeCommandList) {
      const seen = new Set();
      let body = options.body.filter(command => {
        const name = String(command?.name || '');
        if (!name || seen.has(name)) return false;
        seen.add(name);
        return true;
      });

      // Discord allows a maximum of 100 guild application commands.
      // The current bot already uses all 100 slots without the standalone
      // /diagnose command. /sell diagnose provides the same shop diagnosis.
      if (!body.some(command => command?.name === 'diagnose') && body.length < 100) {
        body = [...body, diagnoseCommand];
      } else if (!body.some(command => command?.name === 'diagnose') && body.length >= 100) {
        console.log(`ℹ️ Command-Limit: ${body.length}/100 – separates /diagnose wird nicht registriert. Nutze /sell diagnose.`);
      }

      if (body.length > 100) {
        throw new Error(`Discord Command-Limit überschritten: ${body.length}/100. Keine Commands wurden registriert.`);
      }

      console.log(`✅ Discord Commands vorbereitet: ${body.length}/100`);
      options = { ...options, body };
    }
  }

  return realRestPut.call(this, route, options);
};

// Keep the old/main command router away from /diagnose.
const realClientOn = Client.prototype.on;
Client.prototype.on = function turboGuardClientOn(eventName, listener) {
  if (eventName === Events.InteractionCreate) {
    return realClientOn.call(this, eventName, async function turboGuardWrappedInteraction(interaction, ...args) {
      if (interaction.isChatInputCommand?.() && interaction.commandName === 'diagnose') return;
      return listener.call(this, interaction, ...args);
    });
  }

  return realClientOn.call(this, eventName, listener);
};

// INTERACTION RESPONSE COMPATIBILITY
function normalizeInteractionPayload(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return options;
  if (!Object.prototype.hasOwnProperty.call(options, 'ephemeral')) return options;

  const payload = { ...options };
  if (payload.ephemeral === true && payload.flags == null) {
    payload.flags = MessageFlags.Ephemeral;
  }
  delete payload.ephemeral;
  return payload;
}

function installInteractionResponseNormalizer(interaction) {
  if (interaction.__turboResponseNormalizer) return;
  interaction.__turboResponseNormalizer = true;

  for (const method of ['reply', 'deferReply', 'followUp']) {
    if (typeof interaction[method] !== 'function') continue;
    const original = interaction[method].bind(interaction);
    interaction[method] = function turboNormalizedInteractionResponse(options, ...args) {
      return original(normalizeInteractionPayload(options), ...args);
    };
  }
}

// ACTION WATCHDOG
function shouldAutoDefer(interaction) {
  const id = String(interaction?.customId || '');

  // Known slash commands that can perform Discord API work before their first
  // reply. Their confirmation replies are intentionally ephemeral.
  if (interaction.isChatInputCommand?.()) {
    const command = String(interaction.commandName || '');
    if (['giveaway', 'announce', 'poll', 'suggest'].includes(command)) return true;
  }

  // Modal submits cannot open another modal and are safe to acknowledge early.
  if (interaction.isModalSubmit?.() && id.startsWith('selling_')) return true;

  if (!interaction.isButton?.()) return false;

  return (
    id.startsWith('selling_priority_cycle:')
    || id.startsWith('selling_express:')
    || id.startsWith('selling_portfolio_consent:')
    || id.startsWith('selling_staff:')
  );
}

function installDeferredReplyBridge(interaction) {
  if (
    interaction.__turboGuardDeferred
    || interaction.deferred
    || interaction.replied
  ) return;

  interaction.__turboGuardDeferred = true;
  actionStats.autoDeferred += 1;

  const originalReply = interaction.reply.bind(interaction);
  const originalDeferReply = interaction.deferReply.bind(interaction);

  const deferPromise = originalDeferReply({ flags: MessageFlags.Ephemeral });

  deferPromise.catch(error => {
    actionStats.failures += 1;
    logGuardError('action-watchdog-defer', error, {
      action: interaction.commandName || interaction.customId || 'unknown',
      guild: interaction.guildId || 'DM',
      channel: interaction.channelId || 'unknown',
      user: interaction.user?.id || 'unknown',
    });
  });

  interaction.deferReply = async function turboGuardDeferAgain(options) {
    try {
      await deferPromise;
      if (interaction.deferred) return;
    } catch {
      // Retry the handler's own defer below if the watchdog defer failed.
    }
    return originalDeferReply(normalizeInteractionPayload(options));
  };

  interaction.reply = async function turboGuardReply(options) {
    try {
      await deferPromise;
    } catch {
      // Fall back to the original reply if the defer was rejected.
    }

    if (interaction.deferred) {
      if (typeof options === 'string') {
        return interaction.editReply({ content: options });
      }

      const payload = options && typeof options === 'object'
        ? { ...options }
        : { content: String(options ?? '') };

      delete payload.ephemeral;
      delete payload.flags;
      return interaction.editReply(payload);
    }

    if (interaction.replied) {
      if (typeof options === 'string') {
        return interaction.followUp({ content: options, flags: MessageFlags.Ephemeral });
      }
      return interaction.followUp(normalizeInteractionPayload(options || {}));
    }

    return originalReply(normalizeInteractionPayload(options));
  };
}

// DIAGNOSTICS
function masterUserIds() {
  return new Set(
    String(process.env.MASTER_USER_IDS || '')
      .split(/[,\s;]+/)
      .map(value => value.trim())
      .filter(Boolean),
  );
}

function canRunDiagnose(interaction) {
  if (masterUserIds().has(String(interaction.user?.id || ''))) return true;

  const perms = interaction.member?.permissions;
  return Boolean(
    perms?.has?.(PermissionFlagsBits.Administrator)
    || perms?.has?.(PermissionFlagsBits.ManageGuild),
  );
}

function yesNo(value) {
  return value ? '✅' : '❌';
}

function formatDuration(ms) {
  let seconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

  return [
    days ? `${days}d` : null,
    hours ? `${hours}h` : null,
    minutes ? `${minutes}m` : null,
    `${seconds}s`,
  ].filter(Boolean).join(' ');
}

async function databaseDiagnostic() {
  const connectionString =
    process.env.DATABASE_URL
    || process.env.POSTGRES_URL
    || process.env.POSTGRESQL_URL
    || null;

  if (!connectionString) {
    return {
      configured: false,
      ok: true,
      label: 'JSON-Fallback (keine PostgreSQL-URL gesetzt)',
      latencyMs: null,
    };
  }

  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 3500,
    idleTimeoutMillis: 1000,
  });

  const started = Date.now();

  try {
    await pool.query('SELECT 1 AS turbo_guard_health');
    return {
      configured: true,
      ok: true,
      label: 'PostgreSQL erreichbar',
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      label: `PostgreSQL Fehler: ${String(error?.message || error).slice(0, 180)}`,
      latencyMs: Date.now() - started,
    };
  } finally {
    await pool.end().catch(() => {});
  }
}

function storageDiagnostic() {
  const directory =
    process.env.RAILWAY_VOLUME_MOUNT_PATH
    || process.env.DATA_DIR
    || __dirname;

  try {
    fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
    return {
      ok: true,
      directory,
      label: 'Lesen + Schreiben möglich',
    };
  } catch (error) {
    return {
      ok: false,
      directory,
      label: String(error?.message || error).slice(0, 180),
    };
  }
}

function environmentDiagnostic() {
  return {
    discordToken: Boolean(process.env.DISCORD_TOKEN),
    githubWebhook: Boolean(process.env.GITHUB_WEBHOOK_SECRET),
    twitchConfigured: Boolean(
      process.env.TWITCH_CLIENT_ID
      && process.env.TWITCH_CLIENT_SECRET
      && String(process.env.STREAM_ENABLED || '').toLowerCase() !== 'false'
    ),
    publicBaseUrl: Boolean(
      process.env.PUBLIC_BASE_URL
      || process.env.RAILWAY_PUBLIC_DOMAIN
    ),
    volume: Boolean(
      process.env.RAILWAY_VOLUME_MOUNT_PATH
      || process.env.DATA_DIR
    ),
  };
}

async function handleDiagnose(interaction) {
  if (!interaction.inGuild?.()) {
    await interaction.reply({
      content: '❌ `/diagnose` kann nur auf einem Server verwendet werden.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return;
  }

  if (!canRunDiagnose(interaction)) {
    await interaction.reply({
      content: '❌ `/diagnose` ist nur für Management/Administratoren verfügbar.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild;
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  const db = await databaseDiagnostic();
  const storage = storageDiagnostic();
  const env = environmentDiagnostic();

  const guildPerms = me?.permissions;
  const channelPerms = interaction.channel?.permissionsFor?.(me);

  const guildChecks = [
    ['Server verwalten', PermissionFlagsBits.ManageGuild],
    ['Kanäle verwalten', PermissionFlagsBits.ManageChannels],
    ['Rollen verwalten', PermissionFlagsBits.ManageRoles],
    ['Audit-Log sehen', PermissionFlagsBits.ViewAuditLog],
    ['Webhooks verwalten', PermissionFlagsBits.ManageWebhooks],
    ['Mitglieder kicken', PermissionFlagsBits.KickMembers],
    ['Mitglieder bannen', PermissionFlagsBits.BanMembers],
  ];

  const channelChecks = [
    ['Channel sehen', PermissionFlagsBits.ViewChannel],
    ['Nachrichten senden', PermissionFlagsBits.SendMessages],
    ['Verlauf lesen', PermissionFlagsBits.ReadMessageHistory],
    ['Embeds senden', PermissionFlagsBits.EmbedLinks],
    ['Dateien senden', PermissionFlagsBits.AttachFiles],
  ];

  const guildText = guildChecks
    .map(([name, bit]) => `${yesNo(Boolean(guildPerms?.has?.(bit)))} ${name}`)
    .join('\n');

  const channelText = channelChecks
    .map(([name, bit]) => `${yesNo(Boolean(channelPerms?.has?.(bit)))} ${name}`)
    .join('\n');

  const memory = process.memoryUsage();
  const lastError = recentErrors[0];

  const fields = [
    {
      name: '🤖 Bot',
      value: [
        `${yesNo(activeClient?.isReady?.())} Discord verbunden`,
        `🏓 Ping: **${Number.isFinite(activeClient?.ws?.ping) ? `${activeClient.ws.ping} ms` : '—'}**`,
        `⏱️ Uptime: **${formatDuration(Date.now() - startedAt)}**`,
        `📦 Guard: **v${TURBO_GUARD_VERSION}**`,
        `🧠 RAM: **${Math.round(memory.rss / 1024 / 1024)} MB RSS**`,
      ].join('\n'),
      inline: false,
    },
    {
      name: '🗄️ Datenbank',
      value: [
        `${yesNo(db.ok)} ${db.label}`,
        db.latencyMs !== null ? `Latenz: **${db.latencyMs} ms**` : null,
      ].filter(Boolean).join('\n'),
      inline: false,
    },
    {
      name: '💾 Speicher',
      value: [
        `${yesNo(storage.ok)} ${storage.label}`,
        `Pfad: \`${storage.directory}\``,
      ].join('\n').slice(0, 1024),
      inline: false,
    },
    {
      name: '🛡️ Server-Rechte',
      value: guildText.slice(0, 1024),
      inline: true,
    },
    {
      name: '💬 Channel-Rechte',
      value: channelText.slice(0, 1024),
      inline: true,
    },
    {
      name: '⚙️ Umgebung',
      value: [
        `${yesNo(env.discordToken)} Discord Token`,
        `${yesNo(env.publicBaseUrl)} Öffentliche Download-URL`,
        `${yesNo(env.volume)} Persistenter Datenspeicher`,
        `${env.githubWebhook ? '✅' : '⚪'} GitHub Webhook`,
        `${env.twitchConfigured ? '✅' : '⚪'} Twitch Integration`,
      ].join('\n'),
      inline: false,
    },
    {
      name: '⚡ Action-Watchdog',
      value: [
        `Actions gesehen: **${actionStats.seen}**`,
        `Automatisch bestätigt: **${actionStats.autoDeferred}**`,
        `Watchdog-Fehler: **${actionStats.failures}**`,
        actionStats.lastAction ? `Letzte Action: \`${actionStats.lastAction}\`` : 'Letzte Action: —',
      ].join('\n'),
      inline: false,
    },
    {
      name: '🚨 Letzter Guard-Fehler',
      value: lastError
        ? [
            `ID: \`${lastError.id}\``,
            `Typ: **${lastError.kind}**`,
            `Fehler: ${lastError.message}`,
            `<t:${Math.floor(lastError.at / 1000)}:R>`,
          ].join('\n').slice(0, 1024)
        : '✅ Seit diesem Start wurde kein Guard-Fehler erfasst.',
      inline: false,
    },
  ];

  const criticalOk =
    Boolean(activeClient?.isReady?.())
    && env.discordToken
    && env.publicBaseUrl
    && db.ok
    && storage.ok
    && Boolean(guildPerms?.has?.(PermissionFlagsBits.ManageChannels))
    && Boolean(guildPerms?.has?.(PermissionFlagsBits.ManageRoles))
    && Boolean(channelPerms?.has?.(PermissionFlagsBits.SendMessages));

  await interaction.editReply({
    embeds: [{
      title: `${criticalOk ? '✅' : '⚠️'} Turbo Designs • Diagnose`,
      description: criticalOk
        ? 'Die wichtigsten Bot-Systeme sehen aktuell funktionsfähig aus.'
        : 'Mindestens eine wichtige Prüfung ist fehlgeschlagen. Siehe Details unten.',
      fields,
      color: criticalOk ? 0x57f287 : 0xfee75c,
      timestamp: new Date().toISOString(),
      footer: { text: `Turbo Designs Guard v${TURBO_GUARD_VERSION}` },
    }],
    allowedMentions: { parse: [] },
  });
}

// CLIENT HOOK
const realLogin = Client.prototype.login;

Client.prototype.login = function turboGuardLogin(...args) {
  activeClient = this;

  if (!this.__turboGuardInstalled) {
    this.__turboGuardInstalled = true;

    this.prependListener(Events.InteractionCreate, async interaction => {
      installInteractionResponseNormalizer(interaction);

      const actionName =
        interaction.commandName
        || interaction.customId
        || interaction.type
        || 'unknown';

      actionStats.seen += 1;
      actionStats.lastAction = String(actionName).slice(0, 100);
      actionStats.lastActionAt = Date.now();

      if (interaction.isChatInputCommand?.() && interaction.commandName === 'diagnose') {
        try {
          await handleDiagnose(interaction);
        } catch (error) {
          actionStats.failures += 1;
          const entry = logGuardError('diagnose', error, {
            guild: interaction.guildId || 'unknown',
            channel: interaction.channelId || 'unknown',
            user: interaction.user?.id || 'unknown',
          });

          const payload = {
            content: `❌ Diagnose fehlgeschlagen. Fehler-ID: \`${entry.id}\``,
            flags: MessageFlags.Ephemeral,
          };

          if (interaction.deferred || interaction.replied) {
            await interaction.followUp(payload).catch(() => {});
          } else {
            await interaction.reply(payload).catch(() => {});
          }
        }
        return;
      }

      if (shouldAutoDefer(interaction)) {
        installDeferredReplyBridge(interaction);
      }
    });
  }

  return realLogin.apply(this, args);
};

console.log(`✅ Turbo Designs Guard v${TURBO_GUARD_VERSION} geladen`);

// Load the existing bot without rewriting its source code.
require('./selling-entry.js');
