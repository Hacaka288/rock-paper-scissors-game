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

// Store active games and disconnected players
const activeGames = new Map();
const randomMatchmaking = new Set();
const disconnectedPlayers = new Map(); // Store disconnected players and their game info

function createGame(socket1, socket2 = null, isRandom = false) {
    const roomCode = isRandom ? 'random-' + uuidv4().substring(0, 6).toUpperCase() : uuidv4().substring(0, 6).toUpperCase();
    socket1.join(roomCode);

    const game = {
        players: [{ id: socket1.id, score: 0, rematchRequested: false }],
        moves: {},
        currentRound: 1,
        roundTimer: null,
        roundStartTime: null,
        state: 'waiting', // waiting, playing, roundEnd, matchEnd
        rematchVotes: new Set(),
        rematchTimer: null,
        isRandom: isRandom
    };

    if (socket2) {
        socket2.join(roomCode);
        game.players.push({ id: socket2.id, score: 0, rematchRequested: false });
        game.state = 'playing';
        activeGames.set(roomCode, game);
        io.to(roomCode).emit('gameStart', roomCode);
        startNewRound(roomCode); // Start the round immediately when both players join
    } else {
        activeGames.set(roomCode, game);
    }

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
    if (game.rematchTimer) {
        clearTimeout(game.rematchTimer);
        game.rematchTimer = null;
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
        // Start 15 second timer for rematch decision
        game.rematchTimer = setTimeout(() => {
            const game = activeGames.get(roomCode);
            if (game && game.state === 'matchEnd' && game.rematchVotes.size < 2) {
                io.to(roomCode).emit('matchTimeout');
                cleanupGame(roomCode);
            }
        }, 15000);
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
        
        // Remove all players from the room and disconnected players list
        game.players.forEach(player => {
            const socket = io.sockets.sockets.get(player.id);
            if (socket) {
                socket.leave(roomCode);
            }
            disconnectedPlayers.delete(player.id);
        });
        
        // Remove from random matchmaking if it was a random game
        game.players.forEach(player => {
            randomMatchmaking.delete(player.id);
        });
        
        // Remove the game from active games
        activeGames.delete(roomCode);
    }
}

function handlePlayerDisconnection(socket) {
    // Find any game this player is in
    for (const [roomCode, game] of activeGames.entries()) {
        const player = game.players.find(p => p.id === socket.id);
        if (player) {
            // Store disconnected player info
            disconnectedPlayers.set(socket.id, {
                roomCode,
                gameMode: game.isRandom ? 'random' : 'friends',
                timestamp: Date.now()
            });

            // Set a timeout to clean up if player doesn't reconnect
            setTimeout(() => {
                if (disconnectedPlayers.has(socket.id)) {
                    // Player didn't reconnect in time
                    socket.to(roomCode).emit('playerDisconnected');
                    cleanupGame(roomCode);
                    disconnectedPlayers.delete(socket.id);
                }
            }, 30000); // 30 seconds timeout

            // Notify other player about temporary disconnection
            socket.to(roomCode).emit('opponentTemporaryDisconnect');
            break;
        }
    }
    
    // Remove from random matchmaking if they were in it
    randomMatchmaking.delete(socket.id);
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('createGame', () => {
        // Remove from random matchmaking if they were in it
        randomMatchmaking.delete(socket.id);
        const roomCode = createGame(socket, null, false);
        socket.emit('gameCreated', roomCode);
    });

    socket.on('joinGame', (roomCode) => {
        // Remove from random matchmaking if they were in it
        randomMatchmaking.delete(socket.id);
        const game = activeGames.get(roomCode);
        if (game && game.players.length === 1 && !game.isRandom) {
            const createdSocketId = game.players[0].id;
            const createdSocket = io.sockets.sockets.get(createdSocketId);
            createGame(createdSocket, socket, false);
        } else {
            socket.emit('error', 'Room not found or full');
        }
    });

    socket.on('joinRandom', () => {
        // First, check if the player is already in a game
        for (const [roomCode, game] of activeGames.entries()) {
            if (game.players.some(p => p.id === socket.id)) {
                return; // Player is already in a game
            }
        }

        // Add player to random matchmaking pool
        randomMatchmaking.add(socket.id);

        // Look for another player in the random matchmaking pool
        for (const otherId of randomMatchmaking) {
            if (otherId !== socket.id) {
                const otherSocket = io.sockets.sockets.get(otherId);
                if (otherSocket) {
                    // Remove both players from the pool
                    randomMatchmaking.delete(socket.id);
                    randomMatchmaking.delete(otherId);
                    // Create a random game
                    createGame(otherSocket, socket, true);
                    return;
                }
            }
        }

        // If no match found, wait
        socket.emit('waiting');
    });

    socket.on('cancelWaiting', () => {
        // Remove from random matchmaking pool
        randomMatchmaking.delete(socket.id);
        
        // Check for and cleanup any waiting rooms
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
            clearGameTimers(game); // Clear the rematch timer
            resetGameState(game);
            io.to(roomCode).emit('rematchStarting');
            startNewRound(roomCode);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        handlePlayerDisconnection(socket);
    });

    socket.on('leaveRoom', (roomCode) => {
        const game = activeGames.get(roomCode);
        console.log('Player leaving room:', socket.id, roomCode);
        if (game) {
            socket.to(roomCode).emit('playerDisconnected');
        }
        cleanupGame(roomCode);
    });

    socket.on('chat', ({ roomCode, message }) => {
        io.to(roomCode).emit('chat', { 
            message: message.slice(0, 200), // Limit message length
            senderId: socket.id 
        });
    });

    // Handle reconnection attempts
    socket.on('attemptRejoin', ({ roomCode, gameMode }) => {
        const disconnectedInfo = disconnectedPlayers.get(socket.id);
        
        if (disconnectedInfo && disconnectedInfo.roomCode === roomCode) {
            const game = activeGames.get(roomCode);
            if (game) {
                // Rejoin the room
                socket.join(roomCode);
                disconnectedPlayers.delete(socket.id);
                
                // Send current game state
                socket.emit('rejoinSuccess', {
                    roomCode,
                    currentRound: game.currentRound,
                    scores: game.players.map(p => ({ id: p.id, score: p.score })),
                    moves: game.moves,
                    state: game.state
                });
                
                // Notify other player
                socket.to(roomCode).emit('opponentReconnected');
            } else {
                socket.emit('rejoinFailed');
            }
        } else {
            socket.emit('rejoinFailed');
        }
    });
});

// Basic error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
}).on('error', (err) => {
    console.error('Server error:', err);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
});