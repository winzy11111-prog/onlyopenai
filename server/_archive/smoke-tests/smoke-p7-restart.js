// Verify a token still works after a server restart (DB-backed sessions)
// Run AFTER restarting the server with the token printed by the previous step.
const http = require('http');
const token = process.argv[2];
if (!token) { console.error('usage: node smoke-p7-restart.js <token>'); process.exit(2); }

http.request({ host: 'localhost', port: 3001, method: 'GET', path: '/api/projects',
    headers: { 'Authorization': 'Bearer ' + token } }, (res) => {
    let buf = '';
    res.on('data', (c) => buf += c);
    res.on('end', () => {
        const ok = res.statusCode === 200 && JSON.parse(buf || '{}').ok === true;
        console.log(ok ? `PASS — token survived restart (status=${res.statusCode})`
                       : `FAIL — token rejected (status=${res.statusCode}) body=${buf}`);
        process.exit(ok ? 0 : 1);
    });
}).end();
