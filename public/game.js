// Connect to Socket.IO server
const socket = io(window.location.origin, {
    transports: ['websocket', 'polling']
});

// Game state
let currentRoom = null;
let playerId = null;
let currentRoundTimer = null;
let transitionTimer = null;

socket.on('connect', () => {
    playerId = socket.id;
    console.log('Connected with ID:', playerId);
});

// DOM Elements
const screens = {
    home: document.getElementById('homeScreen'),
    waiting: document.getElementById('waitingScreen'),
    game: document.getElementById('gameScreen')
};

const elements = {
    createGameBtn: document.getElementById('createGameBtn'),
    joinRandomBtn: document.getElementById('joinRandomBtn'),
    joinGameBtn: document.getElementById('joinGameBtn'),
    joinGameForm: document.getElementById('joinGameForm'),
    roomCodeInput: document.getElementById('roomCodeInput'),
    roomCodeDisplay: document.getElementById('roomCodeDisplay'),
    cancelWaitingBtn: document.getElementById('cancelWaitingBtn'),
    choiceButtons: document.querySelectorAll('.choice-btn'),
    result: document.getElementById('result'),
    playerMove: document.getElementById('playerMove'),
    opponentMove: document.getElementById('opponentMove'),
    playerScoreDisplay: document.getElementById('playerScore'),
    opponentScoreDisplay: document.getElementById('opponentScore'),
    messageInput: document.getElementById('messageInput'),
    sendMessageBtn: document.getElementById('sendMessageBtn'),
    chatMessages: document.getElementById('chatMessages'),
    roundDisplay: document.getElementById('roundDisplay'),
    timerDisplay: document.getElementById('timerDisplay'),
    timerBar: document.getElementById('timerBar'),
    matchControls: document.getElementById('matchControls')
};

// Timer Functions
function startRoundTimer(duration) {
    let timeLeft = duration;
    updateTimerDisplay(timeLeft);

    clearTimers();

    currentRoundTimer = setInterval(() => {
        timeLeft -= 1;
        updateTimerDisplay(timeLeft);

        if (timeLeft <= 0) {
            clearInterval(currentRoundTimer);
            elements.choiceButtons.forEach(btn => btn.disabled = true);
        }
    }, 1000);
}

function updateTimerDisplay(timeLeft) {
    elements.timerDisplay.textContent = timeLeft;
    const percentage = (timeLeft / 10) * 100;
    elements.timerBar.style.width = `${percentage}%`;
    
    if (timeLeft <= 3) {
        elements.timerBar.classList.add('warning');
    } else {
        elements.timerBar.classList.remove('warning');
    }
}

function clearTimers() {
    if (currentRoundTimer) {
        clearInterval(currentRoundTimer);
        currentRoundTimer = null;
    }
    if (transitionTimer) {
        clearTimeout(transitionTimer);
        transitionTimer = null;
    }
}

// Helper Functions
function showScreen(screenId) {
    Object.values(screens).forEach(screen => screen.classList.remove('active'));
    screens[screenId].classList.add('active');
}

