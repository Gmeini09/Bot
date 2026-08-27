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
const COMMUNITY_CHECK_INTERVAL_MS = 60 * 1000;
const REP_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const COMMUNITY_TIMEZONE = process.env.COMMUNITY_TIMEZONE || 'Europe/Vienna';
const verifyChallenges = new Map();
const refreshRunningGuilds = new Set();
const suggestionSourceDeletes = new Set();
const messageRateLimits = new Map();
const joinBursts = new Map();
const inviteCache = new Map();
const challengeRateLimits = new Map();

const DEFAULT_DAILY_QUESTIONS = [
  'Was war heute dein lustigster Moment?',
  'Welches Spiel könntest du immer wieder spielen?',
  'Welche Funktion wünschst du dir für unsere Community?',
  'Was ist dein bisher schönster Moment auf dem Server?',
  'Mit welchem Community-Mitglied würdest du gerne einmal zocken?',
  'Welche Musik hörst du aktuell am häufigsten?',
  'Was darf bei einem perfekten Spieleabend nicht fehlen?',
  'Welche Stadt oder welches Land möchtest du einmal besuchen?',
  'Was ist dein Lieblingsfahrzeug in GTA oder FiveM?',
  'Welche drei Dinge würdest du auf eine einsame Insel mitnehmen?',
  'Welchen Beruf würdest du gerne einmal ausprobieren?',
  'Was war dein erstes richtiges Lieblingsspiel?',
  'Welche Superkraft hättest du gerne?',
  'Was motiviert dich momentan am meisten?',
  'Welches Community-Event sollen wir als Nächstes veranstalten?',
  'Bist du eher Team Tag oder Team Nacht?',
  'Welche Serie oder welchen Film kannst du empfehlen?',
  'Was ist dein größtes Talent?',
  'Welche kleine Sache macht deinen Tag sofort besser?',
  'Wie bist du auf unsere Community aufmerksam geworden?',
];

const DEFAULT_COMMUNITY_POLLS = [
  { question: 'Welches Community-Event wollt ihr als Nächstes?', options: ['Gamenight', 'Quiz', 'Turnier', 'Talkrunde'] },
  { question: 'Wann habt ihr am meisten Zeit?', options: ['Unter der Woche', 'Freitag', 'Samstag', 'Sonntag'] },
  { question: 'Was nutzt ihr auf dem Discord am häufigsten?', options: ['Textchat', 'Voice', 'Events', 'FiveM'] },
  { question: 'Welche Event-Dauer findet ihr am besten?', options: ['30 Minuten', '1 Stunde', '2 Stunden', 'Offenes Ende'] },
  { question: 'Wie möchtet ihr über Neuigkeiten informiert werden?', options: ['Ankündigungen', 'Ping-Rolle', 'Event-Erinnerung', 'Alles davon'] },
];

const QUIZ_QUESTIONS = [
  { question: 'Wie viele Minuten hat eine Stunde?', options: ['30', '45', '60', '90'], answer: 2 },
  { question: 'Welche Farbe entsteht aus Blau und Gelb?', options: ['Rot', 'Grün', 'Lila', 'Orange'], answer: 1 },
  { question: 'Wie heißt die Hauptstadt von Österreich?', options: ['Graz', 'Salzburg', 'Wien', 'Linz'], answer: 2 },
  { question: 'Welcher Planet ist der Sonne am nächsten?', options: ['Erde', 'Mars', 'Merkur', 'Venus'], answer: 2 },
  { question: 'Wie viele Seiten hat ein Würfel?', options: ['4', '6', '8', '12'], answer: 1 },
  { question: 'Wofür steht die Abkürzung CPU?', options: ['Central Processing Unit', 'Computer Personal User', 'Core Power Utility', 'Control Program Unit'], answer: 0 },
  { question: 'Welches Tier ist das größte an Land?', options: ['Giraffe', 'Elefant', 'Nashorn', 'Bär'], answer: 1 },
  { question: 'Wie viele Tage hat ein Schaltjahr?', options: ['364', '365', '366', '367'], answer: 2 },
  { question: 'Welche Zahl ist eine Primzahl?', options: ['9', '15', '17', '21'], answer: 2 },
  { question: 'Welche Sprache wird hauptsächlich für Discord-Bots mit discord.js genutzt?', options: ['Java', 'JavaScript', 'C', 'Swift'], answer: 1 },
];

const BADGES = {
  first_message: { emoji: '👋', name: 'Erste Schritte', description: 'Erste Community-Nachricht geschrieben' },
  chat_100: { emoji: '💬', name: 'Chatfreund', description: '100 Community-Nachrichten geschrieben' },
  chat_1000: { emoji: '🗣️', name: 'Stammgast', description: '1.000 Community-Nachrichten geschrieben' },
  voice_5h: { emoji: '🎧', name: 'Voice-Fan', description: '5 Stunden im Voice verbracht' },
  voice_50h: { emoji: '🎙️', name: 'Voice-Legende', description: '50 Stunden im Voice verbracht' },
  rep_10: { emoji: '💜', name: 'Beliebt', description: '10 Reputationspunkte erhalten' },
  invites_5: { emoji: '🔗', name: 'Community-Werber', description: '5 aktive Mitglieder eingeladen' },
  quiz_10: { emoji: '🧠', name: 'Quiz-Profi', description: '10 Quizfragen richtig beantwortet' },
  clip_winner: { emoji: '🎬', name: 'Clip-Champion', description: 'Clip der Woche gewonnen' },
  challenge_100: { emoji: '🤝', name: 'Community-Helfer', description: '100 Punkte zu Challenges beigetragen' },
};

