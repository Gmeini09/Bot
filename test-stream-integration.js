'use strict';
const Module=require('node:module');
const original=Module._load;
class Builder{constructor(){this.data={};}setName(x){this.data.name=x;return this;}setDescription(x){this.data.description=x;return this;}setDefaultMemberPermissions(){return this;}addSubcommand(fn){fn(new Builder());return this;}addStringOption(fn){fn(new Builder());return this;}addIntegerOption(fn){fn(new Builder());return this;}addChannelOption(fn){fn(new Builder());return this;}addRoleOption(fn){fn(new Builder());return this;}setRequired(){return this;}setMaxLength(){return this;}setMinValue(){return this;}setMaxValue(){return this;}addChannelTypes(){return this;}toJSON(){return this.data;}}
class Embed{constructor(){this.data={};}setColor(){return this;}setTitle(){return this;}setDescription(){return this;}setURL(){return this;}setFooter(){return this;}setTimestamp(){return this;}}
Module._load=function(name,parent,main){if(name==='discord.js')return {SlashCommandBuilder:Builder,PermissionFlagsBits:{ManageGuild:32n},ChannelType:{GuildText:0,GuildAnnouncement:5},EmbedBuilder:Embed};return original.apply(this,arguments);};
require('./stream-integration/tests/stream.test.js');
