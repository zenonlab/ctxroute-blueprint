ALTER TABLE public_release_sync_state ADD COLUMN agenda_last_success_at TEXT;
ALTER TABLE public_release_sync_state ADD COLUMN agenda_retry_at TEXT;
ALTER TABLE public_release_sync_state ADD COLUMN agenda_lease_until TEXT;
ALTER TABLE public_release_sync_state ADD COLUMN agenda_window_from TEXT;
ALTER TABLE public_release_sync_state ADD COLUMN agenda_window_to TEXT;

INSERT OR IGNORE INTO public_release_sync_state (provider, cursor, fetched_at, parser_version, rules_version, status, error_code, provider_key)
VALUES ('anilist', NULL, '1970-01-01T00:00:00.000Z', '2', '2', 'failed', 'agenda-never-run', 'anilist');

UPDATE public_release_sync_state
SET agenda_last_success_at = (SELECT generated_at FROM public_release_generation WHERE status = 'active' ORDER BY generated_at DESC LIMIT 1),
    agenda_window_from = (SELECT window_from FROM public_release_generation WHERE status = 'active' ORDER BY generated_at DESC LIMIT 1),
    agenda_window_to = (SELECT window_to FROM public_release_generation WHERE status = 'active' ORDER BY generated_at DESC LIMIT 1)
WHERE provider = 'anilist';

PRAGMA optimize;