function defaultData() {
  return {
    version: 9,
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
      questionChannelId: null,
      communityPollChannelId: null,
      memberOfMonthChannelId: null,
      memberOfMonthRoleId: null,
      clipChannelId: null,
      lfgChannelId: null,
      challengeChannelId: null,
      anonymousInboxChannelId: null,
      interestsChannelId: null,
      engagementChannelId: null,
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
    dailyQuestions: {
      enabled: false,
      hour: 12,
      questions: [],
      nextIndex: 0,
      lastPostedDate: null,
    },
    communityPolls: {
      enabled: false,
      cadence: 'weekly',
      hour: 18,
      weekday: 5,
      templates: [],
      nextIndex: 0,
      lastPostedKey: null,
      active: {},
    },
    memberOfMonth: {
      enabled: false,
      lastAwardedMonth: null,
      currentWinnerId: null,
      history: {},
    },
    activity: {
      months: {},
      totals: {},
      voiceActive: {},
    },
    reputation: {
      users: {},
      givers: {},
    },
    clips: {
      enabled: false,
      activeWeek: null,
      lastFinishedWeek: null,
      submissions: {},
      winners: {},
    },
    lfg: {},
    challenges: {},
    games: {
      channels: {},
      quizzes: {},
      quizScores: {},
    },
    achievements: {},
    anonymous: {
      submissions: {},
    },
    profiles: {},
    interests: {
      options: [],
      panelMessageId: null,
    },
    serverBackups: {},
    setupHistory: {},
    engagement: {
      enabled: false,
      wallets: {},
      shop: {},
      missions: { users: {} },
      seasons: {},
      stats: { days: {} },
      drop: { activeId: null, messageId: null, channelId: null, reward: 0, expiresAt: 0, lastDropAt: 0, claimedBy: null },
      activityPanelMessageId: null,
    },
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
  base.dailyQuestions = {
    ...base.dailyQuestions,
    ...(raw?.dailyQuestions && typeof raw.dailyQuestions === 'object' ? raw.dailyQuestions : {}),
    questions: Array.isArray(raw?.dailyQuestions?.questions) ? raw.dailyQuestions.questions : [],
  };
  base.communityPolls = {
    ...base.communityPolls,
    ...(raw?.communityPolls && typeof raw.communityPolls === 'object' ? raw.communityPolls : {}),
    templates: Array.isArray(raw?.communityPolls?.templates) ? raw.communityPolls.templates : [],
    active: raw?.communityPolls?.active && typeof raw.communityPolls.active === 'object' ? raw.communityPolls.active : {},
  };
  base.memberOfMonth = {
    ...base.memberOfMonth,
    ...(raw?.memberOfMonth && typeof raw.memberOfMonth === 'object' ? raw.memberOfMonth : {}),
    history: raw?.memberOfMonth?.history && typeof raw.memberOfMonth.history === 'object' ? raw.memberOfMonth.history : {},
  };
  base.activity = {
    months: raw?.activity?.months && typeof raw.activity.months === 'object' ? raw.activity.months : {},
    totals: raw?.activity?.totals && typeof raw.activity.totals === 'object' ? raw.activity.totals : {},
    voiceActive: raw?.activity?.voiceActive && typeof raw.activity.voiceActive === 'object' ? raw.activity.voiceActive : {},
  };
  base.reputation = {
    users: raw?.reputation?.users && typeof raw.reputation.users === 'object' ? raw.reputation.users : {},
    givers: raw?.reputation?.givers && typeof raw.reputation.givers === 'object' ? raw.reputation.givers : {},
  };
  base.clips = {
    ...base.clips,
    ...(raw?.clips && typeof raw.clips === 'object' ? raw.clips : {}),
    submissions: raw?.clips?.submissions && typeof raw.clips.submissions === 'object' ? raw.clips.submissions : {},
    winners: raw?.clips?.winners && typeof raw.clips.winners === 'object' ? raw.clips.winners : {},
  };
  base.lfg = raw?.lfg && typeof raw.lfg === 'object' ? raw.lfg : {};
  base.challenges = raw?.challenges && typeof raw.challenges === 'object' ? raw.challenges : {};
  base.games = {
    channels: raw?.games?.channels && typeof raw.games.channels === 'object' ? raw.games.channels : {},
    quizzes: raw?.games?.quizzes && typeof raw.games.quizzes === 'object' ? raw.games.quizzes : {},
    quizScores: raw?.games?.quizScores && typeof raw.games.quizScores === 'object' ? raw.games.quizScores : {},
  };
  base.achievements = raw?.achievements && typeof raw.achievements === 'object' ? raw.achievements : {};
  base.anonymous = {
    submissions: raw?.anonymous?.submissions && typeof raw.anonymous.submissions === 'object' ? raw.anonymous.submissions : {},
  };
  base.profiles = raw?.profiles && typeof raw.profiles === 'object' ? raw.profiles : {};
  base.interests = {
    options: Array.isArray(raw?.interests?.options) ? raw.interests.options : [],
    panelMessageId: raw?.interests?.panelMessageId || null,
  };
  base.serverBackups = raw?.serverBackups && typeof raw.serverBackups === 'object' ? raw.serverBackups : {};
  base.setupHistory = raw?.setupHistory && typeof raw.setupHistory === 'object' ? raw.setupHistory : {};
  base.engagement = {
    ...base.engagement,
    ...(raw?.engagement && typeof raw.engagement === 'object' ? raw.engagement : {}),
    wallets: raw?.engagement?.wallets && typeof raw.engagement.wallets === 'object' ? raw.engagement.wallets : {},
    shop: raw?.engagement?.shop && typeof raw.engagement.shop === 'object' ? raw.engagement.shop : {},
    missions: {
      users: raw?.engagement?.missions?.users && typeof raw.engagement.missions.users === 'object' ? raw.engagement.missions.users : {},
    },
    seasons: raw?.engagement?.seasons && typeof raw.engagement.seasons === 'object' ? raw.engagement.seasons : {},
    stats: {
      days: raw?.engagement?.stats?.days && typeof raw.engagement.stats.days === 'object' ? raw.engagement.stats.days : {},
    },
    drop: {
      ...base.engagement.drop,
      ...(raw?.engagement?.drop && typeof raw.engagement.drop === 'object' ? raw.engagement.drop : {}),
    },
    activityPanelMessageId: raw?.engagement?.activityPanelMessageId || null,
  };
  base.version = 9;
  return base;
}

function readRootData() {
  try {
    if (!fs.existsSync(dataPath)) {
      const fresh = defaultData();
      fresh.guilds = {};
      return fresh;
    }
    const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    const root = normalizeData(raw);
    root.guilds = raw?.guilds && typeof raw.guilds === 'object' ? raw.guilds : {};
    return root;
  } catch (error) {
    console.error('⚠️ data.json konnte nicht gelesen werden:', error);
    const fresh = defaultData();
    fresh.guilds = {};
    return fresh;
  }
}

function guildDataSnapshot(root) {
  const snapshot = { ...root };
  delete snapshot.guilds;
  return snapshot;
}

function loadData(guildId = null) {
  const root = readRootData();
  if (!guildId) return root;

  let rawGuild = root.guilds[guildId];
  if (!rawGuild) {
    // Migration: Der erste Server übernimmt automatisch die bisherige
    // Einzelserver-Konfiguration. Weitere Server starten sauber getrennt.
    rawGuild = Object.keys(root.guilds).length === 0 ? guildDataSnapshot(root) : {};
  }

  const guildData = normalizeData(rawGuild);
  Object.defineProperty(guildData, '__guildId', { value: String(guildId), enumerable: false });
  Object.defineProperty(guildData, '__rootData', { value: root, enumerable: false });
  return guildData;
}

function writeDataFile(data) {
  const temp = `${dataPath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(temp, dataPath);
}

function saveData(data) {
  const guildId = data?.__guildId;
  if (!guildId) {
    writeDataFile(data);
    return;
  }

  // Immer den neuesten Root-Stand laden, damit parallele Aktionen auf
  // verschiedenen Discord-Servern sich nicht gegenseitig überschreiben.
  const root = readRootData();
  if (!root.guilds || typeof root.guilds !== 'object') root.guilds = {};

  const cleanGuildData = JSON.parse(JSON.stringify(data));
  delete cleanGuildData.guilds;
  root.guilds[guildId] = cleanGuildData;
  root.version = Math.max(Number(root.version) || 0, Number(cleanGuildData.version) || 0, 9);
  writeDataFile(root);
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

const PREMIUM_GUILD_IDS = idsFromEnv('PREMIUM_GUILD_IDS', []);
const MASTER_USER_IDS = idsFromEnv('MASTER_USER_IDS', []);

function isGuildOwner(interaction) {
  return Boolean(interaction?.inGuild?.() && interaction.guild?.ownerId === interaction.user?.id);
}

function canUsePremiumSetup(interaction) {
  if (!isGuildOwner(interaction)) return false;
  return PREMIUM_GUILD_IDS.includes(interaction.guild.id) || MASTER_USER_IDS.includes(interaction.user.id);
}

function setupRole(name, key, options = {}) {
  return { name, key, ...options };
}

function setupChannel(name, key, type = 'text', options = {}) {
  return { name, key, type, ...options };
}

const SERVER_SETUP_TEMPLATES = {
  '1': {
    name: 'Clean Community',
    color: 0x5865f2,
    roles: [
      setupRole('👑 Inhaber', 'owner', { permissions: ['Administrator'], hoist: true }),
      setupRole('🧭 Management', 'management', { permissions: ['ManageGuild', 'ManageChannels', 'ManageRoles', 'ManageMessages', 'KickMembers', 'BanMembers'], hoist: true }),
      setupRole('🛡️ Moderator', 'moderator', { permissions: ['ManageMessages', 'ModerateMembers', 'KickMembers'], hoist: true }),
      setupRole('🎫 Support', 'support', { permissions: ['ManageMessages'], hoist: true }),
      setupRole('🎥 Creator', 'creator', { hoist: true }),
      setupRole('🤝 Partner', 'partner'),
      setupRole('💜 Booster', 'booster'),
      setupRole('🔔 Ankündigungen', 'announcement'),
      setupRole('✅ Verifiziert', 'verified'),
      setupRole('👤 Mitglied', 'member'),
    ],
    sections: [
      { name: '━━ START ━━', key: 'start', channels: [
        setupChannel('👋・willkommen', 'welcome'),
        setupChannel('📜・regeln', 'rules', 'text', { readOnly: true }),
        setupChannel('📢・ankündigungen', 'announcements', 'text', { readOnly: true }),
        setupChannel('✅・verifizierung', 'verification'),
        setupChannel('🏷️・rollen', 'interests'),
      ]},
      { name: '━━ COMMUNITY ━━', key: 'community', channels: [
        setupChannel('💬・allgemein', 'general'),
        setupChannel('📸・medien', 'media'),
        setupChannel('🎬・clips', 'clips'),
        setupChannel('💡・vorschläge', 'suggestions'),
        setupChannel('🌐・socials', 'socials'),
        setupChannel('🎉・giveaways', 'giveaways'),
        setupChannel('🎮・mitspieler', 'lfg'),
        setupChannel('📊・umfragen', 'polls'),
        setupChannel('⚡・activity-hub', 'activity', 'text', { readOnly: true, topic: 'Live-Aktivität, Coins, Seasons und Community-Fortschritt.' }),
      ]},
      { name: '━━ VOICE ━━', key: 'voice', channels: [
        setupChannel('➕・Voice erstellen', 'tempvoice', 'voice'),
        setupChannel('🎮・Gaming', 'gamingvoice', 'voice'),
        setupChannel('💬・Talk', 'talkvoice', 'voice'),
      ]},
      { name: '━━ SUPPORT ━━', key: 'supportcat', channels: [
        setupChannel('🎫・ticket-erstellen', 'tickets'),
        setupChannel('📨・bewerbungen', 'applications'),
        setupChannel('📮・anonym', 'anonymous'),
      ]},
      { name: '━━ TEAM ━━', key: 'team', privateFor: ['owner', 'management', 'moderator', 'support'], channels: [
        setupChannel('🧭・team-chat', 'teamchat'),
        setupChannel('📋・logs', 'logs'),
        setupChannel('🛡️・automod-logs', 'automodlogs'),
        setupChannel('📄・transkripte', 'transcripts'),
        setupChannel('🌐・social-audit', 'socialaudit'),
        setupChannel('📥・anonyme-inbox', 'anonymousinbox'),
      ]},
    ],
  },
  '2': {
    name: 'Gambo / Szene • Redline',
    color: 0xff2b2b,
    roles: [
      setupRole('👑・OWNER', 'owner', { permissions: ['Administrator'], hoist: true, color: 0xff2b2b }),
      setupRole('♛・CO-OWNER', 'coowner', { permissions: ['Administrator'], hoist: true, color: 0xd91515 }),
      setupRole('🔱・MANAGEMENT', 'management', { permissions: ['ManageGuild', 'ManageChannels', 'ManageRoles', 'ManageMessages', 'ModerateMembers', 'KickMembers', 'BanMembers'], hoist: true, color: 0xb31212 }),
      setupRole('🛡️・MODERATION', 'moderator', { permissions: ['ManageMessages', 'ModerateMembers', 'KickMembers'], hoist: true, color: 0x8f1010 }),
      setupRole('🎫・SUPPORT', 'support', { permissions: ['ManageMessages'], hoist: true, color: 0xff6b6b }),
      setupRole('🎯・UNFUGSTIFTER', 'elite', { hoist: true, color: 0xff3b3b }),
      setupRole('💀・ELITE PLAYER', 'eliteplayer', { hoist: true, color: 0xf2f3f5 }),
      setupRole('🎥・CREATOR', 'creator', { hoist: true, color: 0x9b59b6 }),
      setupRole('🤝・PARTNER', 'partner'),
      setupRole('💎・BOOSTER', 'booster'),
      setupRole('🚨・EVENT PING', 'eventping'),
      setupRole('🎁・GIVEAWAY PING', 'giveawayping'),
      setupRole('🔔・NEWS PING', 'announcement'),
      setupRole('🔫・GAMBO', 'interest_gambo'),
      setupRole('🎮・FIVEM', 'interest_fivem'),
      setupRole('✅・VERIFIED', 'verified'),
      setupRole('👤・COMMUNITY', 'member'),
    ],
    sections: [
      { name: '╭━━〔 ENTRY 〕━━╮', key: 'start', channels: [
        setupChannel('👋・willkommen', 'welcome', 'text', { readOnly: true, topic: 'Willkommen in der Community – hier beginnt dein Einstieg.' }),
        setupChannel('📕・regelwerk', 'rules', 'text', { readOnly: true, topic: 'Die wichtigsten Community-Regeln auf einen Blick.' }),
        setupChannel('📢・ankündigungen', 'announcements', 'text', { readOnly: true, topic: 'Offizielle News, Updates und wichtige Infos.' }),
        setupChannel('✅・verifizierung', 'verification', 'text', { topic: 'Verifiziere dich, um Zugriff auf den Server zu erhalten.' }),
        setupChannel('🏷️・rollen-auswahl', 'interests', 'text', { readOnly: true, topic: 'Wähle deine Interessen und Ping-Rollen.' }),
      ]},
      { name: '┣━━〔 GAMBO ZONE 〕━━┫', key: 'scene', channels: [
        setupChannel('💬・main-chat', 'general', 'text', { topic: 'Der Hauptchat der Community.' }),
        setupChannel('🎯・gambo-talk', 'fighttalk', 'text', { topic: 'Alles rund um Gambo, Fights, Setups und Szene-Talk.' }),
        setupChannel('🎬・fight-clips', 'clips', 'text', { topic: 'Poste deine besten Clips und Highlights.' }),
        setupChannel('📸・screenshots', 'media', 'text', { topic: 'Screenshots, Setups und Community-Momente.' }),
        setupChannel('🏆・leaderboard', 'leaderboard', 'text', { readOnly: true, topic: 'Highlights, Rankings und Community-Erfolge.' }),
        setupChannel('🔎・mitspieler-suche', 'lfg', 'text', { topic: 'Finde Mitspieler für FiveM, Gambo und andere Games.' }),
        setupChannel('🗺️・server-talk', 'servertalk', 'text', { topic: 'Talk über Server, Fraktionen und aktuelle Szene-Themen.' }),
      ]},
      { name: '┣━━〔 COMMUNITY 〕━━┫', key: 'community', channels: [
        setupChannel('🌐・social-hub', 'socials', 'text', { readOnly: true, topic: 'Creator, Socials und Community-Profile.' }),
        setupChannel('📅・events', 'events', 'text', { topic: 'Community-Events und gemeinsame Aktionen.' }),
        setupChannel('🎁・giveaways', 'giveaways', 'text', { topic: 'Giveaways und Verlosungen.' }),
        setupChannel('📊・abstimmungen', 'polls', 'text', { topic: 'Community-Abstimmungen und Entscheidungen.' }),
        setupChannel('❓・frage-des-tages', 'questions', 'text', { topic: 'Tägliche Frage für mehr Aktivität.' }),
        setupChannel('💡・vorschläge', 'suggestions', 'text', { topic: 'Ideen und Verbesserungsvorschläge.' }),
        setupChannel('📮・anonym', 'anonymous', 'text', { topic: 'Anonyme Nachricht an das Team senden.' }),
        setupChannel('⚡・activity-hub', 'activity', 'text', { readOnly: true, topic: 'Live-Stats, Coins, Missionen und Season-Fortschritt.' }),
      ]},
      { name: '┣━━〔 VOICE 〕━━┫', key: 'voice', channels: [
        setupChannel('➕・eigenen-voice-erstellen', 'tempvoice', 'voice'),
        setupChannel('🔫・Gambo 01', 'gamingvoice', 'voice'),
        setupChannel('🔫・Gambo 02', 'gamingvoice2', 'voice'),
        setupChannel('🎯・Warmup', 'warmupvoice', 'voice'),
        setupChannel('💬・Chill Lounge', 'talkvoice', 'voice'),
        setupChannel('💤・AFK', 'afkvoice', 'voice'),
      ]},
      { name: '┣━━〔 SUPPORT 〕━━┫', key: 'supportcat', channels: [
        setupChannel('🎫・ticket-erstellen', 'tickets', 'text', { topic: 'Erstelle ein Ticket für Support oder Anliegen.' }),
        setupChannel('📨・bewerbungen', 'applications', 'text', { topic: 'Bewerbungen für Team, Partner und Community.' }),
      ]},
      { name: '╰━━〔 STAFF ONLY 〕━━╯', key: 'team', privateFor: ['owner', 'coowner', 'management', 'moderator', 'support'], channels: [
        setupChannel('👑・leitung', 'leadership'),
        setupChannel('🛡️・team-chat', 'teamchat'),
        setupChannel('📋・logs', 'logs'),
        setupChannel('🤖・automod-logs', 'automodlogs'),
        setupChannel('📄・ticket-transkripte', 'transcripts'),
        setupChannel('🌐・social-audit', 'socialaudit'),
        setupChannel('📥・anonyme-inbox', 'anonymousinbox'),
        setupChannel('📨・bewerbungs-auswertung', 'applicationreview'),
      ]},
    ],
  },
  '3': {
    name: 'Minimal Elite • Obsidian',
    color: 0x18191c,
    roles: [
      setupRole('OWNER', 'owner', { permissions: ['Administrator'], hoist: true, color: 0xf2f3f5 }),
      setupRole('CO-OWNER', 'coowner', { permissions: ['Administrator'], hoist: true, color: 0xdbdee1 }),
      setupRole('MANAGEMENT', 'management', { permissions: ['ManageGuild', 'ManageChannels', 'ManageRoles', 'ManageMessages', 'ModerateMembers', 'KickMembers', 'BanMembers'], hoist: true, color: 0xb5bac1 }),
      setupRole('STAFF', 'moderator', { permissions: ['ManageMessages', 'ModerateMembers', 'KickMembers'], hoist: true, color: 0x949ba4 }),
      setupRole('SUPPORT', 'support', { permissions: ['ManageMessages'], hoist: true, color: 0x80848e }),
      setupRole('ELITE', 'elite', { hoist: true, color: 0xffffff }),
      setupRole('CREATOR', 'creator', { hoist: true, color: 0xc7c9cc }),
      setupRole('PARTNER', 'partner'),
      setupRole('BOOSTER', 'booster'),
      setupRole('EVENTS', 'eventping'),
      setupRole('GIVEAWAYS', 'giveawayping'),
      setupRole('NEWS', 'announcement'),
      setupRole('GAMBO', 'interest_gambo'),
      setupRole('FIVEM', 'interest_fivem'),
      setupRole('VERIFIED', 'verified'),
      setupRole('MEMBER', 'member'),
    ],
    sections: [
      { name: '━━━ 01 / INFORMATION ━━━', key: 'start', channels: [
        setupChannel('welcome', 'welcome', 'text', { readOnly: true, topic: 'Start here.' }),
        setupChannel('rules', 'rules', 'text', { readOnly: true, topic: 'Community rules.' }),
        setupChannel('announcements', 'announcements', 'text', { readOnly: true, topic: 'Official updates.' }),
        setupChannel('verify', 'verification', 'text', { topic: 'Verification access.' }),
        setupChannel('roles', 'interests', 'text', { readOnly: true, topic: 'Choose your roles.' }),
      ]},
      { name: '━━━ 02 / COMMUNITY ━━━', key: 'community', channels: [
        setupChannel('general', 'general'),
        setupChannel('media', 'media'),
        setupChannel('clips', 'clips'),
        setupChannel('socials', 'socials'),
        setupChannel('suggestions', 'suggestions'),
        setupChannel('polls', 'polls'),
        setupChannel('daily-question', 'questions'),
        setupChannel('giveaways', 'giveaways'),
        setupChannel('activity', 'activity', 'text', { readOnly: true, topic: 'Live stats, coins, missions and season progress.' }),
      ]},
      { name: '━━━ 03 / PLAY ━━━', key: 'play', channels: [
        setupChannel('gambo', 'fighttalk'),
        setupChannel('find-a-player', 'lfg'),
        setupChannel('events', 'events'),
        setupChannel('challenges', 'challenges'),
        setupChannel('server-talk', 'servertalk'),
      ]},
      { name: '━━━ 04 / VOICE ━━━', key: 'voice', channels: [
        setupChannel('+ create', 'tempvoice', 'voice'),
        setupChannel('squad 01', 'gamingvoice', 'voice'),
        setupChannel('squad 02', 'gamingvoice2', 'voice'),
        setupChannel('lounge', 'talkvoice', 'voice'),
        setupChannel('afk', 'afkvoice', 'voice'),
      ]},
      { name: '━━━ 05 / SUPPORT ━━━', key: 'supportcat', channels: [
        setupChannel('ticket', 'tickets'),
        setupChannel('applications', 'applications'),
        setupChannel('anonymous', 'anonymous'),
      ]},
      { name: '━━━ 06 / STAFF ━━━', key: 'team', privateFor: ['owner', 'coowner', 'management', 'moderator', 'support'], channels: [
        setupChannel('leadership', 'leadership'),
        setupChannel('staff-chat', 'teamchat'),
        setupChannel('logs', 'logs'),
        setupChannel('automod', 'automodlogs'),
        setupChannel('transcripts', 'transcripts'),
        setupChannel('social-audit', 'socialaudit'),
        setupChannel('anonymous-inbox', 'anonymousinbox'),
        setupChannel('application-review', 'applicationreview'),
      ]},
    ],
  },
  '4': {
    name: 'UNFUGSTIFTER • Private Edition',
    color: 0x8b5cf6,
    premium: true,
    roles: [
      setupRole('👑・INHABER', 'owner', { permissions: ['Administrator'], hoist: true }),
      setupRole('♛・CO-OWNER', 'coowner', { permissions: ['Administrator'], hoist: true }),
      setupRole('⚜️・MANAGEMENT', 'management', { permissions: ['ManageGuild', 'ManageChannels', 'ManageRoles', 'ManageMessages', 'KickMembers', 'BanMembers', 'ModerateMembers'], hoist: true }),
      setupRole('🛡️・MODERATION', 'moderator', { permissions: ['ManageMessages', 'ModerateMembers', 'KickMembers'], hoist: true }),
      setupRole('🎫・SUPPORT', 'support', { permissions: ['ManageMessages'], hoist: true }),
      setupRole('💎・UNFUGSTIFTER', 'elite', { hoist: true }),
      setupRole('🎥・CREATOR', 'creator', { hoist: true }),
      setupRole('🤝・PARTNER', 'partner'),
      setupRole('💜・BOOSTER', 'booster'),
      setupRole('🎉・EVENT PING', 'eventping'),
      setupRole('🔔・NEWS PING', 'announcement'),
      setupRole('🎁・GIVEAWAY PING', 'giveawayping'),
      setupRole('🎮・FIVEM', 'interest_fivem'),
      setupRole('🎯・GAMBO', 'interest_gambo'),
      setupRole('✅・VERIFIZIERT', 'verified'),
      setupRole('👤・COMMUNITY', 'member'),
    ],
    sections: [
      { name: '╔═══〔 UNFUGSTIFTER 〕═══╗', key: 'start', channels: [
        setupChannel('👋・willkommen', 'welcome'),
        setupChannel('📜・regelwerk', 'rules', 'text', { readOnly: true }),
        setupChannel('📣・ankündigungen', 'announcements', 'text', { readOnly: true }),
        setupChannel('✅・verifizierung', 'verification'),
        setupChannel('🏷️・rollen-auswahl', 'interests'),
      ]},
      { name: '╠══〔 COMMUNITY 〕══╣', key: 'community', channels: [
        setupChannel('💬・community-chat', 'general'),
        setupChannel('📸・media', 'media'),
        setupChannel('🎬・clip-der-woche', 'clips'),
        setupChannel('🌐・social-hub', 'socials'),
        setupChannel('💡・vorschläge', 'suggestions'),
        setupChannel('🎉・giveaways', 'giveaways'),
        setupChannel('📊・community-polls', 'polls'),
        setupChannel('❓・frage-des-tages', 'questions'),
        setupChannel('🏆・mitglied-des-monats', 'membermonth'),
        setupChannel('🤝・challenges', 'challenges'),
        setupChannel('⚡・activity-hub', 'activity', 'text', { readOnly: true, topic: 'Live-Aktivität, Coins, Missionen, Drops und Seasons.' }),
      ]},
      { name: '╠══〔 GAMBO / FIVEM 〕══╣', key: 'gambo', channels: [
        setupChannel('🎯・gambo-talk', 'fighttalk'),
        setupChannel('🎮・mitspieler-suche', 'lfg'),
        setupChannel('📮・anonyme-box', 'anonymous'),
        setupChannel('📅・events', 'events'),
      ]},
      { name: '╠══〔 VOICE 〕══╣', key: 'voice', channels: [
        setupChannel('➕・eigenen-voice-erstellen', 'tempvoice', 'voice'),
        setupChannel('🔫・Gambo 01', 'gamingvoice', 'voice'),
        setupChannel('🔫・Gambo 02', 'gamingvoice2', 'voice'),
        setupChannel('🎮・FiveM', 'fivemvoice', 'voice'),
        setupChannel('💬・Talk', 'talkvoice', 'voice'),
        setupChannel('💤・AFK', 'afkvoice', 'voice'),
      ]},
      { name: '╠══〔 SUPPORT 〕══╣', key: 'supportcat', channels: [
        setupChannel('🎫・ticket-erstellen', 'tickets'),
        setupChannel('📨・bewerbungen', 'applications'),
      ]},
      { name: '╚══〔 TEAM INTERN 〕══╝', key: 'team', privateFor: ['owner', 'coowner', 'management', 'moderator', 'support'], channels: [
        setupChannel('👑・leitung', 'leadership'),
        setupChannel('🛡️・team-chat', 'teamchat'),
        setupChannel('📋・logs', 'logs'),
        setupChannel('🤖・automod-logs', 'automodlogs'),
        setupChannel('📄・ticket-transkripte', 'transcripts'),
        setupChannel('🌐・social-audit', 'socialaudit'),
        setupChannel('📥・anonyme-inbox', 'anonymousinbox'),
        setupChannel('📨・bewerbungs-auswertung', 'applicationreview'),
      ]},
    ],
  },
};

function permissionValues(names = []) {
  return names.map(name => PermissionFlagsBits[name]).filter(value => value !== undefined);
}

function setupOverwriteList(guild, roleMap, section, channel) {
  const list = [];
  const privateFor = channel.privateFor || section.privateFor || null;
  if (privateFor) {
    list.push({ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] });
    for (const key of privateFor) {
      const role = roleMap[key];
      if (!role) continue;
      list.push({
        id: role.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
        ],
      });
    }
  } else if (channel.readOnly) {
    list.push({
      id: guild.roles.everyone.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [PermissionFlagsBits.SendMessages],
    });
    for (const key of ['owner', 'coowner', 'management', 'moderator', 'support']) {
      const role = roleMap[key];
      if (!role) continue;
      list.push({
        id: role.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      });
    }
  }
  return list;
}

function backupPermissionOverwrites(channel) {
  return [...channel.permissionOverwrites.cache.values()].map(overwrite => ({
    id: overwrite.id,
    type: overwrite.type,
    allow: overwrite.allow.bitfield.toString(),
    deny: overwrite.deny.bitfield.toString(),
  }));
}

async function captureServerBackup(guild, data, label = 'manual') {
  await guild.roles.fetch().catch(() => {});
  await guild.channels.fetch().catch(() => {});

  const roles = guild.roles.cache
    .filter(role => role.id !== guild.id && !role.managed)
    .sort((a, b) => a.position - b.position)
    .map(role => ({
      id: role.id,
      name: role.name,
      color: role.color,
      hoist: role.hoist,
      mentionable: role.mentionable,
      permissions: role.permissions.bitfield.toString(),
      position: role.position,
    }));

  const channels = guild.channels.cache
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map(channel => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      parentId: channel.parentId || null,
      position: channel.rawPosition,
      topic: 'topic' in channel ? channel.topic || null : null,
      nsfw: 'nsfw' in channel ? Boolean(channel.nsfw) : false,
      rateLimitPerUser: 'rateLimitPerUser' in channel ? channel.rateLimitPerUser || 0 : 0,
      userLimit: 'userLimit' in channel ? channel.userLimit || 0 : 0,
      bitrate: 'bitrate' in channel ? channel.bitrate || null : null,
      permissionOverwrites: backupPermissionOverwrites(channel),
    }));

  return {
    id: createShortId('backup_'),
    label,
    guildId: guild.id,
    guildName: guild.name,
    createdAt: Date.now(),
    roles,
    channels,
    botConfig: { ...(data.config || {}) },
  };
}

function pushServerBackup(data, guildId, backup) {
  if (!data.serverBackups[guildId]) data.serverBackups[guildId] = [];
  data.serverBackups[guildId].unshift(backup);
  data.serverBackups[guildId] = data.serverBackups[guildId].slice(0, 5);
}

async function deleteExistingServerStructure(guild, keepChannelId = null) {
  const skippedRoles = [];
  const failedChannels = [];
  const botMember = guild.members.me;

  const channels = [...guild.channels.cache.values()]
    .filter(channel => channel.id !== keepChannelId)
    .sort((a, b) => {
      if (a.type === ChannelType.GuildCategory && b.type !== ChannelType.GuildCategory) return 1;
      if (a.type !== ChannelType.GuildCategory && b.type === ChannelType.GuildCategory) return -1;
      return b.rawPosition - a.rawPosition;
    });

  for (const channel of channels) {
    await channel.delete('Server Setup Bot: altes Design entfernen').catch(() => failedChannels.push(channel.name));
  }

  const roles = [...guild.roles.cache.values()]
    .filter(role => role.id !== guild.id && !role.managed)
    .sort((a, b) => b.position - a.position);

  for (const role of roles) {
    if (!botMember || botMember.roles.highest.comparePositionTo(role) <= 0) {
      skippedRoles.push(role.name);
      continue;
    }
    await role.delete('Server Setup Bot: alte Rolle entfernen').catch(() => skippedRoles.push(role.name));
  }

  return { skippedRoles: [...new Set(skippedRoles)], failedChannels: [...new Set(failedChannels)] };
}

async function createTemplateStructure(guild, template) {
  const roleMap = {};
  const channelMap = {};
  const categoryMap = {};

  for (const def of template.roles) {
    const role = await guild.roles.create({
      name: def.name,
      color: def.color ?? template.color,
      hoist: Boolean(def.hoist),
      mentionable: Boolean(def.mentionable),
      permissions: permissionValues(def.permissions || []),
      reason: `Server Setup ${template.name}`,
    });
    roleMap[def.key] = role;
  }

  const ownerMember = await guild.members.fetch(guild.ownerId).catch(() => null);
  if (ownerMember && roleMap.owner && guild.members.me?.roles.highest.comparePositionTo(roleMap.owner) > 0) {
    await ownerMember.roles.add(roleMap.owner, 'Server Setup: Inhaber-Rolle').catch(() => {});
  }

  for (const section of template.sections) {
    const category = await guild.channels.create({
      name: section.name,
      type: ChannelType.GuildCategory,
      permissionOverwrites: setupOverwriteList(guild, roleMap, section, {}),
      reason: `Server Setup ${template.name}`,
    });
    categoryMap[section.key] = category;
    channelMap[`category_${section.key}`] = category;

    for (const def of section.channels) {
      const type = def.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
      const channel = await guild.channels.create({
        name: def.name,
        type,
        parent: category.id,
        topic: type === ChannelType.GuildText ? (def.topic || null) : undefined,
        permissionOverwrites: setupOverwriteList(guild, roleMap, section, def),
        reason: `Server Setup ${template.name}`,
      });
      channelMap[def.key] = channel;
    }
  }

  return { roleMap, channelMap, categoryMap };
}

function applySetupConfig(data, created, templateId) {
  const { roleMap, channelMap } = created;
  const c = data.config;

  c.welcomeChannelId = channelMap.welcome?.id || null;
  c.leaveChannelId = channelMap.welcome?.id || null;
  c.logChannelId = channelMap.logs?.id || null;
  c.suggestionsChannelId = channelMap.suggestions?.id || null;
  c.giveawayChannelId = channelMap.giveaways?.id || null;
  c.socialsChannelId = channelMap.socials?.id || null;
  c.socialAuditChannelId = channelMap.socialaudit?.id || channelMap.logs?.id || null;
  c.ticketCategoryId = channelMap.category_supportcat?.id || null;
  c.verifiedRoleId = roleMap.verified?.id || null;
  c.unverifiedRoleId = null;
  c.supportRoleId = roleMap.support?.id || null;
  c.moderatorRoleId = roleMap.moderator?.id || null;
  c.announcementRoleId = roleMap.announcement?.id || null;
  c.socialAdminRoleId = roleMap.management?.id || roleMap.moderator?.id || null;
  c.socialDeleteRoleId = roleMap.management?.id || roleMap.moderator?.id || null;
  c.applicationReviewChannelId = channelMap.applicationreview?.id || channelMap.applications?.id || null;
  c.applicationAcceptedRoleId = roleMap.member?.id || null;
  c.ticketTranscriptChannelId = channelMap.transcripts?.id || channelMap.logs?.id || null;
  c.automodLogChannelId = channelMap.automodlogs?.id || channelMap.logs?.id || null;
  c.tempVoiceLobbyId = channelMap.tempvoice?.id || null;
  c.tempVoiceCategoryId = channelMap.category_voice?.id || null;
  c.questionChannelId = channelMap.questions?.id || channelMap.general?.id || null;
  c.communityPollChannelId = channelMap.polls?.id || channelMap.general?.id || null;
  c.memberOfMonthChannelId = channelMap.membermonth?.id || channelMap.announcements?.id || null;
  c.memberOfMonthRoleId = null;
  c.clipChannelId = channelMap.clips?.id || null;
  c.lfgChannelId = channelMap.lfg?.id || null;
  c.challengeChannelId = channelMap.challenges?.id || channelMap.general?.id || null;
  c.anonymousInboxChannelId = channelMap.anonymousinbox?.id || channelMap.logs?.id || null;
  c.interestsChannelId = channelMap.interests?.id || null;
  c.engagementChannelId = channelMap.activity?.id || channelMap.general?.id || null;
  c.setupTemplateId = templateId;
  c.setupThemeColor = SERVER_SETUP_TEMPLATES[templateId]?.color || 0x5865f2;

  data.socials.messageIds = [];
  data.interests.panelMessageId = null;
  data.giveaways = {};
  data.events = {};
  data.lfg = {};
  data.challenges = {};
  data.games.channels = {};
  data.games.quizzes = {};
  data.clips.submissions = {};
  data.clips.activeWeek = null;
  data.engagement.activityPanelMessageId = null;
  data.engagement.drop = { activeId: null, messageId: null, channelId: null, reward: 0, expiresAt: 0, lastDropAt: 0, claimedBy: null };
  data.engagement.enabled = Boolean(c.engagementChannelId);

  if (['2', '3', '4'].includes(templateId)) {
    data.automod.enabled = true;
    data.dailyQuestions.enabled = Boolean(channelMap.questions);
    data.dailyQuestions.hour = 12;
    data.dailyQuestions.questions = data.dailyQuestions.questions?.length ? data.dailyQuestions.questions : [...DEFAULT_DAILY_QUESTIONS];
    data.communityPolls.enabled = Boolean(channelMap.polls);
    data.communityPolls.cadence = 'weekly';
    data.communityPolls.hour = 18;
    data.communityPolls.weekday = 5;
    data.communityPolls.templates = data.communityPolls.templates?.length ? data.communityPolls.templates : [...DEFAULT_COMMUNITY_POLLS];
    data.clips.enabled = Boolean(c.clipChannelId);
    data.clips.activeWeek = c.clipChannelId ? isoWeekKey() : null;
    data.interests.options = [
      roleMap.interest_fivem ? { label: 'FiveM', roleId: roleMap.interest_fivem.id } : null,
      roleMap.interest_gambo ? { label: 'Gambo', roleId: roleMap.interest_gambo.id } : null,
      roleMap.eventping ? { label: 'Events', roleId: roleMap.eventping.id } : null,
      roleMap.giveawayping ? { label: 'Giveaways', roleId: roleMap.giveawayping.id } : null,
      roleMap.announcement ? { label: 'News', roleId: roleMap.announcement.id } : null,
    ].filter(Boolean);
    data.memberOfMonth.enabled = templateId === '4' && Boolean(c.memberOfMonthChannelId);
  } else {
    data.interests.options = [];
  }
}

async function publishSetupPanels(guild, data, created, templateId) {
  const { channelMap } = created;
  const template = SERVER_SETUP_TEMPLATES[templateId];
  const color = template?.color || 0x5865f2;

  if (channelMap.welcome?.isTextBased()) {
    const embed = new EmbedBuilder().setColor(color).setTimestamp();
    if (templateId === '2') {
      embed
        .setTitle(`🔥 ${guild.name.toUpperCase()} • REDLINE`)
        .setDescription('**Willkommen in der Gambo- & Szene-Community.**\n\nVerifiziere dich, wähle deine Rollen und zeig im Community-Bereich, was du draufhast.')
        .addFields(
          { name: '01 • START', value: 'Regelwerk lesen und anschließend verifizieren.', inline: true },
          { name: '02 • ROLLEN', value: 'FiveM, Gambo, Events und Ping-Rollen auswählen.', inline: true },
          { name: '03 • SZENE', value: 'Clips, Screenshots, Mitspieler und Szene-Talk.', inline: true },
        )
        .setFooter({ text: 'GAMBO / SZENE • REDLINE EDITION' });
    } else if (templateId === '3') {
      embed
        .setTitle(guild.name.toUpperCase())
        .setDescription('**WELCOME.**\n\nClean structure. No clutter. Everything you need is separated into clear sections.')
        .addFields(
          { name: 'ACCESS', value: 'Read `rules` → verify → choose your roles.', inline: true },
          { name: 'COMMUNITY', value: 'Chat, media, clips and socials.', inline: true },
          { name: 'PLAY', value: 'Gambo, events and player search.', inline: true },
        )
        .setFooter({ text: 'MINIMAL ELITE • OBSIDIAN' });
    } else {
      embed.setTitle(`👋 Willkommen auf ${guild.name}`).setDescription('Bitte lies das Regelwerk und verifiziere dich, um loszulegen.');
    }
    await channelMap.welcome.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
  }

  if (channelMap.rules?.isTextBased()) {
    const rules = templateId === '3'
      ? [
          '**01**  Respect other members.',
          '**02**  No spam, unnecessary pings or advertising.',
          '**03**  Follow the rules of every FiveM server you play on.',
          '**04**  Keep private/internal information private.',
          '**05**  Staff decisions belong in support, not public chat.',
        ].join('\n\n')
      : [
          '**1. Respekt** — Kein unnötiger Stress, Beleidigungen oder Provokationen gegen Community-Mitglieder.',
          '**2. Kein Spam** — Keine Werbung, Mass-Pings oder Chat-Spam.',
          '**3. Serverregeln gelten** — Auf jedem FiveM-Server gelten zusätzlich dessen eigene Regeln.',
          '**4. Interne Sachen bleiben intern** — Keine Leaks aus Team- oder Community-Bereichen.',
          '**5. Support statt Drama** — Probleme werden über Tickets und nicht im Main-Chat geklärt.',
        ].join('\n\n');
    await channelMap.rules.send({
      embeds: [new EmbedBuilder()
        .setColor(color)
        .setTitle(templateId === '3' ? 'RULES' : '📕 COMMUNITY REGELWERK')
        .setDescription(rules)
        .setFooter({ text: 'Das Team kann das Regelwerk jederzeit ergänzen.' })],
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }

  if (templateId === '2' && channelMap.leaderboard?.isTextBased()) {
    await channelMap.leaderboard.send({
      embeds: [new EmbedBuilder()
        .setColor(color)
        .setTitle('🏆 REDLINE • HALL OF FAME')
        .setDescription('Hier könnt ihr besondere Community-Erfolge, Clip-Gewinner, Turniersieger oder interne Rankings festhalten.')
        .setFooter({ text: 'Die Inhalte dieses Channels kann das Team frei pflegen.' })],
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }

  if (channelMap.verification?.isTextBased() && data.config.verifiedRoleId) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('verify_start').setLabel('Verifizieren').setEmoji('✅').setStyle(ButtonStyle.Success),
    );
    await channelMap.verification.send({
      embeds: [new EmbedBuilder()
        .setColor(SERVER_SETUP_TEMPLATES[templateId].color)
        .setTitle('✅ Verifizierung')
        .setDescription('Drücke auf **Verifizieren** und löse die kleine Rechenaufgabe.')],
      components: [row],
    }).catch(() => {});
  }

  if (channelMap.tickets?.isTextBased()) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_create').setLabel('Ticket erstellen').setEmoji('🎫').setStyle(ButtonStyle.Primary),
    );
    await channelMap.tickets.send({
      embeds: [new EmbedBuilder()
        .setColor(SERVER_SETUP_TEMPLATES[templateId].color)
        .setTitle('🎫 Support')
        .setDescription('Benötigst du Hilfe? Drücke unten auf **Ticket erstellen**.')],
      components: [row],
    }).catch(() => {});
  }

  if (channelMap.anonymous?.isTextBased()) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('anonymous_open').setLabel('Anonyme Nachricht senden').setEmoji('📮').setStyle(ButtonStyle.Primary),
    );
    await channelMap.anonymous.send({
      embeds: [new EmbedBuilder()
        .setColor(SERVER_SETUP_TEMPLATES[templateId].color)
        .setTitle('📮 Anonyme Nachrichtenbox')
        .setDescription('Sende Feedback oder Anliegen anonym an das Team. Zum Schutz vor Missbrauch wird der Absender intern protokolliert.')],
      components: [row],
    }).catch(() => {});
  }

  if (channelMap.socials?.isTextBased()) {
    await updateSocialPanel(guild, data).catch(() => {});
  }

  if (channelMap.interests?.isTextBased()) {
    await updateInterestPanel(guild, data, channelMap.interests).catch(() => {});
  }

  if (channelMap.logs?.isTextBased()) {
    await channelMap.logs.send({
      embeds: [new EmbedBuilder()
        .setColor(SERVER_SETUP_TEMPLATES[templateId].color)
        .setTitle('✅ Server Setup abgeschlossen')
        .setDescription(`Design **${templateId} – ${SERVER_SETUP_TEMPLATES[templateId].name}** wurde eingerichtet.\n\nDer Bot hat Rollen, Kategorien, Channels und Kern-Panels erstellt.`)
        .setTimestamp()],
    }).catch(() => {});
  }

  if (channelMap.activity?.isTextBased() && data.engagement.enabled) {
    await updateActivityPanel(guild, data, true).catch(() => {});
  }
}

function remapId(value, roleIdMap, channelIdMap) {
  if (!value) return null;
  return roleIdMap[value]?.id || channelIdMap[value]?.id || null;
}

async function restoreServerBackup(guild, data, backup) {
  const roleIdMap = {};
  const channelIdMap = {};
  const botMember = guild.members.me;

  for (const oldRole of [...backup.roles].sort((a, b) => a.position - b.position)) {
    const role = await guild.roles.create({
      name: oldRole.name,
      color: oldRole.color,
      hoist: oldRole.hoist,
      mentionable: oldRole.mentionable,
      permissions: BigInt(oldRole.permissions || '0'),
      reason: `Restore Backup ${backup.id}`,
    }).catch(() => null);
    if (role) roleIdMap[oldRole.id] = role;
  }

  roleIdMap[guild.id] = guild.roles.everyone;

  const mapOverwrites = source => (source || []).map(overwrite => {
    const mappedRole = roleIdMap[overwrite.id];
    const targetId = mappedRole?.id || overwrite.id;
    return {
      id: targetId,
      type: overwrite.type,
      allow: BigInt(overwrite.allow || '0'),
      deny: BigInt(overwrite.deny || '0'),
    };
  });

  const categories = backup.channels.filter(ch => ch.type === ChannelType.GuildCategory).sort((a, b) => a.position - b.position);
  for (const oldChannel of categories) {
    const channel = await guild.channels.create({
      name: oldChannel.name,
      type: ChannelType.GuildCategory,
      permissionOverwrites: mapOverwrites(oldChannel.permissionOverwrites),
      reason: `Restore Backup ${backup.id}`,
    }).catch(() => null);
    if (channel) channelIdMap[oldChannel.id] = channel;
  }

  const others = backup.channels.filter(ch => ch.type !== ChannelType.GuildCategory).sort((a, b) => a.position - b.position);
  for (const oldChannel of others) {
    const options = {
      name: oldChannel.name,
      type: oldChannel.type,
      parent: oldChannel.parentId ? channelIdMap[oldChannel.parentId]?.id : undefined,
      permissionOverwrites: mapOverwrites(oldChannel.permissionOverwrites),
      reason: `Restore Backup ${backup.id}`,
    };
    if ([ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(oldChannel.type)) {
      options.topic = oldChannel.topic || undefined;
      options.nsfw = Boolean(oldChannel.nsfw);
      options.rateLimitPerUser = oldChannel.rateLimitPerUser || 0;
    }
    if (oldChannel.type === ChannelType.GuildVoice) {
      options.userLimit = oldChannel.userLimit || 0;
      if (oldChannel.bitrate) options.bitrate = oldChannel.bitrate;
    }
    const channel = await guild.channels.create(options).catch(() => null);
    if (channel) channelIdMap[oldChannel.id] = channel;
  }

  const oldConfig = backup.botConfig || {};
  for (const key of Object.keys(data.config)) {
    if (!oldConfig[key]) {
      data.config[key] = oldConfig[key] ?? data.config[key];
      continue;
    }
    data.config[key] = remapId(oldConfig[key], roleIdMap, channelIdMap) || null;
  }

  data.socials.messageIds = [];
  data.interests.panelMessageId = null;
  data.engagement.activityPanelMessageId = null;
  data.engagement.enabled = Boolean(data.config.engagementChannelId);
  saveData(data);

  if (data.config.socialsChannelId) await updateSocialPanel(guild, data).catch(() => {});
  if (data.config.interestsChannelId) await updateInterestPanel(guild, data).catch(() => {});
  if (data.config.engagementChannelId) await updateActivityPanel(guild, data, true).catch(() => {});

  const ownerMember = await guild.members.fetch(guild.ownerId).catch(() => null);
  if (ownerMember && botMember) {
    const topRestored = Object.values(roleIdMap).filter(role => role?.id !== guild.id).sort((a, b) => b.position - a.position)[0];
    if (topRestored && botMember.roles.highest.comparePositionTo(topRestored) > 0) {
      // Rechte bleiben beim echten Guild Owner ohnehin erhalten; keine automatische Fremdrollen-Zuweisung.
    }
  }

  return { roleIdMap, channelIdMap };
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

function canUseSocialsCommand(member) {
  return Boolean(member?.roles?.cache?.has('1531994258691588177'));
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
  for (const guild of clientInstance.guilds.cache.values()) {
    const data = loadData(guild.id);
    let changed = false;
    for (const [messageId, giveaway] of Object.entries(data.giveaways || {})) {
      if (giveaway.guildId && giveaway.guildId !== guild.id) continue;
      if (giveaway.ended || giveaway.endAt > Date.now()) continue;
      const ended = await finishGiveaway(guild, data, messageId, null).catch(error => {
        console.error('❌ Giveaway konnte nicht automatisch beendet werden:', error);
        return false;
      });
      if (ended) changed = true;
    }
    if (changed) saveData(data);
  }
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
  const now = Date.now();

  for (const guild of clientInstance.guilds.cache.values()) {
    const data = loadData(guild.id);
    let changed = false;

    for (const event of Object.values(data.events || {})) {
      if (event.guildId && event.guildId !== guild.id) continue;
      if (event.cancelled || event.started) continue;
      if (!event.reminders) event.reminders = {};
      const channel = await guild.channels.fetch(event.channelId).catch(() => null);
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

function localDateInfo(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: COMMUNITY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  return {
    date,
    month: `${values.year}-${values.month}`,
    hour: Number(values.hour),
    weekday: new Date(`${date}T12:00:00Z`).getUTCDay(),
  };
}

function previousMonthKey(timestamp = Date.now()) {
  const current = localDateInfo(timestamp).month;
  const [year, month] = current.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function isoWeekKey(timestamp = Date.now()) {
  const localDate = localDateInfo(timestamp).date;
  const date = new Date(`${localDate}T12:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86_400_000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function ensureActivityRecord(container, userId) {
  if (!container[userId]) container[userId] = { messages: 0, voiceMs: 0 };
  return container[userId];
}

function activityFor(data, userId, scope = 'month') {
  const month = localDateInfo().month;
  const stored = scope === 'total'
    ? data.activity.totals[userId] || { messages: 0, voiceMs: 0 }
    : data.activity.months[month]?.[userId] || { messages: 0, voiceMs: 0 };
  const result = { messages: stored.messages || 0, voiceMs: stored.voiceMs || 0 };
  const session = data.activity.voiceActive[userId];
  if (session && (scope === 'total' || localDateInfo(session.startedAt).month === month)) {
    result.voiceMs += Math.max(0, Date.now() - session.startedAt);
  }
  return result;
}

function communityScore(record) {
  return (record.messages || 0) + Math.floor((record.voiceMs || 0) / (5 * 60 * 1000));
}

function challengeContributionTotal(data, userId) {
  return Object.values(data.challenges || {}).reduce(
    (sum, challenge) => sum + Number(challenge.contributions?.[userId] || 0),
    0,
  );
}

function clipWinCount(data, userId) {
  return Object.values(data.clips?.winners || {}).filter(winner => winner?.userId === userId).length;
}

function earnedBadgeIds(data, userId) {
  const activity = data.activity.totals[userId] || { messages: 0, voiceMs: 0 };
  const rep = data.reputation.users[userId]?.points || 0;
  const invites = data.inviteStats[userId]?.active || 0;
  const quizCorrect = data.games.quizScores[userId]?.correct || 0;
  const earned = [];
  if ((activity.messages || 0) >= 1) earned.push('first_message');
  if ((activity.messages || 0) >= 100) earned.push('chat_100');
  if ((activity.messages || 0) >= 1000) earned.push('chat_1000');
  if ((activity.voiceMs || 0) >= 5 * 60 * 60 * 1000) earned.push('voice_5h');
  if ((activity.voiceMs || 0) >= 50 * 60 * 60 * 1000) earned.push('voice_50h');
  if (rep >= 10) earned.push('rep_10');
  if (invites >= 5) earned.push('invites_5');
  if (quizCorrect >= 10) earned.push('quiz_10');
  if (clipWinCount(data, userId) >= 1) earned.push('clip_winner');
  if (challengeContributionTotal(data, userId) >= 100) earned.push('challenge_100');
  return earned;
}

async function checkAndAwardBadges(data, userId, channel = null) {
  const existing = Array.isArray(data.achievements[userId]) ? data.achievements[userId] : [];
  const unlocked = earnedBadgeIds(data, userId).filter(id => !existing.includes(id));
  if (!unlocked.length) return [];
  data.achievements[userId] = [...existing, ...unlocked];

  if (channel?.isTextBased()) {
    const text = unlocked.map(id => `${BADGES[id].emoji} **${BADGES[id].name}**`).join('\n');
    await channel.send({
      content: `🏅 <@${userId}> hat ${unlocked.length === 1 ? 'ein neues Abzeichen' : 'neue Abzeichen'} erhalten!\n${text}`,
      allowedMentions: { users: [userId] },
    }).catch(() => {});
  }
  return unlocked;
}

async function recordCommunityMessage(message, data) {
  const month = localDateInfo(message.createdTimestamp).month;
  if (!data.activity.months[month]) data.activity.months[month] = {};
  const monthly = ensureActivityRecord(data.activity.months[month], message.author.id);
  const total = ensureActivityRecord(data.activity.totals, message.author.id);
  monthly.messages++;
  total.messages++;
  await checkAndAwardBadges(data, message.author.id, message.channel);
  saveData(data);
}

function finishVoiceSession(data, userId, endedAt = Date.now()) {
  const session = data.activity.voiceActive[userId];
  if (!session) return 0;
  const duration = Math.max(0, Math.min(7 * 24 * 60 * 60 * 1000, endedAt - session.startedAt));
  delete data.activity.voiceActive[userId];
  if (!duration) return 0;
  const month = localDateInfo(endedAt).month;
  if (!data.activity.months[month]) data.activity.months[month] = {};
  ensureActivityRecord(data.activity.months[month], userId).voiceMs += duration;
  ensureActivityRecord(data.activity.totals, userId).voiceMs += duration;
  return duration;
}

function startVoiceSession(data, member, channelId) {
  if (!member || member.user.bot || !channelId || member.guild.afkChannelId === channelId) return;
  data.activity.voiceActive[member.id] = { channelId, startedAt: Date.now() };
}

function activityLeaderboard(data, scope = 'month') {
  const source = scope === 'total'
    ? data.activity.totals
    : data.activity.months[localDateInfo().month] || {};
  const userIds = new Set([...Object.keys(source), ...Object.keys(data.activity.voiceActive || {})]);
  return [...userIds]
    .map(userId => {
      const record = activityFor(data, userId, scope);
      return { userId, record, score: communityScore(record) };
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score);
}

async function awardMemberOfMonth(guild, data, monthKey, force = false) {
  if (!force && data.memberOfMonth.lastAwardedMonth === monthKey) return null;
  const source = data.activity.months[monthKey] || {};
  const candidates = Object.entries(source)
    .map(([userId, record]) => ({ userId, record, score: communityScore(record) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  let winner = null;
  for (const candidate of candidates) {
    const member = await guild.members.fetch(candidate.userId).catch(() => null);
    if (member && !member.user.bot) {
      winner = { ...candidate, member };
      break;
    }
  }

  data.memberOfMonth.lastAwardedMonth = monthKey;
  if (!winner) return null;

  const roleId = data.config.memberOfMonthRoleId;
  if (roleId) {
    const oldWinnerId = data.memberOfMonth.currentWinnerId;
    if (oldWinnerId && oldWinnerId !== winner.userId) {
      const oldMember = await guild.members.fetch(oldWinnerId).catch(() => null);
      if (oldMember) await oldMember.roles.remove(roleId).catch(() => {});
    }
    await winner.member.roles.add(roleId).catch(() => {});
  }

  data.memberOfMonth.currentWinnerId = winner.userId;
  data.memberOfMonth.history[monthKey] = {
    userId: winner.userId,
    score: winner.score,
    messages: winner.record.messages || 0,
    voiceMs: winner.record.voiceMs || 0,
    awardedAt: Date.now(),
  };

  const channel = data.config.memberOfMonthChannelId
    ? await guild.channels.fetch(data.config.memberOfMonthChannelId).catch(() => null)
    : null;
  if (channel?.isTextBased()) {
    await channel.send({
      content: `<@${winner.userId}>`,
      embeds: [new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle('👑 Mitglied des Monats')
        .setThumbnail(winner.member.user.displayAvatarURL({ size: 256 }))
        .setDescription(`Herzlichen Glückwunsch <@${winner.userId}>! Du warst im Monat **${monthKey}** besonders aktiv.`)
        .addFields(
          { name: 'Nachrichten', value: String(winner.record.messages || 0), inline: true },
          { name: 'Voice-Zeit', value: formatLongDuration(winner.record.voiceMs || 0), inline: true },
          { name: 'Community-Punkte', value: String(winner.score), inline: true },
        )
        .setTimestamp()],
      allowedMentions: { users: [winner.userId] },
    }).catch(() => {});
  }
  return winner;
}

function nextDailyQuestion(data) {
  const source = data.dailyQuestions.questions.length ? data.dailyQuestions.questions : DEFAULT_DAILY_QUESTIONS;
  const index = Number(data.dailyQuestions.nextIndex || 0) % source.length;
  data.dailyQuestions.nextIndex = (index + 1) % source.length;
  return source[index];
}

async function postDailyQuestion(guild, data, channelOverride = null) {
  const channel = channelOverride || (data.config.questionChannelId
    ? await guild.channels.fetch(data.config.questionChannelId).catch(() => null)
    : null);
  if (!channel?.isTextBased()) return null;
  const question = nextDailyQuestion(data);
  const message = await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle('💭 Frage des Tages')
      .setDescription(`## ${question}\n\nSchreibt eure Antwort in den Chat und lernt euch besser kennen!`)
      .setFooter({ text: guild.name })
      .setTimestamp()],
  });
  await message.react('💬').catch(() => {});
  return message;
}

function pollVoteCounts(poll) {
  const counts = poll.options.map(() => 0);
  for (const index of Object.values(poll.votes || {})) {
    if (Number.isInteger(index) && counts[index] !== undefined) counts[index]++;
  }
  return counts;
}

function communityPollPayload(poll) {
  const counts = pollVoteCounts(poll);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const lines = poll.options.map((option, index) => {
    const percent = total ? Math.round((counts[index] / total) * 100) : 0;
    return `**${index + 1}. ${option}**\n${'▰'.repeat(Math.round(percent / 10))}${'▱'.repeat(10 - Math.round(percent / 10))} ${counts[index]} Stimme${counts[index] === 1 ? '' : 'n'} • ${percent}%`;
  });
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📊 Community-Umfrage')
    .setDescription(`## ${poll.question}\n\n${lines.join('\n\n')}`)
    .setFooter({ text: `${total} abgegebene Stimme${total === 1 ? '' : 'n'} • Auswahl kann geändert werden` })
    .setTimestamp(poll.createdAt);
  const row = new ActionRowBuilder();
  poll.options.forEach((option, index) => {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`community_poll_vote:${poll.id}:${index}`)
        .setLabel(`${index + 1}. ${option}`.slice(0, 80))
        .setStyle(ButtonStyle.Primary),
    );
  });
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

function parsePollOptions(raw) {
  return [...new Set(String(raw || '').split('|').map(value => value.trim()).filter(Boolean))].slice(0, 5);
}

function nextPollTemplate(data) {
  const source = data.communityPolls.templates.length ? data.communityPolls.templates : DEFAULT_COMMUNITY_POLLS;
  const index = Number(data.communityPolls.nextIndex || 0) % source.length;
  data.communityPolls.nextIndex = (index + 1) % source.length;
  return source[index];
}

async function postCommunityPoll(guild, data, template = null, channelOverride = null) {
  const channel = channelOverride || (data.config.communityPollChannelId
    ? await guild.channels.fetch(data.config.communityPollChannelId).catch(() => null)
    : null);
  if (!channel?.isTextBased()) return null;
  const selected = template || nextPollTemplate(data);
  const poll = {
    id: createShortId('p'),
    guildId: guild.id,
    channelId: channel.id,
    question: selected.question,
    options: selected.options.slice(0, 5),
    votes: {},
    createdAt: Date.now(),
  };
  const message = await channel.send(communityPollPayload(poll));
  poll.messageId = message.id;
  data.communityPolls.active[poll.id] = poll;
  return message;
}

function clipPayload(clip, disabled = false) {
  const votes = Array.isArray(clip.votes) ? clip.votes.length : 0;
  const embed = new EmbedBuilder()
    .setColor(clip.winner ? 0xf1c40f : 0x8b5cf6)
    .setTitle(clip.winner ? `🏆 Clip der Woche • ${clip.title}` : `🎬 ${clip.title}`)
    .setURL(clip.url)
    .setDescription(`Eingereicht von <@${clip.userId}>\n\n**${votes} Stimme${votes === 1 ? '' : 'n'}**`)
    .setFooter({ text: `Clip-ID: ${clip.id} • Woche ${clip.weekKey}` })
    .setTimestamp(clip.createdAt);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Clip öffnen').setEmoji('▶️').setStyle(ButtonStyle.Link).setURL(clip.url),
    new ButtonBuilder().setCustomId(`clip_vote:${clip.id}`).setLabel(disabled ? 'Abstimmung beendet' : 'Abstimmen').setEmoji('⭐').setStyle(ButtonStyle.Success).setDisabled(disabled),
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

async function finishClipWeek(guild, data, weekKey) {
  if (!weekKey || data.clips.lastFinishedWeek === weekKey) return null;
  const clips = Object.values(data.clips.submissions)
    .filter(clip => clip.weekKey === weekKey && !clip.disqualified)
    .sort((a, b) => (b.votes?.length || 0) - (a.votes?.length || 0) || a.createdAt - b.createdAt);
  data.clips.lastFinishedWeek = weekKey;
  if (!clips.length) return null;
  const winner = clips[0];
  winner.winner = true;
  data.clips.winners[weekKey] = {
    clipId: winner.id,
    userId: winner.userId,
    votes: winner.votes?.length || 0,
    awardedAt: Date.now(),
  };
  await checkAndAwardBadges(data, winner.userId);

  for (const clip of clips) {
    const channel = await guild.channels.fetch(clip.channelId).catch(() => null);
    const message = channel?.isTextBased() ? await channel.messages.fetch(clip.messageId).catch(() => null) : null;
    if (message) await message.edit(clipPayload(clip, true)).catch(() => {});
  }

  const channel = data.config.clipChannelId
    ? await guild.channels.fetch(data.config.clipChannelId).catch(() => null)
    : null;
  if (channel?.isTextBased()) {
    await channel.send({
      content: `<@${winner.userId}>`,
      embeds: [new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle('🏆 Clip der Woche')
        .setDescription(`**[${winner.title}](${winner.url})** von <@${winner.userId}> hat mit **${winner.votes?.length || 0} Stimmen** gewonnen!`)
        .setTimestamp()],
      allowedMentions: { users: [winner.userId] },
    }).catch(() => {});
  }
  return winner;
}

function lfgPayload(entry, disabled = false) {
  const players = Array.isArray(entry.players) ? entry.players : [];
  const playerText = players.length ? players.map(id => `<@${id}>`).join(', ') : '*Noch niemand dabei.*';
  const embed = new EmbedBuilder()
    .setColor(entry.closed ? 0x2b2d31 : 0x2ecc71)
    .setTitle(`🎮 Mitspielersuche • ${entry.game}`)
    .setDescription(entry.description || 'Gemeinsam spielen und neue Leute kennenlernen!')
    .addFields(
      { name: `Teilnehmer (${players.length}/${entry.slots})`, value: playerText },
      { name: 'Erstellt von', value: `<@${entry.ownerId}>`, inline: true },
      { name: 'Status', value: entry.closed ? '🔒 Geschlossen' : '🟢 Offen', inline: true },
    )
    .setFooter({ text: `Suche-ID: ${entry.id}` })
    .setTimestamp(entry.createdAt);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`lfg_join:${entry.id}`).setLabel('Beitreten / Verlassen').setEmoji('🙋').setStyle(ButtonStyle.Success).setDisabled(disabled || entry.closed),
    new ButtonBuilder().setCustomId(`lfg_close:${entry.id}`).setLabel('Suche schließen').setEmoji('🔒').setStyle(ButtonStyle.Danger).setDisabled(disabled || entry.closed),
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

function challengePayload(challenge, disabled = false) {
  const progress = Math.min(challenge.goal, Object.values(challenge.contributions || {}).reduce((sum, value) => sum + Number(value || 0), 0));
  const percent = Math.min(100, Math.floor((progress / Math.max(1, challenge.goal)) * 100));
  const top = Object.entries(challenge.contributions || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topText = top.length ? top.map(([userId, value], index) => `${index + 1}. <@${userId}> • **${value} ${challenge.unit}**`).join('\n') : '*Noch keine Beiträge.*';
  const embed = new EmbedBuilder()
    .setColor(challenge.completed ? 0x2ecc71 : 0x8b5cf6)
    .setTitle(`${challenge.completed ? '✅' : '🤝'} Community-Challenge • ${challenge.title}`)
    .setDescription(`${challenge.description || 'Gemeinsam schaffen wir das Ziel!'}\n\n${'▰'.repeat(Math.round(percent / 10))}${'▱'.repeat(10 - Math.round(percent / 10))}\n**${progress} / ${challenge.goal} ${challenge.unit} • ${percent}%**`)
    .addFields({ name: 'Top-Beiträge', value: topText })
    .setFooter({ text: `Challenge-ID: ${challenge.id}` })
    .setTimestamp(challenge.createdAt);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`challenge_contribute:${challenge.id}`).setLabel(challenge.completed ? 'Ziel erreicht' : 'Beitrag eintragen').setEmoji('➕').setStyle(ButtonStyle.Primary).setDisabled(disabled || challenge.completed),
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

function quizPayload(quiz) {
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🧠 Community-Quiz')
    .setDescription(`## ${quiz.question}\n\nWähle die richtige Antwort. Jeder kann einmal mitmachen!`)
    .setFooter({ text: `Quiz-ID: ${quiz.id}` });
  const row = new ActionRowBuilder();
  quiz.options.forEach((option, index) => {
    row.addComponents(new ButtonBuilder().setCustomId(`quiz_answer:${quiz.id}:${index}`).setLabel(`${index + 1}. ${option}`.slice(0, 80)).setStyle(ButtonStyle.Primary));
  });
  return { embeds: [embed], components: [row] };
}

function interestPanelPayload(guild, data) {
  const options = data.interests.options.slice(0, 25);
  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle('👋 Willkommen! Was interessiert dich?')
    .setDescription(options.length
      ? 'Wähle unten deine Interessen aus. Du bekommst sofort die passenden Rollen und kannst sie jederzeit wieder entfernen.'
      : 'Es wurden noch keine Interessen eingerichtet.')
    .setFooter({ text: guild.name });
  const rows = [];
  for (let i = 0; i < options.length; i += 5) {
    const row = new ActionRowBuilder();
    for (const option of options.slice(i, i + 5)) {
      row.addComponents(new ButtonBuilder().setCustomId(`interest_role:${option.roleId}`).setLabel(option.label.slice(0, 80)).setEmoji('🏷️').setStyle(ButtonStyle.Secondary));
    }
    rows.push(row);
  }
  return { embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}

async function updateInterestPanel(guild, data, channelOverride = null) {
  const channel = channelOverride || (data.config.interestsChannelId
    ? await guild.channels.fetch(data.config.interestsChannelId).catch(() => null)
    : null);
  if (!channel?.isTextBased()) return null;
  let message = data.interests.panelMessageId
    ? await channel.messages.fetch(data.interests.panelMessageId).catch(() => null)
    : null;
  if (message) await message.edit(interestPanelPayload(guild, data));
  else {
    message = await channel.send(interestPanelPayload(guild, data));
    data.interests.panelMessageId = message.id;
  }
  data.config.interestsChannelId = channel.id;
  return message;
}

function profileEmbed(user, data) {
  const profile = data.profiles[user.id] || {};
  const activity = activityFor(data, user.id, 'total');
  const monthly = activityFor(data, user.id, 'month');
  const rep = data.reputation.users[user.id]?.points || 0;
  const level = calculateLevel(data.levels[user.id]?.xp || 0);
  const invites = data.inviteStats[user.id]?.active || 0;
  const badges = (data.achievements[user.id] || []).filter(id => BADGES[id]);
  const ranking = activityLeaderboard(data, 'total');
  const place = ranking.findIndex(entry => entry.userId === user.id) + 1;
  const badgeText = badges.length
    ? badges.map(id => `${BADGES[id].emoji} **${BADGES[id].name}**`).join(' • ')
    : '*Noch keine Abzeichen.*';
  return new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle(`👤 Community-Profil • ${user.username}`)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setDescription(profile.bio || '*Noch keine Beschreibung hinterlegt.*')
    .addFields(
      { name: '🎮 Lieblingsspiel', value: profile.game || 'Nicht angegeben', inline: true },
      { name: '🏆 Level', value: String(level), inline: true },
      { name: '💜 Reputation', value: String(rep), inline: true },
      { name: '💬 Nachrichten', value: `${activity.messages || 0} gesamt\n${monthly.messages || 0} diesen Monat`, inline: true },
      { name: '🎧 Voice-Zeit', value: formatLongDuration(activity.voiceMs || 0), inline: true },
      { name: '📊 Community-Rang', value: place ? `Platz ${place}` : 'Noch nicht platziert', inline: true },
      { name: '🔗 Aktive Einladungen', value: String(invites), inline: true },
      { name: '🎬 Clip-Siege', value: String(clipWinCount(data, user.id)), inline: true },
      { name: '🏅 Abzeichen', value: badgeText },
    )
    .setFooter({ text: `Community-Punkte: ${communityScore(activity)}` });
}

async function handleCommunityGameMessage(message, data) {
  const game = data.games.channels[message.channel.id];
  if (!game) return false;
  const content = message.content.trim();

  const reject = async reason => {
    if (message.deletable) {
      suggestionSourceDeletes.add(message.id);
      await message.delete().catch(() => suggestionSourceDeletes.delete(message.id));
      setTimeout(() => suggestionSourceDeletes.delete(message.id), 10_000);
    }
    const notice = await message.channel.send({ content: `❌ <@${message.author.id}> ${reason}`, allowedMentions: { users: [message.author.id] } }).catch(() => null);
    if (notice) setTimeout(() => notice.delete().catch(() => {}), 5000);
  };

  if (game.type === 'counting') {
    const number = Number(content);
    if (!Number.isInteger(number) || number !== game.current + 1) {
      await reject(`die nächste Zahl ist **${game.current + 1}**.`);
      return true;
    }
    if (game.lastUserId === message.author.id) {
      await reject('du darfst nicht zweimal hintereinander zählen.');
      return true;
    }
    game.current = number;
    game.lastUserId = message.author.id;
    saveData(data);
    await message.react('✅').catch(() => {});
    return true;
  }

  if (game.type === 'wordchain') {
    const word = content.toLocaleLowerCase('de-DE');
    if (!/^[a-zäöüß]{2,30}$/i.test(word)) {
      await reject('bitte schreibe genau ein gültiges Wort.');
      return true;
    }
    if (game.lastUserId === message.author.id) {
      await reject('du darfst nicht zweimal hintereinander schreiben.');
      return true;
    }
    if (game.lastWord && word[0] !== game.lastWord.slice(-1)) {
      await reject(`dein Wort muss mit **${game.lastWord.slice(-1).toUpperCase()}** beginnen.`);
      return true;
    }
    if ((game.usedWords || []).includes(word)) {
      await reject('dieses Wort wurde bereits verwendet.');
      return true;
    }
    game.lastWord = word;
    game.lastUserId = message.author.id;
    game.usedWords = [...(game.usedWords || []), word].slice(-500);
    saveData(data);
    await message.react('✅').catch(() => {});
    return true;
  }

  if (game.type === 'number') {
    const number = Number(content);
    if (!Number.isInteger(number) || number < 1 || number > game.max) {
      await reject(`rate eine ganze Zahl zwischen **1 und ${game.max}**.`);
      return true;
    }
    game.attempts = (game.attempts || 0) + 1;
    if (number === game.secret) {
      delete data.games.channels[message.channel.id];
      saveData(data);
      await message.react('🎉').catch(() => {});
      await message.channel.send({ content: `🎉 <@${message.author.id}> hat die Zahl **${number}** nach **${game.attempts} Versuchen** erraten!`, allowedMentions: { users: [message.author.id] } });
      return true;
    }
    saveData(data);
    await message.reply({ content: number < game.secret ? '⬆️ Die gesuchte Zahl ist **größer**.' : '⬇️ Die gesuchte Zahl ist **kleiner**.', allowedMentions: { parse: [] } }).catch(() => {});
    return true;
  }
  return false;
}


// ============================================================
// ENGAGEMENT • COINS / DAILY / MISSIONS / SEASONS / DROPS
// ============================================================

const ENGAGEMENT_MESSAGE_COOLDOWN_MS = 2 * 60 * 1000;
const RANDOM_DROP_MIN_GAP_MS = 2 * 60 * 60 * 1000;
const RANDOM_DROP_EXPIRE_MS = 5 * 60 * 1000;

const DAILY_MISSIONS = {
  messages: { label: 'Chat Aktiv', emoji: '💬', target: 15, reward: 100, season: 20, unit: 'Nachrichten' },
  voice: { label: 'Voice Aktiv', emoji: '🎧', target: 30 * 60 * 1000, reward: 125, season: 25, unit: 'Voice' },
  poll: { label: 'Mitbestimmen', emoji: '📊', target: 1, reward: 50, season: 10, unit: 'Abstimmung' },
  daily: { label: 'Daily sichern', emoji: '🔥', target: 1, reward: 50, season: 10, unit: 'Daily' },
};

function shiftDateKey(dateKey, days) {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function ensureWallet(data, userId) {
  if (!data.engagement.wallets[userId]) {
    data.engagement.wallets[userId] = {
      coins: 0,
      lifetime: 0,
      spent: 0,
      streak: 0,
      bestStreak: 0,
      lastDailyDate: null,
      lastMessageRewardAt: 0,
    };
  }
  return data.engagement.wallets[userId];
}

function seasonKey() {
  return localDateInfo().month;
}

function addCoins(data, userId, amount) {
  const value = Math.max(0, Math.floor(Number(amount) || 0));
  const wallet = ensureWallet(data, userId);
  wallet.coins += value;
  wallet.lifetime += value;
  return wallet;
}

function addSeasonPoints(data, userId, amount) {
  const key = seasonKey();
  if (!data.engagement.seasons[key]) data.engagement.seasons[key] = { users: {}, createdAt: Date.now() };
  const season = data.engagement.seasons[key];
  season.users[userId] = (season.users[userId] || 0) + Math.max(0, Math.floor(Number(amount) || 0));
  return season.users[userId];
}

function ensureDailyStats(data, timestamp = Date.now()) {
  const key = localDateInfo(timestamp).date;
  if (!data.engagement.stats.days[key]) {
    data.engagement.stats.days[key] = { messages: 0, voiceMs: 0, joins: 0, coinsAwarded: 0 };
  }
  return data.engagement.stats.days[key];
}

function ensureMissionRecord(data, userId) {
  const date = localDateInfo().date;
  const current = data.engagement.missions.users[userId];
  if (!current || current.date !== date) {
    data.engagement.missions.users[userId] = {
      date,
      messages: 0,
      voiceMs: 0,
      pollVotes: 0,
      dailyClaimed: 0,
      claimed: [],
    };
  }
  return data.engagement.missions.users[userId];
}

function missionProgress(record, key) {
  if (key === 'messages') return record.messages || 0;
  if (key === 'voice') return record.voiceMs || 0;
  if (key === 'poll') return record.pollVotes || 0;
  if (key === 'daily') return record.dailyClaimed || 0;
  return 0;
}

function missionProgressText(record, key) {
  const def = DAILY_MISSIONS[key];
  const current = missionProgress(record, key);
  if (key === 'voice') return `${Math.min(30, Math.floor(current / 60000))}/30 Min`;
  return `${Math.min(def.target, current)}/${def.target}`;
}

function seasonLeaderboard(data) {
  const season = data.engagement.seasons[seasonKey()] || { users: {} };
  return Object.entries(season.users || {})
    .map(([userId, points]) => ({ userId, points: Number(points) || 0 }))
    .filter(entry => entry.points > 0)
    .sort((a, b) => b.points - a.points);
}

function coinLeaderboard(data) {
  return Object.entries(data.engagement.wallets || {})
    .map(([userId, wallet]) => ({ userId, coins: Number(wallet.coins) || 0, lifetime: Number(wallet.lifetime) || 0 }))
    .filter(entry => entry.lifetime > 0)
    .sort((a, b) => b.coins - a.coins || b.lifetime - a.lifetime);
}

function recordEngagementMessage(message, data) {
  if (!data.engagement.enabled) return;
  const mission = ensureMissionRecord(data, message.author.id);
  mission.messages++;
  const stats = ensureDailyStats(data, message.createdTimestamp);
  stats.messages++;

  const wallet = ensureWallet(data, message.author.id);
  if (Date.now() - (wallet.lastMessageRewardAt || 0) >= ENGAGEMENT_MESSAGE_COOLDOWN_MS) {
    wallet.lastMessageRewardAt = Date.now();
    addCoins(data, message.author.id, 2);
    addSeasonPoints(data, message.author.id, 1);
    stats.coinsAwarded += 2;
  }
  saveData(data);
}

function recordEngagementVoice(data, userId, duration) {
  if (!data.engagement.enabled || !duration) return;
  const mission = ensureMissionRecord(data, userId);
  mission.voiceMs += duration;
  const stats = ensureDailyStats(data);
  stats.voiceMs += duration;
  const fiveMinuteBlocks = Math.floor(duration / (5 * 60 * 1000));
  if (fiveMinuteBlocks > 0) {
    addCoins(data, userId, fiveMinuteBlocks * 3);
    addSeasonPoints(data, userId, fiveMinuteBlocks * 2);
    stats.coinsAwarded += fiveMinuteBlocks * 3;
  }
}

function activityPanelPayload(guild, data) {
  const today = ensureDailyStats(data);
  const activeVoice = guild.members.cache.filter(member => !member.user.bot && member.voice.channelId).size;
  const topActivity = activityLeaderboard(data, 'month').slice(0, 3);
  const topSeason = seasonLeaderboard(data).slice(0, 3);
  const topCoins = coinLeaderboard(data).slice(0, 3);
  const line = (entries, valueFn) => entries.length
    ? entries.map((entry, index) => `**${index + 1}.** <@${entry.userId}> • ${valueFn(entry)}`).join('\n')
    : '*Noch keine Daten.*';

  return {
    embeds: [new EmbedBuilder()
      .setColor(data.config.setupThemeColor || 0x8b5cf6)
      .setTitle('⚡ COMMUNITY LIVE')
      .setDescription('Aktivität, Coins und Season-Fortschritt werden automatisch aktualisiert.')
      .addFields(
        { name: '📅 Heute', value: `💬 **${today.messages || 0}** Nachrichten\n🎧 **${formatLongDuration(today.voiceMs || 0)}** Voice\n👋 **${today.joins || 0}** neue Member`, inline: true },
        { name: '🔊 Jetzt im Voice', value: `**${activeVoice}** Mitglieder`, inline: true },
        { name: '🔥 Season', value: `**${seasonKey()}**`, inline: true },
        { name: '🏆 Aktivität • Monat', value: line(topActivity, e => `${e.score} Punkte`) },
        { name: '⚡ Season Top 3', value: line(topSeason, e => `${e.points} SP`), inline: true },
        { name: '🪙 Coins Top 3', value: line(topCoins, e => `${e.coins} Coins`), inline: true },
      )
      .setFooter({ text: 'Daily • Missionen • Coins • Shop • Seasons • Random Drops' })
      .setTimestamp()],
    allowedMentions: { parse: [] },
  };
}

async function updateActivityPanel(guild, data, forceCreate = false) {
  if (!data.engagement.enabled || !data.config.engagementChannelId) return null;
  const channel = await guild.channels.fetch(data.config.engagementChannelId).catch(() => null);
  if (!channel?.isTextBased()) return null;
  let message = null;
  if (data.engagement.activityPanelMessageId && !forceCreate) {
    message = await channel.messages.fetch(data.engagement.activityPanelMessageId).catch(() => null);
  }
  if (message) {
    await message.edit(activityPanelPayload(guild, data)).catch(() => {});
  } else {
    message = await channel.send(activityPanelPayload(guild, data)).catch(() => null);
    if (message) data.engagement.activityPanelMessageId = message.id;
  }
  saveData(data);
  return message;
}

async function expireRandomDrop(guild, data) {
  const drop = data.engagement.drop;
  if (!drop?.activeId || drop.claimedBy || drop.expiresAt > Date.now()) return false;
  const channel = drop.channelId ? await guild.channels.fetch(drop.channelId).catch(() => null) : null;
  const message = channel?.isTextBased() && drop.messageId ? await channel.messages.fetch(drop.messageId).catch(() => null) : null;
  if (message) {
    const disabled = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`coin_drop:${drop.activeId}`).setLabel('Drop abgelaufen').setEmoji('💨').setStyle(ButtonStyle.Secondary).setDisabled(true),
    );
    await message.edit({ components: [disabled] }).catch(() => {});
  }
  data.engagement.drop.activeId = null;
  data.engagement.drop.messageId = null;
  data.engagement.drop.channelId = null;
  data.engagement.drop.reward = 0;
  data.engagement.drop.expiresAt = 0;
  saveData(data);
  return true;
}

async function createRandomDrop(guild, data, manual = false) {
  if (!data.engagement.enabled || !data.config.engagementChannelId) return null;
  await expireRandomDrop(guild, data);
  if (data.engagement.drop.activeId) return null;
  if (!manual && Date.now() - (data.engagement.drop.lastDropAt || 0) < RANDOM_DROP_MIN_GAP_MS) return null;
  if (!manual && Math.random() > 0.22) return null;

  const channel = await guild.channels.fetch(data.config.engagementChannelId).catch(() => null);
  if (!channel?.isTextBased()) return null;
  const id = createShortId('drop_');
  const reward = 100 + Math.floor(Math.random() * 201);
  const expiresAt = Date.now() + RANDOM_DROP_EXPIRE_MS;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`coin_drop:${id}`).setLabel(`${reward} Coins sichern`).setEmoji('⚡').setStyle(ButtonStyle.Success),
  );
  const message = await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('⚡ UNFUG DROP')
      .setDescription(`Wer zuerst klickt, bekommt **${reward} Coins**.\nDer Drop verschwindet <t:${Math.floor(expiresAt / 1000)}:R>.`)
      .setFooter({ text: 'First come, first served.' })],
    components: [row],
    allowedMentions: { parse: [] },
  }).catch(() => null);
  if (!message) return null;

  data.engagement.drop = { activeId: id, messageId: message.id, channelId: channel.id, reward, expiresAt, lastDropAt: Date.now(), claimedBy: null };
  saveData(data);
  return message;
}

