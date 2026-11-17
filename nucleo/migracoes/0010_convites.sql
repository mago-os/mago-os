-- M1-07: convites e desligamento.
--
-- 1. O convite fica no esquema acesso (link de uso único, o banco guarda só a impressão digital do código).
-- 2. A API das empresas continua sem gravar direto em pessoas e vínculos: convidar, cancelar e desligar passam
--    por funções que conferem a empresa ativa do pedido e as regras (não desligar a si mesmo nem o último
--    administrador). Quem pode chamar cada uma (o administrador, por padrão) é conferido pelo núcleo.
-- 3. Aceitar passa por uma função do login, que confere o código, a validade e a pessoa.
-- Explicado em docs/banco/decisoes.md, seção 15, e na decisão 0015.

-- Up Migration

CREATE TABLE acesso.convites (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  empresa_id uuid NOT NULL REFERENCES public.empresas (id),
  vinculo_id uuid NOT NULL REFERENCES public.vinculos (id) ON DELETE CASCADE,
  pessoa_id uuid NOT NULL REFERENCES public.pessoas (id) ON DELETE CASCADE,
  codigo text NOT NULL UNIQUE,
  convidado_por uuid NOT NULL REFERENCES public.pessoas (id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  usado_em timestamptz,
  cancelado_em timestamptz
);
CREATE INDEX convites_do_vinculo ON acesso.convites (vinculo_id);
CREATE INDEX convites_por_quem ON acesso.convites (convidado_por, criado_em);
COMMENT ON TABLE acesso.convites IS 'Convites para entrar numa empresa. O link vale 7 dias e funciona uma vez só.';
COMMENT ON COLUMN acesso.convites.id IS '[sistema] Identificador do convite (UUID v7).';
COMMENT ON COLUMN acesso.convites.empresa_id IS '[sistema] Empresa do convite.';
COMMENT ON COLUMN acesso.convites.vinculo_id IS '[sistema] Vínculo criado pelo convite (fica "convidado" até aceitar).';
COMMENT ON COLUMN acesso.convites.pessoa_id IS '[sistema] Pessoa convidada.';
COMMENT ON COLUMN acesso.convites.codigo IS '[sensivel] Impressão digital (SHA-256) do código do link. O código em si só existe no e-mail.';
COMMENT ON COLUMN acesso.convites.convidado_por IS '[sistema] Quem convidou.';
COMMENT ON COLUMN acesso.convites.criado_em IS '[sistema] Quando o convite foi enviado.';
COMMENT ON COLUMN acesso.convites.expira_em IS '[sistema] Até quando o link vale.';
COMMENT ON COLUMN acesso.convites.usado_em IS '[sistema] Quando o convite foi aceito.';
COMMENT ON COLUMN acesso.convites.cancelado_em IS '[sistema] Quando o convite foi cancelado ou trocado por um novo.';
GRANT SELECT, INSERT, UPDATE ON acesso.convites TO mago_acesso;

-- Convidar: só para a empresa ativa do pedido. Cria a pessoa se o e-mail ainda não existe (um e-mail é uma pessoa
-- só no sistema inteiro) e o vínculo "convidado". Reconvida quem foi desligado. Recusa quem já está na empresa.
CREATE FUNCTION public.convidar(email_convidado text, nome_convidado text, perfil_convidado text, area_convidada text)
  RETURNS TABLE (pessoa_id uuid, vinculo_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    empresa uuid := public.empresa_ativa();
    pessoa uuid;
    vinculo public.vinculos;
  BEGIN
    IF empresa IS NULL THEN RAISE EXCEPTION 'Convite: sem empresa ativa'; END IF;
    INSERT INTO public.pessoas (nome, email) VALUES (nome_convidado, lower(trim(email_convidado)))
      ON CONFLICT (email) DO NOTHING;
    SELECT id INTO pessoa FROM public.pessoas WHERE email = lower(trim(email_convidado));
    SELECT * INTO vinculo FROM public.vinculos v WHERE v.empresa_id = empresa AND v.pessoa_id = pessoa;
    IF vinculo.id IS NOT NULL AND vinculo.situacao <> 'desligado' THEN
      RAISE EXCEPTION 'Convite: essa pessoa já está na empresa' USING ERRCODE = 'unique_violation';
    END IF;
    IF vinculo.id IS NULL THEN
      INSERT INTO public.vinculos (empresa_id, pessoa_id, perfil, area, situacao)
        VALUES (empresa, pessoa, perfil_convidado, area_convidada, 'convidado') RETURNING * INTO vinculo;
    ELSE
      UPDATE public.vinculos SET perfil = perfil_convidado, area = area_convidada, situacao = 'convidado',
             convidado_em = now(), entrou_em = NULL, desligado_em = NULL
       WHERE id = vinculo.id RETURNING * INTO vinculo;
    END IF;
    RETURN QUERY SELECT pessoa, vinculo.id;
  END
  $$;
COMMENT ON FUNCTION public.convidar(text, text, text, text) IS
  'Convida uma pessoa para a empresa ativa (cria a pessoa se preciso e o vínculo "convidado").';

-- Cancelar um convite ainda não aceito: o vínculo fica "desligado" sem data de entrada.
CREATE FUNCTION public.cancelar_convite(vinculo uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    UPDATE public.vinculos SET situacao = 'desligado', desligado_em = now()
     WHERE id = vinculo AND empresa_id = public.empresa_ativa() AND situacao = 'convidado';
    IF NOT FOUND THEN RAISE EXCEPTION 'Convite: não há convite pendente para essa pessoa nesta empresa'; END IF;
    UPDATE acesso.convites SET cancelado_em = now() WHERE vinculo_id = vinculo AND usado_em IS NULL AND cancelado_em IS NULL;
  END
  $$;
COMMENT ON FUNCTION public.cancelar_convite(uuid) IS 'Cancela o convite pendente de uma pessoa na empresa ativa.';

-- Desligar: o vínculo fica "desligado" na hora (e empresa_ativa() deixa de mostrar a empresa para a pessoa).
-- Ninguém desliga a si mesmo nem o último administrador ativo. Devolve se a pessoa ainda tem outra empresa ativa.
CREATE FUNCTION public.desligar_vinculo(vinculo uuid, quem uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    alvo public.vinculos;
  BEGIN
    SELECT * INTO alvo FROM public.vinculos WHERE id = vinculo AND empresa_id = public.empresa_ativa();
    IF alvo.id IS NULL OR alvo.situacao <> 'ativo' THEN
      RAISE EXCEPTION 'Desligar: essa pessoa não está ativa nesta empresa';
    END IF;
    IF alvo.pessoa_id = quem THEN RAISE EXCEPTION 'Desligar: ninguém desliga a si mesmo'; END IF;
    IF alvo.perfil = 'administrador' AND NOT EXISTS (
         SELECT 1 FROM public.vinculos v WHERE v.empresa_id = alvo.empresa_id AND v.id <> alvo.id
            AND v.perfil = 'administrador' AND v.situacao = 'ativo') THEN
      RAISE EXCEPTION 'Desligar: a empresa não pode ficar sem administrador';
    END IF;
    UPDATE public.vinculos SET situacao = 'desligado', desligado_em = now() WHERE id = alvo.id;
    RETURN EXISTS (SELECT 1 FROM public.vinculos v JOIN public.empresas e ON e.id = v.empresa_id
                    WHERE v.pessoa_id = alvo.pessoa_id AND v.situacao = 'ativo' AND e.situacao = 'ativa');
  END
  $$;
COMMENT ON FUNCTION public.desligar_vinculo(uuid, uuid) IS
  'Desliga uma pessoa da empresa ativa (nem a si mesmo nem o último administrador).';

REVOKE EXECUTE ON FUNCTION public.convidar(text, text, text, text), public.cancelar_convite(uuid),
  public.desligar_vinculo(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convidar(text, text, text, text), public.cancelar_convite(uuid),
  public.desligar_vinculo(uuid, uuid) TO mago_app;

-- Dados do convite para a tela de aceitar (sem login): empresa, quem convidou e se a pessoa já tem como entrar.
-- Abrir o link prova que o e-mail é da pessoa: o e-mail passa a contar como confirmado (o Google exige isso).
CREATE FUNCTION acesso.abrir_convite(codigo_hash text)
  RETURNS TABLE (empresa text, email text, nome text, quem_convidou text, tem_conta boolean, valido boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, acesso, pg_temp
  AS $$
  DECLARE
    c acesso.convites;
  BEGIN
    SELECT * INTO c FROM acesso.convites WHERE codigo = codigo_hash;
    IF c.id IS NULL THEN RETURN; END IF;
    IF c.usado_em IS NULL AND c.cancelado_em IS NULL AND c.expira_em > now() THEN
      UPDATE public.pessoas SET email_verificado = true WHERE id = c.pessoa_id;
    END IF;
    RETURN QUERY
      SELECT e.nome, p.email, p.nome, q.nome,
             EXISTS (SELECT 1 FROM acesso.credenciais cr WHERE cr.pessoa_id = p.id),
             (c.usado_em IS NULL AND c.cancelado_em IS NULL AND c.expira_em > now())
        FROM public.empresas e, public.pessoas p, public.pessoas q
       WHERE e.id = c.empresa_id AND p.id = c.pessoa_id AND q.id = c.convidado_por;
  END
  $$;

-- Aceitar: o código precisa valer e ser da pessoa que aceita. O vínculo fica ativo.
CREATE FUNCTION acesso.aceitar_convite(codigo_hash text, pessoa uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, acesso, pg_temp
  AS $$
  DECLARE
    c acesso.convites;
  BEGIN
    SELECT * INTO c FROM acesso.convites WHERE codigo = codigo_hash FOR UPDATE;
    IF c.id IS NULL OR c.usado_em IS NOT NULL OR c.cancelado_em IS NOT NULL OR c.expira_em <= now() THEN
      RAISE EXCEPTION 'Convite: este link expirou ou já foi usado';
    END IF;
    IF c.pessoa_id <> pessoa THEN RAISE EXCEPTION 'Convite: este convite é de outra pessoa'; END IF;
    UPDATE public.vinculos SET situacao = 'ativo', entrou_em = now()
     WHERE id = c.vinculo_id AND situacao = 'convidado';
    IF NOT FOUND THEN RAISE EXCEPTION 'Convite: o convite foi cancelado'; END IF;
    UPDATE public.pessoas SET email_verificado = true WHERE id = pessoa;
    UPDATE acesso.convites SET usado_em = now() WHERE id = c.id;
    RETURN c.empresa_id;
  END
  $$;

-- Pessoa de um convite válido (para definir a senha de quem ainda não tem conta).
CREATE FUNCTION acesso.pessoa_do_convite(codigo_hash text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = acesso, pg_temp
  AS $$
    SELECT pessoa_id FROM acesso.convites
     WHERE codigo = codigo_hash AND usado_em IS NULL AND cancelado_em IS NULL AND expira_em > now()
  $$;

REVOKE EXECUTE ON FUNCTION acesso.abrir_convite(text), acesso.aceitar_convite(text, uuid),
  acesso.pessoa_do_convite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION acesso.abrir_convite(text), acesso.aceitar_convite(text, uuid),
  acesso.pessoa_do_convite(text) TO mago_acesso;

-- Down Migration

DROP FUNCTION acesso.pessoa_do_convite(text);
DROP FUNCTION acesso.aceitar_convite(text, uuid);
DROP FUNCTION acesso.abrir_convite(text);
DROP FUNCTION public.desligar_vinculo(uuid, uuid);
DROP FUNCTION public.cancelar_convite(uuid);
DROP FUNCTION public.convidar(text, text, text, text);
DROP TABLE acesso.convites;
