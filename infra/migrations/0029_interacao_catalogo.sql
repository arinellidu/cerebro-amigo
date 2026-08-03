-- Migration 0029: rede de segurança de interações/duplicidade na prescrição
-- (A5, ADR-032). Checagem DETERMINÍSTICA a partir de uma base local versionada —
-- NÃO é IA, NÃO gera conduta. É uma SEGUNDA BARREIRA factual ao MEMED.
--
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ ⚠️  SEED DRAFT — REQUER REVISÃO CLÍNICA (Dr. Adonai) ANTES DE CONFIAR.      │
-- │ Lista NÃO-EXAUSTIVA de interações clássicas de alta gravidade. A ausência  │
-- │ de alerta NÃO significa ausência de interação. Não substitui a checagem    │
-- │ oficial do MEMED nem a bula/fonte primária. A decisão é sempre do médico.  │
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- Como funciona: `medicamento_dicionario` mapeia texto livre de medicamento
-- (ex.: "Sertralina 50mg") para um genérico canônico + classe terapêutica via
-- substring de sinônimos (tokens normalizados: minúsculo, sem acento). O
-- `interacao_catalogo` lista pares (genérico ou classe) com severidade. O gateway
-- cruza os medicamentos prescritos contra a base e reporta interação/duplicidade.
-- Aplicar: psql $POSTGRES_DSN_URL -f infra/migrations/0029_interacao_catalogo.sql

