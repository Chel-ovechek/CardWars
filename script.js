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
let lastActionId = 0, prevHandLen = 0;

// --- ЛОББИ ---
onValue(roomRef, (s) => {
    const data = s.val();
    if (!data) return;

    if (data.action && data.action.id > lastActionId) {
        const act = data.action;
        lastActionId = act.id;

        if (act.type === 'attack') {
            handleActionAnimation(act);
            // Ждем 600мс (время полета карты + тряска), только потом обновляем цифры и удаляем карты
            gameState = data; 
            setTimeout(() => render(), 600);
            return; 
        }
    }

    gameState = data;
    render();
});

window.showCreateForm = () => { document.getElementById('lobby-main').style.display='none'; document.getElementById('create-form').style.display='flex'; };
window.hideCreateForm = () => { document.getElementById('lobby-main').style.display='flex'; document.getElementById('create-form').style.display='none'; };
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
    set(ref(db, `games/${roomId}`), initial).then(() => joinRoom(roomId, pass));
};

window.joinRoom = async (id, pass) => {
    const roomRef = ref(db, `games/${id}`);
    const snap = await get(roomRef);
    const d = snap.val();
    if (!d) return;

    if (pass && d.pass && d.pass !== "" && d.pass !== "undefined") {
        if (prompt("ПАРОЛЬ:") !== d.pass) return;
    }

    curRoomId = id;

    // ЛОГИКА РОЛЕЙ:
    if (d.p1 && d.p1.dev === deviceId) {
        myRole = 'p1';
    } else if (d.p2 && d.p2.dev === deviceId) {
        myRole = 'p2';
    } else if (!d.p1.dev || d.p1.dev === "") {
        myRole = 'p1';
        await update(ref(db, `games/${id}/p1`), { dev: deviceId });
    } else if (!d.p2.dev || d.p2.dev === "") {
        myRole = 'p2';
        await update(ref(db, `games/${id}/p2`), { dev: deviceId });
    } else {
        alert("КОМНАТА ЗАНЯТА");
        return;
    }

    // Слушаем обновления комнаты
    onValue(roomRef, (s) => {
        const data = s.val();
        if (!data) return;

        // Обработка анимаций
        if (data.action && data.action.id > lastActionId) {
            handleActionAnimation(data.action);
            lastActionId = data.action.id;
            // Если была атака, даем время анимации перед рендером
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
    if (!me || !opp) return;

    const isTurn = gameState.turn === myRole;
    document.getElementById('opp-count').innerText = opp.deck?.length || 0;
    document.getElementById('my-count').innerText = me.deck?.length || 0;
    
    const banner = document.getElementById('turn-message');
    banner.innerText = isTurn ? "ВАШ ХОД" : "ХОД ПРОТИВНИКА";
    banner.className = isTurn ? "active" : "";
    document.getElementById('end-turn-btn').disabled = !isTurn || (!me.played && (me.hand?.length > 0 || me.deck?.length > 0));

    // Моя рука
    const handDiv = document.getElementById('player-hand');
    handDiv.innerHTML = '';
    (me.hand || []).forEach((c, i) => {
        const el = createCardUI(c);
        if (isTurn) {
            el.onclick = () => { selIdx = i; selFrom = 'hand'; render(); };
            initPointerDrag(el, i); 
        }
        if (selFrom === 'hand' && selIdx === i) el.classList.add('selected');
        handDiv.appendChild(el);
    });

    // Рука врага (рубашки)
    const oppHandDiv = document.getElementById('opp-hand');
    oppHandDiv.innerHTML = '';
    for(let i=0; i < (opp.hand?.length || 0); i++) {
        const b = document.createElement('div'); b.className = 'c-mini-back';
        oppHandDiv.appendChild(b);
    }

    renderBoard('opp-board', opp.board || [], true, isTurn);
    renderBoard('my-board', me.board || [], false, isTurn);

    const pb = document.getElementById('my-board');
    if (isTurn && selFrom === 'hand') { pb.classList.add('can-drop'); pb.onclick = playToBoard; }
    else if (pb) { pb.classList.remove('can-drop'); pb.onclick = null; }

    const myT = (me.deck?.length || 0) + (me.hand?.length || 0) + (me.board?.length || 0);
    const opT = (opp.deck?.length || 0) + (opp.hand?.length || 0) + (opp.board?.length || 0);
    if (myT === 0 && opT > 0) showEnd("ПОРАЖЕНИЕ"); else if (opT === 0 && myT > 0) showEnd("ПОБЕДА!");
}

function renderBoard(id, board, isOpp, isTurn) {
    const div = document.getElementById(id); 
    if (!div) return;
    div.innerHTML = '';
    
    board.forEach((c, i) => {
        const el = createCardUI(c);
        el.id = `${id}-${i}`;

        if (c.exh) {
            el.classList.add('exhausted');
        } else if (!isOpp && isTurn) {
            // Если это наш ход и карта не устала - подсвечиваем её
            el.classList.add('ready-to-attack');
        }

        // Логика кликов
        if (!isOpp && isTurn && !c.exh) {
            el.onclick = (e) => {
                e.stopPropagation();
                selIdx = i; selFrom = 'board';
                render();
            };
        } else if (isOpp && selFrom === 'board') {
            el.classList.add('can-attack');
            el.onclick = (e) => {
                e.stopPropagation();
                attack(i);
            };
        }

        if (selFrom === 'board' && selIdx === i && !isOpp) el.classList.add('selected');
        div.appendChild(el);
    });
}

// --- УНИВЕРСАЛЬНЫЙ DRAG ---
function initPointerDrag(el, idx) {
    el.onpointerdown = (e) => {
        if (gameState.turn !== myRole) return;
        
        selIdx = idx; selFrom = 'hand';
        const rect = el.getBoundingClientRect();
        const shiftX = e.clientX - rect.left;
        const shiftY = e.clientY - rect.top;

        // Визуальная подготовка
        el.classList.add('dragging');
        el.style.width = rect.width + 'px';
        el.style.height = rect.height + 'px';
        el.style.left = rect.left + 'px';
        el.style.top = rect.top + 'px';
        el.style.position = 'fixed';

        const move = (me) => {
            el.style.left = (me.clientX - shiftX) + 'px';
            el.style.top = (me.clientY - shiftY) + 'px';
        };

        const up = (ue) => {
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', up);
            el.classList.remove('dragging');

            const boardRect = document.getElementById('my-board').getBoundingClientRect();
            // Проверка: отпустили ли карту над своим полем
            if (ue.clientY > boardRect.top && ue.clientY < boardRect.bottom &&
                ue.clientX > boardRect.left && ue.clientX < boardRect.right) {
                playToBoard();
            } else {
                render(); // Возвращаем карту на место
            }
        };

        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
    };
}

// --- АНИМАЦИИ ---
// Исправленная функция появления урона
function popDmg(el, val) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.top === 0 && rect.left === 0) return; // Защита от невидимых элементов

    const d = document.createElement('div');
    d.className = 'damage-pop';
    d.innerText = `-${val}`;
    
    // Центрируем цифру относительно карты
    d.style.left = (rect.left + rect.width / 2) + 'px';
    d.style.top = (rect.top + rect.height / 2) + 'px';
    
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 1000);
}

