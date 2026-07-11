import './style.css';
import { supabase } from './supabase.js';
import { generateDeck, getBestStreamLength, getScore, getCurrentPrediction, calculateBestStreams, getCurrentPredictionInfo } from './gameLogic.js';


// ==========================================
// 1. 애플리케이션 상태(State) 정의
// ==========================================
let state = {
  role: null,             // 'host' | 'player' | null
  roomCode: null,         // 4자리 방 코드
  playerName: null,       // 플레이어 이름
  playerId: null,         // 플레이어 DB 고유 ID (bigint)
  currentTurn: 0,         // 진행 턴 수 (0 ~ 20)
  currentTile: null,      // 이번 턴의 타일 ("1" ~ "30", "★")
  deck: [],               // 교사용: 셔플된 40장 타일 덱
  drawnHistory: [],       // 뽑힌 타일 히스토리
  playersList: [],        // 방에 속한 플레이어 리스트
  boardState: Array(20).fill(null), // 학생용: 20칸 보드 상태
  tempIndex: null,        // 학생용: 이번 턴 임시 배치한 칸 인덱스
  confirmedTurn: 0        // 학생용: 마지막으로 배치를 확정한 턴
};

// 실시간 구독(Realtime Subscription) 채널 객체
let roomChannel = null;
let playersChannel = null;

// ==========================================
// 2. DOM 요소 레퍼런스 정의
// ==========================================
const views = {
  roleSelect: document.getElementById('view-select-role'),
  hostLobby: document.getElementById('view-host-lobby'),
  hostGame: document.getElementById('view-host-game'),
  hostLeaderboard: document.getElementById('view-host-leaderboard'),
  playerJoin: document.getElementById('view-player-join'),
  playerLobby: document.getElementById('view-player-lobby'),
  playerGame: document.getElementById('view-player-game'),
  playerFinished: document.getElementById('view-player-finished')
};

// ==========================================
// 3. 공통 유틸리티 함수
// ==========================================

// 토스트 메시지 생성 및 표출
function showToast(message, type = 'info') {
  // 기존 토스트 제거
  const oldToasts = document.querySelectorAll('.custom-toast');
  oldToasts.forEach(t => t.remove());

  const toast = document.createElement('div');
  toast.className = `custom-toast fixed top-6 left-1/2 transform -translate-x-1/2 px-6 py-3.5 rounded-2xl shadow-2xl font-bold border flex items-center gap-2.5 z-50 animate-pop-in transition-all duration-300`;
  
  if (type === 'success') {
    toast.className += ' bg-emerald-950/95 text-emerald-400 border-emerald-500/30';
    toast.innerHTML = `<span>✅</span> <span>${message}</span>`;
  } else if (type === 'error') {
    toast.className += ' bg-rose-950/95 text-rose-400 border-rose-500/30';
    toast.innerHTML = `<span>❌</span> <span>${message}</span>`;
  } else {
    toast.className += ' bg-slate-900/95 text-sky-400 border-sky-500/30';
    toast.innerHTML = `<span>ℹ️</span> <span>${message}</span>`;
  }
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('opacity-0', '-translate-y-4');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// 화면 전환
function showView(viewElement) {
  Object.values(views).forEach(v => v.classList.add('hidden'));
  viewElement.classList.remove('hidden');
}

// 4자리 방 코드 랜덤 생성
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// 규칙 모달 이벤트 바인딩
const rulesModal = document.getElementById('rules-modal');
document.getElementById('btn-show-rules-modal').addEventListener('click', () => rulesModal.showModal());
document.getElementById('btn-close-rules').addEventListener('click', () => rulesModal.close());

// ==========================================
// 4. 로컬 스토리지 상태 저장/복구 (비정상 종료 대비)
// ==========================================

function saveHostState() {
  localStorage.setItem('streams_host_room_code', state.roomCode || '');
  localStorage.setItem('streams_host_deck', JSON.stringify(state.deck));
  localStorage.setItem('streams_host_history', JSON.stringify(state.drawnHistory));
}

function clearHostState() {
  localStorage.removeItem('streams_host_room_code');
  localStorage.removeItem('streams_host_deck');
  localStorage.removeItem('streams_host_history');
}

function savePlayerState() {
  localStorage.setItem('streams_player_room_code', state.roomCode || '');
  localStorage.setItem('streams_player_name', state.playerName || '');
  localStorage.setItem('streams_player_id', state.playerId || '');
  localStorage.setItem('streams_player_board', JSON.stringify(state.boardState));
  localStorage.setItem('streams_player_confirmed_turn', state.confirmedTurn);
}

function clearPlayerState() {
  localStorage.removeItem('streams_player_room_code');
  localStorage.removeItem('streams_player_name');
  localStorage.removeItem('streams_player_id');
  localStorage.removeItem('streams_player_board');
  localStorage.removeItem('streams_player_confirmed_turn');
}

// ==========================================
// 5. 실시간 연결 상태 모니터링 (Supabase Connection)
// ==========================================
function updateConnectionIndicator(connected) {
  const indicator = document.getElementById('connection-status');
  if (connected) {
    indicator.className = "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
    indicator.innerHTML = `<span class="h-2 w-2 rounded-full bg-emerald-400 animate-ping"></span><span>실시간 연결됨</span>`;
  } else {
    indicator.className = "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20";
    indicator.innerHTML = `<span class="h-2 w-2 rounded-full bg-rose-400 animate-pulse"></span><span>오프라인 (재연결 중)</span>`;
  }
}

// ==========================================
// 6. 교사(Host) 모드 관련 주요 기능
// ==========================================

// 방 개설 프로세스
async function initHost() {
  state.role = 'host';
  
  try {
    let code = generateRoomCode();
    let isUnique = false;
    let attempts = 0;
    
    // 중복 방 코드 방지
    while (!isUnique && attempts < 5) {
      const { data, error } = await supabase.from('rooms').select('id').eq('id', code);
      if (error) throw error;
      if (data.length === 0) {
        isUnique = true;
      } else {
        code = generateRoomCode();
        attempts++;
      }
    }
    
    // 방 생성
    const { error: insertError } = await supabase.from('rooms').insert({
      id: code,
      status: 'waiting',
      current_tile: null,
      turn_count: 0
    });
    
    if (insertError) throw insertError;
    
    state.roomCode = code;
    saveHostState();
    
    // UI 업데이트
    document.getElementById('host-room-code').innerText = code;
    showView(views.hostLobby);
    showToast(`방 [${code}]이 개설되었습니다.`, 'success');
    
    // 실시간 구독 활성화
    subscribeToRoomPlayers(code);
    
  } catch (err) {
    console.error("방 생성 실패:", err);
    showToast("방 생성에 실패했습니다. Supabase 설정을 확인해 주세요.", "error");
  }
}

// 방 코드 복사
document.getElementById('btn-copy-code').addEventListener('click', () => {
  if (state.roomCode) {
    navigator.clipboard.writeText(state.roomCode)
      .then(() => showToast("방 코드가 클립보드에 복사되었습니다!", "success"))
      .catch(() => showToast("복사에 실패했습니다.", "error"));
  }
});

// 호스트 대기실 취소
document.getElementById('btn-cancel-lobby').addEventListener('click', async () => {
  if (state.roomCode) {
    // DB에서 방 삭제 (Cascade 설정으로 Player도 삭제됨)
    await supabase.from('rooms').delete().eq('id', state.roomCode);
    cleanupChannels();
    clearHostState();
  }
  state.role = null;
  state.roomCode = null;
  showView(views.roleSelect);
});

// 실시간 플레이어 현황 구독 (Lobby & In-game 공동 관리)
function subscribeToRoomPlayers(roomCode) {
  if (playersChannel) {
    supabase.removeChannel(playersChannel);
  }
  
  // 초기 플레이어 리스트 로딩
  fetchPlayers(roomCode);
  
  playersChannel = supabase
    .channel(`room-players-${roomCode}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${roomCode}` },
      (payload) => {
        // 플레이어에 변경이 생겼을 때 재로드
        fetchPlayers(roomCode);
      }
    )
    .subscribe((status) => {
      updateConnectionIndicator(status === 'SUBSCRIBED');
    });
}

