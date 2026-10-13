'use strict';
// Minimal stand-in for the discord.js objects the bot modules touch. Records what the bot does.
class Coll extends Map {
  find(fn) { for (const v of this.values()) if (fn(v)) return v; return undefined; }
  filter(fn) { const c = new Coll(); for (const [k, v] of this) if (fn(v, k)) c.set(k, v); return c; }
  first() { return this.values().next().value; }
  last() { return [...this.values()].pop(); }
}

let seq = 1000;
const nid = () => String(100000000000000000n + BigInt(seq++));

class Role {
  constructor(guild, { name, color, position = 1 }) { this.id = nid(); this.guild = guild; this.name = name; this.color = color; this.position = position; }
  comparePositionTo(o) { return this.position - o.position; }
  toString() { return `<@&${this.id}>`; }
}

class Message {
  constructor(channel, payload, author) {
    this.id = nid(); this.channel = channel; this.channelId = channel.id; this.payload = payload; this.author = author;
    this.content = typeof payload === 'string' ? payload : payload.content || ''; this.createdTimestamp = Date.now();
    this.attachments = new Coll(); this.embeds = payload.embeds || []; this.deleted = false;
    this.url = `https://discord.com/channels/${channel.guild.id}/${channel.id}/${this.id}`;
  }
  async edit(p) { this.payload = p; this.embeds = p.embeds || []; this.edits = (this.edits || 0) + 1; return this; }
  async delete() { this.deleted = true; this.channel.messages.cache.delete(this.id); }
}

class Channel {
  constructor(guild, { name, type, parent, permissionOverwrites, topic }) {
    this.id = nid(); this.guild = guild; this.name = name; this.type = type; this.parentId = parent || null; this.topic = topic;
    this.overwrites = permissionOverwrites || []; this.deleted = false; this.client = guild.client;
    const ch = this;
    this.messages = {
      cache: new Coll(),
      async fetch(arg) {
        if (typeof arg === 'string') { const m = ch.messages.cache.get(arg); if (!m) throw new Error('Unknown Message'); return m; }
        return new Coll([...ch.messages.cache].reverse().slice(0, arg?.limit ?? 50));
      },
    };
    this.permissionOverwrites = {
      edits: [],
      async edit(target, perms, opts) { ch.permissionOverwrites.edits.push({ target: target.id ?? target, perms, opts }); },
      async delete(target) { ch.permissionOverwrites.edits.push({ target: target.id ?? target, deleted: true }); },
    };
  }
  async send(payload) { const m = new Message(this, payload, this.guild.members.me.user); this.messages.cache.set(m.id, m); return m; }
  async delete() { this.deleted = true; this.guild.channels.cache.delete(this.id); }
  async bulkDelete(list) { const c = new Coll(); for (const m of list) { m.deleted = true; this.messages.cache.delete(m.id); c.set(m.id, m); } return c; }
  async setRateLimitPerUser(s) { this.slowmode = s; }
  toString() { return `<#${this.id}>`; }
}

class Member {
  constructor(guild, user, { roles = [], perms = 0n, position = 0 } = {}) {
    this.guild = guild; this.user = user; this.id = user.id; this.timeouts = []; this.kicked = false; this.banned = false;
    const self = this;
    const base = new Role(guild, { name: `@pos${position}`, position });
    this.roles = {
      cache: new Coll(roles.map((r) => [r.id, r])),
      get highest() { return [...self.roles.cache.values(), base].sort((a, b) => b.position - a.position)[0]; },
      async add(r) { const role = typeof r === 'string' ? guild.roles.cache.get(r) : r; if (guild.denyRoleAdd) throw new Error('Missing Permissions'); self.roles.cache.set(role.id, role); },
      async remove(r) { self.roles.cache.delete(r.id ?? r); },
    };
    this.permissions = { has: (bit) => (perms & 8n) !== 0n || (perms & bit) === bit };
    this.moderatable = true; this.kickable = true; this.bannable = true;
  }
  async timeout(ms, reason) { this.timeouts.push({ ms, reason }); }
  async kick(reason) { this.kicked = reason || true; }
  async ban(opts) { this.banned = opts; }
}

