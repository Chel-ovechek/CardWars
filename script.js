
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, onValue, remove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyCRbsWjbM3EVYzyFNvJO-QOsM0IaQU51jI",
    authDomain: "cardwars-40ca8.firebaseapp.com",
    databaseURL: "https://cardwars-40ca8-default-rtdb.firebaseio.com",
    projectId: "cardwars-40ca8",
    storageBucket: "cardwars-40ca8.firebasestorage.app",
    messagingSenderId: "358613737791",
    appId: "1:358613737791:web:f79feea7d2c34a5aeab38a",
    measurementId: "G-MKFS8FCDG9"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let deviceId = localStorage.getItem('deviceId') || 'dev_' + Math.random().toString(36).substr(2, 9);
localStorage.setItem('deviceId', deviceId);

const gameId = "room1";
const gameRef = ref(db, `games/${gameId}`);

let myRole = null;
let gameState = null;

// Переменные выбора
let selectedIdx = null;
let selectedFrom = null; // 'hand' или 'board'

const SUITS = { '♦': 1, '♥': 2, '♠': 3, '♣': 4 };
const RANKS = { '2':2, '3':3, '4':4, '5':5, '6':6, '7':7, '8':8, '9':9, '10':10, 'J':11, 'Q':12, 'K':13, 'A':14 };

onValue(gameRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) showStartScreen(null, null);
    else {
        gameState = data;
        if (data.p1_device === deviceId) myRole = 'p1';
        else if (data.p2_device === deviceId) myRole = 'p2';
        
        if (myRole) {
            document.getElementById('start-screen').style.display = 'none';
            document.getElementById('game-container').style.display = 'flex';
            render();
        } else {
            showStartScreen(data.p1_device, data.p2_device);
        }
    }
});

function render() {
    if (!gameState || !myRole) return;
    const me = gameState[myRole];
    const oppRole = myRole === 'p1' ? 'p2' : 'p1';
    const opp = gameState[oppRole];
    const isMyTurn = gameState.turn === myRole;

    document.getElementById('turn-status').innerText = isMyTurn ? "ВАШ ХОД" : "ХОД ПРОТИВНИКА";
    document.getElementById('end-turn-btn').disabled = !isMyTurn;

    // 1. РУКА
    const myHandDiv = document.getElementById('player-hand');
    myHandDiv.innerHTML = '';
    (me.hand || []).forEach((card, idx) => {
        const cardEl = createCardEl(card);
        if (isMyTurn) {
            cardEl.onclick = () => { selectedIdx = idx; selectedFrom = 'hand'; render(); };
        }
        if (selectedFrom === 'hand' && selectedIdx === idx) cardEl.classList.add('selected');
        myHandDiv.appendChild(cardEl);
    });

    // 2. МОЕ ПОЛЕ
    const myBoardDiv = document.getElementById('player-board');
    myBoardDiv.innerHTML = '';
    (me.board || []).forEach((card, idx) => {
        const cardEl = createCardEl(card);
        // Карта может ходить, если она не exhausted и наш ход
        const canGo = isMyTurn && !card.exhausted;
        if (canGo) cardEl.classList.add('can-go');
        if (card.exhausted) cardEl.classList.add('exhausted');

        cardEl.onclick = () => {
            if (canGo) {
                selectedIdx = idx;
                selectedFrom = 'board';
                render();
            }
        };
        if (selectedFrom === 'board' && selectedIdx === idx) cardEl.classList.add('selected');
        myBoardDiv.appendChild(cardEl);
    });

    // 3. ЛОГИКА ВЫКЛАДЫВАНИЯ (Клик по пустому полю)
    if (isMyTurn && selectedFrom === 'hand') {
        myBoardDiv.classList.add('can-drop');
        myBoardDiv.onclick = playCard;
    } else {
        myBoardDiv.classList.remove('can-drop');
        myBoardDiv.onclick = null;
    }

    // 4. ПОЛЕ ПРОТИВНИКА (Цели для атаки)
    const oppBoardDiv = document.getElementById('opponent-board');
    oppBoardDiv.innerHTML = '';
    (opp.board || []).forEach((card, idx) => {
        const cardEl = createCardEl(card);
        // Если мы выбрали СВОЮ карту на поле, можем бить ЧУЖУЮ
        if (isMyTurn && selectedFrom === 'board') {
            cardEl.classList.add('can-attack');
            cardEl.onclick = () => attack(idx);
        }
        oppBoardDiv.appendChild(cardEl);
    });
}