// Исправленная анимация действий
function handleActionAnimation(act) {
    if (act.type === 'attack') {
        const isMe = act.who === myRole;
        const attId = isMe ? `my-board-${act.aIdx}` : `opp-board-${act.aIdx}`;
        const tarId = isMe ? `opp-board-${act.tIdx}` : `my-board-${act.tIdx}`;
        
        const attEl = document.getElementById(attId);
        const tarEl = document.getElementById(tarId);

        if (attEl && tarEl) {
            const rA = attEl.getBoundingClientRect();
            const rT = tarEl.getBoundingClientRect();

            const diffX = rT.left - rA.left;
            const diffY = rT.top - rA.top;

            // Поднимаем карту над всеми и толкаем
            attEl.style.zIndex = "1000";
            attEl.style.transition = "transform 0.3s cubic-bezier(0.3, 0, 0.2, 1)";
            attEl.style.transform = `translate(${diffX}px, ${diffY}px) scale(1.1)`;

            setTimeout(() => {
                // В момент удара
                popDmg(tarEl, act.dT); 
                popDmg(attEl, act.dA);
                tarEl.classList.add('shake');
                
                // Возвращаем назад
                attEl.style.transform = "translate(0,0)";
                
                setTimeout(() => {
                    tarEl.classList.remove('shake');
                    attEl.style.zIndex = "";
                }, 300);
            }, 300);
        }
    }
    
    // Анимация добора: только если добирает ПРОТИВНИК
    // (твоя анимация добора уже обрабатывается в joinRoom)
    if (act.type === 'draw' && act.who !== myRole) {
        fly('opp-deck-pos', 'opp-hand', false);
    }
}

function fly(fId, tId, col, p) {
    const fEl = document.getElementById(fId), tEl = document.getElementById(tId);
    if (!fEl || !tEl) return;
    const f = fEl.getBoundingClientRect(), t = tEl.getBoundingClientRect();
    const g = document.createElement('div');
    g.className = 'flying';
    g.style.left = f.left + 'px'; g.style.top = f.top + 'px';
    g.style.backgroundColor = col ? [null, '#3498db', '#2ecc71', '#e67e22', '#e74c3c'][p] : '#2c3e50';
    document.getElementById('anim-layer').appendChild(g);
    setTimeout(() => { g.style.left = (t.left + t.width/2 - 30) + 'px'; g.style.top = t.top + 'px'; g.style.opacity = '0'; setTimeout(() => g.remove(), 600); }, 50);
}

