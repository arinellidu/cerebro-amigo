-- Dados exclusivamente fictícios para o ambiente público de portfólio.
-- Não contém diagnóstico, recomendação clínica nem instrumentos validados.

-- Mantém a conta demo sincronizada com o segredo gerenciado no Key Vault.
-- O valor é recebido como variável do psql e nunca é persistido em texto puro.
UPDATE usuarios
   SET senha_hash = crypt(:'demo_login_password', gen_salt('bf', 12)),
       token_version = token_version + 1
 WHERE email = 'portfolio@cerebroamigo.com'
   AND senha_hash <> crypt(:'demo_login_password', senha_hash);

DO $$
DECLARE
  medico_id UUID;
  p1_id UUID := '10000000-0000-4000-8000-000000000001';
  p2_id UUID := '10000000-0000-4000-8000-000000000002';
  p3_id UUID := '10000000-0000-4000-8000-000000000003';
  d INT;
BEGIN
  SELECT m.id
    INTO medico_id
    FROM medicos m
    JOIN usuarios u ON u.id = m.usuario_id
   WHERE u.email = 'portfolio@cerebroamigo.com';

  IF medico_id IS NULL THEN
    RAISE EXCEPTION 'Usuário fictício de portfólio não encontrado.';
  END IF;

  INSERT INTO clientes (id, nome, email, contexto) VALUES
    (p1_id, 'Paciente Demo Aurora', 'aurora@demo.invalid', '{"portfolio":true}'::jsonb),
    (p2_id, 'Paciente Demo Bento', 'bento@demo.invalid', '{"portfolio":true}'::jsonb),
    (p3_id, 'Paciente Demo Clara', 'clara@demo.invalid', '{"portfolio":true}'::jsonb)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO pacientes
    (cliente_id, medico_responsavel_id, cpf, data_nascimento, consentimento_lgpd_em)
  VALUES
    (p1_id, medico_id, NULL, '1990-01-15', NOW() - INTERVAL '90 days'),
    (p2_id, medico_id, NULL, '1985-06-22', NOW() - INTERVAL '60 days'),
    (p3_id, medico_id, NULL, '1995-11-08', NOW() - INTERVAL '30 days')
  ON CONFLICT (cliente_id) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM sintomas WHERE paciente_id = p1_id) THEN
    FOR d IN SELECT generate_series(0, 42, 3) LOOP
      INSERT INTO sintomas
        (paciente_id, humor, ansiedade, sono_horas, energia, nota, registrado_em)
      VALUES
        (p1_id, 5 + (d / 15), 7 - (d / 18), 6.0 + (d::numeric / 70),
         4 + (d / 18), 'Registro sintético de demonstração.',
         NOW() - INTERVAL '45 days' + (d || ' days')::interval);
    END LOOP;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM sintomas WHERE paciente_id = p2_id) THEN
    FOR d IN SELECT generate_series(0, 28, 4) LOOP
      INSERT INTO sintomas
        (paciente_id, humor, ansiedade, sono_horas, energia, nota, registrado_em)
      VALUES
        (p2_id, 4 + (d % 3), 5 + ((d / 4) % 3), 6.0 + ((d % 8)::numeric / 10),
         4 + ((d / 4) % 3), 'Registro sintético de demonstração.',
         NOW() - INTERVAL '30 days' + (d || ' days')::interval);
    END LOOP;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM sintomas WHERE paciente_id = p3_id) THEN
    FOR d IN SELECT generate_series(0, 18, 3) LOOP
      INSERT INTO sintomas
        (paciente_id, humor, ansiedade, sono_horas, energia, nota, registrado_em)
      VALUES
        (p3_id, 6, 6 - (d / 12), 6.5, 6,
         'Registro sintético de demonstração.',
         NOW() - INTERVAL '21 days' + (d || ' days')::interval);
    END LOOP;
  END IF;

  INSERT INTO consultas (id, paciente_id, medico_id, inicia_em, modalidade, status, notas)
  VALUES
    ('20000000-0000-4000-8000-000000000001', p1_id, medico_id,
     NOW() + INTERVAL '7 days', 'teleconsulta', 'confirmada', 'Agenda fictícia de portfólio.'),
    ('20000000-0000-4000-8000-000000000002', p2_id, medico_id,
     NOW() + INTERVAL '3 days', 'presencial', 'agendada', 'Agenda fictícia de portfólio.'),
    ('20000000-0000-4000-8000-000000000003', p3_id, medico_id,
     NOW() + INTERVAL '14 days', 'teleconsulta', 'agendada', 'Agenda fictícia de portfólio.')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO insights
    (id, paciente_id, medico_id, agente, titulo, conteudo, severidade, metadata)
  VALUES
    ('30000000-0000-4000-8000-000000000001', p1_id, medico_id,
     'resumo_pre_consulta', 'Resumo descritivo — dados fictícios',
     'Perfil criado apenas para demonstrar a organização temporal de registros. '
     'Todo o conteúdo é sintético e exige revisão humana; não constitui diagnóstico nem orientação clínica.',
     'info', '{"portfolio":true,"synthetic":true}'::jsonb),
    ('30000000-0000-4000-8000-000000000002', p2_id, medico_id,
     'padroes', 'Série temporal sintética disponível',
     'Há registros fictícios suficientes para demonstrar gráficos e filtros do produto. '
     'Nenhuma decisão clínica foi gerada ou sugerida.',
     'info', '{"portfolio":true,"synthetic":true}'::jsonb)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO notificacoes_medico
    (id, medico_id, paciente_id, severidade, tipo, titulo, mensagem, lida)
  VALUES
    ('40000000-0000-4000-8000-000000000001', medico_id, p1_id, 'info',
     'portfolio', 'Consulta fictícia confirmada',
     'Evento administrativo sintético para demonstrar a central de notificações.', FALSE),
    ('40000000-0000-4000-8000-000000000002', medico_id, p2_id, 'info',
     'portfolio', 'Perfil de demonstração atualizado',
     'Evento administrativo sintético; nenhum dado pertence a uma pessoa real.', TRUE)
  ON CONFLICT (id) DO NOTHING;
END
$$;

-- Mantém o acesso autenticado da paciente fictícia Aurora sincronizado com o
-- mesmo segredo gerenciado. O valor em texto puro nunca é persistido.
INSERT INTO pacientes_credenciais
  (paciente_id, email, senha_hash, senha_definida_em, senha_temporaria)
VALUES
  ('10000000-0000-4000-8000-000000000001', 'aurora@demo.invalid',
   crypt(:'demo_login_password', gen_salt('bf', 12)), NOW(), FALSE)
ON CONFLICT (paciente_id) DO NOTHING;

UPDATE pacientes_credenciais
   SET email = 'aurora@demo.invalid',
       senha_hash = CASE
         WHEN senha_hash IS NULL OR senha_hash <> crypt(:'demo_login_password', senha_hash)
           THEN crypt(:'demo_login_password', gen_salt('bf', 12))
         ELSE senha_hash
       END,
       senha_definida_em = CASE
         WHEN senha_hash IS NULL OR senha_hash <> crypt(:'demo_login_password', senha_hash)
           THEN NOW()
         ELSE senha_definida_em
       END,
       senha_temporaria = FALSE,
       falhas_seguidas = 0,
       bloqueado_ate = NULL,
       token_version = token_version + CASE
         WHEN senha_hash IS NULL OR senha_hash <> crypt(:'demo_login_password', senha_hash)
           THEN 1
         ELSE 0
       END
 WHERE paciente_id = '10000000-0000-4000-8000-000000000001';
