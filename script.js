import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, onValue, remove, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyCRbsWjbM3EVYzyFNvJO-QOsM0IaQU51jI",
    authDomain: "cardwars-40ca8.firebaseapp.com",
    databaseURL: "https://cardwars-40ca8-default-rtdb.firebaseio.com", 
    projectId: "cardwars-40ca8"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const deviceId = localStorage.getItem('cw_final_id') || 'd_'+Math.random().toString(36).substr(2,7);
localStorage.setItem('cw_final_id', deviceId);

const gameId = "room1";
let myRole = null, gameState = null, selIdx = null, selFrom = null, selectedDeckSize = 52;

// --- ЛОББИ ---
onValue(ref(db, 'games'), (snapshot) => {
    const list = document.getElementById('rooms-list');
    list.innerHTML = '';
    const rooms = snapshot.val();
    if (!rooms) { list.innerHTML = '<div style="color:#666; margin-top:20px">НЕТ АКТИВНЫХ ИГР</div>'; return; }
    Object.keys(rooms).forEach(id => {
        const r = rooms[id];
        const div = document.createElement('div');
        div.className = 'room-item';
        div.innerHTML = `
            <div style="font-size:1.2rem"><b>${r.name || 'БИТВА'}</b> [${r.deckSize}]</div>
            <button class="menu-btn primary" style="padding:10px; font-size:1.1rem; width:120px" onclick="joinRoom('${id}', '${r.pass}')">${r.pass ? 'ПАРОЛЬ' : 'ЗАЙТИ'}</button>
        `;
        list.appendChild(div);
    });
});

