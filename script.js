import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, onValue, remove, update, onDisconnect, get } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyCRbsWjbM3EVYzyFNvJO-QOsM0IaQU51jI",
    authDomain: "cardwars-40ca8.firebaseapp.com",
    databaseURL: "https://cardwars-40ca8-default-rtdb.firebaseio.com", 
    projectId: "cardwars-40ca8"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const deviceId = localStorage.getItem('cw_v25_id') || 'd_'+Math.random().toString(36).substr(2,7);
localStorage.setItem('cw_v25_id', deviceId);

let curRoomId = null, myRole = null, gameState = null, selIdx = null, selFrom = null, selectedDeckSize = 52;
let lastActionId = 0;

// --- ПРИВЯЗКА ФУНКЦИЙ К WINDOW (чтобы работал onclick в HTML) ---

window.showCreateForm = () => { 
    document.getElementById('lobby-main').style.display='none'; 
    document.getElementById('create-form').style.display='flex'; 
};

window.hideCreateForm = () => { 
    document.getElementById('lobby-main').style.display='flex'; 
    document.getElementById('create-form').style.display='none'; 
};

window.setDeckSize = (size) => { 
    selectedDeckSize = size; 
    document.querySelectorAll('.deck-btn').forEach(b => b.classList.toggle('active', b.id === 'd' + size));
};

window.confirmCreate = () => {
    const name = (document.getElementById('room-name').value || "БИТВА").toUpperCase();
    const pass = document.getElementById('room-pass').value || "";
    const roomId = 'r_' + Date.now();
    const deck = createDeck(selectedDeckSize);
    const mid = Math.floor(deck.length / 2);
    
    const initial = {
        name, pass, deckSize: selectedDeckSize,
        p1: { deck: deck.slice(0, mid-4), hand: deck.slice(mid-4, mid), board: [], played: false, dev: deviceId },
        p2: { deck: deck.slice(mid, deck.length-4), hand: deck.slice(deck.length-4), board: [], played: false, dev: "" },
        turn: 'p1', action: { id: 0 }
    };
    
    curRoomId = roomId;
    set(ref(db, `games/${roomId}`), initial).then(() => window.joinRoom(roomId, pass));
};

// --- СПИСОК КОМНАТ ---
onValue(ref(db, 'games'), (s) => {
    const list = document.getElementById('rooms-list');
    if (!list) return;
    list.innerHTML = '';
    const rooms = s.val();
    if (!rooms) return;

    Object.keys(rooms).forEach(id => {
        const r = rooms[id];
        if (!r.p1 || !r.p2) return; 

        const isFull = (r.p1.dev && r.p1.dev !== "") && (r.p2.dev && r.p2.dev !== "");
        const div = document.createElement('div');
        div.className = 'room-item';
        div.innerHTML = `
            <div class="room-info">
                <span class="room-name">${r.name || 'БИТВА'}</span><br>
                <span class="room-status ${isFull ? 'status-full' : 'status-open'}">
                    ${isFull ? 'В БОЮ' : 'ЕСТЬ МЕСТО'}
                </span>
            </div>
            <button class="mega-btn primary" style="width:80px; padding:8px; font-size:0.9rem" 
                onclick="joinRoom('${id}', '${r.pass}')">ЗАЙТИ</button>
        `;
        list.appendChild(div);
    });
});

// --- ЛОГИКА ИГРЫ ---

