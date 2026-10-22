const http = require('http');
const hostname = '127.0.0.1';
const port = 3000;

// Create a server object and pass an arrow function
const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Hello World');
});

// Let the server listen on 127.0.0.1:3000
server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`);
});