// ==========================================
// 1. CONFIGURAÇÃO FIREBASE & INICIALIZAÇÃO
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyC6syUp-3jbluFqt8ASlUG0wG3gCchVI3k",
  authDomain: "cockpit-glpi.firebaseapp.com",
  projectId: "cockpit-glpi",
  storageBucket: "cockpit-glpi.firebasestorage.app",
  messagingSenderId: "143295599092",
  appId: "1:143295599092:web:d69af318cb98844e0929a1"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const ticketsRef = db.collection("chamados");

const URLS_PADRAO = {
  GLPI: "https://glpi.empresa.com.br/front/ticket.form.php?id=",
  SISPLAN: "https://sisplan.empresa.com.br/chamado?id=",
  SENIOR: "https://senior.empresa.com.br/ticket?id=",
  SGT: "https://sgt.empresa.com.br/solicitacao?id="
};

let isModoLeitor = false;
let unsubscribeAtivos = null;
let unsubscribeConcluidos = null;

const alertasReconhecidos = new Set();
const filaAlertas = [];

// ==========================================
// 2. SANITIZAÇÃO CONTRA XSS E INJEÇÃO
// ==========================================
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ==========================================
// 3. AUTENTICAÇÃO REAL (FIREBASE AUTH)
// ==========================================
auth.onAuthStateChanged(user => {
  if (user) {
    document.getElementById("gate-acesso").style.display = "none";
    isModoLeitor = user.isAnonymous;
    
    const btnNovo = document.getElementById("btn-topo-novo");
    const btnUrls = document.getElementById("btn-config-urls");
    const tagEspectador = document.getElementById("tag-espectador");

    if (isModoLeitor) {
      if (btnNovo) btnNovo.style.display = "none";
      if (btnUrls) btnUrls.style.display = "none";
      if (tagEspectador) tagEspectador.style.display = "block";
    } else {
      if (btnNovo) btnNovo.style.display = "block";
      if (btnUrls) btnUrls.style.display = "block";
      if (tagEspectador) tagEspectador.style.display = "none";
    }

    iniciarSincronizacao();
  } else {
    document.getElementById("gate-acesso").style.display = "flex";
    if (unsubscribeAtivos) unsubscribeAtivos();
    if (unsubscribeConcluidos) unsubscribeConcluidos();
  }
});

function alternarEstadoCarregamento(carregando, tipo) {
  const btnAdmin = document.getElementById("btn-login-auth");
  const btnAnon = document.getElementById("btn-login-anon");
  const inputEmail = document.getElementById("auth-email");
  const inputSenha = document.getElementById("auth-senha");

  btnAdmin.disabled = carregando;
  btnAnon.disabled = carregando;
  inputEmail.disabled = carregando;
  inputSenha.disabled = carregando;

  if (carregando) {
    if (tipo === "admin") {
      btnAdmin.innerHTML = '<span class="spinner-login"></span> Entrando...';
    } else {
      btnAnon.innerHTML = '<span class="spinner-login"></span> Conectando...';
    }
  } else {
    btnAdmin.innerHTML = "Entrar";
    btnAnon.innerHTML = "Acessar como Visualizador";
  }
}

async function realizarLogin() {
  const email = document.getElementById("auth-email").value.trim();
  const senha = document.getElementById("auth-senha").value;
  const msgErro = document.getElementById("msg-erro");
  msgErro.style.display = "none";

  if (!email || !senha) {
    msgErro.textContent = "Preencha e-mail e senha.";
    msgErro.style.display = "block";
    return;
  }

  alternarEstadoCarregamento(true, "admin");

  try {
    await auth.signInWithEmailAndPassword(email, senha);
  } catch (err) {
    msgErro.textContent = "Credenciais inválidas ou erro de conexão.";
    msgErro.style.display = "block";
    alternarEstadoCarregamento(false);
  }
}

async function entrarAnonimo() {
  const msgErro = document.getElementById("msg-erro");
  msgErro.style.display = "none";

  alternarEstadoCarregamento(true, "anon");

  try {
    await auth.signInAnonymously();
  } catch (err) {
    msgErro.textContent = "Acesso de visualizador indisponível no momento.";
    msgErro.style.display = "block";
    alternarEstadoCarregamento(false);
  }
}

async function fazerLogout() {
  await auth.signOut();
}

// ==========================================
// 4. QUERIES DESACOPLADAS
// ==========================================
let chamadosAtivos = [];
let chamadosConcluidos = [];
let filtroSidebar = "todos";
let chamadoSelecionadoId = null;

