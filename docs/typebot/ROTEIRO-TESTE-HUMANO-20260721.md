# Doctor Prescreve — Preparação do próximo teste humano (2026-07-21)

Documento de apoio para o teste humano. **Este documento não executa o teste** — só prepara o terreno (sessão limpa, logs disponíveis, roteiro e checklist). Ver `ESTADO-CONSOLIDADO-STAGING-20260721.md` para o que já foi corrigido e validado antes deste teste.

---

## Ambiente

| Item | Valor |
|---|---|
| Paciente (número de teste) | `+55 11 99169-0401` |
| Meta Cloud API (número que recebe) | `+55 11 94570-4946` |
| Backend staging | `https://mdoctor-backend-staging-staging.up.railway.app` |
| Serviço Railway | `mdoctor-backend-staging` (projeto `Backend-Mdoctor`, environment `staging`) |
| Typebot oficial | `doctor-prescreve-8rmljgu` (interno `higij2z0xihxxkr378rmljgu`), publicado `2026-07-21T10:50:37.637Z` |
| Deploy backend ativo | `63ba32f2` (commit `4e0b623`) |

## Sessão do número de teste

- **Confirmado limpo em 2026-07-21**: `whatsapp_sessions` para `+5511991690401` → **0 linhas**. Nenhuma sessão Typebot, pagamento, upload ou suporte residual.
- Nenhuma limpeza foi necessária nem executada.
- **Não apagar** pacientes, pagamentos ou atendimentos de outros números/testes — nenhuma ação de limpeza foi feita fora do número de teste acima.
- Se, no momento do teste, o número não estiver mais limpo (por outro teste técnico rodado entre esta preparação e o teste humano), verificar novamente antes de começar.

## Logs disponíveis

Confirmado em 2026-07-21 que os logs do staging estão acessíveis e atualizados em tempo real:
```
railway logs -s mdoctor-backend-staging --since 8s
railway logs -s mdoctor-backend-staging --http --since 8s
```
Evento real do Meta confirmado no log (`facebookexternalua`, `POST /api/whatsapp/webhook`, `status=200`) minutos antes desta preparação — pipeline de log está vivo.

---

## Roteiro mínimo do fluxo completo

1. Iniciar pelo WhatsApp (paciente envia "Oi" para `+55 11 94570-4946`, escolhe iniciar atendimento).
2. Abrir os documentos jurídicos (LGPD, Privacidade, Telemedicina, Aviso de não urgência, Termos de uso) — todos devem aparecer como link clicável, sem URL bruta.
3. Aceitar os consentimentos (LGPD, telemedicina/não urgência, termos de uso).
4. Preencher dados pessoais (nome, CPF, e-mail, data de nascimento, endereço completo — rua, número, bairro, cidade e UF).
5. Selecionar a condição clínica.
6. Informar 1 a 3 medicamentos (nome, dose, frequência, via).
7. Confirmar o resumo (condição, medicamentos, CPF mascarado, demais dados).
8. Realizar o pagamento (Stripe Checkout).
9. Enviar a receita anterior diretamente no WhatsApp (foto/PDF).
10. Verificar a retomada automática do Typebot após o envio da mídia (sem precisar clicar em nada).
11. Confirmar a criação do atendimento (status e vínculo da mídia).
12. Verificar a entrada na fila médica.
13. Conferir os dados no painel.

## Checklist — o que conferir no WhatsApp

- [ ] Menu inicial responde corretamente a "Oi".
- [ ] Documentos jurídicos aparecem como `📄 nome clicável`, nunca como URL crua.
- [ ] Pergunta de endereço pede explicitamente "rua, número, bairro, cidade e UF".
- [ ] Endereço com cidade+UF sem vírgula (ex. "São Paulo SP") é aceito sem loop.
- [ ] Resumo final mostra condição e medicamentos preenchidos (não vazio).
- [ ] CPF no resumo aparece mascarado (`123.***.***-09`).
- [ ] Pagamento Stripe conclui e o bot segue o fluxo.
- [ ] Após enviar a foto da receita, o bot **retoma sozinho**, sem exigir clique em "Conferir novamente"/"Já enviei" (esses botões não devem mais aparecer).
- [ ] Se, por qualquer motivo, não houver upload pendente no momento do envio da mídia, o paciente recebe uma mensagem explicativa (não silêncio).

## Checklist — o que conferir no painel

- [ ] Atendimento aparece na fila médica (status `waiting`).
- [ ] Pagamento consta como confirmado.
- [ ] Receita anterior está vinculada e visível no prontuário.
- [ ] Condição clínica preenchida.
- [ ] Medicamentos com dose, frequência e via preenchidos (intervalo "a cada X horas" **não** aparece — ressalva conhecida, não é falha do teste).
- [ ] CPF aparece completo (sem máscara) no prontuário.
- [ ] Nenhuma duplicidade de atendimento para o mesmo paciente.
- [ ] Nenhum vínculo cruzado com outro paciente.

---

## Conclusão

**PRONTO PARA TESTE HUMANO.** Nenhum bloqueio identificado na preparação. Este documento não executa o teste — a condução fica a critério do usuário.
