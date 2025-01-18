// Initialize socket variable but don't connect immediately
let socket = null;
let gameMode = null; // 'friends' or 'random'

// Function to initialize socket connection
function initializeSocket() {
    if (!socket) {
        socket = io(window.location.origin, {
            transports: ['websocket', 'polling']
        });
        
        // Set up socket event handlers
        socket.on('connect', () => {
            playerId = socket.id;
            console.log('Connected with ID:', playerId);
        });

        // Move all socket.on handlers here
        socket.on('gameCreated', (roomCode) => {
            currentRoom = roomCode;
            elements.roomCodeDisplay.textContent = `Room Code: ${roomCode}`;
            elements.roomCodeDisplay.style.display = 'block';
            showScreen('waiting');
        });

        socket.on('playerJoined', () => {
            elements.roomCodeDisplay.style.display = 'none';
            showScreen('game');
            resetRound();
        });

        socket.on('waiting', () => {
            if (gameMode === 'random') {
                elements.roomCodeDisplay.textContent = 'Finding a random opponent...';
            }
            showScreen('waiting');
        });

        socket.on('gameStart', (roomCode) => {
            currentRoom = roomCode;
            elements.roomCodeDisplay.style.display = 'none';
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
            
            // Disable moves during round end
            elements.choiceButtons.forEach(btn => {
                btn.disabled = true;
                btn.classList.remove('selected');
            });
            
            const opponentId = Object.keys(moves).find(id => id !== playerId);
            const playerMove = moves[playerId] || 'none';
            const opponentMove = moves[opponentId] || 'none';
            
            elements.playerMove.textContent = getEmoji(playerMove);
            elements.opponentMove.textContent = getEmoji(opponentMove);
            
            const playerScore = scores.find(s => s.id === playerId).score;
            const opponentScore = scores.find(s => s.id !== playerId).score;
            
            updateScores(playerScore, opponentScore);

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
                addChatMessage('Match will end in 15 seconds if no rematch is agreed', false);
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

        socket.on('playerDisconnected', (data) => {
            console.log('Received playerDisconnected event', data);
            if (currentRoom) {
                clearTimers();
                displayDisconnectMessage();
            }
        });

        socket.on('error', (message) => {
            alert(message);
            showScreen('home');
            if (socket) {
                socket.disconnect();
                socket = null;
            }
        });

        socket.on('matchTimeout', () => {
            addChatMessage('Match ended - No rematch agreement reached', false);
            setTimeout(() => {
                if (socket) {
                    socket.disconnect();
                    socket = null;
                }
                showScreen('home');
                elements.roomCodeDisplay.textContent = '';
                elements.roomCodeInput.value = '';
                gameMode = null;
            }, 2000);
        });
    }
}

// Game state
let currentRoom = null;
let playerId = null;
let currentRoundTimer = null;
let transitionTimer = null;

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
    elements.result.textContent = '';
    elements.result.className = 'result-display';
    elements.playerMove.textContent = '';
    elements.opponentMove.textContent = '';
    elements.choiceButtons.forEach(btn => {
        btn.disabled = false;
        btn.classList.remove('selected', 'winner', 'loser');
    });
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
    const controls = elements.matchControls;
    controls.style.display = 'flex';
    controls.innerHTML = '';

    // Create buttons container
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'match-buttons';
    controls.appendChild(buttonsContainer);

    if (!isRematchRequested) {
        const rematchBtn = document.createElement('button');
        rematchBtn.className = 'btn primary';
        rematchBtn.textContent = 'Request Rematch';
        rematchBtn.onclick = () => {
            socket.emit('requestRematch', currentRoom);
            rematchBtn.disabled = true;
            rematchBtn.textContent = 'Rematch Requested';
        };
        buttonsContainer.appendChild(rematchBtn);
    } else {
        const waitingText = document.createElement('div');
        waitingText.textContent = 'Waiting for opponent...';
        waitingText.className = 'waiting-text';
        buttonsContainer.appendChild(waitingText);
    }

    // Add main menu button
    const mainMenuBtn = document.createElement('button');
    mainMenuBtn.className = 'btn secondary';
    mainMenuBtn.textContent = 'Main Menu';
    mainMenuBtn.onclick = () => {
        if (socket) {
            socket.emit('leaveRoom', currentRoom);
            socket.disconnect();
            socket = null;
        }
        showScreen('home');
        elements.roomCodeDisplay.textContent = '';
        elements.roomCodeInput.value = '';
        gameMode = null;
        resetGame();
    };
    buttonsContainer.appendChild(mainMenuBtn);
}

function handlePlayerLeave() {
    if (currentRoom) {
        socket.emit('leaveRoom', currentRoom);
        displayDisconnectMessage();
    }
}

function displayDisconnectMessage() {
    clearTimers(); // Clear any active timers first
    
    // Remove any existing notifications
    const existingOverlay = document.querySelector('.disconnect-overlay');
    const existingBox = document.querySelector('.disconnect-box');
    if (existingOverlay) existingOverlay.remove();
    if (existingBox) existingBox.remove();

    // Create elements
    const overlay = document.createElement('div');
    overlay.className = 'disconnect-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    overlay.style.zIndex = '9998';

    const messageBox = document.createElement('div');
    messageBox.className = 'disconnect-box';
    messageBox.style.position = 'fixed';
    messageBox.style.top = '50%';
    messageBox.style.left = '50%';
    messageBox.style.transform = 'translate(-50%, -50%)';
    messageBox.style.backgroundColor = 'white';
    messageBox.style.padding = '2rem';
    messageBox.style.borderRadius = '12px';
    messageBox.style.textAlign = 'center';
    messageBox.style.zIndex = '9999';
    messageBox.style.minWidth = '300px';
    messageBox.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';

    messageBox.innerHTML = `
        <h2 style="color: #e84393; margin-bottom: 1rem; font-size: 1.5rem;">Game Ended</h2>
        <p style="margin-bottom: 1.5rem; color: #2d3436;">Your opponent has left the match</p>
        <button id="closeDisconnectMsg" style="
            background: linear-gradient(135deg, #6c5ce7, #a29bfe);
            color: white;
            border: none;
            padding: 1rem 2rem;
            border-radius: 8px;
            cursor: pointer;
            font-weight: bold;
            width: 100%;
            transition: transform 0.2s ease;
        ">Return to Menu</button>
    `;

    // Add to document
    document.body.appendChild(overlay);
    document.body.appendChild(messageBox);

    // Disable all game controls
    elements.choiceButtons.forEach(btn => btn.disabled = true);
    if (elements.messageInput) elements.messageInput.disabled = true;
    if (elements.sendMessageBtn) elements.sendMessageBtn.disabled = true;

    // Handle close button
    const closeBtn = document.getElementById('closeDisconnectMsg');
    closeBtn.onclick = () => {
        overlay.remove();
        messageBox.remove();
        resetGame();
        showScreen('home');
    };

    closeBtn.onmouseover = () => {
        closeBtn.style.transform = 'translateY(-2px)';
    };

    closeBtn.onmouseout = () => {
        closeBtn.style.transform = 'translateY(0)';
    };
}

// Event Listeners
elements.createGameBtn.addEventListener('click', () => {
    gameMode = 'friends';
    initializeSocket();
    socket.emit('createGame');
    elements.roomCodeDisplay.textContent = 'Creating room...';
    showScreen('waiting');
});

elements.joinRandomBtn.addEventListener('click', () => {
    gameMode = 'random';
    initializeSocket();
    socket.emit('joinRandom');
    elements.roomCodeDisplay.textContent = 'Finding a random opponent...';
    showScreen('waiting');
});

elements.joinGameBtn.addEventListener('click', () => {
    const roomCode = elements.roomCodeInput.value.toUpperCase().trim();
    if (roomCode) {
        gameMode = 'friends';
        initializeSocket();
        socket.emit('joinGame', roomCode);
    } else {
        alert('Please enter a valid room code');
    }
});

elements.cancelWaitingBtn.addEventListener('click', () => {
    if (socket) {
        socket.emit('cancelWaiting');
        socket.disconnect();
        socket = null;
    }
    gameMode = null;
    showScreen('home');
    elements.roomCodeDisplay.textContent = '';
    elements.roomCodeInput.value = '';
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

// Handle page visibility change to prevent game state inconsistencies
document.addEventListener('visibilitychange', () => {
    if (document.hidden && currentRoom) {
        handlePlayerLeave();
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (currentRoom) {
        socket.emit('leaveRoom', currentRoom);
    }
});