import { safeError } from './safe-error.mjs';
import {
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';
import { config, creators } from './config.mjs';
import { eventFromMessage, newestLocalEvent, INACCESSIBLE_EXTERNAL_SOURCE } from './events.mjs';

const CREATOR_CHOICES = creators.map(c => ({ name: c.name, value: c.id }));
const EPHEMERAL = MessageFlags.Ephemeral;
const REQUIRED_SEND_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks
];

export const commands = [
  new SlashCommandBuilder().setName('setsource').setDescription('Choose a local channel containing forwarded public events')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName('channel').setDescription('Local event source; posts appear in Unstable Watch').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)),
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Set both Unstable notification channels')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName('uploads').setDescription('Channel for creator uploads').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
    .addChannelOption(o => o.setName('events').setDescription('Channel for relayed events').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)),

  new SlashCommandBuilder()
    .setName('setchannel')
    .setDescription('Choose where a notification type is sent')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('type').setDescription('Notification type').setRequired(true).addChoices(
      { name: 'Uploads', value: 'uploads' },
      { name: 'Events', value: 'events' }
    ))
    .addChannelOption(o => o.setName('channel').setDescription('Destination channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)),

  new SlashCommandBuilder()
    .setName('notifications')
    .setDescription('Turn upload/event notifications on or off')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('type').setDescription('Which notifications').setRequired(true).addChoices(
      { name: 'Uploads', value: 'uploads' },
      { name: 'Events', value: 'events' },
      { name: 'All', value: 'all' }
    ))
    .addStringOption(o => o.setName('state').setDescription('Enable or disable').setRequired(true).addChoices(
      { name: 'On', value: 'on' },
      { name: 'Off', value: 'off' }
    )),

  new SlashCommandBuilder()
    .setName('creator')
    .setDescription('Enable or disable upload alerts for one protagonist')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('creator').setDescription('Creator').setRequired(true).addChoices(...CREATOR_CHOICES))
    .addStringOption(o => o.setName('state').setDescription('Enable or disable').setRequired(true).addChoices(
      { name: 'On', value: 'on' },
      { name: 'Off', value: 'off' }
    )),

  new SlashCommandBuilder()
    .setName('mention')
    .setDescription('Optionally ping a role with upload/event alerts')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addRoleOption(o => o.setName('role').setDescription('Role to ping; omit to disable role pings')),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show this server’s Unstable notification settings'),

  new SlashCommandBuilder()
    .setName('testnotify')
    .setDescription('Send a test notification')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('type').setDescription('Notification type').setRequired(true).addChoices(
      { name: 'Uploads', value: 'uploads' },
      { name: 'Events', value: 'events' }
    )),

  new SlashCommandBuilder()
    .setName('reset')
    .setDescription('Reset this server’s Unstable Watch settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show Unstable Watch bot commands'),

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check whether the Unstable Watch bot is online')
].map(command => command.toJSON());

function mentionContent(settings) {
  return settings.mentionRoleId ? `<@&${settings.mentionRoleId}> ` : '';
}


function latestUploadFromStore(store) {
  return Object.values(store.state.latestVideos || {})
    .flatMap(videos => Array.isArray(videos) ? videos : [])
    .filter(video => video?.id)
    .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))[0] || null;
}

function uploadEmbed(video, { test = false } = {}) {
  const creator = creators.find(c => c.id === video.creatorId);
  const embed = new EmbedBuilder()
    .setColor(Number.parseInt((creator?.accent || '#8b5cff').slice(1), 16))
    .setTitle(String(video.title || 'Latest Unstable upload').slice(0, 250))
    .setURL(video.watchUrl || `https://www.youtube.com/watch?v=${video.id}`)
    .setAuthor({ name: `${video.creator || creator?.name || 'Unstable'} uploaded` })
    .setDescription(test ? 'This is the latest cached Unstable upload — your upload notification channel is working.' : 'A new Unstable perspective just dropped. Watch it now.')
    .setTimestamp(new Date(video.publishedAt || Date.now()));
  if (video.thumbnail) embed.setImage(video.thumbnail);
  if (test) embed.setFooter({ text: 'Latest upload • test notification' });
  return embed;
}

export function eventEmbed(event, { test = false } = {}) {
  const embed = new EmbedBuilder()
    .setColor(0xff345f)
    .setTitle(test ? '⚡ Latest Unstable event • test' : '⚡ New Unstable event')
    .setDescription(String(event.content || 'An Unstable event was posted.').slice(0, 3500))
    .addFields({name:'For', value:(event.targetCreators || ['Unspecified']).join(', ')}, {name:'Event', value:String(event.title || 'Unstable event').slice(0,250)}, {name:'Source', value:'Unstable Events · local relay'})
    .setFooter({ text: test ? 'Latest event • test notification' : `From #${event.channelName || 'events'}` })
    .setTimestamp(new Date(event.createdAt || Date.now()));
  if (event.image) embed.setImage(event.image);
  if (event.jumpUrl) embed.setURL(event.jumpUrl);
  return embed;
}