function addChatMessage(message, isPlayer = true) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${isPlayer ? 'player' : 'opponent'}`;
    messageDiv.textContent = message;
    elements.chatMessages.appendChild(messageDiv);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function getEmoji(choice) {
    const emojis = {
        rock: '✊',
        paper: '✋',
        scissors: '✌️',
        none: '❌'
    };
    return emojis[choice] || '❓';
}

function updateScores(playerScore, opponentScore) {
    elements.playerScoreDisplay.textContent = playerScore;
    elements.opponentScoreDisplay.textContent = opponentScore;
}

function resetRound() {
    elements.choiceButtons.forEach(btn => {
        btn.disabled = false;
        btn.classList.remove('selected', 'winner', 'loser');
    });
    elements.playerMove.textContent = '';
    elements.opponentMove.textContent = '';
    elements.result.textContent = '';
    elements.result.className = 'result-display';
}

function resetGame() {
    clearTimers();
    currentRoom = null;
    elements.matchControls.style.display = 'none';
    elements.playerScoreDisplay.textContent = '0';
    elements.opponentScoreDisplay.textContent = '0';
    elements.roundDisplay.textContent = '';
    elements.result.textContent = '';
    elements.result.className = 'result-display';
    elements.playerMove.textContent = '';
    elements.opponentMove.textContent = '';
    elements.chatMessages.innerHTML = '';
}

function showMatchControls(isRematchRequested = false) {
    elements.matchControls.innerHTML = `
        <button id="rematchBtn" class="btn primary" ${isRematchRequested ? 'disabled' : ''}>
            ${isRematchRequested ? 'Rematch Requested...' : 'Request Rematch'}
        </button>
        <button id="mainMenuBtn" class="btn secondary">Main Menu</button>
    `;
    
    elements.matchControls.style.display = 'flex';
    
    document.getElementById('rematchBtn').addEventListener('click', () => {
        socket.emit('requestRematch', currentRoom);
        document.getElementById('rematchBtn').disabled = true;
        document.getElementById('rematchBtn').textContent = 'Rematch Requested...';
    });
    
    document.getElementById('mainMenuBtn').addEventListener('click', () => {
        socket.emit('leaveRoom', currentRoom);
        showScreen('home');
        resetGame();
    });
}

// Event Listeners
elements.createGameBtn.addEventListener('click', () => {
    socket.emit('createGame');
    showScreen('waiting');
});

elements.joinRandomBtn.addEventListener('click', () => {
    socket.emit('joinRandom');
    showScreen('waiting');
});

elements.joinGameBtn.addEventListener('click', () => {
    const roomCode = elements.roomCodeInput.value.toUpperCase().trim();
    if (roomCode) {
        socket.emit('joinGame', roomCode);
    }
});

elements.cancelWaitingBtn.addEventListener('click', () => {
    socket.emit('cancelWaiting');
    showScreen('home');
});

elements.choiceButtons.forEach(button => {
    button.addEventListener('click', () => {
        const choice = button.dataset.choice;
        socket.emit('move', { roomCode: currentRoom, move: choice });
        elements.choiceButtons.forEach(btn => {
            btn.disabled = true;
            btn.classList.remove('selected');
        });
        button.classList.add('selected');
        elements.playerMove.textContent = getEmoji(choice);
    });
});

elements.sendMessageBtn.addEventListener('click', () => {
    const message = elements.messageInput.value.trim();
    if (message) {
        socket.emit('chat', { roomCode: currentRoom, message });
        elements.messageInput.value = '';
    }
});

elements.messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        elements.sendMessageBtn.click();
    }
});

// Socket Event Handlers
socket.on('gameCreated', (roomCode) => {
    currentRoom = roomCode;
    elements.roomCodeDisplay.textContent = `Room Code: ${roomCode}`;
    showScreen('waiting');
});

socket.on('playerJoined', () => {
    showScreen('game');
    resetRound();
});

socket.on('waiting', () => {
    elements.roomCodeDisplay.textContent = 'Finding an opponent...';
});

socket.on('gameStart', (roomCode) => {
    currentRoom = roomCode;
    showScreen('game');
    resetRound();
});

socket.on('roundStart', ({ round, scores }) => {
    clearTimers();
    
    const opponentScore = scores.find(s => s.id !== playerId).score;
    const playerScore = scores.find(s => s.id === playerId).score;
    
    elements.roundDisplay.textContent = `Round ${round}`;
    updateScores(playerScore, opponentScore);
    resetRound();
    startRoundTimer(10);
});

socket.on('roundResult', ({ moves, result, scores, matchWinner }) => {
    clearTimers();
    
    const opponentId = Object.keys(moves).find(id => id !== playerId);
    const playerMove = moves[playerId] || 'none';
    const opponentMove = moves[opponentId] || 'none';
    
    elements.playerMove.textContent = getEmoji(playerMove);
    elements.opponentMove.textContent = getEmoji(opponentMove);
    
    const playerScore = scores.find(s => s.id === playerId).score;
    const opponentScore = scores.find(s => s.id !== playerId).score;
    
    updateScores(playerScore, opponentScore);

    // Highlight winner
    if (result === 'tie') {
        elements.result.textContent = "It's a tie!";
    } else if (
        (result === 'player1' && scores[0].id === playerId) ||
        (result === 'player2' && scores[1].id === playerId)
    ) {
        elements.result.textContent = 'You win this round!';
        elements.result.classList.add('winner');
    } else {
        elements.result.textContent = 'Opponent wins this round!';
        elements.result.classList.add('loser');
    }

    if (matchWinner) {
        const isWinner = matchWinner === playerId;
        elements.result.textContent = isWinner ? 'You won the match!' : 'You lost the match!';
        elements.result.className = `result-display ${isWinner ? 'winner' : 'loser'}`;
        showMatchControls();
    }
});

socket.on('rematchRequested', ({ requesterId, votes }) => {
    if (requesterId !== playerId) {
        addChatMessage('Opponent requested a rematch!', false);
    }
    
    const allVoted = votes.length === 2;
    if (!allVoted) {
        showMatchControls(requesterId === playerId);
    }
});

socket.on('rematchStarting', () => {
    addChatMessage('Rematch accepted! Starting new game...', false);
    elements.matchControls.style.display = 'none';
    resetRound();
});

socket.on('chat', ({ message, senderId }) => {
    addChatMessage(message, senderId === playerId);
});

socket.on('playerDisconnected', () => {
    alert('Opponent disconnected!');
    socket.emit('leaveRoom', currentRoom);
    showScreen('home');
    resetGame();
});

socket.on('error', (message) => {
    alert(message);
    showScreen('home');
});

// Handle page visibility change to prevent game state inconsistencies
document.addEventListener('visibilitychange', () => {
    if (document.hidden && currentRoom) {
        socket.emit('leaveRoom', currentRoom);
        showScreen('home');
        resetGame();
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (currentRoom) {
        socket.emit('leaveRoom', currentRoom);
    }
});