class User {
  constructor(name) { this.id = nid(); this.username = name; this.tag = name; this.bot = false; this.dms = []; this.createdTimestamp = Date.now() - 400 * 86_400_000; }
  async send(p) { this.dms.push(p); }
  displayAvatarURL() { return `https://cdn/${this.id}.png`; }
  toString() { return `<@${this.id}>`; }
}

function makeWorld() {
  const users = new Map();
  const client = { users: { fetch: async (id) => users.get(id) }, user: null };
  const guild = { id: nid(), name: 'XVY Imperium', memberCount: 7, client, bans: [], unbans: [] };
  client.guilds = { cache: new Coll([[guild.id, guild]]) };
  const everyone = new Role(guild, { name: '@everyone', position: 0 });
  everyone.id = guild.id;
  guild.roles = {
    cache: new Coll([[everyone.id, everyone]]), everyone,
    async create(o) { const r = new Role(guild, { ...o, position: 5 }); guild.roles.cache.set(r.id, r); return r; },
  };
  guild.channels = {
    cache: new Coll(),
    async create(o) { const c = new Channel(guild, o); guild.channels.cache.set(c.id, c); return c; },
  };
  const memberMap = new Coll();
  guild.members = {
    cache: memberMap,
    async fetch(id) { const m = memberMap.get(id); if (!m) throw new Error('Unknown Member'); return m; },
    async ban(id, o) { guild.bans.push({ id, o }); },
    async unban(id) { guild.unbans.push(id); },
  };
  const addUser = (name, opts) => { const u = new User(name); users.set(u.id, u); const m = new Member(guild, u, opts); memberMap.set(u.id, m); return m; };
  const botM = addUser('XVY Bot', { perms: 8n, position: 50 });
  botM.user.bot = true;
  client.user = botM.user;
  guild.members.me = botM;
  const owner = addUser('Owner', { perms: 8n, position: 100 });
  guild.ownerId = owner.id;
  return { guild, client, users, addUser, owner, bot: botM };
}

/** Interaction stand-in. kind: 'command' | 'button' | 'select' | 'modal' | 'autocomplete'. */
function interaction(world, member, kind, { commandName, sub, opts = {}, customId, values, fields = {}, channel } = {}) {
  const calls = [];
  const i = {
    calls, guild: world.guild, guildId: world.guild.id, member, user: member.user, client: world.client,
    channel, channelId: channel?.id, customId, values, commandName, deferred: false, replied: false,
    inGuild: () => true,
    isChatInputCommand: () => kind === 'command', isButton: () => kind === 'button', isStringSelectMenu: () => kind === 'select',
    isModalSubmit: () => kind === 'modal', isAutocomplete: () => kind === 'autocomplete',
    options: {
      getSubcommand: () => sub, getString: (n) => opts[n] ?? null, getInteger: (n) => opts[n] ?? null, getBoolean: (n) => opts[n] ?? null,
      getUser: (n) => opts[n] ?? null, getRole: (n) => opts[n] ?? null, getFocused: () => opts.focused ?? '',
    },
    fields: { getTextInputValue: (id) => fields[id] ?? '' },
    async reply(p) { i.replied = true; calls.push(['reply', p]); },
    async deferReply(p) { i.deferred = true; calls.push(['defer', p]); },
    async editReply(p) { calls.push(['editReply', p]); },
    async followUp(p) { calls.push(['followUp', p]); },
    async update(p) { i.replied = true; calls.push(['update', p]); },
    async showModal(p) { calls.push(['modal', p]); },
    async respond(p) { calls.push(['respond', p]); },
  };
  return i;
}

const lastText = (i) => {
  const c = i.calls[i.calls.length - 1];
  return c ? JSON.stringify(c[1]) : '';
};

module.exports = { makeWorld, interaction, lastText, Coll, Message };