async function checkEngagementAutomation(clientInstance) {
  for (const guild of clientInstance.guilds.cache.values()) {
    const data = loadData(guild.id);
    if (!data.engagement.enabled) continue;
    await expireRandomDrop(guild, data).catch(() => {});
    await updateActivityPanel(guild, data).catch(() => {});
    await createRandomDrop(guild, data, false).catch(() => {});
  }
}

async function checkCommunityAutomation(clientInstance) {
  const nowInfo = localDateInfo();
  const currentWeek = isoWeekKey();

  for (const guild of clientInstance.guilds.cache.values()) {
    const data = loadData(guild.id);
    let changed = false;

    if (data.dailyQuestions.enabled && nowInfo.hour >= Number(data.dailyQuestions.hour || 0) && data.dailyQuestions.lastPostedDate !== nowInfo.date) {
      const posted = await postDailyQuestion(guild, data).catch(() => null);
      if (posted) {
        data.dailyQuestions.lastPostedDate = nowInfo.date;
        changed = true;
      }
    }

    if (data.communityPolls.enabled && nowInfo.hour >= Number(data.communityPolls.hour || 0)) {
      const scheduledToday = data.communityPolls.cadence === 'daily' || nowInfo.weekday === Number(data.communityPolls.weekday);
      const key = data.communityPolls.cadence === 'daily' ? nowInfo.date : currentWeek;
      if (scheduledToday && data.communityPolls.lastPostedKey !== key) {
        const posted = await postCommunityPoll(guild, data).catch(() => null);
        if (posted) {
          data.communityPolls.lastPostedKey = key;
          changed = true;
        }
      }
    }

    if (data.memberOfMonth.enabled) {
      const month = previousMonthKey();
      if (data.memberOfMonth.lastAwardedMonth !== month) {
        await awardMemberOfMonth(guild, data, month).catch(() => null);
        changed = true;
      }
    }

    if (data.clips.enabled) {
      if (!data.clips.activeWeek) {
        data.clips.activeWeek = currentWeek;
        changed = true;
      } else if (data.clips.activeWeek !== currentWeek) {
        await finishClipWeek(guild, data, data.clips.activeWeek).catch(() => null);
        data.clips.activeWeek = currentWeek;
        changed = true;
      }
    }

    for (const [quizId, quiz] of Object.entries(data.games.quizzes || {})) {
      if (Date.now() - quiz.createdAt > 2 * 60 * 60 * 1000) {
        delete data.games.quizzes[quizId];
        changed = true;
      }
    }

    if (changed) saveData(data);
  }
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
      .setName('daily')
      .setDescription('Holt deine tägliche Coin-Belohnung und erhöht deinen Streak.'),
    new SlashCommandBuilder()
      .setName('coins')
      .setDescription('Coins und Coin-Ranking.')
      .addSubcommand(s => s.setName('balance').setDescription('Zeigt einen Coin-Stand.').addUserOption(o => o.setName('user').setDescription('Mitglied').setRequired(false)))
      .addSubcommand(s => s.setName('leaderboard').setDescription('Zeigt die reichsten Community-Mitglieder.')),
    new SlashCommandBuilder()
      .setName('missions')
      .setDescription('Tägliche Community-Missionen.')
      .addSubcommand(s => s.setName('view').setDescription('Zeigt deine heutigen Missionen.'))
      .addSubcommand(s => s.setName('claim').setDescription('Holt die Belohnung einer fertigen Mission.').addStringOption(o => o.setName('mission').setDescription('Mission').setRequired(true).addChoices(
        { name: 'Chat Aktiv', value: 'messages' },
        { name: 'Voice Aktiv', value: 'voice' },
        { name: 'Mitbestimmen', value: 'poll' },
        { name: 'Daily sichern', value: 'daily' },
      ))),
    new SlashCommandBuilder()
      .setName('season')
      .setDescription('Zeigt Season-Punkte und Platzierung.')
      .addUserOption(o => o.setName('user').setDescription('Mitglied').setRequired(false)),
    new SlashCommandBuilder()
      .setName('seasonleaderboard')
      .setDescription('Zeigt die aktuelle Season-Bestenliste.'),
    new SlashCommandBuilder()
      .setName('shop')
      .setDescription('Community-Shop für Coin-Belohnungen.')
      .addSubcommand(s => s.setName('list').setDescription('Zeigt alle Shop-Items.'))
      .addSubcommand(s => s.setName('buy').setDescription('Kauft ein Shop-Item.').addStringOption(o => o.setName('id').setDescription('Item-ID').setRequired(true)))
      .addSubcommand(s => s.setName('add').setDescription('Fügt eine Discord-Rolle zum Shop hinzu.')
        .addStringOption(o => o.setName('id').setDescription('Kurze Item-ID, z. B. vip').setRequired(true).setMaxLength(24))
        .addStringOption(o => o.setName('name').setDescription('Anzeigename').setRequired(true).setMaxLength(60))
        .addIntegerOption(o => o.setName('preis').setDescription('Preis in Coins').setRequired(true).setMinValue(1).setMaxValue(1000000))
        .addRoleOption(o => o.setName('rolle').setDescription('Rolle, die der Käufer erhält').setRequired(true)))
      .addSubcommand(s => s.setName('remove').setDescription('Entfernt ein Shop-Item.').addStringOption(o => o.setName('id').setDescription('Item-ID').setRequired(true))),
    new SlashCommandBuilder()
      .setName('engagement')
      .setDescription('Richtet Coins, Drops und Live-Aktivität ein.')
      .addSubcommand(s => s.setName('setup').setDescription('Aktiviert das Engagement-System in einem Channel.').addChannelOption(o => o.setName('channel').setDescription('Activity-Hub').setRequired(true).addChannelTypes(ChannelType.GuildText)))
      .addSubcommand(s => s.setName('status').setDescription('Zeigt den Status des Engagement-Systems.'))
      .addSubcommand(s => s.setName('drop').setDescription('Startet manuell einen Random Drop.')),

    new SlashCommandBuilder()
      .setName('setupserver')
      .setDescription('Baut den kompletten Discord-Server mit einem Design neu auf.')
      .addStringOption(o => o
        .setName('design')
        .setDescription('Welches Server-Design soll erstellt werden?')
        .setRequired(true)
        .addChoices(
          { name: 'Design 1 • Clean Community', value: '1' },
          { name: 'Design 2 • Gambo / Szene • Redline', value: '2' },
          { name: 'Design 3 • Minimal Elite • Obsidian', value: '3' },
          { name: 'Design 4 • UNFUGSTIFTER Private Edition', value: '4' },
        ))
      .addBooleanOption(o => o
        .setName('bestaetigen')
        .setDescription('MUSS true sein: alte Channels/Rollen werden gelöscht.')
        .setRequired(true)),
    new SlashCommandBuilder()
      .setName('backupserver')
      .setDescription('Sichert Rollen, Channels und Bot-Konfiguration des Servers.'),
    new SlashCommandBuilder()
      .setName('restoreserver')
      .setDescription('Stellt das letzte Server-Backup wieder her.')
      .addBooleanOption(o => o
        .setName('bestaetigen')
        .setDescription('MUSS true sein: aktuelles Server-Design wird ersetzt.')
        .setRequired(true)),

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
          { name: 'Frage des Tages', value: 'questions' },
          { name: 'Community-Umfragen', value: 'communitypolls' },
          { name: 'Mitglied des Monats', value: 'membermonth' },
          { name: 'Clips der Woche', value: 'clips' },
          { name: 'Mitspielersuche', value: 'lfg' },
          { name: 'Community-Challenges', value: 'challenges' },
          { name: 'Anonyme Nachrichten', value: 'anonymous' },
          { name: 'Willkommen & Interessen', value: 'interests' },
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
          { name: 'Mitglied des Monats', value: 'membermonth' },
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
      .setName('clear')
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

    // Community-Aktivität
    new SlashCommandBuilder()
      .setName('frage')
      .setDescription('Verwaltet die Frage des Tages.')
      .addSubcommand(s => s.setName('setup').setDescription('Aktiviert die tägliche Frage.').addChannelOption(o => o.setName('channel').setDescription('Channel für die Fragen').setRequired(true).addChannelTypes(ChannelType.GuildText)).addIntegerOption(o => o.setName('stunde').setDescription('Uhrzeit in österreichischer Zeit').setRequired(false).setMinValue(0).setMaxValue(23)))
      .addSubcommand(s => s.setName('add').setDescription('Fügt eine eigene Frage hinzu.').addStringOption(o => o.setName('text').setDescription('Neue Frage').setRequired(true).setMaxLength(500)))
      .addSubcommand(s => s.setName('remove').setDescription('Entfernt eine eigene Frage.').addIntegerOption(o => o.setName('nummer').setDescription('Nummer aus /frage list').setRequired(true).setMinValue(1).setMaxValue(100)))
      .addSubcommand(s => s.setName('list').setDescription('Zeigt die eigenen Fragen.'))
      .addSubcommand(s => s.setName('post').setDescription('Postet sofort eine Frage.'))
      .addSubcommand(s => s.setName('disable').setDescription('Deaktiviert die Automatik.'))
      .addSubcommand(s => s.setName('status').setDescription('Zeigt die Einstellungen.')),

    new SlashCommandBuilder()
      .setName('communitypoll')
      .setDescription('Verwaltet automatische Community-Umfragen.')
      .addSubcommand(s => s.setName('setup').setDescription('Aktiviert automatische Umfragen.').addChannelOption(o => o.setName('channel').setDescription('Umfrage-Channel').setRequired(true).addChannelTypes(ChannelType.GuildText)).addStringOption(o => o.setName('rhythmus').setDescription('Täglich oder wöchentlich').setRequired(true).addChoices({ name: 'Täglich', value: 'daily' }, { name: 'Wöchentlich', value: 'weekly' })).addIntegerOption(o => o.setName('stunde').setDescription('Uhrzeit in österreichischer Zeit').setRequired(false).setMinValue(0).setMaxValue(23)).addIntegerOption(o => o.setName('wochentag').setDescription('Nur bei wöchentlich').setRequired(false).addChoices({ name: 'Montag', value: 1 }, { name: 'Dienstag', value: 2 }, { name: 'Mittwoch', value: 3 }, { name: 'Donnerstag', value: 4 }, { name: 'Freitag', value: 5 }, { name: 'Samstag', value: 6 }, { name: 'Sonntag', value: 0 })))
      .addSubcommand(s => s.setName('add').setDescription('Fügt eine Umfrage-Vorlage hinzu.').addStringOption(o => o.setName('frage').setDescription('Umfragefrage').setRequired(true).setMaxLength(300)).addStringOption(o => o.setName('optionen').setDescription('2–5 Antworten mit | trennen').setRequired(true).setMaxLength(500)))
      .addSubcommand(s => s.setName('remove').setDescription('Entfernt eine Vorlage.').addIntegerOption(o => o.setName('nummer').setDescription('Nummer aus /communitypoll list').setRequired(true).setMinValue(1).setMaxValue(100)))
      .addSubcommand(s => s.setName('list').setDescription('Zeigt alle Vorlagen.'))
      .addSubcommand(s => s.setName('post').setDescription('Postet sofort die nächste Umfrage.'))
      .addSubcommand(s => s.setName('disable').setDescription('Deaktiviert die Automatik.'))
      .addSubcommand(s => s.setName('status').setDescription('Zeigt die Einstellungen.')),

    new SlashCommandBuilder()
      .setName('memberofthemonth')
      .setDescription('Verwaltet das Mitglied des Monats.')
      .addSubcommand(s => s.setName('setup').setDescription('Aktiviert die monatliche Auszeichnung.').addChannelOption(o => o.setName('channel').setDescription('Channel für die Auszeichnung').setRequired(true).addChannelTypes(ChannelType.GuildText)).addRoleOption(o => o.setName('rolle').setDescription('Optionale Gewinnerrolle').setRequired(false)))
      .addSubcommand(s => s.setName('run').setDescription('Wertet einen Monat sofort aus.').addStringOption(o => o.setName('monat').setDescription('YYYY-MM, sonst aktueller Monat').setRequired(false).setMaxLength(7)))
      .addSubcommand(s => s.setName('disable').setDescription('Deaktiviert die Automatik.'))
      .addSubcommand(s => s.setName('status').setDescription('Zeigt den Status.')),

    new SlashCommandBuilder()
      .setName('rep')
      .setDescription('Gibt einem Mitglied einen Reputationspunkt.')
      .addUserOption(o => o.setName('user').setDescription('Mitglied').setRequired(true))
      .addStringOption(o => o.setName('grund').setDescription('Warum möchtest du dich bedanken?').setRequired(false).setMaxLength(300)),
    new SlashCommandBuilder().setName('reps').setDescription('Zeigt die Reputation eines Mitglieds.').addUserOption(o => o.setName('user').setDescription('Mitglied').setRequired(false)),
    new SlashCommandBuilder().setName('communityrank').setDescription('Zeigt deine Chat- und Voice-Aktivität.').addUserOption(o => o.setName('user').setDescription('Mitglied').setRequired(false)),
    new SlashCommandBuilder().setName('communityleaderboard').setDescription('Zeigt die aktivsten Community-Mitglieder.').addStringOption(o => o.setName('zeitraum').setDescription('Zeitraum').setRequired(false).addChoices({ name: 'Dieser Monat', value: 'month' }, { name: 'Gesamt', value: 'total' })),

    new SlashCommandBuilder()
      .setName('clip')
      .setDescription('Verwaltet den Clip der Woche.')
      .addSubcommand(s => s.setName('setup').setDescription('Legt den Clip-Channel fest.').addChannelOption(o => o.setName('channel').setDescription('Clip-Channel').setRequired(true).addChannelTypes(ChannelType.GuildText)))
      .addSubcommand(s => s.setName('submit').setDescription('Reicht einen Clip ein.').addStringOption(o => o.setName('url').setDescription('Link zum Clip').setRequired(true).setMaxLength(1000)).addStringOption(o => o.setName('titel').setDescription('Titel des Clips').setRequired(true).setMaxLength(100)))
      .addSubcommand(s => s.setName('top').setDescription('Zeigt die besten Clips dieser Woche.'))
      .addSubcommand(s => s.setName('finish').setDescription('Beendet die aktuelle Abstimmung sofort.')),

    new SlashCommandBuilder()
      .setName('mitspieler')
      .setDescription('Sucht Mitspieler in der Community.')
      .addSubcommand(s => s.setName('setup').setDescription('Legt den Mitspieler-Channel fest.').addChannelOption(o => o.setName('channel').setDescription('Mitspieler-Channel').setRequired(true).addChannelTypes(ChannelType.GuildText)))
      .addSubcommand(s => s.setName('create').setDescription('Erstellt eine Mitspielersuche.').addStringOption(o => o.setName('spiel').setDescription('Spiel oder Aktivität').setRequired(true).setMaxLength(100)).addIntegerOption(o => o.setName('plaetze').setDescription('Gesamtanzahl der Plätze').setRequired(true).setMinValue(2).setMaxValue(50)).addStringOption(o => o.setName('text').setDescription('Zusätzliche Informationen').setRequired(false).setMaxLength(1000)))
      .addSubcommand(s => s.setName('list').setDescription('Zeigt offene Mitspielersuchen.'))
      .addSubcommand(s => s.setName('close').setDescription('Schließt deine Suche.').addStringOption(o => o.setName('id').setDescription('Suche-ID').setRequired(true))),

    new SlashCommandBuilder()
      .setName('challenge')
      .setDescription('Verwaltet gemeinsame Community-Ziele.')
      .addSubcommand(s => s.setName('create').setDescription('Erstellt eine Challenge.').addStringOption(o => o.setName('titel').setDescription('Titel').setRequired(true).setMaxLength(100)).addIntegerOption(o => o.setName('ziel').setDescription('Gemeinsames Ziel').setRequired(true).setMinValue(1).setMaxValue(1000000)).addStringOption(o => o.setName('einheit').setDescription('z. B. Punkte, Runden oder Stunden').setRequired(true).setMaxLength(30)).addStringOption(o => o.setName('text').setDescription('Beschreibung').setRequired(false).setMaxLength(1000)).addChannelOption(o => o.setName('channel').setDescription('Ziel-Channel').setRequired(false).addChannelTypes(ChannelType.GuildText)))
      .addSubcommand(s => s.setName('list').setDescription('Zeigt laufende Challenges.'))
      .addSubcommand(s => s.setName('end').setDescription('Beendet eine Challenge.').addStringOption(o => o.setName('id').setDescription('Challenge-ID').setRequired(true))),

    new SlashCommandBuilder()
      .setName('game')
      .setDescription('Startet Community-Minispiele.')
      .addSubcommand(s => s.setName('start').setDescription('Startet ein Channel-Spiel.').addStringOption(o => o.setName('typ').setDescription('Spielart').setRequired(true).addChoices({ name: 'Zählen', value: 'counting' }, { name: 'Wörterkette', value: 'wordchain' }, { name: 'Zahl erraten', value: 'number' })).addIntegerOption(o => o.setName('maximum').setDescription('Nur beim Zahlenraten').setRequired(false).setMinValue(10).setMaxValue(100000)))
      .addSubcommand(s => s.setName('stop').setDescription('Beendet das Spiel im Channel.'))
      .addSubcommand(s => s.setName('status').setDescription('Zeigt das laufende Spiel.'))
      .addSubcommand(s => s.setName('quiz').setDescription('Startet eine Quizfrage.'))
      .addSubcommand(s => s.setName('leaderboard').setDescription('Zeigt die Quiz-Bestenliste.')),

    new SlashCommandBuilder().setName('badges').setDescription('Zeigt Erfolge und Abzeichen.').addUserOption(o => o.setName('user').setDescription('Mitglied').setRequired(false)),
    new SlashCommandBuilder().setName('anonymouspanel').setDescription('Erstellt die anonyme Nachrichtenbox.').addChannelOption(o => o.setName('inbox').setDescription('Nur das Team sollte diesen Channel sehen').setRequired(true).addChannelTypes(ChannelType.GuildText)),
    new SlashCommandBuilder().setName('anonymousinfo').setDescription('Zeigt den Absender einer anonymen Nachricht.').addStringOption(o => o.setName('id').setDescription('Nachrichten-ID').setRequired(true)),
    new SlashCommandBuilder().setName('profil').setDescription('Zeigt ein Community-Profil.').addUserOption(o => o.setName('user').setDescription('Mitglied').setRequired(false)),
    new SlashCommandBuilder().setName('profilset').setDescription('Bearbeitet dein Community-Profil.').addStringOption(o => o.setName('bio').setDescription('Kurze Beschreibung').setRequired(false).setMaxLength(500)).addStringOption(o => o.setName('spiel').setDescription('Dein Lieblingsspiel').setRequired(false).setMaxLength(100)),

    new SlashCommandBuilder()
      .setName('interessen')
      .setDescription('Verwaltet die Willkommens- und Interessenrollen.')
      .addSubcommand(s => s.setName('add').setDescription('Fügt eine Interesse-Auswahl hinzu.').addStringOption(o => o.setName('name').setDescription('z. B. FiveM oder Events').setRequired(true).setMaxLength(80)).addRoleOption(o => o.setName('rolle').setDescription('Passende Rolle').setRequired(true)))
      .addSubcommand(s => s.setName('remove').setDescription('Entfernt eine Interesse-Auswahl.').addRoleOption(o => o.setName('rolle').setDescription('Zu entfernende Rolle').setRequired(true)))
      .addSubcommand(s => s.setName('list').setDescription('Zeigt alle Interessen.'))
      .addSubcommand(s => s.setName('panel').setDescription('Erstellt oder aktualisiert das Willkommens-Panel.').addChannelOption(o => o.setName('channel').setDescription('Panel-Channel').setRequired(false).addChannelTypes(ChannelType.GuildText))),

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
    for (const guild of readyClient.guilds.cache.values()) {
      const data = loadData(guild.id);
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

  // Community-Aktivität nach einem Neustart für bereits verbundene Voice-Mitglieder neu starten.
  for (const guild of readyClient.guilds.cache.values()) {
    const startupData = loadData(guild.id);
    startupData.activity.voiceActive = {};
    for (const member of guild.members.cache.values()) {
      if (member.voice.channelId) startVoiceSession(startupData, member, member.voice.channelId);
    }
    saveData(startupData);
  }

  // Fragen, Umfragen, Mitglied des Monats und Clip der Woche automatisch ausführen.
  await checkCommunityAutomation(readyClient);
  setInterval(() => checkCommunityAutomation(readyClient).catch(() => {}), COMMUNITY_CHECK_INTERVAL_MS);

  // Coins, Live-Aktivität, Missionen und Random Drops.
  await checkEngagementAutomation(readyClient);
  setInterval(() => checkEngagementAutomation(readyClient).catch(() => {}), 15 * 60 * 1000);
});