window.joinRoom = async (id, pass) => {
    const roomRef = ref(db, `games/${id}`);
    const snap = await get(roomRef);
    const d = snap.val();
    if (!d) return;

    if (pass && d.pass && d.pass !== "" && d.pass !== "undefined") {
        if (prompt("ПАРОЛЬ:") !== d.pass) return;
    }

    curRoomId = id;

    if (d.p1.dev === deviceId) myRole = 'p1';
    else if (d.p2.dev === deviceId) myRole = 'p2';
    else if (!d.p1.dev) { myRole = 'p1'; await update(ref(db, `games/${id}/p1`), { dev: deviceId }); }
    else if (!d.p2.dev) { myRole = 'p2'; await update(ref(db, `games/${id}/p2`), { dev: deviceId }); }
    else { alert("МЕСТ НЕТ"); return; }

    onDisconnect(ref(db, `games/${id}/${myRole}/dev`)).set("");

    onValue(roomRef, (s) => {
        const data = s.val();
        if (!data) return;

        if (data.action && data.action.id > lastActionId) {
            handleActionAnimation(data.action);
            lastActionId = data.action.id;
            if (data.action.type === 'attack') {
                gameState = data;
                setTimeout(() => render(), 600);
                return;
            }
        }
        gameState = data;
        render();
        document.getElementById('lobby-screen').style.display = 'none';
        document.getElementById('game-container').style.display = 'flex';
    });
};

function render() {
    if (!gameState || !myRole) return;
    const me = gameState[myRole], oppRole = myRole === 'p1' ? 'p2' : 'p1', opp = gameState[oppRole];
    const isTurn = gameState.turn === myRole;

    document.getElementById('opp-count').innerText = opp.deck?.length || 0;
    document.getElementById('my-count').innerText = me.deck?.length || 0;
    
    const banner = document.getElementById('turn-message');
    banner.innerText = isTurn ? "ВАШ ХОД" : "ХОД ПРОТИВНИКА";
    banner.className = isTurn ? "active" : "";
    document.getElementById('end-turn-btn').disabled = !isTurn;

    // Рука
    const handDiv = document.getElementById('player-hand');
    handDiv.innerHTML = '';
    (me.hand || []).forEach((c, i) => {
        const el = createCardUI(c);
        if (isTurn) el.onclick = () => { selIdx = i; selFrom = 'hand'; render(); };
        if (selFrom === 'hand' && selIdx === i) el.classList.add('selected');
        handDiv.appendChild(el);
    });

    // Поля
    renderBoard('opp-board', opp.board || [], true, isTurn);
    renderBoard('my-board', me.board || [], false, isTurn);

    // Логика выкладывания на поле
    const pb = document.getElementById('my-board');
    if (isTurn && selFrom === 'hand') {
        pb.classList.add('can-drop');
        pb.onclick = playToBoard;
    } else {
        pb.classList.remove('can-drop');
        pb.onclick = null;
    }
}

function renderBoard(id, board, isOpp, isTurn) {
    const div = document.getElementById(id); div.innerHTML = '';
    board.forEach((c, i) => {
        const el = createCardUI(c);
        el.id = `${id}-${i}`;
        if (c.exh) el.classList.add('exhausted');
        else if (!isOpp && isTurn) el.classList.add('ready-to-attack');

        if (!isOpp && isTurn && !c.exh) {
            el.onclick = (e) => { e.stopPropagation(); selIdx = i; selFrom = 'board'; render(); };
        } else if (isOpp && selFrom === 'board') {
            el.classList.add('can-attack');
            el.onclick = (e) => { e.stopPropagation(); attack(i); };
        }
        if (selFrom === 'board' && selIdx === i && !isOpp) el.classList.add('selected');
        div.appendChild(el);
    });
}

async function attack(tIdx) {
    if (selIdx === null || selFrom !== 'board' || gameState.turn !== myRole) return;
    const data = JSON.parse(JSON.stringify(gameState));
    const me = data[myRole], oppRole = myRole === 'p1' ? 'p2' : 'p1', opp = data[oppRole];
    const myC = me.board[selIdx], opC = opp.board[tIdx];

    if (!myC || !opC || myC.exh) return;

    // Расчет
    opC.hp -= myC.dmg; myC.hp -= opC.dmg; myC.exh = true;
    const action = { id: Date.now(), type: 'attack', who: myRole, aIdx: selIdx, tIdx: tIdx, dA: opC.dmg, dT: myC.dmg };
    
    if (opC.hp <= 0) opp.board.splice(tIdx, 1);
    if (myC.hp <= 0) me.board.splice(selIdx, 1);

    resetSel();
    await set(ref(db, `games/${curRoomId}`), { ...data, action });
}

