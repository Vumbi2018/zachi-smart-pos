const http = require('http');

const postData = JSON.stringify({
    username: 'director',
    password: 'admin123'
});

const loginOptions = {
    hostname: '127.0.0.1',
    port: 5055,
    path: '/api/auth/login',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': postData.length,
        'Host': 'pos.zachicomputercentre.com'
    }
};

const req = http.request(loginOptions, (res) => {
    let loginBody = '';
    res.on('data', (chunk) => { loginBody += chunk; });
    res.on('end', () => {
        const token = JSON.parse(loginBody).token;

        const getOptions = {
            hostname: '127.0.0.1',
            port: 5055,
            path: '/api/inventory',
            method: 'GET',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Host': 'pos.zachicomputercentre.com'
            }
        };

        const getReq = http.request(getOptions, (getRes) => {
            let mainBody = '';
            getRes.on('data', (chunk) => { mainBody += chunk; });
            getRes.on('end', () => {
                console.log('RAW Response:');
                console.log(mainBody.substring(0, 500)); // Print just the first 500 chars to see structure
            });
        });
        getReq.end();
    });
});

req.write(postData);
req.end();