function iniciarSincronizacao() {
  unsubscribeAtivos = ticketsRef
    .where("status", "==", "ativo")
    .onSnapshot(snapshot => {
      chamadosAtivos = [];
      snapshot.forEach(doc => chamadosAtivos.push({ idDoc: doc.id, ...doc.data() }));
      renderizar();
    }, err => console.error("Erro ativos:", err));

  unsubscribeConcluidos = ticketsRef
    .where("status", "==", "concluido")
    .limit(50)
    .onSnapshot(snapshot => {
      chamadosConcluidos = [];
      snapshot.forEach(doc => chamadosConcluidos.push({ idDoc: doc.id, ...doc.data() }));
      renderizar();
    }, err => console.error("Erro concluídos:", err));
}

// ==========================================
// 5. OPERAÇÕES DE NEGÓCIO E URLs
// ==========================================
function atualizarContador(inputId, contadorId, limite) {
  const el = document.getElementById(inputId);
  const count = document.getElementById(contadorId);
  if (el && count) {
    count.textContent = `${el.value.length} / ${limite}`;
  }
}

function obterUrlBase(sistema) {
  if (!sistema) return "";
  const key = `url_base_${sistema.toLowerCase()}`;
  const salva = localStorage.getItem(key);
  if (salva !== null && salva !== "") return salva;
  return URLS_PADRAO[sistema.toUpperCase()] || "";
}

function abrirConfigUrls() {
  if (isModoLeitor) return;
  
  ["glpi", "sisplan", "senior", "sgt"].forEach(sis => {
    const el = document.getElementById(`url-base-${sis}`);
    if (el) {
      el.value = obterUrlBase(sis);
    }
  });

  const modal = document.getElementById("modal-config-urls");
  if (modal) modal.style.display = "flex";
}

function fecharConfigUrls() {
  const modal = document.getElementById("modal-config-urls");
  if (modal) modal.style.display = "none";
}

function salvarConfigUrls() {
  if (isModoLeitor) return;

  ["glpi", "sisplan", "senior", "sgt"].forEach(sis => {
    const el = document.getElementById(`url-base-${sis}`);
    if (el) {
      localStorage.setItem(`url_base_${sis}`, el.value.trim());
    }
  });

  fecharConfigUrls();
  alert("URLs dos sistemas atualizadas com sucesso!");
  renderizar();
}

function abrirModalNovo() {
  if (isModoLeitor) return;
  const modal = document.getElementById("modal-novo-chamado");
  if (modal) modal.style.display = "flex";
}
function fecharModalNovo() {
  const modal = document.getElementById("modal-novo-chamado");
  if (modal) modal.style.display = "none";
}

function toggleInput(sis) {
  const chk = document.getElementById(`chk-${sis}`);
  const input = document.getElementById(`ticket-${sis}`);
  if (chk && input) {
    input.style.display = chk.checked ? "block" : "none";
    if (!chk.checked) input.value = "";
  }
}

async function adicionarChamado() {
  if (isModoLeitor) return;

  const titulo = document.getElementById("titulo").value.trim();
  const btn = document.getElementById("btn-submit-chamado");
  if (!titulo) return alert("Título obrigatório.");

  const urgencia = document.getElementById("urgencia").value;
  const slaMins = parseInt(document.getElementById("sla").value);
  const descricao = document.getElementById("descricao").value.trim();

  const sistemas = [];
  ["glpi", "sisplan", "senior", "sgt"].forEach(sis => {
    const chk = document.getElementById(`chk-${sis}`);
    if (chk && chk.checked) {
      const val = document.getElementById(`ticket-${sis}`).value.trim();
      if (val) sistemas.push({ nome: sis.toUpperCase(), ticket: val });
    }
  });

  if (sistemas.length === 0) return alert("Selecione ao menos um sistema.");

  btn.disabled = true;
  try {
    await ticketsRef.add({
      titulo,
      urgencia,
      sistemas,
      descricao,
      tramites: [],
      status: "ativo",
      limiteSla: Date.now() + (slaMins * 60 * 1000),
      criadoEmMs: Date.now(),
      criadoEm: new Date().toLocaleString('pt-BR')
    });

    fecharModalNovo();

    if (urgencia === "urgencia-critica") {
      enfileirarAlarme(`🚨 NOVO CHAMADO CRÍTICO CADASTRADO:\n"${titulo}"`);
    }

    document.getElementById("titulo").value = "";
    document.getElementById("descricao").value = "";
  } catch (e) {
    alert("Erro ao salvar chamado: Verifique suas permissões de operador.");
  } finally {
    btn.disabled = false;
  }
}

