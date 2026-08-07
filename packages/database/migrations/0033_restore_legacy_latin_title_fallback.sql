-- Older global calendar rows predate script metadata. Keep them readable while
-- the provider refresh annotates English/romaji/native variants.
DO $$
DECLARE definition text; updated text;
BEGIN
  SELECT pg_get_functiondef('favlib_display_title(text,uuid)'::regprocedure) INTO definition;
  updated:=replace(definition,
    'OR (t.script = ''Latn''::text)))',
    'OR (t.script = ''Latn''::text) OR (t.text ~ ''[A-Za-zÀ-ÖØ-öø-ÿ]''::text)))');
  IF updated<>definition THEN EXECUTE updated; END IF;
END $$;
