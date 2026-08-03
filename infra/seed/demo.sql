-- =============================================================================
-- Cérebro Amigo V3 — Seed de demonstração
-- Pré-requisito: POST /api/v1/seed/primeiro-medico já executado.
-- Idempotente: usa ON CONFLICT DO NOTHING nos inserts de chave única.
-- =============================================================================

DO $$
DECLARE
  medico_id   UUID;
  p1_id       UUID;   -- Maria Fernanda
  p2_id       UUID;   -- João Carlos
  p3_id       UUID;   -- Ana Paula
  presc1_id   UUID := gen_random_uuid();  -- Maria: Escitalopram
  presc2_id   UUID := gen_random_uuid();  -- Maria: Clonazepam SOS
  presc3_id   UUID := gen_random_uuid();  -- João: Lamotrigina manhã+noite
  presc4_id   UUID := gen_random_uuid();  -- João: Quetiapina noite
  presc5_id   UUID := gen_random_uuid();  -- Ana: Venlafaxina
  d            INT;
BEGIN

  -- Pega o primeiro médico cadastrado
  SELECT m.id INTO medico_id FROM medicos m LIMIT 1;
  IF medico_id IS NULL THEN
    RAISE EXCEPTION 'Nenhum médico encontrado. Execute POST /api/v1/seed/primeiro-medico primeiro.';
  END IF;

  -- ===========================================================================
  -- CLIENTES (identidade)
  -- ===========================================================================
  INSERT INTO clientes (id, nome, email) VALUES
    (gen_random_uuid(), 'Maria Fernanda Silva',  'maria.demo@cerebroamigo.com'),
    (gen_random_uuid(), 'João Carlos Oliveira',  'joao.demo@cerebroamigo.com'),
    (gen_random_uuid(), 'Ana Paula Mendes',       'ana.demo@cerebroamigo.com')
  ON CONFLICT (email) DO NOTHING;

  SELECT id INTO p1_id FROM clientes WHERE email = 'maria.demo@cerebroamigo.com';
  SELECT id INTO p2_id FROM clientes WHERE email = 'joao.demo@cerebroamigo.com';
  SELECT id INTO p3_id FROM clientes WHERE email = 'ana.demo@cerebroamigo.com';

  -- ===========================================================================
  -- PACIENTES (vínculo com médico)
  -- ===========================================================================
  INSERT INTO pacientes (cliente_id, medico_responsavel_id, cpf, data_nascimento, consentimento_lgpd_em) VALUES
    (p1_id, medico_id, '123.456.789-01', '1991-03-15', NOW() - INTERVAL '90 days'),
    (p2_id, medico_id, '234.567.890-12', '1980-07-22', NOW() - INTERVAL '180 days'),
    (p3_id, medico_id, '345.678.901-23', '1997-11-08', NOW() - INTERVAL '14 days')
  ON CONFLICT (cliente_id) DO NOTHING;

  -- ===========================================================================
  -- PRESCRIÇÕES
  -- ===========================================================================
  -- Maria: Escitalopram 10mg 1×/dia + Clonazepam SOS
  INSERT INTO prescricoes (id, paciente_id, medico_id, medicamento, dose_descricao, horarios, inicio_em, ativa)
  VALUES
    (presc1_id, p1_id, medico_id, 'Escitalopram', '10 mg — 1×/dia (manhã)',
     ARRAY['08:00']::TIME[], CURRENT_DATE - 60, TRUE),
    (presc2_id, p1_id, medico_id, 'Clonazepam',   '0,5 mg — SOS (máx 1×/dia)',
     ARRAY[]::TIME[], CURRENT_DATE - 60, TRUE);

  -- João: Lamotrigina 100mg 2×/dia + Quetiapina 50mg noite
  INSERT INTO prescricoes (id, paciente_id, medico_id, medicamento, dose_descricao, horarios, inicio_em, ativa)
  VALUES
    (presc3_id, p2_id, medico_id, 'Lamotrigina', '100 mg — 2×/dia (manhã e noite)',
     ARRAY['08:00','20:00']::TIME[], CURRENT_DATE - 120, TRUE),
    (presc4_id, p2_id, medico_id, 'Quetiapina',  '50 mg — 1×/noite',
     ARRAY['22:00']::TIME[], CURRENT_DATE - 120, TRUE);

  -- Ana: Venlafaxina 75mg
  INSERT INTO prescricoes (id, paciente_id, medico_id, medicamento, dose_descricao, horarios, inicio_em, ativa)
  VALUES
    (presc5_id, p3_id, medico_id, 'Venlafaxina', '75 mg — 1×/dia (manhã com alimento)',
     ARRAY['08:00']::TIME[], CURRENT_DATE - 14, TRUE);

  -- ===========================================================================
  -- SINTOMAS — Maria (60 dias, tendência de melhora clara)
  -- humor 3→7, ansiedade 9→5, sono 5,5h→7h, energia 3→6
  -- ===========================================================================
  FOR d IN SELECT generate_series(0, 59, 3) LOOP
    INSERT INTO sintomas (paciente_id, humor, ansiedade, sono_horas, energia, registrado_em)
    VALUES (
      p1_id,
      LEAST(10, GREATEST(1, 3 + floor(d * 0.07 + random() * 1.5)::int)),
      GREATEST(1, 9  - floor(d * 0.06 + random() * 1.5)::int),
      LEAST(10.0, 5.5 + d * 0.025 + random() * 0.5),
      LEAST(10, GREATEST(1, 3 + floor(d * 0.05 + random() * 1.5)::int)),
      NOW() - INTERVAL '60 days' + (d || ' days')::INTERVAL
    );
  END LOOP;

  -- ===========================================================================
  -- SINTOMAS — João (30 dias, oscilação bipolar)
  -- ===========================================================================
  FOR d IN SELECT generate_series(0, 29, 2) LOOP
    INSERT INTO sintomas (paciente_id, humor, ansiedade, sono_horas, energia, registrado_em)
    VALUES (
      p2_id,
      LEAST(10, GREATEST(1, 5 + floor(sin(d * 0.4) * 3)::int + (random() * 2 - 1)::int)),
      LEAST(10, GREATEST(1, 5 + floor(cos(d * 0.3) * 3)::int + (random() * 2 - 1)::int)),
      LEAST(12.0, GREATEST(3.0, 6.0 + sin(d * 0.5) * 2.5 + random())),
      LEAST(10, GREATEST(1, 5 + floor(sin(d * 0.6) * 3)::int)),
      NOW() - INTERVAL '30 days' + (d || ' days')::INTERVAL
    );
  END LOOP;

  -- ===========================================================================
  -- SINTOMAS — Ana (14 dias, ansiedade moderada, estável)
  -- ===========================================================================
  FOR d IN SELECT generate_series(0, 13, 2) LOOP
    INSERT INTO sintomas (paciente_id, humor, ansiedade, sono_horas, energia, registrado_em)
    VALUES (
      p3_id,
      LEAST(10, GREATEST(1, 5 + floor(random() * 2)::int)),
      LEAST(10, GREATEST(4, 7 - floor(d * 0.15 + random())::int)),
      6.0 + random() * 1.5,
      LEAST(10, GREATEST(1, 5 + floor(random() * 2)::int)),
      NOW() - INTERVAL '14 days' + (d || ' days')::INTERVAL
    );
  END LOOP;

  -- ===========================================================================
  -- TOMADAS — Maria (adesão ~95%)
  -- ===========================================================================
  FOR d IN SELECT generate_series(0, 59) LOOP
    INSERT INTO tomadas_medicacao
      (prescricao_id, paciente_id, horario_previsto, horario_real, status)
    VALUES (
      presc1_id, p1_id,
      (NOW() - INTERVAL '60 days' + (d || ' days')::INTERVAL)::DATE + TIME '08:00',
      CASE WHEN random() > 0.05
        THEN (NOW() - INTERVAL '60 days' + (d || ' days')::INTERVAL)::DATE
             + TIME '08:00'
             + ((floor(random() * 30))::text || ' minutes')::INTERVAL
        ELSE NULL END,
      CASE WHEN random() > 0.05 THEN 'tomada' ELSE 'esquecida' END
    );
  END LOOP;

  -- ===========================================================================
  -- TOMADAS — João (adesão ~60%, manhã e noite)
  -- ===========================================================================
  FOR d IN SELECT generate_series(0, 29) LOOP
    -- manhã
    INSERT INTO tomadas_medicacao
      (prescricao_id, paciente_id, horario_previsto, horario_real, status)
    VALUES (
      presc3_id, p2_id,
      (NOW() - INTERVAL '30 days' + (d || ' days')::INTERVAL)::DATE + TIME '08:00',
      CASE WHEN random() > 0.40
        THEN (NOW() - INTERVAL '30 days' + (d || ' days')::INTERVAL)::DATE
             + TIME '08:00'
             + ((floor(random() * 60))::text || ' minutes')::INTERVAL
        ELSE NULL END,
      CASE WHEN random() > 0.40 THEN 'tomada' ELSE 'esquecida' END
    );
    -- noite
    INSERT INTO tomadas_medicacao
      (prescricao_id, paciente_id, horario_previsto, horario_real, status)
    VALUES (
      presc3_id, p2_id,
      (NOW() - INTERVAL '30 days' + (d || ' days')::INTERVAL)::DATE + TIME '20:00',
      CASE WHEN random() > 0.40
        THEN (NOW() - INTERVAL '30 days' + (d || ' days')::INTERVAL)::DATE
             + TIME '20:00'
             + ((floor(random() * 60))::text || ' minutes')::INTERVAL
        ELSE NULL END,
      CASE WHEN random() > 0.40 THEN 'tomada' ELSE 'esquecida' END
    );
  END LOOP;

  -- ===========================================================================
  -- CONSULTAS
  -- ===========================================================================
  INSERT INTO consultas (paciente_id, medico_id, inicia_em, modalidade, status) VALUES
    (p1_id, medico_id, NOW() - INTERVAL '30 days', 'presencial',   'realizada'),
    (p1_id, medico_id, NOW() + INTERVAL '7 days',  'teleconsulta', 'confirmada'),
    (p2_id, medico_id, NOW() - INTERVAL '15 days', 'teleconsulta', 'realizada'),
    (p2_id, medico_id, NOW() + INTERVAL '3 days',  'presencial',   'agendada'),
    (p3_id, medico_id, NOW() - INTERVAL '7 days',  'presencial',   'realizada'),
    (p3_id, medico_id, NOW() + INTERVAL '14 days', 'teleconsulta', 'agendada');

  -- ===========================================================================
  -- INSIGHTS (gerados pelos agentes analíticos)
  -- ===========================================================================
  INSERT INTO insights (paciente_id, medico_id, agente, titulo, conteudo, severidade, criado_em) VALUES
    (p1_id, medico_id, 'padroes',
     'Tendência de melhora sustentada no humor',
     E'Maria apresenta melhora linear nas últimas 6 semanas:\n'
     '• Humor: 3/10 → 7/10 (slope +0,7/semana, p<0,05)\n'
     '• Sono: regularizou de 5,5h para ~7h\n'
     '• Ansiedade: reduziu de 9/10 para 5/10\n\n'
     'Adesão ao Escitalopram: 95%. Resposta consistente com semana 6-8 do tratamento. '
     'Considerar manutenção da dose na próxima consulta.',
     'info', NOW() - INTERVAL '2 days'),

    (p2_id, medico_id, 'adesao',
     'Adesão crítica — Lamotrigina abaixo de 65%',
     E'João tomou 63% das doses de Lamotrigina nos últimos 30 dias:\n'
     '• 3 sequências de ≥2 dias sem tomar\n'
     '• Última dose: há 2 dias\n'
     '• Taxa na 1ª quinzena: 78% → 2ª quinzena: 48% (queda de 30 p.p.)\n\n'
     'Risco de episódio maníaco por descontinuação abrupta. Ação recomendada: contato imediato.',
     'urgente', NOW() - INTERVAL '1 day'),

    (p2_id, medico_id, 'risco_silencioso',
     'Silêncio atípico — 8 dias sem check-in',
     E'João não respondeu nenhum check-in nos últimos 8 dias.\n'
     '• Linha de base (últimos 6 meses): resposta em até 3 dias (p95)\n'
     '• Multiplicador: 2,7× acima do normal\n'
     '• Últimos registros de humor antes do silêncio: 4/10, 3/10 (humor baixo)\n\n'
     'Combinação de silêncio + humor baixo + baixa adesão configura sinal de risco. '
     'Protocolo de contato ativo recomendado.',
     'critico', NOW() - INTERVAL '12 hours'),

    (p3_id, medico_id, 'padroes',
     'Perfil inicial — ansiedade moderada, humor estável',
     E'Ana está na semana 2 de acompanhamento com Venlafaxina 75mg:\n'
     '• Ansiedade média: 6,2/10 (moderada, leve redução nos últimos 4 dias)\n'
     '• Humor estável: 5-6/10\n'
     '• Sono adequado: ~6,5h\n\n'
     'Resposta ao tratamento ainda inconclusiva (semana 2-4 usual para SSRIs/SNRIs). '
     'Próxima avaliação em 14 dias.',
     'info', NOW() - INTERVAL '3 days');

  -- ===========================================================================
  -- NOTIFICAÇÕES AO MÉDICO
  -- ===========================================================================
  INSERT INTO notificacoes_medico
    (medico_id, paciente_id, severidade, tipo, titulo, mensagem, lida, criada_em)
  VALUES
    (medico_id, p2_id, 'critico', 'risco_silencioso',
     'João Carlos — 8 dias sem resposta',
     'Silêncio atípico detectado (2,7× acima da linha de base). '
     'Combinado com humor baixo e adesão crítica. Contato ativo recomendado.',
     FALSE, NOW() - INTERVAL '12 hours'),

    (medico_id, p2_id, 'urgente', 'adesao',
     'Adesão crítica — Lamotrigina (João Carlos)',
     'Taxa de adesão: 63% no último mês. Última dose há 2 dias. '
     'Risco de descontinuação abrupta.',
     FALSE, NOW() - INTERVAL '1 day'),

    (medico_id, p1_id, 'info', 'padroes',
     'Maria Fernanda — melhora documentada',
     'Humor estabilizou em 6-7/10 após 6 semanas de Escitalopram. '
     'Sono regularizou. Consulta agendada em 7 dias.',
     TRUE, NOW() - INTERVAL '2 days');

  RAISE NOTICE 'Seed demo concluído com sucesso.';
  RAISE NOTICE '  Médico:  %', medico_id;
  RAISE NOTICE '  Maria:   %', p1_id;
  RAISE NOTICE '  João:    %', p2_id;
  RAISE NOTICE '  Ana:     %', p3_id;

END $$;
