const express = require('express');
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

let rooms = {};

app.use(express.static('public'));

io.on('connection', (socket) => {
    console.log('مستخدم متصل:', socket.id);

    socket.on('createRoom', (data) => {
        const roomId = Math.random().toString(36).substr(2, 6);
        rooms[roomId] = { players: [], host: socket.id };
        socket.join(roomId);
        rooms[roomId].players.push(data.name);
        socket.emit('roomCreated', { roomId });
        console.log('غرفة جديدة:', roomId);
    });

    socket.on('joinRoom', (data) => {
        if (!rooms[data.roomId]) {
            socket.emit('errorMsg', 'الغرفة غير موجودة');
            return;
        }
        socket.join(data.roomId);
        rooms[data.roomId].players.push(data.name);
        io.to(data.roomId).emit('updatePlayers', rooms[data.roomId].players);
        console.log(`${data.name} انضم إلى ${data.roomId}`);
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;
        io.to(roomId).emit('gameStarted', room.players);
    });

    socket.on('disconnect', () => {
        console.log('مستخدم غادر:', socket.id);
    });
});

server.listen(3000, () => console.log('الخادم يعمل على http://localhost:3000'));

const socket = io();
const startDiv = document.getElementById('start');
const lobbyDiv = document.getElementById('lobby');
const gameDiv = document.getElementById('game');
const playersList = document.getElementById('players');

let currentRoom = null;

document.getElementById('create').onclick = () => {
    const name = document.getElementById('name').value;
    socket.emit('createRoom', { name });
};

socket.on('roomCreated', (data) => {
    currentRoom = data.roomId;
    startDiv.classList.add('hidden');
    lobbyDiv.classList.remove('hidden');
});

document.getElementById('join').onclick = () => {
    const name = document.getElementById('name').value;
    const roomId = document.getElementById('roomId').value;
    currentRoom = roomId;
    socket.emit('joinRoom', { roomId, name });
};

socket.on('updatePlayers', (players) => {
    playersList.innerHTML = '';
    players.forEach(p => {
        const li = document.createElement('li');
        li.innerText = p;
        playersList.appendChild(li);
    });
});

document.getElementById('startGame').onclick = () => {
    socket.emit('startGame', currentRoom);
};

socket.on('gameStarted', (players) => {
    lobbyDiv.classList.add('hidden');
    gameDiv.classList.remove('hidden');
    document.getElementById('roles').innerText = 
        "بدأت اللعبة مع اللاعبين: " + players.join(', ');
});

const express = require('express');
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static('public'));

let rooms = {};