export class DiscordBot {
  constructor(store, { onEvent = async () => {} } = {}) {
    this.store = store;
    this.onEvent = onEvent;
    this.client = null;
    this.ready = false;
    this.sourceChannelReady = false;
    this.lastError = null;
    this.loginRetryTimer = null;
    this.loginAttempts = 0;
    this.stopping = false;
  }

  get inviteUrl() {
    const id = this.client?.user?.id || config.discordClientId;
    if (!id) return null;
    const params = new URLSearchParams({
      client_id: id,
      permissions: '84992',
      scope: 'bot applications.commands'
    });
    return `https://discord.com/oauth2/authorize?${params}`;
  }

  async registerGuildCommands(guild) {
    try {
      await guild.commands.set(commands);
    } catch (error) {
      this.lastError = `Command registration in ${guild.name}: ${safeError(error)}`;
      console.error('[discord]', this.lastError);
    }
  }

  async localSource(guildId) {
    const id = this.store.getGuild(guildId).eventSourceChannelId;
    if (!id || id === INACCESSIBLE_EXTERNAL_SOURCE || !this.client?.isReady()) return null;
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return null;
    const source = await guild.channels.fetch(id).catch(() => null);
    if (source?.guildId !== guildId || !source?.isTextBased()) return null;
    const perms = source.permissionsFor?.(guild.members.me);
    if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) return null;
    return source;
  }

  async verifySourceChannel() {
    const sources = await Promise.all(Object.keys(this.store.state.guilds).map(id => this.localSource(id)));
    this.sourceChannelReady = sources.some(Boolean);
  }

  async start() {
    if (config.discordBotMode !== 'local') return;
    if (!config.discordToken) {
      console.warn('[discord] DISCORD_BOT_TOKEN missing; bot disabled.');
      return;
    }

    const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];
    if (config.discordMessageContentIntent) intents.push(GatewayIntentBits.MessageContent);

    this.client = new Client({ intents });
    if (!config.discordMessageContentIntent) {
      console.log('[discord] Message Content intent disabled. Event alerts will still fire, but message text/images may be unavailable.');
    }

    this.client.once(Events.ClientReady, async () => {
      this.ready = true;
      this.lastError = null;
      console.log(`[discord] Logged in as ${this.client.user.tag}`);
      await Promise.allSettled([...this.client.guilds.cache.values()].map(guild => this.registerGuildCommands(guild)));
      await this.verifySourceChannel();
    });

    this.client.on(Events.GuildCreate, guild => this.registerGuildCommands(guild));
    this.client.on(Events.InteractionCreate, interaction => this.handleInteraction(interaction).catch(error => this.handleInteractionError(interaction, error)));
    this.client.on(Events.MessageCreate, message => this.handleSourceEvent(message).catch(error => {
      this.lastError = `Event relay: ${safeError(error)}`;
      console.error('[discord]', this.lastError);
    }));
    this.client.on(Events.Error, error => {
      this.lastError = safeError(error);
      console.error('[discord] client error:', safeError(error));
    });
    this.client.on(Events.ShardReconnecting, shardId => {
      this.ready = false;
      console.warn(`[discord] Shard ${shardId} reconnecting…`);
    });
    this.client.on(Events.ShardResume, () => { this.ready=this.client.isReady(); });
    this.client.on(Events.ShardDisconnect, () => { this.ready=false; });
    this.client.on(Events.ShardReady, shardId => {
      this.ready=this.client.isReady();
      console.log(`[discord] Shard ${shardId} ready.`);
    });

    await this.loginWithRetry();
  }

  async loginWithRetry() {
    if (this.stopping || !this.client || this.client.isReady()) return;
    clearTimeout(this.loginRetryTimer);
    try {
      await this.client.login(config.discordToken);
      this.loginAttempts = 0;
      if(this.stopping) await this.client.destroy();
    } catch (error) {
      this.ready = false;
      this.lastError = `Login failed: ${safeError(error)}`;
      console.error('[discord]', this.lastError);
      const disallowed = error?.code === 4014 || /disallowed intents/i.test(error?.message || '');
      const badToken = error?.code === 'TokenInvalid' || /invalid token/i.test(error?.message || '');
      if (this.stopping || disallowed || badToken) return;
      this.loginAttempts += 1;
      const delay = Math.min(60_000, 2_000 * (2 ** Math.min(this.loginAttempts - 1, 5)));
      console.warn(`[discord] Retrying initial login in ${Math.round(delay / 1000)}s.`);
      this.loginRetryTimer = setTimeout(() => this.loginWithRetry(), delay);
      this.loginRetryTimer.unref?.();
    }
  }

  async stop() {
    this.stopping = true;
    clearTimeout(this.loginRetryTimer);
    this.ready = false;
    await this.client?.destroy();
  }

  async handleInteractionError(interaction, error) {
    this.lastError = `Interaction: ${safeError(error)}`;
    console.error('[discord]', this.lastError);
    const payload = { content: 'Something went wrong while running that command. Check my channel permissions and try again.', flags: EPHEMERAL };
    if (!interaction.isRepliable()) return;
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }

  canSendTo(channel, guild) {
    if (!channel?.isTextBased() || !guild) return false;
    const me = guild.members.me;
    if (!me || !channel.permissionsFor) return true;
    const perms = channel.permissionsFor(me);
    return REQUIRED_SEND_PERMISSIONS.every(permission => perms?.has(permission));
  }

  async validateDestination(interaction, channel) {
    if (!this.canSendTo(channel, interaction.guild)) {
      await interaction.reply({
        content: `I can’t post embeds in ${channel}. Give me **View Channel**, **Send Messages**, and **Embed Links** there first.`,
        flags: EPHEMERAL
      });
      return false;
    }
    return true;
  }

  async handleInteraction(interaction) {
    if (!interaction.isChatInputCommand() || !interaction.guildId) return;
    if (['setsource','status','testnotify'].includes(interaction.commandName) && interaction.deferReply) await interaction.deferReply({flags:EPHEMERAL});
    const reply = payload => interaction.deferred ? interaction.editReply(payload) : interaction.reply(payload);
    const settings = this.store.getGuild(interaction.guildId);
    if (interaction.commandName === 'setsource') {
      const source = interaction.options.getChannel('channel', true);
      const perms = source.permissionsFor?.(interaction.guild.members.me);
      if (source.id === INACCESSIBLE_EXTERNAL_SOURCE || source.guildId !== interaction.guildId || !source.isTextBased() || !perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) {
        return reply({content:'Choose a channel in this server where I have View Channel and Read Message History.', flags:EPHEMERAL});
      }
      this.store.patchGuild(interaction.guildId, {eventSourceChannelId:source.id});
      await this.verifySourceChannel();
      return reply({content:'Local event source: <#'+source.id+'>. Forward legitimate public Unstable Events here; they will appear in Unstable Watch. Enable Message Content intent in the bot configuration and Discord Developer Portal to read text, embeds and images.', flags:EPHEMERAL});
    }

    if (interaction.commandName === 'setup') {
      const uploads = interaction.options.getChannel('uploads', true);
      const events = interaction.options.getChannel('events', true);
      if (!(await this.validateDestination(interaction, uploads))) return;
      if (!(await this.validateDestination(interaction, events))) return;
      this.store.patchGuild(interaction.guildId, { uploadChannelId: uploads.id, eventChannelId: events.id });
      return reply({ content: `✅ Uploads → ${uploads}\n✅ Events → ${events}`, flags: EPHEMERAL });
    }

    if (interaction.commandName === 'setchannel') {
      const type = interaction.options.getString('type', true);
      const channel = interaction.options.getChannel('channel', true);
      if (!(await this.validateDestination(interaction, channel))) return;
      this.store.patchGuild(interaction.guildId, type === 'uploads' ? { uploadChannelId: channel.id } : { eventChannelId: channel.id });
      return reply({ content: `✅ ${type === 'uploads' ? 'Upload' : 'Event'} notifications will go to ${channel}.`, flags: EPHEMERAL });
    }

    if (interaction.commandName === 'notifications') {
      const type = interaction.options.getString('type', true);
      const enabled = interaction.options.getString('state', true) === 'on';
      const patch = {};
      if (type === 'uploads' || type === 'all') patch.uploadsEnabled = enabled;
      if (type === 'events' || type === 'all') patch.eventsEnabled = enabled;
      this.store.patchGuild(interaction.guildId, patch);
      return reply({ content: `✅ ${type} notifications are now **${enabled ? 'on' : 'off'}**.`, flags: EPHEMERAL });
    }

    if (interaction.commandName === 'creator') {
      const creatorId = interaction.options.getString('creator', true);
      const enabled = interaction.options.getString('state', true) === 'on';
      const current = new Set(settings.enabledCreators || []);
      enabled ? current.add(creatorId) : current.delete(creatorId);
      this.store.patchGuild(interaction.guildId, { enabledCreators: [...current] });
      const creator = creators.find(c => c.id === creatorId);
      return reply({ content: `✅ ${creator?.name || creatorId} upload alerts are **${enabled ? 'on' : 'off'}**.`, flags: EPHEMERAL });
    }

    if (interaction.commandName === 'mention') {
      const role = interaction.options.getRole('role');
      if (role?.id === interaction.guildId) {
        return reply({ content: 'I won’t configure `@everyone` as an automatic ping. Choose a specific role instead.', flags: EPHEMERAL });
      }
      this.store.patchGuild(interaction.guildId, { mentionRoleId: role?.id || null });
      return reply({ content: role ? `✅ Alerts can now ping ${role}.` : '✅ Automatic role pings are disabled.', flags: EPHEMERAL });
    }

    if (interaction.commandName === 'status') {
      const names = (settings.enabledCreators || []).map(id => creators.find(c => c.id === id)?.name || id).join(', ') || 'None';
      const source = await this.localSource(interaction.guildId);
      const latest = newestLocalEvent(this.store.state.recentEvents, interaction.guildId, settings.eventSourceChannelId);
      const embed = new EmbedBuilder()
        .setTitle('Unstable Watch settings')
        .setColor(0x8b5cff)
        .addFields(
          { name: 'Upload channel', value: settings.uploadChannelId ? `<#${settings.uploadChannelId}>` : 'Not set', inline: true },
          { name: 'Event channel', value: settings.eventChannelId ? `<#${settings.eventChannelId}>` : 'Not set', inline: true },
          { name: 'Uploads', value: settings.uploadsEnabled ? 'On' : 'Off', inline: true },
          { name: 'Events', value: settings.eventsEnabled ? 'On' : 'Off', inline: true },
          { name: 'Role ping', value: settings.mentionRoleId ? `<@&${settings.mentionRoleId}>` : 'Off', inline: true },
          { name: 'Creators', value: names },
          { name: 'Event source', value: settings.eventSourceChannelId ? '<#'+settings.eventSourceChannelId+'>' : 'Not configured · Use /setsource' },
          { name: 'Source status', value: !settings.eventSourceChannelId ? 'Not configured' : !config.discordMessageContentIntent ? 'Message Content intent required' : source ? 'Ready' : 'Unavailable · check channel permissions' },
          { name: 'Last event', value: latest ? '<t:'+Math.floor(new Date(latest.createdAt).getTime()/1000)+':R>' : 'None cached' }
        )
        .setFooter({ text: 'Use /help for all commands' });
      return reply({ embeds: [embed], flags: EPHEMERAL });
    }

    if (interaction.commandName === 'testnotify') {
      const type = interaction.options.getString('type', true);
      if (type === 'events' && !settings.eventSourceChannelId) return reply({content:'No local event source is configured. Use /setsource to choose the channel where Unstable Events are forwarded.', flags:EPHEMERAL});
      const channelId = type === 'uploads' ? settings.uploadChannelId : settings.eventChannelId;
      const channel = channelId && channelId !== INACCESSIBLE_EXTERNAL_SOURCE ? await interaction.guild.channels.fetch(channelId).catch(() => null) : null;
      if (!channel?.isTextBased()) return reply({ content: 'Set that notification channel first.', flags: EPHEMERAL });
      if (!this.canSendTo(channel, interaction.guild)) return reply({ content: 'I can’t send messages/embeds in that channel yet.', flags: EPHEMERAL });

      if (type === 'uploads') {
        const latest = latestUploadFromStore(this.store);
        if (!latest) return reply({ content: 'I don’t have a cached YouTube upload yet. Wait for the first YouTube sync, then try again.', flags: EPHEMERAL });
        await channel.send({
          content: `${mentionContent(settings)}🧪 **Latest upload test — ${latest.creator}**`,
          allowedMentions: { roles: settings.mentionRoleId ? [settings.mentionRoleId] : [], parse: [] },
          embeds: [uploadEmbed(latest, { test: true })]
        });
        return reply({ content: `Latest upload test sent: **${latest.title}**`, flags: EPHEMERAL });
      }

      const latestEvent = await this.getLatestEventForTest(interaction.guildId);
      if (!latestEvent) return reply({ content: 'No readable event was found in the configured local source. Forward an event there and check View Channel, Read Message History and Message Content intent.', flags: EPHEMERAL });
      await channel.send({
        content: `${mentionContent(settings)}🧪 **Latest event test**`,
        allowedMentions: { roles: settings.mentionRoleId ? [settings.mentionRoleId] : [], parse: [] },
        embeds: [eventEmbed(latestEvent, { test: true })]
      });
      return reply({ content: 'Latest event test sent.', flags: EPHEMERAL });
    }

    if (interaction.commandName === 'reset') {
      this.store.state.guilds[interaction.guildId] = {
        uploadChannelId: null,
        eventChannelId: null,
        eventSourceChannelId: null,
        uploadsEnabled: true,
        eventsEnabled: true,
        enabledCreators: creators.map(c => c.id),
        mentionRoleId: null
      };
      this.store.scheduleSave();
      return reply({ content: '✅ Settings reset. Run `/setup` to choose notification channels again.', flags: EPHEMERAL });
    }

    if (interaction.commandName === 'help') {
      const embed = new EmbedBuilder()
        .setColor(0x8b5cff)
        .setTitle('Unstable Watch bot')
        .setDescription('Upload + event notifications for your server.')
        .addFields(
          { name: '/setup', value: 'Choose upload and event channels.' },
          { name: '/setsource', value: 'Choose a local source for forwarded public events. The bot cannot read the external Unstable Events server.' },
          { name: '/setchannel', value: 'Change one destination channel.' },
          { name: '/notifications', value: 'Enable/disable uploads, events, or both.' },
          { name: '/creator', value: 'Toggle alerts for an individual protagonist.' },
          { name: '/mention', value: 'Optionally ping one role on alerts.' },
          { name: '/status', value: 'Show this server’s current settings.' },
          { name: '/testnotify', value: 'Send the latest real upload or latest real event as a test.' },
          { name: '/reset', value: 'Reset this server’s settings.' }
        );
      return reply({ embeds: [embed], flags: EPHEMERAL });
    }

    if (interaction.commandName === 'ping') {
      return reply({ content: `🏓 Online · ${Math.max(0, Math.round(this.client.ws.ping))} ms gateway latency`, flags: EPHEMERAL });
    }
  }

  async getLatestEventForTest(guildId) {
    const settings = this.store.getGuild(guildId);
    const cached = newestLocalEvent(this.store.state.recentEvents, guildId, settings.eventSourceChannelId);
    if (cached) return cached;
    const source = await this.localSource(guildId);
    if (!source?.messages?.fetch) return null;
    const messages = await source.messages.fetch({limit:50}).catch(() => null);
    const events = [...(messages?.values?.() || [])].map(message => eventFromMessage(message, this.client.user.id)).filter(Boolean);
    const latest = newestLocalEvent(events, guildId, settings.eventSourceChannelId);
    if (latest) this.store.addEvent(latest);
    return latest;
  }

  async handleSourceEvent(message) {
    const settings = this.store.state.guilds[message.guildId];
    if (!settings?.eventSourceChannelId || message.channelId !== settings.eventSourceChannelId) return;
    const event = eventFromMessage(message, this.client?.user?.id);
    if (!event || !this.store.addEvent(event)) return;
    await this.onEvent(event).catch(() => console.warn('[discord] Event web notification failed; event remains cached.'));
    if (!settings.eventsEnabled || !settings.eventChannelId || settings.eventChannelId === message.channelId) return;
    const guild = this.client.guilds.cache.get(message.guildId);
    const channel = await guild?.channels.fetch(settings.eventChannelId).catch(() => null);
    if (!channel?.isTextBased() || channel.guildId !== message.guildId) return;
    await channel.send({
      content: mentionContent(settings)+'⚡ **UNSTABLE EVENT**',
      allowedMentions:{roles:settings.mentionRoleId ? [settings.mentionRoleId] : [], parse:[]},
      embeds:[eventEmbed(event)]
    }).catch(() => console.warn('[discord] Could not send local event notification; check destination permissions.'));
  }

  async announceUpload(video) {
    if (!this.client?.isReady()) return;
    const embed = uploadEmbed(video);

    for (const settings of Object.values(this.store.state.guilds)) {
      if (!settings.uploadsEnabled || !settings.uploadChannelId) continue;
      if (!(settings.enabledCreators || []).includes(video.creatorId)) continue;
      const channel = await this.client.channels.fetch(settings.uploadChannelId).catch(() => null);
      if (!channel?.isTextBased()) continue;
      await channel.send({
        content: `${mentionContent(settings)}🔔 **${video.creator} uploaded!**`,
        allowedMentions: { roles: settings.mentionRoleId ? [settings.mentionRoleId] : [], parse: [] },
        embeds: [embed]
      }).catch(error => console.error('[discord] upload notify:', safeError(error)));
    }
  }
}
