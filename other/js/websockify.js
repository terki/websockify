#!/usr/bin/env node

// A WebSocket to TCP socket proxy
// Copyright 2012 Joel Martin
// Licensed under LGPL version 3 (see docs/LICENSE.LGPL-3)

// Known to work with node 0.8.9
// Requires node modules: ws, optimist and policyfile
//     npm install ws optimist policyfile


var argv = require('optimist').string('openproxy').argv,
    net = require('net'),
    http = require('http'),
    https = require('https'),
    url = require('url'),
    path = require('path'),
    fs = require('fs'),
    policyfile = require('policyfile'),

    Buffer = require('buffer').Buffer,
    WebSocketServer = require('ws').Server,
    serveStatic = require('serve-static'),
    finalhandler = require('finalhandler'),

    webServer, wsServer,
    source_host, source_port, target_host, target_port, openproxy, serve, 
    web_path = null;


// Handle new WebSocket client
new_client = function(client) {
    var clientAddr = client._socket.remoteAddress, log;
    var url = client.upgradeReq.url;
    var urlregex = /^\/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}),(\d{1,5})/;
    var client_target_host;
    var client_target_port;

    console.log(url);
    var urlparams = urlregex.exec(url);

    if (openproxy) {
        if (!urlparams || urlparams[1].indexOf(openproxy)!==0) {
            console.log('Invalid url parameters, expected "'+openproxy+'.x.x,port" but saw "%s"',url);
            client.close();
            return;
        }
        else {
            client_target_host=urlparams[1];
            client_target_port=urlparams[2];
            log = function (msg) {
                console.log(' ' + clientAddr + '->' + client_target_host + ':' + client_target_port + ': '+ msg);
            };
        }
    }
    else {
        client_target_host=target_host;
        client_target_port=target_port;
        log = function (msg) {
            console.log(' ' + clientAddr + ': '+ msg);
        };
    }

    log('WebSocket connection');
    log('Version ' + client.protocolVersion + ', subprotocol: ' + client.protocol);

    var target = net.createConnection(client_target_port,client_target_host, function() {
        log('connected to target');
    });
    target.on('data', function(data) {
        //log("sending message: " + data);
        try {
            if (client.protocol === 'base64') {
                client.send(new Buffer(data).toString('base64'));
            } else {
                client.send(data,{binary: true});
            }
        } catch(e) {
            log("Client closed, cleaning up target");
            target.end();
        }
    });
    target.on('end', function() {
        log('target disconnected');
        client.close();
    });
    target.on('error', function() {
        log('target connection error');
        target.end();
        client.close();
    });

    client.on('message', function(msg) {
        //log('got message: ' + msg);
        if (client.protocol === 'base64') {
            target.write(new Buffer(msg, 'base64'));
        } else {
            target.write(msg,'binary');
        }
    });
    client.on('close', function(code, reason) {
        log('WebSocket client disconnected: ' + code + ' [' + reason + ']');
        target.end();
    });
    client.on('error', function(a) {
        log('WebSocket client error: ' + a);
        target.end();
    });
};


// Send an HTTP error response
http_error = function (response, code, msg) {
    response.writeHead(code, {"Content-Type": "text/plain"});
    response.write(msg + "\n");
    response.end();
    return;
};

// Process an HTTP static file request
http_request = function (request, response) {

    if (!argv.web || !serve) {
        return http_error(response, 403, "403 Permission Denied");
    }
    var done = finalhandler(request, response);
    serve(request,response,done);

};

// Select 'binary' or 'base64' subprotocol, preferring 'binary'
selectProtocol = function(protocols, callback) {
    if (protocols.indexOf('binary') >= 0) {
        callback(true, 'binary');
    } else if (protocols.indexOf('base64') >= 0) {
        callback(true, 'base64');
    } else {
        console.log("Client must support 'binary' or 'base64' protocol");
        callback(false);
    }
}

// parse source and target arguments into parts
try {
    source_arg = argv._[0].toString();
    target_arg = argv._[1] && argv._[1].toString();

    var idx;
    idx = source_arg.indexOf(":");
    if (idx >= 0) {
        source_host = source_arg.slice(0, idx);
        source_port = parseInt(source_arg.slice(idx+1), 10);
    } else {
        source_host = "";
        source_port = parseInt(source_arg, 10);
    }

    if (target_arg) {

        idx = target_arg.indexOf(":");
        if (idx < 0) {
            throw("target must be host:port");
        }
        target_host = target_arg.slice(0, idx);
        target_port = parseInt(target_arg.slice(idx+1), 10);

    }
    if (isNaN(source_port) || target_arg && isNaN(target_port)) {
        throw("illegal port");
    }
    openproxy = argv.openproxy;
    if (!target_arg && !openproxy) {
        throw("Must supply either openproxy or target_addr:target_port");
    }
    if (target_arg && openproxy) {
        throw("Target and open proxy combined not supported");
    }
    if (openproxy && !/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(openproxy)) {
        throw("Not two ip octets (ex 192.168): \""+openproxy+"\"");
    }
} catch(e) {
    console.error("websockify.js [--web web_dir] [--cert cert.pem [--key key.pem]] [--openproxy 192.168] [source_addr:]source_port [target_addr:target_port]");
    process.exit(2);
}

console.log("WebSocket settings: ");
console.log("    - proxying from " + source_host + ":" + source_port);
if (openproxy) {
    console.log("    - Open proxy to net: " + openproxy);
}
else if (target_arg) {
    console.log("    - to " + target_host + ":" + target_port);
}
if (argv.web) {
    serve = serveStatic(argv.web, {'index': ['index.html', 'index.htm']});
    console.log("    - Web server active. Serving: " + argv.web);
}

if (argv.cert) {
    argv.key = argv.key || argv.cert;
    var cert = fs.readFileSync(argv.cert),
        key = fs.readFileSync(argv.key);
    console.log("    - Running in encrypted HTTPS (wss://) mode using: " + argv.cert + ", " + argv.key);
    webServer = https.createServer({cert: cert, key: key}, http_request);
} else {
    console.log("    - Running in unencrypted HTTP (ws://) mode");
    webServer = http.createServer(http_request);
}
webServer.listen(source_port, function() {
    wsServer = new WebSocketServer({server: webServer,
                                    handleProtocols: selectProtocol});
    wsServer.on('connection', new_client);
});

// Attach Flash policyfile answer service
policyfile.createServer().listen(-1, webServer);
