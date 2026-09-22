import { config } from './config.mjs';

export function safeError(error) {
  let message = String(error?.message || 'Operation failed');
  for (const secret of [config.discordToken,config.youtubeApiKey,config.vapidPrivateKey]) {
    if(secret) message = message.split(secret).join('[redacted]');
  }
  return message.replace(/(authorization|token|key|secret|password)\s*[:=]\s*[^\s&,;]+/gi,'$1=[redacted]').slice(0,300);
}
