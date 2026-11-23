-- Conteos de integridad de la base de Chatwoot
select 'accounts', count(*) from accounts union all
select 'users', count(*) from users union all
select 'account_users', count(*) from account_users union all
select 'platform_apps', count(*) from platform_apps union all
select 'inboxes', count(*) from inboxes union all
select 'channel_whatsapp', count(*) from channel_whatsapp union all
select 'webhooks', count(*) from webhooks union all
select 'agent_bots', count(*) from agent_bots union all
select 'contacts', count(*) from contacts union all
select 'conversations', count(*) from conversations union all
select 'messages', count(*) from messages union all
select 'attachments', count(*) from attachments union all
select 'active_storage_blobs', count(*) from active_storage_blobs
order by 1;
