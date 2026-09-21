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

const CREATOR_CHOICES = creators.map(c => ({ name: c.name, value: c.id }));
const EPHEMERAL = MessageFlags.Ephemeral;
const REQUIRED_SEND_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks
];

const commands = [
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

function eventFromMessage(message) {
  return {
    id: message.id,
    author: message.author?.username || 'Unstable Events',
    content: message.content || message.embeds?.[0]?.description || message.embeds?.[0]?.title || 'An Unstable event was posted. Open the source message for details.',
    createdAt: message.createdAt?.toISOString?.() || new Date().toISOString(),
    jumpUrl: message.url,
    image: message.attachments?.find?.(a => a.contentType?.startsWith('image/'))?.url || message.embeds?.[0]?.image?.url || null,
    channelName: message.channel?.name || 'events'
  };
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

function eventEmbed(event, { test = false } = {}) {
  const embed = new EmbedBuilder()
    .setColor(0xff345f)
    .setTitle(test ? '⚡ Latest Unstable event • test' : '⚡ New Unstable event')
    .setDescription(String(event.content || 'An Unstable event was posted.').slice(0, 3900))
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
      this.lastError = `Command registration in ${guild.name}: ${error.message}`;
      console.error('[discord]', this.lastError);
    }
  }

  async verifySourceChannel() {
    if (!this.client?.isReady() || !config.eventSourceChannelId) return;
    const source = await this.client.channels.fetch(config.eventSourceChannelId).catch(() => null);
    this.sourceChannelReady = Boolean(source?.isTextBased());
    if (!this.sourceChannelReady) {
      console.warn(`[discord] Event source channel ${config.eventSourceChannelId} is not accessible to the bot.`);
    }
  }

  async start() {
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
      this.lastError = `Event relay: ${error.message}`;
      console.error('[discord]', this.lastError);
    }));
    this.client.on(Events.Error, error => {
      this.lastError = error.message;
      console.error('[discord] client error:', error.message);
    });
    this.client.on(Events.ShardReconnecting, shardId => {
      this.ready = false;
      console.warn(`[discord] Shard ${shardId} reconnecting…`);
    });
    this.client.on(Events.ShardReady, shardId => {
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
    } catch (error) {
      this.ready = false;
      this.lastError = `Login failed: ${error.message}`;
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
    this.client?.destroy();
  }

  async handleInteractionError(interaction, error) {
    this.lastError = `Interaction: ${error.message}`;
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
    const settings = this.store.getGuild(interaction.guildId);

    if (interaction.commandName === 'setup') {
      const uploads = interaction.options.getChannel('uploads', true);
      const events = interaction.options.getChannel('events', true);
      if (!(await this.validateDestination(interaction, uploads))) return;
      if (!(await this.validateDestination(interaction, events))) return;
      this.store.patchGuild(interaction.guildId, { uploadChannelId: uploads.id, eventChannelId: events.id });
      return interaction.reply({ content: `✅ Uploads → ${uploads}\n✅ Events → ${events}`, flags: EPHEMERAL });
    }

    if (interaction.commandName === 'setchannel') {
      const type = interaction.options.getString('type', true);
      const channel = interaction.options.getChannel('channel', true);
      if (!(await this.validateDestination(interaction, channel))) return;
      this.store.patchGuild(interaction.guildId, type === 'uploads' ? { uploadChannelId: channel.id } : { eventChannelId: channel.id });
      return interaction.reply({ content: `✅ ${type === 'uploads' ? 'Upload' : 'Event'} notifications will go to ${channel}.`, flags: EPHEMERAL });
    }

    if (interaction.commandName === 'notifications') {
      const type = interaction.options.getString('type', true);
      const enabled = interaction.options.getString('state', true) === 'on';
      const patch = {};
      if (type === 'uploads' || type === 'all') patch.uploadsEnabled = enabled;
      if (type === 'events' || type === 'all') patch.eventsEnabled = enabled;
      this.store.patchGuild(interaction.guildId, patch);
      return interaction.reply({ content: `✅ ${type} notifications are now **${enabled ? 'on' : 'off'}**.`, flags: EPHEMERAL });
    }

    if (interaction.commandName === 'creator') {
      const creatorId = interaction.options.getString('creator', true);
      const enabled = interaction.options.getString('state', true) === 'on';
      const current = new Set(settings.enabledCreators || []);
      enabled ? current.add(creatorId) : current.delete(creatorId);
      this.store.patchGuild(interaction.guildId, { enabledCreators: [...current] });
      const creator = creators.find(c => c.id === creatorId);
      return interaction.reply({ content: `✅ ${creator?.name || creatorId} upload alerts are **${enabled ? 'on' : 'off'}**.`, flags: EPHEMERAL });
    }

    if (interaction.commandName === 'mention') {
      const role = interaction.options.getRole('role');
      if (role?.id === interaction.guildId) {
        return interaction.reply({ content: 'I won’t configure `@everyone` as an automatic ping. Choose a specific role instead.', flags: EPHEMERAL });
      }
      this.store.patchGuild(interaction.guildId, { mentionRoleId: role?.id || null });
      return interaction.reply({ content: role ? `✅ Alerts can now ping ${role}.` : '✅ Automatic role pings are disabled.', flags: EPHEMERAL });
    }

    if (interaction.commandName === 'status') {
      const names = (settings.enabledCreators || []).map(id => creators.find(c => c.id === id)?.name || id).join(', ') || 'None';
      const embed = new EmbedBuilder()
        .setTitle('Unstable Watch settings')
        .setColor(0x8b5cff)
        .addFields(
          { name: 'Upload channel', value: settings.uploadChannelId ? `<#${settings.uploadChannelId}>` : 'Not set', inline: true },
          { name: 'Event channel', value: settings.eventChannelId ? `<#${settings.eventChannelId}>` : 'Not set', inline: true },
          { name: 'Uploads', value: settings.uploadsEnabled ? 'On' : 'Off', inline: true },
          { name: 'Events', value: settings.eventsEnabled ? 'On' : 'Off', inline: true },
          { name: 'Role ping', value: settings.mentionRoleId ? `<@&${settings.mentionRoleId}>` : 'Off', inline: true },
          { name: 'Creators', value: names }
        )
        .setFooter({ text: 'Use /help for all commands' });
      return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
    }

    if (interaction.commandName === 'testnotify') {
      const type = interaction.options.getString('type', true);
      const channelId = type === 'uploads' ? settings.uploadChannelId : settings.eventChannelId;
      const channel = channelId ? await this.client.channels.fetch(channelId).catch(() => null) : null;
      if (!channel?.isTextBased()) return interaction.reply({ content: 'Set that notification channel first.', flags: EPHEMERAL });
      if (!this.canSendTo(channel, interaction.guild)) return interaction.reply({ content: 'I can’t send messages/embeds in that channel yet.', flags: EPHEMERAL });

      if (type === 'uploads') {
        const latest = latestUploadFromStore(this.store);
        if (!latest) return interaction.reply({ content: 'I don’t have a cached YouTube upload yet. Wait for the first YouTube sync, then try again.', flags: EPHEMERAL });
        await channel.send({
          content: `${mentionContent(settings)}🧪 **Latest upload test — ${latest.creator}**`,
          allowedMentions: { roles: settings.mentionRoleId ? [settings.mentionRoleId] : [], parse: [] },
          embeds: [uploadEmbed(latest, { test: true })]
        });
        return interaction.reply({ content: `Latest upload test sent: **${latest.title}**`, flags: EPHEMERAL });
      }

      const latestEvent = await this.getLatestEventForTest();
      if (!latestEvent) return interaction.reply({ content: 'I don’t have a recent event yet and couldn’t read one from the event source channel.', flags: EPHEMERAL });
      await channel.send({
        content: `${mentionContent(settings)}🧪 **Latest event test**`,
        allowedMentions: { roles: settings.mentionRoleId ? [settings.mentionRoleId] : [], parse: [] },
        embeds: [eventEmbed(latestEvent, { test: true })]
      });
      return interaction.reply({ content: 'Latest event test sent.', flags: EPHEMERAL });
    }

    if (interaction.commandName === 'reset') {
      this.store.state.guilds[interaction.guildId] = {
        uploadChannelId: null,
        eventChannelId: null,
        uploadsEnabled: true,
        eventsEnabled: true,
        enabledCreators: creators.map(c => c.id),
        mentionRoleId: null
      };
      this.store.scheduleSave();
      return interaction.reply({ content: '✅ Settings reset. Run `/setup` to choose notification channels again.', flags: EPHEMERAL });
    }

    if (interaction.commandName === 'help') {
      const embed = new EmbedBuilder()
        .setColor(0x8b5cff)
        .setTitle('Unstable Watch bot')
        .setDescription('Upload + event notifications for your server.')
        .addFields(
          { name: '/setup', value: 'Choose upload and event channels.' },
          { name: '/setchannel', value: 'Change one destination channel.' },
          { name: '/notifications', value: 'Enable/disable uploads, events, or both.' },
          { name: '/creator', value: 'Toggle alerts for an individual protagonist.' },
          { name: '/mention', value: 'Optionally ping one role on alerts.' },
          { name: '/status', value: 'Show this server’s current settings.' },
          { name: '/testnotify', value: 'Send the latest real upload or latest real event as a test.' },
          { name: '/reset', value: 'Reset this server’s settings.' }
        );
      return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
    }

    if (interaction.commandName === 'ping') {
      return interaction.reply({ content: `🏓 Online · ${Math.max(0, Math.round(this.client.ws.ping))} ms gateway latency`, flags: EPHEMERAL });
    }
  }

  async getLatestEventForTest() {
    const cached = this.store.state.recentEvents?.[0];
    if (cached) return cached;
    if (!this.client?.isReady() || !config.eventSourceChannelId) return null;
    const source = await this.client.channels.fetch(config.eventSourceChannelId).catch(() => null);
    if (!source?.isTextBased() || !source.messages?.fetch) return null;
    const messages = await source.messages.fetch({ limit: 10 }).catch(() => null);
    const latest = messages?.find?.(message => message.author?.id !== this.client?.user?.id) || messages?.first?.();
    return latest ? eventFromMessage(latest) : null;
  }

  async handleSourceEvent(message) {
    if (message.channelId !== config.eventSourceChannelId || message.author?.id === this.client?.user?.id) return;

    const event = eventFromMessage(message);

    const added = this.store.addEvent(event);
    if (!added) return;
    await this.onEvent(event);

    const embed = eventEmbed(event);

    for (const [guildId, settings] of Object.entries(this.store.state.guilds)) {
      if (!settings.eventsEnabled || !settings.eventChannelId) continue;
      if (settings.eventChannelId === message.channelId && guildId === message.guildId) continue;
      const channel = await this.client.channels.fetch(settings.eventChannelId).catch(() => null);
      if (!channel?.isTextBased()) continue;
      await channel.send({
        content: `${mentionContent(settings)}⚡ **New Unstable event**`,
        allowedMentions: { roles: settings.mentionRoleId ? [settings.mentionRoleId] : [], parse: [] },
        embeds: [embed]
      }).catch(error => console.error('[discord] event relay:', error.message));
    }
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
      }).catch(error => console.error('[discord] upload notify:', error.message));
    }
  }
}
