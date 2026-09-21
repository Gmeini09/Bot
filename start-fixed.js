'use strict';

const { Client, Events } = require('discord.js');

const originalLogin = Client.prototype.login;

function isSlowSellingInteraction(interaction) {
  const id = String(interaction?.customId || '');

  if (interaction.isModalSubmit?.()) {
    return (
      id === 'selling_cart_checkout_modal'
      || id === 'selling_gift_modal'
      || id.startsWith('selling_review_submit:')
    );
  }

  if (interaction.isButton?.()) {
    return (
      id.startsWith('selling_priority_cycle:')
      || id.startsWith('selling_express:')
    );
  }

  return false;
}

function installSafeDeferredReply(interaction) {
  if (interaction.deferred || interaction.replied || interaction.__turboDeferredReplyPatched) {
    return;
  }

  interaction.__turboDeferredReplyPatched = true;

  const deferPromise = interaction.deferReply({ ephemeral: true });

  deferPromise.catch(error => {
    if (error?.code !== 10062) {
      console.error('❌ Turbo Designs deferReply hotfix:', error);
    }
  });

  const originalReply = interaction.reply.bind(interaction);

  interaction.reply = async function patchedReply(options) {
    try {
      await deferPromise;
    } catch {
      // Fall back to the normal reply if Discord rejected the defer.
    }

    if (interaction.deferred) {
      if (typeof options === 'string') {
        return interaction.editReply({ content: options });
      }

      const payload = options && typeof options === 'object'
        ? { ...options }
        : { content: String(options ?? '') };

      delete payload.ephemeral;
      return interaction.editReply(payload);
    }

    if (interaction.replied) {
      if (typeof options === 'string') {
        return interaction.followUp({ content: options, ephemeral: true });
      }
      return interaction.followUp(options || {});
    }

    return originalReply(options);
  };
}

Client.prototype.login = function turboStableLogin(...args) {
  if (!this.__turboStableInteractionPatchInstalled) {
    this.__turboStableInteractionPatchInstalled = true;

    this.prependListener(Events.InteractionCreate, interaction => {
      if (!isSlowSellingInteraction(interaction)) return;
      installSafeDeferredReply(interaction);
    });
  }

  return originalLogin.apply(this, args);
};

console.log('✅ Turbo Designs Stable Hotfix geladen');

require('./selling-entry.js');
