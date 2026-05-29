-- Scoped cleanup for Evolution instance mdoctor-staging (Postgres metadata only).
-- Preserves: Instance, Setting, Webhook, Baileys session on /evolution/instances.
-- Does NOT call logout/delete instance or delete messages on WhatsApp servers.

BEGIN;

DELETE FROM "MessageUpdate" WHERE "instanceId" = '19902838-07d7-4039-af37-321905624b1c';
DELETE FROM "Media"         WHERE "instanceId" = '19902838-07d7-4039-af37-321905624b1c';
DELETE FROM "Message"       WHERE "instanceId" = '19902838-07d7-4039-af37-321905624b1c';
DELETE FROM "Chat"          WHERE "instanceId" = '19902838-07d7-4039-af37-321905624b1c';
DELETE FROM "Contact"       WHERE "instanceId" = '19902838-07d7-4039-af37-321905624b1c';

COMMIT;
