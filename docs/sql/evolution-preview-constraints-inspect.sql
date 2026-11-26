-- Solo lectura: ejecutar en monzo-evolution-test / neondb.
-- Distingue el catalogo NOT NULL de PostgreSQL 18 de las demas restricciones.
-- No modifica restricciones ni registra migraciones.
WITH items AS (
 SELECT jsonb_build_array(
  c.relname,k.conname,k.contype,k.convalidated,
  k.condeferrable,k.condeferred,pg_get_constraintdef(k.oid,false)
 ) AS item
 FROM pg_constraint k
 JOIN pg_class c ON c.oid=k.conrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND k.contype<>'n'
), actual AS (
 SELECT encode(sha256(convert_to(
  string_agg(item::text,E'\n' ORDER BY item::text COLLATE "C"),'UTF8'
 )),'hex') AS digest FROM items
)
SELECT
 current_setting('server_version') AS version_postgresql,
 (SELECT count(*) FROM pg_constraint k
  JOIN pg_namespace n ON n.oid=k.connamespace
  WHERE n.nspname='public' AND k.contype='n') AS restricciones_not_null,
 digest='c4d69c411b3b903aff18f9ae3c7d467e66ba599a0ab1c452d24d57236e19e214'
  AS otras_restricciones_coinciden
FROM actual;