// --- ДЕЙСТВИЯ ---
async function playToBoard() {
    if (selIdx === null || selFrom !== 'hand') return;
    const me = gameState[myRole];
    const card = me.hand.splice(selIdx, 1)[0];
    
    // Сигнал анимации выкладывания: летит из руки на поле
    const action = { id: Date.now(), type: 'play', who: myRole, power: card.power };
    
    card.exh = false; me.played = true;
    if (!me.board) me.board = [];
    me.board.push(card);
    resetSel();
    
    // Обновляем базу, включая объект action
    await update(ref(db, `games/${curRoomId}`), { ...gameState, action });
}

async function attack(tIdx) {
    if (selIdx === null || selFrom !== 'board') return;
    if (gameState.turn !== myRole) return;

    // 1. Копируем состояние для расчетов
    const data = JSON.parse(JSON.stringify(gameState));
    const me = data[myRole];
    const oppRole = myRole === 'p1' ? 'p2' : 'p1';
    const opp = data[oppRole];

    const myC = me.board[selIdx];
    const opC = opp.board[tIdx];

    if (!myC || !opC || myC.exh) return;

    // 2. СРАЗУ считаем результат боя в нашей копии данных
    const dmgToOpp = myC.dmg;
    const dmgToMe = opC.dmg;

    opC.hp -= dmgToOpp;
    myC.hp -= dmgToMe;
    myC.exh = true; // Карта устала

    // 3. Формируем объект действия для анимации
    const action = {
        id: Date.now(),
        type: 'attack',
        who: myRole,
        aIdx: selIdx,
        tIdx: tIdx,
        dA: dmgToMe,
        dT: dmgToOpp
    };

    // 4. Очищаем погибшие карты из нашей копии
    if (opC.hp <= 0) opp.board.splice(tIdx, 1);
    if (myC.hp <= 0) me.board.splice(selIdx, 1);

    // 5. Сбрасываем выбор в интерфейсе (локально)
    resetSel();

    // 6. ОТПРАВЛЯЕМ ВСЁ В БАЗУ ОДНИМ ПАКЕТОМ
    // Мы отправляем и обновленное здоровье, и сигнал к анимации одновременно
    await set(ref(db, `games/${curRoomId}`), { ...data, action });

    // Обратите внимание: render() вызовется автоматически через onValue, 
    // но в joinRoom у нас стоит задержка для анимации, так что всё будет плавно.
}

document.getElementById('end-turn-btn').onclick = async () => {
    const data = JSON.parse(JSON.stringify(gameState));
    const me = data[myRole];
    const nextRole = myRole === 'p1' ? 'p2' : 'p1';
    
    // 1. Добор карты, если нужно
    if (me.deck && me.deck.length > 0 && (me.hand || []).length < 4) {
        if (!me.hand) me.hand = [];
        me.hand.push(me.deck.shift());
    }

    // 2. Снимаем усталость со СВОИХ карт для следующего круга
    if (me.board) {
        me.board.forEach(c => c.exh = false);
    }

    // 3. Меняем ход
    data.turn = nextRole;
    me.played = false;
    
    // Сбрасываем действие, чтобы не крутилось по кругу
    data.action = { id: Date.now(), type: 'end_turn' };

    resetSel();
    await set(ref(db, `games/${curRoomId}`), data);
};

function createCardUI(c) {
    const div = document.createElement('div');
    div.className = 'card'; 
    div.style.backgroundColor = [null, '#3498db', '#2ecc71', '#e67e22', '#e74c3c'][c.power];
    // Добавим font-size поменьше для мобилок
    div.innerHTML = `
        <div class="c-val c-top" style="font-size: 1.4rem;">${c.power}⚔️</div>
        <div class="c-val c-bot" style="font-size: 1.4rem;">${c.hp}❤️</div>
    `;
    return div;
}

function createDeck(size) {
    let d = []; const min = size == 24 ? 9 : (size == 36 ? 6 : 2);
    for(let p=1; p<=4; p++) { for(let l=min; l<=14; l++) { d.push({ power: p, hp: l, dmg: p, exh: false }); } }
    return d.sort(() => Math.random() - 0.5);
}

window.exitToLobby = async () => {
    if (!confirm("ВЫЙТИ?")) return;
    
    const roomRef = ref(db, `games/${curRoomId}`);
    const snap = await get(roomRef);
    const d = snap.val();
    
    if (d) {
        // Очищаем только свой девайс
        await update(ref(db, `games/${curRoomId}/${myRole}`), { dev: "" });
        
        // Проверяем, остался ли кто-то другой
        const otherRole = (myRole === 'p1' ? 'p2' : 'p1');
        if (!d[otherRole].dev || d[otherRole].dev === "") {
            await remove(roomRef); // Если оба вышли - удаляем
        }
    }
    location.reload();
};
function showEnd(m) { document.getElementById('end-screen').style.display='flex'; document.getElementById('end-txt').innerText = m; }
function resetSel() { selIdx = null; selFrom = null; }
function save() { if(curRoomId) set(ref(db, `games/${curRoomId}`), gameState); }