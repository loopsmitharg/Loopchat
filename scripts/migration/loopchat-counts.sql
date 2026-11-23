-- Conteos de integridad de la base de Loopchat (export en la PC y verificación en el VPS deben coincidir)
select 'tenants', count(*) from tenants union all
select 'user', count(*) from "user" union all
select 'platform_admins', count(*) from platform_admins union all
select 'memberships', count(*) from memberships union all
select 'bots', count(*) from bots union all
select 'bot_versions', count(*) from bot_versions union all
select 'bot_teams', count(*) from bot_teams union all
select 'bot_team_versions', count(*) from bot_team_versions union all
select 'tenant_ai_profiles', count(*) from tenant_ai_profiles union all
select 'tenant_ai_rules', count(*) from tenant_ai_rules union all
select 'knowledge_sources', count(*) from knowledge_sources union all
select 'knowledge_chunks', count(*) from knowledge_chunks union all
select 'products', count(*) from products union all
select 'pipelines', count(*) from pipelines union all
select 'stages', count(*) from stages union all
select 'opportunities', count(*) from opportunities union all
select 'contacts', count(*) from contacts union all
select 'conversations', count(*) from conversations union all
select 'messages', count(*) from messages union all
select 'ai_provider_connections', count(*) from ai_provider_connections union all
select 'channel_connections', count(*) from channel_connections union all
select 'chatwoot_accounts', count(*) from chatwoot_accounts
order by 1;
