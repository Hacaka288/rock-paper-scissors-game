const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: process.env.NODE_ENV === 'production' ? false : "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Store active games
const activeGames = new Map();

function createGame(socket1, socket2 = null) {
    const roomCode = uuidv4().substring(0, 6).toUpperCase();
    socket1.join(roomCode);

    const game = {
        players: [{ id: socket1.id, score: 0, rematchRequested: false }],
        moves: {},
        currentRound: 1,
        roundTimer: null,
        roundStartTime: null,
        state: 'waiting', // waiting, playing, roundEnd, matchEnd
        rematchVotes: new Set()
    };

    if (socket2) {
        socket2.join(roomCode);
        game.players.push({ id: socket2.id, score: 0, rematchRequested: false });
        game.state = 'playing';
        startNewRound(roomCode);
        io.to(roomCode).emit('gameStart', roomCode);
    }

    activeGames.set(roomCode, game);
    return roomCode;
}

function startNewRound(roomCode) {
    const game = activeGames.get(roomCode);
    if (!game) return;

    game.moves = {};
    game.roundStartTime = Date.now();
    game.state = 'playing';

    io.to(roomCode).emit('roundStart', {
        round: game.currentRound,
        scores: game.players.map(p => ({ id: p.id, score: p.score }))
    });

    // Clear any existing timer
    clearGameTimers(game);

    // Set 10-second timer for the round
    game.roundTimer = setTimeout(() => {
        handleRoundTimeout(roomCode);
    }, 10000);
}

function clearGameTimers(game) {
    if (game.roundTimer) {
        clearTimeout(game.roundTimer);
        game.roundTimer = null;
    }
}

function resetGameState(game) {
    game.players.forEach(p => {
        p.score = 0;
        p.rematchRequested = false;
    });
    game.currentRound = 1;
    game.state = 'playing';
    game.moves = {};
    game.rematchVotes.clear();
    clearGameTimers(game);
}

function handleRoundTimeout(roomCode) {
    const game = activeGames.get(roomCode);
    if (!game || game.state !== 'playing') return;

    // Set 'none' for players who haven't made a move
    game.players.forEach(player => {
        if (!game.moves[player.id]) {
            game.moves[player.id] = 'none';
        }
    });

    processRoundResult(roomCode);
}

function processRoundResult(roomCode) {
    const game = activeGames.get(roomCode);
    if (!game) return;

    const player1Id = game.players[0].id;
    const player2Id = game.players[1].id;
    const move1 = game.moves[player1Id] || 'none';
    const move2 = game.moves[player2Id] || 'none';
    
    const result = determineWinner(move1, move2);
    
    if (result === 'player1') {
        game.players[0].score++;
    } else if (result === 'player2') {
        game.players[1].score++;
    }

    game.state = 'roundEnd';
    
    const matchResult = checkMatchWinner(game);
    const roundResult = {
        moves: game.moves,
        result,
        scores: game.players.map(p => ({ id: p.id, score: p.score })),
        matchWinner: matchResult
    };

    io.to(roomCode).emit('roundResult', roundResult);

    if (matchResult) {
        game.state = 'matchEnd';
        return;
    }

    game.currentRound++;
    setTimeout(() => startNewRound(roomCode), 3000);
}

function checkMatchWinner(game) {
    const WIN_SCORE = 2;
    for (const player of game.players) {
        if (player.score >= WIN_SCORE) {
            return player.id;
        }
    }
    return null;
}

function determineWinner(move1, move2) {
    if (move1 === 'none' && move2 === 'none') return 'tie';
    if (move1 === 'none') return 'player2';
    if (move2 === 'none') return 'player1';
    if (move1 === move2) return 'tie';
    
    const winningMoves = {
        rock: 'scissors',
        paper: 'rock',
        scissors: 'paper'
    };
    
    return winningMoves[move1] === move2 ? 'player1' : 'player2';
}

function cleanupGame(roomCode) {
    const game = activeGames.get(roomCode);
    if (game) {
        // Clear any active timers
        clearGameTimers(game);
        // Remove the game from active games
        activeGames.delete(roomCode);
    }
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('createGame', () => {
        const roomCode = createGame(socket);
        socket.emit('gameCreated', roomCode);
    });

    socket.on('joinGame', (roomCode) => {
        const game = activeGames.get(roomCode);
        if (game && game.players.length === 1) {
            const createdSocketId = game.players[0].id;
            const createdSocket = io.sockets.sockets.get(createdSocketId);
            createGame(createdSocket, socket);
        } else {
            socket.emit('error', 'Room not found or full');
        }
    });

    socket.on('joinRandom', () => {
        const availableRoom = Array.from(activeGames.entries()).find(([_, game]) => 
            game.players.length === 1 && game.state === 'waiting'
        );

        if (availableRoom) {
            const [roomCode, game] = availableRoom;
            const hostSocketId = game.players[0].id;
            const hostSocket = io.sockets.sockets.get(hostSocketId);
            createGame(hostSocket, socket);
        } else {
            const roomCode = createGame(socket);
            socket.emit('waiting');
        }
    });

    socket.on('cancelWaiting', () => {
        for (const [roomCode, game] of activeGames.entries()) {
            if (game.players.length === 1 && game.players[0].id === socket.id) {
                cleanupGame(roomCode);
                break;
            }
        }
    });

    socket.on('move', ({ roomCode, move }) => {
        const game = activeGames.get(roomCode);
        if (!game || game.state !== 'playing') return;

        if (!['rock', 'paper', 'scissors'].includes(move)) {
            socket.emit('error', 'Invalid move');
            return;
        }

        game.moves[socket.id] = move;

        if (Object.keys(game.moves).length === 2) {
            clearGameTimers(game);
            processRoundResult(roomCode);
        }
    });

    socket.on('requestRematch', (roomCode) => {
        const game = activeGames.get(roomCode);
        if (!game || game.state !== 'matchEnd') return;

        // Add player's vote for rematch
        game.rematchVotes.add(socket.id);
        
        // Notify others about rematch request
        io.to(roomCode).emit('rematchRequested', {
            requesterId: socket.id,
            votes: Array.from(game.rematchVotes)
        });

        // If all players voted for rematch, start new game
        if (game.rematchVotes.size === 2) {
            resetGameState(game);
            startNewRound(roomCode);
            io.to(roomCode).emit('rematchStarting');
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        for (const [roomCode, game] of activeGames.entries()) {
            const playerIndex = game.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                // Clear any active timers first
                clearGameTimers(game);
                // Notify other player in the room
                socket.to(roomCode).emit('playerDisconnected', { during: game.state });
                console.log('Emitting playerDisconnected to room:', roomCode);
                cleanupGame(roomCode);
                break;
            }
        }
    });

    socket.on('leaveRoom', (roomCode) => {
        const game = activeGames.get(roomCode);
        console.log('Player leaving room:', socket.id, roomCode);
        if (game) {
            socket.to(roomCode).emit('playerDisconnected', { during: game.state });
        }
        cleanupGame(roomCode);
    });

    socket.on('chat', ({ roomCode, message }) => {
        io.to(roomCode).emit('chat', { 
            message: message.slice(0, 200), // Limit message length
            senderId: socket.id 
        });
    });
});

// Basic error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});