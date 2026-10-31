CREATE TABLE "AutomationVariable" (
 "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "name" TEXT NOT NULL,
 "identifier" TEXT NOT NULL, "type" TEXT NOT NULL, "description" TEXT NOT NULL DEFAULT '',
 "defaultValue" TEXT, "scope" TEXT NOT NULL DEFAULT 'execution', "currency" TEXT NOT NULL DEFAULT 'ARS',
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "AutomationVariable_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "AutomationVariable_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "AutomationVariable_identifier_check" CHECK ("identifier" ~ '^[a-z][a-z0-9_]{0,39}$' AND "identifier" NOT IN ('constructor','prototype','__proto__')),
 CONSTRAINT "AutomationVariable_type_check" CHECK ("type" IN ('text','integer','decimal','currency','boolean','date','datetime','url')),
 CONSTRAINT "AutomationVariable_scope_check" CHECK ("scope" = 'execution')
);
CREATE UNIQUE INDEX "AutomationVariable_tenantId_identifier_key" ON "AutomationVariable"("tenantId","identifier");
-- Register valid legacy capture identifiers without changing published graphs or conversation values.
INSERT INTO "AutomationVariable" ("id","tenantId","name","identifier","type","description","updatedAt")
SELECT 'legacy_' || md5("tenantId" || ':' || identifier), "tenantId", identifier, identifier, 'text', 'Variable de un flujo anterior', CURRENT_TIMESTAMP
FROM (
 SELECT DISTINCT f."tenantId", n->>'variable' AS identifier FROM "AutomationFlow" f
 CROSS JOIN LATERAL (VALUES(f.draft),(f.published)) g(graph)
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(g.graph->'nodes')='array' THEN g.graph->'nodes' ELSE '[]'::jsonb END) n
 WHERE n->>'kind'='capture' AND n->>'variable' ~ '^[a-z][a-z0-9_]{0,39}$' AND n->>'variable' NOT IN ('constructor','prototype','__proto__')
) legacy;