window.showCreateForm = () => { document.getElementById('lobby-main').style.display='none'; document.getElementById('create-form').style.display='flex'; };
window.hideCreateForm = () => { document.getElementById('lobby-main').style.display='flex'; document.getElementById('create-form').style.display='none'; };
window.setDeckSize = (size) => { 
    selectedDeckSize = size; 
    document.querySelectorAll('.deck-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('d'+size).classList.add('active');
};

window.confirmCreate = () => {
    const name = document.getElementById('room-name').value.toUpperCase() || "БИТВА";
    const pass = document.getElementById('room-pass').value || "";
    const deck = createDeck(selectedDeckSize);
    const mid = Math.floor(deck.length / 2);
    const initial = {
        name, pass, deckSize: selectedDeckSize,
        p1: { deck: deck.slice(0, mid-4), hand: deck.slice(mid-4, mid), board: [], played: false, dev: deviceId },
        p2: { deck: deck.slice(mid, deck.length-4), hand: deck.slice(deck.length-4), board: [], played: false, dev: "" },
        turn: 'p1'
    };
    set(ref(db, `games/${gameId}`), initial).then(() => joinRoom(gameId, pass));
};

window.joinRoom = (id, correctPass) => {
    if (correctPass && correctPass !== "" && correctPass !== "undefined") {
        const userPass = prompt("ПАРОЛЬ:");
        if (userPass !== correctPass) return;
    }
    onValue(ref(db, `games/${id}`), (s) => {
        const d = s.val(); if (!d) return;
        gameState = d;
        if (d.p1.dev === deviceId) myRole = 'p1';
        else if (!d.p2.dev || d.p2.dev === deviceId) {
            myRole = 'p2';
            if (d.p2.dev !== deviceId) update(ref(db, `games/${id}/p2`), { dev: deviceId });
        }
        if (myRole) {
            document.getElementById('lobby-screen').style.display = 'none';
            document.getElementById('game-container').style.display = 'flex';
            render();
        }
    });
};

function render() {
    if (!gameState || !myRole) return;
    const me = gameState[myRole], opp = gameState[myRole === 'p1' ? 'p2' : 'p1'];
    const isTurn = gameState.turn === myRole;

    // Считаем общее кол-во карт для условия победы
    const myTotal = (me.deck?.length || 0) + (me.hand?.length || 0) + (me.board?.length || 0);
    const oppTotal = (opp.deck?.length || 0) + (opp.hand?.length || 0) + (opp.board?.length || 0);

    document.getElementById('opp-count').innerText = (opp.deck?.length || 0) + (opp.hand?.length || 0);
    document.getElementById('my-count').innerText = (me.deck?.length || 0);
    
    const ind = document.getElementById('turn-banner');
    ind.innerText = isTurn ? "ВАШ ХОД" : "ХОД ПРОТИВНИКА";
    ind.className = isTurn ? "active" : "";
    document.getElementById('end-turn-btn').disabled = !isTurn || (!me.played && me.hand?.length > 0);

    // Рука
    const handDiv = document.getElementById('player-hand');
    handDiv.innerHTML = '';
    (me.hand || []).forEach((c, i) => {
        const el = createCardUI(c);
        if (isTurn) el.onclick = () => { selIdx = i; selFrom = 'hand'; render(); };
        if (selFrom === 'hand' && selIdx === i) el.classList.add('selected');
        handDiv.appendChild(el);
    });

    renderBoard('opp-board', opp.board || [], true, isTurn);
    renderBoard('my-board', me.board || [], false, isTurn);

    const pb = document.getElementById('my-board');
    if (isTurn && selFrom === 'hand') { pb.classList.add('can-drop'); pb.onclick = playToBoard; }
    else { pb.classList.remove('can-drop'); pb.onclick = null; }

    if (myTotal === 0 && oppTotal > 0) showEnd("ПОРАЖЕНИЕ", "lose");
    else if (oppTotal === 0 && myTotal > 0) showEnd("ПОБЕДА!", "win");
}

function renderBoard(id, board, isOpp, isTurn) {
    const div = document.getElementById(id); div.innerHTML = '';
    board.forEach((c, i) => {
        const el = createCardUI(c);
        if (!isOpp && isTurn && !c.exh) {
            el.classList.add('can-go');
            el.onclick = () => { selIdx = i; selFrom = 'board'; render(); };
        } else if (isOpp && selFrom === 'board') {
            el.classList.add('can-attack');
            el.onclick = () => attack(i);
        }
        if (selFrom === 'board' && selIdx === i && !isOpp) el.classList.add('selected');
        div.appendChild(el);
    });
}

async function playToBoard() {
    const me = gameState[myRole];
    const card = me.hand.splice(selIdx, 1)[0];
    card.exh = false; me.played = true;
    if (!me.board) me.board = [];
    me.board.push(card);
    resetSel(); saveState();
}

async function attack(tIdx) {
    const oppR = myRole === 'p1' ? 'p2' : 'p1';
    const myC = gameState[myRole].board[selIdx], opC = gameState[oppR].board[tIdx];
    opC.hp -= myC.dmg; myC.hp -= opC.dmg; myC.exh = true;
    if (myC.hp <= 0) gameState[myRole].board.splice(selIdx, 1);
    if (opC.hp <= 0) gameState[oppR].board.splice(tIdx, 1);
    resetSel(); saveState();
}

document.getElementById('end-turn-btn').onclick = () => {
    const me = gameState[myRole], next = myRole === 'p1' ? 'p2' : 'p1';
    if (me.deck?.length > 0 && (me.hand || []).length < 4) {
        if(!me.hand) me.hand = [];
        me.hand.push(me.deck.shift());
    }
    if (gameState[next].board) gameState[next].board.forEach(c => c.exh = false);
    gameState.turn = next; me.played = false;
    resetSel(); saveState();
};

function createCardUI(c) {
    const div = document.createElement('div');
    div.className = 'card'; div.dataset.p = c.power;
    div.innerHTML = `<div class="c-half t">⚔️${c.power}</div><div class="c-half b">❤️${c.hp}</div>`;
    return div;
}

function createDeck(size) {
    let d = []; const min = size == 24 ? 9 : (size == 36 ? 6 : 2);
    for(let p=1; p<=4; p++) { for(let l=min; l<=14; l++) { d.push({ power: p, hp: l, dmg: p, exh: false }); } }
    return d.sort(() => Math.random() - 0.5);
}

window.exitToLobby = () => { if(confirm("ВЫЙТИ?")) remove(ref(db, `games/${gameId}`)).then(() => location.reload()); };
function showEnd(m, cl) { document.getElementById('end-screen').style.display='flex'; document.getElementById('end-plaque').className='plaque '+cl; document.getElementById('end-txt').innerText=m; }
function resetSel() { selIdx = null; selFrom = null; }
function saveState() {
    ['p1','p2'].forEach(p => { if(!gameState[p].board) gameState[p].board = []; if(!gameState[p].hand) gameState[p].hand = []; if(!gameState[p].deck) gameState[p].deck = []; });
    set(ref(db, `games/${gameId}`), gameState);
}