// ============================================================
// MEMBER EVENTS
// ============================================================

client.on(Events.GuildMemberAdd, async member => {
  const data = loadData(member.guild.id);
  if (data.engagement.enabled && !member.user.bot) {
    ensureDailyStats(data, Date.now()).joins++;
    saveData(data);
  }

  const usedInvite = await detectUsedInvite(member.guild).catch(() => null);
  if (usedInvite?.inviter?.id) {
    const inviterId = usedInvite.inviter.id;
    const stats = data.inviteStats[inviterId] || { total: 0, active: 0, leaves: 0 };
    stats.total++;
    stats.active++;
    data.inviteStats[inviterId] = stats;
    data.inviteMembers[member.id] = inviterId;
    await checkAndAwardBadges(data, inviterId);
    saveData(data);
  }

  await handleRaidJoin(member, data).catch(error => console.error('❌ Raid-Schutz Fehler:', error));

  if (data.config.unverifiedRoleId) {
    await member.roles.add(data.config.unverifiedRoleId).catch(() => {});
  }

  if (data.config.welcomeChannelId) {
    const interestsHint = data.config.interestsChannelId
      ? `\n\nWähle in <#${data.config.interestsChannelId}> deine Interessen und passenden Rollen aus.`
      : '';
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('👋 Willkommen!')
      .setDescription(`Willkommen <@${member.id}> auf **${member.guild.name}**!${interestsHint}`)
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .addFields({ name: 'Mitglieder', value: String(member.guild.memberCount), inline: true })
      .setTimestamp();
    await sendEmbedToChannel(member.guild, data.config.welcomeChannelId, embed);
  }

  await logEvent(member.guild, data, '📥 Member Join', `<@${member.id}> (${member.user.tag}) ist dem Server beigetreten.`);
});

