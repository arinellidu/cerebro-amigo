-- Migration 0017: colunas de validação de CRM via CFM/Infosimples
-- Persiste resultado da consulta p/ auditoria e recheck futuro.
-- Aplicar: psql $POSTGRES_DSN_URL -f infra/migrations/0017_crm_validacao.sql

ALTER TABLE medicos
  ADD COLUMN IF NOT EXISTS crm_situacao    TEXT,         -- Regular | Cancelado | Suspenso | NaoValidado
  ADD COLUMN IF NOT EXISTS crm_validado_em TIMESTAMPTZ,  -- quando foi consultado
  ADD COLUMN IF NOT EXISTS crm_fonte       TEXT,         -- 'infosimples'
  ADD COLUMN IF NOT EXISTS crm_nome_cfm    TEXT;         -- nome retornado pelo CFM (cross-check)