io.on('connection', (socket) => {
    console.log('مستخدم متصل:', socket.id);

    socket.on('createRoom', (data) => {
        const roomId = Math.random().toString(36).substr(2, 6);
        rooms[roomId] = {
            host: socket.id,
            players: [{ id: socket.id, name: data.name }],
            roles: {},
            nightActions: {},
            votes: {}
        };
        socket.join(roomId);
        socket.emit('roomCreated', { roomId });
        console.log('غرفة جديدة:', roomId);
    });

    socket.on('joinRoom', (data) => {
        const room = rooms[data.roomId];
        if (!room) {
            socket.emit('errorMsg', 'الغرفة غير موجودة');
            return;
        }
        room.players.push({ id: socket.id, name: data.name });
        socket.join(data.roomId);
        io.to(data.roomId).emit('updatePlayers', room.players.map(p=>p.name));
    });

    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;

        // توزيع الأدوار عشوائياً
        const shuffled = [...room.players].sort(() => 0.5 - Math.random());
        const mafia = shuffled[0];
        const doctor = shuffled[1];
        const shayeb = shuffled[2];
        room.players.forEach((p, i) => {
            if (p.id === mafia.id) room.roles[p.id] = 'مافيا';
            else if (p.id === doctor.id) room.roles[p.id] = 'دكتور';
            else if (p.id === shayeb.id) room.roles[p.id] = 'شايب';
            else room.roles[p.id] = 'مواطن';
        });

        // إرسال الدور لكل لاعب بشكل خاص
        room.players.forEach((p) => {
            io.to(p.id).emit('roleAssigned', { role: room.roles[p.id] });
        });

        // بدء الدور الليلي
        io.to(roomId).emit('nightStart');
    });

    socket.on('nightAction', ({ roomId, target }) => {
        const room = rooms[roomId];
        if (!room) return;
        const role = room.roles[socket.id];
        room.nightActions[role] = target;

        // إذا كل الأدوار اختارت → إرسال النتيجة
        if (room.nightActions['مافيا'] && room.nightActions['دكتور'] && room.nightActions['شايب']) {
            let killed = room.nightActions['مافيا'];
            let saved = room.nightActions['دكتور'];
            let shayebCheck = room.nightActions['شايب'];

            let infoShayeb = room.roles[
                room.players.find(p => p.name === shayebCheck).id
            ];

            let result = {
                killed: killed !== saved ? killed : 'لم يمت أحد',
                shayebInfo: ${shayebCheck} هو ${infoShayeb}
            };

            io.to(roomId).emit('nightResult', result);

            // بدء التصويت
            room.votes = {};
            io.to(roomId).emit('startVoting', room.players.map(p=>p.name));
        }
    });

    socket.on('vote', ({ roomId, target }) => {
        const room = rooms[roomId];
        if (!room) return;
        room.votes[target] = (room.votes[target] || 0) + 1;

        // إذا كل اللاعبين صوتوا → إعلان النتيجة
        if (Object.keys(room.votes).length >= room.players.length) {
            const sorted = Object.entries(room.votes).sort((a,b)=>b[1]-a[1]);
            const eliminated = sorted[0][0];
            io.to(roomId).emit('voteResult', eliminated);
        }
    });

    socket.on('disconnect', () => {
        console.log('مستخدم غادر:', socket.id);
        // (يمكن إضافة منطق إزالة اللاعب من الغرفة)
    });
});

server.listen(3000, () => console.log('الخادم يعمل على http://localhost:3000'));

const socket = io();
let currentRoom = null;
let myRole = null;

const startDiv = document.getElementById('start');
const lobbyDiv = document.getElementById('lobby');
const gameDiv = document.getElementById('game');
const playersList = document.getElementById('players');

document.getElementById('create').onclick = () => {
    const name = document.getElementById('name').value;
    socket.emit('createRoom', { name });
};

socket.on('roomCreated', (data) => {
    currentRoom = data.roomId;
    startDiv.classList.add('hidden');
    lobbyDiv.classList.remove('hidden');
});

document.getElementById('join').onclick = () => {
    const name = document.getElementById('name').value;
    const roomId = document.getElementById('roomId').value;
    currentRoom = roomId;
    socket.emit('joinRoom', { roomId, name });
};

socket.on('updatePlayers', (players) => {
    playersList.innerHTML = '';
    players.forEach(p => {
        const li = document.createElement('li');
        li.innerText = p;
        playersList.appendChild(li);
    });
});

document.getElementById('startGame').onclick = () => {
    socket.emit('startGame', currentRoom);
};

// عند توزيع الأدوار
socket.on('roleAssigned', (data) => {
    myRole = data.role;
    alert("دورك: " + myRole);
});

// بداية الدور الليلي
socket.on('nightStart', () => {
    alert("بدأ الليل! دور " + myRole);

    // إذا عندي دور مهم أختار هدف
    if (['مافيا','دكتور','شايب'].includes(myRole)) {
        const target = prompt("اختر اسم اللاعب المستهدف:");
        socket.emit('nightAction', { roomId: currentRoom, target });
    }
});

// نتيجة الليل
socket.on('nightResult', (data) => {
    alert(`الليل انتهى: ${data.killed} - الشايب اكتشف: ${data.shayebInfo}`);
});

// التصويت
socket.on('startVoting', (players) => {
    const target = prompt("اختر لاعب للتصويت عليه: \n" + players.join(", "));
    socket.emit('vote', { roomId: currentRoom, target });
});

socket.on('voteResult', (eliminated) => {
    alert("تم طرد: " + eliminated);
});