function abrirModalSla(idDoc) {
  if (isModoLeitor) return;
  chamadoSelecionadoId = idDoc;
  const item = chamadosAtivos.find(c => c.idDoc === idDoc);
  if (!item) return;

  const tempo = checarTempo(item.limiteSla);
  document.getElementById("sla-modal-titulo").textContent = `Chamado: ${item.titulo}`;
  document.getElementById("sla-modal-atual").textContent = `Status SLA Atual: ${tempo.texto}`;
  document.getElementById("sla-justificativa").value = "";
  document.getElementById("modal-ajustar-sla").style.display = "flex";
}

function fecharModalSla() {
  const modal = document.getElementById("modal-ajustar-sla");
  if (modal) modal.style.display = "none";
  chamadoSelecionadoId = null;
}

async function salvarNovoSla() {
  if (isModoLeitor || !chamadoSelecionadoId) return;

  const item = chamadosAtivos.find(c => c.idDoc === chamadoSelecionadoId);
  if (!item) return;

  const opcao = document.getElementById("select-ajuste-sla").value;
  const justificativa = document.getElementById("sla-justificativa").value.trim();
  const btn = document.getElementById("btn-submit-sla");

  const [tipo, valorStr] = opcao.split("_");
  const minutos = parseInt(valorStr);
  let novoLimite = item.limiteSla || Date.now();

  if (tipo === "add") {
    const base = novoLimite < Date.now() ? Date.now() : novoLimite;
    novoLimite = base + (minutos * 60 * 1000);
  } else {
    novoLimite = Date.now() + (minutos * 60 * 1000);
  }

  btn.disabled = true;
  try {
    const textoTramite = `⏱️ SLA alterado: ${tipo === 'add' ? `Prorrogado em +${minutos}m` : `Redefinido para ${minutos}m a partir de agora`}${justificativa ? ` (Motivo: ${justificativa})` : ''}`;

    const novoTramite = {
      dataHora: new Date().toLocaleString('pt-BR'),
      texto: textoTramite
    };

    await ticketsRef.doc(chamadoSelecionadoId).update({
      limiteSla: novoLimite,
      tramites: firebase.firestore.FieldValue.arrayUnion(novoTramite)
    });

    if (novoLimite > Date.now()) {
      alertasReconhecidos.delete(chamadoSelecionadoId);
    }

    fecharModalSla();
  } catch (err) {
    alert("Erro ao alterar SLA: Permissão negada.");
  } finally {
    btn.disabled = false;
  }
}

async function salvarNovoTramite() {
  if (isModoLeitor || !chamadoSelecionadoId) return;

  const texto = document.getElementById("tramite-texto").value.trim();
  const btn = document.getElementById("btn-salvar-tramite");

  if (!texto) return alert("Descreva o andamento.");

  btn.disabled = true;
  try {
    const novoTramite = {
      dataHora: new Date().toLocaleString('pt-BR'),
      texto: texto
    };

    await ticketsRef.doc(chamadoSelecionadoId).update({
      tramites: firebase.firestore.FieldValue.arrayUnion(novoTramite)
    });

    document.getElementById("tramite-texto").value = "";
    fecharModalTramites();
  } catch (err) {
    alert("Erro ao gravar trâmite: Permissão negada para o visualizador.");
  } finally {
    btn.disabled = false;
  }
}

async function concluirChamado(idDoc) {
  if (isModoLeitor) return;
  try {
    await ticketsRef.doc(idDoc).update({
      status: "concluido",
      finalizadoEmMs: Date.now(),
      finalizadoEm: new Date().toLocaleString('pt-BR')
    });
  } catch (e) { alert("Erro ao concluir: Permissão negada."); }
}

async function excluirChamado(idDoc) {
  if (isModoLeitor) return;
  if (confirm("Confirmar exclusão deste chamado no banco?")) {
    try {
      await ticketsRef.doc(idDoc).delete();
    } catch (e) { alert("Erro ao excluir: Permissão negada."); }
  }
}

// ==========================================
// 6. ÁUDIO, ALARME EM FILA & TEMPO
// ==========================================
let audioCtx = null;
let alarmTimer = null;

function emitirSirene() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(850, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(420, audioCtx.currentTime + 0.35);
  gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.35);
}

