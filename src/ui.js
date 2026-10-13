'use strict';
// Embeds and components as plain Discord API objects (discord.js accepts them directly).

const BTN = { primary: 1, secondary: 2, success: 3, danger: 4 };

function embed(g, { title, description, fields, footer, color, thumbnail, timestamp = true } = {}) {
  const e = { color: color ?? g.config.color, title: title?.slice(0, 256), description: description?.slice(0, 4096) };
  if (fields?.length) e.fields = fields.slice(0, 25).map((f) => ({ name: String(f.name).slice(0, 256), value: String(f.value || '–').slice(0, 1024), inline: !!f.inline }));
  e.footer = { text: (footer ?? g.config.name).slice(0, 2048) };
  if (thumbnail) e.thumbnail = { url: thumbnail };
  if (timestamp) e.timestamp = new Date().toISOString();
  return e;
}

/** Emoji field for buttons/menus: unicode → {name}, custom <:n:id> → {name,id}. */
function emojiObj(e) {
  const s = String(e || '').trim();
  if (!s) return undefined;
  const m = /^<(a?):(\w+):(\d+)>$/.exec(s);
  return m ? { name: m[2], id: m[3], animated: !!m[1] } : { name: s };
}

function button(customId, label, style = BTN.primary, emoji, disabled = false) {
  const b = { type: 2, style, custom_id: customId, label: String(label).slice(0, 80), disabled };
  const em = emojiObj(emoji);
  if (em) b.emoji = em;
  return b;
}
const row = (...components) => ({ type: 1, components });

function select(customId, placeholder, options) {
  return row({
    type: 3, custom_id: customId, placeholder: placeholder.slice(0, 150), min_values: 1, max_values: 1,
    options: options.slice(0, 25).map((o) => {
      const opt = { label: String(o.label).slice(0, 100), value: String(o.value).slice(0, 100) };
      if (o.description) opt.description = String(o.description).slice(0, 100);
      const em = emojiObj(o.emoji);
      if (em) opt.emoji = em;
      return opt;
    }),
  });
}

/** Modal with text fields: [{ id, label, style: 'short'|'long', required, max, placeholder, value }]. */
function modal(customId, title, fields) {
  return {
    custom_id: customId,
    title: title.slice(0, 45),
    components: fields.slice(0, 5).map((f) => row({
      type: 4, custom_id: f.id, label: f.label.slice(0, 45), style: f.style === 'long' ? 2 : 1,
      required: f.required !== false, max_length: f.max ?? 1000, ...(f.min ? { min_length: f.min } : {}),
      ...(f.placeholder ? { placeholder: f.placeholder.slice(0, 100) } : {}), ...(f.value ? { value: String(f.value).slice(0, f.max ?? 1000) } : {}),
    })),
  };
}

const ok = (g, text) => ({ embeds: [embed(g, { description: `✅ ${text}`, color: 0x2ecc71, timestamp: false })], ephemeral: true });
const fail = (g, text) => ({ embeds: [embed(g, { description: `❌ ${text}`, color: 0xe74c3c, timestamp: false })], ephemeral: true });

module.exports = { BTN, embed, button, row, select, modal, ok, fail, emojiObj };
