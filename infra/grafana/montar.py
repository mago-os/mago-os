#!/usr/bin/env python3
"""
Monta (ou refaz) no Grafana Cloud o que o Mago OS usa (M6-02, docs/operacao/rastreio.md): o ponto de contato do
Telegram do Sandro, a política de avisos, a pasta "Mago OS", o painel "Mago OS" e os três alertas.

Uso, na pasta do repositório (Mac):
  python3 -I infra/grafana/montar.py https://<stack>.grafana.net

Lê do Infisical (staging): GRAFANA_API_TOKEN (conta de serviço Admin) e MAGO_TELEGRAM_TOKEN (o bot de teste, que
manda os alertas). O chat do Sandro vem do vínculo do Telegram dele no banco do teste. Pode rodar de novo: refaz
tudo por cima, sem duplicar. Nenhum valor aparece na tela.
"""
import json, subprocess, sys, urllib.request, urllib.error

if len(sys.argv) != 2 or not sys.argv[1].startswith("https://"):
    sys.exit(__doc__)
G = sys.argv[1].rstrip("/")


def segredo(nome):
    v = subprocess.run(["python3", "-I", "infra/ferramentas/infisical-ler.py", "staging", nome],
                       capture_output=True, text=True).stdout.strip()
    if not v:
        sys.exit(f"Falta {nome} no Infisical (staging).")
    return v


tok = segredo("GRAFANA_API_TOKEN")


def api2(m, c, b=None):
    r = urllib.request.Request(G + c, method=m, data=json.dumps(b).encode() if b is not None else None,
                               headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json",
                                        "Accept": "application/json", "X-Disable-Provenance": "true"})
    try:
        with urllib.request.urlopen(r, timeout=60) as x:
            return x.status, json.loads(x.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400]


api = api2
bot = segredo("MAGO_TELEGRAM_TOKEN")
chat=subprocess.run(["ssh","mago-vps02","sudo docker exec mago-os-db-1 psql -U mago -d mago -Atc \"select v.chat_id from vinculos_do_telegram v join pessoas p on p.id=v.pessoa_id where p.email='nlk.osmago77@gmail.com' limit 1\""],capture_output=True,text=True).stdout.strip().splitlines()[-1]
assert bot and chat.lstrip("-").isdigit()
NOME="Telegram do Sandro"
st,cps=api("GET","/api/v1/provisioning/contact-points")
existente=[c for c in cps if c["name"]==NOME]
cp={"name":NOME,"type":"telegram","settings":{"bottoken":bot,"chatid":chat,"parse_mode":"None",
    "message":"{{ range .Alerts.Firing }}Mago OS (teste): {{ .Annotations.summary }}\n{{ .Annotations.description }}\n{{ end }}{{ range .Alerts.Resolved }}Mago OS (teste): resolvido: {{ .Annotations.summary }}\n{{ end }}"},
    "disableResolveMessage":False}
if existente: print("cp", api2("PUT","/api/v1/provisioning/contact-points/"+existente[0]["uid"],cp)[0])
else: print("cp", api2("POST","/api/v1/provisioning/contact-points",cp)[0])
st,pol=api("GET","/api/v1/provisioning/policies")
pol["receiver"]=NOME; pol["group_by"]=["alertname"]; pol["group_wait"]="30s"; pol["group_interval"]="5m"; pol["repeat_interval"]="4h"
print("pol", api2("PUT","/api/v1/provisioning/policies",pol)[0])
st,f=api("GET","/api/folders")
pasta=[x for x in f if x["title"]=="Mago OS"]
uid=pasta[0]["uid"] if pasta else api("POST","/api/folders",{"title":"Mago OS"})[1]["uid"]
print("pasta",uid)
LOKI={"type":"loki","uid":"grafanacloud-logs"}; TEMPO={"type":"tempo","uid":"grafanacloud-traces"}
BASE='{service_name="mago-os-nucleo", deployment_environment="$ambiente"}'
def ts(id,titulo,expr,x,y,w=12,h=8,legenda="{{nivel}}"):
    return {"id":id,"type":"timeseries","title":titulo,"datasource":LOKI,"gridPos":{"x":x,"y":y,"w":w,"h":h},
            "targets":[{"refId":"A","datasource":LOKI,"expr":expr,"legendFormat":legenda,"queryType":"range"}],
            "fieldConfig":{"defaults":{"custom":{"drawStyle":"bars","fillOpacity":60},"unit":"short"},"overrides":[]},"options":{"legend":{"displayMode":"list","placement":"bottom"}}}