function enfileirarAlarme(texto) {
  filaAlertas.push(texto);
  if (filaAlertas.length === 1 && document.getElementById("modal-alerta").style.display !== "flex") {
    exibirProximoAlarme();
  }
}

function exibirProximoAlarme() {
  if (filaAlertas.length === 0) {
    document.getElementById("modal-alerta").style.display = "none";
    if (alarmTimer) {
      clearInterval(alarmTimer);
      alarmTimer = null;
    }
    return;
  }

  const proximo = filaAlertas[0];
  document.getElementById("alerta-msg").textContent = proximo;
  document.getElementById("modal-alerta").style.display = "flex";
  
  if (!alarmTimer) {
    emitirSirene();
    alarmTimer = setInterval(emitirSirene, 750);
  }
}

function silenciarAlarme() {
  filaAlertas.shift();
  exibirProximoAlarme();
}

function testarSirene() { enfileirarAlarme("Disparo de teste do alarme sonoro."); }

function solicitarPermissoesNavegador() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  if ("Notification" in window) Notification.requestPermission();
}

function checarTempo(limiteSla) {
  const diff = limiteSla - Date.now();
  if (diff <= 0) {
    const mins = Math.abs(Math.floor(diff / 60000));
    if (mins >= 1440) return { expirado: true, texto: `Estourado há ${Math.floor(mins/1440)}d` };
    if (mins >= 60) return { expirado: true, texto: `Estourado há ${Math.floor(mins/60)}h` };
    return { expirado: true, texto: `Estourado há ${mins}m` };
  }
  
  const dias = Math.floor(diff / (1000 * 60 * 60 * 24));
  const horas = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  let t = "";
  if (dias > 0) t += `${dias}d `;
  if (horas > 0 || dias > 0) t += `${horas}h `;
  t += `${mins}m restantes`;
  return { expirado: false, texto: t.trim() };
}