// 플레이어 목록 조회 및 화면 갱신
async function fetchPlayers(roomCode) {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('room_id', roomCode)
    .order('created_at', { ascending: true });
    
  if (error) {
    console.error("플레이어 목록 조회 에러:", error);
    return;
  }
  
  state.playersList = data || [];
  
  if (state.role === 'host') {
    // 1. 대기방(Lobby) 플레이어 칠판 렌더링
    const lobbyListContainer = document.getElementById('host-lobby-players');
    const lobbyCount = document.getElementById('host-lobby-count');
    
    lobbyCount.innerText = state.playersList.length;
    
    if (state.playersList.length === 0) {
      lobbyListContainer.innerHTML = `<p class="col-span-full text-center text-white/40 my-auto text-lg py-12">학생들의 접속을 기다리고 있습니다...</p>`;
    } else {
      lobbyListContainer.innerHTML = state.playersList
        .map(p => `<div class="p-3 bg-white/5 border border-white/10 rounded-xl flex items-center justify-center animate-pop-in">🖍️ ${p.name}</div>`)
        .join('');
    }
    
    // 2. 인게임(Game) 플레이어 확정 현황 갱신
    updateHostInGamePlayers();
    
    // 3. 리더보드 점수 정렬 표시 (모두 종료 시)
    updateLeaderboard();
  }
}