client.on(Events.GuildMemberRemove, async member => {
  const data = loadData(member.guild.id);

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
  const data = loadData(newMember.guild.id);
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
  const data = loadData(newState.guild.id);
  const lobbyId = data.config.tempVoiceLobbyId;

  if (oldState.channelId !== newState.channelId && !newState.member?.user.bot) {
    if (oldState.channelId) {
      const duration = finishVoiceSession(data, newState.member.id);
      if (duration) {
        recordEngagementVoice(data, newState.member.id, duration);
        await checkAndAwardBadges(data, newState.member.id);
      }
    }
    if (newState.channelId) startVoiceSession(data, newState.member, newState.channelId);
    saveData(data);
  }

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

  const data = loadData(message.guild.id);
  if (await handleAutomodMessage(message, data)) return;

  await recordCommunityMessage(message, data).catch(error => console.error('❌ Community-Aktivität Fehler:', error));
  recordEngagementMessage(message, data);
  await awardMessageXp(message, data).catch(error => console.error('❌ Level-System Fehler:', error));

  if (await handleCommunityGameMessage(message, data)) return;

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
  const data = loadData(message.guild.id);
  if (!data.config.logChannelId || message.channel.id === data.config.logChannelId) return;
  const text = message.content ? `\n**Inhalt:** ${message.content.slice(0, 1000)}` : '';
  await logEvent(message.guild, data, '🗑️ Nachricht gelöscht', `**Channel:** <#${message.channel.id}>\n**Autor:** ${message.author ? `<@${message.author.id}>` : 'Unbekannt'}${text}`);
});