// ==========================================
// 7. RENDERIZAÇÃO & EVENT DELEGATION
// ==========================================
function renderizar() {
  const lista = document.getElementById("lista-chamados");
  if (!lista) return;
  lista.innerHTML = "";

  const termo = (document.getElementById("filtro-busca")?.value || "").toLowerCase();
  const urgFiltro = document.getElementById("filtro-urgencia")?.value || "todos";

  let countCriticos = 0, countAltos = 0, countTerceiros = 0;
  chamadosAtivos.forEach(c => {
    if (c.urgencia === "urgencia-critica") countCriticos++;
    if (c.urgencia === "urgencia-alta") countAltos++;
    if (Array.isArray(c.sistemas) && c.sistemas.some(s => s.nome !== "GLPI")) countTerceiros++;
  });
  
  const elTotal = document.getElementById("kpi-total");
  const elCrit = document.getElementById("kpi-criticos");
  const elAltos = document.getElementById("kpi-altos");
  const elTerc = document.getElementById("kpi-terceiros");
  const elConc = document.getElementById("kpi-concluidos");
  
  if (elTotal) elTotal.textContent = chamadosAtivos.length;
  if (elCrit) elCrit.textContent = countCriticos;
  if (elAltos) elAltos.textContent = countAltos;
  if (elTerc) elTerc.textContent = countTerceiros;
  if (elConc) elConc.textContent = chamadosConcluidos.length;

  // ABA CONCLUÍDOS
  if (filtroSidebar === "concluidos") {
    if (chamadosConcluidos.length === 0) {
      lista.innerHTML = `<p style="grid-column: 1/-1; text-align:center; color:#64748b; padding:40px;">Nenhum chamado no histórico recente.</p>`;
      return;
    }

    const concluidosOrdenados = [...chamadosConcluidos].sort((a, b) => (b.finalizadoEmMs || 0) - (a.finalizadoEmMs || 0));

    concluidosOrdenados.forEach(item => {
      const badgesHtml = (item.sistemas || []).map(s => {
        const textoBadge = isModoLeitor ? escapeHtml(s.nome) : `${escapeHtml(s.nome)} #${escapeHtml(s.ticket||'')}`;
        return `<span class="badge-sis badge-${escapeHtml((s.nome||'').toLowerCase())}">${textoBadge}</span>`;
      }).join("");

      const card = document.createElement("div");
      card.className = "ticket-card";
      card.style.opacity = "0.88";
      card.innerHTML = `
        <div>
          <div class="ticket-top"><div class="sistemas-badges">${badgesHtml}</div><span class="badge-urgencia" style="background:#e2e8f0; color:#475569;">CONCLUÍDO</span></div>
          <div class="ticket-title">${escapeHtml(item.titulo)}</div>
          ${item.descricao ? `<div class="ticket-obs">📝 ${escapeHtml(item.descricao)}</div>` : ''}
        </div>
        <div class="ticket-footer">
          <span style="font-size:12px; color:#64748b;">Finalizado em: ${escapeHtml(item.finalizadoEm || '')}</span>
          <div class="ticket-actions">
            <button class="btn-action-card btn-tramite" data-action="tramites" data-id="${escapeHtml(item.idDoc)}" data-history="true">💬 Trâmites (${(item.tramites||[]).length})</button>
            <button class="btn-action-card btn-copiar" data-action="copiar" data-id="${escapeHtml(item.idDoc)}" data-history="true">📋 Copiar</button>
            ${!isModoLeitor ? `<button class="btn-action-card btn-excluir" data-action="excluir" data-id="${escapeHtml(item.idDoc)}">🗑️ Excluir</button>` : ''}
          </div>
        </div>
      `;
      lista.appendChild(card);
    });
    return;
  }

  // ATIVOS (Ordenação Inteligente)
  const ordem = { "urgencia-critica": 1, "urgencia-alta": 2, "urgencia-media": 3, "urgencia-baixa": 4 };
  const ativosOrdenados = [...chamadosAtivos].sort((a, b) => {
    const tempoA = checarTempo(a.limiteSla);
    const tempoB = checarTempo(b.limiteSla);

    if (tempoA.expirado && !tempoB.expirado) return -1;
    if (!tempoA.expirado && tempoB.expirado) return 1;

    const urgA = ordem[a.urgencia] || 3;
    const urgB = ordem[b.urgencia] || 3;
    if (urgA !== urgB) return urgA - urgB;

    return (a.limiteSla || 0) - (b.limiteSla || 0);
  });

  ativosOrdenados.forEach(item => {
    const tempo = checarTempo(item.limiteSla);

    if (tempo.expirado && !alertasReconhecidos.has(item.idDoc)) {
      enfileirarAlarme(`🚨 SLA ESTOURADO:\nChamado: "${item.titulo}"`);
      alertasReconhecidos.add(item.idDoc);
    }

    if (urgFiltro !== "todos" && item.urgencia !== urgFiltro) return;
    if (filtroSidebar === "estourados" && !tempo.expirado) return;
    if (filtroSidebar === "urgencia-critica" && item.urgencia !== "urgencia-critica") return;
    if (["SISPLAN", "SENIOR", "SGT"].includes(filtroSidebar) && !item.sistemas.some(s => s.nome === filtroSidebar)) return;

    const textoBusca = `${item.titulo} ${item.descricao} ${(item.sistemas || []).map(s => s.nome + s.ticket).join(' ')} ${(item.tramites||[]).map(t => t.texto).join(' ')}`.toLowerCase();
    if (termo && !textoBusca.includes(termo)) return;

    // Badges: Oculta o número para leitores
    const badgesHtml = (item.sistemas || []).map(s => {
      const textoBadge = isModoLeitor ? escapeHtml(s.nome) : `${escapeHtml(s.nome)} #${escapeHtml(s.ticket||'')}`;
      return `<span class="badge-sis badge-${escapeHtml((s.nome||'').toLowerCase())}">${textoBadge}</span>`;
    }).join("");

    // Links dos sistemas apenas para operadores
    let linksSistemasHtml = "";
    if (!isModoLeitor) {
      (item.sistemas || []).forEach(sis => {
        const urlBase = obterUrlBase(sis.nome);
        if (urlBase && sis.ticket) {
          const urlFinal = `${urlBase}${encodeURIComponent(sis.ticket)}`;
          linksSistemasHtml += `<a href="${escapeHtml(urlFinal)}" target="_blank" class="btn-action-card btn-abrir">Abrir ${escapeHtml(sis.nome)} ↗</a>`;
        }
      });
    }

    const card = document.createElement("div");
    card.className = `ticket-card ${escapeHtml(item.urgencia)}`;
    card.innerHTML = `
      <div>
        <div class="ticket-top">
          <div class="sistemas-badges">${badgesHtml}</div>
          <span class="badge-urgencia ${escapeHtml(item.urgencia)}-tag">${escapeHtml((item.urgencia || 'urgencia-media').replace('urgencia-', ''))}</span>
        </div>
        <div class="ticket-title">${escapeHtml(item.titulo)}</div>
        ${item.descricao ? `<div class="ticket-obs">📝 ${escapeHtml(item.descricao)}</div>` : ''}
      </div>

      <div class="ticket-footer">
        <div class="timer-badge ${tempo.expirado ? 'timer-estourado' : ''}">⏱️ ${escapeHtml(tempo.texto)}</div>
        <div class="ticket-actions">
          <button class="btn-action-card btn-tramite" data-action="tramites" data-id="${escapeHtml(item.idDoc)}">💬 Trâmites (${(item.tramites||[]).length})</button>
          ${!isModoLeitor ? `<button class="btn-action-card btn-sla" data-action="sla" data-id="${escapeHtml(item.idDoc)}" title="Ajustar ou prorrogar prazo">⏱️ SLA</button>` : ''}
          <button class="btn-action-card btn-copiar" data-action="copiar" data-id="${escapeHtml(item.idDoc)}">📋</button>
          ${linksSistemasHtml}
          ${!isModoLeitor ? `
            <button class="btn-action-card btn-fechar" data-action="concluir" data-id="${escapeHtml(item.idDoc)}">Concluir</button>
            <button class="btn-action-card btn-excluir" data-action="excluir" data-id="${escapeHtml(item.idDoc)}">🗑️</button>
          ` : ''}
        </div>
      </div>
    `;
    lista.appendChild(card);
  });
}