-- ─── Dicionário canônico de medicamentos (genérico + classe + sinônimos) ─────
CREATE TABLE IF NOT EXISTS medicamento_dicionario (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    generico        TEXT NOT NULL,                    -- token canônico (norm.)
    classe          TEXT NOT NULL,                    -- classe terapêutica (norm.)
    sinonimos       TEXT[] NOT NULL DEFAULT '{}',     -- substrings p/ casar no texto livre (norm.)
    catalogo_versao TEXT NOT NULL,
    ativo           BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS medicamento_dicionario_generico_idx ON medicamento_dicionario(generico) WHERE ativo;
CREATE INDEX IF NOT EXISTS medicamento_dicionario_classe_idx   ON medicamento_dicionario(classe) WHERE ativo;

-- ─── Catálogo de interações (par de chaves genérico|classe + severidade) ─────
CREATE TABLE IF NOT EXISTS interacao_catalogo (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chave_a         TEXT NOT NULL,        -- genérico OU classe (norm.)
    tipo_a          TEXT NOT NULL,        -- 'generico' | 'classe'
    chave_b         TEXT NOT NULL,
    tipo_b          TEXT NOT NULL,
    severidade      TEXT NOT NULL,        -- 'grave' | 'moderada'
    mecanismo       TEXT NOT NULL,        -- factual, curto
    recomendacao    TEXT NOT NULL,        -- factual; NUNCA dose/conduta
    fonte           TEXT NOT NULL,
    catalogo_versao TEXT NOT NULL,
    ativo           BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS interacao_catalogo_a_idx ON interacao_catalogo(chave_a) WHERE ativo;
CREATE INDEX IF NOT EXISTS interacao_catalogo_b_idx ON interacao_catalogo(chave_b) WHERE ativo;

-- Seed idempotente: só insere se a tabela estiver vazia (não duplica em re-run,
-- não sobrescreve edições clínicas posteriores).
DO $seed$
BEGIN
IF NOT EXISTS (SELECT 1 FROM medicamento_dicionario) THEN
  INSERT INTO medicamento_dicionario (generico, classe, sinonimos, catalogo_versao) VALUES
    -- ISRS
    ('fluoxetina','isrs','{fluoxetina,prozac,daforin}','A5-2026.06-draft'),
    ('sertralina','isrs','{sertralina,zoloft,assert}','A5-2026.06-draft'),
    ('paroxetina','isrs','{paroxetina,aropax,pondera}','A5-2026.06-draft'),
    ('citalopram','isrs','{citalopram,cipramil}','A5-2026.06-draft'),
    ('escitalopram','isrs','{escitalopram,lexapro,reconter}','A5-2026.06-draft'),
    ('fluvoxamina','isrs','{fluvoxamina,luvox}','A5-2026.06-draft'),
    -- IRSN
    ('venlafaxina','irsn','{venlafaxina,efexor,venlift}','A5-2026.06-draft'),
    ('desvenlafaxina','irsn','{desvenlafaxina,pristiq,zinov}','A5-2026.06-draft'),
    ('duloxetina','irsn','{duloxetina,cymbalta,velija}','A5-2026.06-draft'),
    -- Tricíclicos
    ('amitriptilina','adt','{amitriptilina,amytril,tryptanol}','A5-2026.06-draft'),
    ('nortriptilina','adt','{nortriptilina,pamelor}','A5-2026.06-draft'),
    ('clomipramina','adt','{clomipramina,anafranil}','A5-2026.06-draft'),
    ('imipramina','adt','{imipramina,tofranil}','A5-2026.06-draft'),
    -- IMAO
    ('tranilcipromina','imao','{tranilcipromina,parnate}','A5-2026.06-draft'),
    ('fenelzina','imao','{fenelzina,nardil}','A5-2026.06-draft'),
    ('moclobemida','imao','{moclobemida,aurorix}','A5-2026.06-draft'),
    ('selegilina','imao','{selegilina,niar,jumexil}','A5-2026.06-draft'),
    -- Outros antidepressivos
    ('bupropiona','antidepressivo_outro','{bupropiona,wellbutrin,zyban,bup}','A5-2026.06-draft'),
    ('mirtazapina','antidepressivo_outro','{mirtazapina,remeron}','A5-2026.06-draft'),
    ('trazodona','antidepressivo_outro','{trazodona,donaren}','A5-2026.06-draft'),
    -- Antipsicóticos
    ('haloperidol','antipsicotico','{haloperidol,haldol}','A5-2026.06-draft'),
    ('clorpromazina','antipsicotico','{clorpromazina,amplictil}','A5-2026.06-draft'),
    ('risperidona','antipsicotico','{risperidona,risperdal}','A5-2026.06-draft'),
    ('olanzapina','antipsicotico','{olanzapina,zyprexa}','A5-2026.06-draft'),
    ('quetiapina','antipsicotico','{quetiapina,seroquel}','A5-2026.06-draft'),
    ('aripiprazol','antipsicotico','{aripiprazol,abilify}','A5-2026.06-draft'),
    ('ziprasidona','antipsicotico','{ziprasidona,geodon}','A5-2026.06-draft'),
    ('clozapina','clozapina','{clozapina,leponex}','A5-2026.06-draft'),
    -- Estabilizadores do humor / anticonvulsivantes
    ('litio','litio','{litio,carbolitium,carbonato de litio}','A5-2026.06-draft'),
    ('valproato','valproato','{valproato,acido valproico,divalproato,valproico,depakene,depakote}','A5-2026.06-draft'),
    ('carbamazepina','carbamazepina','{carbamazepina,tegretol}','A5-2026.06-draft'),
    ('lamotrigina','lamotrigina','{lamotrigina,lamictal}','A5-2026.06-draft'),
    -- Benzodiazepínicos / Z-drugs
    ('diazepam','benzodiazepinico','{diazepam,valium}','A5-2026.06-draft'),
    ('clonazepam','benzodiazepinico','{clonazepam,rivotril}','A5-2026.06-draft'),
    ('alprazolam','benzodiazepinico','{alprazolam,frontal}','A5-2026.06-draft'),
    ('lorazepam','benzodiazepinico','{lorazepam,lorax}','A5-2026.06-draft'),
    ('bromazepam','benzodiazepinico','{bromazepam,lexotan}','A5-2026.06-draft'),
    -- Opioides (interação serotoninérgica/depressão respiratória)
    ('tramadol','opioide','{tramadol,tramal}','A5-2026.06-draft'),
    ('codeina','opioide','{codeina}','A5-2026.06-draft'),
    ('metadona','opioide','{metadona,mytedom}','A5-2026.06-draft'),
    -- Triptanos
    ('sumatriptana','triptano','{sumatriptana,sumax,imigran}','A5-2026.06-draft'),
    ('rizatriptana','triptano','{rizatriptana,maxalt}','A5-2026.06-draft'),
    -- Antibiótico com ação IMAO
    ('linezolida','imao','{linezolida,zyvox}','A5-2026.06-draft'),
    -- Não-psicotrópicos relevantes para interação com lítio / sangramento
    ('ibuprofeno','aine','{ibuprofeno,advil,alivium}','A5-2026.06-draft'),
    ('naproxeno','aine','{naproxeno,flanax}','A5-2026.06-draft'),
    ('diclofenaco','aine','{diclofenaco,voltaren,cataflam}','A5-2026.06-draft'),
    ('hidroclorotiazida','tiazidico','{hidroclorotiazida,clorana}','A5-2026.06-draft'),
    ('enalapril','ieca','{enalapril,renitec}','A5-2026.06-draft'),
    ('losartana','bra','{losartana,cozaar}','A5-2026.06-draft'),
    ('varfarina','anticoagulante','{varfarina,warfarina,marevan}','A5-2026.06-draft');
END IF;

IF NOT EXISTS (SELECT 1 FROM interacao_catalogo) THEN
  INSERT INTO interacao_catalogo (chave_a,tipo_a,chave_b,tipo_b,severidade,mecanismo,recomendacao,fonte,catalogo_versao) VALUES
    -- Síndrome serotoninérgica (IMAO é o eixo de maior gravidade)
    ('imao','classe','isrs','classe','grave','Risco de síndrome serotoninérgica.','Combinação classicamente contraindicada; respeitar washout. Conferir no MEMED/bula.','Bula ANVISA; literatura psicofarmacológica','A5-2026.06-draft'),
    ('imao','classe','irsn','classe','grave','Risco de síndrome serotoninérgica.','Combinação classicamente contraindicada; respeitar washout.','Bula ANVISA','A5-2026.06-draft'),
    ('imao','classe','adt','classe','grave','Risco de síndrome serotoninérgica e crise hipertensiva.','Combinação classicamente contraindicada.','Bula ANVISA','A5-2026.06-draft'),
    ('imao','classe','opioide','classe','grave','Risco serotoninérgico (tramadol/meperidina) e instabilidade autonômica.','Evitar; rever opioide alternativo.','Bula ANVISA','A5-2026.06-draft'),
    ('imao','classe','bupropiona','generico','grave','Risco de crise hipertensiva.','Combinação contraindicada; respeitar washout.','Bula ANVISA','A5-2026.06-draft'),
    ('imao','classe','triptano','classe','grave','Risco serotoninérgico.','Evitar combinação.','Bula ANVISA','A5-2026.06-draft'),
    -- Serotoninérgico (moderado) — ISRS/IRSN com outros serotoninérgicos
    ('isrs','classe','tramadol','generico','moderada','Risco serotoninérgico e redução do limiar convulsivo.','Atenção a sinais de síndrome serotoninérgica.','Literatura psicofarmacológica','A5-2026.06-draft'),
    ('irsn','classe','tramadol','generico','moderada','Risco serotoninérgico e redução do limiar convulsivo.','Atenção a sinais de síndrome serotoninérgica.','Literatura psicofarmacológica','A5-2026.06-draft'),
    ('isrs','classe','triptano','classe','moderada','Risco serotoninérgico.','Monitorar sinais serotoninérgicos.','Literatura psicofarmacológica','A5-2026.06-draft'),
    ('linezolida','generico','isrs','classe','grave','Linezolida tem ação IMAO — risco serotoninérgico.','Evitar; respeitar washout.','Bula ANVISA','A5-2026.06-draft'),
    -- Sangramento
    ('isrs','classe','anticoagulante','classe','moderada','Risco aumentado de sangramento.','Vigiar sinais de sangramento.','Literatura','A5-2026.06-draft'),
    -- Lítio
    ('litio','generico','aine','classe','grave','AINEs reduzem clearance renal do lítio — risco de toxicidade.','Evitar uso concomitante; vigiar litemia.','Bula ANVISA','A5-2026.06-draft'),
    ('litio','generico','tiazidico','classe','grave','Tiazídicos elevam a litemia — risco de toxicidade.','Evitar/vigiar litemia de perto.','Bula ANVISA','A5-2026.06-draft'),
    ('litio','generico','ieca','classe','moderada','IECA pode elevar a litemia.','Vigiar litemia.','Bula ANVISA','A5-2026.06-draft'),
    ('litio','generico','bra','classe','moderada','BRA pode elevar a litemia.','Vigiar litemia.','Bula ANVISA','A5-2026.06-draft'),
    -- Clozapina (medula óssea / sedação)
    ('clozapina','generico','carbamazepina','generico','grave','Soma de risco de mielossupressão/agranulocitose.','Combinação a evitar; vigiar hemograma.','Bula ANVISA','A5-2026.06-draft'),
    ('clozapina','generico','benzodiazepinico','classe','moderada','Risco de sedação intensa/depressão respiratória.','Atenção, sobretudo no início.','Bula ANVISA','A5-2026.06-draft'),
    -- Lamotrigina x valproato (níveis / rash)
    ('valproato','generico','lamotrigina','generico','grave','Valproato eleva níveis de lamotrigina — risco de exantema grave (SJS).','Titulação lenta da lamotrigina é mandatória; conferir bula.','Bula ANVISA','A5-2026.06-draft'),
    -- Depressão respiratória
    ('benzodiazepinico','classe','opioide','classe','grave','Depressão respiratória aditiva (alerta de tarja).','Evitar combinação; se inevitável, máxima cautela.','FDA boxed warning; bula','A5-2026.06-draft'),
    -- QT
    ('metadona','generico','antipsicotico','classe','moderada','Prolongamento de QT aditivo.','Considerar ECG/QTc.','Literatura','A5-2026.06-draft'),
    -- Limiar convulsivo
    ('bupropiona','generico','tramadol','generico','moderada','Redução aditiva do limiar convulsivo.','Atenção ao risco de convulsão.','Bula ANVISA','A5-2026.06-draft');
END IF;
END
$seed$;