// ДЕЙСТВИЕ: ВЫЛОЖИТЬ НА СТОЛ
async function playCard() {
    const card = gameState[myRole].hand.splice(selectedIdx, 1)[0];
    if (!gameState[myRole].board) gameState[myRole].board = [];
    
    // Новая карта на столе "спит" (exhausted)
    card.exhausted = true; 
    gameState[myRole].board.push(card);
    
    resetSelection();
    await saveGame();
}

// ДЕЙСТВИЕ: АТАКА КАРТОЙ С ПОЛЯ
async function attack(targetIdx) {
    const oppRole = myRole === 'p1' ? 'p2' : 'p1';
    let myCard = gameState[myRole].board[selectedIdx];
    let oppCard = gameState[oppRole].board[targetIdx];

    // Взаимный урон
    oppCard.hp -= myCard.dmg;
    myCard.hp -= oppCard.dmg;
    
    // Помечаем, что карта атаковала
    myCard.exhausted = true;

    // Проверка смертей
    if (myCard.hp <= 0) gameState[myRole].board.splice(selectedIdx, 1);
    if (oppCard.hp <= 0) gameState[oppRole].board.splice(targetIdx, 1);

    resetSelection();
    await saveGame();
}

// ЗАВЕРШЕНИЕ ХОДА
document.getElementById('end-turn-btn').onclick = async () => {
    const currentTurn = gameState.turn;
    const nextTurn = currentTurn === 'p1' ? 'p2' : 'p1';

    // 1. Добор карты (текущему игроку)
    if (gameState.deck && gameState.deck.length > 0 && (gameState[currentTurn].hand || []).length < 4) {
        if (!gameState[currentTurn].hand) gameState[currentTurn].hand = [];
        gameState[currentTurn].hand.push(gameState.deck.shift());
    }

    // 2. Снятие усталости с карт СЛЕДУЮЩЕГО игрока
    if (gameState[nextTurn].board) {
        gameState[nextTurn].board.forEach(card => card.exhausted = false);
    }

    gameState.turn = nextTurn;
    resetSelection();
    await saveGame();
};

// ВСПОМОГАТЕЛЬНОЕ
function resetSelection() {
    selectedIdx = null;
    selectedFrom = null;
}

async function saveGame() {
    // Чиним структуру перед сохранением
    ['p1', 'p2'].forEach(p => {
        if (!gameState[p].board) gameState[p].board = [];
        if (!gameState[p].hand) gameState[p].hand = [];
    });
    await set(gameRef, gameState);
}

function createCardEl(card) {
    const div = document.createElement('div');
    div.className = 'card';
    div.dataset.suit = card.suit;
    div.innerHTML = `<div>${card.rank}${card.suit}</div><div class="dmg">${card.dmg}</div><div class="hp">${card.hp}</div>`;
    return div;
}

function createDeck() {
    let deck = [];
    Object.keys(SUITS).forEach(s => {
        Object.keys(RANKS).forEach(r => {
            deck.push({ suit: s, rank: r, hp: RANKS[r], dmg: SUITS[s], exhausted: false });
        });
    });
    return deck.sort(() => Math.random() - 0.5);
}

window.chooseRole = function(role) {
    myRole = role;
    if (!gameState) {
        const deck = createDeck();
        const initialData = {
            deck: deck.slice(8),
            p1: { hand: deck.slice(0, 4), board: [], hp: 30 },
            p2: { hand: deck.slice(4, 8), board: [], hp: 30 },
            turn: 'p1',
            [role + '_device']: deviceId
        };
        saveGameFromData(initialData);
    } else {
        gameState[role + '_device'] = deviceId;
        saveGame();
    }
};

async function saveGameFromData(data) {
    await set(gameRef, data);
}

function showStartScreen(p1_dev, p2_dev) {
    document.getElementById('start-screen').style.display = 'flex';
    document.getElementById('game-container').style.display = 'none';
    document.getElementById('btn-p1').disabled = p1_dev && p1_dev !== deviceId;
    document.getElementById('btn-p2').disabled = p2_dev && p2_dev !== deviceId;
}

document.getElementById('reset-db').onclick = () => {
    localStorage.removeItem('deviceId');
    remove(gameRef).then(() => location.reload());
};