client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (!newMessage.guild || newMessage.author?.bot) return;
  if (!oldMessage.content || !newMessage.content || oldMessage.content === newMessage.content) return;
  const data = loadData(newMessage.guild.id);
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
    const data = interaction.guildId ? loadData(interaction.guildId) : loadData();

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

      if (interaction.customId.startsWith('coin_drop:')) {
        const dropId = interaction.customId.split(':')[1];
        const drop = data.engagement.drop;
        if (!drop?.activeId || drop.activeId !== dropId || drop.claimedBy || drop.expiresAt <= Date.now()) {
          await interaction.reply({ content: '💨 Dieser Drop ist bereits weg oder abgelaufen.', ephemeral: true });
          return;
        }
        drop.claimedBy = interaction.user.id;
        const reward = Number(drop.reward) || 0;
        addCoins(data, interaction.user.id, reward);
        addSeasonPoints(data, interaction.user.id, Math.max(5, Math.floor(reward / 10)));
        ensureDailyStats(data).coinsAwarded += reward;
        drop.activeId = null;
        saveData(data);
        const disabled = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`coin_drop:${dropId}`).setLabel(`Gesichert von ${interaction.user.username}`.slice(0, 80)).setEmoji('✅').setStyle(ButtonStyle.Secondary).setDisabled(true),
        );
        await interaction.update({
          embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle('⚡ DROP GESICHERT').setDescription(`<@${interaction.user.id}> war am schnellsten und bekommt **${reward} Coins**!`)],
          components: [disabled],
          allowedMentions: { users: [interaction.user.id] },
        });
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

      if (interaction.customId.startsWith('community_poll_vote:')) {
        const [, pollId, rawIndex] = interaction.customId.split(':');
        const poll = data.communityPolls.active[pollId];
        const index = Number(rawIndex);
        if (!poll || !Number.isInteger(index) || !poll.options[index]) {
          await interaction.reply({ content: '❌ Diese Umfrage ist nicht mehr verfügbar.', ephemeral: true });
          return;
        }
        const previous = poll.votes[interaction.user.id];
        poll.votes[interaction.user.id] = index;
        if (data.engagement.enabled) {
          const mission = ensureMissionRecord(data, interaction.user.id);
          mission.pollVotes = Math.max(1, mission.pollVotes || 0);
        }
        saveData(data);
        await interaction.update(communityPollPayload(poll));
        await interaction.followUp({
          content: previous === undefined
            ? `✅ Deine Stimme für **${poll.options[index]}** wurde gezählt.`
            : `✅ Deine Stimme wurde auf **${poll.options[index]}** geändert.`,
          ephemeral: true,
        });
        return;
      }

      if (interaction.customId.startsWith('clip_vote:')) {
        const clipId = interaction.customId.split(':')[1];
        const clip = data.clips.submissions[clipId];
        if (!clip || clip.weekKey !== data.clips.activeWeek || data.clips.lastFinishedWeek === clip.weekKey) {
          await interaction.reply({ content: '❌ Die Abstimmung für diesen Clip ist beendet.', ephemeral: true });
          return;
        }
        if (clip.userId === interaction.user.id) {
          await interaction.reply({ content: '❌ Du kannst nicht für deinen eigenen Clip abstimmen.', ephemeral: true });
          return;
        }
        if (!Array.isArray(clip.votes)) clip.votes = [];
        const voted = clip.votes.includes(interaction.user.id);
        clip.votes = voted ? clip.votes.filter(id => id !== interaction.user.id) : [...clip.votes, interaction.user.id];
        saveData(data);
        await interaction.update(clipPayload(clip));
        await interaction.followUp({ content: voted ? '✅ Deine Stimme wurde entfernt.' : '⭐ Deine Stimme wurde gezählt!', ephemeral: true });
        return;
      }

      if (interaction.customId.startsWith('lfg_join:')) {
        const entryId = interaction.customId.split(':')[1];
        const entry = data.lfg[entryId];
        if (!entry || entry.closed) {
          await interaction.reply({ content: '❌ Diese Mitspielersuche ist geschlossen.', ephemeral: true });
          return;
        }
        if (!Array.isArray(entry.players)) entry.players = [];
        const joined = entry.players.includes(interaction.user.id);
        if (!joined && entry.players.length >= entry.slots) {
          await interaction.reply({ content: '❌ Alle Plätze sind bereits belegt.', ephemeral: true });
          return;
        }
        entry.players = joined ? entry.players.filter(id => id !== interaction.user.id) : [...entry.players, interaction.user.id];
        saveData(data);
        await interaction.update(lfgPayload(entry));
        await interaction.followUp({ content: joined ? '✅ Du hast die Gruppe verlassen.' : '🎮 Du bist jetzt dabei!', ephemeral: true });
        return;
      }

      if (interaction.customId.startsWith('lfg_close:')) {
        const entryId = interaction.customId.split(':')[1];
        const entry = data.lfg[entryId];
        if (!entry) {
          await interaction.reply({ content: '❌ Mitspielersuche nicht gefunden.', ephemeral: true });
          return;
        }
        if (entry.ownerId !== interaction.user.id && !canModerate(interaction.member, data)) {
          await interaction.reply({ content: '❌ Nur der Ersteller oder das Team darf diese Suche schließen.', ephemeral: true });
          return;
        }
        entry.closed = true;
        entry.closedAt = Date.now();
        saveData(data);
        await interaction.update(lfgPayload(entry, true));
        await interaction.followUp({ content: '🔒 Die Mitspielersuche wurde geschlossen.', ephemeral: true });
        return;
      }

      if (interaction.customId.startsWith('challenge_contribute:')) {
        const challengeId = interaction.customId.split(':')[1];
        const challenge = data.challenges[challengeId];
        if (!challenge || challenge.completed) {
          await interaction.reply({ content: '❌ Diese Challenge ist bereits beendet.', ephemeral: true });
          return;
        }
        const modal = new ModalBuilder().setCustomId(`challenge_submit:${challengeId}`).setTitle('Challenge-Beitrag');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('challenge_amount').setLabel(`Anzahl in ${challenge.unit}`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('challenge_note').setLabel('Kurze Notiz oder Beleg (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)),
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId.startsWith('quiz_answer:')) {
        const [, quizId, rawIndex] = interaction.customId.split(':');
        const quiz = data.games.quizzes[quizId];
        const index = Number(rawIndex);
        if (!quiz || Date.now() - quiz.createdAt > 2 * 60 * 60 * 1000) {
          await interaction.reply({ content: '❌ Dieses Quiz ist bereits abgelaufen.', ephemeral: true });
          return;
        }
        if (!Array.isArray(quiz.answeredUsers)) quiz.answeredUsers = [];
        if (quiz.answeredUsers.includes(interaction.user.id)) {
          await interaction.reply({ content: '❌ Du hast diese Frage bereits beantwortet.', ephemeral: true });
          return;
        }
        quiz.answeredUsers.push(interaction.user.id);
        const correct = index === quiz.answer;
        const score = data.games.quizScores[interaction.user.id] || { correct: 0, total: 0 };
        score.total++;
        if (correct) score.correct++;
        data.games.quizScores[interaction.user.id] = score;
        await checkAndAwardBadges(data, interaction.user.id, interaction.channel);
        saveData(data);
        await interaction.reply({
          content: correct
            ? `✅ Richtig! **${quiz.options[quiz.answer]}** ist die richtige Antwort.`
            : `❌ Leider falsch. Richtig wäre **${quiz.options[quiz.answer]}** gewesen.`,
          ephemeral: true,
        });
        return;
      }

      if (interaction.customId === 'anonymous_open') {
        if (!data.config.anonymousInboxChannelId) {
          await interaction.reply({ content: '❌ Die anonyme Nachrichtenbox ist nicht eingerichtet.', ephemeral: true });
          return;
        }
        const modal = new ModalBuilder().setCustomId('anonymous_submit').setTitle('Anonyme Nachricht');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('anonymous_subject').setLabel('Betreff').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('anonymous_message').setLabel('Deine Nachricht').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000)),
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId.startsWith('interest_role:')) {
        const roleId = interaction.customId.split(':')[1];
        const option = data.interests.options.find(entry => entry.roleId === roleId);
        const role = option ? await interaction.guild.roles.fetch(roleId).catch(() => null) : null;
        const botMember = interaction.guild.members.me;
        if (!role || role.managed || role.id === interaction.guild.id || !botMember || botMember.roles.highest.comparePositionTo(role) <= 0) {
          await interaction.reply({ content: '❌ Diese Interessenrolle kann der Bot nicht vergeben. Prüfe die Rollen-Reihenfolge.', ephemeral: true });
          return;
        }
        const hasRole = interaction.member.roles.cache.has(role.id);
        if (hasRole) await interaction.member.roles.remove(role);
        else await interaction.member.roles.add(role);
        await interaction.reply({ content: hasRole ? `➖ **${option.label}** wurde entfernt.` : `✅ **${option.label}** wurde ausgewählt.`, ephemeral: true });
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

      if (interaction.customId.startsWith('challenge_submit:')) {
        const challengeId = interaction.customId.split(':')[1];
        const challenge = data.challenges[challengeId];
        if (!challenge || challenge.completed) {
          await interaction.reply({ content: '❌ Diese Challenge ist bereits beendet.', ephemeral: true });
          return;
        }
        const rateKey = `${interaction.guildId}:${interaction.user.id}:${challengeId}`;
        if (Date.now() - (challengeRateLimits.get(rateKey) || 0) < 3000) {
          await interaction.reply({ content: '❌ Bitte warte kurz, bevor du erneut etwas einträgst.', ephemeral: true });
          return;
        }
        const amount = Number(interaction.fields.getTextInputValue('challenge_amount').trim());
        const note = interaction.fields.getTextInputValue('challenge_note').trim();
        if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) {
          await interaction.reply({ content: '❌ Bitte gib eine ganze Zahl zwischen 1 und 1.000.000 ein.', ephemeral: true });
          return;
        }
        challengeRateLimits.set(rateKey, Date.now());
        if (!challenge.contributions) challenge.contributions = {};
        challenge.contributions[interaction.user.id] = Number(challenge.contributions[interaction.user.id] || 0) + amount;
        if (!Array.isArray(challenge.notes)) challenge.notes = [];
        if (note) challenge.notes.push({ userId: interaction.user.id, amount, note, createdAt: Date.now() });
        challenge.notes = challenge.notes.slice(-100);
        const total = Object.values(challenge.contributions).reduce((sum, value) => sum + Number(value || 0), 0);
        if (total >= challenge.goal) {
          challenge.completed = true;
          challenge.completedAt = Date.now();
        }
        await checkAndAwardBadges(data, interaction.user.id, interaction.channel);
        saveData(data);

        const channel = await interaction.guild.channels.fetch(challenge.channelId).catch(() => null);
        const message = channel?.isTextBased() ? await channel.messages.fetch(challenge.messageId).catch(() => null) : null;
        if (message) await message.edit(challengePayload(challenge, challenge.completed)).catch(() => {});
        if (challenge.completed && channel?.isTextBased()) {
          await channel.send('🎉 **Die Community-Challenge wurde gemeinsam geschafft!**').catch(() => {});
        }
        await interaction.reply({ content: `✅ Dein Beitrag von **${amount} ${challenge.unit}** wurde eingetragen.${challenge.completed ? '\n🎉 Das gemeinsame Ziel wurde erreicht!' : ''}`, ephemeral: true });
        return;
      }

      if (interaction.customId === 'anonymous_submit') {
        const inbox = data.config.anonymousInboxChannelId
          ? await interaction.guild.channels.fetch(data.config.anonymousInboxChannelId).catch(() => null)
          : null;
        if (!inbox?.isTextBased()) {
          await interaction.reply({ content: '❌ Der Nachrichten-Channel wurde nicht gefunden.', ephemeral: true });
          return;
        }
        const submission = {
          id: createShortId('x'),
          guildId: interaction.guild.id,
          userId: interaction.user.id,
          subject: interaction.fields.getTextInputValue('anonymous_subject').trim(),
          message: interaction.fields.getTextInputValue('anonymous_message').trim(),
          createdAt: Date.now(),
        };
        const sent = await inbox.send({
          embeds: [new EmbedBuilder()
            .setColor(0x8b5cf6)
            .setTitle(`📮 Anonyme Nachricht • ${submission.subject}`)
            .setDescription(submission.message)
            .setFooter({ text: `Nachrichten-ID: ${submission.id}` })
            .setTimestamp(submission.createdAt)],
          allowedMentions: { parse: [] },
        });
        submission.channelId = inbox.id;
        submission.messageId = sent.id;
        data.anonymous.submissions[submission.id] = submission;
        saveData(data);
        await logEvent(
          interaction.guild,
          data,
          '📮 Anonyme Nachricht gesendet',
          `**Absender:** <@${submission.userId}> (\`${submission.userId}\`)\n**Nachrichten-ID:** \`${submission.id}\`\n**Betreff:** ${submission.subject}\n**Inbox:** <#${inbox.id}>\n**Nachricht:** ${submission.message}\n\n[Nachricht öffnen](${sent.url})`,
        );
        await interaction.reply({ content: `✅ Deine Nachricht wurde ohne sichtbaren Namen gesendet. **ID:** \`${submission.id}\``, ephemeral: true });
        return;
      }

      if (interaction.customId === 'socials_add_modal' || interaction.customId === 'socials_edit_modal') {
        const allowed = interaction.customId === 'socials_add_modal'
          ? canUseSocialsCommand(interaction.member)
          : canManageSocials(interaction.member, data);
        if (!allowed) {
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
          { name: '🛡️ Moderation', value: '`/warn` `/warnings` `/clearwarnings` `/timeout` `/untimeout` `/kick` `/ban` `/unban` `/unbanall` `/clear` `/purge` `/slowmode` `/lock` `/unlock`' },
          { name: '📣 Community', value: '`/announce` `/embed` `/poll` `/suggest` `/giveaway`' },
          { name: 'ℹ️ Info', value: '`/serverinfo` `/userinfo` `/avatar` `/ping`' },
          { name: '📨 Bewerbungen & Rollen', value: '`/applicationpanel` `/applicationlist` `/rolepanel`' },
          { name: '🛡️ Schutz & Voice', value: '`/automod` `/tempvoice` `/voice`' },
          { name: '🏆 Level & Invites', value: '`/rank` `/leaderboard` `/levelrole` `/levelsystem` `/invites` `/inviteleaderboard`' },
          { name: '📅 Events & Team', value: '`/event` `/duty` `/dutystats` `/dutyleaderboard`' },
          { name: '💬 Community-Aktivität', value: '`/frage` `/communitypoll` `/memberofthemonth` `/rep` `/reps` `/communityrank` `/communityleaderboard`' },
          { name: '⚡ Coins & Aktivität', value: '`/daily` `/coins` `/missions` `/shop` `/season` `/seasonleaderboard` `/engagement`' },
          { name: '🎮 Gemeinsam', value: '`/clip` `/mitspieler` `/challenge` `/game` `/badges`' },
          { name: '👤 Profile & Willkommen', value: '`/profil` `/profilset` `/interessen` `/anonymouspanel` `/anonymousinfo`' },
          { name: '🧩 Eigene Commands', value: '`/customcommand` oder gespeicherte Befehle mit `!name`' },
          { name: '⚙️ Einrichtung', value: '`/setupserver` `/backupserver` `/restoreserver` `/setup channel` `/setup role` `/setup tickets` `/setup show`' },
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


    if (command === 'daily') {
      if (!data.engagement.enabled) {
        await interaction.reply({ content: '❌ Das Engagement-System ist noch nicht aktiviert. Ein Admin kann `/engagement setup` nutzen.', ephemeral: true });
        return;
      }
      const wallet = ensureWallet(data, interaction.user.id);
      const today = localDateInfo().date;
      if (wallet.lastDailyDate === today) {
        await interaction.reply({ content: `🔥 Du hast dein Daily heute bereits abgeholt. Aktueller Streak: **${wallet.streak || 0} Tage**.`, ephemeral: true });
        return;
      }
      const yesterday = shiftDateKey(today, -1);
      wallet.streak = wallet.lastDailyDate === yesterday ? (wallet.streak || 0) + 1 : 1;
      wallet.bestStreak = Math.max(wallet.bestStreak || 0, wallet.streak);
      wallet.lastDailyDate = today;
      const reward = 75 + Math.min(150, Math.max(0, wallet.streak - 1) * 10);
      addCoins(data, interaction.user.id, reward);
      addSeasonPoints(data, interaction.user.id, 10);
      const mission = ensureMissionRecord(data, interaction.user.id);
      mission.dailyClaimed = 1;
      ensureDailyStats(data).coinsAwarded += reward;
      saveData(data);
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle('🔥 DAILY ABGEHOLT')
          .setDescription(`Du bekommst **${reward} Coins** + **10 Season Points**.`)
          .addFields(
            { name: 'Streak', value: `🔥 **${wallet.streak} Tage**`, inline: true },
            { name: 'Bestwert', value: `🏆 **${wallet.bestStreak} Tage**`, inline: true },
            { name: 'Kontostand', value: `🪙 **${wallet.coins} Coins**`, inline: true },
          )],
        ephemeral: true,
      });
      return;
    }

    if (command === 'coins') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'balance') {
        const user = interaction.options.getUser('user') || interaction.user;
        const wallet = ensureWallet(data, user.id);
        const season = data.engagement.seasons[seasonKey()]?.users?.[user.id] || 0;
        await interaction.reply({ embeds: [new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle(`🪙 Wallet • ${user.username}`)
          .setThumbnail(user.displayAvatarURL({ size: 256 }))
          .addFields(
            { name: 'Coins', value: `**${wallet.coins}**`, inline: true },
            { name: 'Lifetime', value: `**${wallet.lifetime}**`, inline: true },
            { name: 'Season Points', value: `**${season}**`, inline: true },
            { name: 'Daily Streak', value: `🔥 **${wallet.streak || 0} Tage**`, inline: true },
          )] });
        return;
      }
      const top = coinLeaderboard(data).slice(0, 10);
      const text = top.length ? top.map((entry, index) => `**${index + 1}.** <@${entry.userId}> • 🪙 **${entry.coins}**`).join('\n') : '*Noch keine Coins verdient.*';
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle('🪙 Coin Leaderboard').setDescription(text)], allowedMentions: { parse: [] } });
      return;
    }

    if (command === 'missions') {
      if (!data.engagement.enabled) {
        await interaction.reply({ content: '❌ Das Engagement-System ist noch nicht aktiviert.', ephemeral: true });
        return;
      }
      const sub = interaction.options.getSubcommand();
      const record = ensureMissionRecord(data, interaction.user.id);
      if (sub === 'view') {
        const lines = Object.entries(DAILY_MISSIONS).map(([key, def]) => {
          const done = missionProgress(record, key) >= def.target;
          const claimed = record.claimed.includes(key);
          return `${claimed ? '✅' : done ? '🟢' : '▫️'} ${def.emoji} **${def.label}** • ${missionProgressText(record, key)} • 🪙 ${def.reward} / ⚡ ${def.season} SP`;
        });
        await interaction.reply({ embeds: [new EmbedBuilder()
          .setColor(0x8b5cf6)
          .setTitle('🎯 Tägliche Missionen')
          .setDescription(lines.join('\n') + '\n\nFertige Missionen mit `/missions claim` abholen.')
          .setFooter({ text: `Reset täglich • ${localDateInfo().date}` })], ephemeral: true });
        return;
      }
      const key = interaction.options.getString('mission');
      const def = DAILY_MISSIONS[key];
      if (!def) {
        await interaction.reply({ content: '❌ Unbekannte Mission.', ephemeral: true });
        return;
      }
      if (record.claimed.includes(key)) {
        await interaction.reply({ content: '✅ Diese Mission hast du heute bereits abgeholt.', ephemeral: true });
        return;
      }
      if (missionProgress(record, key) < def.target) {
        await interaction.reply({ content: `❌ Noch nicht fertig: **${missionProgressText(record, key)}**.`, ephemeral: true });
        return;
      }
      record.claimed.push(key);
      const wallet = addCoins(data, interaction.user.id, def.reward);
      addSeasonPoints(data, interaction.user.id, def.season);
      ensureDailyStats(data).coinsAwarded += def.reward;
      saveData(data);
      await interaction.reply({ content: `✅ **${def.label}** abgeschlossen: +**${def.reward} Coins** und +**${def.season} Season Points**.\n🪙 Neuer Stand: **${wallet.coins} Coins**`, ephemeral: true });
      return;
    }

    if (command === 'season' || command === 'seasonleaderboard') {
      const top = seasonLeaderboard(data);
      if (command === 'seasonleaderboard') {
        const text = top.length ? top.slice(0, 10).map((entry, index) => `**${index + 1}.** <@${entry.userId}> • ⚡ **${entry.points} SP**`).join('\n') : '*Noch keine Season-Punkte gesammelt.*';
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle(`⚡ Season ${seasonKey()}`).setDescription(text)], allowedMentions: { parse: [] } });
        return;
      }
      const user = interaction.options.getUser('user') || interaction.user;
      const points = data.engagement.seasons[seasonKey()]?.users?.[user.id] || 0;
      const place = top.findIndex(entry => entry.userId === user.id) + 1;
      await interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0x8b5cf6)
        .setTitle(`⚡ Season • ${user.username}`)
        .setDescription(`**Season:** ${seasonKey()}\n**Punkte:** ${points} SP\n**Platz:** ${place ? `#${place}` : 'Noch nicht platziert'}`)
        .setThumbnail(user.displayAvatarURL({ size: 256 }))] });
      return;
    }

    if (command === 'shop') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'list') {
        const items = Object.values(data.engagement.shop || {}).sort((a, b) => a.price - b.price);
        const text = items.length ? items.map(item => `• \`${item.id}\` • **${item.name}** • 🪙 ${item.price} • <@&${item.roleId}>`).join('\n') : '*Der Shop ist noch leer. Admins können mit `/shop add` Rollen hinzufügen.*';
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle('🛒 Community Shop').setDescription(text)], allowedMentions: { parse: [] } });
        return;
      }
      if (sub === 'add' || sub === 'remove') {
        if (!canSetup(interaction.member)) {
          await interaction.reply({ content: '❌ Du brauchst **Server verwalten** oder Administrator.', ephemeral: true });
          return;
        }
        const id = interaction.options.getString('id').trim().toLowerCase();
        if (!/^[a-z0-9_-]{1,24}$/.test(id)) {
          await interaction.reply({ content: '❌ Die Item-ID darf nur `a-z`, Zahlen, `_` und `-` enthalten.', ephemeral: true });
          return;
        }
        if (sub === 'remove') {
          if (!data.engagement.shop[id]) {
            await interaction.reply({ content: '❌ Dieses Shop-Item gibt es nicht.', ephemeral: true });
            return;
          }
          delete data.engagement.shop[id];
          saveData(data);
          await interaction.reply({ content: `✅ Shop-Item \`${id}\` entfernt.`, ephemeral: true });
          return;
        }
        const role = interaction.options.getRole('rolle');
        const botMember = interaction.guild.members.me;
        if (role.managed || role.id === interaction.guild.id || !botMember || botMember.roles.highest.comparePositionTo(role) <= 0) {
          await interaction.reply({ content: '❌ Der Bot kann diese Rolle nicht vergeben. Schiebe die Bot-Rolle höher.', ephemeral: true });
          return;
        }
        data.engagement.shop[id] = {
          id,
          name: interaction.options.getString('name').trim(),
          price: interaction.options.getInteger('preis'),
          roleId: role.id,
          createdBy: interaction.user.id,
          createdAt: Date.now(),
        };
        saveData(data);
        await interaction.reply({ content: `✅ **${data.engagement.shop[id].name}** für **${data.engagement.shop[id].price} Coins** zum Shop hinzugefügt.`, ephemeral: true });
        return;
      }
      const id = interaction.options.getString('id').trim().toLowerCase();
      const item = data.engagement.shop[id];
      if (!item) {
        await interaction.reply({ content: '❌ Dieses Shop-Item gibt es nicht.', ephemeral: true });
        return;
      }
      const role = await interaction.guild.roles.fetch(item.roleId).catch(() => null);
      if (!role) {
        await interaction.reply({ content: '❌ Die Rolle dieses Shop-Items existiert nicht mehr.', ephemeral: true });
        return;
      }
      if (interaction.member.roles.cache.has(role.id)) {
        await interaction.reply({ content: '❌ Du besitzt diese Rolle bereits.', ephemeral: true });
        return;
      }
      const botMember = interaction.guild.members.me;
      if (role.managed || !botMember || botMember.roles.highest.comparePositionTo(role) <= 0) {
        await interaction.reply({ content: '❌ Der Bot kann diese Rolle aktuell nicht vergeben.', ephemeral: true });
        return;
      }
      const wallet = ensureWallet(data, interaction.user.id);
      if (wallet.coins < item.price) {
        await interaction.reply({ content: `❌ Du brauchst **${item.price} Coins**, hast aber nur **${wallet.coins}**.`, ephemeral: true });
        return;
      }
      await interaction.member.roles.add(role, `Shop-Kauf: ${item.name}`).catch(() => null);
      if (!interaction.member.roles.cache.has(role.id)) await interaction.member.fetch().catch(() => {});
      if (!interaction.member.roles.cache.has(role.id)) {
        await interaction.reply({ content: '❌ Die Rolle konnte nicht vergeben werden. Es wurden keine Coins abgezogen.', ephemeral: true });
        return;
      }
      wallet.coins -= item.price;
      wallet.spent = (wallet.spent || 0) + item.price;
      saveData(data);
      await interaction.reply({ content: `🛒 Gekauft: **${item.name}** für **${item.price} Coins**. Neuer Stand: **${wallet.coins} Coins**.`, ephemeral: true });
      return;
    }

    if (command === 'engagement') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'status') {
        await interaction.reply({ embeds: [new EmbedBuilder()
          .setColor(data.engagement.enabled ? 0x2ecc71 : 0xe74c3c)
          .setTitle('⚡ Engagement-System')
          .setDescription(`**Status:** ${data.engagement.enabled ? 'Aktiv' : 'Aus'}\n**Channel:** ${data.config.engagementChannelId ? `<#${data.config.engagementChannelId}>` : 'Nicht gesetzt'}\n**Wallets:** ${Object.keys(data.engagement.wallets || {}).length}\n**Shop-Items:** ${Object.keys(data.engagement.shop || {}).length}\n**Season:** ${seasonKey()}`)], ephemeral: true });
        return;
      }
      if (!canSetup(interaction.member)) {
        await interaction.reply({ content: '❌ Du brauchst **Server verwalten** oder Administrator.', ephemeral: true });
        return;
      }
      if (sub === 'setup') {
        const channel = interaction.options.getChannel('channel');
        data.config.engagementChannelId = channel.id;
        data.engagement.enabled = true;
        data.engagement.activityPanelMessageId = null;
        saveData(data);
        await updateActivityPanel(interaction.guild, data, true);
        await interaction.reply({ content: `✅ Engagement-System aktiviert in <#${channel.id}>.\nDaily, Coins, Missionen, Seasons, Shop, Live-Panel und Random Drops sind jetzt aktiv.`, ephemeral: true });
        return;
      }
      const drop = await createRandomDrop(interaction.guild, data, true);
      await interaction.reply({ content: drop ? `✅ Random Drop gestartet: ${drop.url}` : '⚠️ Es läuft bereits ein Drop oder der Activity-Channel fehlt.', ephemeral: true });
      return;
    }

    if (command === 'backupserver') {
      if (!isGuildOwner(interaction)) {
        await interaction.reply({ content: '❌ Nur der **Server-Inhaber mit der Krone** kann ein Server-Backup erstellen.', ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      const backup = await captureServerBackup(interaction.guild, data, 'manual');
      pushServerBackup(data, interaction.guild.id, backup);
      saveData(data);

      await interaction.editReply({
        content: `✅ Backup erstellt.\n**ID:** \`${backup.id}\`\n**Rollen:** ${backup.roles.length}\n**Channels:** ${backup.channels.length}\n\nEs werden maximal die letzten **5 Backups** gespeichert.`,
      });
      return;
    }

    if (command === 'setupserver') {
      if (!isGuildOwner(interaction)) {
        await interaction.reply({
          content: '❌ Dieser Befehl ist absichtlich **nur für den aktuellen Server-Inhaber** verfügbar. Administrator- oder Server-verwalten-Rechte reichen nicht.',
          ephemeral: true,
        });
        return;
      }

      const templateId = interaction.options.getString('design');
      const confirmed = interaction.options.getBoolean('bestaetigen');
      const template = SERVER_SETUP_TEMPLATES[templateId];

      if (!template) {
        await interaction.reply({ content: '❌ Unbekanntes Server-Design.', ephemeral: true });
        return;
      }
      if (!confirmed) {
        await interaction.reply({ content: '❌ Abgebrochen. `bestaetigen` muss auf **true** stehen.', ephemeral: true });
        return;
      }
      if (template.premium && !canUsePremiumSetup(interaction)) {
        await interaction.reply({
          content: '🔒 **Design 4 ist nicht freigeschaltet.**\nDer Server-Inhaber muss diese Server-ID vom Bot-Besitzer in `PREMIUM_GUILD_IDS` freischalten lassen.',
          ephemeral: true,
        });
        return;
      }

      const botMember = interaction.guild.members.me;
      if (!botMember?.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({
          content: '❌ Für `/setupserver` braucht der Bot selbst **Administrator**, damit Rollen, Channels und Berechtigungen zuverlässig neu erstellt werden können.',
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const backup = await captureServerBackup(interaction.guild, data, `before-setup-${templateId}`);
      pushServerBackup(data, interaction.guild.id, backup);
      saveData(data);

      const keepChannelId = interaction.channelId;
      const oldParentId = interaction.channel?.parentId || null;

      await interaction.editReply({
        content: `⚠️ Backup **${backup.id}** wurde erstellt.\nJetzt wird **Design ${templateId} – ${template.name}** aufgebaut. Alte Channels und löschbare Rollen werden entfernt.`,
      });

      const deleted = await deleteExistingServerStructure(interaction.guild, keepChannelId);
      const created = await createTemplateStructure(interaction.guild, template);
      applySetupConfig(data, created, templateId);

      data.setupHistory[interaction.guild.id] = {
        templateId,
        templateName: template.name,
        ownerId: interaction.user.id,
        installedAt: Date.now(),
        backupId: backup.id,
      };
      saveData(data);

      await publishSetupPanels(interaction.guild, data, created, templateId);
      saveData(data);

      const notes = [];
      if (deleted.skippedRoles.length) {
        notes.push(`⚠️ **${deleted.skippedRoles.length} Rolle(n)** konnten wegen Discord-Rollenhierarchie/Integrationen nicht gelöscht werden.`);
      }
      if (deleted.failedChannels.length) {
        notes.push(`⚠️ **${deleted.failedChannels.length} Channel(s)** konnten von Discord nicht gelöscht werden.`);
      }

      await interaction.editReply({
        content: [
          `✅ **Server-Setup fertig.**`,
          `**Design:** ${templateId} – ${template.name}`,
          `**Backup:** \`${backup.id}\``,
          `**Neue Rollen:** ${Object.keys(created.roleMap).length}`,
          `**Neue Channels/Kategorien:** ${Object.keys(created.channelMap).length}`,
          '',
          ...notes,
          notes.length ? '' : null,
          'Mit `/restoreserver bestaetigen:true` kannst du das letzte Backup wiederherstellen.',
        ].filter(Boolean).join('\n'),
      }).catch(() => {});

      // Der Ausführungs-Channel wird bis zum Schluss behalten, damit Discord die Antwort
      // noch anzeigen kann. Danach wird auch er entfernt, sofern er nicht Teil des neuen Designs ist.
      const oldCommandChannel = await interaction.guild.channels.fetch(keepChannelId).catch(() => null);
      if (oldCommandChannel && !Object.values(created.channelMap).some(ch => ch.id === oldCommandChannel.id)) {
        setTimeout(async () => {
          await oldCommandChannel.delete('Server Setup abgeschlossen: letzter alter Channel').catch(() => {});
          if (oldParentId) {
            const oldParent = await interaction.guild.channels.fetch(oldParentId).catch(() => null);
            if (oldParent?.type === ChannelType.GuildCategory && oldParent.children.cache.size === 0) {
              await oldParent.delete('Server Setup abgeschlossen: leere alte Kategorie').catch(() => {});
            }
          }
        }, 5000);
      }
      return;
    }

    if (command === 'restoreserver') {
      if (!isGuildOwner(interaction)) {
        await interaction.reply({ content: '❌ Nur der **Server-Inhaber mit der Krone** kann ein Backup wiederherstellen.', ephemeral: true });
        return;
      }
      if (!interaction.options.getBoolean('bestaetigen')) {
        await interaction.reply({ content: '❌ Abgebrochen. `bestaetigen` muss auf **true** stehen.', ephemeral: true });
        return;
      }

      const backups = data.serverBackups?.[interaction.guild.id] || [];
      const target = backups[0];
      if (!target) {
        await interaction.reply({ content: '❌ Für diesen Server existiert noch kein Backup.', ephemeral: true });
        return;
      }

      const botMember = interaction.guild.members.me;
      if (!botMember?.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ content: '❌ Der Bot braucht für die Wiederherstellung **Administrator**.', ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      // Aktuellen Stand separat sichern, ohne das Ziel-Backup zu überschreiben.
      const preRestoreBackup = await captureServerBackup(interaction.guild, data, 'before-restore');
      pushServerBackup(data, interaction.guild.id, preRestoreBackup);
      saveData(data);

      const keepChannelId = interaction.channelId;
      const oldParentId = interaction.channel?.parentId || null;

      await interaction.editReply({
        content: `♻️ Stelle Backup \`${target.id}\` von <t:${Math.floor(target.createdAt / 1000)}:F> wieder her …`,
      });

      const deleted = await deleteExistingServerStructure(interaction.guild, keepChannelId);
      const restored = await restoreServerBackup(interaction.guild, data, target);
      saveData(data);

      const newLogChannel = data.config.logChannelId
        ? await interaction.guild.channels.fetch(data.config.logChannelId).catch(() => null)
        : null;
      if (newLogChannel?.isTextBased()) {
        await newLogChannel.send({
          embeds: [new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle('♻️ Server-Backup wiederhergestellt')
            .setDescription(`Backup \`${target.id}\` wurde vom Server-Inhaber <@${interaction.user.id}> wiederhergestellt.`)
            .setTimestamp()],
          allowedMentions: { parse: [] },
        }).catch(() => {});
      }

      await interaction.editReply({
        content: [
          `✅ Backup \`${target.id}\` wurde wiederhergestellt.`,
          `**Rollen rekonstruiert:** ${Object.keys(restored.roleIdMap).length - 1}`,
          `**Channels rekonstruiert:** ${Object.keys(restored.channelIdMap).length}`,
          deleted.skippedRoles.length ? `⚠️ ${deleted.skippedRoles.length} alte Rolle(n) konnten nicht gelöscht werden.` : null,
          '',
          `Der Zustand direkt vor der Wiederherstellung wurde zusätzlich als \`${preRestoreBackup.id}\` gesichert.`,
        ].filter(Boolean).join('\n'),
      }).catch(() => {});

      const oldCommandChannel = await interaction.guild.channels.fetch(keepChannelId).catch(() => null);
      if (oldCommandChannel && !Object.values(restored.channelIdMap).some(ch => ch.id === oldCommandChannel.id)) {
        setTimeout(async () => {
          await oldCommandChannel.delete('Restore abgeschlossen: letzter alter Channel').catch(() => {});
          if (oldParentId) {
            const oldParent = await interaction.guild.channels.fetch(oldParentId).catch(() => null);
            if (oldParent?.type === ChannelType.GuildCategory && oldParent.children.cache.size === 0) {
              await oldParent.delete('Restore abgeschlossen: leere alte Kategorie').catch(() => {});
            }
          }
        }, 5000);
      }
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
          questions: 'questionChannelId',
          communitypolls: 'communityPollChannelId',
          membermonth: 'memberOfMonthChannelId',
          clips: 'clipChannelId',
          lfg: 'lfgChannelId',
          challenges: 'challengeChannelId',
          anonymous: 'anonymousInboxChannelId',
          interests: 'interestsChannelId',
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
          membermonth: 'memberOfMonthRoleId',
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
          { name: 'Basis-Channels', value: `Welcome: ${fmtCh(c.welcomeChannelId)}\nLeave: ${fmtCh(c.leaveChannelId)}\nLogs: ${fmtCh(c.logChannelId)}\nSuggestions: ${fmtCh(c.suggestionsChannelId)}\nGiveaways: ${fmtCh(c.giveawayChannelId)}\nSocials: ${fmtCh(c.socialsChannelId)}\nSocial Audit: ${fmtCh(c.socialAuditChannelId)}\nBewerbungen: ${fmtCh(c.applicationReviewChannelId)}\nTranskripte: ${fmtCh(c.ticketTranscriptChannelId)}\nAutoMod: ${fmtCh(c.automodLogChannelId)}` },
          { name: 'Community-Channels', value: `Fragen: ${fmtCh(c.questionChannelId)}\nUmfragen: ${fmtCh(c.communityPollChannelId)}\nMitglied des Monats: ${fmtCh(c.memberOfMonthChannelId)}\nClips: ${fmtCh(c.clipChannelId)}\nMitspielersuche: ${fmtCh(c.lfgChannelId)}\nChallenges: ${fmtCh(c.challengeChannelId)}\nAnonyme Inbox: ${fmtCh(c.anonymousInboxChannelId)}\nInteressen: ${fmtCh(c.interestsChannelId)}` },
          { name: 'Rollen', value: `Verified: ${fmtRole(c.verifiedRoleId)}\nUnverified: ${fmtRole(c.unverifiedRoleId)}\nSupport: ${fmtRole(c.supportRoleId)}\nModerator: ${fmtRole(c.moderatorRoleId)}\nAnnouncements: ${fmtRole(c.announcementRoleId)}\nSocial Admin: ${fmtRole(c.socialAdminRoleId)}\nSocial Delete: ${fmtRole(c.socialDeleteRoleId)}\nBewerbung angenommen: ${fmtRole(c.applicationAcceptedRoleId)}\nMitglied des Monats: ${fmtRole(c.memberOfMonthRoleId)}` },
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

    if (command === 'frage') {
      if (!canSetup(interaction.member)) {
        await interaction.reply({ content: '❌ Du brauchst **Server verwalten** oder Administrator.', ephemeral: true });
        return;
      }
      const sub = interaction.options.getSubcommand();
      if (sub === 'setup') {
        const channel = interaction.options.getChannel('channel');
        const hour = interaction.options.getInteger('stunde');
        data.config.questionChannelId = channel.id;
        data.dailyQuestions.enabled = true;
        if (hour !== null) data.dailyQuestions.hour = hour;
        data.dailyQuestions.lastPostedDate = null;
        saveData(data);
        await interaction.reply({ content: `✅ Die Frage des Tages erscheint täglich um **${data.dailyQuestions.hour}:00 Uhr** in <#${channel.id}>.`, ephemeral: true });
        return;
      }
      if (sub === 'add') {
        const text = interaction.options.getString('text').trim();
        if (data.dailyQuestions.questions.includes(text)) {
          await interaction.reply({ content: '❌ Diese Frage ist bereits gespeichert.', ephemeral: true });
          return;
        }
        data.dailyQuestions.questions.push(text);
        saveData(data);
        await interaction.reply({ content: `✅ Frage **${data.dailyQuestions.questions.length}** wurde gespeichert.`, ephemeral: true });
        return;
      }
      if (sub === 'remove') {
        const index = interaction.options.getInteger('nummer') - 1;
        if (!data.dailyQuestions.questions[index]) {
          await interaction.reply({ content: '❌ Eigene Frage mit dieser Nummer nicht gefunden.', ephemeral: true });
          return;
        }
        const [removed] = data.dailyQuestions.questions.splice(index, 1);
        data.dailyQuestions.nextIndex = 0;
        saveData(data);
        await interaction.reply({ content: `✅ Entfernt: **${removed}**`, ephemeral: true });
        return;
      }
      if (sub === 'list') {
        const questions = data.dailyQuestions.questions;
        const text = questions.length
          ? questions.map((question, index) => `**${index + 1}.** ${question}`).join('\n').slice(0, 3900)
          : `*Keine eigenen Fragen gespeichert. Der Bot nutzt automatisch ${DEFAULT_DAILY_QUESTIONS.length} eingebaute Fragen.*`;
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle('💭 Fragen des Tages').setDescription(text)], ephemeral: true });
        return;
      }
      if (sub === 'post') {
        const channel = data.config.questionChannelId
          ? await interaction.guild.channels.fetch(data.config.questionChannelId).catch(() => null)
          : interaction.channel;
        const message = await postDailyQuestion(interaction.guild, data, channel);
        saveData(data);
        await interaction.reply({ content: message ? `✅ Frage gepostet: ${message.url}` : '❌ Frage-Channel nicht gefunden.', ephemeral: true });
        return;
      }
      if (sub === 'disable') {
        data.dailyQuestions.enabled = false;
        saveData(data);
        await interaction.reply({ content: '✅ Die automatische Frage des Tages wurde deaktiviert.', ephemeral: true });
        return;
      }
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(data.dailyQuestions.enabled ? 0x2ecc71 : 0xe74c3c).setTitle('💭 Frage des Tages • Status').setDescription(
          `**Automatik:** ${data.dailyQuestions.enabled ? 'Aktiv' : 'Inaktiv'}\n**Channel:** ${data.config.questionChannelId ? `<#${data.config.questionChannelId}>` : 'Nicht gesetzt'}\n**Uhrzeit:** ${data.dailyQuestions.hour}:00 Uhr (${COMMUNITY_TIMEZONE})\n**Eigene Fragen:** ${data.dailyQuestions.questions.length}`,
        )],
        ephemeral: true,
      });
      return;
    }

    if (command === 'communitypoll') {
      if (!canSetup(interaction.member)) {
        await interaction.reply({ content: '❌ Du brauchst **Server verwalten** oder Administrator.', ephemeral: true });
        return;
      }
      const sub = interaction.options.getSubcommand();
      if (sub === 'setup') {
        const channel = interaction.options.getChannel('channel');
        data.config.communityPollChannelId = channel.id;
        data.communityPolls.enabled = true;
        data.communityPolls.cadence = interaction.options.getString('rhythmus');
        const hour = interaction.options.getInteger('stunde');
        const weekday = interaction.options.getInteger('wochentag');
        if (hour !== null) data.communityPolls.hour = hour;
        if (weekday !== null) data.communityPolls.weekday = weekday;
        data.communityPolls.lastPostedKey = null;
        saveData(data);
        await interaction.reply({ content: `✅ Community-Umfragen erscheinen **${data.communityPolls.cadence === 'daily' ? 'täglich' : 'wöchentlich'}** um **${data.communityPolls.hour}:00 Uhr** in <#${channel.id}>.`, ephemeral: true });
        return;
      }
      if (sub === 'add') {
        const question = interaction.options.getString('frage').trim();
        const options = parsePollOptions(interaction.options.getString('optionen'));
        if (options.length < 2) {
          await interaction.reply({ content: '❌ Gib mindestens zwei verschiedene Antworten an und trenne sie mit `|`.', ephemeral: true });
          return;
        }
        data.communityPolls.templates.push({ question, options });
        saveData(data);
        await interaction.reply({ content: `✅ Umfrage-Vorlage **${data.communityPolls.templates.length}** gespeichert.`, ephemeral: true });
        return;
      }
      if (sub === 'remove') {
        const index = interaction.options.getInteger('nummer') - 1;
        if (!data.communityPolls.templates[index]) {
          await interaction.reply({ content: '❌ Vorlage mit dieser Nummer nicht gefunden.', ephemeral: true });
          return;
        }
        const [removed] = data.communityPolls.templates.splice(index, 1);
        data.communityPolls.nextIndex = 0;
        saveData(data);
        await interaction.reply({ content: `✅ Umfrage **${removed.question}** wurde entfernt.`, ephemeral: true });
        return;
      }
      if (sub === 'list') {
        const templates = data.communityPolls.templates;
        const text = templates.length
          ? templates.map((template, index) => `**${index + 1}. ${template.question}**\n${template.options.join(' • ')}`).join('\n\n').slice(0, 3900)
          : `*Keine eigenen Vorlagen. Der Bot nutzt automatisch ${DEFAULT_COMMUNITY_POLLS.length} eingebaute Umfragen.*`;
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('📊 Community-Umfragen').setDescription(text)], ephemeral: true });
        return;
      }
      if (sub === 'post') {
        const channel = data.config.communityPollChannelId
          ? await interaction.guild.channels.fetch(data.config.communityPollChannelId).catch(() => null)
          : interaction.channel;
        const message = await postCommunityPoll(interaction.guild, data, null, channel);
        saveData(data);
        await interaction.reply({ content: message ? `✅ Umfrage gepostet: ${message.url}` : '❌ Umfrage-Channel nicht gefunden.', ephemeral: true });
        return;
      }
      if (sub === 'disable') {
        data.communityPolls.enabled = false;
        saveData(data);
        await interaction.reply({ content: '✅ Automatische Community-Umfragen wurden deaktiviert.', ephemeral: true });
        return;
      }
      const weekdays = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(data.communityPolls.enabled ? 0x2ecc71 : 0xe74c3c).setTitle('📊 Community-Umfragen • Status').setDescription(
          `**Automatik:** ${data.communityPolls.enabled ? 'Aktiv' : 'Inaktiv'}\n**Rhythmus:** ${data.communityPolls.cadence === 'daily' ? 'Täglich' : `Wöchentlich am ${weekdays[data.communityPolls.weekday]}`}\n**Uhrzeit:** ${data.communityPolls.hour}:00 Uhr\n**Channel:** ${data.config.communityPollChannelId ? `<#${data.config.communityPollChannelId}>` : 'Nicht gesetzt'}\n**Eigene Vorlagen:** ${data.communityPolls.templates.length}`,
        )],
        ephemeral: true,
      });
      return;
    }

    if (command === 'memberofthemonth') {
      if (!canSetup(interaction.member)) {
        await interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
        return;
      }
      const sub = interaction.options.getSubcommand();
      if (sub === 'setup') {
        const channel = interaction.options.getChannel('channel');
        const role = interaction.options.getRole('rolle');
        if (role) {
          const botMember = interaction.guild.members.me;
          if (role.managed || role.id === interaction.guild.id || !botMember || botMember.roles.highest.comparePositionTo(role) <= 0) {
            await interaction.reply({ content: '❌ Diese Rolle kann der Bot nicht vergeben. Schiebe die Bot-Rolle weiter nach oben.', ephemeral: true });
            return;
          }
        }
        data.config.memberOfMonthChannelId = channel.id;
        data.config.memberOfMonthRoleId = role?.id || null;
        data.memberOfMonth.enabled = true;
        saveData(data);
        await interaction.reply({ content: `✅ Mitglied des Monats ist aktiv. Auszeichnung in <#${channel.id}>${role ? ` mit <@&${role.id}>` : ''}.`, ephemeral: true, allowedMentions: { parse: [] } });
        return;
      }
      if (sub === 'run') {
        const month = interaction.options.getString('monat') || localDateInfo().month;
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
          await interaction.reply({ content: '❌ Nutze das Format `YYYY-MM`, zum Beispiel `2026-08`.', ephemeral: true });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        const winner = await awardMemberOfMonth(interaction.guild, data, month, true);
        saveData(data);
        await interaction.editReply(winner ? `✅ <@${winner.userId}> wurde für **${month}** ausgezeichnet.` : `⚠️ Für **${month}** wurden keine Aktivitäten gefunden.`);
        return;
      }
      if (sub === 'disable') {
        data.memberOfMonth.enabled = false;
        saveData(data);
        await interaction.reply({ content: '✅ Die automatische Monatsauszeichnung wurde deaktiviert.', ephemeral: true });
        return;
      }
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(data.memberOfMonth.enabled ? 0x2ecc71 : 0xe74c3c).setTitle('👑 Mitglied des Monats • Status').setDescription(
          `**Automatik:** ${data.memberOfMonth.enabled ? 'Aktiv' : 'Inaktiv'}\n**Channel:** ${data.config.memberOfMonthChannelId ? `<#${data.config.memberOfMonthChannelId}>` : 'Nicht gesetzt'}\n**Rolle:** ${data.config.memberOfMonthRoleId ? `<@&${data.config.memberOfMonthRoleId}>` : 'Keine'}\n**Aktueller Gewinner:** ${data.memberOfMonth.currentWinnerId ? `<@${data.memberOfMonth.currentWinnerId}>` : 'Noch niemand'}`,
        )],
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (command === 'rep') {
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('grund') || 'Hilfsbereit und freundlich';
      if (user.id === interaction.user.id || user.bot) {
        await interaction.reply({ content: '❌ Du kannst dir selbst oder einem Bot keine Reputation geben.', ephemeral: true });
        return;
      }
      const lastGiven = Number(data.reputation.givers[interaction.user.id] || 0);
      const remaining = REP_COOLDOWN_MS - (Date.now() - lastGiven);
      if (remaining > 0) {
        await interaction.reply({ content: `❌ Du kannst erst <t:${Math.floor((Date.now() + remaining) / 1000)}:R> wieder einen Rep-Punkt vergeben.`, ephemeral: true });
        return;
      }
      const record = data.reputation.users[user.id] || { points: 0, received: [] };
      record.points++;
      record.received.push({ fromUserId: interaction.user.id, reason, createdAt: Date.now() });
      record.received = record.received.slice(-500);
      data.reputation.users[user.id] = record;
      data.reputation.givers[interaction.user.id] = Date.now();
      await checkAndAwardBadges(data, user.id, interaction.channel);
      saveData(data);
      await interaction.reply({ content: `💜 <@${interaction.user.id}> hat <@${user.id}> einen Reputationspunkt gegeben!\n**Grund:** ${reason}\n**Neue Reputation:** ${record.points}`, allowedMentions: { users: [interaction.user.id, user.id] } });
      return;
    }

    if (command === 'reps') {
      const user = interaction.options.getUser('user') || interaction.user;
      const record = data.reputation.users[user.id] || { points: 0, received: [] };
      const latest = record.received.slice(-5).reverse();
      const text = latest.length ? latest.map(entry => `• ${entry.reason} • <t:${Math.floor(entry.createdAt / 1000)}:R>`).join('\n') : '*Noch keine Einträge.*';
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(0x9b59b6).setTitle(`💜 Reputation • ${user.username}`).setThumbnail(user.displayAvatarURL({ size: 256 })).setDescription(`## ${record.points} Rep-Punkte`).addFields({ name: 'Letzte Begründungen', value: text })],
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (command === 'communityrank') {
      const user = interaction.options.getUser('user') || interaction.user;
      const monthly = activityFor(data, user.id, 'month');
      const total = activityFor(data, user.id, 'total');
      const place = activityLeaderboard(data, 'month').findIndex(entry => entry.userId === user.id) + 1;
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0x8b5cf6)
          .setTitle(`📊 Community-Rang • ${user.username}`)
          .setThumbnail(user.displayAvatarURL({ size: 256 }))
          .addFields(
            { name: 'Diesen Monat', value: `💬 ${monthly.messages || 0} Nachrichten\n🎧 ${formatLongDuration(monthly.voiceMs || 0)}\n⭐ ${communityScore(monthly)} Punkte`, inline: true },
            { name: 'Gesamt', value: `💬 ${total.messages || 0} Nachrichten\n🎧 ${formatLongDuration(total.voiceMs || 0)}\n⭐ ${communityScore(total)} Punkte`, inline: true },
            { name: 'Monatsplatz', value: place ? `**Platz ${place}**` : 'Noch nicht platziert', inline: true },
          )],
      });
      return;
    }

    if (command === 'communityleaderboard') {
      const scope = interaction.options.getString('zeitraum') || 'month';
      const top = activityLeaderboard(data, scope).slice(0, 10);
      const text = top.length
        ? top.map((entry, index) => `**${index + 1}.** <@${entry.userId}> • **${entry.score} Punkte** • 💬 ${entry.record.messages || 0} • 🎧 ${formatLongDuration(entry.record.voiceMs || 0)}`).join('\n')
        : '*Noch keine Community-Aktivität erfasst.*';
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle(`📊 Community-Bestenliste • ${scope === 'total' ? 'Gesamt' : 'Dieser Monat'}`).setDescription(text)], allowedMentions: { parse: [] } });
      return;
    }

    if (command === 'clip') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'setup') {
        if (!canSetup(interaction.member)) {
          await interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
          return;
        }
        const channel = interaction.options.getChannel('channel');
        data.config.clipChannelId = channel.id;
        data.clips.enabled = true;
        data.clips.activeWeek = isoWeekKey();
        saveData(data);
        await interaction.reply({ content: `✅ Clips der Woche sind jetzt in <#${channel.id}> aktiv.`, ephemeral: true });
        return;
      }
      if (sub === 'submit') {
        if (!data.config.clipChannelId || !data.clips.enabled) {
          await interaction.reply({ content: '❌ Das Clip-System wurde noch nicht mit `/clip setup` eingerichtet.', ephemeral: true });
          return;
        }
        const week = isoWeekKey();
        if (data.clips.lastFinishedWeek === week) {
          await interaction.reply({ content: '❌ Die Abstimmung dieser Woche wurde bereits beendet.', ephemeral: true });
          return;
        }
        const duplicate = Object.values(data.clips.submissions).find(clip => clip.weekKey === week && clip.userId === interaction.user.id);
        if (duplicate) {
          await interaction.reply({ content: `❌ Du hast diese Woche bereits einen Clip eingereicht: \`${duplicate.id}\``, ephemeral: true });
          return;
        }
        const url = normalizeUrl(interaction.options.getString('url'));
        if (!url) {
          await interaction.reply({ content: '❌ Bitte gib einen gültigen http/https-Link an.', ephemeral: true });
          return;
        }
        const channel = await interaction.guild.channels.fetch(data.config.clipChannelId).catch(() => null);
        if (!channel?.isTextBased()) {
          await interaction.reply({ content: '❌ Der Clip-Channel wurde nicht gefunden.', ephemeral: true });
          return;
        }
        data.clips.activeWeek = week;
        const clip = {
          id: createShortId('c'),
          guildId: interaction.guild.id,
          channelId: channel.id,
          userId: interaction.user.id,
          title: interaction.options.getString('titel').trim(),
          url,
          weekKey: week,
          votes: [],
          createdAt: Date.now(),
        };
        const message = await channel.send(clipPayload(clip));
        clip.messageId = message.id;
        data.clips.submissions[clip.id] = clip;
        saveData(data);
        await interaction.reply({ content: `✅ Dein Clip wurde eingereicht: ${message.url}`, ephemeral: true });
        return;
      }
      if (sub === 'top') {
        const week = data.clips.activeWeek || isoWeekKey();
        const clips = Object.values(data.clips.submissions).filter(clip => clip.weekKey === week).sort((a, b) => (b.votes?.length || 0) - (a.votes?.length || 0)).slice(0, 10);
        const text = clips.length ? clips.map((clip, index) => `**${index + 1}.** [${clip.title}](${clip.url}) • <@${clip.userId}> • ⭐ ${clip.votes?.length || 0}`).join('\n') : '*Diese Woche wurden noch keine Clips eingereicht.*';
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle(`🎬 Clips • ${week}`).setDescription(text)], allowedMentions: { parse: [] } });
        return;
      }
      if (!canSetup(interaction.member)) {
        await interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
        return;
      }
      const week = data.clips.activeWeek || isoWeekKey();
      const winner = await finishClipWeek(interaction.guild, data, week);
      saveData(data);
      await interaction.reply({ content: winner ? `✅ <@${winner.userId}> hat mit **${winner.votes?.length || 0} Stimmen** gewonnen.` : '⚠️ Keine Clips vorhanden oder diese Woche wurde bereits ausgewertet.', ephemeral: true, allowedMentions: { parse: [] } });
      return;
    }

    if (command === 'mitspieler') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'setup') {
        if (!canSetup(interaction.member)) {
          await interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
          return;
        }
        const channel = interaction.options.getChannel('channel');
        data.config.lfgChannelId = channel.id;
        saveData(data);
        await interaction.reply({ content: `✅ Neue Mitspielersuchen erscheinen in <#${channel.id}>.`, ephemeral: true });
        return;
      }
      if (sub === 'create') {
        const channel = data.config.lfgChannelId
          ? await interaction.guild.channels.fetch(data.config.lfgChannelId).catch(() => null)
          : interaction.channel;
        if (!channel?.isTextBased()) {
          await interaction.reply({ content: '❌ Mitspieler-Channel nicht gefunden.', ephemeral: true });
          return;
        }
        const entry = {
          id: createShortId('m'),
          guildId: interaction.guild.id,
          channelId: channel.id,
          ownerId: interaction.user.id,
          game: interaction.options.getString('spiel').trim(),
          slots: interaction.options.getInteger('plaetze'),
          description: interaction.options.getString('text') || null,
          players: [interaction.user.id],
          createdAt: Date.now(),
          closed: false,
        };
        const message = await channel.send(lfgPayload(entry));
        entry.messageId = message.id;
        data.lfg[entry.id] = entry;
        saveData(data);
        await interaction.reply({ content: `✅ Mitspielersuche erstellt: ${message.url}\n**ID:** \`${entry.id}\``, ephemeral: true });
        return;
      }
      if (sub === 'list') {
        const entries = Object.values(data.lfg).filter(entry => entry.guildId === interaction.guild.id && !entry.closed).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
        const text = entries.length ? entries.map(entry => `• \`${entry.id}\` • **${entry.game}** • ${entry.players?.length || 0}/${entry.slots} • <@${entry.ownerId}>`).join('\n') : '*Keine offenen Mitspielersuchen.*';
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle('🎮 Offene Mitspielersuchen').setDescription(text)], allowedMentions: { parse: [] } });
        return;
      }
      const entryId = interaction.options.getString('id').trim();
      const entry = data.lfg[entryId];
      if (!entry || entry.guildId !== interaction.guild.id) {
        await interaction.reply({ content: '❌ Mitspielersuche nicht gefunden.', ephemeral: true });
        return;
      }
      if (entry.ownerId !== interaction.user.id && !canModerate(interaction.member, data)) {
        await interaction.reply({ content: '❌ Nur der Ersteller oder das Team darf diese Suche schließen.', ephemeral: true });
        return;
      }
      entry.closed = true;
      entry.closedAt = Date.now();
      saveData(data);
      const channel = await interaction.guild.channels.fetch(entry.channelId).catch(() => null);
      const message = channel?.isTextBased() ? await channel.messages.fetch(entry.messageId).catch(() => null) : null;
      if (message) await message.edit(lfgPayload(entry, true)).catch(() => {});
      await interaction.reply({ content: '🔒 Mitspielersuche geschlossen.', ephemeral: true });
      return;
    }

    if (command === 'challenge') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'create') {
        if (!canAnnounce(interaction.member, data)) {
          await interaction.reply({ content: '❌ Du darfst keine Community-Challenges erstellen.', ephemeral: true });
          return;
        }
        const channel = interaction.options.getChannel('channel') || (data.config.challengeChannelId
          ? await interaction.guild.channels.fetch(data.config.challengeChannelId).catch(() => null)
          : interaction.channel);
        if (!channel?.isTextBased()) {
          await interaction.reply({ content: '❌ Challenge-Channel nicht gefunden.', ephemeral: true });
          return;
        }
        data.config.challengeChannelId = channel.id;
        const challenge = {
          id: createShortId('h'),
          guildId: interaction.guild.id,
          channelId: channel.id,
          creatorId: interaction.user.id,
          title: interaction.options.getString('titel').trim(),
          goal: interaction.options.getInteger('ziel'),
          unit: interaction.options.getString('einheit').trim(),
          description: interaction.options.getString('text') || null,
          contributions: {},
          notes: [],
          completed: false,
          createdAt: Date.now(),
        };
        const message = await channel.send(challengePayload(challenge));
        challenge.messageId = message.id;
        data.challenges[challenge.id] = challenge;
        saveData(data);
        await interaction.reply({ content: `✅ Community-Challenge erstellt: ${message.url}\n**ID:** \`${challenge.id}\``, ephemeral: true });
        return;
      }
      if (sub === 'list') {
        const challenges = Object.values(data.challenges).filter(challenge => challenge.guildId === interaction.guild.id && !challenge.completed).slice(0, 20);
        const text = challenges.length ? challenges.map(challenge => {
          const progress = Object.values(challenge.contributions || {}).reduce((sum, value) => sum + Number(value || 0), 0);
          return `• \`${challenge.id}\` • **${challenge.title}** • ${progress}/${challenge.goal} ${challenge.unit}`;
        }).join('\n') : '*Keine laufenden Challenges.*';
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle('🤝 Community-Challenges').setDescription(text)], ephemeral: true });
        return;
      }
      const challengeId = interaction.options.getString('id').trim();
      const challenge = data.challenges[challengeId];
      if (!challenge || challenge.guildId !== interaction.guild.id) {
        await interaction.reply({ content: '❌ Challenge nicht gefunden.', ephemeral: true });
        return;
      }
      if (challenge.creatorId !== interaction.user.id && !canAnnounce(interaction.member, data)) {
        await interaction.reply({ content: '❌ Du darfst diese Challenge nicht beenden.', ephemeral: true });
        return;
      }
      challenge.completed = true;
      challenge.completedAt = Date.now();
      saveData(data);
      const channel = await interaction.guild.channels.fetch(challenge.channelId).catch(() => null);
      const message = channel?.isTextBased() ? await channel.messages.fetch(challenge.messageId).catch(() => null) : null;
      if (message) await message.edit(challengePayload(challenge, true)).catch(() => {});
      await interaction.reply({ content: '✅ Challenge wurde beendet.', ephemeral: true });
      return;
    }

    if (command === 'game') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'leaderboard') {
        const top = Object.entries(data.games.quizScores).sort(([, a], [, b]) => (b.correct || 0) - (a.correct || 0) || (a.total || 0) - (b.total || 0)).slice(0, 10);
        const text = top.length ? top.map(([userId, score], index) => `**${index + 1}.** <@${userId}> • **${score.correct || 0} richtig** von ${score.total || 0}`).join('\n') : '*Noch keine Quiz-Ergebnisse.*';
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x3498db).setTitle('🧠 Quiz-Bestenliste').setDescription(text)], allowedMentions: { parse: [] } });
        return;
      }
      if (sub === 'status') {
        const game = data.games.channels[interaction.channel.id];
        if (!game) {
          await interaction.reply({ content: 'ℹ️ In diesem Channel läuft kein Nachrichtenspiel.', ephemeral: true });
          return;
        }
        const details = game.type === 'counting'
          ? `Aktuelle Zahl: **${game.current}**`
          : game.type === 'wordchain'
            ? `Letztes Wort: **${game.lastWord || 'Noch keines'}**`
            : `Zahl zwischen **1 und ${game.max}** • ${game.attempts || 0} Versuche`;
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x3498db).setTitle('🎮 Laufendes Minispiel').setDescription(`**Typ:** ${game.type}\n${details}`)], ephemeral: true });
        return;
      }
      if (!canAnnounce(interaction.member, data)) {
        await interaction.reply({ content: '❌ Du darfst keine Community-Spiele starten oder stoppen.', ephemeral: true });
        return;
      }
      if (sub === 'stop') {
        if (!data.games.channels[interaction.channel.id]) {
          await interaction.reply({ content: '❌ In diesem Channel läuft kein Spiel.', ephemeral: true });
          return;
        }
        delete data.games.channels[interaction.channel.id];
        saveData(data);
        await interaction.reply('🛑 Das Community-Spiel wurde beendet.');
        return;
      }
      if (sub === 'quiz') {
        const template = QUIZ_QUESTIONS[Math.floor(Math.random() * QUIZ_QUESTIONS.length)];
        const quiz = { id: createShortId('q'), ...template, guildId: interaction.guild.id, channelId: interaction.channel.id, answeredUsers: [], createdAt: Date.now() };
        data.games.quizzes[quiz.id] = quiz;
        saveData(data);
        await interaction.reply(quizPayload(quiz));
        return;
      }
      if (data.games.channels[interaction.channel.id]) {
        await interaction.reply({ content: '❌ In diesem Channel läuft bereits ein Spiel. Nutze zuerst `/game stop`.', ephemeral: true });
        return;
      }
      const type = interaction.options.getString('typ');
      const game = { type, startedBy: interaction.user.id, startedAt: Date.now() };
      let description;
      if (type === 'counting') {
        Object.assign(game, { current: 0, lastUserId: null });
        description = 'Beginnt mit **1** und zählt gemeinsam weiter. Niemand darf zweimal hintereinander schreiben.';
      } else if (type === 'wordchain') {
        Object.assign(game, { lastWord: null, lastUserId: null, usedWords: [] });
        description = 'Das nächste Wort muss mit dem letzten Buchstaben des vorherigen Wortes beginnen. Niemand darf zweimal hintereinander schreiben.';
      } else {
        const max = interaction.options.getInteger('maximum') || 100;
        Object.assign(game, { max, secret: Math.floor(Math.random() * max) + 1, attempts: 0 });
        description = `Erratet gemeinsam die geheime Zahl zwischen **1 und ${max}**. Der Bot sagt euch, ob sie größer oder kleiner ist.`;
      }
      data.games.channels[interaction.channel.id] = game;
      saveData(data);
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x3498db).setTitle(`🎮 Minispiel gestartet • ${type}`).setDescription(description)] });
      return;
    }

    if (command === 'badges') {
      const user = interaction.options.getUser('user') || interaction.user;
      await checkAndAwardBadges(data, user.id);
      saveData(data);
      const badges = (data.achievements[user.id] || []).filter(id => BADGES[id]);
      const text = badges.length ? badges.map(id => `${BADGES[id].emoji} **${BADGES[id].name}**\n${BADGES[id].description}`).join('\n\n') : '*Noch keine Abzeichen freigeschaltet.*';
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle(`🏅 Abzeichen • ${user.username}`).setThumbnail(user.displayAvatarURL({ size: 256 })).setDescription(text).setFooter({ text: `${badges.length} von ${Object.keys(BADGES).length} Abzeichen` })] });
      return;
    }

    if (command === 'anonymouspanel') {
      if (!canSetup(interaction.member)) {
        await interaction.reply({ content: '❌ Keine Berechtigung.', ephemeral: true });
        return;
      }
      const inbox = interaction.options.getChannel('inbox');
      data.config.anonymousInboxChannelId = inbox.id;
      saveData(data);
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('anonymous_open').setLabel('Anonyme Nachricht senden').setEmoji('📮').setStyle(ButtonStyle.Primary));
      await interaction.channel.send({
        embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle('📮 Anonyme Nachrichtenbox').setDescription('Möchtest du Feedback, eine Frage oder ein Anliegen senden? Dein Name wird in der Nachricht **nicht öffentlich angezeigt**.\n\nZum Schutz vor Missbrauch wird dein Absender im **Team-Log** angezeigt.')],
        components: [row],
      });
      await interaction.reply({ content: `✅ Panel erstellt. Nachrichten landen in <#${inbox.id}>.`, ephemeral: true });
      return;
    }

    if (command === 'anonymousinfo') {
      if (!canModerate(interaction.member, data) && !canSetup(interaction.member)) {
        await interaction.reply({ content: '❌ Nur berechtigte Teammitglieder dürfen Absender prüfen.', ephemeral: true });
        return;
      }
      const id = interaction.options.getString('id').trim();
      const submission = data.anonymous.submissions[id];
      if (!submission || submission.guildId !== interaction.guild.id) {
        await interaction.reply({ content: '❌ Anonyme Nachricht nicht gefunden.', ephemeral: true });
        return;
      }
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(0xe67e22).setTitle(`🔎 Anonyme Nachricht • ${id}`).setDescription(`**Absender:** <@${submission.userId}> (\`${submission.userId}\`)\n**Betreff:** ${submission.subject}\n**Gesendet:** <t:${Math.floor(submission.createdAt / 1000)}:F>\n\n**Nachricht:**\n${submission.message}`)],
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (command === 'profil') {
      const user = interaction.options.getUser('user') || interaction.user;
      await checkAndAwardBadges(data, user.id);
      saveData(data);
      await interaction.reply({ embeds: [profileEmbed(user, data)] });
      return;
    }

    if (command === 'profilset') {
      const bio = interaction.options.getString('bio');
      const game = interaction.options.getString('spiel');
      if (bio === null && game === null) {
        await interaction.reply({ content: '❌ Gib mindestens eine neue Bio oder ein Lieblingsspiel an.', ephemeral: true });
        return;
      }
      const profile = data.profiles[interaction.user.id] || {};
      if (bio !== null) profile.bio = bio.trim();
      if (game !== null) profile.game = game.trim();
      profile.updatedAt = Date.now();
      data.profiles[interaction.user.id] = profile;
      saveData(data);
      await interaction.reply({ content: '✅ Dein Community-Profil wurde aktualisiert.', ephemeral: true });
      return;
    }

    if (command === 'interessen') {
      if (!canSetup(interaction.member)) {
        await interaction.reply({ content: '❌ Du brauchst **Server verwalten** oder Administrator.', ephemeral: true });
        return;
      }
      const sub = interaction.options.getSubcommand();
      if (sub === 'add') {
        if (data.interests.options.length >= 25) {
          await interaction.reply({ content: '❌ Es sind maximal 25 Interessen möglich.', ephemeral: true });
          return;
        }
        const role = interaction.options.getRole('rolle');
        const botMember = interaction.guild.members.me;
        if (role.managed || role.id === interaction.guild.id || !botMember || botMember.roles.highest.comparePositionTo(role) <= 0) {
          await interaction.reply({ content: '❌ Diese Rolle kann der Bot nicht vergeben. Schiebe die Bot-Rolle weiter nach oben.', ephemeral: true });
          return;
        }
        if (data.interests.options.some(option => option.roleId === role.id)) {
          await interaction.reply({ content: '❌ Diese Rolle ist bereits als Interesse eingetragen.', ephemeral: true });
          return;
        }
        data.interests.options.push({ label: interaction.options.getString('name').trim(), roleId: role.id });
        if (data.config.interestsChannelId) await updateInterestPanel(interaction.guild, data).catch(() => {});
        saveData(data);
        await interaction.reply({ content: `✅ Interesse **${interaction.options.getString('name')}** mit <@&${role.id}> hinzugefügt.`, ephemeral: true, allowedMentions: { parse: [] } });
        return;
      }
      if (sub === 'remove') {
        const role = interaction.options.getRole('rolle');
        const before = data.interests.options.length;
        data.interests.options = data.interests.options.filter(option => option.roleId !== role.id);
        if (before === data.interests.options.length) {
          await interaction.reply({ content: '❌ Diese Rolle ist nicht eingetragen.', ephemeral: true });
          return;
        }
        if (data.config.interestsChannelId) await updateInterestPanel(interaction.guild, data).catch(() => {});
        saveData(data);
        await interaction.reply({ content: `✅ <@&${role.id}> wurde aus den Interessen entfernt.`, ephemeral: true, allowedMentions: { parse: [] } });
        return;
      }
      if (sub === 'list') {
        const text = data.interests.options.length ? data.interests.options.map((option, index) => `**${index + 1}.** ${option.label} → <@&${option.roleId}>`).join('\n') : '*Noch keine Interessen eingerichtet.*';
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x8b5cf6).setTitle('🏷️ Willkommens-Interessen').setDescription(text)], ephemeral: true, allowedMentions: { parse: [] } });
        return;
      }
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const message = await updateInterestPanel(interaction.guild, data, channel);
      saveData(data);
      await interaction.reply({ content: message ? `✅ Willkommens-Panel erstellt oder aktualisiert: ${message.url}` : '❌ Panel-Channel nicht gefunden.', ephemeral: true });
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
    const moderationCommands = new Set(['warn', 'warnings', 'clearwarnings', 'timeout', 'untimeout', 'kick', 'ban', 'unban', 'unbanall', 'clear', 'purge', 'slowmode', 'lock', 'unlock']);
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

    if (command === 'clear' || command === 'purge') {
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
      const allowed = command === 'socials'
        ? canUseSocialsCommand(interaction.member)
        : canManageSocials(interaction.member, data);
      if (!allowed) {
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
