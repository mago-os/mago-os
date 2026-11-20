# Cofre das contas de IA (M4-01)

As chaves dos provedores de IA de cada empresa ficam cifradas no banco. Para decifrar é preciso a **chave mestra**, que fica só no Infisical e na memória da API. Por que e como: [decisão 0021](../decisoes/0021-cofre-e-contas-de-ia.md).

## Onde fica

| Variável | O que é |
| --- | --- |
| `MAGO_COFRE_CHAVE_MESTRA` | 32 bytes aleatórios em base64. Sem ela (fora do Mac), as contas de IA ficam desligadas e a tela avisa |
| `MAGO_COFRE_VERSAO` | Número da mestra em uso (padrão 1). Sobe a cada troca |
| `MAGO_COFRE_CHAVE_ANTERIOR` | Só durante a troca: a mestra anterior, para decifrar o que ainda não foi cifrado de novo |

No Mac, sem a variável, a API usa uma chave fixa que só vale para dados falsos (aparece um aviso no registro).

**Nunca** perca a chave mestra: sem ela, as chaves de IA guardadas não decifram mais (as empresas teriam de colar as chaves de novo). Ela é um segredo do Infisical como os outros, e o Infisical tem o próprio histórico.

## Ligar num ambiente

No Mac, com a identidade `claude-mac` (ver [segredos.md](segredos.md)):

```bash
openssl rand -base64 32 | python3 -I infra/ferramentas/infisical-gravar.py staging MAGO_COFRE_CHAVE_MESTRA
```

Na VPS02, gerar o `api.env` de novo e publicar:

```bash
sudo /opt/mago-os/bin/segredos.sh && sudo /opt/mago-os/bin/publicar.sh forcar
```

Conferir: em Agentes › Contas de IA, o botão "Conectar" aparece (sem o aviso de "ainda não foram ligadas").

## Trocar a chave mestra

A troca não mexe nas chaves de IA: cada empresa tem a própria chave de dados, e só ela é cifrada de novo, na primeira vez que for usada depois da troca.

1. No Infisical: copiar o valor atual de `MAGO_COFRE_CHAVE_MESTRA` para `MAGO_COFRE_CHAVE_ANTERIOR`, gravar uma mestra nova em `MAGO_COFRE_CHAVE_MESTRA` e somar 1 em `MAGO_COFRE_VERSAO`.
2. Na VPS02: `segredos.sh` e `publicar.sh forcar`.
3. Esperar o uso cifrar tudo de novo, ou testar cada conta pela tela. Conferir que nada ficou na versão antiga:

   ```sql
   select count(*) from chaves_de_dados where versao_da_mestra < (a versão nova);
   ```

4. Com zero, apagar `MAGO_COFRE_CHAVE_ANTERIOR` do Infisical e repetir o passo 2.

## Se algo der errado

- **"As contas de IA ainda não foram ligadas neste servidor":** falta `MAGO_COFRE_CHAVE_MESTRA` no `api.env`. Rodar o `segredos.sh`.
- **A API não sobe com "MAGO_COFRE_CHAVE_MESTRA precisa ter 32 bytes":** o valor no Infisical não é base64 de 32 bytes. Gerar de novo com `openssl rand -base64 32` (só se ainda não houver contas conectadas).
- **"falta a chave mestra da versão N" no registro:** alguém subiu a versão sem pôr a anterior em `MAGO_COFRE_CHAVE_ANTERIOR`. Voltar a versão ou informar a anterior.
