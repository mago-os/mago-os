-- M1-10: o Dono da plataforma muda o piso de segurança pela tela, e o app sabe quem é Dono.
-- O login (mago_acesso) não lê papéis nem regras direto: usa estas funções, que conferem quem pede.

-- Up Migration

CREATE FUNCTION acesso.e_dono_da_plataforma(pessoa uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT EXISTS (SELECT 1 FROM public.papeis_plataforma WHERE pessoa_id = pessoa AND papel = 'dono') $$;
COMMENT ON FUNCTION acesso.e_dono_da_plataforma(uuid) IS 'Se a pessoa é Dona da plataforma.';

CREATE FUNCTION acesso.regras_da_plataforma_para(pessoa uuid) RETURNS TABLE (exigir_passkey_administradores boolean)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = acesso, pg_temp
  AS $$
  BEGIN
    IF NOT acesso.e_dono_da_plataforma(pessoa) THEN
      RAISE EXCEPTION 'Só o Dono da plataforma vê as regras da plataforma';
    END IF;
    RETURN QUERY SELECT r.exigir_passkey_administradores FROM acesso.regras_da_plataforma r;
  END
  $$;
COMMENT ON FUNCTION acesso.regras_da_plataforma_para(uuid) IS 'Regras da plataforma, só para o Dono.';

CREATE FUNCTION acesso.mudar_regras_da_plataforma(pessoa uuid, passkey_administradores boolean) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = acesso, pg_temp
  AS $$
  BEGIN
    IF NOT acesso.e_dono_da_plataforma(pessoa) THEN
      RAISE EXCEPTION 'Só o Dono da plataforma muda as regras da plataforma';
    END IF;
    UPDATE acesso.regras_da_plataforma SET exigir_passkey_administradores = passkey_administradores;
  END
  $$;
COMMENT ON FUNCTION acesso.mudar_regras_da_plataforma(uuid, boolean) IS 'Muda o piso da plataforma, só pelo Dono.';

REVOKE EXECUTE ON FUNCTION acesso.e_dono_da_plataforma(uuid), acesso.regras_da_plataforma_para(uuid),
  acesso.mudar_regras_da_plataforma(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION acesso.e_dono_da_plataforma(uuid), acesso.regras_da_plataforma_para(uuid),
  acesso.mudar_regras_da_plataforma(uuid, boolean) TO mago_acesso;

-- Down Migration

DROP FUNCTION acesso.mudar_regras_da_plataforma(uuid, boolean);
DROP FUNCTION acesso.regras_da_plataforma_para(uuid);
DROP FUNCTION acesso.e_dono_da_plataforma(uuid);