// 호스트 인게임 플레이어 현황판 업데이트
function updateHostInGamePlayers() {
  const playersContainer = document.getElementById('host-game-players');
  const confirmedCountText = document.getElementById('host-confirmed-count');
  const totalCountText = document.getElementById('host-total-count');
  const progressBar = document.getElementById('host-confirmed-progress');
  
  if (!playersContainer) return;
  
  const totalPlayers = state.playersList.length;
  totalCountText.innerText = totalPlayers;
  
  if (totalPlayers === 0) {
    playersContainer.innerHTML = `<p class="text-center text-slate-500 py-12 text-sm">참여한 플레이어가 없습니다.</p>`;
    confirmedCountText.innerText = "0";
    progressBar.style.width = '0%';
    return;
  }
  
  // 현재 턴 배치를 확정한 플레이어 계산
  const confirmedPlayers = state.playersList.filter(p => p.confirmed_turn >= state.currentTurn || p.is_finished);
  confirmedCountText.innerText = confirmedPlayers.length;
  
  const progressPercent = totalPlayers > 0 ? (confirmedPlayers.length / totalPlayers) * 100 : 0;
  progressBar.style.width = `${progressPercent}%`;
  
  playersContainer.innerHTML = state.playersList
    .map(p => {
      // 확정 여부 판별 (is_finished이거나 현재 턴을 확정했거나)
      const isConfirmed = p.confirmed_turn >= state.currentTurn || p.is_finished;
      
      const badgeClass = isConfirmed 
        ? "bg-teal-500/20 text-teal-400 border border-teal-500/30" 
        : "bg-amber-500/10 text-amber-400 border border-amber-500/20";
      const icon = isConfirmed 
        ? `<svg xmlns="http://www.w3.org/2000/svg" class="h-4.5 w-4.5 text-teal-400" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>`
        : `<svg class="animate-spin h-4 w-4 text-amber-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;
      const statusText = isConfirmed ? "배치 완료" : "고민 중...";
      
      return `
        <div class="flex items-center justify-between p-3.5 bg-slate-900/60 border border-slate-800 rounded-xl">
          <div class="flex items-center gap-2.5">
            <span class="text-sm font-semibold">${p.name}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs px-2 py-0.5 rounded font-medium">턴 ${p.confirmed_turn}/20</span>
            <span class="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-bold ${badgeClass}">
              ${icon} ${statusText}
            </span>
          </div>
        </div>
      `;
    })
    .join('');
}

// 게임 시작 진행
document.getElementById('btn-start-game').addEventListener('click', async () => {
  if (state.playersList.length === 0) {
    showToast("대기방에 참가한 학생이 최소 1명 이상 있어야 게임을 시작할 수 있습니다.", "error");
    return;
  }
  
  try {
    state.deck = generateDeck();
    state.drawnHistory = [];
    state.currentTurn = 0;
    state.currentTile = null;
    saveHostState();
    
    // DB의 Room 상태 playing으로 변경
    const { error } = await supabase
      .from('rooms')
      .update({
        status: 'playing',
        turn_count: 0,
        current_tile: null
      })
      .eq('id', state.roomCode);
      
    if (error) throw error;
    
    // 인게임 화면 연출 및 데이터 바인딩
    document.getElementById('host-game-turn').innerText = "0";
    document.getElementById('host-tile-value').innerText = "★";
    document.getElementById('host-tile-history').innerHTML = `<p class="col-span-full text-center text-slate-500 py-12 text-sm">아직 뽑힌 타일이 없습니다.</p>`;
    document.getElementById('host-deck-remaining').innerText = state.deck.length;
    
    // 타일 뽑기 버튼 상태 초기화 (다음 게임 재시작 대응)
    const drawBtn = document.getElementById('btn-draw-tile');
    drawBtn.disabled = false;
    drawBtn.innerHTML = "<span>🎲</span> 타일 뽑기";
    
    showView(views.hostGame);
    showToast("게임을 시작합니다! 첫 타일을 뽑아보세요.", "success");
    
    // 실시간 방 감지 채널은 플레이어도 봐야 하므로 연결 유지
    subscribeToRoomUpdates(state.roomCode);
    
  } catch (err) {
    console.error("게임 시작 에러:", err);
    showToast("게임 시작 설정 변경에 실패했습니다.", "error");
  }
});

// 타일 뽑기
document.getElementById('btn-draw-tile').addEventListener('click', async () => {
  // 20턴이 완료된 경우 버튼 클릭 시 결과를 보기 위해 리더보드로 바로 이동
  if (state.currentTurn >= 20) {
    endGame();
    return;
  }

  if (state.deck.length === 0) {
    showToast("모든 타일을 뽑았습니다!", "error");
    return;
  }
  
  // 아직 확정하지 않은 학생들 경고창 띄우기
  const activePlayers = state.playersList.filter(p => !p.is_finished);
  const unconfirmed = activePlayers.filter(p => p.confirmed_turn < state.currentTurn);
  
  if (unconfirmed.length > 0) {
    const names = unconfirmed.map(p => p.name).join(', ');
    if (!confirm(`아직 이번 턴 배치를 완료하지 않은 학생이 있습니다 (${names}). 계속해서 다음 타일을 뽑으시겠습니까?`)) {
      return;
    }
  }
  
  try {
    const nextTile = state.deck.shift();
    state.currentTurn++;
    state.currentTile = nextTile;
    state.drawnHistory.push(nextTile);
    saveHostState();
    
    // DB 업데이트 -> 학생 화면에 실시간 브로드캐스트 효과
    const { error } = await supabase
      .from('rooms')
      .update({
        current_tile: String(nextTile),
        turn_count: state.currentTurn
      })
      .eq('id', state.roomCode);
      
    if (error) throw error;
    
    // UI 업데이트
    document.getElementById('host-game-turn').innerText = state.currentTurn;
    const tileValEl = document.getElementById('host-tile-value');
    tileValEl.innerText = nextTile;
    
    // 조커 스타일링 설정
    const tileIndicators = document.querySelectorAll('.host-tile-indicator');
    if (nextTile === '★') {
      tileValEl.className = "text-6xl font-extrabold text-amber-300 text-center leading-none tracking-tighter drop-shadow-[0_0_15px_rgba(252,211,77,0.6)] animate-float";
      tileIndicators.forEach(i => i.innerText = '★');
    } else {
      tileValEl.className = "text-6xl font-extrabold text-white text-center leading-none tracking-tighter drop-shadow-md";
      tileIndicators.forEach(i => i.innerText = nextTile);
    }
    
    document.getElementById('host-deck-remaining').innerText = state.deck.length;
    
    // 히스토리 렌더링
    renderHostHistory();
    
    // 학생 리스트 목록 갱신
    updateHostInGamePlayers();
    
    // 20턴이 완료되면 타일뽑기 버튼을 결과 확인 버튼으로 전환
    if (state.currentTurn >= 20) {
      const drawBtn = document.getElementById('btn-draw-tile');
      drawBtn.disabled = false; // 비활성화하지 않고 누를 수 있도록 유지
      drawBtn.innerHTML = "🏁 20턴 종료 완료 (결과 보기)";
      showToast("마지막 20번째 타일이 드로우되었습니다. 학생들이 제출을 완료하면 이 버튼을 눌러 결과를 확인하세요.", "info");
    }
    
  } catch (err) {
    console.error("타일 드로우 에러:", err);
    showToast("타일 업데이트에 실패했습니다.", "error");
  }
});

// 호스트 타일 히스토리 렌더링
function renderHostHistory() {
  const container = document.getElementById('host-tile-history');
  if (state.drawnHistory.length === 0) {
    container.innerHTML = `<p class="col-span-full text-center text-slate-500 py-12 text-sm">아직 뽑힌 타일이 없습니다.</p>`;
    return;
  }
  
  container.innerHTML = state.drawnHistory
    .map((tile, idx) => {
      const isJoker = tile === '★';
      const borderClass = isJoker ? 'border-amber-400 bg-amber-950/40 text-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.2)]' : 'border-indigo-900 bg-slate-900 text-slate-200';
      return `
        <div class="flex flex-col items-center justify-center p-2 rounded-xl border text-sm font-bold aspect-square ${borderClass} animate-pop-in">
          <span class="text-[10px] text-slate-500">${idx + 1}회</span>
          <span class="text-lg">${tile}</span>
        </div>
      `;
    })
    .join('');
}

// 게임 조기 종료 / 강제 종료
document.getElementById('btn-end-game-early').addEventListener('click', async () => {
  if (confirm("정말로 게임을 종료하시겠습니까? 현재 상태로 리더보드로 이동합니다.")) {
    endGame();
  }
});

// 게임 종료 시 DB 업데이트 및 리더보드 활성화
async function endGame() {
  try {
    const { error } = await supabase
      .from('rooms')
      .update({ status: 'finished' })
      .eq('id', state.roomCode);
      
    if (error) throw error;
    
    // 리더보드 화면 오픈
    updateLeaderboard();
    showView(views.hostLeaderboard);
    cleanupChannels();
    clearHostState();
    
  } catch (err) {
    console.error("게임 종료 처리 에러:", err);
    showToast("게임 종료 상태로 변경하지 못했습니다.", "error");
  }
}

// 리더보드 화면 갱신
function updateLeaderboard() {
  const listContainer = document.getElementById('leaderboard-list');
  if (!listContainer) return;
  
  // 플레이어 리스트 점수 내림차순 정렬
  const sortedPlayers = [...state.playersList].sort((a, b) => b.score - a.score);
  
  if (sortedPlayers.length === 0) {
    listContainer.innerHTML = `<div class="text-center py-12 text-slate-500">참여한 플레이어가 없습니다.</div>`;
    return;
  }
  
  listContainer.innerHTML = sortedPlayers
    .map((p, idx) => {
      let rankIcon = `<span class="font-mono text-slate-400 font-semibold">${idx + 1}</span>`;
      let bgClass = "bg-slate-900/30";
      
      if (idx === 0) {
        rankIcon = `<span class="text-2xl animate-float">🥇</span>`;
        bgClass = "bg-amber-500/10 border-l-4 border-l-amber-500";
      } else if (idx === 1) {
        rankIcon = `<span class="text-2xl">🥈</span>`;
        bgClass = "bg-slate-300/10 border-l-4 border-l-slate-400";
      } else if (idx === 2) {
        rankIcon = `<span class="text-2xl">🥉</span>`;
        bgClass = "bg-amber-700/10 border-l-4 border-l-amber-700";
      }
      
      return `
        <div class="grid grid-cols-12 gap-2 px-6 py-4 items-center ${bgClass}">
          <div class="col-span-2 text-center flex items-center justify-center">${rankIcon}</div>
          <div class="col-span-6 flex flex-col">
            <span class="font-bold text-slate-100">${p.name}</span>
            <span class="text-[10px] text-slate-500">${p.is_finished ? "제출 완료" : "제출 미완료"}</span>
          </div>
          <div class="col-span-4 text-right">
            <span class="text-2xl font-black text-indigo-400">${p.score}점</span>
          </div>
        </div>
      `;
    })
    .join('');
}

// 리더보드 재시작 단추
document.getElementById('btn-restart-host').addEventListener('click', () => {
  state.role = null;
  state.roomCode = null;
  state.playersList = [];
  showView(views.roleSelect);
});

// ==========================================
// 7. 학생(Player) 모드 관련 주요 기능
// ==========================================

// 참가 화면 뒤로가기
document.getElementById('btn-back-join').addEventListener('click', () => {
  state.role = null;
  showView(views.roleSelect);
});

// 학생 참가 폼 처리
document.getElementById('form-player-join').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const roomInput = document.getElementById('player-room-input').value.trim().toUpperCase();
  const nameInput = document.getElementById('player-name-input').value.trim();
  
  if (!roomInput || !nameInput) {
    showToast("방 코드와 이름을 모두 올바르게 채워주세요.", "error");
    return;
  }
  
  try {
    // 1. 방 정보 조회 (존재 여부 및 대기실 상태 확인)
    const { data: roomData, error: roomError } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', roomInput)
      .single();
      
    if (roomError || !roomData) {
      showToast("존재하지 않는 방 코드입니다. 코드를 다시 확인하세요.", "error");
      return;
    }
    
    if (roomData.status !== 'waiting') {
      showToast("해당 게임은 이미 진행 중이거나 종료되었습니다.", "error");
      return;
    }
    
    // 2. 동명 플레이어 중복 방지
    const { data: duplicateData, error: duplicateError } = await supabase
      .from('players')
      .select('*')
      .eq('room_id', roomInput)
      .eq('name', nameInput);
      
    if (duplicateError) throw duplicateError;
    
    if (duplicateData.length > 0) {
      showToast("동일한 이름을 사용하는 플레이어가 이미 대기실에 있습니다.", "error");
      return;
    }
    
    // 3. 플레이어 등록
    const { data: playerData, error: playerError } = await supabase
      .from('players')
      .insert({
        room_id: roomInput,
        name: nameInput,
        score: 0,
        is_finished: false,
        confirmed_turn: 0
      })
      .select()
      .single();
      
    if (playerError) throw playerError;
    
    // 4. 로컬 상태 반영 및 대기실 전환
    state.role = 'player';
    state.roomCode = roomInput;
    state.playerName = nameInput;
    state.playerId = playerData.id;
    state.boardState = Array(20).fill(null);
    state.tempIndex = null;
    state.confirmedTurn = 0;
    savePlayerState();
    
    document.getElementById('player-lobby-name').innerText = nameInput;
    document.getElementById('player-lobby-code').innerText = roomInput;
    
    showView(views.playerLobby);
    showToast("대기방에 성공적으로 입장했습니다!", "success");
    
    // 실시간 방 및 플레이어 구독 시작
    subscribeToRoomUpdates(roomInput);
    subscribeToRoomPlayers(roomInput);
    
  } catch (err) {
    console.error("학생 참가 신청 에러:", err);
    showToast("대기실 연결에 오류가 발생했습니다.", "error");
  }
});

// 학생 대기실 퇴장
document.getElementById('btn-exit-lobby').addEventListener('click', async () => {
  if (state.playerId) {
    await supabase.from('players').delete().eq('id', state.playerId);
    cleanupChannels();
    clearPlayerState();
  }
  state.role = null;
  state.roomCode = null;
  state.playerName = null;
  state.playerId = null;
  showView(views.roleSelect);
});

// 방 상태(Rooms) 실시간 업데이트 구독
function subscribeToRoomUpdates(roomCode) {
  if (roomChannel) {
    supabase.removeChannel(roomChannel);
  }
  
  roomChannel = supabase
    .channel(`room-updates-${roomCode}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomCode}` },
      (payload) => {
        const room = payload.new;
        if (!room) return;
        
        // 방 상태 변경 대응 (playing, finished)
        if (state.role === 'player') {
          if (room.status === 'playing' && views.playerGame.classList.contains('hidden') && !views.playerFinished.classList.contains('hidden')) {
             // 이미 종료된 유저는 가만히 있음
          } else if (room.status === 'playing') {
            handlePlayerGameStart(room);
          } else if (room.status === 'finished') {
            handlePlayerGameFinishedByHost();
          }
        }
      }
    )
    .subscribe((status) => {
      updateConnectionIndicator(status === 'SUBSCRIBED');
    });
}

// 학생 뷰: 게임 시작 상태 진입
function handlePlayerGameStart(room) {
  // 상태 변경
  state.currentTurn = room.turn_count;
  state.currentTile = room.current_tile;
  
  // 만약 turn_count가 0이면 첫 시작 전 대기
  document.getElementById('player-game-name').innerText = state.playerName;
  document.getElementById('player-game-code').innerText = state.roomCode;
  
  showView(views.playerGame);
  
  // 보드판 렌더링 및 턴 데이터 바인딩
  updatePlayerTurnUI();
  renderPlayerBoard();
}

// 학생 뷰: 턴 상태와 타일 표시 업데이트
function updatePlayerTurnUI() {
  document.getElementById('player-game-turn').innerText = state.currentTurn;
  const tileWrapper = document.getElementById('player-draw-tile-wrapper');
  const tileValEl = document.getElementById('player-current-tile-val');
  
  const confirmBtn = document.getElementById('btn-confirm-placement');
  const statusText = document.getElementById('confirm-status-text');
  
  // 이미 확정했는지 여부 체크
  const hasConfirmedCurrent = state.confirmedTurn >= state.currentTurn;
  
  if (state.currentTurn === 0 || !state.currentTile) {
    tileValEl.innerText = "⏳";
    tileWrapper.className = "w-16 h-22 bg-slate-800 rounded-xl border border-slate-700 flex items-center justify-center p-2";
    confirmBtn.disabled = true;
    confirmBtn.innerText = "대기 중...";
    statusText.innerText = "선생님이 첫 타일을 뽑기를 기다리는 중입니다.";
    return;
  }
  
  tileValEl.innerText = state.currentTile;
  
  // 조커 뷰 렌더링
  const tileIndicators = document.querySelectorAll('.player-tile-indicator');
  if (state.currentTile === '★') {
    tileWrapper.className = "w-16 h-22 bg-gradient-to-br from-amber-400 to-amber-600 rounded-xl shadow-lg border border-white/20 flex flex-col justify-between p-2 transform hover:scale-105 duration-200 animate-pulse";
    tileValEl.className = "text-3xl font-extrabold text-white text-center drop-shadow-[0_0_8px_rgba(252,211,77,0.5)]";
    tileIndicators.forEach(i => i.innerText = '★');
  } else {
    tileWrapper.className = "w-16 h-22 bg-gradient-to-br from-teal-400 to-indigo-500 rounded-xl shadow-lg border border-white/20 flex flex-col justify-between p-2 transform hover:scale-105 duration-200";
    tileValEl.className = "text-3xl font-extrabold text-white text-center drop-shadow-md";
    tileIndicators.forEach(i => i.innerText = state.currentTile);
  }
  
  if (hasConfirmedCurrent) {
    confirmBtn.disabled = true;
    confirmBtn.innerText = "대기 완료 (확정됨)";
    confirmBtn.classList.remove('bg-indigo-600', 'hover:bg-indigo-500');
    confirmBtn.classList.add('bg-slate-800', 'text-slate-500');
    statusText.innerText = "배치가 완료되었습니다! 다음 타일을 기다리세요.";
  } else {
    confirmBtn.disabled = state.tempIndex === null;
    confirmBtn.innerText = "배치 확정하기";
    confirmBtn.classList.remove('bg-slate-800', 'text-slate-500');
    confirmBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-500');
    statusText.innerText = state.tempIndex === null 
      ? "타일 숫자를 보드 빈 칸에 올려 놓으세요." 
      : "선택한 자리가 마음에 드시면 '배치 확정하기'를 누르세요!";
  }
}

// 학생 뷰: 보드판 렌더링
function renderPlayerBoard() {
  const grid = document.getElementById('game-board-grid');
  grid.innerHTML = '';
  
  const hasConfirmedCurrent = state.confirmedTurn >= state.currentTurn;
  const isLocked = state.currentTurn === 0 || hasConfirmedCurrent;
  
  for (let i = 0; i < 20; i++) {
    const tileVal = state.boardState[i];
    const isTemp = (i === state.tempIndex);
    const isConfirmed = (tileVal !== null && !isTemp);
    
    const cell = document.createElement('button');
    cell.type = 'button';
    
    // 번호 레이블 (1~20)
    const indexLabel = `<span class="absolute top-1 left-2 text-[10px] ${isConfirmed ? 'text-white/40' : 'text-slate-500'} font-bold">${i + 1}</span>`;
    
    if (isConfirmed) {
      const isJoker = tileVal === '★';
      const borderClass = isJoker 
        ? 'border-amber-400 bg-gradient-to-br from-amber-600 to-amber-700 text-amber-100 shadow-[0_0_10px_rgba(252,211,77,0.3)]' 
        : 'border-indigo-600 bg-slate-800 text-white';
      
      cell.className = `relative h-20 rounded-xl flex items-center justify-center font-extrabold text-2xl border-2 transition-all shadow-md ${borderClass} cursor-not-allowed`;
      cell.innerHTML = `
        ${indexLabel}
        <span class="m-auto text-2xl ${isJoker ? 'animate-float' : ''}">${tileVal}</span>
      `;
      
    } else if (isTemp) {
      const isJoker = tileVal === '★';
      const borderClass = isJoker 
        ? 'border-amber-400 text-amber-400 bg-amber-950/20 shadow-[0_0_12px_rgba(252,211,77,0.4)]' 
        : 'border-teal-400 text-teal-400 bg-teal-950/20 shadow-[0_0_12px_rgba(45,212,191,0.3)]';
        
      cell.className = `relative h-20 rounded-xl flex items-center justify-center font-extrabold text-2xl border-2 border-dashed transition-all cursor-pointer animate-pulse ${borderClass}`;
      cell.innerHTML = `
        ${indexLabel}
        <span class="m-auto text-2xl">${tileVal}</span>
        <span class="absolute bottom-1 right-2 text-[8px] text-teal-400/60 font-medium">임시</span>
      `;
      cell.addEventListener('click', () => handleCellClick(i, true));
      
    } else {
      // 빈 슬롯
      if (isLocked) {
        // 이미 턴을 확정했거나 대기중이면 배치 불가능
        cell.className = "relative h-20 rounded-xl flex items-center justify-center border border-slate-800 bg-slate-950/10 text-slate-700 cursor-not-allowed";
        cell.innerHTML = `
          ${indexLabel}
          <span class="m-auto text-slate-800 text-xs font-semibold">대기</span>
        `;
      } else {
        // 배치 가능한 빈 칸
        cell.className = "relative h-20 rounded-xl flex items-center justify-center border-2 border-dashed border-slate-800 bg-slate-950/50 text-slate-600 hover:border-teal-500/50 hover:bg-slate-800/20 transition-all cursor-pointer";
        cell.innerHTML = `${indexLabel}`;
        cell.addEventListener('click', () => handleCellClick(i, false));
      }
    }
    
    grid.appendChild(cell);
  }
}

// 학생 뷰: 보드판 슬롯 클릭 이벤트
function handleCellClick(index, isTemp) {
  // 이미 현재 턴 확정을 한 상태라면 조작 불가
  if (state.confirmedTurn >= state.currentTurn) return;
  
  if (isTemp) {
    // 임시 배치한 곳을 다시 누르면 취소(수정)
    state.boardState[index] = null;
    state.tempIndex = null;
  } else {
    // 빈 칸에 신규 임시 배치
    if (state.tempIndex !== null) {
      // 기존 임시 배치가 있었으면 클리어
      state.boardState[state.tempIndex] = null;
    }
    state.boardState[index] = state.currentTile;
    state.tempIndex = index;
  }
  
  savePlayerState();
  renderPlayerBoard();
  updatePlayerTurnUI();
  updatePredictedScore();
}

// 학생 뷰: 현재 상태 실시간 스트림 예측값 갱신
function updatePredictedScore() {
  const predInfo = getCurrentPredictionInfo(state.boardState);
  
  document.getElementById('player-predict-stream').innerText = predInfo.maxStreamLen;
  document.getElementById('player-predict-score').innerText = predInfo.totalScore;
}

// 학생 뷰: 배치 확정(Confirm) 버튼 클릭
document.getElementById('btn-confirm-placement').addEventListener('click', async () => {
  if (state.tempIndex === null) return;
  
  try {
    // 임시 인덱스를 확정 상태로 변경
    state.tempIndex = null;
    state.confirmedTurn = state.currentTurn;
    savePlayerState();
    
    // DB의 player confirmed_turn 필드 업데이트 -> 호스트 화면에 완료 체크마크 표출됨
    const { error } = await supabase
      .from('players')
      .update({ confirmed_turn: state.confirmedTurn })
      .eq('id', state.playerId);
      
    if (error) throw error;
    
    showToast(`${state.confirmedTurn}번째 타일 배치를 확정했습니다.`, "success");
    
    // 20턴 확정 시 최종 점수 산출 및 게임 종료 처리
    if (state.confirmedTurn >= 20) {
      await handlePlayerGameFinished();
    } else {
      updatePlayerTurnUI();
      renderPlayerBoard();
    }
    
  } catch (err) {
    console.error("배치 확정 등록 에러:", err);
    showToast("확정 처리에 실패했습니다. 인터넷 상태를 확인해 주세요.", "error");
  }
});

// 학생 뷰: 20턴 최종 완료 후 점수 산출 및 데이터 전송
async function handlePlayerGameFinished() {
  const result = calculateBestStreams(state.boardState);
  const finalScore = result.totalScore;
  const maxStreamLen = result.streams.reduce((max, s) => Math.max(max, s.length), 0);
  
  try {
    const { error } = await supabase
      .from('players')
      .update({
        score: finalScore,
        is_finished: true
      })
      .eq('id', state.playerId);
      
    if (error) throw error;
    
    document.getElementById('player-finished-name').innerText = state.playerName;
    document.getElementById('player-final-stream').innerText = maxStreamLen;
    document.getElementById('player-final-score').innerText = finalScore;
    
    // 상태 초기화 전에 보드 상태를 UI에 그려줌
    renderFinalResultUI(state.boardState, result);
    
    showView(views.playerFinished);
    clearPlayerState();
    cleanupChannels();
    showToast(`게임이 모두 끝났습니다! 최종 점수: ${finalScore}점`, "success");
    
  } catch (err) {
    console.error("최종 점수 제출 실패:", err);
    showToast("최종 점수 집계 전송에 실패했습니다.", "error");
  }
}

// 학생 뷰: 최종 보드판 시각화 및 점수 상세 내역 렌더링
function renderFinalResultUI(board, result) {
  const gridContainer = document.getElementById('player-final-board-grid');
  const detailsContainer = document.getElementById('player-final-score-details');
  
  gridContainer.innerHTML = '';
  detailsContainer.innerHTML = '';
  
  // 스트림별 배경 하이라이트 색상 (Tailwind 클래스 활용)
  const streamColors = [
    'bg-indigo-500/10 border-indigo-500/40 text-indigo-300',
    'bg-teal-500/10 border-teal-500/40 text-teal-300',
    'bg-pink-500/10 border-pink-500/40 text-pink-300',
    'bg-amber-500/10 border-amber-500/40 text-amber-300',
    'bg-emerald-500/10 border-emerald-500/40 text-emerald-300',
    'bg-cyan-500/10 border-cyan-500/40 text-cyan-300',
    'bg-purple-500/10 border-purple-500/40 text-purple-300',
    'bg-orange-500/10 border-orange-500/40 text-orange-300'
  ];
  
  const boardSlotStream = Array(board.length).fill(null);
  
  result.streams.forEach((stream, sIdx) => {
    const colorClass = streamColors[sIdx % streamColors.length];
    for (let k = stream.startIndex; k <= stream.endIndex; k++) {
      boardSlotStream[k] = {
        streamIndex: sIdx + 1,
        colorClass: colorClass
      };
    }
  });
  
  // 최종 보드 20칸 그리드 생성
  board.forEach((val, idx) => {
    const slotInfo = boardSlotStream[idx] || { streamIndex: '?', colorClass: 'bg-slate-800 border-slate-700 text-slate-400' };
    const displayVal = val === null || val === undefined || val === '' ? '' : val;
    
    const isJoker = displayVal === '★';
    const tileColorClass = isJoker 
      ? 'from-yellow-400 to-amber-500 text-slate-950 font-black px-1 rounded bg-gradient-to-br' 
      : 'text-white font-bold';
      
    const slotHtml = `
      <div class="flex flex-col items-center justify-between p-2 rounded-xl border ${slotInfo.colorClass} min-h-[70px] relative overflow-hidden">
        <span class="text-[9px] text-slate-400 absolute top-1 left-1.5 font-bold">${idx + 1}</span>
        <div class="flex-grow flex items-center justify-center mt-2.5">
          <span class="text-base ${tileColorClass}">${displayVal}</span>
        </div>
        <span class="text-[9px] font-bold opacity-60 mt-1">S${slotInfo.streamIndex}</span>
      </div>
    `;
    gridContainer.insertAdjacentHTML('beforeend', slotHtml);
  });
  
  // 상세 계산 리스트 생성
  let detailsHtml = '';
  let sumParts = [];
  
  result.streams.forEach((stream, sIdx) => {
    const valString = stream.values.join(', ');
    const bulletColor = stream.score > 0 ? 'text-teal-400' : 'text-slate-500';
    const streamColorLabel = streamColors[sIdx % streamColors.length].split(' ')[2] || 'text-slate-300';
    
    detailsHtml += `
      <div class="flex justify-between items-center py-2 border-b border-slate-800/80 last:border-b-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-black ${streamColorLabel}">스트림 #${sIdx + 1}</span>
          <span class="text-slate-300 font-mono text-[11px] bg-slate-900/60 px-2 py-0.5 rounded border border-slate-800/60">
            ${valString}
          </span>
          <span class="text-[10px] text-slate-500">(${stream.startIndex + 1}번~${stream.endIndex + 1}번 칸)</span>
        </div>
        <div class="text-right flex items-center gap-3 shrink-0">
          <span class="text-slate-400 text-[10px]">길이 ${stream.length}</span>
          <span class="font-extrabold text-sm ${bulletColor}">${stream.score}점</span>
        </div>
      </div>
    `;
    sumParts.push(stream.score);
  });
  
  const sumFormula = sumParts.join(' + ') + ` = ${result.totalScore}점`;
  
  detailsHtml += `
    <div class="pt-3 mt-3 border-t border-dashed border-slate-800 flex justify-between items-center text-xs font-bold bg-slate-900/40 p-3 rounded-xl border border-slate-800">
      <span class="text-slate-400">최종 획득 점수 계산식</span>
      <span class="text-teal-300 text-right font-black tracking-wider text-sm">${sumFormula}</span>
    </div>
  `;
  
  detailsContainer.innerHTML = detailsHtml;
}

// 학생 뷰: 선생님이 도중에 게임을 강제 종료했을 때
function handlePlayerGameFinishedByHost() {
  if (views.playerFinished.classList.contains('hidden')) {
    // 20턴 전이라도 강제 종료되었으면 현재까지 적힌 보드로 점수 정산 처리
    handlePlayerGameFinished();
  }
}

// 학생 뷰: 게임 완료 화면에서 처음으로 복귀
document.getElementById('btn-exit-finished').addEventListener('click', () => {
  state.role = null;
  state.roomCode = null;
  state.playerName = null;
  state.playerId = null;
  showView(views.roleSelect);
});

// ==========================================
// 8. 채널(Channel) 청소 및 리바인딩
// ==========================================
function cleanupChannels() {
  if (roomChannel) {
    supabase.removeChannel(roomChannel);
    roomChannel = null;
  }
  if (playersChannel) {
    supabase.removeChannel(playersChannel);
    playersChannel = null;
  }
}

// ==========================================
// 9. 리스너 바인딩 및 최초 접속 상태 자동 복구
// ==========================================

// 역할 선택 버튼 바인딩
document.getElementById('btn-select-host').addEventListener('click', () => initHost());
document.getElementById('btn-select-player').addEventListener('click', () => showView(views.playerJoin));

// 최초 페이지 로딩 시 로컬 스토리지 데이터 체크 및 세션 자동 복구
async function restoreSession() {
  const hostRoom = localStorage.getItem('streams_host_room_code');
  const playerRoom = localStorage.getItem('streams_player_room_code');
  
  if (hostRoom) {
    // 1. 교사 상태 자동 복구 시도
    try {
      const { data: room, error } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', hostRoom)
        .single();
        
      if (!error && room && room.status !== 'finished') {
        state.role = 'host';
        state.roomCode = hostRoom;
        
        // 덱 복구
        const savedDeck = localStorage.getItem('streams_host_deck');
        const savedHistory = localStorage.getItem('streams_host_history');
        
        state.deck = savedDeck ? JSON.parse(savedDeck) : [];
        state.drawnHistory = savedHistory ? JSON.parse(savedHistory) : [];
        state.currentTurn = room.turn_count;
        state.currentTile = room.current_tile;
        
        // 채널 재구독
        subscribeToRoomPlayers(hostRoom);
        subscribeToRoomUpdates(hostRoom);
        
        if (room.status === 'playing') {
          // 인게임 복구
          document.getElementById('host-game-turn').innerText = state.currentTurn;
          const tileValEl = document.getElementById('host-tile-value');
          tileValEl.innerText = state.currentTile || "★";
          
          if (state.currentTile === '★') {
            tileValEl.className = "text-6xl font-extrabold text-amber-300 text-center leading-none tracking-tighter drop-shadow-[0_0_15px_rgba(252,211,77,0.6)] animate-float";
          }
          
          document.getElementById('host-deck-remaining').innerText = state.deck.length;
          renderHostHistory();
          showView(views.hostGame);
          
          if (state.currentTurn >= 20) {
            document.getElementById('btn-draw-tile').disabled = true;
            document.getElementById('btn-draw-tile').innerHTML = "🏁 20턴 종료 완료";
          }
        } else {
          // 대기실 복구
          document.getElementById('host-room-code').innerText = hostRoom;
          showView(views.hostLobby);
        }
        showToast("이전 교사 세션을 복구했습니다.", "info");
        return;
      } else {
        clearHostState();
      }
    } catch (e) {
      console.warn("교사 세션 복구 실패:", e);
      clearHostState();
    }
  }
  
  if (playerRoom) {
    // 2. 학생 상태 자동 복구 시도
    const pName = localStorage.getItem('streams_player_name');
    const pId = localStorage.getItem('streams_player_id');
    const pBoard = localStorage.getItem('streams_player_board');
    const pConfirmed = localStorage.getItem('streams_player_confirmed_turn');
    
    if (pName && pId) {
      try {
        const { data: room, error: roomErr } = await supabase
          .from('rooms')
          .select('*')
          .eq('id', playerRoom)
          .single();
          
        const { data: player, error: playerErr } = await supabase
          .from('players')
          .select('*')
          .eq('id', pId)
          .single();
          
        if (!roomErr && !playerErr && room && player && room.status !== 'finished') {
          state.role = 'player';
          state.roomCode = playerRoom;
          state.playerName = pName;
          state.playerId = player.id;
          state.boardState = pBoard ? JSON.parse(pBoard) : Array(20).fill(null);
          state.confirmedTurn = Number(pConfirmed) || player.confirmed_turn;
          
          // 임시 배치가 있었으면 로컬 복귀 시점에 날려주기
          state.tempIndex = null;
          
          subscribeToRoomPlayers(playerRoom);
          subscribeToRoomUpdates(playerRoom);
          
          if (room.status === 'playing') {
            state.currentTurn = room.turn_count;
            state.currentTile = room.current_tile;
            
            document.getElementById('player-game-name').innerText = state.playerName;
            document.getElementById('player-game-code').innerText = state.roomCode;
            
            showView(views.playerGame);
            updatePlayerTurnUI();
            renderPlayerBoard();
            updatePredictedScore();
          } else {
            document.getElementById('player-lobby-name').innerText = pName;
            document.getElementById('player-lobby-code').innerText = playerRoom;
            showView(views.playerLobby);
          }
          showToast("이전 참가 세션을 복구했습니다.", "info");
          return;
        } else {
          clearPlayerState();
        }
      } catch (e) {
        console.warn("학생 세션 복구 실패:", e);
        clearPlayerState();
      }
    }
  }
  
  // 복구할 세션이 없다면 첫 역할 선택 화면
  showView(views.roleSelect);
}

// 윈도우 로드 시 복구 기동
window.addEventListener('DOMContentLoaded', () => {
  restoreSession();
});