painel={"title":"Mago OS","uid":"mago-os","timezone":"browser","refresh":"1m","time":{"from":"now-24h","to":"now"},"tags":["mago-os"],
  "templating":{"list":[{"name":"ambiente","type":"custom","query":"teste,producao","current":{"text":"teste","value":"teste"},"options":[{"text":"teste","value":"teste","selected":True},{"text":"producao","value":"producao","selected":False}]}]},
  "panels":[
    ts(1,"Erros por hora",f'sum by (nivel) (count_over_time({BASE} | nivel=~"error|fatal" [1h]))',0,0),
    ts(2,"Pedidos por hora (e quantos falharam)",f'sum by (res_statusCode) (count_over_time({BASE} | res_statusCode=~".+" [1h]))',12,0,legenda="{{res_statusCode}}"),
    {"id":3,"type":"table","title":"Pedidos mais lentos (acima de 1 segundo)","datasource":TEMPO,"gridPos":{"x":0,"y":8,"w":24,"h":9},
     "targets":[{"refId":"A","datasource":TEMPO,"queryType":"traceql","query":'{ resource.service.name = "mago-os-nucleo" && resource.deployment.environment = "$ambiente" && kind = server && duration > 1s }',"limit":20,"tableType":"traces"}]},
    ts(4,"Fila parada: execuções esquecidas e tarefas devolvidas por agente sem sinal",f'sum by (evento) (count_over_time({BASE} | evento=~"agentes_internos.esquecidas|agente.sem_sinal" [1h]))',0,17,legenda="{{evento}}"),
    ts(5,"Agentes com erro (erro na ferramenta ou na execução)",f'sum(count_over_time({BASE} |~ "Agente interno|MCP: erro" | nivel=~"error|warn" [1h]))',12,17,legenda="erros"),
    {"id":6,"type":"logs","title":"Últimos erros (abra o número de rastreio para ver o caminho)","datasource":LOKI,"gridPos":{"x":0,"y":25,"w":24,"h":10},
     "targets":[{"refId":"A","datasource":LOKI,"expr":f'{BASE} | nivel=~"error|fatal"',"queryType":"range"}],"options":{"showTime":True,"wrapLogMessage":True,"enableLogDetails":True,"sortOrder":"Descending"}},
  ],"schemaVersion":39}
st,r=api2("POST","/api/dashboards/db",{"dashboard":painel,"folderUid":uid,"overwrite":True,"message":"M6-02"})
print("painel", st, G + r.get("url", "") if st == 200 else r)
def regra(titulo,expr,limite,resumo,descricao,painel_id):
    return {"title":titulo,"ruleGroup":"mago-os","folderUID":uid,"noDataState":"OK","execErrState":"OK","for":"0s","condition":"C",
      "data":[{"refId":"A","relativeTimeRange":{"from":600,"to":0},"datasourceUid":"grafanacloud-logs","model":{"refId":"A","expr":expr,"queryType":"instant","instant":True}},
              {"refId":"B","datasourceUid":"__expr__","relativeTimeRange":{"from":0,"to":0},"model":{"refId":"B","type":"reduce","expression":"A","reducer":"last","settings":{"mode":"replaceNN","replaceWithValue":0}}},
              {"refId":"C","datasourceUid":"__expr__","relativeTimeRange":{"from":0,"to":0},"model":{"refId":"C","type":"threshold","expression":"B","conditions":[{"evaluator":{"type":"gt","params":[limite]}}]}}],
      "annotations":{"summary":resumo,"description":descricao,"__dashboardUid__":"mago-os","__panelId__":str(painel_id)},"labels":{"sistema":"mago-os","ambiente":"teste"}}
B2='{service_name="mago-os-nucleo", deployment_environment="teste"}'
regras=[
  regra("Mago OS: erros acima do limite",f'sum(count_over_time({B2} | nivel=~"error|fatal" [10m]))',10,"mais de 10 erros nos últimos 10 minutos","Abra o painel Mago OS no Grafana, veja qual rota ou trabalho falha e siga um número de rastreio (docs/operacao/rastreio.md).",1),
  regra("Mago OS: fila parada",f'sum(count_over_time({B2} | evento="agentes_internos.esquecidas" [10m]))',0,"execuções dos agentes ficaram paradas na fila","Confira se a API está no ar (/api/saude) e os registros da fila; se ela travou, publicar.sh forcar (docs/operacao/rastreio.md).",4),
  regra("Mago OS: agentes com erro",f'sum(count_over_time({B2} |~ "Agente interno|MCP: erro" | nivel="error" [10m]))',3,"mais de 3 erros de agentes nos últimos 10 minutos","Abra a execução do agente e veja o passo que falhou; conta de IA sem crédito ou chave trocada é o mais comum.",5),
]
st,existentes=api("GET","/api/v1/provisioning/alert-rules")
for rg in regras:
    e=[x for x in existentes if x["title"]==rg["title"]]
    if e: print("alerta", rg["title"], api2("PUT","/api/v1/provisioning/alert-rules/"+e[0]["uid"],rg)[0])
    else: print("alerta", rg["title"], api2("POST","/api/v1/provisioning/alert-rules",rg)[0])
print("grupo",api2("PUT",f"/api/v1/provisioning/folder/{uid}/rule-groups/mago-os",{"title":"mago-os","folderUid":uid,"interval":60,"rules":[x for x in api("GET","/api/v1/provisioning/alert-rules")[1] if x.get("ruleGroup")=="mago-os"]})[0])