// Event Delegation
document.getElementById("lista-chamados").addEventListener("click", e => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const action = btn.getAttribute("data-action");
  const id = btn.getAttribute("data-id");
  const isHistory = btn.getAttribute("data-history") === "true";

  if (action === "concluir") concluirChamado(id);
  if (action === "excluir") excluirChamado(id);
  if (action === "tramites") abrirModalTramites(id, isHistory);
  if (action === "sla") abrirModalSla(id);
  if (action === "copiar") copiarResumo(id, isHistory);
});

function abrirModalTramites(idDoc, isHistory = false) {
  chamadoSelecionadoId = idDoc;
  const item = (isHistory ? chamadosConcluidos : chamadosAtivos).find(c => c.idDoc === idDoc);
  if (!item) return;

  document.getElementById("modal-tramites-titulo").textContent = `Trâmites: ${item.titulo}`;
  const container = document.getElementById("timeline-lista");
  container.innerHTML = `
    <div class="timeline-item" style="border-left-color: #10b981;">
      <div class="timeline-header"><span>🚩 Abertura</span><span>${escapeHtml(item.criadoEm || '')}</span></div>
      <div class="timeline-text">${escapeHtml(item.descricao || "Sem observações.")}</div>
    </div>
  `;

  (item.tramites || []).forEach(t => {
    const div = document.createElement("div");
    div.className = "timeline-item";
    div.innerHTML = `
      <div class="timeline-header"><span>💬 Atualização</span><span>${escapeHtml(t.dataHora)}</span></div>
      <div class="timeline-text">${escapeHtml(t.texto)}</div>
    `;
    container.appendChild(div);
  });

  document.getElementById("box-novo-tramite").style.display = isModoLeitor || isHistory ? "none" : "flex";
  document.getElementById("modal-tramites").style.display = "flex";
}

function fecharModalTramites() {
  const modal = document.getElementById("modal-tramites");
  if (modal) modal.style.display = "none";
  chamadoSelecionadoId = null;
}

function copiarResumo(idDoc, isHistory = false) {
  const item = (isHistory ? chamadosConcluidos : chamadosAtivos).find(c => c.idDoc === idDoc);
  if (!item) return;

  const tags = (item.sistemas || []).map(s => {
    return isModoLeitor ? s.nome : `${s.nome}: #${s.ticket || ''}`;
  }).join(" | ");

  let texto = `📌 [${tags}]\n*Assunto:* ${item.titulo}\n*Obs Inicial:* ${item.descricao || 'Sem observações'}`;
  if (item.tramites && item.tramites.length > 0) {
    texto += `\n\n*Trâmites:*`;
    item.tramites.forEach(t => { texto += `\n- [${t.dataHora}] ${t.texto}`; });
  }
  navigator.clipboard.writeText(texto).then(() => alert("Resumo copiado!"));
}

let debounceTimer = null;
document.getElementById("filtro-busca").addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(renderizar, 200);
});

document.querySelectorAll(".sidebar-menu .menu-item").forEach(item => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".sidebar-menu .menu-item").forEach(el => el.classList.remove("active"));
    item.classList.add("active");
    filtroSidebar = item.getAttribute("data-filter");
    renderizar();
  });
});

setInterval(renderizar, 10000);
