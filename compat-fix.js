'use strict';

const {
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
} = require('discord.js');

// discord.js 14.27.0 does not expose setFileTypes() on FileUploadBuilder.
// Keep the existing Selling code fluent; Discord accepts the upload without a local filter.
if (FileUploadBuilder && typeof FileUploadBuilder.prototype.setFileTypes !== 'function') {
  Object.defineProperty(FileUploadBuilder.prototype, 'setFileTypes', {
    configurable: true,
    writable: true,
    value: function setFileTypesCompat(...types) {
      this.__turboAllowedFileTypes = types;
      return this;
    },
  });
}

// In the @discordjs/builders version bundled with discord.js 14.27, ModalBuilder.addComponents()
// rejects a FileUploadBuilder passed directly. Wrap upload controls in a LabelBuilder instead.
if (ModalBuilder && FileUploadBuilder && LabelBuilder && !ModalBuilder.prototype.__turboFileUploadCompat) {
  const nativeAddComponents = ModalBuilder.prototype.addComponents;
  if (typeof nativeAddComponents === 'function') {
    Object.defineProperty(ModalBuilder.prototype, 'addComponents', {
      configurable: true,
      writable: true,
      value: function turboAddComponentsCompat(...components) {
        const normalized = components.map(component => {
          if (!(component instanceof FileUploadBuilder)) return component;
          return new LabelBuilder()
            .setLabel('Referenzen / Dateien')
            .setDescription('Optional: Lade bis zu 3 Referenzdateien hoch.')
            .setFileUploadComponent(component);
        });
        return nativeAddComponents.apply(this, normalized);
      },
    });
  }

  Object.defineProperty(ModalBuilder.prototype, '__turboFileUploadCompat', {
    configurable: false,
    writable: false,
    value: true,
  });
}

console.log('✅ Turbo Compatibility Fix v5.9.3 aktiv: Modal FileUpload + discord.js 14.27');