async function playToBoard() {
    if (selIdx === null || selFrom !== 'hand') return;
    const data = JSON.parse(JSON.stringify(gameState));
    const me = data[myRole];
    const card = me.hand.splice(selIdx, 1)[0];
    card.exh = false; 
    if (!me.board) me.board = [];
    me.board.push(card);
    me.played = true;
    resetSel();
    await set(ref(db, `games/${curRoomId}`), data);
}

document.getElementById('end-turn-btn').onclick = async () => {
    const data = JSON.parse(JSON.stringify(gameState));
    const me = data[myRole];
    if (me.deck?.length > 0 && (me.hand || []).length < 4) me.hand.push(me.deck.shift());
    if (me.board) me.board.forEach(c => c.exh = false);
    data.turn = myRole === 'p1' ? 'p2' : 'p1';
    data.action = { id: Date.now(), type: 'draw' };
    resetSel();
    await set(ref(db, `games/${curRoomId}`), data);
};

window.exitToLobby = async () => {
    if (!confirm("ВЫЙТИ?")) return;
    const roomRef = ref(db, `games/${curRoomId}`);
    const snap = await get(roomRef);
    const d = snap.val();
    if (d) {
        await update(ref(db, `games/${curRoomId}/${myRole}`), { dev: "" });
        const other = myRole === 'p1' ? 'p2' : 'p1';
        if (!d[other].dev) await remove(roomRef);
    }
    location.reload();
};

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

function createCardUI(c) {
    const div = document.createElement('div');
    div.className = 'card';
    div.style.backgroundColor = [null, '#3498db', '#2ecc71', '#e67e22', '#e74c3c'][c.power];
    div.innerHTML = `<div class="c-val c-top" style="font-size:1.4rem">${c.power}⚔️</div>
                     <div class="c-val c-bot" style="font-size:1.4rem">${c.hp}❤️</div>`;
    return div;
}

function createDeck(size) {
    let d = []; const min = size == 24 ? 9 : (size == 36 ? 6 : 2);
    for(let p=1; p<=4; p++) { for(let l=min; l<=14; l++) { d.push({ power: p, hp: l, dmg: p, exh: false }); } }
    return d.sort(() => Math.random() - 0.5);
}

function handleActionAnimation(act) {
    if (act.type === 'attack') {
        const isMe = act.who === myRole;
        const attId = isMe ? `my-board-${act.aIdx}` : `opp-board-${act.aIdx}`;
        const tarId = isMe ? `opp-board-${act.tIdx}` : `my-board-${act.tIdx}`;
        const attEl = document.getElementById(attId), tarEl = document.getElementById(tarId);
        if (attEl && tarEl) {
            const rA = attEl.getBoundingClientRect(), rT = tarEl.getBoundingClientRect();
            attEl.style.zIndex = "1000";
            attEl.style.transform = `translate(${rT.left - rA.left}px, ${rT.top - rA.top}px) scale(1.1)`;
            setTimeout(() => {
                popDmg(tarEl, act.dT); popDmg(attEl, act.dA);
                tarEl.classList.add('shake');
                attEl.style.transform = "";
                setTimeout(() => { tarEl.classList.remove('shake'); attEl.style.zIndex = ""; }, 300);
            }, 300);
        }
    }
}

function popDmg(el, val) {
    const rect = el.getBoundingClientRect();
    const d = document.createElement('div');
    d.className = 'damage-pop'; d.innerText = `-${val}`;
    d.style.left = (rect.left + rect.width/2) + 'px';
    d.style.top = (rect.top + rect.height/2) + 'px';
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 1000);
}

function resetSel() { selIdx = null; selFrom = null; }